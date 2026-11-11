import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {a2SyntheticIntent,a2SyntheticHeaders} from "../hml/a2-synthetic";
import {ArrowLeft,ArrowRight,CalendarClock,CheckCircle2,ChevronRight,
 CircleHelp,Clock3,Landmark,RefreshCcw,WalletCards} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {demoAccounts,demoCredit,demoReversal,demoSummary,fictitiousBalanceHint} from "./fixtures";
import {dayLabel,localDate,localMonth,money,monthLabel,parseBRL,
 planSpending,validDetail,validList,validSummary,
 type Account,type AccountDetail,type PageProps,type Summary} from "./types";

const help=(status?:number)=>{
 if(status===401)return "Sessão expirada. Volte à identidade para entrar novamente.";
 if(status===403)return "Este usuário não pode consultar estes valores. Nenhum total parcial será exibido.";
 if(status===404)return "Não foi possível acessar o registro ou algum item protegido.";
 if(status===409)return "Os dados mudaram ou ainda precisam de conferência. Atualize antes de repetir.";
 if(status===400||status===415)return "Confira os campos e use valores como 1.250,50.";
 return "Não foi possível confirmar a operação. Consulte os valores antes de tentar de novo.";
};
const label=(a:Account)=>a.nf_numero||"Nota sem número";
const receiptStatus=(a:Account):"pending"|"done"|"unknown"|"canceled"=>{
 if(a.cancelada===1||a.nf_situacao==="CANCELADA")return "canceled";
 if(a.saldo_cent===null||a.estado_saldo!=="CONFERIDO")return "unknown";
 return a.saldo_cent===0?"done":"pending";
};
function Metric({title,value,detail,emphasis}:{title:string;value:number|null;detail:string;emphasis?:boolean}){
 return <div className={"f7-metric"+(emphasis?" f7-metric--strong":"")}>
  <span className="f7-metric-label">{title}</span><strong>{money(value)}</strong>
  <p>{detail}</p></div>;
}
function Information({title,items}:{title:string;items:string[]}){
 return <div className="f7-explain"><strong>{title}</strong><ul>{items.map(x=><li key={x}>{x}</li>)}</ul></div>;
}
export default function CashPage({mode,identity,onIdentity,onNavigate}:PageProps){
 const company=identity.active;
 const preview=!!company&&identity.stage==="preview"&&identity.source==="fixture";
 const verified=!!company&&identity.stage==="verified"&&identity.source==="server";
 const canWrite=!!company?.permissions.canWrite,admin=!!company?.permissions.canApprove;
 const root="/api/v1/companies/"+encodeURIComponent(company?.id||"none")+"/cash";
 const [month,setMonth]=useState(localMonth);
 const [summary,setSummary]=useState<Summary|null>(null);
 const [demo,setDemo]=useState<AccountDetail[]>(()=>demoAccounts(company?.id||"",localMonth()));
 const [rows,setRows]=useState<Account[]>([]);
 const [detail,setDetail]=useState<AccountDetail|null>(null);
 const [screen,setScreen]=useState<"list"|"detail">("list");
 const [selected,setSelected]=useState<string|null>(null);
 const [query,setQuery]=useState(""),[filter,setFilter]=useState(""),
  [stateFilter,setStateFilter]=useState<"open"|"settled"|"all">("open");
 const [cursor,setCursor]=useState<string|null>(null);
 const [balance,setBalance]=useState(""),[reserve,setReserve]=useState("");
 const [reviewed,setReviewed]=useState(false);
 const [date,setDate]=useState(localDate),[amount,setAmount]=useState("");
 const [creditConfirmed,setCreditConfirmed]=useState(false);
 const [retention,setRetention]=useState(""),[attestationId,setAttestationId]=useState("");
 const [accountDst,setAccountDst]=useState(""),[reference,setReference]=useState("");
 const [schedule,setSchedule]=useState(""),[scheduleReason,setScheduleReason]=useState("");
 const [reverseReason,setReverseReason]=useState(""),[reverseId,setReverseId]=useState<string|null>(null),
  [reverseConfirmed,setReverseConfirmed]=useState(false);
 const [attestDoc,setAttestDoc]=useState(""),[attestValue,setAttestValue]=useState("");
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [error,setError]=useState<string|null>(null),[success,setSuccess]=useState<string|null>(null);
 const [refresh,setRefresh]=useState(0),serial=useRef(0),intent=useRef<string|null>(null);
 const myIntent=()=>{if(!intent.current)intent.current=a2SyntheticIntent(crypto.randomUUID());return intent.current;};
 const resetAction=()=>{intent.current=null;setError(null);setSuccess(null);};
 const get=useCallback(async<T,>(url:string):Promise<T>=>{
  const r=await fetch(url,{credentials:"same-origin",cache:"no-store",
   headers:{"accept":"application/json"}});
  if(!r.ok)throw Object.assign(new Error("api_unavailable"),{status:r.status});
  return r.json() as Promise<T>;
 },[]);
 const send=useCallback(async(url:string,body:unknown,method="POST"):Promise<Record<string,unknown>>=>{
  const r=await fetch(url,{method,credentials:"same-origin",cache:"no-store",
   headers:{"content-type":"application/json","accept":"application/json",...a2SyntheticHeaders()},
   body:JSON.stringify(body)});
  if(!r.ok)throw Object.assign(new Error("api_unavailable"),{status:r.status});
  return r.json() as Promise<Record<string,unknown>>;
 },[]);
 const loadOverview=useCallback(async()=>{
  if(!verified)return;
  const seq=++serial.current;setLoading(true);setError(null);setSummary(null);
  try{const result=await get<unknown>(root+"/overview?month="+encodeURIComponent(month));
   if(!validSummary(result))throw Error("invalid_summary_contract");
   if(seq===serial.current)setSummary(result);
  }catch(e){if(seq===serial.current)setError(help((e as {status?:number}).status));}
  finally{if(seq===serial.current)setLoading(false);}
 },[verified,root,month,get]);
 const loadList=useCallback(async(next:string|null=null)=>{
  if(!verified)return;
  const seq=++serial.current;setLoading(true);setError(null);
  if(!next){setRows([]);setCursor(null);}
  const params=new URLSearchParams({limit:"25",state:stateFilter});
  if(filter)params.set("q",filter.slice(0,80));if(next)params.set("after",next);
  try{const result=await get<unknown>(root+"/receivables?"+params);
   if(!validList(result))throw Error("invalid_list_contract");
   if(seq===serial.current){setRows(old=>next?[...old,...result.items]:result.items);
    setCursor(result.nextCursor);}
  }catch(e){if(seq===serial.current)setError(help((e as {status?:number}).status));}
  finally{if(seq===serial.current)setLoading(false);}
 },[verified,root,stateFilter,filter,get]);
 const loadDetail=useCallback(async(id:string)=>{
  if(!verified)return;
  const seq=++serial.current;setLoading(true);setError(null);setDetail(null);
  try{const result=await get<unknown>(root+"/receivables/"+encodeURIComponent(id));
   if(!validDetail(result))throw Error("invalid_detail_contract");
   if(seq===serial.current)setDetail(result);
  }catch(e){if(seq===serial.current)setError(help((e as {status?:number}).status));}
  finally{if(seq===serial.current)setLoading(false);}
 },[verified,root,get]);
 useEffect(()=>{const timer=setTimeout(()=>setFilter(query.trim()),200);
  return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{if(verified&&mode==="dashboard")void loadOverview();
  return()=>{serial.current++;};},[verified,mode,loadOverview,refresh]);
 useEffect(()=>{if(verified&&mode==="receivables"&&screen==="list")void loadList();
  return()=>{serial.current++;};},[verified,mode,screen,loadList,refresh]);
 useEffect(()=>{if(verified&&mode==="receivables"&&screen==="detail"&&selected)void loadDetail(selected);
  return()=>{serial.current++;};},[verified,mode,screen,selected,loadDetail,refresh]);
 const currentSummary=preview?demoSummary(company!.id,month,demo):summary;
 const spending=useMemo(()=>currentSummary?planSpending(currentSummary,balance,reserve,reviewed):null,
  [currentSummary,balance,reserve,reviewed]);
 const visibleDemo=preview?demo.filter(x=>{
  const s=receiptStatus(x.item);
  if(stateFilter==="open"&&s!=="pending"&&s!=="unknown")return false;
  if(stateFilter==="settled"&&s!=="done")return false;
  return !filter||[x.item.nf_numero,x.item.empenho_numero].some(k=>
    k?.toLowerCase().includes(filter.toLowerCase()));
 }).map(x=>x.item):[];
 const displayedRows=preview?visibleDemo:rows;
 function open(id:string){
  resetAction();setSelected(id);setScreen("detail");setAmount("");setDate(localDate());
  setRetention("");setAttestationId("");setAccountDst("");setReference("");
  setCreditConfirmed(false);setReverseId(null);setReverseConfirmed(false);
  if(preview){
   const d=demo.find(x=>x.item.id===id)||null;setDetail(d);
   setSchedule(d?.item.vencimento||"");
  }
 }
 const back=()=>{setScreen("list");setSelected(null);setDetail(null);resetAction();};
 function recomputePreview(replacement:AccountDetail){
  setDemo(old=>old.map(x=>x.item.id===replacement.item.id?replacement:x));
  setDetail(replacement);
 }
 async function updateDue(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!detail||busy||!canWrite)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(schedule)||scheduleReason.trim().length<6){
   setError("Informe a data combinada e um motivo curto para a alteração.");return;}
  const id=myIntent(),target=detail.item.id;setBusy(true);setError(null);
  if(preview){
   recomputePreview({item:{...detail.item,vencimento:schedule,versao:detail.item.versao+1},
    events:detail.events});
   intent.current=null;setSuccess("Data prevista salva apenas na demonstração.");
   setBusy(false);return;
  }
  try{const result=await send(root+"/receivables/"+encodeURIComponent(target)+"/schedule",
    {intentId:id,expectedVersion:detail.item.versao,vencimento:schedule,
     motivo:scheduleReason.trim()},"PATCH");
   if(result.intentId!==id)throw Error("unconfirmed_intent");
   intent.current=null;setRefresh(x=>x+1);setSuccess("Vencimento previsto atualizado no D1 local.");
  }catch(err){setError(help((err as {status?:number}).status));}
  finally{setBusy(false);}
 }
 async function confirmCredit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!detail||busy||!canWrite)return;
  const received=parseBRL(amount),discount=retention.trim()?parseBRL(retention):0;
  const pending=detail.item.saldo_cent;
  if(!creditConfirmed){setError("Marque a confirmação de que o dinheiro realmente entrou na conta.");return;}
  if(date>localDate()){setError("Data de crédito futura não confirma dinheiro que já entrou.");return;}
  if(received===null||discount===null||received<0||discount<0||
   received+discount<=0||pending===null||received+discount>pending||
   (discount>0&&!attestationId.trim())||
   (!!accountDst.trim()!==!!reference.trim())){
   setError("O valor do crédito e eventual retenção devem caber no saldo. Referência e conta de destino caminham juntas.");return;
  }
  const id=myIntent(),target=detail.item.id;
  const payload={intentId:id,valorRecebidoCent:received,retencaoConfirmadaCent:discount,
   dataCredito:date,contaDestino:accountDst.trim()||null,
   referenciaExterna:reference.trim()||null,retencaoAtestadoId:attestationId.trim()||null};
  setBusy(true);setError(null);
  if(preview){
   if(discount>0){setError("Retenção com atestado não é simulada nesta prévia.");setBusy(false);return;}
   recomputePreview(demoCredit(detail,received,date));
   intent.current=null;setAmount("");setCreditConfirmed(false);
   setSuccess("Crédito marcado apenas na demonstração fictícia.");setBusy(false);return;
  }
  try{const result=await send(root+"/receivables/"+encodeURIComponent(target)+"/credits",payload);
   if(result.intentId!==id)throw Error("unconfirmed_intent");
   intent.current=null;setCreditConfirmed(false);setAmount("");setRefresh(x=>x+1);
   setSuccess("Recebimento registrado no D1 local. Confira também seu extrato bancário.");
  }catch(err){setError(help((err as {status?:number}).status));}
  finally{setBusy(false);}
 }
 async function confirmReversal(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!detail||!reverseId||busy||!canWrite)return;
  if(!reverseConfirmed||reverseReason.trim().length<5){
   setError("Escreva o motivo e confirme que entendeu que estorno no sistema não devolve dinheiro no banco.");
   return;
  }
  const id=myIntent(),target=detail.item.id,original=reverseId;
  setBusy(true);setError(null);
  if(preview){
   recomputePreview(demoReversal(detail,original,reverseReason.trim()));
   intent.current=null;setReverseId(null);setReverseReason("");setReverseConfirmed(false);
   setSuccess("Registro estornado apenas na demonstração. Nenhuma transferência foi realizada.");
   setBusy(false);return;
  }
  try{const r=await send(root+"/receivables/"+encodeURIComponent(target)+"/credits/"+
   encodeURIComponent(original)+"/reverse",{intentId:id,motivo:reverseReason.trim()});
   if(r.intentId!==id)throw Error("unconfirmed_intent");
   intent.current=null;setReverseId(null);setReverseReason("");setReverseConfirmed(false);
   setRefresh(x=>x+1);setSuccess("Estorno registrado no histórico local; nenhuma transferência foi realizada.");
  }catch(err){setError(help((err as {status?:number}).status));}
  finally{setBusy(false);}
 }
 async function attest(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!detail||!admin||busy)return;
  const cents=parseBRL(attestValue);
  if(cents===null||cents<=0||!attestDoc.trim()){
   setError("Informe o documento já verificado e o valor da retenção.");return;}
  const id=myIntent();setBusy(true);setError(null);
  if(preview){setError("Atestados não são forjados na demonstração; use documento verdadeiro na homologação.");setBusy(false);return;}
  try{const r=await send(root+"/receivables/"+encodeURIComponent(detail.item.id)+"/retentions",
    {intentId:id,documentoVersaoId:attestDoc.trim(),valorConfirmadoCent:cents});
   if(r.intentId!==id)throw Error("unconfirmed_intent");
   intent.current=null;setAttestationId(String(r.atestadoId||""));setSuccess("Atestado registrado no D1 local. Revise o recebimento antes de confirmar.");
  }catch(err){setError(help((err as {status?:number}).status));}
  finally{setBusy(false);}
 }
 if(!company||(!verified&&!preview))return <Card className="f7-gate">
  <SectionHeading title="Seu dinheiro começa com a empresa certa"/>
  <p>Selecione uma empresa autorizada para consultar valores sem misturar os dados de outra.</p>
  <Button onClick={onIdentity}>Escolher empresa</Button></Card>;
 return <div className="f7-page">
  <div className="page-intro"><div><p className="eyebrow">Seu financeiro · F7 em laboratório</p>
   <h1>{mode==="dashboard"?"Seu dinheiro, sem complicação":"Dinheiro que falta receber"}</h1>
   <p>{mode==="dashboard"?
    "Veja o que já entrou, o que ainda vai sair e planeje o mês com calma.":
    "Cada parcela da nota fiscal aparece uma única vez. Só marque recebida após conferir o banco."}</p></div>
   <Landmark size={35} aria-hidden="true"/></div>
  <Notice title={preview?"Simulação com valores fictícios":"Integração local com acesso protegido"}>
   {preview?"Todos os valores são exemplos. Não há dinheiro, boleto ou banco conectado.":
    "A consulta usa somente D1/Workerd local. Homologação remota E5/E6 pendente."}</Notice>
  <div className="f4-company"><span><WalletCards size={21}/></span>
   <div><small>Empresa selecionada</small><strong>{company.name} · {company.role}</strong></div>
   <Button variant="secondary" onClick={onIdentity}>Trocar empresa</Button></div>
  {error&&<div className="f4-error" role="alert">{error}</div>}
  {success&&<div className="f4-success" role="status">{success}</div>}
  {mode==="dashboard"&&<>
   <div className="f7-toolbar"><label className="f7-month"><span>Qual mês quer acompanhar?</span>
    <input type="month" aria-label="Mês para acompanhar" value={month}
     min="2000-01" max="2099-12" onChange={e=>{setMonth(e.target.value);setReviewed(false);}}/></label>
    <Button variant="secondary" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>
     <RefreshCcw size={16}/>Atualizar informações</Button></div>
   {loading&&<Card><Skeleton lines={4}/></Card>}
   {currentSummary&&<><Card className="f7-advisor">
    <div className="f7-advisor-heading"><div><span className="eyebrow">Guia de bolso · {monthLabel(month)}</span>
     <h2>Quanto posso gastar sem faltar para as contas?</h2>
     <p>Primeiro separe o dinheiro dos compromissos; só depois pense no que sobra.</p></div>
     <Badge tone="info">Estimativa conservadora</Badge></div>
    <div className="f7-steps">
     <label><strong><span className="f7-number">1</span> Quanto há disponível no banco agora?</strong>
      <span>Use o saldo atual do aplicativo do banco, não uma nota fiscal que falta receber.</span>
      <div className="f7-input-money"><span>R$</span><input type="text" inputMode="decimal"
       aria-label="Saldo disponível agora no banco" placeholder="Ex.: 5.000,00"
       value={balance} onChange={e=>{setBalance(e.target.value);setReviewed(false);}}/></div>
      {preview&&<button type="button" className="f7-text-button"
       onClick={()=>setBalance(fictitiousBalanceHint())}>Preencher saldo de exemplo</button>}
     </label>
     <label><strong><span className="f7-number">2</span> Quer guardar uma reserva?</strong>
      <span>Se houver dinheiro que você não quer gastar, separe aqui. Pode deixar em branco.</span>
      <div className="f7-input-money"><span>R$</span><input type="text" inputMode="decimal"
       aria-label="Reserva que não quero gastar" placeholder="Ex.: 500,00"
       value={reserve} onChange={e=>{setReserve(e.target.value);setReviewed(false);}}/></div>
     </label>
    </div>
    <label className="f7-confirm"><input type="checkbox" checked={reviewed}
     onChange={e=>setReviewed(e.target.checked)}/>
     <span><strong>3. Conferi minhas contas deste mês.</strong>
      Sei que compromissos não cadastrados podem mudar o cálculo.</span></label>
    <div className="f7-budget" aria-live="polite">
     <span>Quanto sobra depois de reservar para as contas registradas?</span>
     {spending?.kind==="available"||spending?.kind==="shortfall"?
      <><strong className="f7-budget-value">{money(spending.allowedCent)}</strong>
       <p>{spending.kind==="shortfall"?
        "Atenção: falta "+money(spending.shortfallCent)+" para cobrir contas registradas e reserva. Não há folga planejada.":
        "Este é o máximo estimado para despesas extras, considerando seu saldo informado e todas as contas cadastradas."}</p></>:
      <><strong className="f7-budget-value f7-budget-value--pending">Ainda não calculado</strong>
       <p>{spending?.kind==="incomplete"?
        "Existem despesas sem valor/data confiável. Corrija antes de calcular um limite.":
        spending?.kind==="not_current"?
        "Para meses diferentes do atual mostramos previsões, mas não calculamos quanto gastar usando o saldo de hoje.":
        spending?.kind==="confirm_bills"?
        "Marque a confirmação do passo 3 para ver uma estimativa.":
        "Informe o saldo atual do banco no passo 1. Sem ele não existe saldo disponível confiável."}</p></>}
    </div>
    <details className="f7-why"><summary><CircleHelp size={17}/>Como chegamos a esse valor?</summary>
     <p>Saldo informado hoje − contas ainda não pagas até o fim de {monthLabel(month)}
      (incluindo atrasadas) − reserva escolhida. Pagamentos anteriores já estão refletidos
      no saldo atual informado e por isso não são descontados novamente.
      Valores prometidos por clientes ou órgãos <strong>não são somados</strong>.</p>
     <p>É uma estimativa para os compromissos cadastrados, não um extrato bancário,
      crédito aprovado ou garantia de que todos os gastos foram registrados.</p>
    </details>
   </Card>
   <Card className="f7-section"><SectionHeading eyebrow="Quatro respostas rápidas"
    title="Como está o mês?"/>
    <div className="f7-metrics">
     <Metric title="Ainda precisa pagar" value={currentSummary.payable.outstandingToEndCent}
      detail="Contas em aberto até o fim do mês, incluindo atrasadas e recorrências não lançadas." emphasis/>
     <Metric title="Já pagou no mês" value={currentSummary.payable.paidInMonthCent}
      detail="Pagamentos registrados e não desfeitos. Não descontamos de novo do saldo de hoje."/>
     <Metric title="Já entrou de verdade" value={currentSummary.receivable.creditedInMonthCent}
      detail="Créditos registrados e não estornados; retenções não são dinheiro recebido."/>
     <Metric title="Ainda pode entrar no mês" value={currentSummary.receivable.expectedDueInMonthCent}
      detail="Parcelas com previsão de vencimento neste mês. Não são saldo disponível."/>
    </div>
    <div className="f7-disclosures">
     <span><Clock3 size={17}/> Contas de meses anteriores ainda abertas: {money(currentSummary.payable.overdueBeforeMonthCent)}</span>
     <span><CalendarClock size={17}/> Recebimentos atrasados de meses anteriores: {money(currentSummary.receivable.overdueBeforeMonthCent)}</span>
     <span><CheckCircle2 size={17}/> Retenções confirmadas neste mês: {money(currentSummary.receivable.retainedInMonthCent)} (não entraram no banco)</span>
    </div>
    {currentSummary.warnings.outgoing.length>0&&<Information title="Faltam dados sobre contas a pagar"
     items={currentSummary.warnings.outgoing}/>}
    {currentSummary.warnings.incoming.length>0&&<Information title="Recebimentos que precisam de atenção"
     items={currentSummary.warnings.incoming}/>}
   </Card>
   <div className="f7-two">
    <Card className="f7-section"><SectionHeading eyebrow="Até o fim do mês" title="O que ainda precisa sair"/>
     <p className="f7-sub">Incluímos também contas antigas ainda pendentes. Confira a data antes de pagar.</p>
     {currentSummary.payable.upcoming.length===0?<EmptyState title="Nenhuma conta pendente conhecida"
      message="Confira se todas as despesas foram cadastradas."/>:
      <ul className="f7-agenda">{currentSummary.payable.upcoming.slice(0,7).map(x=>
       <li key={x.id}><span className="f7-agenda-date">{dayLabel(x.due)}</span>
        <span className="f7-agenda-name">{x.name}
         <small>{x.overdue?"Prazo já passou":"Ainda não foi pago"}</small></span>
        <strong>{money(x.amountCent)}</strong></li>)}</ul>}
     <Button variant="secondary" onClick={()=>onNavigate("titles")}>Ver contas a pagar <ArrowRight size={16}/></Button>
    </Card>
    <Card className="f7-section"><SectionHeading eyebrow="Receita esperada" title="O que ainda pode entrar"/>
     <p className="f7-sub">Valores previstos não entram no limite seguro antes de serem confirmados.</p>
     {currentSummary.receivable.upcoming.length===0?<EmptyState title="Sem parcelas datadas"
      message="Verifique se as notas possuem datas previstas de recebimento."/>:
      <ul className="f7-agenda">{currentSummary.receivable.upcoming.slice(0,7).map(x=>
       <li key={x.id}><span className="f7-agenda-date">{dayLabel(x.due)}</span>
        <span className="f7-agenda-name">{x.name}
         <small>{x.overdue?"Recebimento atrasado":"Ainda não foi recebido"}</small></span>
        <strong>{money(x.amountCent)}</strong></li>)}</ul>}
     <Button onClick={()=>onNavigate("receivables")}>Acompanhar recebimentos <ArrowRight size={16}/></Button>
    </Card>
   </div>
   <Card className="f7-section f7-learning"><SectionHeading title="Entenda sem precisar ser contador"/>
    <details><summary>Uma nota fiscal é dinheiro que já recebi?</summary>
     <p>Não. A nota mostra o que foi faturado. Só marcamos dinheiro como recebido depois de conferir que o crédito entrou na conta.</p></details>
    <details><summary>Uma conta paga ainda diminui o que posso gastar?</summary>
     <p>Se você informou o saldo do banco hoje, o pagamento que já saiu do banco já foi descontado desse saldo. Subtrair de novo seria contar duas vezes.</p></details>
    <details><summary>E quando o órgão retém impostos?</summary>
     <p>O valor retido precisa de atestado/documento verificado. Ele reduz o que falta liquidar da parcela, mas não aparece como dinheiro na conta.</p></details>
    <details><summary>Se faltar alguma conta cadastrada?</summary>
     <p>A estimativa pode ficar maior que a folga verdadeira. Cadastre suas contas recorrentes e pagamentos pendentes antes de decidir novos gastos.</p></details>
   </Card>
   </>}
  </>}
  {mode==="receivables"&&<>
   {screen==="list"&&<Card className="f7-section">
    <SectionHeading title="Parcelas das notas fiscais" eyebrow="A receber e recebido">
     <Button variant="secondary" onClick={()=>onNavigate("overview")}>Ver meu caixa</Button>
    </SectionHeading>
    <div className="f7-filters">
     <label><span>Situação</span><select aria-label="Situação da cobrança" value={stateFilter}
      onChange={e=>setStateFilter(e.target.value as typeof stateFilter)}>
      <option value="open">Ainda falta receber</option><option value="settled">Já recebidas</option>
      <option value="all">Todas as parcelas</option></select></label>
     <label><span>Buscar NF ou empenho</span><input type="search" value={query}
      maxLength={80} onChange={e=>setQuery(e.target.value)} aria-label="Buscar cobranças"/></label>
     <Button variant="secondary" onClick={()=>setRefresh(v=>v+1)} disabled={loading}>
      <RefreshCcw size={16}/>Atualizar</Button>
    </div>
    {loading&&<Skeleton lines={3}/>}
    {!loading&&displayedRows.length===0&&<EmptyState title="Nenhuma parcela encontrada"
     message="Acompanhe notas fiscais cadastradas ou ajuste o filtro."/>}
    {displayedRows.length>0&&<div className="table-scroll"><table className="f4-table">
     <thead><tr><th>Nota e parcela</th><th>Previsão</th><th>Falta receber</th><th>Situação</th><th>O que fazer?</th></tr></thead>
     <tbody>{displayedRows.map(x=>{
      const status=receiptStatus(x);
      return <tr key={x.id}><td className="f4-name"><strong>{label(x)}</strong><small>Parcela {x.parcela} · {x.empenho_numero||"Empenho"}</small></td>
       <td>{x.vencimento?dayLabel(x.vencimento):"Sem data prevista"}</td>
       <td><strong>{money(x.saldo_cent)}</strong></td>
       <td><Badge tone={status==="done"?"success":status==="pending"?"warning":
        status==="unknown"?"danger":"neutral"}>{status==="done"?"Recebido":
        status==="pending"?"Falta receber":status==="canceled"?"Cancelada":"Conferir valores"}</Badge></td>
       <td><Button variant="secondary" onClick={()=>open(x.id)}>Abrir parcela</Button></td></tr>;
     })}</tbody></table></div>}
    {!!cursor&&!preview&&<Button variant="secondary" disabled={loading}
     onClick={()=>void loadList(cursor)}>Carregar mais</Button>}
   </Card>}
   {screen==="detail"&&<><Button variant="ghost" className="f4-back" onClick={back}>
     <ArrowLeft size={16}/>Voltar às parcelas</Button>
    {loading&&<Card><Skeleton lines={4}/></Card>}
    {detail&&<><Card className="f7-section"><SectionHeading eyebrow="Ficha da parcela"
      title={label(detail.item)+" · parcela "+detail.item.parcela}>
      <Badge tone={receiptStatus(detail.item)==="done"?"success":"warning"}>
       {receiptStatus(detail.item)==="done"?"Liquidada":"A conferir / receber"}</Badge></SectionHeading>
      <div className="f7-metrics f7-metrics--detail">
       <Metric title="Valor da parcela" value={detail.item.valor_bruto_cent} detail="Valor originalmente faturado"/>
       <Metric title="Já entrou no banco" value={detail.item.creditado_cent} detail="Créditos ativos registrados"/>
       <Metric title="Retido" value={detail.item.retido_cent} detail="Não é dinheiro em conta"/>
       <Metric title="Ainda falta receber" value={detail.item.saldo_cent} detail="Saldo após créditos e retenções"/>
      </div>
      <div className="f7-detail-tags">
       <span><strong>Data prevista:</strong> {detail.item.vencimento?dayLabel(detail.item.vencimento):"não informada"}</span>
       <span><strong>Origem:</strong> {detail.item.origem_dado}</span>
       <span><strong>Versão:</strong> {detail.item.versao}</span>
      </div>
      <Button variant="secondary" onClick={()=>onNavigate("invoices")}>
       Consultar notas fiscais <ChevronRight size={15}/></Button></Card>
      {detail.item.saldo_cent!==null&&detail.item.saldo_cent>0&&
       detail.item.cancelada===0&&detail.item.nf_situacao!=="CANCELADA"&&
       <Card className="f7-section"><SectionHeading eyebrow="Registro operacional" title="Dinheiro que realmente entrou"/>
        <Notice title="Não marque pela promessa de pagamento">
         A nota emitida ou o vencimento não confirmam o crédito. Confira primeiro seu extrato bancário.</Notice>
        <form className="f7-form" onSubmit={e=>void confirmCredit(e)}>
         <label><span>Quanto entrou no banco? (R$)</span>
          <input type="text" inputMode="decimal" aria-label="Valor recebido no banco" required
           placeholder="Ex.: 1.000,00" value={amount} onChange={e=>{setAmount(e.target.value);setCreditConfirmed(false);}}/>
          <small>Falta receber: {money(detail.item.saldo_cent)}. Pode registrar pagamento parcial.</small></label>
         <label><span>Em que dia entrou?</span><input type="date" aria-label="Data em que o crédito entrou"
          value={date} onChange={e=>setDate(e.target.value)} required/></label>
         <details className="f7-advanced"><summary>Houve imposto retido ou tem referência de banco? (opcional)</summary>
          <div className="f7-form">
           <label><span>Retenção atestada (R$)</span><input type="text" inputMode="decimal"
            value={retention} onChange={e=>setRetention(e.target.value)}
            aria-label="Valor de retenção atestada" placeholder="0,00"/>
            <small>Retenção não é depósito; exige atestado documental válido.</small></label>
           <label><span>Atestado de retenção verificado</span><input value={attestationId}
            onChange={e=>setAttestationId(e.target.value)} aria-label="ID do atestado"
            placeholder="Identificador fornecido por administrador"/></label>
           <label><span>Conta de destino (opcional)</span><input value={accountDst}
            onChange={e=>setAccountDst(e.target.value)} aria-label="Conta de destino"/></label>
           <label><span>Referência do extrato (opcional)</span><input value={reference}
            onChange={e=>setReference(e.target.value)} aria-label="Referência do extrato"/></label>
          </div>
         </details>
         <label className="f7-confirm"><input type="checkbox" checked={creditConfirmed}
          onChange={e=>setCreditConfirmed(e.target.checked)}/>
          <span><strong>Conferi o extrato.</strong> Este valor realmente entrou na conta.</span></label>
         <Button type="submit" disabled={!canWrite||busy||!creditConfirmed}>
          {busy?"Registrando…":"Confirmar dinheiro recebido"}</Button>
        </form>
       </Card>}
      {detail.item.origem_dado==="NATIVO"&&detail.events.length===0&&
       detail.item.cancelada===0&&<Card className="f7-section">
       <SectionHeading title="Quando deve receber?" eyebrow="Data para organizar o mês"/>
       <p className="f7-sub">Notas novas podem ficar sem vencimento. Informe a data combinada com o órgão, para que a previsão entre no mês certo.</p>
       <form className="f7-form" onSubmit={e=>void updateDue(e)}>
        <label><span>Data de recebimento prevista</span><input type="date"
         aria-label="Data prevista de recebimento" required value={schedule}
         onChange={e=>setSchedule(e.target.value)}/></label>
        <label><span>Por que essa data?</span><input type="text"
         aria-label="Motivo da data prevista" required maxLength={1500}
         placeholder="Ex.: prazo informado pelo órgão" value={scheduleReason}
         onChange={e=>setScheduleReason(e.target.value)}/></label>
        <Button type="submit" disabled={!canWrite||busy}>Salvar previsão</Button>
       </form>
      </Card>}
      {admin&&<details className="f7-admin">
       <summary>Administração: atestar uma retenção com documento verificado</summary>
       <p>Esta opção exige comprovante de retenção com integridade VERIFICADA no D1/R2/Drive.
        O simples número de uma nota não serve como atestado.</p>
       <form className="f7-form" onSubmit={e=>void attest(e)}>
        <label><span>Versão do documento verificado</span><input value={attestDoc}
         onChange={e=>setAttestDoc(e.target.value)} aria-label="Versão do comprovante"/></label>
        <label><span>Retenção comprovada (R$)</span><input value={attestValue}
         inputMode="decimal" onChange={e=>setAttestValue(e.target.value)}
         aria-label="Retenção comprovada"/></label>
        <Button type="submit" disabled={busy}>Atestar retenção com documento</Button>
       </form></details>}
      <Card className="f7-section"><SectionHeading title="Histórico de entradas e estornos" eyebrow="Nada é apagado"/>
       {detail.events.length===0?<EmptyState title="Nenhum crédito registrado"
        message="O fato de existir uma nota fiscal não significa que houve depósito."/>:
        <ul className="f7-events">{detail.events.map(e=>{
         const reversed=e.tipo_movimento==="RECEBIMENTO"&&detail.events.some(v=>
          v.tipo_movimento==="ESTORNO"&&v.estorno_de_id===e.id);
         return <li key={e.id}><div><strong>{e.tipo_movimento==="ESTORNO"?
            "Estorno do registro":"Dinheiro registrado"}</strong>
           <small>{dayLabel(e.data_credito)} · {reversed?"Estornado — não conta mais como entrada":
            (e.tipo_movimento==="ESTORNO"?"Não transfere dinheiro":"Crédito ativo")}</small>
           {e.motivo&&<p>Motivo: {e.motivo}</p>}</div>
          <div><strong>{money(e.valor_recebido_cent)}</strong>
           {e.retencao_confirmada_cent>0&&<small>Retido: {money(e.retencao_confirmada_cent)}</small>}
           {e.tipo_movimento==="RECEBIMENTO"&&!reversed&&
            <Button variant="secondary" disabled={!canWrite||busy}
             onClick={()=>{resetAction();setReverseId(e.id);setReverseConfirmed(false);}}>
             Corrigir lançamento</Button>}
          </div></li>;
        })}</ul>}
       {reverseId&&<form className="f7-form f7-reversal" onSubmit={e=>void confirmReversal(e)}>
        <h3>Desfazer registro de recebimento</h3>
        <p>Isso corrige o histórico do sistema; NÃO realiza transferência ou estorno no banco.</p>
        <label><span>Por que está corrigindo?</span><input required value={reverseReason}
         onChange={e=>setReverseReason(e.target.value)} aria-label="Motivo do estorno"
         placeholder="Ex.: valor registrado em duplicidade"/></label>
        <label className="f7-confirm"><input type="checkbox" checked={reverseConfirmed}
         onChange={e=>setReverseConfirmed(e.target.checked)}/>
         <span>Entendi: o estorno é apenas contábil, não movimenta o banco.</span></label>
        <div className="f7-actions">
         <Button variant="secondary" onClick={()=>{setReverseId(null);resetAction();}}>
          Cancelar</Button>
         <Button type="submit" disabled={!reverseConfirmed||busy}>Confirmar correção</Button></div>
       </form>}
      </Card>
     </>}
   </>}
  </>}
 </div>;
}
