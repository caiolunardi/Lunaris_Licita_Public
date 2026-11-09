import test from "node:test";
import assert from "node:assert/strict";
import {summarizeCashflow} from "../ui/worker/f7-cashflow-math.mjs";
const day="2026-11-08",month="2026-11";
const bill=(id,value,date,more={})=>({id,nome:id,valor_nominal_cent:value,vencimento:date,
 cancelado:0,situacao:"ABERTO",origem_dado:"NATIVO",conferencia:"VALIDADO",...more});
const rule=(id,value=5000)=>({id,beneficiario:id,valor_atual_cent:value,primeiro_vencimento:"2026-09-01",
 dia_vencimento:31,estado:"ATIVA",origem_dado:"NATIVO",conferencia:"VALIDADO"});
const receivable=(id,value,date,more={})=>({id,nota_fiscal_id:"nf1",parcela:1,nf_numero:"NF-1",
 saldo_cent:value,vencimento:date,cancelada:0,nf_situacao:"EMITIDA",nf_origem:"NATIVO",
 nf_conferencia:"VALIDADO",origem_dado:"NATIVO",conferencia:"VALIDADO",estado_saldo:"CONFERIDO",...more});
const calculate=x=>summarizeCashflow({today:day,month,...x});
test("F7 future invoices never count as real credited cash",()=>{
 const s=calculate({receivables:[receivable("i1",100000,"2026-11-20")]});
 assert.equal(s.receivable.expectedDueInMonthCent,100000);
 assert.equal(s.receivable.creditedInMonthCent,0);
 assert.equal(s.payable.outstandingToEndCent,0);
});
test("F7 recurrence preview excludes already materialized month incl cancelled",()=>{
 const s=calculate({bills:[bill("b",5000,"2026-11-30",{recorrencia_id:"rec1",competencia:month})],
  rules:[rule("rec1"),rule("rec2",7000)]});
 assert.equal(s.payable.outstandingToEndCent,12000);
 assert.equal(s.payable.recurringNotMaterializedCent,7000);
});
test("F7 past due bills stay reserved, a paid bill does not",()=>{
 const s=calculate({bills:[bill("old",2000,"2026-10-10"),
  bill("paid",5000,"2026-11-02",{situacao:"PAGO"})],
 payments:[{id:"pay1",valor_pago_cent:5000,data_pagamento:"2026-11-02",
  origem_dado:"NATIVO",conferencia:"VALIDADO"}]});
 assert.equal(s.payable.outstandingToEndCent,2000);
 assert.equal(s.payable.overdueBeforeMonthCent,2000);
 assert.equal(s.payable.paidInMonthCent,5000);
});
test("F7 only active credits count, retained amount separated",()=>{
 const s=calculate({receivables:[receivable("i1",50000,"2026-11-22")],
  credits:[{id:"credit",data_credito:"2026-11-08",valor_recebido_cent:15000,
   retencao_confirmada_cent:5000,origem_dado:"NATIVO",conferencia:"VALIDADO"}]});
 assert.equal(s.receivable.creditedInMonthCent,15000);
 assert.equal(s.receivable.retainedInMonthCent,5000);
});
test("F7 unknown bill blocks spending while unknown income does not create cash",()=>{
 const s=calculate({bills:[bill("legacy",10000,"2026-11-22",{origem_dado:"LEGADO",conferencia:"PENDENTE"})],
  receivables:[receivable("unknown",null,null,{estado_saldo:"PENDENTE_CONFERENCIA"})]});
 assert.equal(s.eligibleForSpendEstimate,false);
 assert.ok(s.warnings.incoming.length);assert.ok(s.warnings.outgoing.length);
 assert.equal(s.receivable.creditedInMonthCent,0);
});
test("F7 money overflow throws, no float coercion or partial answer",()=>{
 assert.throws(()=>calculate({bills:[bill("one",Number.MAX_SAFE_INTEGER,"2026-11-22"),
 bill("two",100,"2026-11-23")]}),/money_overflow/);
});
test("F7 large record counts fail closed",()=>{
 assert.throws(()=>calculate({bills:Array.from({length:5001},(_,i)=>bill("b"+i,1,"2026-11-20"))}),/aggregate_too_large/);
});
