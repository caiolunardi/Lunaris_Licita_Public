import {useCallback,useEffect,useRef,useState,type FormEvent,type ReactNode} from "react";
import {ArrowRight,CalendarDays,CheckCircle2,ChevronRight,
 Landmark,Plus,RefreshCcw,Repeat2,Search,ShieldAlert,
 Undo2,WalletCards} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {fictionalFinance,fictionalMonthly} from "./fixtures";
import {dueForMonth,emptyRecurrence,emptyTitle,formatMoney,monthLocal,parseMoneyBRL,
 titleName,type EditingAction,type FinanceProps,type MonthlySummary,type Payable,
 type PaymentHistory,type Recurrence,type RecurrenceForm,type TitleForm} from "./types";
type Detail={kind:"title";item:Payable;payments:PaymentHistory[]}|
 {kind:"recurrence";item:Recurrence;revisions:Record<string,unknown>[]};
type ActiveAction={kind:EditingAction;item:Payable|Recurrence;eventId?:string}|null;
const labels={
 overview:{title:"Fluxo de compromissos",eyebrow:"Visão mensal de saídas",sub:"O que vence, o que já foi lançado e o que ainda é apenas previsão."},
 titles:{title:"Contas a pagar",eyebrow:"Boletos e despesas avulsas",sub:"Vencimentos, baixas e despesas com ou sem boleto."},
 recurrences:{title:"Contas recorrentes",eyebrow:"Compromissos mensais",sub:"Regras para despesas repetidas, sem duplicar o título da competência."}
} as const;
const monthValid=(v:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const validTitle=(x:unknown):x is Payable=>{
 const v=x as Partial<Payable>|null;
 return !!v&&typeof v.id==="string"&&typeof v.versao==="number"&&
  typeof v.situacao==="string"&&(v.tipo==="DIVERSO"||v.tipo==="FORNECEDOR");
};
const validRec=(x:unknown):x is Recurrence=>{
 const v=x as Partial<Recurrence>|null;
 return !!v&&typeof v.id==="string"&&typeof v.versao==="number"&&
  typeof v.beneficiario==="string"&&typeof v.dia_vencimento==="number";
};
const statusText=(s:Payable["situacao"])=>({
 ABERTO:"Em aberto",PAGO:"Pago",PAGO_LEGADO_SEM_BAIXA:"Pago histórico",
 PENDENTE_CONFERENCIA:"Pendente de conferência",INCONSISTENTE:"Inconsistente",
 CANCELADO:"Cancelado"
}[s]||s);
const statusTone=(s:Payable["situacao"]):"success"|"warning"|"danger"|"neutral"=>
 s==="PAGO"?"success":s==="ABERTO"?"warning":
 s==="CANCELADO"?"neutral":"danger";
const readable=(status:number)=>{
 if(status===401)return "Sessão expirada ou revogada. Valide a identidade antes de continuar.";
 if(status===403)return "Sem autorização para consultar ou modificar esses compromissos.";
 if(status===404)return "Registro não disponível ou bloqueado para seu perfil.";
 if(status===409)return "Operação em conflito ou informação desatualizada. Recarregue a ficha antes de continuar.";
 if(status===400||status===413||status===415)return "Confira os dados e a situação do cadastro.";
 return "Serviço indisponível ou resultado incerto. Reconsulte antes de tentar outra ação.";
};
function Field({label,value,onChange,type="text",required=false,children,maxLength=180}:{
 label:string;value:string;onChange:(v:string)=>void;type?:string;required?:boolean;
 children?:ReactNode;maxLength?:number
}){
 return <label className="f3-field"><span>{label}</span>
  {children||<input type={type} value={value} onChange={e=>onChange(e.target.value)}
   required={required} maxLength={maxLength} autoComplete="off"/>}
 </label>;
}
function FinancialNotes(){
 return <div className="f3-caveat"><ShieldAlert size={17} aria-hidden="true"/>
  <span><strong>Previsão não é saldo bancário.</strong> O painel F3 acompanha compromissos a pagar.
   Entradas, recebimentos e saldo de caixa consolidado serão integrados na F7.
   Anexar PDF de boleto/comprovante depende da homologação documental R7 E5/E6.</span>
 </div>;
}
export default function FinancePage({mode,identity,onIdentity,onNavigate}:FinanceProps){
 const company=identity.active,verified=identity.source==="server"&&identity.stage==="verified"&&!!company;
 const demo=identity.source==="fixture"&&identity.stage==="preview"&&!!company;
 const enabled=verified||demo,write=Boolean(company?.permissions.canWrite);
 const [month,setMonth]=useState(monthLocal);
 const [query,setQuery]=useState(""),[search,setSearch]=useState("");
 const [stateFilter,setStateFilter]=useState("active");
 const [titles,setTitles]=useState<Payable[]>(()=>fictionalFinance(company?.id||"").titles);
 const [rules,setRules]=useState<Recurrence[]>(()=>fictionalFinance(company?.id||"").recurrences);
 const [payments,setPayments]=useState<Record<string,PaymentHistory[]>>(
  ()=>fictionalFinance(company?.id||"").payments);
 const [ends,setEnds]=useState<Record<string,string>>({});
 const [monthly,setMonthly]=useState<MonthlySummary|null>(null);
 const [cursor,setCursor]=useState<string|null>(null);
 const [loading,setLoading]=useState(false),[loadingMore,setLoadingMore]=useState(false);
 const [error,setError]=useState<string|null>(null),[flash,setFlash]=useState<string|null>(null);
 const [detail,setDetail]=useState<Detail|null>(null),[detailLoading,setDetailLoading]=useState(false);
 const [newKind,setNewKind]=useState<"title"|"recurrence"|null>(null);
 const [titleForm,setTitleForm]=useState<TitleForm>(emptyTitle);
 const [ruleForm,setRuleForm]=useState<RecurrenceForm>(emptyRecurrence);
 const [action,setAction]=useState<ActiveAction>(null);
 const [actionValue,setActionValue]=useState(""),[actionDate,setActionDate]=useState(""),
       [reason,setReason]=useState(""),[actionMonth,setActionMonth]=useState(month);
 const [saving,setSaving]=useState(false),[refresh,setRefresh]=useState(0);
 const actionIntent=useRef<string|null>(null),requestGeneration=useRef(0);
 const listAbort=useRef<AbortController|null>(null);
 const base=company?"/api/v1/companies/"+encodeURIComponent(company.id)+"/finance":"";
 const titlesURL=base+"/titles",recURL=base+"/recurrences";
 useEffect(()=>{const id=setTimeout(()=>setSearch(query.trim()),250);return ()=>clearTimeout(id);},[query]);
 const resetEdit=()=>{setNewKind(null);setAction(null);setDetail(null);
  setError(null);actionIntent.current=null;};
 const requestJSON=useCallback(async<T,>(url:string,signal?:AbortSignal):Promise<T>=>{
  const result=await fetch(url,{cache:"no-store",credentials:"same-origin",signal,
    headers:{"accept":"application/json"}});
  if(!result.ok)throw Object.assign(new Error("fetch_rejected"),{status:result.status});
  return result.json() as Promise<T>;
 },[]);
 const load=useCallback(async(after:string|null=null)=>{
  if(!verified)return;
  const current=++requestGeneration.current;
  listAbort.current?.abort();const abort=new AbortController();listAbort.current=abort;
  if(after)setLoadingMore(true);
  else{setLoading(true);if(mode==="titles")setTitles([]);if(mode==="recurrences")setRules([]);setCursor(null);}
  setError(null);
  try{
   if(mode==="overview"){
    const summary=await requestJSON<MonthlySummary>(base+"/monthly?month="+month,abort.signal);
    if(typeof summary.totalConhecidoCent!=="number"||!Array.isArray(summary.linhas)||
      !Array.isArray(summary.incompletos)||typeof summary.completo!=="boolean"||
      summary.competencia!==month)throw new Error("invalid_monthly_contract");
    if(current===requestGeneration.current)setMonthly(summary);
   }else{
    const params=new URLSearchParams({limit:"25",state:stateFilter});
    if(search)params.set("q",search.slice(0,80));
    if(after)params.set("after",after);
    if(mode==="titles")params.set("month",month);
    const data=await requestJSON<{items:unknown;nextCursor:string|null}>(
      (mode==="titles"?titlesURL:recURL)+"?"+params,abort.signal);
    const validator=mode==="titles"?validTitle:validRec;
    if(!Array.isArray(data.items)||data.items.length>25||
       !data.items.every(validator)||
       (data.nextCursor!==null&&typeof data.nextCursor!=="string"))
       throw new Error("invalid_list_contract");
    if(current===requestGeneration.current){
     if(mode==="titles")setTitles(old=>after?[...old,...data.items as Payable[]]:data.items as Payable[]);
     else setRules(old=>after?[...old,...data.items as Recurrence[]]:data.items as Recurrence[]);
     setCursor(data.nextCursor);
    }
   }
  }catch(e){
   if(current===requestGeneration.current&&!abort.signal.aborted){
    setError(readable((e as {status?:number}).status||503));setMonthly(null);
   }
  }finally{
   if(current===requestGeneration.current){setLoading(false);setLoadingMore(false);}
  }
 },[verified,mode,month,stateFilter,search,base,titlesURL,recURL,requestJSON]);
 useEffect(()=>{
  if(verified)void load();
  return ()=>{requestGeneration.current++;listAbort.current?.abort();};
 },[verified,load,refresh]);
 useEffect(()=>{setStateFilter("active");setQuery("");setSearch("");setAction(null);
  setDetail(null);setNewKind(null);actionIntent.current=null;},[mode]);
 const normalized=(s:string)=>s.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase("pt-BR");
 const displayedTitles=demo?titles.filter(t=>
   (t.recorrencia_id?t.competencia:t.vencimento?.slice(0,7))===month &&
   (stateFilter==="all"||stateFilter==="active"&&t.situacao==="ABERTO"||
    stateFilter==="paid"&&(t.situacao==="PAGO"||t.situacao==="PAGO_LEGADO_SEM_BAIXA")||
    stateFilter==="cancelled"&&t.situacao==="CANCELADO")&&
   (!search||normalized(titleName(t)).includes(normalized(search))||
    normalized(t.categoria_despesa||"").includes(normalized(search)))):titles;
 const displayedRules=demo?rules.filter(r=>
  (stateFilter==="all"||stateFilter==="active"&&r.estado==="ATIVA"||
   stateFilter==="ended"&&r.estado!=="ATIVA")&&
  (!search||normalized(r.beneficiario).includes(normalized(search)))):rules;
 const summary=demo?fictionalMonthly(titles,rules,month,ends):monthly;
 async function openDetail(item:Payable|Recurrence,isTitle:boolean){
  resetEdit();setDetailLoading(true);
  if(demo){
   setDetail(isTitle?{kind:"title",item:item as Payable,payments:payments[item.id]||[]}:
    {kind:"recurrence",item:item as Recurrence,revisions:[]});
   setDetailLoading(false);return;
  }
  try{
   const data=await requestJSON<{item:unknown;payments?:PaymentHistory[];revisions?:Record<string,unknown>[]}>(
    (isTitle?titlesURL:recURL)+"/"+encodeURIComponent(item.id));
   if(!(isTitle?validTitle(data.item):validRec(data.item)))throw new Error("detail_contract");
   setDetail(isTitle?{kind:"title",item:data.item as Payable,payments:data.payments||[]}:
     {kind:"recurrence",item:data.item as Recurrence,revisions:data.revisions||[]});
  }catch(e){setError(readable((e as {status?:number}).status||503));}
  finally{setDetailLoading(false);}
 }
 const beginNew=(kind:"title"|"recurrence")=>{
  setTitleForm(emptyTitle());setRuleForm(emptyRecurrence());setNewKind(kind);
  setAction(null);setDetail(null);setError(null);setFlash(null);actionIntent.current=null;
 };
 const beginAction=(kind:EditingAction,item:Payable|Recurrence,eventId?:string)=>{
  setNewKind(null);setAction({kind,item,eventId});setError(null);setFlash(null);
  setActionValue(kind==="pay"?String(((item as Payable).valor_nominal_cent||0)/100).replace(".",","):"");
  setActionDate(kind==="pay"?monthLocal()+"-15":(item as Payable).vencimento||month+"-15");
  setActionMonth(month);
  setReason("");actionIntent.current=null;
 };
 async function post(path:string,payload:Record<string,unknown>):Promise<{intentId:string;replayed?:boolean}>{
  const response=await fetch(path,{method:"POST",credentials:"same-origin",cache:"no-store",
   headers:{"content-type":"application/json","accept":"application/json"},
   body:JSON.stringify(payload)});
  if(!response.ok)throw Object.assign(new Error("write_rejected"),{status:response.status});
  return response.json() as Promise<{intentId:string;replayed?:boolean}>;
 }
 function writeSuccess(message:string){
  setFlash(message);setAction(null);setNewKind(null);setDetail(null);
  actionIntent.current=null;setRefresh(n=>n+1);
 }
 async function submitNew(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!write||saving||!newKind)return;
  const valor=parseMoneyBRL(newKind==="title"?titleForm.valor:ruleForm.valor);
  if(!valor){setError("Informe um valor maior que zero, com até duas casas decimais.");return;}
  const intentId=actionIntent.current||crypto.randomUUID();actionIntent.current=intentId;
  setSaving(true);setError(null);
  if(demo){
   const id="f3-demo-created-"+crypto.randomUUID();
   if(newKind==="title"){
    const t:Payable={id,tipo:titleForm.tipo,
      beneficiario:titleForm.tipo==="DIVERSO"?titleForm.beneficiario:null,
      categoria_despesa:titleForm.tipo==="DIVERSO"?titleForm.categoriaDespesa:null,
      fornecedor_id:null,fornecedor_nome:titleForm.tipo==="FORNECEDOR"?titleForm.fornecedorNome:null,
      descricao_boleto:titleForm.descricao||null,valor_nominal_cent:valor,
      vencimento:titleForm.vencimento,recorrencia_id:null,competencia:null,
      observacoes:titleForm.observacoes||null,cancelado:0,pago_legado_status:null,
      origem_dado:"NATIVO",conferencia:"VALIDADO",versao:1,situacao:"ABERTO"};
    setTitles(v=>[...v,t]);
   }else{
    const r:Recurrence={id,beneficiario:ruleForm.beneficiario,
     categoria_despesa:ruleForm.categoriaDespesa,descricao_boleto:ruleForm.descricao||null,
     valor_atual_cent:valor,dia_vencimento:Number(ruleForm.dia),
     primeiro_vencimento:ruleForm.primeiroVencimento,ultima_competencia:null,
     estado:"ATIVA",origem_dado:"NATIVO",conferencia:"VALIDADO",versao:1};
    setRules(v=>[...v,r]);
   }
   writeSuccess("Lançamento criado somente na demonstração. Nada foi gravado.");setSaving(false);return;
  }
  try{
   const payload=newKind==="title"?
     {intentId,tipo:titleForm.tipo,
      ...(titleForm.tipo==="DIVERSO"?{beneficiario:titleForm.beneficiario,
       categoriaDespesa:titleForm.categoriaDespesa}:{fornecedorNome:titleForm.fornecedorNome}),
      descricao:titleForm.descricao||null,valorCent:valor,
      vencimento:titleForm.vencimento,observacoes:titleForm.observacoes||null}:
     {intentId,beneficiario:ruleForm.beneficiario,
      categoriaDespesa:ruleForm.categoriaDespesa,descricao:ruleForm.descricao||null,
      valorCent:valor,diaVencimento:Number(ruleForm.dia),
      primeiroVencimento:ruleForm.primeiroVencimento};
   const outcome=await post(newKind==="title"?titlesURL:recURL,payload);
   if(outcome.intentId!==intentId)throw Error("write_not_confirmed");
   writeSuccess(outcome.replayed?"Lançamento já confirmado; lista atualizada.":
      "Compromisso registrado e auditado no D1 local.");
  }catch(error){setError(readable((error as {status?:number}).status||503));}
  finally{setSaving(false);}
 }
 async function submitAction(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!action||!write||saving)return;
  const isTitle=["pay","undo","revise","cancel","notes"].includes(action.kind);
  const id=action.item.id,versao=action.item.versao;
  const intentId=actionIntent.current||crypto.randomUUID();actionIntent.current=intentId;
  let url=(isTitle?titlesURL:recURL)+"/"+encodeURIComponent(id);
  let payload:Record<string,unknown>={intentId,expectedVersion:versao};
  if(action.kind==="pay"){
   const paid=parseMoneyBRL(actionValue);if(paid===null){setError("Valor pago inválido.");return;}
   url+="/payments";payload={...payload,valorPagoCent:paid,dataPagamento:actionDate};
  }else if(action.kind==="undo"){
   url+="/payments/"+encodeURIComponent(action.eventId||"")+"/undo";
   payload={...payload,motivo:reason.trim()};
  }else if(action.kind==="revise"){
   url+="/revise";const val=actionValue.trim()?parseMoneyBRL(actionValue):null;
   if(actionValue.trim()&&val===null){setError("Novo valor inválido.");return;}
   payload={...payload,...(val!==null?{novoValorCent:val}:{}),
    ...(actionDate?{novoVencimento:actionDate}:{}),motivo:reason.trim()};
  }else if(action.kind==="cancel"){
   url+="/cancel";payload={...payload,motivo:reason.trim()};
  }else if(action.kind==="notes"){
   url+="/notes";payload={...payload,observacoes:reason.trim()};
  }else if(action.kind==="materialize"){
   url+="/materialize";payload={...payload,competencia:actionMonth};
  }else if(action.kind==="revise-value"){
   const val=parseMoneyBRL(actionValue);if(val===null){setError("Valor recorrente inválido.");return;}
   url+="/revise-value";
   payload={...payload,valorNovoCent:val,vigenteAPartir:actionMonth,motivo:reason.trim()};
  }else if(action.kind==="end-after"){
   url+="/end-after";payload={...payload,fimDepois:actionMonth,motivo:reason.trim()};
  }
  setError(null);setSaving(true);
  if(demo){
   if(isTitle){
    setTitles(old=>old.map(t=>{
     if(t.id!==id)return t;
     if(action.kind==="pay")return {...t,situacao:"PAGO",versao:t.versao+1};
     if(action.kind==="undo")return {...t,situacao:"ABERTO",versao:t.versao+1};
     if(action.kind==="revise")return {...t,valor_nominal_cent:actionValue?parseMoneyBRL(actionValue):t.valor_nominal_cent,
       vencimento:actionDate||t.vencimento,versao:t.versao+1};
     if(action.kind==="cancel")return {...t,situacao:"CANCELADO",cancelado:1,versao:t.versao+1};
     if(action.kind==="notes")return {...t,observacoes:reason.trim(),versao:t.versao+1};
     return t;
    }));
    if(action.kind==="pay"){
     const event:PaymentHistory={id:"f3-demo-pay-"+crypto.randomUUID(),tipo:"QUITACAO",
      baixa_original_id:null,data_pagamento:actionDate,valor_pago_cent:parseMoneyBRL(actionValue),
      comprovante_documento_id:null,motivo:null,origem_dado:"NATIVO",conferencia:"VALIDADO",criado_em:null};
     setPayments(v=>({...v,[id]:[...(v[id]||[]),event]}));
    }
    if(action.kind==="undo"){
     const event:PaymentHistory={id:"f3-demo-undo-"+crypto.randomUUID(),tipo:"DESFAZIMENTO",
      baixa_original_id:action.eventId||null,data_pagamento:null,valor_pago_cent:null,
      comprovante_documento_id:null,motivo:reason,origem_dado:"NATIVO",conferencia:"VALIDADO",criado_em:null};
     setPayments(v=>({...v,[id]:[...(v[id]||[]),event]}));
    }
   }else{
    const rule=action.item as Recurrence;
    if(action.kind==="materialize"){
     const due=dueForMonth(actionMonth,rule.dia_vencimento);
     const t:Payable={id:"f3-demo-title-"+crypto.randomUUID(),tipo:"DIVERSO",
      beneficiario:rule.beneficiario,categoria_despesa:rule.categoria_despesa,
      fornecedor_id:null,fornecedor_nome:null,descricao_boleto:rule.descricao_boleto,
      valor_nominal_cent:rule.valor_atual_cent,vencimento:due,
      recorrencia_id:rule.id,competencia:actionMonth,observacoes:null,cancelado:0,
      pago_legado_status:null,origem_dado:"NATIVO",conferencia:"VALIDADO",versao:1,situacao:"ABERTO"};
     if(!titles.some(v=>v.recorrencia_id===rule.id&&v.competencia===actionMonth)){
      setTitles(v=>[...v,t]);
      setRules(v=>v.map(x=>x.id===id?{...x,ultima_competencia:actionMonth,versao:x.versao+1}:x));
     }else{setError("Competência já gerada nesta simulação.");setSaving(false);return;}
    }else if(action.kind==="revise-value"){
     setRules(v=>v.map(x=>x.id===id?{...x,valor_atual_cent:parseMoneyBRL(actionValue),versao:x.versao+1}:x));
    }else if(action.kind==="end-after"){
     setEnds(v=>({...v,[id]:actionMonth}));
     setRules(v=>v.map(x=>x.id===id?{...x,versao:x.versao+1}:x));
    }
   }
   writeSuccess("Ação simulada. Nenhum dado foi persistido.");setSaving(false);return;
  }
  try{
   const result=await post(url,payload);
   if(result.intentId!==intentId)throw Error("write_not_confirmed");
   writeSuccess(result.replayed?"Ação anteriormente registrada.":"Ação concluída com trilha auditável no D1 local.");
  }catch(error){setError(readable((error as {status?:number}).status||503));}
  finally{setSaving(false);}
 }
 const actionTitle=action?({
  pay:"Registrar pagamento",undo:"Desfazer pagamento",revise:"Revisar valor e vencimento",
  cancel:"Cancelar título",notes:"Atualizar observações",
  materialize:"Gerar título da competência", "revise-value":"Reajustar valor futuro",
  "end-after":"Encerrar após competência"
 }[action.kind]):"";
 const noCompany=!enabled;
 return <div className="f3-page">
  <div className="page-intro"><div><p className="eyebrow">F3 · {labels[mode].eyebrow}</p>
   <h1>{labels[mode].title}</h1><p>{labels[mode].sub}</p></div>
   <span className="intro-decoration"><WalletCards size={34}/></span></div>
  <Notice title={demo?"Laboratório fictício — sem persistência":
    verified?"Financeiro validado no D1 local":"Financeiro protegido"}>
   {demo?"Valores e pagamentos demonstrativos, sem movimento real ou dados bancários.":
    verified?"Sessão e empresa verificadas no Worker/D1 sintético local. Ninguém está publicando operações financeiras.":
    "Valide sua identidade e escolha uma empresa para consultar o financeiro. Prévia fictícia disponível no seletor de identidade."}
  </Notice>
  <div className="f3-navigation" aria-label="Módulos financeiros">
   {([
    ["overview","Fluxo mensal",CalendarDays],["titles","Contas a pagar",WalletCards],
    ["recurrences","Recorrências",Repeat2]
   ] as const).map(([key,label,Icon])=><button key={key} type="button" onClick={()=>onNavigate(key)}
     className={`f3-tab ${mode===key?"f3-tab--active":""}`}
     aria-current={mode===key?"page":undefined}><Icon size={17}/>{label}</button>)}
  </div>
  {noCompany?<Card className="f3-locked"><ShieldAlert size={26}/><h2>Nenhuma empresa ativa</h2>
   <p>Não carregamos dados financeiros sem um contexto autorizado. Você pode escolher uma empresa fictícia para conhecer as telas.</p>
   <Button onClick={onIdentity}>Abrir identidade e acesso <ArrowRight size={16}/></Button></Card>:
   <>
    <div className="f3-company-strip"><span className="f3-company-symbol"><Landmark size={20}/></span>
     <div><small>Empresa ativa</small><strong>{company!.name}</strong><span>{demo?"Simulação local":"Empresa validada pelo Worker"} · {company!.role}</span></div>
     <Badge tone={demo?"warning":"info"}>{demo?"Fictício":"D1 local"}</Badge>
     <Button variant="ghost" onClick={onIdentity}>Trocar empresa <ChevronRight size={16}/></Button>
    </div>
    <FinancialNotes/>
    {flash&&<p className="f3-success" role="status">{flash}</p>}
    {error&&<p className="f3-error" role="alert">{error}</p>}
    {mode==="overview"&&<Card className="f3-overview">
     <SectionHeading eyebrow="Não misturamos previsão e pagamento" title="Compromissos do mês"/>
     <div className="f3-top-controls"><Field label="Competência" value={month} type="month"
       onChange={setMonth}/><Button variant="secondary" onClick={()=>setRefresh(v=>v+1)}
       disabled={loading}><RefreshCcw size={16}/> Atualizar</Button></div>
     {loading?<Skeleton lines={4}/>:
      summary?<><div className="f3-summary-grid">
       <div className="f3-total"><small>Total conhecido de compromissos</small>
        <strong>{formatMoney(summary.totalConhecidoCent)}</strong>
        <span>Inclui contas lançadas e regras futuras não materializadas.</span></div>
       <div><small>Integridade da competência</small>
        <div><Badge tone={summary.completo?"success":"warning"}>
         {summary.completo?"Conferência completa":"Informação incompleta"}</Badge></div>
        <p>{summary.completo?"Nenhuma linha pendente na base consultada.":
         `${summary.incompletos.length} linha(s) sem conferência ou valor confiável. O total é parcial.`}</p></div>
       <div><small>A receber</small><strong>Em construção na F7</strong>
        <p>Não presumimos depósitos nem saldo bancário.</p></div>
      </div>
      <div className="f3-line-title"><strong>Composição do mês</strong>
       <Badge tone="info">{summary.linhas.length} compromisso(s) computados</Badge></div>
      <div className="table-scroll"><table className="f3-table"><thead><tr>
       <th>Origem</th><th>Estado</th><th>Valor</th></tr></thead><tbody>
       {summary.linhas.map(x=><tr key={x.tipo+":"+x.id}><td>{x.tipo==="TITULO"?"Conta lançada":"Previsão recorrente"}</td>
       <td>{x.situacao}</td><td className="f3-money">{formatMoney(x.valorCent)}</td></tr>)}
       </tbody></table></div>
      </>:<EmptyState title="Sem prévia" message="Selecione uma competência autorizada para consultar os compromissos."/>}
     <div className="f3-actions-inline"><Button onClick={()=>onNavigate("titles")}>Ver contas a pagar <ArrowRight size={16}/></Button>
      <Button variant="secondary" onClick={()=>onNavigate("recurrences")}>Ver recorrências</Button></div>
    </Card>}
    {(mode==="titles"||mode==="recurrences")&&<>
     <Card className="f3-records">
      <SectionHeading eyebrow={mode==="titles"?"Histórico com baixas e conferência":"Regras e competências"}
       title={mode==="titles"?"Compromissos cadastrados":"Regras mensais cadastradas"}>
       <Button disabled={!write||saving} onClick={()=>beginNew(mode==="titles"?"title":"recurrence")}>
        <Plus size={16}/> {mode==="titles"?"Nova conta":"Nova recorrência"}</Button>
      </SectionHeading>
      <div className="f3-filters">
       <label className="f3-search"><Search size={16}/><input type="search" value={query}
        onChange={e=>setQuery(e.target.value)} maxLength={80}
        aria-label="Buscar compromissos" placeholder="Buscar por nome ou categoria"/></label>
       {mode==="titles"&&<Field label="Competência" type="month" value={month} onChange={setMonth}/>}
       <label className="f3-field">Situação
        <select value={stateFilter} onChange={e=>setStateFilter(e.target.value)}>
         <option value="active">{mode==="titles"?"Em aberto":"Ativas"}</option>
         {mode==="titles"?<><option value="paid">Pagas</option><option value="cancelled">Canceladas</option></>:
          <option value="ended">Encerradas</option>}
         <option value="all">Todas</option></select></label>
       <Button variant="ghost" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>
        <RefreshCcw size={16}/> Atualizar</Button>
      </div>
      {loading?<Skeleton lines={4}/>:
       (mode==="titles"?displayedTitles:displayedRules).length===0?
         <EmptyState title="Nenhum compromisso encontrado" message="Tente outro filtro ou cadastre um compromisso autorizado."/>:
       <div className="table-scroll"><table className="f3-table">
        <thead><tr><th>Descrição</th><th>{mode==="titles"?"Vencimento":"Dia"}</th>
         <th>Valor</th><th>Situação</th><th>Ações</th></tr></thead>
        <tbody>{mode==="titles"?displayedTitles.map(t=><tr key={t.id}>
         <td className="f3-primary-cell"><strong>{titleName(t)}</strong>
          <small>{t.tipo==="FORNECEDOR"?"Fornecedor":t.categoria_despesa||"Despesas diversas"}</small></td>
         <td>{t.vencimento||"Sem data"}</td>
         <td className="f3-money">{formatMoney(t.valor_nominal_cent)}</td>
         <td><Badge tone={statusTone(t.situacao)}>{statusText(t.situacao)}</Badge>
          {t.origem_dado==="LEGADO"&&<small>Histórico protegido</small>}</td>
         <td><Button variant="secondary" onClick={()=>void openDetail(t,true)}>Abrir ficha</Button></td>
        </tr>):displayedRules.map(t=><tr key={t.id}>
         <td className="f3-primary-cell"><strong>{t.beneficiario}</strong><small>{t.categoria_despesa}</small></td>
         <td>Dia {t.dia_vencimento}</td><td className="f3-money">{formatMoney(t.valor_atual_cent)}</td>
         <td><Badge tone={t.estado==="ATIVA"?"success":"neutral"}>{t.estado}</Badge></td>
         <td><Button variant="secondary" onClick={()=>void openDetail(t,false)}>Abrir regra</Button></td>
        </tr>)}</tbody></table></div>}
       {cursor&&verified&&<div className="f3-more"><Button variant="secondary"
        disabled={loadingMore} onClick={()=>void load(cursor)}>{loadingMore?"Carregando…":"Carregar mais"}</Button></div>}
       <p className="f3-caption">Consultas de até 25 registros por requisição. Valores sempre em centavos no backend;
        a apresentação usa a formatação monetária brasileira.</p>
     </Card>
     {detailLoading&&<Card role="status"><Skeleton lines={3}/></Card>}
     {detail&&<Card className="f3-detail">
      <SectionHeading eyebrow={detail.kind==="title"?"Ficha e eventos financeiros":"Regra e revisões"}
       title={detail.kind==="title"?titleName(detail.item):detail.item.beneficiario}>
       <Button variant="ghost" onClick={()=>setDetail(null)}>Fechar ficha</Button>
      </SectionHeading>
      <div className="f3-detail-grid">
       <div><small>Valor {detail.kind==="title"?"nominal":"atual"}</small>
        <strong>{formatMoney(detail.kind==="title"?detail.item.valor_nominal_cent:detail.item.valor_atual_cent)}</strong></div>
       <div><small>Versão</small><strong>{detail.item.versao}</strong></div>
       <div><small>{detail.kind==="title"?"Vencimento":"Primeiro vencimento"}</small>
        <strong>{detail.kind==="title"?detail.item.vencimento:detail.item.primeiro_vencimento}</strong></div>
       <div><small>Origem</small><strong>{detail.item.origem_dado} · {detail.item.conferencia}</strong></div>
      </div>
      {detail.kind==="title"?<>
       <div className="f3-history"><strong>Histórico de pagamentos</strong>
        {detail.payments.length===0?<p>Não existem baixas registradas para este título.</p>:
         <div className="f3-events">{detail.payments.map(x=><div className="f3-event" key={x.id}>
          {x.tipo==="QUITACAO"?<CheckCircle2 size={17}/>:<Undo2 size={17}/>}
          <div><strong>{x.tipo==="QUITACAO"?"Quitação":"Desfazimento"}</strong>
           <small>{x.data_pagamento||x.motivo||"Registro administrativo"}</small></div>
          <span>{x.valor_pago_cent!=null?formatMoney(x.valor_pago_cent):"—"}</span>
          {write&&detail.item.situacao==="PAGO"&&x.tipo==="QUITACAO"&&
           !detail.payments.some(a=>a.baixa_original_id===x.id)&&
           detail.item.origem_dado==="NATIVO"&&
           <Button variant="ghost" onClick={()=>beginAction("undo",detail.item,x.id)}>Desfazer</Button>}
         </div>)}</div>}</div>
       {write&&detail.item.origem_dado==="NATIVO"&&detail.item.cancelado===0&&
        <div className="f3-actions-inline">
         {detail.item.situacao==="ABERTO"&&<>
          <Button onClick={()=>beginAction("pay",detail.item)}>Registrar pagamento</Button>
          {!detail.item.recorrencia_id&&<Button variant="secondary"
           onClick={()=>beginAction("revise",detail.item)}>Revisar</Button>}
          <Button variant="ghost" onClick={()=>beginAction("cancel",detail.item)}>Cancelar conta</Button>
         </>}
         <Button variant="ghost" onClick={()=>beginAction("notes",detail.item)}>Observações</Button>
        </div>}
      </>:<>
       <p className="f3-caption">Uma competência materializada vira um título. A regra deixa de entrar
        como previsão desse mesmo mês, evitando contagem em dobro.</p>
       {write&&detail.item.estado==="ATIVA"&&detail.item.origem_dado==="NATIVO"&&
        <div className="f3-actions-inline">
         <Button onClick={()=>beginAction("materialize",detail.item)}>Gerar mês</Button>
         <Button variant="secondary" onClick={()=>beginAction("revise-value",detail.item)}>Revisar valor futuro</Button>
         <Button variant="ghost" onClick={()=>beginAction("end-after",detail.item)}>Definir último mês</Button>
        </div>}
      </>}
     </Card>}
     {newKind&&<Card className="f3-form-card">
      <SectionHeading eyebrow="Lançamento controlado" title={newKind==="title"?"Nova conta":"Nova regra recorrente"}>
       <Button variant="ghost" disabled={saving} onClick={resetEdit}>Cancelar</Button></SectionHeading>
      <form onSubmit={e=>void submitNew(e)} className="f3-form">
       {newKind==="title"?<>
        <label className="f3-field">Tipo de despesa
         <select value={titleForm.tipo} onChange={e=>setTitleForm(o=>({...o,tipo:e.target.value as TitleForm["tipo"]}))}>
          <option value="DIVERSO">Despesa avulsa / sem boleto</option>
          <option value="FORNECEDOR">Cobrança de fornecedor</option></select></label>
        {titleForm.tipo==="DIVERSO"?<>
         <Field label="Beneficiário *" value={titleForm.beneficiario} required
          onChange={v=>setTitleForm(o=>({...o,beneficiario:v}))}/>
         <Field label="Categoria de despesa *" value={titleForm.categoriaDespesa} required
          onChange={v=>setTitleForm(o=>({...o,categoriaDespesa:v}))}/>
        </>:<Field label="Nome do fornecedor *" value={titleForm.fornecedorNome} required
          onChange={v=>setTitleForm(o=>({...o,fornecedorNome:v}))}/>}
        <Field label="Valor R$ *" value={titleForm.valor} required
         onChange={v=>setTitleForm(o=>({...o,valor:v}))}/>
        <Field label="Vencimento *" type="date" value={titleForm.vencimento} required
         onChange={v=>setTitleForm(o=>({...o,vencimento:v}))}/>
        <Field label="Descrição / boleto opcional" value={titleForm.descricao}
         onChange={v=>setTitleForm(o=>({...o,descricao:v}))} maxLength={1000}/>
        <Field label="Observações" value={titleForm.observacoes}
         onChange={v=>setTitleForm(o=>({...o,observacoes:v}))} maxLength={4000}/>
       </>:<>
        <Field label="Beneficiário *" value={ruleForm.beneficiario} required
         onChange={v=>setRuleForm(o=>({...o,beneficiario:v}))}/>
        <Field label="Categoria *" value={ruleForm.categoriaDespesa} required
         onChange={v=>setRuleForm(o=>({...o,categoriaDespesa:v}))}/>
        <Field label="Valor mensal R$ *" value={ruleForm.valor} required
         onChange={v=>setRuleForm(o=>({...o,valor:v}))}/>
        <label className="f3-field">Dia do vencimento
         <select value={ruleForm.dia} onChange={e=>{
           const day=e.target.value;
           setRuleForm(o=>({...o,dia:day,
            primeiroVencimento:dueForMonth(o.primeiroVencimento.slice(0,7),Number(day))}));
         }}>{Array.from({length:31},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label>
        <Field label="Primeiro vencimento *" type="date" required value={ruleForm.primeiroVencimento}
         onChange={v=>{
          const m=v.slice(0,7);
          if(monthValid(m))setRuleForm(o=>({...o,primeiroVencimento:dueForMonth(m,Number(o.dia))}));
         }}/>
        <Field label="Descrição" value={ruleForm.descricao} maxLength={1000}
         onChange={v=>setRuleForm(o=>({...o,descricao:v}))}/>
       </>}
       <div className="f3-submit"><span>Não aceita campo de empresa ou ator da interface.</span>
        <Button type="submit" disabled={saving||!write}>{saving?"Gravando…":"Salvar com auditoria"} <ArrowRight size={16}/></Button></div>
      </form>
     </Card>}
     {action&&<Card className="f3-form-card">
      <SectionHeading eyebrow="Comando financeiro R7" title={actionTitle}>
       <Button variant="ghost" disabled={saving} onClick={resetEdit}>Cancelar</Button></SectionHeading>
      <p className="f3-caption">Referente a: {action.kind==="materialize"||action.kind==="revise-value"||action.kind==="end-after"?
       (action.item as Recurrence).beneficiario:titleName(action.item as Payable)} · versão {action.item.versao}</p>
      <form className="f3-form" onSubmit={e=>void submitAction(e)}>
       {(action.kind==="pay"||action.kind==="revise"||action.kind==="revise-value")&&
        <Field label={action.kind==="pay"?"Valor efetivamente pago R$ *":"Novo valor R$"}
         value={actionValue} required={action.kind!=="revise"}
         onChange={setActionValue}/>}
       {(action.kind==="pay"||action.kind==="revise")&&
        <Field label={action.kind==="pay"?"Data do pagamento":"Novo vencimento"}
         type="date" value={actionDate} onChange={setActionDate} required={action.kind==="pay"}/>}
       {(action.kind==="materialize"||action.kind==="revise-value"||action.kind==="end-after")&&
        <Field label={action.kind==="materialize"?"Competência":"Competência futura"}
         type="month" value={actionMonth} onChange={setActionMonth} required/>}
       {!["pay","materialize"].includes(action.kind)&&
        <label className="f3-field f3-wide">
         <span>{action.kind==="notes"?"Observações":"Justificativa (mínimo de 5 caracteres)"}</span>
         <textarea value={reason} onChange={e=>setReason(e.target.value)}
          minLength={action.kind==="notes"?0:5} required={action.kind!=="notes"} maxLength={1500} rows={3}/>
        </label>}
       <div className="f3-submit"><span>{demo?"Não será gravado.":
        "CAS, journal e validação de permissões no servidor."}</span>
        <Button disabled={saving||!write} type="submit">{saving?"Executando…":"Confirmar ação"}</Button></div>
      </form>
     </Card>}
    </>}
   </>}
 </div>;
}
