import {describe,expect,it} from "vitest";
import {dueForMonth,formatMoney,parseMoneyBRL} from "./types";
import {fictionalFinance,fictionalMonthly} from "./fixtures";
describe("F3 valores como centavos, sem Float de entrada",()=>{
 it("converte BRL corretamente sem arredondamentos intermediários",()=>{
  expect(parseMoneyBRL("1.234,50")).toBe(123450);
  expect(parseMoneyBRL("0,01")).toBe(1);
  expect(parseMoneyBRL("123")).toBe(12300);
  expect(parseMoneyBRL("R$ 100,20")).toBeNull();
  expect(parseMoneyBRL("0")).toBeNull();
  expect(parseMoneyBRL("3,141")).toBeNull();
  expect(formatMoney(123450)).toContain("1.234,50");
 });
 it("ajusta vencimento em fevereiro e anos bissextos",()=>{
  expect(dueForMonth("2028-02",31)).toBe("2028-02-29");
  expect(dueForMonth("2027-02",31)).toBe("2027-02-28");
  expect(dueForMonth("2027-04",31)).toBe("2027-04-30");
 });
 it("soma compromisso materializado sem somar novamente a regra",()=>{
  const f=fictionalFinance("f1-demo-aurora","2026-11");
  const m=fictionalMonthly(f.titles,f.recurrences,"2026-11");
  expect(m.linhas.filter(x=>x.recorrenciaId===f.recurrences[0].id)).toHaveLength(1);
  expect(m.completo).toBe(false);
  expect(m.incompletos).toHaveLength(1);
 });
 it("separa os dados fictícios por empresa",()=>{
  const a=fictionalFinance("f1-demo-aurora"),h=fictionalFinance("f1-demo-horizonte");
  expect(a.titles.some(x=>h.titles.some(y=>x.id===y.id))).toBe(false);
 });
});
