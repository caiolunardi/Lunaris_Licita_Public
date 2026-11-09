// F7 — apresentação financeira conservadora. Funções puras; centavos inteiros.
// O "quanto posso gastar" NUNCA considera NF pendente, crédito previsto ou saldo inventado.
// O cliente só pode calcular com saldo atual INFORMADO, reserva e conferência explícita.
import {dueDateForCompetence} from "../../src/r7/domain.mjs";
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
const MAX_LINES=5000;
export const validMonth=s=>typeof s==="string"&&/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(s);
const isMoney=v=>Number.isSafeInteger(v)&&v>=0&&BigInt(v)<=MAX;
const validDate=s=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s);
function add(sum,v){
 if(!isMoney(v))throw new Error("unreconciled_amount");
 const n=sum+BigInt(v);
 if(n>MAX)throw new Error("money_overflow");
 return n;
}
function addKnown(sum,v,label,incomplete){
 if(!isMoney(v)){incomplete.add(label);return sum;}
 return add(sum,v);
}
function num(n){if(n<0n||n>MAX)throw new Error("money_overflow");return Number(n);}
function bounded(records){
 if(!Array.isArray(records)||records.length>MAX_LINES)throw new Error("aggregate_too_large");
 return records;
}
function safeLabel(value){
 return typeof value==="string"?value.slice(0,180):"Compromisso sem descrição";
}
export function summarizeCashflow({month,today,bills=[],rules=[],ruleEnds={},revisions=[],
 receivables=[],credits=[],payments=[]}){
 if(!validMonth(month)||!validDate(today))throw new Error("invalid_month");
 for(const records of [bills,rules,revisions,receivables,credits,payments])bounded(records);
 const monthStart=month+"-01",monthEnd=dueDateForCompetence(month,31);
 const currentMonth=today.slice(0,7);
 const outputWarnings=new Set(),inputWarnings=new Set();
 const hasTitle=new Set();
 let pendingBills=0n,dueThisMonth=0n,overdueBills=0n,paidThisMonth=0n;
 let recurringExpected=0n,invoiceExpected=0n,invoiceOverdue=0n,creditedThisMonth=0n,retainedThisMonth=0n;
 let uncreditedTotal=0n,missingDueBills=0,missingDueReceivables=0,openBillsCount=0,openReceivablesCount=0;
 const upcomingBills=[],upcomingReceivables=[];
 for(const bill of bills){
  if(bill.recorrencia_id&&bill.competencia===month)hasTitle.add(bill.recorrencia_id);
  if(bill.cancelado===1||bill.situacao==="CANCELADO")continue;
  if(bill.situacao==="PAGO_LEGADO_SEM_BAIXA"){
   outputWarnings.add("Pagamento histórico sem evento de baixa verificável");continue;
  }
  if(!["ABERTO","PAGO"].includes(bill.situacao)){
   outputWarnings.add("Há contas com situação desconhecida");continue;
  }
  if(bill.situacao==="PAGO")continue;
  if(bill.origem_dado==="LEGADO"&&bill.conferencia!=="VALIDADO"||
   !isMoney(bill.valor_nominal_cent)||bill.valor_nominal_cent===0){
   outputWarnings.add("Há contas antigas ou valores ainda não conferidos");continue;
  }
  const due=bill.vencimento;
  if(!validDate(due)){missingDueBills++;outputWarnings.add("Há contas a pagar sem vencimento confirmado");continue;}
  if(due<=monthEnd){
   pendingBills=add(pendingBills,bill.valor_nominal_cent);
   openBillsCount++;
   if(due<monthStart)overdueBills=add(overdueBills,bill.valor_nominal_cent);
   else dueThisMonth=add(dueThisMonth,bill.valor_nominal_cent);
   upcomingBills.push({id:bill.id,due,name:safeLabel(bill.nome),amountCent:bill.valor_nominal_cent,
    overdue:due<today,kind:"title"});
  }
 }
 for(const rule of rules){
  if(rule.estado!=="ATIVA"||hasTitle.has(rule.id)||
   !validDate(rule.primeiro_vencimento)||rule.primeiro_vencimento.slice(0,7)>month||
   ruleEnds[rule.id]&&ruleEnds[rule.id]<month)continue;
  if(rule.origem_dado==="LEGADO"&&rule.conferencia!=="VALIDADO"||
   !isMoney(rule.valor_atual_cent)||rule.valor_atual_cent===0){
   outputWarnings.add("Recorrências não conferidas ou sem valor");continue;
  }
  if(revisions.some(rv=>rv.recorrencia_id===rule.id&&rv.tipo==="VALOR"&&
    rv.vigente_a_partir>month&&rule.primeiro_vencimento.slice(0,7)<=month)){
   outputWarnings.add("Há reajuste futuro que impede reconstruir valor histórico");continue;
  }
  const due=dueDateForCompetence(month,rule.dia_vencimento);
  recurringExpected=add(recurringExpected,rule.valor_atual_cent);
  dueThisMonth=add(dueThisMonth,rule.valor_atual_cent);
  pendingBills=add(pendingBills,rule.valor_atual_cent);
  openBillsCount++;
  upcomingBills.push({id:rule.id,due,name:safeLabel(rule.beneficiario)+" (recorrente)",
   amountCent:rule.valor_atual_cent,overdue:due<today,kind:"recurrence"});
 }
 for(const event of payments){
  if(event.origem_dado==="LEGADO"&&event.conferencia!=="VALIDADO"||
   !isMoney(event.valor_pago_cent)||!validDate(event.data_pagamento)){
   outputWarnings.add("Baixa de pagamento sem confirmação");continue;
  }
  if(event.data_pagamento.slice(0,7)===month)
   paidThisMonth=add(paidThisMonth,event.valor_pago_cent);
 }
 for(const account of receivables){
  if(account.cancelada===1||account.nf_situacao==="CANCELADA")continue;
  if(!["EMITIDA","APRESENTADA"].includes(account.nf_situacao))continue;
  if(account.origem_dado==="LEGADO"&&account.conferencia!=="VALIDADO"||
   account.nf_origem==="LEGADO"&&account.nf_conferencia!=="VALIDADO"||
   account.estado_saldo!=="CONFERIDO"||!isMoney(account.saldo_cent)){
   inputWarnings.add("Há notas, parcelas ou recebimentos não conferidos");continue;
  }
  const open=account.saldo_cent;
  if(open===0)continue;
  uncreditedTotal=add(uncreditedTotal,open);
  openReceivablesCount++;
  if(!validDate(account.vencimento)){
   missingDueReceivables++;
   inputWarnings.add("Há parcelas sem data prevista para receber");continue;
  }
  if(account.vencimento>=monthStart&&account.vencimento<=monthEnd)
   invoiceExpected=add(invoiceExpected,open);
  else if(account.vencimento<monthStart)invoiceOverdue=add(invoiceOverdue,open);
  if(account.vencimento<=monthEnd)
   upcomingReceivables.push({id:account.id,due:account.vencimento,
    name:"Parcela "+account.parcela+" · "+safeLabel(account.nf_numero||account.nota_fiscal_id),
    amountCent:open,overdue:account.vencimento<today});
 }
 for(const event of credits){
  if(event.origem_dado==="LEGADO"&&event.conferencia!=="VALIDADO"||
   !validDate(event.data_credito)||event.data_credito>today||!isMoney(event.valor_recebido_cent)||
   !isMoney(event.retencao_confirmada_cent)){
   inputWarnings.add("Há créditos ou retenções não conferidos");continue;
  }
  if(event.data_credito.slice(0,7)===month){
   creditedThisMonth=add(creditedThisMonth,event.valor_recebido_cent);
   retainedThisMonth=add(retainedThisMonth,event.retencao_confirmada_cent);
  }
 }
 upcomingBills.sort((a,b)=>a.due.localeCompare(b.due)||a.id.localeCompare(b.id));
 upcomingReceivables.sort((a,b)=>a.due.localeCompare(b.due)||a.id.localeCompare(b.id));
 // Todo pagamento já realizado está refletido no saldo ATUAL INFORMADO pelo usuário;
 // subtraí-lo novamente seria cobrar duas vezes. Entradas ainda a receber não são caixa.
 return {
  month,today,currentMonth,eligibleForSpendEstimate:month===currentMonth&&outputWarnings.size===0,
  payable:{outstandingToEndCent:num(pendingBills),dueInMonthCent:num(dueThisMonth),
   overdueBeforeMonthCent:num(overdueBills),paidInMonthCent:num(paidThisMonth),
   recurringNotMaterializedCent:num(recurringExpected),openCount:openBillsCount,
   missingDueCount:missingDueBills,upcoming:upcomingBills.slice(0,12)},
  receivable:{expectedDueInMonthCent:num(invoiceExpected),overdueBeforeMonthCent:num(invoiceOverdue),
   creditedInMonthCent:num(creditedThisMonth),retainedInMonthCent:num(retainedThisMonth),
   remainingTotalCent:num(uncreditedTotal),openCount:openReceivablesCount,
   missingDueCount:missingDueReceivables,upcoming:upcomingReceivables.slice(0,12)},
  warnings:{outgoing:[...outputWarnings].sort(),incoming:[...inputWarnings].sort()},
  basis:"Saldos em centavos; entradas pendentes nunca compõem o limite seguro."
 };
}
