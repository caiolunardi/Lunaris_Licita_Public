// R7 E5 A2 — candidato HML APENAS, não publicado.
import {createA1HmlHandler} from "./a1-candidate.mjs";
import {a2HmlReady,a2CompanyIsSynthetic,a2ValidateSyntheticMutation}
 from "../../ui/worker/a2-runtime-gate.mjs";
import {createF3Handler} from "../../ui/worker/f3-finance.mjs";
import {createF4Handler} from "../../ui/worker/f4-tenders.mjs";
import {createF5Handler} from "../../ui/worker/f5-commercial.mjs";
import {createF6Handler} from "../../ui/worker/f6-fulfillment.mjs";
import {createF7Handler} from "../../ui/worker/f7-cashflow.mjs";
import {authenticateAccess,requireCompanyRole,SecurityError} from "../r7/security.mjs";
import {assertSessionActive} from "../r7/iam.mjs";
const FIN=/^\/api\/v1\/companies\/([A-Za-z0-9_-]{1,128})\/(finance|licitacoes|commercial|fulfillment|cash)(?:\/.*)?$/;
const IDENTITY=/^\/api\/v1\/(?:me|companies|session\/logout)$/;
const REGISTERS=/^\/api\/v1\/companies\/[A-Za-z0-9_-]{1,128}\/(?:context|orgaos(?:\/[A-Za-z0-9_-]{1,128})?|fornecedores(?:\/[A-Za-z0-9_-]{1,128})?)$/;
const DENY_A3=/(?:\/documents(?:\/|$)|\/retentions(?:\/|$)|\/notifications(?:\/|$)|\/archive(?:\/|$))/;
const HEADERS={"cache-control":"private, no-store, max-age=0",
 "content-type":"application/json; charset=utf-8","x-content-type-options":"nosniff",
 "x-frame-options":"DENY","referrer-policy":"no-referrer",
 "x-robots-tag":"noindex, nofollow, noarchive",
 "content-security-policy":"default-src 'none'; frame-ancestors 'none'"};
const denied=(req,code="hml_not_ready",status=503)=>new Response(
 req.method==="HEAD"?null:JSON.stringify({error:code}),{status,headers:HEADERS});
export function createA2HmlHandler({fetchKeys}={}){
 const a1=createA1HmlHandler({fetchKeys});
 const handlers=[createF3Handler({fetchKeys}),createF4Handler({fetchKeys}),
  createF5Handler({fetchKeys}),createF6Handler({fetchKeys}),createF7Handler({fetchKeys})];
 return async function handle(request,env){
  let url;try{url=new URL(request.url);}catch{return denied(request);}
  if(!a2HmlReady(request,env))return denied(request);
  if(IDENTITY.test(url.pathname)||REGISTERS.test(url.pathname))return a1(request,env);
  const route=FIN.exec(url.pathname);
  if(!route||DENY_A3.test(url.pathname))return denied(request);
  const method=request.method.toUpperCase();
  if(!["GET","HEAD","POST","PATCH"].includes(method))
   return denied(request,"method_not_allowed",405);
  try{
   // Primeiro autenticar, validar sessão e vínculo; só depois observar dados.
   const principal=await authenticateAccess(request,env,fetchKeys||fetch);
   await assertSessionActive(env.DB,principal);
   await requireCompanyRole(env.DB,principal,route[1],
    ["POST","PATCH"].includes(method)?"write":"read");
   if(!await a2CompanyIsSynthetic(env.DB,route[1]))
    return denied(request,"hml_synthetic_only",503);
   if(["POST","PATCH"].includes(method)&&!await a2ValidateSyntheticMutation(request))
    return denied(request,"hml_synthetic_only",403);
   for(const handler of handlers){
    const res=await handler(request,env);if(res!==null)return res;
   }
   return denied(request);
  }catch(e){
   if(e instanceof SecurityError){
    const safe=["access_token_required","invalid_token","invalid_session",
     "session_revoked","forbidden"].includes(e.code)?e.code:"request_rejected";
    return denied(request,safe,Number.isInteger(e.status)?e.status:403);
   }
   return denied(request);
  }
 };
}
export default {fetch:createA2HmlHandler()};
