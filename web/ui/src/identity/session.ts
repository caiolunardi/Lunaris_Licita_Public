import {useCallback,useRef,useState} from "react";

export type Role = "ADMIN"|"OPERADOR"|"CONSULTA";
export type Company = {id:string;name:string;role:Role};
export type Permissions = {canRead:boolean;canWrite:boolean;canApprove:boolean};
export type ActiveCompany = Company & {permissions:Permissions};
export type UserProfile = {id:string;name:string;email:string};
export type SessionStage = "idle"|"loading"|"verified"|"preview"|"denied"|"unavailable"|"signed-out";
export type IdentityState = {
  stage:SessionStage; profile:UserProfile|null;companies:Company[];active:ActiveCompany|null;
  pending:boolean; message:string|null; source:"server"|"fixture";
};

const blank=(stage:SessionStage,source:"server"|"fixture"="server",message:string|null=null):IdentityState=>
  ({stage,source,message,profile:null,companies:[],active:null,pending:false});
const ROLES=new Set(["ADMIN","OPERADOR","CONSULTA"]);
const demoProfile:UserProfile={id:"f1-preview-person",name:"Pessoa de demonstração",email:"preview@invalid.test"};
const demoCompanies:Company[]=[
  {id:"f1-demo-aurora",name:"Empresa Aurora (fictícia)",role:"OPERADOR"},
  {id:"f1-demo-horizonte",name:"Empresa Horizonte (fictícia)",role:"CONSULTA"}
];
const perms=(role:Role):Permissions=>({
  canRead:true,canWrite:role!=="CONSULTA",canApprove:role==="ADMIN"
});
const validProfile=(p:unknown):p is UserProfile=>{
  if(!p||typeof p!=="object")return false;
  const u=p as Partial<UserProfile>;
  return typeof u.id==="string"&&u.id.length>0&&typeof u.name==="string"&&
    typeof u.email==="string"&&u.email.length<=320;
};
const validCompany=(c:unknown):c is Company=>{
  if(!c||typeof c!=="object")return false;
  const x=c as Partial<Company>;
  return typeof x.id==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(x.id) &&
    typeof x.name==="string"&&x.name.length>0&&x.name.length<=500 &&
    typeof x.role==="string"&&ROLES.has(x.role);
};
class HttpError extends Error {
  constructor(readonly status:number){super("http_"+status);}
}
const readJSON=async<T>(url:string,signal:AbortSignal):Promise<T>=>{
  const response=await fetch(url,{credentials:"same-origin",cache:"no-store",signal,
    headers:{accept:"application/json"}});
  if(!response.ok)throw new HttpError(response.status);
  return await response.json() as T;
};
function errorStage(error:unknown):SessionStage {
  return error instanceof HttpError && (error.status===401||error.status===403)?"denied":"unavailable";
}
export function useIdentity(){
  const [state,setState]=useState<IdentityState>(()=>blank("idle"));
  const generation=useRef(0);
  const controller=useRef<AbortController|null>(null);
  const invalidate=useCallback(()=>{
    generation.current++;controller.current?.abort();controller.current=null;
    return generation.current;
  },[]);
  const load=useCallback(async()=>{
    const current=invalidate();
    const abort=new AbortController();controller.current=abort;
    setState(blank("loading"));
    try {
      const who=await readJSON<{user:unknown}>("/api/v1/me",abort.signal);
      if(!validProfile(who.user))throw new Error("identity_contract_invalid");
      const response=await readJSON<{companies:unknown}>("/api/v1/companies",abort.signal);
      if(!Array.isArray(response.companies)||response.companies.length>100||
        !response.companies.every(validCompany))throw new Error("companies_contract_invalid");
      const companies=response.companies as Company[];
      let active:ActiveCompany|null=null;
      if(companies.length===1){
        const c=companies[0];
        const ctx=await readJSON<{company:unknown;permissions:unknown}>(
          "/api/v1/companies/"+encodeURIComponent(c.id)+"/context",abort.signal);
        if(!validCompany(ctx.company)||(ctx.company as Company).id!==c.id||
          typeof ctx.permissions!=="object"||ctx.permissions===null)
          throw new Error("company_context_invalid");
        const rights=ctx.permissions as Partial<Permissions>;
        if(typeof rights.canRead!=="boolean"||typeof rights.canWrite!=="boolean"||
          typeof rights.canApprove!=="boolean")throw new Error("permissions_invalid");
        active={...(ctx.company as Company),permissions:rights as Permissions};
      }
      if(generation.current===current)
        setState({stage:"verified",source:"server",profile:who.user,companies,active,pending:false,message:null});
    }catch(error){
      if(generation.current===current&&!abort.signal.aborted)
        setState(blank(errorStage(error),"server",
          errorStage(error)==="denied"?"Sessão expirada ou acesso não autorizado.":"A identidade ainda não está disponível neste laboratório."));
    }
  },[invalidate]);

  const preview=useCallback((mode:"multi"|"empty"|"denied"="multi")=>{
    invalidate();
    if(mode==="denied") {
      setState(blank("denied","fixture","Simulação: esta conta não tem autorização."));
    } else {
      setState({stage:"preview",source:"fixture",profile:demoProfile,
        companies:mode==="multi"?demoCompanies:[],active:null,pending:false,message:null});
    }
  },[invalidate]);

  const selectCompany=useCallback(async(id:string)=>{
    const selected=state.companies.find(c=>c.id===id);
    if(!selected||!["verified","preview"].includes(state.stage))return;
    const current=invalidate();
    // Remove imediatamente dados da empresa anterior, antes da verificação do destino.
    setState(previous=>({...previous,active:null,pending:true,message:null}));
    if(state.stage==="preview"){
      setState(previous=>({...previous,active:{...selected,permissions:perms(selected.role)},pending:false}));
      return;
    }
    const abort=new AbortController();controller.current=abort;
    try {
      const ctx=await readJSON<{company:unknown;permissions:unknown}>(
        "/api/v1/companies/"+encodeURIComponent(id)+"/context",abort.signal);
      if(!validCompany(ctx.company)||(ctx.company as Company).id!==id||
        typeof ctx.permissions!=="object"||ctx.permissions===null)throw new Error("invalid_company_context");
      const rights=ctx.permissions as Partial<Permissions>;
      if(typeof rights.canRead!=="boolean"||typeof rights.canWrite!=="boolean"||
        typeof rights.canApprove!=="boolean")throw new Error("permissions_invalid");
      if(generation.current===current){
        setState(previous=>({...previous,active:{...(ctx.company as Company),
          permissions:rights as Permissions},pending:false}));
      }
    }catch(error){
      if(generation.current===current&&!abort.signal.aborted){
        const denied=error instanceof HttpError&&(error.status===401||error.status===403);
        setState(previous=>denied&&error.status===401?
          blank("denied","server","A sessão foi encerrada ou expirou."):
          ({...previous,active:null,pending:false,
            message:denied?"Acesso à empresa negado ou revogado.":"Não foi possível conferir as permissões desta empresa."}));
      }
    }
  },[state,invalidate]);

  const logout=useCallback(async()=>{
    if(state.stage==="preview"){
      invalidate();setState(blank("idle"));return;
    }
    if(state.stage!=="verified"||!state.active||state.pending)return;
    const companyId=state.active.id, current=invalidate();
    const abort=new AbortController();controller.current=abort;
    setState(previous=>({...previous,active:null,pending:true,message:null}));
    try{
      const response=await fetch("/api/v1/session/logout",{
        method:"POST",credentials:"same-origin",cache:"no-store",signal:abort.signal,
        headers:{"content-type":"application/json","accept":"application/json"},
        body:JSON.stringify({companyId,intentId:crypto.randomUUID()})
      });
      if(!response.ok)throw new HttpError(response.status);
      const body=await response.json() as {revoked?:boolean};
      if(body.revoked!==true)throw new Error("logout_confirmation_missing");
      if(generation.current===current)
        setState(blank("signed-out","server","JWT revogado no servidor. O logout completo do Cloudflare Access depende da sessão do provedor."));
    }catch(error){
      if(generation.current===current&&!abort.signal.aborted)
        setState(blank(errorStage(error)==="denied"?"denied":"unavailable","server",
          "Não foi possível confirmar o encerramento. Nenhuma operação foi liberada; confirme a sessão antes de continuar."));
    }
  },[state,invalidate]);

  return {state,load,preview,selectCompany,logout};
}
