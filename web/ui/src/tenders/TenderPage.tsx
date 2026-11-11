import {useCallback,useEffect,useRef,useState,type FormEvent,type ReactNode} from "react";
import {a2SyntheticIntent,a2SyntheticHeaders,a2SyntheticOrigin} from "../hml/a2-synthetic";
import {ArrowLeft,ArrowRight,BriefcaseBusiness,CheckCircle2,ClipboardList,
 FileCheck2,FileText,Landmark,Link2,Plus,RefreshCcw,Search,
 ShieldAlert,Undo2} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {formatMoney,parseMoneyBRL} from "../finance/types";
import {demoAgencies,demoNewTender,demoTenders} from "./fixtures";
import {blankItem,blankTender,integerMil,itemResult,localTime,
 milToText,tenderStatus,toISO,type Agency,type ItemResult,type Tender,
 type TenderDetail,type TenderDocument,type TenderForm,type TenderItem,
 type TenderItemForm,type TenderProps} from "./types";
type Choice="list"|"detail"|"new"|"edit"|"item-new"|"item-edit"|"award"|"close"|"reopen"|"document";
type F4Error=Error&{status?:number};
const DATA_ERROR=(status?:number)=>{
 if(status===401)return "Sua sessão expirou ou foi revogada. Valide sua identidade novamente.";
 if(status===403)return "Você não tem autorização para executar esta operação.";
 if(status===404)return "Registro, item ou documento indisponível para suas permissões.";
 if(status===409)return "Conflito de estado/versão ou operação já registrada. Recarregue a ficha antes de tentar novamente.";
 if(status===400||status===413||status===415)return "Verifique os campos e limites informados.";
 return "Serviço não disponível ou resposta incerta. Confira a ficha antes de repetir o comando.";
};
const STATUS=["EM_ANALISE","EM_PREPARACAO","AGUARDANDO_DISPUTA","RESULTADO_PENDENTE","CANCELADA"] as const;
const DECISIONS=["PENDENTE","PARTICIPAR","NAO_PARTICIPAR"] as const;
const normalize=(s:string)=>s.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase("pt-BR");
const isTender=(v:unknown):v is Tender=>{
 const t=v as Partial<Tender>|null;
 return !!t&&typeof t.id==="string"&&typeof t.versao==="number"&&
  typeof t.numero==="string"&&typeof t.orgao_id==="string";
};
const isDetail=(v:unknown):v is TenderDetail=>{
 const d=v as Partial<TenderDetail>|null;
 return !!d&&isTender(d.item)&&Array.isArray(d.items)&&
  Array.isArray(d.cycles)&&Array.isArray(d.documents)&&Array.isArray(d.commitments);
};
function Field({label,children,value,onChange,required=false,type="text",maxLength=240}:{
 label:string;children?:ReactNode;value?:string;onChange?:(v:string)=>void;
 required?:boolean;type?:string;maxLength?:number
}){
 return <label className="f4-field"><span>{label}</span>
  {children||<input type={type} maxLength={maxLength} value={value||""}
   onChange={e=>onChange?.(e.target.value)} required={required} autoComplete="off"/>}
 </label>;
}
function renderDecision(status:string){
 return status==="GANHO"?"success":status==="PERDIDO"||status==="CANCELADO"?"neutral":"warning";
}
const fieldTender=(t:Tender):TenderForm=>({
 orgaoId:t.orgao_id,numero:t.numero,ano:String(t.ano),modalidade:t.modalidade||"",
 objeto:t.objeto||"",portal:t.portal||"",urlProcesso:t.url_processo||"",
 limitePropostaEm:localTime(t.limite_proposta_em),inicioDisputaEm:localTime(t.inicio_disputa_em),
 decisaoParticipacao:t.decisao_participacao||"PENDENTE",
 situacaoParticipacao:t.situacao_participacao||"EM_ANALISE",
 responsavelTexto:t.responsavel_texto||"",observacoes:t.observacoes||""
});
const fieldItem=(i:TenderItem):TenderItemForm=>({
 numeroItem:i.numero_item,lote:i.lote||"",descricaoExigida:i.descricao_exigida||"",
 unidade:i.unidade||"UN",quantidadePrevista:milToText(i.quantidade_prevista_mil),
 valorProposta:i.valor_proposta_unit_cent===null?"":String(i.valor_proposta_unit_cent/100).replace(".",","),
 produtoOfertado:i.produto_ofertado||"",marcaOfertada:i.marca_ofertada||"",
 modeloOfertado:i.modelo_ofertado||"",observacoes:i.observacoes||""
});
export default function TenderPage({identity,onIdentity}:TenderProps){
 const company=identity.active;
 const verified=identity.source==="server"&&identity.stage==="verified"&&!!company;
 const demo=identity.source==="fixture"&&identity.stage==="preview"&&!!company;
 const ready=demo||verified,canWrite=!!company?.permissions.canWrite,canApprove=!!company?.permissions.canApprove;
 const base="/api/v1/companies/"+encodeURIComponent(company?.id||"none");
 const endpoint=base+"/licitacoes";
 const [entries,setEntries]=useState<Tender[]>(()=>demoTenders(company?.id||"").map(x=>x.item));
 const [demoDetails,setDemoDetails]=useState<TenderDetail[]>(()=>demoTenders(company?.id||""));
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [detail,setDetail]=useState<TenderDetail|null>(null);
 const [screen,setScreen]=useState<Choice>("list"),[searchText,setSearchText]=useState("");
 const [query,setQuery]=useState(""),[yearFilter,setYearFilter]=useState("all");
 const [stateFilter,setStateFilter]=useState<"active"|"cancelled"|"all">("active");
 const [cursor,setCursor]=useState<string|null>(null);
 const [agencies,setAgencies]=useState<Agency[]>(()=>demoAgencies(company?.id||""));
 const [agencyQuery,setAgencyQuery]=useState("");
 const [form,setForm]=useState<TenderForm>(blankTender);
 const [itemForm,setItemForm]=useState<TenderItemForm>(blankItem);
 const [itemTarget,setItemTarget]=useState<TenderItem|null>(null);
 const [outcome,setOutcome]=useState<ItemResult>("GANHO");
 const [wonQuantity,setWonQuantity]=useState(""),[finalPrice,setFinalPrice]=useState("");
 const [reason,setReason]=useState("");
 const [documentId,setDocumentId]=useState(""),[documentRole,setDocumentRole]=useState<"EDITAL"|"PROPOSTA">("EDITAL");
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
 const [error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
 const [refresh,setRefresh]=useState(0);
 const listGeneration=useRef(0),detailGeneration=useRef(0),agencyGeneration=useRef(0);
 const listAbort=useRef<AbortController|null>(null);
 const detailAbort=useRef<AbortController|null>(null);
 const intent=useRef<string|null>(null);
 const current=useRef(selectedId);current.current=selectedId;
 const chooseScreen=(next:Choice)=>{
  intent.current=null;setScreen(next);setError(null);setMessage(null);
 };
 const requestJSON=useCallback(async<T,>(url:string,signal?:AbortSignal):Promise<T>=>{
  const response=await fetch(url,{credentials:"same-origin",cache:"no-store",signal,
    headers:{"accept":"application/json"}});
  if(!response.ok)throw Object.assign(new Error("request_failed"),{status:response.status});
  return response.json() as Promise<T>;
 },[]);
 const post=async(url:string,data:object,method:"POST"|"PATCH"="POST")=>{
  const response=await fetch(url,{method,cache:"no-store",credentials:"same-origin",
   headers:{"content-type":"application/json","accept":"application/json",...a2SyntheticHeaders()},
   body:JSON.stringify(data)});
  if(!response.ok)throw Object.assign(new Error("write_failed"),{status:response.status});
  return response.json() as Promise<{id?:string;newVersion?:number;intentId:string;replayed?:boolean;cicloId?:string}>;
 };
 const loadList=useCallback(async(nextCursor:string|null=null)=>{
  if(!verified)return;
  const generation=++listGeneration.current;listAbort.current?.abort();
  const ctrl=new AbortController();listAbort.current=ctrl;
  setLoading(true);setError(null);
  if(nextCursor===null){setCursor(null);setEntries([]);}
  try{
   const p=new URLSearchParams({limit:"25",state:stateFilter});
   if(query)p.set("q",query.slice(0,80));
   if(yearFilter!=="all")p.set("year",yearFilter);
   if(nextCursor)p.set("after",nextCursor);
   const data=await requestJSON<{items:unknown;nextCursor:string|null}>(endpoint+"?"+p,ctrl.signal);
   if(!Array.isArray(data.items)||data.items.length>25||!data.items.every(isTender)||
      (data.nextCursor!==null&&typeof data.nextCursor!=="string"))
    throw new Error("invalid_tender_contract");
   if(generation===listGeneration.current){
    setEntries(old=>nextCursor?[...old,...data.items as Tender[]]:data.items as Tender[]);
    setCursor(data.nextCursor);
   }
  }catch(e){if(!ctrl.signal.aborted&&generation===listGeneration.current)
   setError(DATA_ERROR((e as F4Error).status));}
  finally{if(generation===listGeneration.current)setLoading(false);}
 },[verified,endpoint,query,yearFilter,stateFilter,requestJSON]);
 const loadDetail=useCallback(async(id:string,background=false)=>{
  if(!verified)return;
  const gen=++detailGeneration.current;detailAbort.current?.abort();
  const ctrl=new AbortController();detailAbort.current=ctrl;
  if(!background){setLoading(true);setDetail(null);}
  setError(null);
  try{
   const data=await requestJSON<unknown>(endpoint+"/"+encodeURIComponent(id),ctrl.signal);
   if(!isDetail(data))throw new Error("invalid_detail_contract");
   if(gen===detailGeneration.current&&current.current===id)setDetail(data);
  }catch(e){
   if(!ctrl.signal.aborted&&gen===detailGeneration.current){
    setDetail(null);setError(DATA_ERROR((e as F4Error).status));
   }
  }finally{if(gen===detailGeneration.current)setLoading(false);}
 },[verified,endpoint,requestJSON]);
 useEffect(()=>{
  const timer=setTimeout(()=>setQuery(searchText.trim()),230);
  return ()=>clearTimeout(timer);
 },[searchText]);
 useEffect(()=>{if(verified)void loadList();return ()=>{listGeneration.current++;listAbort.current?.abort();};},
  [verified,loadList,refresh]);
 useEffect(()=>{
  if(verified&&selectedId)void loadDetail(selectedId);
  return ()=>{detailGeneration.current++;detailAbort.current?.abort();};
 },[verified,selectedId,loadDetail,refresh]);
 useEffect(()=>{
  if(!verified)return;
  const gen=++agencyGeneration.current,ctrl=new AbortController();
  const timer=setTimeout(async()=>{
   try{
    const params=new URLSearchParams({state:"active",limit:"50"});
    if(agencyQuery.trim())params.set("q",agencyQuery.trim().slice(0,80));
    const data=await requestJSON<{items:Agency[]}>(base+"/orgaos?"+params,ctrl.signal);
    if(!Array.isArray(data.items)||data.items.length>50||
       !data.items.every(x=>typeof x?.id==="string"&&typeof x?.nome==="string"))
     throw new Error("invalid_agency_contract");
    if(agencyGeneration.current===gen)setAgencies(data.items);
   }catch{if(!ctrl.signal.aborted&&agencyGeneration.current===gen)setAgencies([]);}
  },230);
  return ()=>{clearTimeout(timer);ctrl.abort();agencyGeneration.current++;};
 },[verified,base,agencyQuery,requestJSON]);
 const chooseTender=(id:string)=>{
  current.current=id;setSelectedId(id);
  if(demo)setDetail(demoDetails.find(x=>x.item.id===id)||null);
  chooseScreen("detail");
 };
 const onBack=()=>{current.current=null;setSelectedId(null);setDetail(null);chooseScreen("list");};
 const display=demo?entries.filter(x=>
   (stateFilter==="all"||stateFilter==="active"&&x.situacao_participacao!=="CANCELADA"||
    stateFilter==="cancelled"&&x.situacao_participacao==="CANCELADA")&&
   (yearFilter==="all"||String(x.ano)===yearFilter)&&
   (!query||normalize(x.numero).includes(normalize(query))||normalize(x.objeto||"").includes(normalize(query)))):entries;
 const editTender=()=>{
  if(!detail)return;setForm(fieldTender(detail.item));chooseScreen("edit");
 };
 const newTender=()=>{setForm(blankTender());setAgencyQuery("");chooseScreen("new");};
 const newItem=()=>{setItemTarget(null);setItemForm(blankItem());chooseScreen("item-new");};
 const editItem=(item:TenderItem)=>{setItemTarget(item);setItemForm(fieldItem(item));chooseScreen("item-edit");};
 const award=(item:TenderItem)=>{
  setItemTarget(item);setOutcome("GANHO");setWonQuantity(milToText(item.quantidade_prevista_mil));
  setFinalPrice(item.valor_proposta_unit_cent===null?"":String(item.valor_proposta_unit_cent/100).replace(".",","));
  chooseScreen("award");
 };
 const beginReason=(kind:"close"|"reopen")=>{setReason("");chooseScreen(kind);};
 const beginDocument=()=>{setDocumentId("");setDocumentRole("EDITAL");chooseScreen("document");};
 const createIntent=()=>{const value=intent.current||a2SyntheticIntent(crypto.randomUUID());intent.current=value;return value;};
 function success(note:string){setMessage(note);setError(null);intent.current=null;setSaving(false);}
 function mutateDemo(id:string,fn:(d:TenderDetail)=>TenderDetail):TenderDetail|null{
  const previous=demoDetails.find(x=>x.item.id===id);
  if(!previous)return null;
  const changed=fn(previous);
  setDemoDetails(all=>all.map(v=>v.item.id===id?changed:v));
  setEntries(all=>all.map(v=>v.id===id?changed.item:v));
  setDetail(changed);
  return changed;
 }
 async function submitTender(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(saving||!canWrite)return;
  const editing=screen==="edit",id=detail?.item.id;
  if(!editing&&(!form.orgaoId||!form.numero.trim())){setError("Informe órgão e número.");return;}
  const year=Number(form.ano);
  if(!Number.isInteger(year)||year<1900||year>9999){setError("Ano inválido.");return;}
  const deadline=toISO(form.limitePropostaEm),dispute=toISO(form.inicioDisputaEm);
  if((form.limitePropostaEm&&!deadline)||(form.inicioDisputaEm&&!dispute)){
   setError("Data e horário inválidos.");return;
  }
  const intentId=createIntent(),payload={
   intentId,modalidade:form.modalidade||null,objeto:form.objeto||null,
   portal:form.portal||null,urlProcesso:form.urlProcesso||null,
   limitePropostaEm:deadline,inicioDisputaEm:dispute,
   decisaoParticipacao:form.decisaoParticipacao,
   situacaoParticipacao:form.situacaoParticipacao,
   responsavelTexto:form.responsavelTexto||null,observacoes:form.observacoes||null,
   ...(editing?{expectedVersion:detail!.item.versao}:
      {orgaoId:form.orgaoId,numero:form.numero,ano:year})
  };
  setSaving(true);setError(null);setMessage(null);
  if(demo){
   if(editing&&id){
    mutateDemo(id,d=>({...d,item:{...d.item,modalidade:form.modalidade||null,
     objeto:form.objeto||null,portal:form.portal||null,url_processo:form.urlProcesso||null,
     decisao_participacao:form.decisaoParticipacao,situacao_participacao:form.situacaoParticipacao,
     responsavel_texto:form.responsavelTexto||null,observacoes:form.observacoes||null,
     versao:d.item.versao+1}}));
   }else{
    const ag=agencies.find(a=>a.id===form.orgaoId);
    const d=demoNewTender(company!.id,form,ag?.nome||"Órgão fictício");
    setDemoDetails(all=>[d,...all]);setEntries(all=>[d.item,...all]);
    current.current=d.item.id;setSelectedId(d.item.id);setDetail(d);
   }
   success("Alteração demonstrativa: nenhum dado foi gravado.");setScreen("detail");return;
  }
  try{
   const response=await post(editing?endpoint+"/"+encodeURIComponent(id!):endpoint,payload,editing?"PATCH":"POST");
   if(response.intentId!==intentId)throw new Error("intent_not_confirmed");
   const recordId=editing?id!:response.id;
   if(!recordId)throw new Error("record_id_missing");
   current.current=recordId;setSelectedId(recordId);
   success(response.replayed?"Intenção anterior reconhecida.":"Licitação registrada e auditada no D1 local.");
   setScreen("detail");setRefresh(n=>n+1);
  }catch(e){setError(DATA_ERROR((e as F4Error).status));setSaving(false);}
 }
 async function submitItem(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!canWrite||saving||!detail)return;
  const q=integerMil(itemForm.quantidadePrevista),val=itemForm.valorProposta.trim()?
    parseMoneyBRL(itemForm.valorProposta):null;
  if(q===null||(itemForm.valorProposta.trim()&&val===null)){
   setError("Quantidade até três casas e valor em reais até duas casas decimais.");return;
  }
  const editing=screen==="item-edit",target=itemTarget;
  const intentId=createIntent(),payload={
   intentId,numeroItem:itemForm.numeroItem,lote:itemForm.lote||null,
   descricaoExigida:itemForm.descricaoExigida,unidade:itemForm.unidade,
   quantidadePrevistaMil:q,valorPropostaUnitCent:val,
   produtoOfertado:itemForm.produtoOfertado||null,marcaOfertada:itemForm.marcaOfertada||null,
   modeloOfertado:itemForm.modeloOfertado||null,observacoes:itemForm.observacoes||null,
   ...(editing?{expectedVersion:target!.versao}:{})
  };
  const id=detail.item.id;
  setSaving(true);setError(null);setMessage(null);
  if(demo){
   const it:TenderItem={
    id:editing?target!.id:"f4-demo-item-"+crypto.randomUUID(),licitacao_id:id,
    numero_item:itemForm.numeroItem,lote:itemForm.lote||null,
    descricao_exigida:itemForm.descricaoExigida,unidade:itemForm.unidade,
    quantidade_prevista_mil:q,valor_proposta_unit_cent:val,
    produto_ofertado:itemForm.produtoOfertado||null,marca_ofertada:itemForm.marcaOfertada||null,
    modelo_ofertado:itemForm.modeloOfertado||null,observacoes:itemForm.observacoes||null,
    resultado:editing?target!.resultado:"PENDENTE",quantidade_ganha_mil:null,
    valor_final_unit_cent:null,origem_dado:"NATIVO",conferencia:"VALIDADO",
    versao:editing?target!.versao+1:1};
   mutateDemo(id,d=>({...d,items:editing?d.items.map(i=>i.id===it.id?it:i):[...d.items,it]}));
   success("Item de demonstração atualizado sem persistência.");setScreen("detail");return;
  }
  try{
   const result=await post(editing?endpoint+"/"+id+"/items/"+target!.id:endpoint+"/"+id+"/items",
    payload,editing?"PATCH":"POST");
   if(result.intentId!==intentId)throw new Error("intent_not_confirmed");
   success("Item registrado com trilha de auditoria.");setScreen("detail");
   setRefresh(n=>n+1);
  }catch(e){setError(DATA_ERROR((e as F4Error).status));setSaving(false);}
 }
 async function submitAward(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!canWrite||saving||!detail||!itemTarget)return;
  const won=outcome==="GANHO",q=won?integerMil(wonQuantity):null,
   val=won?parseMoneyBRL(finalPrice):null;
  if(won&&(q===null||val===null||q>itemTarget.quantidade_prevista_mil)){
   setError("Informe quantidade ganha (até o total previsto) e preço final válidos.");return;
  }
  const id=detail.item.id,it=itemTarget,intentId=createIntent();
  const payload={intentId,expectedVersion:it.versao,resultado:outcome,
   quantidadeGanhaMil:won?q:null,valorFinalUnitCent:won?val:null};
  setSaving(true);setError(null);setMessage(null);
  if(demo){
   mutateDemo(id,d=>({...d,items:d.items.map(x=>x.id===it.id?
    {...x,resultado:outcome,quantidade_ganha_mil:payload.quantidadeGanhaMil,
     valor_final_unit_cent:payload.valorFinalUnitCent,versao:x.versao+1}:x)}));
   success("Decisão simulada, nenhum empenho ou recebimento criado.");setScreen("detail");return;
  }
  try{
   const result=await post(endpoint+"/"+id+"/items/"+it.id+"/award",payload);
   if(result.intentId!==intentId)throw new Error("intent_not_confirmed");
   success("Resultado do item registrado pela R7, sem criar empenho.");setScreen("detail");
   setRefresh(n=>n+1);
  }catch(e){setError(DATA_ERROR((e as F4Error).status));setSaving(false);}
 }
 async function submitCycle(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!canWrite||saving||!detail)return;
  if(reason.trim().length<6){setError("Informe uma justificativa de pelo menos seis caracteres.");return;}
  const id=detail.item.id,reopen=screen==="reopen";
  const cycle=detail.cycles.find(c=>!c.reaberta_em);
  if(reopen&&!cycle){setError("Ciclo não encontrado.");return;}
  const intentId=createIntent(),payload={intentId,expectedVersion:detail.item.versao,motivo:reason.trim()};
  setSaving(true);setError(null);
  if(demo){
   mutateDemo(id,d=>{
    const stamp=new Date().toISOString();
    return {...d,item:{...d.item,encerrada_em:reopen?null:stamp,versao:d.item.versao+1},
     cycles:reopen?d.cycles.map(x=>x.id===cycle?.id?{...x,reaberta_em:stamp,
       motivo_reabertura:reason,versao:x.versao+1}:x):
      [...d.cycles,{id:"f4-demo-cycle-"+crypto.randomUUID(),encerrada_em:stamp,reaberta_em:null,
       motivo:reason,motivo_reabertura:null,versao:1}]};
   });
   success("Ciclo alterado somente na demonstração.");setScreen("detail");return;
  }
  try{
   const url=endpoint+"/"+id+"/cycle/"+(reopen?cycle!.id+"/reopen":"close");
   const response=await post(url,payload);
   if(response.intentId!==intentId)throw new Error("intent_not_confirmed");
   success("Ciclo comercial registrado pela R7, sem baixa financeira.");setScreen("detail");
   setRefresh(n=>n+1);
  }catch(e){setError(DATA_ERROR((e as F4Error).status));setSaving(false);}
 }
 async function submitDocument(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!canWrite||saving||!detail)return;
  if(!documentId.trim()){setError("Informe o identificador do documento já cadastrado.");return;}
  if(demo){
   setMessage("Vínculo documental não simulado: requer documento real autorizado em D1 local.");
   setScreen("detail");return;
  }
  const intentId=createIntent();
  setSaving(true);setError(null);
  try{
   const res=await post(endpoint+"/"+detail.item.id+"/documents",
    {intentId,documentoId:documentId.trim(),papel:documentRole});
   if(res.intentId!==intentId)throw new Error("intent_not_confirmed");
   success("Vínculo de metadados autorizado; nenhum PDF foi enviado.");
   setScreen("detail");setRefresh(n=>n+1);
  }catch(e){setError(DATA_ERROR((e as F4Error).status));setSaving(false);}
 }
 const chosen=detail?.item||null,mutable=!!(chosen&&chosen.origem_dado==="NATIVO"&&!chosen.encerrada_em);
 const formScreen=screen!=="list"&&screen!=="detail";
 const active=screen==="list";
 const years=Array.from(new Set(entries.map(x=>x.ano))).sort((a,b)=>b-a);
 return <div className="f4-page">
  <div className="page-intro"><div><p className="eyebrow">F4 · Gestão comercial</p>
   <h1>Licitações</h1><p>Da análise do edital à decisão por item, sem inventar empenhos ou receitas.</p></div>
   <span className="intro-decoration" aria-hidden="true"><BriefcaseBusiness size={36}/></span></div>
  <Notice title={a2SyntheticOrigin(window.location.origin)?"Homologação A2 — licitações no D1 HML":demo?"Dados fictícios — somente nesta sessão":verified?"Licitações verificadas no D1 local":"Acesso protegido"}>
   {a2SyntheticOrigin(window.location.origin)?"Registre apenas licitações e itens TESTE -, sem documentos, URLs ou dados de órgãos reais. Escritas exigem JWT, permissão e autorização sintética no Worker. Vinculação de documentos aguarda A3.":
    demo?"As licitações, decisões e alterações são simuladas em memória. Não persistem após atualizar.":
    verified?"As consultas e comandos exigem empresa, sessão e permissões válidas. Nenhuma API remota está liberada.":
    "Escolha uma empresa na Identidade e acesso. Sem contexto autorizado não carregamos processos."}
  </Notice>
  {!ready?<Card className="f4-unavailable">
   <ShieldAlert size={26}/><h2>Selecione uma empresa autorizada</h2>
   <p>As informações comerciais são separadas por empresa e perfil.</p>
   <Button onClick={onIdentity}>Identidade e acesso <ArrowRight size={16}/></Button>
  </Card>:<>
   <div className="f4-company"><span><Landmark size={19}/></span>
    <div><small>Empresa ativa</small><strong>{company!.name}</strong></div>
    <Badge tone={demo?"warning":"info"}>{demo?"Simulação":"D1 local"}</Badge>
    <Button variant="ghost" onClick={onIdentity}>Trocar empresa</Button>
   </div>
   {error&&<p className="f4-error" role="alert">{error}</p>}
   {message&&<p className="f4-success" role="status">{message}</p>}
   {!active&&<div className="f4-back">
    <Button variant="ghost" onClick={onBack}><ArrowLeft size={16}/> Voltar à lista</Button>
   </div>}
   {active&&<Card className="f4-list">
    <SectionHeading eyebrow="Processos e prazos" title="Licitações cadastradas">
     <Button disabled={!canWrite||saving} onClick={newTender}><Plus size={16}/> Nova licitação</Button>
    </SectionHeading>
    <div className="f4-filters">
     <label className="f4-search"><Search size={16}/><input type="search" aria-label="Buscar licitações"
      value={searchText} onChange={e=>setSearchText(e.target.value)} maxLength={80}
      placeholder="Buscar número ou objeto"/></label>
     <Field label="Ano"><select aria-label="Ano" value={yearFilter} onChange={e=>setYearFilter(e.target.value)}>
      <option value="all">Todos os anos</option>{years.map(y=><option value={y} key={y}>{y}</option>)}</select></Field>
     <Field label="Situação"><select aria-label="Situação" value={stateFilter}
      onChange={e=>setStateFilter(e.target.value as "active"|"cancelled"|"all")}>
      <option value="active">Ativas</option><option value="cancelled">Canceladas</option>
      <option value="all">Todas</option></select></Field>
     <Button variant="ghost" onClick={()=>setRefresh(x=>x+1)} disabled={loading}>
      <RefreshCcw size={15}/> Atualizar</Button>
    </div>
    {loading?<Skeleton lines={4}/>:display.length===0?
     <EmptyState title="Nenhuma licitação encontrada" message="Ajuste os filtros ou cadastre uma licitação na empresa selecionada."/>:
     <div className="table-scroll"><table className="f4-table"><thead><tr>
      <th>Processo</th><th>Órgão</th><th>Ano</th><th>Situação</th><th>Detalhes</th>
     </tr></thead><tbody>{display.map(t=><tr key={t.id}>
      <td className="f4-name"><strong>{t.numero}</strong>
       <small>{t.objeto||"Objeto não informado"}</small></td>
      <td>{t.orgao_nome}</td><td>{t.ano}</td><td><Badge tone={t.situacao_participacao==="CANCELADA"?"danger":"info"}>{tenderStatus(t.situacao_participacao)}</Badge></td>
      <td><Button variant="secondary" onClick={()=>chooseTender(t.id)}>Abrir ficha</Button></td>
     </tr>)}</tbody></table></div>}
    {cursor&&!demo&&<div className="f4-pagination"><Button disabled={loading} variant="secondary"
      onClick={()=>void loadList(cursor)}>Carregar mais</Button></div>}
    <p className="f4-note">Consultas paginadas, até 25 linhas por página. Dados fictícios não são enviados ao servidor.</p>
   </Card>}
   {screen==="detail"&&<>
    {loading?<Card><Skeleton lines={5}/></Card>:chosen?<Card className="f4-detail">
     <SectionHeading eyebrow={"Licitação · "+chosen.ano} title={chosen.numero}>
      {canWrite&&mutable&&<Button variant="secondary" onClick={editTender}>Editar processo</Button>}
     </SectionHeading>
     <div className="f4-detail-grid">
      <div><small>Órgão</small><strong>{chosen.orgao_nome}</strong></div>
      <div><small>Modalidade</small><strong>{chosen.modalidade||"Não informada"}</strong></div>
      <div><small>Participação</small><strong>{chosen.decisao_participacao}</strong></div>
      <div><small>Estado</small><Badge tone={chosen.encerrada_em?"success":"info"}>
       {chosen.encerrada_em?"Comercial encerrado":tenderStatus(chosen.situacao_participacao)}</Badge></div>
     </div>
     <div className="f4-object"><strong>Objeto</strong><p>{chosen.objeto||"Sem descrição cadastrada."}</p></div>
     <div className="f4-dates">
      <span><strong>Prazo da proposta:</strong> {chosen.limite_proposta_em?new Date(chosen.limite_proposta_em).toLocaleString("pt-BR"):"Não informado"}</span>
      <span><strong>Início da disputa:</strong> {chosen.inicio_disputa_em?new Date(chosen.inicio_disputa_em).toLocaleString("pt-BR"):"Não informado"}</span>
     </div>
     {chosen.origem_dado==="LEGADO"&&<p className="f4-warning">Registro histórico: edição bloqueada até conferência e migração próprias.</p>}
    </Card>:<Card><EmptyState title="Ficha indisponível" message="Selecione novamente uma licitação autorizada."/></Card>}
    {detail&&<Card className="f4-section">
     <SectionHeading eyebrow="Resultado individual; nunca cria empenho automaticamente" title="Itens da licitação">
      {canWrite&&mutable&&chosen.situacao_participacao!=="CANCELADA"&&
       <Button onClick={newItem}><Plus size={16}/> Novo item</Button>}
     </SectionHeading>
     {detail.items.length===0?<EmptyState title="Ainda sem itens" message="Cadastre itens, quantidades e valores antes de registrar o resultado."/>:
      <div className="table-scroll"><table className="f4-table"><thead><tr>
       <th>Item</th><th>Descrição</th><th>Previsto</th><th>Resultado</th><th>Ganho</th><th>Valor final unit.</th><th>Ações</th>
      </tr></thead><tbody>{detail.items.map(it=><tr key={it.id}>
       <td>{it.lote?it.lote+" / ":""}{it.numero_item}</td>
       <td className="f4-name"><strong>{it.descricao_exigida}</strong>
        <small>{it.produto_ofertado||"Oferta não informada"}</small></td>
       <td className="f4-num">{milToText(it.quantidade_prevista_mil)} {it.unidade}</td>
       <td><Badge tone={renderDecision(it.resultado)}>{itemResult(it.resultado)}</Badge></td>
       <td className="f4-num">{it.quantidade_ganha_mil===null?"—":milToText(it.quantidade_ganha_mil)}</td>
       <td className="f4-num">{it.valor_final_unit_cent===null?"—":formatMoney(it.valor_final_unit_cent)}</td>
       <td className="f4-inline">
        {canWrite&&mutable&&it.origem_dado==="NATIVO"&&
         <>
          {it.resultado==="PENDENTE"&&<Button variant="ghost" onClick={()=>editItem(it)}>Editar</Button>}
          <Button variant="secondary" onClick={()=>award(it)}>Resultado</Button>
         </>}
       </td>
      </tr>)}</tbody></table></div>}
     <p className="f4-note">Ganho parcial usa milésimos para quantidade e centavos por unidade. Resultado ganho não é faturamento; empenhos seguem a F5.</p>
    </Card>}
    {detail&&<div className="f4-two">
     <Card className="f4-section">
      <SectionHeading eyebrow="Edital e proposta" title="Documentos vinculados">
       {canWrite&&mutable&&<Button variant="secondary" onClick={beginDocument}>
        <Link2 size={15}/> Vincular existente</Button>}
      </SectionHeading>
      {detail.documents.length===0?<EmptyState title="Nenhum documento vinculado" message="Uploads PDF e integração com R2 não estão liberados antes de E5/E6."/>:
       <div className="f4-links">{detail.documents.map((doc:TenderDocument)=><div key={doc.vinculo_id}>
        <FileText size={19}/><div><strong>{doc.papel}: {doc.titulo||doc.nome_original||"Documento sem título"}</strong>
         <small>{doc.estado_integridade||"Integridade não verificada"} · metadados, sem download</small></div>
       </div>)}</div>}
      <p className="f4-note">Esta etapa lista metadados autorizados. Não disponibiliza PDF sem gate documental.</p>
     </Card>
     <Card className="f4-section">
      <SectionHeading eyebrow="F5 em diante" title="Empenhos relacionados"/>
      {detail.commitments.length===0?
       <EmptyState title="Nenhum empenho gerado" message="Registrar resultado ganho não cria empenho automaticamente. Essa operação pertence à F5."/>:
       <div className="f4-links">{detail.commitments.map(x=><div key={x.id}>
        <ClipboardList size={19}/><div><strong>{x.numero}</strong><small>{x.situacao||"Situação não informada"}</small></div>
       </div>)}</div>}
     </Card>
    </div>}
    {detail&&<Card className="f4-section">
     <SectionHeading eyebrow="Histórico auditável" title="Ciclo comercial">
      {canWrite&&mutable&&<Button onClick={()=>beginReason("close")}><FileCheck2 size={16}/> Encerrar</Button>}
      {canApprove&&chosen?.encerrada_em&&<Button variant="secondary" onClick={()=>beginReason("reopen")}>
       <Undo2 size={16}/> Reabrir</Button>}
     </SectionHeading>
     {detail.cycles.length===0?<p className="f4-note">Sem encerramentos. Concluir disputa não gera baixa ou receita automaticamente.</p>:
      <div className="f4-cycles">{detail.cycles.map(c=><div key={c.id}>
       <CheckCircle2 size={18}/><div><strong>Encerramento: {new Date(c.encerrada_em).toLocaleString("pt-BR")}</strong>
        <p>{c.motivo}</p>{c.reaberta_em&&<small>Reaberto em {new Date(c.reaberta_em).toLocaleString("pt-BR")} — {c.motivo_reabertura}</small>}
       </div></div>)}</div>}
    </Card>}
   </>}
   {formScreen&&<Card className="f4-form-card">
    <SectionHeading eyebrow="Versão controlada, trilha no servidor" title={
     screen==="new"?"Nova licitação":screen==="edit"?"Editar licitação":
     screen==="item-new"?"Novo item":screen==="item-edit"?"Editar item":
     screen==="award"?"Registrar resultado do item":
     screen==="close"?"Encerrar ciclo comercial":
     screen==="reopen"?"Reabrir ciclo comercial":"Vincular documento existente"
    }>
     <Button variant="ghost" onClick={()=>setScreen(detail?"detail":"list")} disabled={saving}>Cancelar</Button>
    </SectionHeading>
    {(screen==="new"||screen==="edit")&&<form className="f4-form" onSubmit={e=>void submitTender(e)}>
     {screen==="new"&&<>
      <Field label="Buscar órgão"><input aria-label="Buscar órgão" type="search"
       value={agencyQuery} onChange={e=>setAgencyQuery(e.target.value)}
       placeholder="Digite o começo do nome"/></Field>
      <Field label="Órgão *"><select aria-label="Órgão *" value={form.orgaoId}
       required onChange={e=>setForm(o=>({...o,orgaoId:e.target.value}))}>
       <option value="">Escolha o órgão</option>{agencies.map(a=><option key={a.id} value={a.id}>{a.nome}</option>)}</select></Field>
      <Field label="Número do processo *" value={form.numero} required
       onChange={v=>setForm(o=>({...o,numero:v}))} maxLength={100}/>
      <Field label="Ano *" type="number" value={form.ano} required
       onChange={v=>setForm(o=>({...o,ano:v}))}/>
     </>}
     {screen==="edit"&&<p className="f4-wide f4-note">Órgão, número e ano são a identidade do processo e não podem ser alterados nesta edição. Versão atual: {detail?.item.versao}.</p>}
     <Field label="Modalidade" value={form.modalidade}
      onChange={v=>setForm(o=>({...o,modalidade:v}))}/>
     <Field label="Portal" value={form.portal} onChange={v=>setForm(o=>({...o,portal:v}))}/>
     <Field label="URL HTTPS do processo" value={form.urlProcesso}
      onChange={v=>setForm(o=>({...o,urlProcesso:v}))} maxLength={1000}/>
     <Field label="Responsável" value={form.responsavelTexto}
      onChange={v=>setForm(o=>({...o,responsavelTexto:v}))}/>
     <Field label="Prazo para proposta" type="datetime-local" value={form.limitePropostaEm}
      onChange={v=>setForm(o=>({...o,limitePropostaEm:v}))}/>
     <Field label="Início da disputa" type="datetime-local" value={form.inicioDisputaEm}
      onChange={v=>setForm(o=>({...o,inicioDisputaEm:v}))}/>
     <Field label="Decisão de participar"><select aria-label="Decisão de participar"
      value={form.decisaoParticipacao} onChange={e=>setForm(o=>({...o,decisaoParticipacao:e.target.value as TenderForm["decisaoParticipacao"]}))}>
      {DECISIONS.map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select></Field>
     <Field label="Situação da participação"><select aria-label="Situação da participação"
      value={form.situacaoParticipacao} onChange={e=>setForm(o=>({...o,situacaoParticipacao:e.target.value as TenderForm["situacaoParticipacao"]}))}>
      {STATUS.map(x=><option key={x} value={x}>{tenderStatus(x)}</option>)}</select></Field>
     <Field label="Objeto da licitação"><textarea rows={3} maxLength={2000} value={form.objeto}
      onChange={e=>setForm(o=>({...o,objeto:e.target.value}))}/></Field>
     <Field label="Observações"><textarea rows={3} maxLength={3000} value={form.observacoes}
      onChange={e=>setForm(o=>({...o,observacoes:e.target.value}))}/></Field>
     <div className="f4-submit"><span>Identidade, autor e proveniência são conferidos no Worker.</span>
      <Button disabled={saving||!canWrite} type="submit">{saving?"Salvando…":"Salvar licitação"} <ArrowRight size={16}/></Button></div>
    </form>}
    {(screen==="item-new"||screen==="item-edit")&&<form className="f4-form" onSubmit={e=>void submitItem(e)}>
     <Field label="Número do item *" value={itemForm.numeroItem} required
      onChange={v=>setItemForm(o=>({...o,numeroItem:v}))}/>
     <Field label="Lote" value={itemForm.lote} onChange={v=>setItemForm(o=>({...o,lote:v}))}/>
     <Field label="Descrição exigida *" value={itemForm.descricaoExigida} required maxLength={2000}
      onChange={v=>setItemForm(o=>({...o,descricaoExigida:v}))}/>
     <Field label="Unidade *" value={itemForm.unidade} required
      onChange={v=>setItemForm(o=>({...o,unidade:v}))}/>
     <Field label="Quantidade prevista *" value={itemForm.quantidadePrevista} required
      onChange={v=>setItemForm(o=>({...o,quantidadePrevista:v}))}/>
     <Field label="Valor de proposta unitário R$" value={itemForm.valorProposta}
      onChange={v=>setItemForm(o=>({...o,valorProposta:v}))}/>
     <Field label="Produto ofertado" value={itemForm.produtoOfertado} maxLength={400}
      onChange={v=>setItemForm(o=>({...o,produtoOfertado:v}))}/>
     <Field label="Marca" value={itemForm.marcaOfertada} onChange={v=>setItemForm(o=>({...o,marcaOfertada:v}))}/>
     <Field label="Modelo" value={itemForm.modeloOfertado} onChange={v=>setItemForm(o=>({...o,modeloOfertado:v}))}/>
     <Field label="Observações"><textarea rows={3} maxLength={2000} value={itemForm.observacoes}
      onChange={e=>setItemForm(o=>({...o,observacoes:e.target.value}))}/></Field>
     <div className="f4-submit"><span>Quantidade aceita até 3 casas decimais: 1,500 = 1,5 unidade.</span>
      <Button disabled={!canWrite||saving} type="submit">{saving?"Salvando…":"Salvar item"}</Button></div>
    </form>}
    {screen==="award"&&itemTarget&&<form className="f4-form" onSubmit={e=>void submitAward(e)}>
     <p className="f4-wide f4-note">Item {itemTarget.numero_item}: {itemTarget.descricao_exigida}. Quantidade licitada: {milToText(itemTarget.quantidade_prevista_mil)} {itemTarget.unidade}. Registro de resultado não cria empenho automaticamente.</p>
     <Field label="Resultado"><select aria-label="Resultado" value={outcome}
      onChange={e=>setOutcome(e.target.value as ItemResult)}>
      <option value="GANHO">Ganho (total ou parcial)</option>
      <option value="PERDIDO">Perdido</option><option value="CANCELADO">Cancelado</option>
     </select></Field>
     {outcome==="GANHO"&&<>
      <Field label="Quantidade ganha *" value={wonQuantity} required
       onChange={setWonQuantity}/>
      <Field label="Preço final unitário R$ *" value={finalPrice} required
       onChange={setFinalPrice}/>
     </>}
     <div className="f4-submit"><span>Confirme o resultado real por item. Não cria compromissos financeiros.</span>
      <Button disabled={!canWrite||saving} type="submit">{saving?"Registrando…":"Confirmar resultado"}</Button></div>
    </form>}
    {(screen==="close"||screen==="reopen")&&<form className="f4-form" onSubmit={e=>void submitCycle(e)}>
     <p className="f4-wide f4-note">O encerramento comercial é independente da quitação financeira. Reabertura exige papel ADMIN.</p>
     <Field label="Motivo do ciclo *"><textarea rows={3} required minLength={6} maxLength={2000}
      value={reason} onChange={e=>setReason(e.target.value)}/></Field>
     <div className="f4-submit"><span>Registra marco e autor no servidor, sem apagar histórico.</span>
      <Button disabled={saving||!canWrite||(screen==="reopen"&&!canApprove)} type="submit">
       {saving?"Executando…":screen==="close"?"Encerrar processo":"Reabrir processo"}</Button></div>
    </form>}
    {screen==="document"&&<form className="f4-form" onSubmit={e=>void submitDocument(e)}>
     <p className="f4-wide f4-note">Vincula um documento já existente, previamente autorizado no D1 local. Envio de novos PDFs aguarda homologação documental E5/E6.</p>
     <Field label="ID do documento já autorizado *" required value={documentId} onChange={setDocumentId}/>
     <Field label="Papel do documento"><select aria-label="Papel do documento" value={documentRole}
      onChange={e=>setDocumentRole(e.target.value as "EDITAL"|"PROPOSTA")}>
      <option value="EDITAL">Edital</option><option value="PROPOSTA">Proposta</option>
     </select></Field>
     <div className="f4-submit"><span>Não faz upload ou download de arquivo.</span>
      <Button disabled={!canWrite||saving} type="submit">{saving?"Vinculando…":"Vincular metadados"}</Button></div>
    </form>}
   </Card>}
  </>}
 </div>;
}
