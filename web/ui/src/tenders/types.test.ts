import {describe,it,expect} from "vitest";
import {integerMil,milToText,localTime,toISO,blankTender} from "./types";
import {demoAgencies,demoTenders} from "./fixtures";
describe("F4 quantidades milésimos e limites de datas",()=>{
 it("converte precisão até 3 casas sem flutuação na entrada",()=>{
  expect(integerMil("12,345")).toBe(12345);
  expect(integerMil("1")).toBe(1000);
  expect(integerMil("0,001")).toBe(1);
  expect(integerMil("0,000")).toBeNull();
  expect(integerMil("1,2345")).toBeNull();
  expect(integerMil("1.234")).toBeNull();
  expect(integerMil("-1")).toBeNull();
  expect(milToText(12345)).toBe("12,345");
 });
 it("converte datas civis locais sem aceitar horário malformado",()=>{
  expect(toISO("")).toBeNull();
  expect(localTime("garbage")).toBe("");
  expect(typeof blankTender().ano).toBe("string");
 });
 it("demonstra dados separados por empresa e dois resultados distintos",()=>{
  const a=demoTenders("f1-demo-aurora"),h=demoTenders("f1-demo-horizonte");
  expect(a[0].items.map(x=>x.resultado)).toEqual(["GANHO","PERDIDO"]);
  expect(h[0].items).toHaveLength(1);
  expect(demoAgencies("f1-demo-aurora")[0].id).not.toBe(demoAgencies("f1-demo-horizonte")[0].id);
 });
});
