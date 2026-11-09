import {describe,it,expect} from "vitest";
import {safeRemaining,sumValue,blankLine,moneyText} from "./types";
import {demoCommercial,demoAvailable,demoParents,demoSuppliers} from "./fixtures";
describe("F5 quantidades e fonte do vínculo",()=>{
 it("subtrai valores inteiros sem arredondar e falha em estado impossível",()=>{
  expect(safeRemaining(6000,5000)).toBe(1000);
  expect(()=>safeRemaining(3000,4000)).toThrow();
  expect(sumValue([{quantidade_mil:2500,valor_unit_cent:900}])).toBe(2250);
  expect(moneyText(2250)).toContain("22,50");
 });
 it("soma em BigInt e separa compras de empenhos e empresas",()=>{
  const a=demoCommercial("f1-demo-aurora");
  const h=demoCommercial("f1-demo-horizonte");
  expect(a.commitments).toHaveLength(1);expect(a.purchases).toHaveLength(1);
  expect(h.commitments).toHaveLength(0);
  expect(demoSuppliers("f1-demo-aurora")).not.toEqual(demoSuppliers("f1-demo-horizonte"));
  expect(demoParents("f1-demo-aurora","commitments",a)).toHaveLength(1);
 });
 it("saldo de vitória desconta empenho e saldo de empenho desconta compra",()=>{
  const company="f1-demo-aurora",a=demoCommercial(company);
  const tenderId=demoParents(company,"commitments",a)[0].id;
  const id=demoParents(company,"purchases",a)[0].id;
  expect(demoAvailable(company,"commitments",tenderId,a)?.items[0].remaining_mil).toBe(1000);
  expect(demoAvailable(company,"purchases",id,a)?.items[0].remaining_mil).toBe(1000);
  const price=blankLine(demoAvailable(company,"purchases",id,a)!.items[0]).price;
  expect(price).toContain(",");
 });
});
