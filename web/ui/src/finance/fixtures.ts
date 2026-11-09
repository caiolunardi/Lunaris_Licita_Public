import {dueForMonth,monthLocal,type Payable,type PaymentHistory,
 type Recurrence,type MonthlySummary} from "./types";
export function fictionalFinance(companyId:string,month=monthLocal()):{
 titles:Payable[];recurrences:Recurrence[];payments:Record<string,PaymentHistory[]>;ends:Record<string,string>}{
 const prefix=companyId.endsWith("horizonte")?"h":"a",variant=prefix==="h";
 const id=(n:string)=>"f3-demo-"+prefix+"-"+n;
 const rec:Recurrence={
  id:id("rec-internet"),beneficiario:variant?"Serviço Horizonte (fictício)":"Internet Aurora (fictícia)",
  categoria_despesa:"Infraestrutura",descricao_boleto:"Mensalidade sem boleto obrigatório",
  valor_atual_cent:variant?9900:14990,dia_vencimento:12,primeiro_vencimento:month+"-12",
  ultima_competencia:null,estado:"ATIVA",versao:1,origem_dado:"NATIVO",conferencia:"VALIDADO"
 };
 const base=(suffix:string,name:string,amount:number,day:number,status:Payable["situacao"],category:string):Payable=>({
  id:id(suffix),tipo:"DIVERSO",beneficiario:name,categoria_despesa:category,
  fornecedor_id:null,fornecedor_nome:null,descricao_boleto:null,valor_nominal_cent:amount,
  vencimento:dueForMonth(month,day),recorrencia_id:null,competencia:null,observacoes:"Lançamento fictício.",
  cancelado:0,pago_legado_status:null,origem_dado:"NATIVO",conferencia:"VALIDADO",versao:1,situacao:status
 });
 const items:Payable[]=variant?[
  base("energia","Energia Horizonte — fictícia",22750,17,"ABERTO","Despesas fixas"),
  base("servico","Serviço fictício já quitado",18200,7,"PAGO","Serviços")
 ]:[
  base("internet","Internet Aurora — fictícia",14990,12,"ABERTO","Infraestrutura"),
  base("energia","Energia elétrica — exemplo",32450,21,"ABERTO","Despesas fixas"),
  base("software","Licença de software — exemplo",87000,7,"PAGO","Serviços"),
  {...base("legado","Despesa histórica não conferida",29000,10,"PENDENTE_CONFERENCIA","Legado"),
    origem_dado:"LEGADO",conferencia:"PENDENTE"}
 ];
 if(!variant){items[0].recorrencia_id=rec.id;items[0].competencia=month;}
 const payments:Record<string,PaymentHistory[]>={};
 for(const t of items.filter(x=>x.situacao==="PAGO"))
  payments[t.id]=[{id:id("pay-"+t.id),tipo:"QUITACAO",baixa_original_id:null,
   data_pagamento:dueForMonth(month,8),valor_pago_cent:t.valor_nominal_cent,
   comprovante_documento_id:null,motivo:null,origem_dado:"NATIVO",
   conferencia:"VALIDADO",criado_em:null}];
 return {titles:items,recurrences:[rec],payments,ends:{}};
}
export function fictionalMonthly(titles:Payable[],recurrences:Recurrence[],
 month:string,ends:Record<string,string>={}):MonthlySummary{
 const lines:MonthlySummary["linhas"]=[],incompletos:string[]=[];
 const generated=new Set<string>();
 for(const t of titles){
  if(t.recorrencia_id&&t.competencia===month)generated.add(t.recorrencia_id);
  if((t.recorrencia_id?t.competencia:t.vencimento?.slice(0,7))!==month||t.cancelado===1)continue;
  if(t.valor_nominal_cent==null||t.conferencia==="PENDENTE"||t.conferencia==="INCONSISTENTE"||
    t.origem_dado==="LEGADO"&&t.conferencia!=="VALIDADO"){
   incompletos.push(t.id);continue;
  }
  lines.push({id:t.id,tipo:"TITULO",valorCent:t.valor_nominal_cent,
   situacao:t.situacao,recorrenciaId:t.recorrencia_id});
 }
 for(const r of recurrences){
  if(r.estado!=="ATIVA"||r.primeiro_vencimento.slice(0,7)>month||
   (ends[r.id]&&ends[r.id]<month)||generated.has(r.id))continue;
  if(r.valor_atual_cent==null||r.origem_dado==="LEGADO"&&r.conferencia!=="VALIDADO"){
   incompletos.push("RECORRENCIA:"+r.id);continue;
  }
  lines.push({id:r.id,tipo:"PREVISAO_RECORRENTE",valorCent:r.valor_atual_cent,
   situacao:"PREVISTO",recorrenciaId:r.id});
 }
 return {competencia:month,totalConhecidoCent:lines.reduce((sum,x)=>sum+x.valorCent,0),
  completo:incompletos.length===0,incompletos,linhas:lines,
  regraDuplicadaNoTotal:false};
}
