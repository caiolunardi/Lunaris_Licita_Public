import test from "node:test";
import assert from "node:assert/strict";
import {priceQuote,PRICING_FORMULA_VERSION} from "../ui/worker/f9-price-math.mjs";
test("F9 lucro sobre venda e markup não são intercambiáveis",()=>{
 const p=priceQuote({quantityMil:1000,costUnitCent:8000,extraCostCent:0,
  saleFeeBps:0,targetMarginBps:2000,saleUnitCent:10000});
 assert.equal(p.profitCent,2000);
 assert.equal(p.actualMarginBps,2000);
 assert.equal(p.markupOverCostBps,2500);
 assert.equal(p.belowTargetMargin,false);
 assert.equal(p.formulaVersion,PRICING_FORMULA_VERSION);
});
test("F9 comissão e frete incidem no denominador, preço mínimo conservador",()=>{
 const p=priceQuote({quantityMil:1000,costUnitCent:8000,extraCostCent:1000,
  saleFeeBps:1000,targetMarginBps:2000});
 assert.equal(p.minimumUnitCent,12858); // ceil(9000/0.7)
 assert.ok(p.actualMarginBps>=2000);
 assert.equal(p.isEstimate,true);
 assert.equal(p.realSaleConfirmed,false);
});
test("F9 volume fracionário e arredondamento de centavos determinísticos",()=>{
 const p=priceQuote({quantityMil:1500,costUnitCent:999,extraCostCent:1,
  saleFeeBps:0,targetMarginBps:0});
 assert.equal(p.baseCostCent,1499);
 assert.equal(p.totalCostCent,1500);
 assert.equal(p.minimumUnitCent,1000);
 assert.equal(p.revenueCent,1500);
});
test("F9 alerta preço abaixo do custo e comissão",()=>{
 const p=priceQuote({quantityMil:1000,costUnitCent:8000,extraCostCent:100,
  saleFeeBps:500,targetMarginBps:1500,saleUnitCent:7500});
 assert.equal(p.belowTargetMargin,true);
 assert.ok(p.profitCent<0);
});
test("F9 sem margem alcançável, negativos, decimais, infinito e overflow bloqueados",()=>{
 const baseline={quantityMil:1000,costUnitCent:8000,extraCostCent:0,saleFeeBps:0,targetMarginBps:2000};
 for(const patch of [{targetMarginBps:9000,saleFeeBps:1000},{saleFeeBps:-1},
  {costUnitCent:5.5},{quantityMil:0},{quantityMil:Infinity},{saleUnitCent:NaN},
  {extraCostCent:Number.MAX_SAFE_INTEGER},{foo:1}]){
  assert.throws(()=>priceQuote({...baseline,...patch}));
 }
});

test("F9 segurança contra arredondamento de centavos em lotes de milésimos e taxas",()=>{
 for(const q of [1,3,17,333,1000,1500,3333]){
  for(const cost of [0,1,7,99,999]){
   for(const extra of [0,1,7]){
    for(const fee of [0,1,333,1000,3000]){
     for(const target of [0,1,333,2000,4000]){
      const x=priceQuote({quantityMil:q,costUnitCent:cost,extraCostCent:extra,
       saleFeeBps:fee,targetMarginBps:target});
      assert.equal(x.belowTargetMargin,false,
       JSON.stringify({q,cost,extra,fee,target,x}));
     }
    }
   }
  }
 }
});
