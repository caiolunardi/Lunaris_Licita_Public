import {describe,it,expect} from "vitest";
import {lineTotal,rowAmount,validAvailable,validDetail,milText,moneyText} from "./types";
describe("F6 contrato numérico e fronteiras",()=>{
 it("arredondamento HALF_UP por linha em centavos inteiros",()=>{
  expect(rowAmount(1000,12345)).toBe(12345);
  expect(rowAmount(333,101)).toBe(34);
  expect(lineTotal([{quantidadeMil:333,valorUnitCent:101},{quantidadeMil:333,valorUnitCent:101}])).toBe(68);
  expect(rowAmount(0,100)).toBeNull();
 });
 it("sem inferir quantidades ou valores desconhecidos",()=>{
  expect(milText(null)).toBe("—");expect(moneyText(undefined)).toBe("—");
  expect(lineTotal([{quantidadeMil:-1,valorUnitCent:10}])).toBeNull();
 });
 it("rejeita payload de origem com saldo negativo ou detalhe truncado",()=>{
  expect(validAvailable({parent:{id:"x",versao:1},
   items:[{id:"i",remaining_mil:-1}]})).toBe(false);
  expect(validDetail({item:{id:"x"},items:Array.from({length:101},()=>({id:"a",quantidade_mil:1}))})).toBe(false);
 });
});
