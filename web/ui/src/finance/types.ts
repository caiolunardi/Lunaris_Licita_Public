import type {IdentityState} from "../identity/session";
export type FinancePageMode="overview"|"titles"|"recurrences";
export type TitleStatus="ABERTO"|"PAGO"|"PAGO_LEGADO_SEM_BAIXA"|"PENDENTE_CONFERENCIA"|"CANCELADO"|"INCONSISTENTE";
export type Payable={
 id:string;tipo:"DIVERSO"|"FORNECEDOR";beneficiario:string|null;
 categoria_despesa:string|null;fornecedor_id:string|null;fornecedor_nome:string|null;
 descricao_boleto:string|null;valor_nominal_cent:number|null;vencimento:string|null;
 recorrencia_id:string|null;competencia:string|null;observacoes:string|null;
 cancelado:0|1;pago_legado_status:string|null;origem_dado:"NATIVO"|"LEGADO";
 conferencia:string|null;versao:number;situacao:TitleStatus;
};
export type PaymentHistory={
 id:string;tipo:"QUITACAO"|"DESFAZIMENTO";baixa_original_id:string|null;
 data_pagamento:string|null;valor_pago_cent:number|null;comprovante_documento_id:string|null;
 motivo:string|null;origem_dado:string;conferencia:string|null;criado_em:string|null;
};
export type Recurrence={
 id:string;beneficiario:string;categoria_despesa:string;descricao_boleto:string|null;
 valor_atual_cent:number|null;dia_vencimento:number;primeiro_vencimento:string;
 ultima_competencia:string|null;estado:"ATIVA"|"ENCERRADA"|"LEGADO_PENDENTE";
 origem_dado:"NATIVO"|"LEGADO";conferencia:string|null;versao:number;
};
export type MonthlyLine={id:string;tipo:"TITULO"|"PREVISAO_RECORRENTE";
 valorCent:number;situacao:string;recorrenciaId:string|null};
export type MonthlySummary={competencia:string;totalConhecidoCent:number;
 completo:boolean;incompletos:string[];linhas:MonthlyLine[];regraDuplicadaNoTotal:false};
export type FinanceProps={mode:FinancePageMode;identity:IdentityState;onIdentity:()=>void;
 onNavigate:(mode:FinancePageMode)=>void};
export type EditingAction="pay"|"undo"|"revise"|"cancel"|"notes"|"materialize"|"revise-value"|"end-after";
export type TitleForm={tipo:"DIVERSO"|"FORNECEDOR";beneficiario:string;categoriaDespesa:string;
 fornecedorNome:string;descricao:string;valor:string;vencimento:string;observacoes:string};
export type RecurrenceForm={beneficiario:string;categoriaDespesa:string;descricao:string;
 valor:string;dia:string;primeiroVencimento:string};
export function monthLocal(d=new Date()):string{
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",
  year:"numeric",month:"2-digit"}).formatToParts(d);
 return parts.find(p=>p.type==="year")!.value+"-"+parts.find(p=>p.type==="month")!.value;
}
export function dueForMonth(month:string,day:number):string{
 const [y,m]=month.split("-").map(Number);
 const last=new Date(Date.UTC(y,m,0)).getUTCDate();
 return month+"-"+String(Math.min(day,last)).padStart(2,"0");
}
export function parseMoneyBRL(raw:string):number|null{
 const cleaned=raw.trim();
 if(!/^\d{1,11}(?:\.\d{3})*(?:,\d{1,2})?$/.test(cleaned) &&
    !/^\d{1,14}(?:,\d{1,2})?$/.test(cleaned))return null;
 const pieces=cleaned.replace(/\./g,"").split(",");
 const integer=pieces[0],frac=(pieces[1]||"").padEnd(2,"0");
 const value=BigInt(integer)*100n+BigInt(frac);
 if(value<1n||value>BigInt(Number.MAX_SAFE_INTEGER))return null;
 return Number(value);
}
export function formatMoney(value:number|null|undefined):string{
 return value==null?"Valor não conferido":
  new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(value/100);
}
export function titleName(t:Payable):string{
 return t.tipo==="FORNECEDOR"?t.fornecedor_nome||"Fornecedor não informado":
  t.beneficiario||"Conta sem beneficiário";
}
export const emptyTitle=():TitleForm=>({
 tipo:"DIVERSO",beneficiario:"",categoriaDespesa:"",fornecedorNome:"",
 descricao:"",valor:"",vencimento:monthLocal()+"-15",observacoes:""
});
export const emptyRecurrence=():RecurrenceForm=>({
 beneficiario:"",categoriaDespesa:"",descricao:"",valor:"",
 dia:"15",primeiroVencimento:monthLocal()+"-15"
});
