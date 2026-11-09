// Valores estritamente sintéticos; separados por empresa e nunca usados em modo server.
import {localDate,localMonth,moneyInput,type Summary,type Account,type CreditEvent,type AccountDetail} from "./types";
const ymd=(m:string,day:number)=>m+"-"+String(Math.max(1,Math.min(day,
 new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).getUTCDate()))).padStart(2,"0");
const base=(id:string,amount:number,due:string|null,credited=0):Account=>({
 id,nota_fiscal_id:"f7-demo-invoice",parcela:1,valor_bruto_cent:amount,
 retencao_prevista_cent:null,vencimento:due,cancelada:0,origem_dado:"NATIVO",
 conferencia:"VALIDADO",versao:1,saldo_cent:amount-credited,estado_saldo:"CONFERIDO",
 creditado_cent:credited,retido_cent:0,nf_numero:"NF FICTÍCIA 001",nf_serie:"1",
 nf_situacao:"EMITIDA",nf_versao:1,nf_origem:"NATIVO",nf_conferencia:"VALIDADO",
 empenho_id:"f7-demo-empenho",empenho_numero:"NE de exemplo",licitacao_id:"f7-demo-licitacao"});
export function demoAccounts(company:string,month=localMonth()):AccountDetail[]{
 if(company.includes("horizonte"))return [{
  item:{...base("f7-demo-h-1",45000,null),nf_numero:"NF Horizonte fictícia"},
  events:[]}];
 return [
  {item:{...base("f7-demo-a-1",350000,ymd(month,22)),parcela:1},events:[]},
  {item:{...base("f7-demo-a-2",120000,ymd(month,3)),parcela:2},events:[]},
  {item:{...base("f7-demo-a-3",95000,ymd(month,8),95000),parcela:3},
   events:[{id:"f7-demo-credit-1",tipo_movimento:"RECEBIMENTO",estorno_de_id:null,
    data_credito:ymd(month,8),valor_recebido_cent:95000,retencao_confirmada_cent:0,
    conta_destino:null,referencia_externa:null,motivo:null,criado_em:null,
    origem_dado:"NATIVO",conferencia:"VALIDADO",retencao_atestado_id:null}]}
 ];
}
export function demoSummary(company:string,month:string,accounts:AccountDetail[]):Summary{
 const today=localDate(),currentMonth=today.slice(0,7),h=company.includes("horizonte");
 const bill1=h?22750:129990,bill2=h?0:37900,rec=h?9900:14990,paid=h?18200:57000;
 const pending=bill1+bill2+rec,items=accounts.filter(x=>
  x.item.cancelada===0&&x.item.nf_situacao!=="CANCELADA");
 const credits=items.flatMap(x=>x.events.filter(e=>e.tipo_movimento==="RECEBIMENTO"&&
  !x.events.some(v=>v.tipo_movimento==="ESTORNO"&&v.estorno_de_id===e.id)));
 const cash=credits.filter(x=>x.data_credito.slice(0,7)===month)
  .reduce((s,x)=>s+x.valor_recebido_cent,0);
 const dueMonth=items.filter(x=>x.item.vencimento?.slice(0,7)===month)
  .reduce((s,x)=>s+(x.item.saldo_cent||0),0);
 const overdue=items.filter(x=>x.item.vencimento&&x.item.vencimento.slice(0,7)<month)
  .reduce((s,x)=>s+(x.item.saldo_cent||0),0);
 const allUnpaid=items.reduce((s,x)=>s+(x.item.saldo_cent||0),0);
 return {month,today,currentMonth,eligibleForSpendEstimate:month===currentMonth,
  payable:{outstandingToEndCent:pending,dueInMonthCent:pending,overdueBeforeMonthCent:0,
   paidInMonthCent:paid,recurringNotMaterializedCent:rec,openCount:h?2:3,
   missingDueCount:0,upcoming:[{id:"f7-demo-bill-1",due:ymd(month,15),
    name:h?"Energia Horizonte (fictícia)":"Fornecedor Aurora (fictício)",
    amountCent:bill1,overdue:ymd(month,15)<today,kind:"title"},
    ...(!h?[{id:"f7-demo-bill-2",due:ymd(month,20),
      name:"Despesas de operação (fictícias)",amountCent:bill2,
      overdue:ymd(month,20)<today,kind:"title"}]:[])]},
  receivable:{expectedDueInMonthCent:dueMonth,overdueBeforeMonthCent:overdue,
   creditedInMonthCent:cash,retainedInMonthCent:0,remainingTotalCent:allUnpaid,
   openCount:items.filter(x=>(x.item.saldo_cent||0)>0).length,
   missingDueCount:items.filter(x=>!x.item.vencimento&&(x.item.saldo_cent||0)>0).length,
   upcoming:items.filter(x=>x.item.vencimento&&x.item.saldo_cent&&x.item.vencimento<=ymd(month,31))
    .map(x=>({id:x.item.id,due:x.item.vencimento!,name:"Parcela "+x.item.parcela+
      " — "+(x.item.nf_numero||"Nota fictícia"),amountCent:x.item.saldo_cent!,
      overdue:x.item.vencimento!<today}))},
  warnings:{outgoing:[],incoming:items.some(x=>!x.item.vencimento)?
   ["Há parcelas sem data prevista para receber"]:[]},
  basis:"Demonstração fictícia; nenhuma fonte bancária foi consultada."};
}
export function demoCredit(account:AccountDetail,credit:number,day:string):AccountDetail{
 const id="f7-demo-received-"+crypto.randomUUID();
 const ev:CreditEvent={id,tipo_movimento:"RECEBIMENTO",estorno_de_id:null,
  data_credito:day,valor_recebido_cent:credit,retencao_confirmada_cent:0,
  conta_destino:null,referencia_externa:null,motivo:null,criado_em:null,
  origem_dado:"NATIVO",conferencia:"VALIDADO",retencao_atestado_id:null};
 return {item:{...account.item,creditado_cent:account.item.creditado_cent+credit,
  saldo_cent:(account.item.saldo_cent||0)-credit},events:[...account.events,ev]};
}
export function demoReversal(account:AccountDetail,creditId:string,motivo:string):AccountDetail{
 const original=account.events.find(x=>x.id===creditId);
 if(!original)return account;
 const ev:CreditEvent={...original,id:"f7-demo-reverse-"+crypto.randomUUID(),
  tipo_movimento:"ESTORNO",estorno_de_id:creditId,motivo};
 return {item:{...account.item,creditado_cent:account.item.creditado_cent-original.valor_recebido_cent,
  saldo_cent:(account.item.saldo_cent||0)+original.valor_recebido_cent},
  events:[...account.events,ev]};
}
export function fictitiousBalanceHint():string{return moneyInput(560000);}
