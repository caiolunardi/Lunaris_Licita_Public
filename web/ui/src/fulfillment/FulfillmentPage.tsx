import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {a2SyntheticIntent,a2SyntheticHeaders,a2SyntheticOrigin} from "../hml/a2-synthetic";
import {ArrowLeft,FileText,PackageCheck,Plus,RefreshCcw,Truck} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {parseMoneyBRL} from "../finance/types";
import {integerMil} from "../tenders/types";
import {demoAvailable,demoCreate,demoFulfillment,demoParents,type DemoState} from "./fixtures";
import {lineTotal,milText,moneyText,rowAmount,validAvailable,validDetail,validList,
 type Available,type Detail,type DraftLine,type Props,type Row} from "./types";

const moneyInput=(v:number|null|undefined)=>v==null?"":(v/100).toFixed(2).replace(".",",");
const name=(r:Row,invoices:boolean)=>invoices?(r.numero||"NF sem número: "+r.id.slice(0,12)):
 "Remessa "+r.id.slice(0,12);
const errorText=(s?:number)=>{
 if(s===401)return "Sessão expirada. Revalide a identidade.";
 if(s===403)return "Acesso à empresa ou operação não autorizado.";
 if(s===404)return "Registro não disponível nas suas permissões.";
 if(s===409)return "Conflito de versão, intenção ou quantidade. Consulte antes de repetir.";
 if([400,413,415].includes(s||0))return "Verifique quantidades, parcelas, limites e campos.";
 return "Resposta incerta ou serviço indisponível. Reconsulte antes de tentar novamente.";
};
type Meta={situacao:string;transportadora:string;codigoRastreio:string;urlRastreio:string;
 dataDespacho:string;previsaoEntrega:string;dataEntrega:string;recebedor:string;enderecoEntrega:string;
 numero:string;serie:string;chaveAcesso:string;emissao:string;protocolo:string;apresentadaEm:string;observacoes:string};
const emptyMeta=():Meta=>({situacao:"DESPACHADO",transportadora:"",codigoRastreio:"",urlRastreio:"",
 dataDespacho:"",previsaoEntrega:"",dataEntrega:"",recebedor:"",enderecoEntrega:"",
 numero:"",serie:"",chaveAcesso:"",emissao:"",protocolo:"",apresentadaEm:"",observacoes:""});
const fromRow=(r:Row):Meta=>({...emptyMeta(),situacao:r.situacao,
 transportadora:r.transportadora||"",codigoRastreio:r.codigo_rastreio||"",urlRastreio:r.url_rastreio||"",
 dataDespacho:r.data_despacho||"",previsaoEntrega:r.previsao_entrega||"",dataEntrega:r.data_entrega||"",
 recebedor:r.recebedor||"",enderecoEntrega:r.endereco_entrega||"",numero:r.numero||"",
 serie:r.serie||"",chaveAcesso:r.chave_acesso||"",emissao:r.emissao||"",
 protocolo:r.protocolo||"",apresentadaEm:r.apresentada_em||"",observacoes:r.observacoes||""});
const nullable=(s:string)=>s.trim()||null;
export default function FulfillmentPage({kind,identity,onIdentity}:Props){
 const company=identity.active,preview=identity.stage==="preview"&&identity.source==="fixture"&&!!company;
 const verified=identity.stage==="verified"&&identity.source==="server"&&!!company;
 const writable=!!company?.permissions.canWrite,admin=!!company?.permissions.canApprove;
 const invoice=kind==="invoices",label=invoice?"Notas fiscais":"Envios",action=invoice?"Registrar nota fiscal":"Registrar remessa";
 const root="/api/v1/companies/"+encodeURIComponent(company?.id||"none");
 const endpoint=root+"/fulfillment/"+kind;
 const [demo,setDemo]=useState<DemoState>(()=>demoFulfillment(company?.id||""));
 const [rows,setRows]=useState<Row[]>(()=>demoFulfillment(company?.id||"")[kind].map(x=>x.item));
 const [screen,setScreen]=useState<"list"|"detail"|"new"|"metadata"|"rectify">("list");
 const [detail,setDetail]=useState<Detail|null>(null),[parents,setParents]=useState<{id:string;numero:string;versao:number}[]>([]);
 const [available,setAvailable]=useState<Available|null>(null),[parent,setParent]=useState("");
 const [draft,setDraft]=useState<DraftLine[]>([]),[parcels,setParcels]=useState("");
 const [meta,setMeta]=useState<Meta>(emptyMeta);
 const [accepted,setAccepted]=useState<Record<string,{yes:string;no:string;reason:string}>>({});
 const [reason,setReason]=useState(""),[rectLines,setRectLines]=useState<DraftLine[]>([]);
 const [rectParcels,setRectParcels]=useState("");
 const [query,setQuery]=useState(""),[filter,setFilter]=useState(""),[cursor,setCursor]=useState<string|null>(null);
 const [loading,setLoading]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
 const [refresh,setRefresh]=useState(0),serial=useRef(0),selected=useRef<string|null>(null),intent=useRef<string|null>(null);
 const intention=()=>{if(!intent.current)intent.current=a2SyntheticIntent(crypto.randomUUID());return intent.current;};
 const clear=()=>{setError(null);setMessage(null);intent.current=null;};
 const get=useCallback(async<T,>(url:string):Promise<T>=>{
  const response=await fetch(url,{credentials:"same-origin",cache:"no-store",headers:{accept:"application/json"}});
  if(!response.ok)throw Object.assign(new Error("request"),{status:response.status});
  return response.json() as Promise<T>;
 },[]);
 const mutate=useCallback(async(url:string,data:unknown,method="POST"):Promise<Record<string,unknown>>=>{
  const response=await fetch(url,{method,credentials:"same-origin",cache:"no-store",
   headers:{"content-type":"application/json","accept":"application/json",...a2SyntheticHeaders()},body:JSON.stringify(data)});
  if(!response.ok)throw Object.assign(new Error("request"),{status:response.status});
  return response.json() as Promise<Record<string,unknown>>;
 },[]);
 const load=useCallback(async(next:string|null=null)=>{
  if(!verified)return;
  const seq=++serial.current;setLoading(true);setError(null);
  if(!next){setRows([]);setCursor(null);}
  const params=new URLSearchParams({limit:"25"});
  if(filter)params.set("q",filter.slice(0,80));if(next)params.set("after",next);
  try{const result=await get<unknown>(endpoint+"?"+params);
   if(!validList(result))throw Error("invalid_list_contract");
   if(seq===serial.current){setRows(old=>next?[...old,...result.items]:result.items);setCursor(result.nextCursor);}
  }catch(e){if(seq===serial.current)setError(errorText((e as {status?:number}).status));}
  finally{if(seq===serial.current)setLoading(false);}
 },[verified,endpoint,filter,get]);
 const loadDetail=useCallback(async(id:string)=>{
  if(!verified)return;
  const seq=++serial.current;setLoading(true);setError(null);setDetail(null);
  try{const result=await get<unknown>(endpoint+"/"+encodeURIComponent(id));
   if(!validDetail(result))throw Error("invalid_detail_contract");
   if(seq===serial.current&&selected.current===id)setDetail(result);
  }catch(e){if(seq===serial.current)setError(errorText((e as {status?:number}).status));}
  finally{if(seq===serial.current)setLoading(false);}
 },[verified,endpoint,get]);
 useEffect(()=>{const t=setTimeout(()=>setFilter(query.trim()),220);return()=>clearTimeout(t);},[query]);
 useEffect(()=>{if(verified&&screen==="list")void load();
  return()=>{serial.current++;};},[verified,screen,load,refresh]);
 useEffect(()=>{if(verified&&screen==="detail"&&selected.current)void loadDetail(selected.current);
  return()=>{serial.current++;};},[verified,screen,loadDetail,refresh]);
 const back=()=>{selected.current=null;setDetail(null);setScreen("list");clear();};
 function open(id:string){clear();selected.current=id;setScreen("detail");
  if(preview)setDetail(demo[kind].find(d=>d.item.id===id)||null);}
 async function start(){
  if(!writable)return;
  clear();setScreen("new");setAvailable(null);setParent("");setDraft([]);setParcels("");setParents([]);
  if(preview){setParents(demoParents(company!.id));return;}
  setLoading(true);
  try{const result=await get<{items:Row[]}>(root+"/commercial/commitments?limit=50");
   if(!Array.isArray(result.items)||result.items.length>50)throw Error("invalid_parents");
   setParents(result.items.filter(x=>x.situacao==="CONFIRMADO"&&x.origem_dado==="NATIVO")
    .map(x=>({id:x.id,numero:x.numero||x.id,versao:x.versao})));
  }catch(e){setError(errorText((e as {status?:number}).status));}
  finally{setLoading(false);}
 }
 async function selectParent(id:string){
  clear();setParent(id);setAvailable(null);setDraft([]);
  if(!id)return;
  if(preview){const av=demoAvailable(company!.id,kind,id,demo);setAvailable(av);
   setDraft(av?.items.map(x=>({id:x.id,quantidade:"",preco:moneyInput(x.valor_unit_cent)}))||[]);return;}
  const seq=++serial.current;setLoading(true);
  try{const result=await get<unknown>(root+"/fulfillment/commitments/"+encodeURIComponent(id)+
    (invoice?"/available-to-invoice":"/available-to-ship"));
   if(!validAvailable(result))throw Error("invalid_available_contract");
   if(seq===serial.current){setAvailable(result);
    setDraft(result.items.map(x=>({id:x.id,quantidade:"",preco:moneyInput(x.valor_unit_cent)})));}
  }catch(e){if(seq===serial.current)setError(errorText((e as {status?:number}).status));}
  finally{if(seq===serial.current)setLoading(false);}
 }
 const changeDraft=(id:string,field:"quantidade"|"preco",val:string)=>
  setDraft(xs=>xs.map(x=>x.id===id?{...x,[field]:val}:x));
 async function create(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!writable||pending||!available||!parent)return;
  if(available.parent.situacao!=="CONFIRMADO"||available.parent.origem_dado!=="NATIVO"){
   setError("Empenho sem permissão para novo documento.");return;}
  const lines:{parentItemId:string;quantidadeMil:number;valorUnitCent?:number}[]=[];
  for(const x of available.items){
   const d=draft.find(y=>y.id===x.id);if(!d?.quantidade.trim())continue;
   const q=integerMil(d.quantidade),price=invoice?parseMoneyBRL(d.preco):null;
   if(q===null||q>(x.remaining_mil||0)||(invoice&&price===null)){
    setError("Quantidade, saldo ou valor unitário inválidos.");return;}
   lines.push({parentItemId:x.id,quantidadeMil:q,...(invoice?{valorUnitCent:price!}:{})});
  }
  if(lines.length<1||lines.length>20){setError("Selecione de 1 a 20 itens.");return;}
  const total=invoice?lineTotal(lines.map(x=>({quantidadeMil:x.quantidadeMil,valorUnitCent:x.valorUnitCent||0}))):null;
  const values=invoice?(parcels.trim()?parcels.split(";").map(x=>parseMoneyBRL(x.trim())):[total]):[];
  if(invoice&&(total===null||total<=0||values.length<1||values.length>12||values.some(x=>x===null)||
    values.reduce<number>((sum,x)=>sum+(x||0),0)!==total)){
   setError("As parcelas devem somar exatamente o valor dos itens (máximo 12).");return;}
  const id=intention(),payload={intentId:id,parentId:parent,expectedParentVersion:available.parent.versao,
   items:lines,...(invoice?{parcelasCent:values}:{})};
  setPending(true);setError(null);setMessage(null);
  if(preview){
   const doc=demoCreate(company!.id,kind,demo,parent,lines,values as number[]);
   setDemo(old=>({...old,[kind]:[doc,...old[kind]]}));setRows(old=>[doc.item,...old]);
   selected.current=doc.item.id;setDetail(doc);setScreen("detail");intent.current=null;
   setMessage("Registro criado apenas na demonstração sintética.");setPending(false);return;
  }
  try{const result=await mutate(endpoint,payload);
   if(result.intentId!==id)throw Error("unconfirmed_intent");
   intent.current=null;setScreen("list");setRefresh(x=>x+1);
   setMessage(invoice?"Nota e parcelas registradas no D1 local — nenhum crédito confirmado.":
    "Remessa registrada no D1 local — não representa entrega aceita.");
  }catch(err){setError(errorText((err as {status?:number}).status));}
  finally{setPending(false);}
 }
 function startMeta(){if(!detail||!writable)return;
  clear();setMeta(fromRow(detail.item));setScreen("metadata");}
 async function saveMeta(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!detail||pending||!writable)return;
  const id=intention(),record=detail.item;
  const fields=invoice?{numero:nullable(meta.numero),serie:nullable(meta.serie),
   chaveAcesso:nullable(meta.chaveAcesso),emissao:nullable(meta.emissao),
   protocolo:nullable(meta.protocolo),apresentadaEm:nullable(meta.apresentadaEm),
   observacoes:nullable(meta.observacoes)}:
   {situacao:meta.situacao,transportadora:nullable(meta.transportadora),
    codigoRastreio:nullable(meta.codigoRastreio),urlRastreio:nullable(meta.urlRastreio),
    dataDespacho:nullable(meta.dataDespacho),previsaoEntrega:nullable(meta.previsaoEntrega),
    dataEntrega:nullable(meta.dataEntrega),recebedor:nullable(meta.recebedor),
    enderecoEntrega:nullable(meta.enderecoEntrega),observacoes:nullable(meta.observacoes)};
  setPending(true);setError(null);
  if(preview){
   const item:Row={...record,versao:record.versao+1,...(invoice?
    {numero:nullable(meta.numero),serie:nullable(meta.serie),emissao:nullable(meta.emissao)}:
    {situacao:meta.situacao,transportadora:nullable(meta.transportadora),
     codigo_rastreio:nullable(meta.codigoRastreio),data_despacho:nullable(meta.dataDespacho),
     previsao_entrega:nullable(meta.previsaoEntrega),data_entrega:nullable(meta.dataEntrega)})};
   const next={...detail,item};setDetail(next);
   setDemo(old=>({...old,[kind]:old[kind].map(x=>x.item.id===item.id?next:x)}));
   setRows(old=>old.map(x=>x.id===item.id?item:x));setScreen("detail");
   intent.current=null;setPending(false);setMessage("Metadados alterados somente na demonstração.");return;
  }
  try{const result=await mutate(endpoint+"/"+encodeURIComponent(record.id)+"/metadata",
    {intentId:id,expectedVersion:record.versao,...fields},"PATCH");
   if(result.intentId!==id)throw Error("unconfirmed_intent");
   intent.current=null;setScreen("detail");setRefresh(x=>x+1);
   setMessage("Metadados versionados no D1 local.");
  }catch(err){setError(errorText((err as {status?:number}).status));}
  finally{setPending(false);}
 }
 function changeAcceptance(id:string,key:"yes"|"no"|"reason",value:string){
  setAccepted(old=>({...old,[id]:{yes:old[id]?.yes||"0",no:old[id]?.no||"0",
   reason:old[id]?.reason||"",[key]:value}}));
 }
 async function saveAcceptance(lineId:string){
  if(!detail||pending||!writable||invoice)return;
  const item=detail.items.find(x=>x.id===lineId),draft=accepted[lineId];
  if(!item)return;
  const yes=draft?.yes||milText(item.quantidade_aceita_mil??0);
  const no=draft?.no||milText(item.quantidade_recusada_mil??0);
  const qYes=yes==="0"?0:integerMil(yes),qNo=no==="0"?0:integerMil(no);
  const reason=draft?.reason??item.motivo_recusa??"";
  if(qYes===null||qNo===null||qYes+qNo<=0||qYes+qNo>item.quantidade_mil||
   (qNo>0&&reason.trim().length<3)||(qNo===0&&!!reason.trim())){
   setError("Quantidade aceita+recusada não pode superar o envio; recusa exige motivo.");return;}
  const id=intention(),payload={intentId:id,envioId:detail.item.id,envioItemId:item.id,
   expectedVersion:item.versao||1,quantidadeAceitaMil:qYes,quantidadeRecusadaMil:qNo,
   motivoRecusa:qNo>0?reason.trim():null};
  setPending(true);setError(null);
  if(preview){
   const next:Detail={...detail,items:detail.items.map(x=>x.id===lineId?
    {...x,quantidade_aceita_mil:qYes,quantidade_recusada_mil:qNo,
     motivo_recusa:payload.motivoRecusa,versao:(x.versao||1)+1}:x)};
   setDetail(next);setDemo(old=>({...old,shipments:old.shipments.map(x=>x.item.id===detail.item.id?next:x)}));
   intent.current=null;setPending(false);setMessage("Aceite salvo somente na demonstração.");return;
  }
  try{const result=await mutate(endpoint+"/"+encodeURIComponent(detail.item.id)+"/acceptances",payload);
   if(result.intentId!==id)throw Error("unconfirmed_intent");
   intent.current=null;setRefresh(x=>x+1);setMessage("Aceite/recusa registrado na R7 local.");
  }catch(e){setError(errorText((e as {status?:number}).status));}
  finally{setPending(false);}
 }
 async function confirm(){
  if(!detail||pending||!invoice||!writable)return;
  const id=intention(),payload={intentId:id,notaFiscalId:detail.item.id,expectedVersion:detail.item.versao};
  setPending(true);setError(null);
  if(preview){
   const next={...detail,selo:{id:"f6-demo-seal",numero_versao_nf:detail.item.versao,
    valor_documento_cent:detail.item.valor_documento_cent||0}};
   setDetail(next);setDemo(old=>({...old,invoices:old.invoices.map(x=>x.item.id===detail.item.id?next:x)}));
   intent.current=null;setPending(false);setMessage("Conciliação demonstrativa; sem efeito financeiro.");return;
  }
  try{const result=await mutate(endpoint+"/"+encodeURIComponent(detail.item.id)+"/confirm",payload);
   if(result.intentId!==id)throw Error("unconfirmed_intent");
   intent.current=null;setRefresh(x=>x+1);setMessage("Nota conciliada em centavos; crédito ainda não recebido.");
  }catch(e){setError(errorText((e as {status?:number}).status));}
  finally{setPending(false);}
 }
 function startRectify(){
  if(!detail||!invoice||!admin||!detail.selo)return;
  clear();setReason("");setRectLines(detail.items.map(x=>({
   id:x.empenho_item_id||"",quantidade:milText(x.quantidade_mil),
   preco:moneyInput(x.valor_unit_cent)})));
  setRectParcels((detail.parcelas||[]).filter(x=>!x.cancelada)
   .map(x=>moneyInput(x.valor_bruto_cent)).join("; "));setScreen("rectify");
 }
 async function rectify(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!detail||pending||!invoice||!admin)return;
  const items=rectLines.map(x=>({empenhoItemId:x.id,quantidadeMil:integerMil(x.quantidade),
   valorUnitCent:parseMoneyBRL(x.preco)}));
  const total=items.every(x=>x.quantidadeMil!==null&&x.valorUnitCent!==null)?
   lineTotal(items.map(x=>({quantidadeMil:x.quantidadeMil!,valorUnitCent:x.valorUnitCent!}))):null;
  const installment=rectParcels.split(";").map(x=>parseMoneyBRL(x.trim()));
  if(reason.trim().length<5||total===null||installment.length<1||installment.length>12||
   installment.some(x=>x===null)||installment.reduce<number>((sum,x)=>sum+(x||0),0)!==total){
   setError("Informe motivo e itens/parcelas coerentes para retificar.");return;}
  const id=intention(),payload={intentId:id,notaFiscalOriginalId:detail.item.id,
   expectedVersion:detail.item.versao,motivo:reason.trim(),items,parcelasCent:installment};
  setPending(true);setError(null);
  if(preview){
   const old={...detail,item:{...detail.item,situacao:"CANCELADA"}};
   const newer:Detail={...detail,item:{...detail.item,id:"f6-preview-"+crypto.randomUUID(),
    numero:null,situacao:"EMITIDA",versao:1,valor_documento_cent:total},
    items:detail.items.map((x,i)=>({...x,id:"f6-new-item-"+i,
     quantidade_mil:items[i].quantidadeMil!,valor_unit_cent:items[i].valorUnitCent!})),
    parcelas:installment.map((v,i)=>({id:"f6-new-part-"+i,parcela:i+1,
     valor_bruto_cent:v!,cancelada:0,versao:1})),
    selo:{id:"f6-new-seal",numero_versao_nf:1,valor_documento_cent:total}};
   setDemo(s=>({...s,invoices:[newer,...s.invoices.map(x=>x.item.id===old.item.id?old:x)]}));
   setRows(s=>[newer.item,...s.map(x=>x.id===old.item.id?old.item:x)]);
   setDetail(newer);selected.current=newer.item.id;setScreen("detail");
   intent.current=null;setPending(false);setMessage("Retificação fictícia, histórico preservado.");return;
  }
  try{const result=await mutate(endpoint+"/"+encodeURIComponent(detail.item.id)+"/rectify",payload);
   if(result.intentId!==id)throw Error("unconfirmed_intent");
   intent.current=null;setScreen("list");setRefresh(x=>x+1);
   setMessage("Nova nota registrada e vinculada à original. Histórico preservado.");
  }catch(err){setError(errorText((err as {status?:number}).status));}
  finally{setPending(false);}
 }
 if(!company||(!verified&&!preview))return <Card className="f4-unavailable">
  <SectionHeading title="Selecione uma empresa autorizada"/>
  <p>Envios e notas fiscais exigem sessão e empresa ativa.</p>
  <Button onClick={onIdentity}>Abrir identidade</Button></Card>;
 return <div className="f6-page">
  <div className="page-intro"><div><p className="eyebrow">Ciclo comercial · F6 local</p>
   <h1>{label}</h1><p>{invoice?"Faturamento, parcelas e conciliação por empenho.":
   "Remessas fracionadas, rastreamento e aceite/recusa de entrega."}</p></div>
   {invoice?<FileText size={32}/>:<Truck size={32}/>}</div>
  <Notice title={a2SyntheticOrigin(window.location.origin)?"Homologação A2 — envios e notas D1 HML":preview?"Demonstração sintética":"API restrita a Workerd/D1 local"}>
   {a2SyntheticOrigin(window.location.origin)?"Somente registros TESTE -, sem chave fiscal real, rastreio externo, documentos, contatos ou arquivos. Emissões e créditos reais permanecem proibidos; o Worker aplica as permissões.":
    preview?"Demonstração sintética; sem persistência no banco.":
    "Nenhuma API F6 está habilitada em produção. E5/E6 aguardam homologação."}</Notice>
  <div className="f4-company"><span><PackageCheck size={21}/></span><div><small>Empresa ativa</small>
   <strong>{company.name} · {company.role}</strong></div>
   <Button variant="secondary" onClick={onIdentity}>Trocar empresa</Button></div>
  {error&&<div className="f4-error" role="alert">{error}</div>}
  {message&&<div className="f4-success" role="status">{message}</div>}
  {screen!=="list"&&<Button variant="ghost" onClick={back} className="f4-back">
   <ArrowLeft size={16}/> Voltar à lista</Button>}
  {screen==="list"&&<Card className="f4-list">
   <SectionHeading eyebrow="Documentos por empresa" title={label}>
    <Button disabled={!writable||pending} onClick={()=>void start()}><Plus size={15}/>{action}</Button>
   </SectionHeading>
   <div className="f4-filters"><label className="f4-field f6-search"><span>Buscar</span>
    <input type="search" aria-label="Buscar documentos" maxLength={80}
     value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <Button variant="secondary" onClick={()=>setRefresh(v=>v+1)}><RefreshCcw size={15}/>Atualizar</Button></div>
   {loading&&<Skeleton lines={3}/>}
   {!loading&&rows.length===0&&<EmptyState title="Sem registros" message="Não há documentos visíveis."/>}
   {rows.length>0&&<div className="table-scroll"><table className="f4-table"><thead><tr>
    <th>Documento</th><th>Empenho</th><th>Situação</th><th>{invoice?"Valor":"Rastreio"}</th><th>Ficha</th>
   </tr></thead><tbody>{rows.map(x=><tr key={x.id}>
    <td className="f4-name"><strong>{name(x,invoice)}</strong><small>Origem: {x.origem_dado}</small></td>
    <td>{x.empenho_numero||x.empenho_id}</td>
    <td><Badge tone={x.situacao==="CANCELADA"?"warning":"info"}>{x.situacao}</Badge></td>
    <td>{invoice?moneyText(x.valor_documento_cent):(x.codigo_rastreio||"Não informado")}</td>
    <td><Button variant="secondary" onClick={()=>open(x.id)}>Abrir ficha</Button></td>
   </tr>)}</tbody></table></div>}
   {!!cursor&&<div className="f4-pagination"><Button disabled={loading} variant="secondary" onClick={()=>void load(cursor)}>Carregar mais</Button></div>}
  </Card>}
  {screen==="new"&&<Card className="f4-form-card"><SectionHeading eyebrow="Novo documento" title={action}/>
   <form className="f5-form" onSubmit={e=>void create(e)}>
    <label className="f4-field f5-full"><span>Empenho de origem *</span>
     <select required aria-label="Empenho de origem" value={parent} onChange={e=>void selectParent(e.target.value)}>
      <option value="">Selecione</option>
      {parents.map(x=><option key={x.id} value={x.id}>{x.numero}</option>)}</select></label>
    {loading&&<Skeleton lines={3}/>}
    {available&&<div className="f5-full"><p className="f4-note">
      {invoice?"Nota fiscal pode anteceder entrega. Parcelas não são dinheiro recebido.":
       "Só é possível despachar compra confirmada até o saldo quantitativo."}</p>
     <div className="table-scroll"><table className="f4-table f5-balance-table"><thead><tr>
       <th>Item</th><th>Descrição</th><th>Disponível</th><th>Quantidade nova</th>
       {invoice&&<th>Preço unitário R$</th>}</tr></thead>
      <tbody>{available.items.map(x=><tr key={x.id}><td>{x.numero_item}</td>
       <td className="f4-name">{x.descricao_exigida}</td>
       <td>{milText(x.remaining_mil)} {x.unidade}</td>
       <td><input className="f5-cell-input" disabled={!writable||!x.remaining_mil}
        aria-label={"Nova quantidade item "+x.numero_item} value={draft.find(d=>d.id===x.id)?.quantidade||""}
        onChange={e=>changeDraft(x.id,"quantidade",e.target.value)}/></td>
       {invoice&&<td><input className="f5-cell-input" disabled={!writable}
        aria-label={"Preço unitário item "+x.numero_item} value={draft.find(d=>d.id===x.id)?.preco||""}
        onChange={e=>changeDraft(x.id,"preco",e.target.value)}/></td>}</tr>)}</tbody></table></div>
     {invoice&&<label className="f4-field f6-installments"><span>Parcelas R$ — separar por ponto e vírgula</span>
      <input aria-label="Parcelas em R$" placeholder="Vazio = parcela única; exemplo: 100,00; 200,00"
       value={parcels} onChange={e=>setParcels(e.target.value)}/></label>}
    </div>}
    <div className="f4-submit f5-full"><span>Sem emissão fiscal externa, pagamentos ou saldo bancário fictício.</span>
     <Button type="submit" disabled={!writable||pending||!available}>{pending?"Registrando…":action}</Button></div>
   </form>
  </Card>}
  {screen==="detail"&&detail&&<>
   <Card className="f4-detail"><SectionHeading eyebrow="Ficha" title={name(detail.item,invoice)}>
    <Badge tone={detail.item.situacao==="CANCELADA"?"warning":"info"}>{detail.item.situacao}</Badge>
   </SectionHeading>
   <div className="f4-detail-grid"><div><small>Empenho</small><strong>{detail.item.empenho_numero||detail.item.empenho_id}</strong></div>
    <div><small>Versão</small><strong>{detail.item.versao}</strong></div>
    <div><small>Origem</small><strong>{detail.item.origem_dado}</strong></div>
    <div><small>{invoice?"Total faturado":"Entrega"}</small>
     <strong>{invoice?moneyText(detail.item.valor_documento_cent):
      (detail.item.data_entrega||detail.item.previsao_entrega||"Não informada")}</strong></div></div>
   <p className="f4-note">{invoice?
    ("Série: "+(detail.item.serie||"—")+" · emissão: "+(detail.item.emissao||"não informada")+
     " · conciliação: "+(detail.selo?"selada":"pendente")):
    ("Rastreio: "+(detail.item.codigo_rastreio||"não informado")+
     " · transportadora: "+(detail.item.transportadora||"não informada"))}</p>
   <div className="f5-switch"><Button variant="secondary" onClick={startMeta}
     disabled={!writable||detail.item.origem_dado!=="NATIVO"||
      (invoice?!!detail.selo:detail.item.situacao!=="DESPACHADO")}>Editar dados</Button>
    {invoice&&<Button onClick={()=>void confirm()} disabled={!writable||pending||
      !!detail.selo||detail.item.situacao==="CANCELADA"}>Conciliar nota</Button>}
    {invoice&&<Button variant="secondary" onClick={startRectify}
      disabled={!admin||!detail.selo||detail.item.situacao==="CANCELADA"}>Retificar nota (ADMIN)</Button>}
   </div></Card>
   <Card className="f4-section"><SectionHeading title="Itens" eyebrow="Quantidades e conferência"/>
    <div className="table-scroll"><table className="f4-table f5-balance-table"><thead><tr>
     <th>Item</th><th>Descrição</th><th>Quantidade</th>
     {invoice?<th>Valor</th>:<><th>Aceita</th><th>Recusada</th><th>Registrar aceite</th></>}
    </tr></thead><tbody>{detail.items.map(x=><tr key={x.id}><td>{x.numero_item}</td>
     <td className="f4-name">{x.descricao_exigida}</td>
     <td>{milText(x.quantidade_mil)} {x.unidade}</td>
     {invoice?<td>{moneyText(rowAmount(x.quantidade_mil,x.valor_unit_cent||0))}</td>:<>
      <td>{milText(x.quantidade_aceita_mil)}</td><td>{milText(x.quantidade_recusada_mil)}
       <small>{x.motivo_recusa&&" · "+x.motivo_recusa}</small></td>
      <td><div className="f6-accept">
       <input className="f5-cell-input" aria-label={"Aceita item "+x.numero_item}
        value={accepted[x.id]?.yes??milText(x.quantidade_aceita_mil??0)}
        onChange={e=>changeAcceptance(x.id,"yes",e.target.value)}
        disabled={!writable||detail.item.situacao!=="DESPACHADO"}/>
       <input className="f5-cell-input" aria-label={"Recusada item "+x.numero_item}
        value={accepted[x.id]?.no??milText(x.quantidade_recusada_mil??0)}
        onChange={e=>changeAcceptance(x.id,"no",e.target.value)}
        disabled={!writable||detail.item.situacao!=="DESPACHADO"}/>
       <input aria-label={"Motivo de recusa item "+x.numero_item} placeholder="Motivo se recusada"
        value={accepted[x.id]?.reason??x.motivo_recusa??""}
        onChange={e=>changeAcceptance(x.id,"reason",e.target.value)}
        disabled={!writable||detail.item.situacao!=="DESPACHADO"}/>
       <Button variant="secondary" onClick={()=>void saveAcceptance(x.id)}
        disabled={!writable||pending||detail.item.situacao!=="DESPACHADO"}>Salvar aceite</Button>
      </div></td></>}</tr>)}</tbody></table></div>
    {!invoice&&<p className="f4-note">Aceite e recusa são totais acumulados por item, não adições sucessivas.</p>}
   </Card>
   {invoice&&<Card className="f4-section"><SectionHeading title="Parcelas" eyebrow="Cobrança a receber — não é crédito"/>
    <div className="table-scroll"><table className="f4-table"><thead><tr><th>Parcela</th><th>Valor</th><th>Estado</th></tr></thead>
    <tbody>{(detail.parcelas||[]).map(x=><tr key={x.id}><td>{x.parcela}</td>
     <td>{moneyText(x.valor_bruto_cent)}</td><td>{x.cancelada?"Cancelada":"A receber"}</td></tr>)}</tbody></table></div>
    {detail.retificacoes?.map(x=><p className="f4-note" key={x.nota_substituta_id}>
     Retificação: {x.nota_original_id} → {x.nota_substituta_id} ({x.motivo})</p>)}
   </Card>}
  </>}
  {screen==="metadata"&&detail&&<Card className="f4-form-card">
   <SectionHeading title={invoice?"Identificação fiscal":"Despacho e entrega"} eyebrow="Edição versionada"/>
   <form className="f5-form" onSubmit={e=>void saveMeta(e)}>
    {!invoice&&<label className="f4-field"><span>Situação</span>
     <select value={meta.situacao} onChange={e=>setMeta(x=>({...x,situacao:e.target.value}))}>
      <option value="DESPACHADO">Despachado</option>
      <option value="ENTREGUE">Entregue (aceite completo obrigatório)</option></select></label>}
    {(invoice?([["numero","Número da NF"],["serie","Série"],["chaveAcesso","Chave de acesso"],
     ["emissao","Data de emissão"],["protocolo","Protocolo"],["apresentadaEm","Data de apresentação"],
     ["observacoes","Observações"]] as const):([["transportadora","Transportadora"],
     ["codigoRastreio","Código de rastreio"],["urlRastreio","Rastreio HTTPS"],
     ["dataDespacho","Data de despacho"],["previsaoEntrega","Previsão de entrega"],
     ["dataEntrega","Data da entrega"],["recebedor","Recebedor"],
     ["enderecoEntrega","Endereço de entrega"],["observacoes","Observações"]] as const))
    .map(([field,title])=><label className="f4-field" key={field}><span>{title}</span>
     <input aria-label={title} type={["emissao","apresentadaEm","dataDespacho","previsaoEntrega",
      "dataEntrega"].includes(field)?"date":"text"} value={meta[field]}
      onChange={e=>setMeta(x=>({...x,[field]:e.target.value}))}/></label>)}
    <div className="f4-submit f5-full"><span>CAS, journal e auditoria D1 local.</span>
     <Button disabled={!writable||pending} type="submit">Salvar metadados</Button></div>
   </form></Card>}
  {screen==="rectify"&&detail&&invoice&&<Card className="f4-form-card">
   <SectionHeading title="Retificar nota conciliada" eyebrow="ADMIN · histórico imutável"/>
   <Notice title="Sem apagar o passado">Retificação cria nova nota, itens e parcelas e preserva a original.</Notice>
   <form className="f5-form" onSubmit={e=>void rectify(e)}>
    <label className="f4-field f5-full"><span>Motivo obrigatório</span><textarea
     aria-label="Motivo da retificação" required maxLength={2000} value={reason}
     onChange={e=>setReason(e.target.value)}/></label>
    <div className="f5-full table-scroll"><table className="f4-table"><thead>
     <tr><th>Item</th><th>Quantidade retificada</th><th>Preço unitário R$</th></tr></thead>
     <tbody>{rectLines.map((x,i)=><tr key={x.id}><td>{detail.items[i]?.numero_item||i+1}</td>
      <td><input className="f5-cell-input" aria-label={"Quantidade retificada item "+(i+1)}
       value={x.quantidade} onChange={e=>setRectLines(v=>v.map(a=>a.id===x.id?{...a,quantidade:e.target.value}:a))}/></td>
      <td><input className="f5-cell-input" aria-label={"Preço retificado item "+(i+1)}
       value={x.preco} onChange={e=>setRectLines(v=>v.map(a=>a.id===x.id?{...a,preco:e.target.value}:a))}/></td>
      </tr>)}</tbody></table></div>
    <label className="f4-field f5-full"><span>Parcelas retificadas R$ (separadas por ponto e vírgula)</span>
     <input aria-label="Parcelas retificadas" value={rectParcels}
      onChange={e=>setRectParcels(e.target.value)}/></label>
    <div className="f4-submit f5-full"><span>Bloqueada se já houver recebimentos.</span>
     <Button type="submit" disabled={!admin||pending}>Retificar preservando histórico</Button></div>
   </form></Card>}
 </div>;
}
