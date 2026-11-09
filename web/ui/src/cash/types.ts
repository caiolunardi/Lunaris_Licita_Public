import type {IdentityState} from "../identity/session";
export type Mode="dashboard"|"receivables";
export type PageProps={mode:Mode;identity:IdentityState;onIdentity:()=>void;
 onNavigate:(target:"receivables"|"titles"|"invoices"|"overview")=>void};
export type CashLine={id:string;due:string;name:string;amountCent:number;
 overdue:boolean;kind?:string};
export type Summary={
 month:string;today:string;currentMonth:string;eligibleForSpendEstimate:boolean;
 payable:{outstandingToEndCent:number;dueInMonthCent:number;overdueBeforeMonthCent:number;
  paidInMonthCent:number;recurringNotMaterializedCent:number;openCount:number;
  missingDueCount:number;upcoming:CashLine[]};
 receivable:{expectedDueInMonthCent:number;overdueBeforeMonthCent:number;
  creditedInMonthCent:number;retainedInMonthCent:number;remainingTotalCent:number;
  openCount:number;missingDueCount:number;upcoming:CashLine[]};
 warnings:{outgoing:string[];incoming:string[]};basis:string;
};
export type Account={id:string;nota_fiscal_id:string;parcela:number;valor_bruto_cent:number|null;
 retencao_prevista_cent:number|null;vencimento:string|null;cancelada:0|1;
 origem_dado:string;conferencia:string;versao:number;saldo_cent:number|null;
 estado_saldo:string;creditado_cent:number;retido_cent:number;nf_numero:string|null;
 nf_serie:string|null;nf_situacao:string;nf_versao:number;nf_origem:string;
 nf_conferencia:string;empenho_id:string;empenho_numero:string|null;licitacao_id:string};
export type CreditEvent={id:string;tipo_movimento:"RECEBIMENTO"|"ESTORNO";
 estorno_de_id:string|null;data_credito:string;valor_recebido_cent:number;
 retencao_confirmada_cent:number;conta_destino:string|null;
 referencia_externa:string|null;motivo:string|null;criado_em:string|null;
 origem_dado:string;conferencia:string;retencao_atestado_id:string|null};
export type AccountDetail={item:Account;events:CreditEvent[]};
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
export function parseBRL(value:string,{signed=false}={}):number|null{
 const s=value.trim();
 if(!/^-?(?:(?:\d{1,3}(?:\.\d{3})+)|(?:\d{1,14}))(?:,\d{1,2})?$/.test(s))return null;
 if(!signed&&s.startsWith("-"))return null;
 const negative=s.startsWith("-"),str=negative?s.slice(1):s;
 const parts=str.replace(/\./g,"").split(",");
 const cents=BigInt(parts[0])*100n+BigInt((parts[1]||"").padEnd(2,"0"));
 if(cents>MAX)return null;
 return Number(negative?-cents:cents);
}
export const money=(v:number|null|undefined):string=>
 v===null||v===undefined||!Number.isSafeInteger(v)?"Valor não conferido":
  new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v/100);
export function moneyInput(v:number):string{
 return (v/100).toFixed(2).replace(".",",");
}
export function localMonth(date=new Date()):string{
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",
  year:"numeric",month:"2-digit"}).formatToParts(date);
 return parts.find(x=>x.type==="year")!.value+"-"+parts.find(x=>x.type==="month")!.value;
}
export function localDate(date=new Date()):string{
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
 const get=(k:string)=>parts.find(x=>x.type===k)!.value;
 return get("year")+"-"+get("month")+"-"+get("day");
}
export function dayLabel(iso:string):string{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))return "Sem data definida";
 return new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC",day:"2-digit",month:"short"})
  .format(new Date(iso+"T12:00:00Z"));
}
export function monthLabel(iso:string):string{
 if(!/^\d{4}-\d{2}$/.test(iso))return iso;
 return new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC",month:"long",year:"numeric"})
  .format(new Date(iso+"-15T12:00:00Z"));
}
export type Spending={
 kind:"enter_balance"|"confirm_bills"|"incomplete"|"not_current"|"available"|"shortfall";
 allowedCent:number|null;shortfallCent:number|null;
};
export function planSpending(summary:Summary,balanceRaw:string,reserveRaw:string,
 verifiedBills:boolean):Spending{
 if(summary.month!==summary.currentMonth)return {kind:"not_current",allowedCent:null,shortfallCent:null};
 const bal=parseBRL(balanceRaw,{signed:true});
 const reserve=reserveRaw.trim()===""?0:parseBRL(reserveRaw);
 if(bal===null||reserve===null)return {kind:"enter_balance",allowedCent:null,shortfallCent:null};
 if(!summary.eligibleForSpendEstimate||summary.warnings.outgoing.length>0)
  return {kind:"incomplete",allowedCent:null,shortfallCent:null};
 if(!verifiedBills)return {kind:"confirm_bills",allowedCent:null,shortfallCent:null};
 const free=BigInt(bal)-BigInt(summary.payable.outstandingToEndCent)-BigInt(reserve);
 return free<0n?{kind:"shortfall",allowedCent:0,shortfallCent:Number(-free)}:
  {kind:"available",allowedCent:Number(free),shortfallCent:0};
}
const value=(x:unknown)=>Number.isSafeInteger(x)&&typeof x==="number"&&x>=0;
export function validSummary(x:unknown):x is Summary{
 const s=x as Partial<Summary>|null;
 if(!s||typeof s!=="object")return false;
 return typeof s.month==="string"&&typeof s.today==="string"&&
  typeof s.currentMonth==="string"&&typeof s.eligibleForSpendEstimate==="boolean"&&
  !!s.payable&&!!s.receivable&&!!s.warnings&&
  value(s.payable.outstandingToEndCent)&&value(s.payable.paidInMonthCent)&&
  value(s.receivable.expectedDueInMonthCent)&&value(s.receivable.creditedInMonthCent)&&
  value(s.receivable.overdueBeforeMonthCent)&&
  Array.isArray(s.warnings.outgoing)&&Array.isArray(s.warnings.incoming)&&
  Array.isArray(s.payable.upcoming)&&Array.isArray(s.receivable.upcoming);
}
export function validList(x:unknown):x is {items:Account[];nextCursor:string|null}{
 const r=x as {items?:unknown;nextCursor?:unknown}|null;
 return !!r&&Array.isArray(r.items)&&r.items.length<=50&&
  r.items.every(a=>!!a&&typeof a.id==="string"&&typeof a.versao==="number"&&
   typeof a.parcela==="number")&&
  (r.nextCursor===null||typeof r.nextCursor==="string");
}
export function validDetail(x:unknown):x is AccountDetail{
 const r=x as Partial<AccountDetail>|null;
 return !!r&&!!r.item&&typeof r.item.id==="string"&&
  Array.isArray(r.events)&&r.events.length<=500&&r.events.every(e=>typeof e.id==="string");
}
