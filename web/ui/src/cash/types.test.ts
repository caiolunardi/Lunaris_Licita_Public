import {describe,it,expect} from "vitest";
import {parseBRL,planSpending,type Summary} from "./types";
const summary:Summary={month:"2026-11",today:"2026-11-08",currentMonth:"2026-11",
 eligibleForSpendEstimate:true,payable:{outstandingToEndCent:150000,
 dueInMonthCent:100000,overdueBeforeMonthCent:50000,paidInMonthCent:20000,
 recurringNotMaterializedCent:15000,openCount:3,missingDueCount:0,upcoming:[]},
 receivable:{expectedDueInMonthCent:500000,overdueBeforeMonthCent:0,
 creditedInMonthCent:100000,retainedInMonthCent:50000,remainingTotalCent:1000000,
 openCount:2,missingDueCount:0,upcoming:[]},
 warnings:{outgoing:[],incoming:[]},basis:"test"};
describe("F7 quanto posso gastar — prova de não enganar o usuário",()=>{
 it("interpreta centavos brasileiros sem float e rejeita ambiguidade",()=>{
  expect(parseBRL("1.234,56")).toBe(123456);
  expect(parseBRL("0,00")).toBe(0);
  expect(parseBRL("-10,50",{signed:true})).toBe(-1050);
  expect(parseBRL("-10,50")).toBeNull();
  expect(parseBRL("1.200.00")).toBeNull();
 });
 it("não exibe saldo seguro antes de informar saldo e conferir contas",()=>{
  expect(planSpending(summary,"","",false).allowedCent).toBeNull();
  expect(planSpending(summary,"5.000,00","500,00",false).kind).toBe("confirm_bills");
 });
 it("subtrai apenas contas pendentes e reserva, nunca receita futura ou pagamento já feito",()=>{
  const x=planSpending(summary,"5.000,00","500,00",true);
  expect(x.kind).toBe("available");
  expect(x.allowedCent).toBe(300000);
 });
 it("conta atrasada também consome saldo e déficit não vira dinheiro negativo para gastar",()=>{
  const x=planSpending(summary,"300,00","0",true);
  expect(x.kind).toBe("shortfall");
  expect(x.allowedCent).toBe(0);expect(x.shortfallCent).toBe(120000);
 });
 it("bloqueia cálculo com despesa desconhecida ou mês futuro",()=>{
  expect(planSpending({...summary,eligibleForSpendEstimate:false},"10.000,00","",true).kind).toBe("incomplete");
  expect(planSpending({...summary,month:"2026-12"},"10.000,00","",true).kind).toBe("not_current");
 });
});
