import {useCallback,useEffect,useState} from "react";
import {Clock3,RefreshCcw,ShieldCheck} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {apiGet,baseUrl,localDateLabel} from "./api";
import type {Audit,ToolsProps} from "./types";
type Scope="events"|"operations";
export default function AuditTool({identity}:ToolsProps){
 const admin=!!identity.active?.permissions.canApprove,
  verified=identity.stage==="verified"&&identity.source==="server",
  root=baseUrl(identity.active?.id||"")+"/audit";
 const [scope,setScope]=useState<Scope>("events"),[items,setItems]=useState<Audit[]>([]),
  [cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),
  [error,setError]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
 const load=useCallback(async(after:string|null=null)=>{
  if(!admin||!verified)return;
  setBusy(true);setError(null);
  try{
   const params=new URLSearchParams({scope,limit:"20"});if(after)params.set("before",after);
   const r=await apiGet<{items:Audit[];nextCursor:string|null;scope:Scope}>(root+"?"+params);
   if(!Array.isArray(r.items)||r.items.length>20||r.scope!==scope||
    !(r.nextCursor===null||typeof r.nextCursor==="string"))throw Error("Auditoria incompleta.");
   setItems(old=>after?[...old,...r.items]:r.items);setCursor(r.nextCursor);
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível ler o histórico.");}
  finally{setBusy(false);}
 },[admin,verified,scope,root]);
 useEffect(()=>{setItems([]);setCursor(null);void load();},[load,refresh]);
 return <div className="f9-page"><div className="page-intro"><div>
  <p className="eyebrow">F9 · Responsabilidade</p><h1>Histórico e auditoria.</h1>
  <p>Acompanhe as ações registradas no sistema, sem expor os documentos.</p></div>
  <ShieldCheck size={35} aria-hidden="true"/></div>
  <Notice title="Rastreabilidade sem conteúdo sigiloso">
   O painel mostra ação, categoria e data. Não entrega JWT, segredo, corpo de
   documentos, payload privado ou valores de propostas. Perfis não autorizados
   não podem ler a auditoria de outras empresas.</Notice>
  {!admin||!verified?<Card><SectionHeading title="Auditoria restrita a administradores"/>
   <p>Este histórico exige empresa selecionada e permissão administrativa.</p></Card>:<>
   {error&&<div className="f4-error" role="alert">{error}</div>}
   <div className="f9-tabs" aria-label="Tipo de histórico">
    <Button variant={scope==="events"?"primary":"secondary"}
     onClick={()=>setScope("events")}>Eventos de auditoria</Button>
    <Button variant={scope==="operations"?"primary":"secondary"}
     onClick={()=>setScope("operations")}>Diário de operações</Button>
    <Button variant="secondary" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>
     <RefreshCcw size={16}/>Atualizar</Button></div>
   <Card className="f9-card"><SectionHeading eyebrow="Últimos registros"
    title={scope==="events"?"Ações auditadas":"Operações registradas"}/>
    {busy&&<Skeleton lines={2}/>}
    {!busy&&!items.length&&<EmptyState title="Sem registros nesta empresa"
      message="A lista mostrará os eventos assim que forem registrados."/>}
    <div className="f9-list">{items.map(x=><article className="f9-list-line" key={x.id}>
     <div><strong>{x.acao||"Ação não informada"}</strong>
      <small><Clock3 size={14} aria-hidden="true"/>
       {localDateLabel(x.data_hora||x.criado_em)} · {x.tipo||"Tipo não informado"}</small></div>
     <Badge tone="neutral">{scope==="operations"?"Operação":"Evento"}</Badge>
    </article>)}</div>
    {cursor&&<Button variant="secondary" disabled={busy}
     onClick={()=>void load(cursor)}>Carregar mais registros</Button>}
   </Card>
  </>}
 </div>;
}
