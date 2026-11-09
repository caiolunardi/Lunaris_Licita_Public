import {describe,it,expect} from "vitest";
import {moneyFromPtBR,quantityFromPtBR,rateFromPtBR,priceInputs,
 simulatePricing,formatMoney,formatPercent,validatedNotifications} from "./types";
describe("F9 entradas leigas e cálculo de preços sem centavos perdidos",()=>{
 it("entende vírgula em dinheiro, quantidade e porcentagem, mas não número ambíguo",()=>{
  expect(moneyFromPtBR("R$ 1,50")).toBe(150);
  expect(quantityFromPtBR("1,500")).toBe(1500);
  expect(rateFromPtBR("20,00")).toBe(2000);
  expect(moneyFromPtBR("1.000,00")).toBeNull();
  expect(moneyFromPtBR("1,234")).toBeNull();
  expect(quantityFromPtBR("-2")).toBeNull();
 });
 it("explica margem sobre faturamento distinta do markup",()=>{
  const input=priceInputs({qty:"1",cost:"80,00",extra:"0,00",
    fee:"0",margin:"20",sale:"100,00"});
  expect(input).not.toBeNull();
  const p=simulatePricing(input!);
  expect(p.profitCent).toBe(2000);
  expect(p.actualMarginBps).toBe(2000);
  expect(p.markupOverCostBps).toBe(2500);
  expect(formatMoney(p.profitCent)).toContain("20,00");
  expect(formatPercent(p.actualMarginBps)).toContain("20%");
 });
 it("cobre fee 10% e margem 20% sem arredondar preço mínimo para baixo",()=>{
  const p=simulatePricing({quantityMil:1000,costUnitCent:8000,
    extraCostCent:1000,saleFeeBps:1000,targetMarginBps:2000,saleUnitCent:null});
  expect(p.minimumUnitCent).toBe(12858);
  expect(p.belowTargetMargin).toBe(false);
 });
 it("não anuncia margem irreal após arredondar taxas em lotes pequenos",()=>{
  const r=simulatePricing({quantityMil:1,costUnitCent:0,extraCostCent:1,
   saleFeeBps:1,targetMarginBps:2000,saleUnitCent:null});
  expect(r.minimumUnitCent).toBeGreaterThanOrEqual(3000);
  expect(r.belowTargetMargin).toBe(false);
 });
 it("rejeita taxas matematicamente inviáveis e não valida provedor falso",()=>{
  expect(priceInputs({qty:"1",cost:"80",extra:"0",
    fee:"90",margin:"20",sale:""})).toBeNull();
  expect(validatedNotifications({preference:null,recipients:[],history:[],
   providerConfigured:true,dispatchEnabled:false,cronEnabled:false})).toBe(false);
 });
});
