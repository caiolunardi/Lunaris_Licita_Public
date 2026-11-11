import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {a2SyntheticIntent,a2SyntheticHeaders} from "../hml/a2-synthetic";
import {ArrowLeft,ArrowRight,Box,Building2,ClipboardList,
 Plus,RefreshCcw,Search,ShieldAlert,ShoppingCart,Truck} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {parseMoneyBRL} from "../finance/types";
import {integerMil,milToText} from "../tenders/types";
import {blankLine,moneyText,sumValue,type CommercialProps,type Kind,
 type Detail,type RecordRow,type ParentAvailable,type ParentOption,
 type Supplier,type DraftLine} from "./types";
import {demoCommercial,demoSuppliers,demoParents,demoAvailable,type DemoState} from "./fixtures";

const isRecord=(x:unknown):x is RecordRow=>{
 const r=x as Partial<RecordRow>|null;
 return !!r&&typeof r.id==="string"&&typeof r.versao==="number"&&
  typeof r.situacao==="string"&&typeof r.origem_dado==="string";
};
const isDetail=(x:unknown):x is Detail=>{
 const d=x as Partial<Detail>|null;
 return !!d&&isRecord(d.item)&&Array.isArray(d.items);
};
const isAvailable=(x:unknown):x is ParentAvailable=>{
 const d=x as Partial<ParentAvailable>|null;
 return !!d&&!!d.parent&&typeof d.parent.id==="string"&&
  Number.isSafeInteger(d.parent.versao)&&Array.isArray(d.items)&&
  d.items.length<=100&&d.items.every(y=>typeof y.id==="string"&&
    typeof y.remaining_mil==="number"&&y.remaining_mil>=0&&
    Number.isSafeInteger(y.remaining_mil));
};
const errors=(n:number|undefined)=>{
 if(n===401)return "Sessão expirada. Confirme sua identidade novamente.";
 if(n===403)return "Você não tem autorização para esta empresa ou operação.";
 if(n===404)return "Registro ou item indisponível sob suas permissões.";
 if(n===409)return "Conflito de quantidade, versão ou intenção. Confira os saldos e recarregue antes de repetir.";
 if(n===400||n===413||n===415)return "Revise quantidade, valor, campos e limites.";
 return "Serviço indisponível ou resposta incerta. Recarregue e confira se o registro existe antes de repetir a ação.";
};
const names={commitments:{title:"Empenhos",singular:"Empenho",parent:"Licitação",
 action:"Registrar empenho",description:"Do item ganho ao compromisso formal — com saldo quantitativo verificável.",
 partner:"Órgão"},purchases:{title:"Compras",singular:"Compra",parent:"Empenho",
 action:"Registrar compra",description:"Controle os pedidos aos fornecedores sem comprar acima do empenhado.",
 partner:"Fornecedor"}} as const;
const demoId=()=>crypto.randomUUID();
const parseCents=(raw:string)=>{
 const n=parseMoneyBRL(raw);
 return n!==null&&n>0?n:null;
};
type CostForm={frete:string;outros:string;condicao:string;dataCompra:string;previsaoDespacho:string;previsaoEntrega:string};
const blankCosts=():CostForm=>({frete:"0,00",outros:"0,00",condicao:"",dataCompra:"",previsaoDespacho:"",previsaoEntrega:""});
const cents=(v:number|null|undefined)=>v==null?"0,00":(v/100).toFixed(2).replace(".",",");
const costValue=(v:string):number|null=>{
 const x=v.trim();
 return !x||/^0+(?:,0{1,2})?$/.test(x)?0:parseCents(x);
};
const displayName=(row:RecordRow)=>row.numero||row.numero_pedido||"Registro sem número";
const isWriteable=(kind:Kind,a:ParentAvailable)=>a.parent.origem_dado==="NATIVO"&&
 (kind==="commitments"?!a.parent.encerrada_em&&a.parent.situacao_participacao!=="CANCELADA":
 a.parent.situacao==="CONFIRMADO");
export default function CommercialPage({kind,identity,onIdentity,onNavigate}:CommercialProps){
 const company=identity.active,verified=identity.stage==="verified"&&identity.source==="server"&&!!company;
 const demo=identity.stage==="preview"&&identity.source==="fixture"&&!!company;
 const ready=verified||demo,canWrite=!!company?.permissions.canWrite;
 const label=names[kind];
 const root="/api/v1/companies/"+encodeURIComponent(company?.id||"none");
 const endpoint=root+"/commercial/"+kind;
 const [demoState,setDemoState]=useState<DemoState>(()=>demoCommercial(company?.id||""));
 const [records,setRecords]=useState<RecordRow[]>(()=>demoCommercial(company?.id||"")[kind].map(x=>x.item));
 const [selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<Detail|null>(null);
 const [screen,setScreen]=useState<"list"|"detail"|"new"|"costs">("list");
 const [search,setSearch]=useState(""),[query,setQuery]=useState("");
 const [cursor,setCursor]=useState<string|null>(null);
 const [parents,setParents]=useState<ParentOption[]>(()=>demoParents(company?.id||"",kind,demoState));
 const [supplierList,setSupplierList]=useState<Supplier[]>(()=>demoSuppliers(company?.id||""));
 const [parentId,setParentId]=useState(""),[available,setAvailable]=useState<ParentAvailable|null>(null);
 const [draft,setDraft]=useState<DraftLine[]>([]),[numero,setNumero]=useState("");
 const [supplierId,setSupplierId]=useState("");
 const [costs,setCosts]=useState<CostForm>(blankCosts);
 const [loading,setLoading]=useState(false),[pending,setPending]=useState(false);
 const [error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const [refresh,setRefresh]=useState(0);
 const seq=useRef(0),parentSeq=useRef(0),intent=useRef<string|null>(null);
 const selectedNow=useRef<string|null>(null);
 const fetchJSON=useCallback(async<T,>(path:string,signal?:AbortSignal):Promise<T>=>{
  const res=await fetch(path,{credentials:"same-origin",cache:"no-store",
   signal,headers:{"accept":"application/json"}});
  if(!res.ok)throw Object.assign(new Error("http"),{status:res.status});
  return res.json() as Promise<T>;
 },[]);
 const loadList=useCallback(async(next:string|null=null)=>{
  if(!verified)return;
  const current=++seq.current;
  setLoading(true);setError(null);
  if(!next){setRecords([]);setCursor(null);}
  const params=new URLSearchParams({limit:"25"});
  if(query)params.set("q",query.slice(0,80));
  if(next)params.set("after",next);
  try{
   const result=await fetchJSON<{items:unknown[];nextCursor:string|null}>(endpoint+"?"+params);
   if(!Array.isArray(result.items)||result.items.length>25||
      !result.items.every(isRecord)||!((typeof result.nextCursor==="string")||result.nextCursor===null))
    throw new Error("invalid_commercial_contract");
   if(current===seq.current){
    setRecords(old=>next?[...old,...result.items as RecordRow[]]:result.items as RecordRow[]);
    setCursor(result.nextCursor);
   }
  }catch(e){if(current===seq.current)setError(errors((e as {status?:number}).status));}
  finally{if(current===seq.current)setLoading(false);}
 },[verified,query,fetchJSON,endpoint]);
 const loadDetail=useCallback(async(id:string)=>{
  if(!verified)return;
  const current=++seq.current;setLoading(true);setDetail(null);setError(null);
  try{
   const result=await fetchJSON<unknown>(endpoint+"/"+encodeURIComponent(id));
   if(!isDetail(result))throw new Error("invalid_detail_contract");
   if(current===seq.current&&selectedNow.current===id)setDetail(result);
  }catch(e){if(current===seq.current)setError(errors((e as {status?:number}).status));}
  finally{if(current===seq.current)setLoading(false);}
 },[verified,endpoint,fetchJSON]);
 useEffect(()=>{const t=setTimeout(()=>setQuery(search.trim()),220);return()=>clearTimeout(t);},[search]);
 useEffect(()=>{if(verified&&screen==="list")void loadList();return()=>{seq.current++;};},
  [verified,screen,loadList,refresh]);
 useEffect(()=>{if(verified&&screen==="detail"&&selected)void loadDetail(selected);return()=>{seq.current++;};},
  [verified,screen,selected,loadDetail,refresh]);
 const reset=()=>{intent.current=null;setError(null);setNotice(null);};
 const back=()=>{selectedNow.current=null;setSelected(null);setDetail(null);setScreen("list");reset();};
 function open(id:string){
  reset();selectedNow.current=id;setSelected(id);setScreen("detail");
  if(demo)setDetail(demoState[kind].find(x=>x.item.id===id)||null);
 }
 async function start(){
  if(!canWrite)return;
  reset();setNumero("");setParentId("");setAvailable(null);setDraft([]);
  setSupplierId("");setParents([]);setSupplierList([]);setScreen("new");
  if(demo){
   setParents(demoParents(company!.id,kind,demoState));
   setSupplierList(demoSuppliers(company!.id));return;
  }
  setLoading(true);
  try{
   const parentURL=kind==="commitments"?root+"/licitacoes?limit=50&state=active":
     root+"/commercial/commitments?limit=50";
   const options=await fetchJSON<{items:unknown[]}>(parentURL);
   if(!Array.isArray(options.items)||options.items.length>50)
    throw new Error("invalid_options");
   const list:ParentOption[]=options.items.map(raw=>{
    const t=raw as RecordRow&{orgao_nome?:string};
    if(!isRecord(t))throw new Error("invalid_option");
    return {id:t.id,numero:displayName(t),versao:t.versao,
     label:displayName(t)+" · "+(t.orgao_nome||t.licitacao_numero||"Processo")};
   });
   setParents(list);
   if(kind==="purchases"){
    const suppliers=await fetchJSON<{items:unknown[]}>(root+"/fornecedores?state=active&limit=50");
    if(!Array.isArray(suppliers.items)||suppliers.items.length>50)throw new Error("invalid_suppliers");
    setSupplierList(suppliers.items.map(raw=>{
     const s=raw as Supplier;
     if(typeof s?.id!=="string"||typeof s?.nome!=="string")throw new Error("invalid_supplier");
     return {id:s.id,nome:s.nome,ativo:s.ativo};
    }));
   }
  }catch(e){setError(errors((e as {status?:number}).status));}
  finally{setLoading(false);}
 }
 async function selectParent(id:string){
  parentSeq.current++;
  setParentId(id);setAvailable(null);setDraft([]);reset();
  if(!id)return;
  if(demo){
   const a=demoAvailable(company!.id,kind,id,demoState);
   setAvailable(a);setDraft(a?.items.map(blankLine)||[]);return;
  }
  const generation=parentSeq.current;
  setLoading(true);
  const location=kind==="commitments"?root+"/commercial/tenders/"+encodeURIComponent(id)+"/available":
    root+"/commercial/commitments/"+encodeURIComponent(id)+"/available";
  try{
   const a=await fetchJSON<unknown>(location);
   if(!isAvailable(a))throw new Error("invalid_available");
   if(generation===parentSeq.current){setAvailable(a);setDraft(a.items.map(blankLine));}
  }catch(e){if(generation===parentSeq.current)setError(errors((e as {status?:number}).status));}
  finally{if(generation===parentSeq.current)setLoading(false);}
 }
 const update=(id:string,k:"quantity"|"price",value:string)=>setDraft(xs=>
  xs.map(x=>x.id===id?{...x,[k]:value}:x));
 const rows=available?.items||[];
 const selectedLines=rows.flatMap(row=>{
  const value=draft.find(x=>x.id===row.id);
  const q=value?.quantity.trim()?integerMil(value.quantity):null;
  const price=value?.price.trim()?parseCents(value.price):null;
  return q!==null&&price!==null?[{parentItemId:row.id,quantidadeMil:q,valorUnitCent:price}]:[];
 });
 const total=sumValue(selectedLines.map(x=>({quantidade_mil:x.quantidadeMil,valor_unit_cent:x.valorUnitCent})));
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(pending||!canWrite||!available||!isWriteable(kind,available))return;
  if(!numero.trim()||!parentId||(kind==="purchases"&&!supplierId)){
   setError("Informe número, origem e fornecedor quando for uma compra.");return;
  }
  const lines:typeof selectedLines=[];
  for(const row of rows){
   const x=draft.find(a=>a.id===row.id);
   if(!x?.quantity.trim())continue;
   const q=integerMil(x.quantity),price=parseCents(x.price);
   if(q===null||price===null||q>row.remaining_mil){
    setError("Informe quantidade positiva até o saldo disponível e preço unitário válido.");
    return;
   }
   lines.push({parentItemId:row.id,quantidadeMil:q,valorUnitCent:price});
  }
  if(lines.length===0||lines.length>20){setError("Selecione entre 1 e 20 itens com quantidade.");return;}
  const id=intent.current||a2SyntheticIntent(crypto.randomUUID());intent.current=id;
  const payload={intentId:id,parentId,expectedParentVersion:available.parent.versao,
   numero:numero.trim(),items:lines,...(kind==="purchases"?{fornecedorId:supplierId}:{})};
  setPending(true);setError(null);setNotice(null);
  if(demo){
   const idNew="f5-demo-new-"+demoId(),supplier=demoSuppliers(company!.id).find(x=>x.id===supplierId);
   const parent=parents.find(x=>x.id===parentId);
   const data:RecordRow=kind==="commitments"?
    {id:idNew,numero:numero.trim(),licitacao_id:parentId,
     licitacao_numero:parent?.numero||"",orgao_nome:"Órgão fictício",situacao:"CONFIRMADO",
     versao:1,origem_dado:"NATIVO",conferencia:"VALIDADO"}:
    {id:idNew,numero:numero.trim(),numero_pedido:numero.trim(),empenho_id:parentId,
     empenho_numero:parent?.numero||"",fornecedor_id:supplierId,fornecedor_nome:supplier?.nome||"",
     situacao:"CONFIRMADA",versao:1,origem_dado:"NATIVO",conferencia:"VALIDADO"};
   const entries:Detail["items"]=lines.map((x,i)=>{
    const item=rows.find(y=>y.id===x.parentItemId)!;
    return kind==="commitments"?{
     id:idNew+"-"+i,empenho_id:idNew,licitacao_item_id:item.id,
     numero_item:item.numero_item,descricao_exigida:item.descricao_exigida,unidade:item.unidade,
     quantidade_ganha_mil:item.quantidade_ganha_mil||0,resultado:"GANHO",
     quantidade_mil:x.quantidadeMil,valor_unit_cent:x.valorUnitCent,versao:1,origem_dado:"NATIVO"
    }:{
     id:idNew+"-"+i,compra_id:idNew,empenho_item_id:item.id,
     licitacao_item_id:"demo-linked-item",numero_item:item.numero_item,
     descricao_exigida:item.descricao_exigida,unidade:item.unidade,
     quantidade_mil:x.quantidadeMil,valor_unit_cent:x.valorUnitCent,versao:1,origem_dado:"NATIVO"
    };
   });
   const detailNew:Detail={item:data,items:entries};
   setDemoState(old=>({...old,[kind]:[detailNew,...old[kind]]}));
   setRecords(old=>[data,...old]);setSelected(idNew);selectedNow.current=idNew;
   setDetail(detailNew);setScreen("detail");intent.current=null;
   setNotice("Registro criado apenas na demonstração. Não existe empenho ou compra real.");
   setPending(false);return;
  }
  try{
   const res=await fetch(endpoint,{method:"POST",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json","accept":"application/json",...a2SyntheticHeaders()},
    body:JSON.stringify(payload)});
   if(!res.ok)throw Object.assign(new Error("post_failed"),{status:res.status});
   const data=await res.json() as {intentId?:string;empenhoId?:string;compraId?:string;replayed?:boolean};
   if(data.intentId!==id)throw new Error("intent_unconfirmed");
   intent.current=null;
   const createdId=data.empenhoId||data.compraId;
   setScreen("list");setSelected(null);setDetail(null);setRefresh(v=>v+1);
   setNotice(data.replayed?"Intenção anterior reconhecida; consulte a lista.":
    (kind==="commitments"?"Empenho confirmado pela R7.":"Compra confirmada pela R7.")+
    (createdId?" Registro "+createdId:"")+
    " Nenhum boleto ou nota foi criado automaticamente.");
  }catch(err){setError(errors((err as {status?:number}).status));}
  finally{setPending(false);}
 }
 function beginCosts(){
  if(!canWrite||!detail||kind!=="purchases"||detail.item.origem_dado!=="NATIVO")return;
  const x=detail.item;
  setCosts({frete:cents(x.frete_cent),outros:cents(x.outros_custos_cent),
   condicao:x.condicao_pagamento||"",dataCompra:x.data_compra||"",
   previsaoDespacho:x.previsao_despacho||"",previsaoEntrega:x.previsao_entrega||""});
  intent.current=null;setError(null);setNotice(null);setScreen("costs");
 }
 async function submitCosts(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(pending||!canWrite||!detail||kind!=="purchases")return;
  const frete=costValue(costs.frete),outros=costValue(costs.outros);
  if(frete===null||outros===null){setError("Frete e outros custos devem ser valores monetários válidos.");return;}
  const intentId=intent.current||a2SyntheticIntent(crypto.randomUUID());intent.current=intentId;
  const payload={intentId,expectedVersion:detail.item.versao,
   freteCent:frete,outrosCustosCent:outros,condicaoPagamento:costs.condicao.trim()||null,
   dataCompra:costs.dataCompra||null,previsaoDespacho:costs.previsaoDespacho||null,
   previsaoEntrega:costs.previsaoEntrega||null};
  setPending(true);setError(null);setNotice(null);
  if(demo){
   const updated={...detail.item,versao:detail.item.versao+1,frete_cent:frete,
    outros_custos_cent:outros,condicao_pagamento:payload.condicaoPagamento,
    data_compra:payload.dataCompra,previsao_despacho:payload.previsaoDespacho,
    previsao_entrega:payload.previsaoEntrega};
   setDemoState(old=>({...old,purchases:old.purchases.map(row=>
    row.item.id===updated.id?{...row,item:updated}:row)}));
   setDetail({...detail,item:updated});setRecords(prev=>prev.map(x=>x.id===updated.id?updated:x));
   intent.current=null;setScreen("detail");setPending(false);
   setNotice("Custos alterados apenas na demonstração, sem boleto ou pagamento.");return;
  }
  try{
   const response=await fetch(endpoint+"/"+encodeURIComponent(detail.item.id),{
    method:"PATCH",credentials:"same-origin",cache:"no-store",
    headers:{"content-type":"application/json","accept":"application/json",...a2SyntheticHeaders()},
    body:JSON.stringify(payload)});
   if(!response.ok)throw Object.assign(new Error("cost_failed"),{status:response.status});
   const result=await response.json() as {intentId?:string;replayed?:boolean};
   if(result.intentId!==intentId)throw new Error("intent_unconfirmed");
   intent.current=null;setScreen("detail");setRefresh(n=>n+1);
   setNotice(result.replayed?"Reenvio da intenção anterior reconhecido.":
    "Custos e prazos confirmados no D1 local, com auditoria e sem emitir boleto.");
  }catch(error){setError(errors((error as {status?:number}).status));}
  finally{setPending(false);}
 }
 const displayed=demo?records.filter(x=>displayName(x).toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))):records;
 const chosen=detail?.item;
 return <div className="f5-page">
  <div className="page-intro">
   <div><p className="eyebrow">F5 · Operação comercial</p><h1>{label.title}</h1>
    <p>{label.description}</p></div>
   <span className="intro-decoration" aria-hidden="true">{kind==="commitments"?<ClipboardList size={34}/>:<ShoppingCart size={34}/>}</span>
  </div>
  <Notice title={demo?"Demonstração sintética; sem persistência":verified?"Operações protegidas no D1 local":"Acesso protegido"}>
   {demo?"Estes registros são fictícios e as ações existem somente na memória do navegador. Não criam dinheiro, boleto ou NF.":
    verified?"O servidor confere empresa, JWT, ACL e quantidade restante antes de confirmar uma operação.":
    "Selecione uma empresa autorizada em Identidade e acesso para visualizar compromissos."}
  </Notice>
  {!ready?<Card className="f4-unavailable"><ShieldAlert size={25}/><h2>Selecione uma empresa autorizada</h2>
   <p>Os compromissos só são carregados após validar identidade e empresa.</p>
   <Button onClick={onIdentity}>Identidade e acesso <ArrowRight size={16}/></Button></Card>:<>
   <div className="f4-company"><span>{kind==="commitments"?<Building2 size={19}/>:<Truck size={19}/>}</span>
    <div><small>Empresa ativa</small><strong>{company!.name}</strong></div>
    <Badge tone={demo?"warning":"info"}>{demo?"Exemplo":"D1 local"}</Badge>
    <Button variant="ghost" onClick={onIdentity}>Trocar empresa</Button>
   </div>
   <div className="f5-switch" aria-label="Fluxo operacional">
    <Button variant={kind==="commitments"?"secondary":"ghost"} onClick={()=>onNavigate("commitments")}>
     <ClipboardList size={16}/> Empenhos</Button>
    <Button variant={kind==="purchases"?"secondary":"ghost"} onClick={()=>onNavigate("purchases")}>
     <ShoppingCart size={16}/> Compras</Button>
   </div>
   {error&&<p role="alert" className="f4-error">{error}</p>}
   {notice&&<p role="status" className="f4-success">{notice}</p>}
   {screen!=="list"&&<div className="f4-back"><Button variant="ghost" onClick={back} disabled={pending}>
    <ArrowLeft size={16}/> Voltar à lista</Button></div>}
   {screen==="list"&&<Card className="f4-list">
    <SectionHeading eyebrow="Documentos vinculados à origem" title={label.title+" cadastrados"}>
     <Button onClick={()=>void start()} disabled={!canWrite}><Plus size={16}/>{label.action}</Button>
    </SectionHeading>
    <div className="f4-filters">
     <label className="f4-search"><Search size={16}/><input type="search" aria-label={"Buscar "+label.title.toLowerCase()}
      value={search} onChange={e=>setSearch(e.target.value)}
      placeholder="Buscar número do documento" maxLength={80}/></label>
     <Button variant="ghost" onClick={()=>setRefresh(n=>n+1)} disabled={loading}>
      <RefreshCcw size={15}/> Atualizar</Button>
    </div>
    {loading?<Skeleton lines={4}/>:displayed.length===0?
     <EmptyState title={"Nenhum "+label.singular.toLowerCase()+" encontrado"}
      message="Cadastre a operação a partir de uma origem com quantidade disponível."/>:
     <div className="table-scroll"><table className="f4-table"><thead><tr>
      <th>Documento</th><th>Origem</th><th>{label.partner}</th><th>Estado</th><th>Ficha</th>
     </tr></thead><tbody>{displayed.map(x=><tr key={x.id}>
      <td><strong>{displayName(x)}</strong></td>
      <td>{kind==="commitments"?x.licitacao_numero:x.empenho_numero}</td>
      <td>{kind==="commitments"?x.orgao_nome:x.fornecedor_nome}</td>
      <td><Badge tone="success">{x.situacao}</Badge></td>
      <td><Button variant="secondary" onClick={()=>open(x.id)}>Abrir ficha</Button></td>
     </tr>)}</tbody></table></div>}
    {!demo&&cursor&&<div className="f4-pagination">
     <Button variant="secondary" onClick={()=>void loadList(cursor)} disabled={loading}>Carregar mais</Button>
    </div>}
    <p className="f4-note">Máximo de 25 documentos por página. Não exibe valores ou documentos restritos por ACL.</p>
   </Card>}
   {screen==="detail"&&<>{loading?<Card><Skeleton lines={4}/></Card>:chosen&&detail?
    <Card className="f4-detail">
     <SectionHeading eyebrow={"F5 · "+label.singular+" confirmado"} title={displayName(chosen)}>
      <Badge tone="success">{chosen.situacao}</Badge></SectionHeading>
     <div className="f4-detail-grid">
      <div><small>Origem</small><strong>{kind==="commitments"?chosen.licitacao_numero:chosen.empenho_numero}</strong></div>
      <div><small>{label.partner}</small><strong>{kind==="commitments"?chosen.orgao_nome:chosen.fornecedor_nome}</strong></div>
      <div><small>Itens</small><strong>{detail.items.length}</strong></div>
      <div><small>Total dos itens</small><strong>{moneyText(sumValue(detail.items))}</strong></div>
     </div>
     <SectionHeading eyebrow="Quantidades consolidadas" title="Itens do documento"/>
     <div className="table-scroll"><table className="f4-table"><thead><tr>
      <th>Número</th><th>Descrição</th><th>Quantidade</th><th>Preço unitário</th><th>Total</th>
     </tr></thead><tbody>{detail.items.map(item=><tr key={item.id}>
      <td>{item.numero_item}</td><td className="f4-name">{item.descricao_exigida}</td>
      <td>{milToText(item.quantidade_mil)} {item.unidade}</td>
      <td>{moneyText(item.valor_unit_cent)}</td>
      <td>{moneyText(sumValue([item]))}</td>
     </tr>)}</tbody></table></div>
     {kind==="purchases"&&<section className="f5-cost-summary" aria-label="Custos da compra">
      <div className="f4-detail-grid">
       <div><small>Frete</small><strong>{moneyText(chosen.frete_cent)}</strong></div>
       <div><small>Outros custos</small><strong>{moneyText(chosen.outros_custos_cent)}</strong></div>
       <div><small>Pagamento</small><strong>{chosen.condicao_pagamento||"Não informado"}</strong></div>
       <div><small>Entrega prevista</small><strong>{chosen.previsao_entrega||"Não informada"}</strong></div>
      </div>
      {canWrite&&chosen.origem_dado==="NATIVO"&&<Button variant="secondary" onClick={beginCosts}>Editar custos e prazos</Button>}
     </section>}
     <p className="f4-note">A confirmação comercial não emite boletos, notas fiscais nem recebíveis automaticamente. Entregas e faturamento entram na F6.</p>
     {chosen.origem_dado==="LEGADO"&&<p className="f4-warning">Dados históricos: sem alteração direta até reconciliação do legado.</p>}
    </Card>:<Card><EmptyState title="Documento indisponível" message="Confira sua autorização e atualize a ficha."/></Card>}</>}
   {screen==="costs"&&kind==="purchases"&&<Card className="f4-form-card">
    <SectionHeading eyebrow="F5 · Reavaliação auditável" title="Custos e prazos da compra"/>
    <Notice title="Custo não é quitação">Estes campos não geram boleto, título a pagar, pagamento nem nota fiscal.</Notice>
    <form className="f5-form" onSubmit={e=>void submitCosts(e)}>
     <label className="f4-field"><span>Frete R$ *</span><input aria-label="Frete R$ *"
      required value={costs.frete} onChange={e=>setCosts(v=>({...v,frete:e.target.value}))}/></label>
     <label className="f4-field"><span>Outros custos R$ *</span><input aria-label="Outros custos R$ *"
      required value={costs.outros} onChange={e=>setCosts(v=>({...v,outros:e.target.value}))}/></label>
     <label className="f4-field"><span>Condição de pagamento</span><input aria-label="Condição de pagamento"
      maxLength={300} value={costs.condicao} onChange={e=>setCosts(v=>({...v,condicao:e.target.value}))}/></label>
     <label className="f4-field"><span>Data da compra</span><input aria-label="Data da compra" type="date"
      value={costs.dataCompra} onChange={e=>setCosts(v=>({...v,dataCompra:e.target.value}))}/></label>
     <label className="f4-field"><span>Previsão de despacho</span><input aria-label="Previsão de despacho" type="date"
      value={costs.previsaoDespacho} onChange={e=>setCosts(v=>({...v,previsaoDespacho:e.target.value}))}/></label>
     <label className="f4-field"><span>Previsão de entrega</span><input aria-label="Previsão de entrega" type="date"
      value={costs.previsaoEntrega} onChange={e=>setCosts(v=>({...v,previsaoEntrega:e.target.value}))}/></label>
     <div className="f4-submit f5-full"><span>Revisão CAS da versão {detail?.item.versao}. Não altera fornecedor nem quantidades.</span>
      <Button type="submit" disabled={!canWrite||pending}>{pending?"Salvando…":"Salvar custos e prazos"}</Button>
     </div>
    </form>
   </Card>}
   {screen==="new"&&<Card className="f4-form-card">
    <SectionHeading eyebrow={"Novo "+label.singular.toLowerCase()+" · registrado pela R7"}
     title={label.action}><Badge tone="info">Saldo validado no D1</Badge></SectionHeading>
    <form className="f5-form" onSubmit={e=>void submit(e)}>
     <label className="f4-field"><span>{label.parent} de origem *</span>
      <select aria-label={label.parent+" de origem *"} required value={parentId}
       onChange={e=>void selectParent(e.target.value)}>
       <option value="">Selecione {kind==="commitments"?"a licitação":"o empenho"}</option>
       {parents.map(p=><option value={p.id} key={p.id}>{p.label}</option>)}</select>
     </label>
     <label className="f4-field"><span>Número {kind==="purchases"?"da compra":"do empenho"} *</span>
      <input aria-label={"Número "+(kind==="purchases"?"da compra":"do empenho")+" *"} value={numero} required
       onChange={e=>setNumero(e.target.value)} maxLength={100} autoComplete="off"
       placeholder={kind==="commitments"?"Ex.: NE 2027/041":"Ex.: PED 2027/015"}/>
     </label>
     {kind==="purchases"&&<label className="f4-field"><span>Fornecedor ativo *</span>
      <select aria-label="Fornecedor ativo *" value={supplierId} required
       onChange={e=>setSupplierId(e.target.value)}>
       <option value="">Selecione fornecedor</option>{supplierList.map(s=><option value={s.id} key={s.id}>{s.nome}</option>)}
      </select></label>}
     {loading&&<div className="f5-full"><Skeleton lines={3}/></div>}
     {available&&<section className="f5-full" aria-label="Saldos quantitativos">
      <div className="f5-source"><Box size={18}/><div>
       <strong>Origem: {available.parent.numero}</strong><small>Versão {available.parent.versao} · Quantidades expressas com até três casas decimais</small>
      </div></div>
      {!isWriteable(kind,available)&&<p className="f4-error">Origem histórica, encerrada ou não confirmada. Não é possível criar novos compromissos.</p>}
      <div className="table-scroll"><table className="f4-table f5-balance-table"><thead><tr>
       <th>Item</th><th>Descrição</th><th>{kind==="commitments"?"Ganho":"Empenhado"}</th>
       <th>{kind==="commitments"?"Já empenhado":"Já comprado"}</th><th>Disponível</th>
       <th>Nova quantidade</th><th>Valor unitário (R$)</th>
      </tr></thead><tbody>{rows.map(item=>{
       const line=draft.find(x=>x.id===item.id)||blankLine(item);
       const won=item.quantidade_ganha_mil??item.quantidade_mil??0;
       return <tr key={item.id}><td>{item.numero_item}</td>
        <td className="f4-name">{item.descricao_exigida}</td>
        <td className="f4-num">{milToText(won)} {item.unidade}</td>
        <td className="f4-num">{milToText(item.allocated_mil)}</td>
        <td className="f4-num"><strong>{milToText(item.remaining_mil)}</strong></td>
        <td><input className="f5-cell-input" aria-label={"Nova quantidade item "+item.numero_item}
         value={line.quantity} disabled={!canWrite||item.remaining_mil===0||pending}
         onChange={e=>update(item.id,"quantity",e.target.value)} placeholder="0,000"/></td>
        <td><input className="f5-cell-input" aria-label={"Preço unitário item "+item.numero_item}
         value={line.price} disabled={!canWrite||item.remaining_mil===0||pending}
         onChange={e=>update(item.id,"price",e.target.value)} placeholder="0,00"/></td>
       </tr>;
      })}</tbody></table></div>
      <p className="f4-note">Informe quantidade somente nos itens a utilizar. O banco rejeita operações que excedam o total, inclusive em concorrência.</p>
     </section>}
     <div className="f4-submit f5-full">
      <div><strong>Total indicado: {moneyText(total)}</strong>
       <p className="f4-note">Estimativa calculada a partir das linhas. Não é saldo bancário, pagamento nem título a pagar.</p>
      </div>
      <Button type="submit" disabled={!canWrite||pending||loading||!available||
       !isWriteable(kind,available)||selectedLines.length===0||selectedLines.length>20}>
       {pending?"Confirmando…":label.action} <ArrowRight size={16}/></Button>
     </div>
    </form>
   </Card>}
  </>}
 </div>;
}
