// F9 calculadora financeira: sem ponto flutuante no domínio, quantidades em milésimos.
// Margem = lucro líquido / receita. Não confundir com markup sobre custo.
// Todas as taxas são basis points (100 = 1%). Custos de venda sobre faturamento.
import {DomainError} from "../../src/r7/domain.mjs";
const LIM=BigInt(Number.MAX_SAFE_INTEGER);
const MAX_Q=1000000000000;
function integer(v,min,max,code="invalid_pricing"){
 if(!Number.isSafeInteger(v)||v<min||v>max)throw new DomainError(code,400);
 return BigInt(v);
}
const ceil=(a,b)=>(a+b-1n)/b;
const round=(a,b)=>(a+b/2n)/b;
function safe(v){if(v< -LIM||v>LIM)throw new DomainError("price_overflow",409);return Number(v);}
export const PRICING_FORMULA_VERSION=1;
export function priceQuote(input){
 if(!input||typeof input!=="object"||Array.isArray(input)||
   Object.keys(input).some(k=>!["quantityMil","costUnitCent","extraCostCent",
    "saleFeeBps","targetMarginBps","saleUnitCent"].includes(k)))
  throw new DomainError("invalid_pricing",400);
 const q=integer(input.quantityMil,1,MAX_Q),
  cost=integer(input.costUnitCent,0,9007199254740991),
  extra=integer(input.extraCostCent,0,9007199254740991),
  fee=integer(input.saleFeeBps,0,9999),
  target=integer(input.targetMarginBps,0,9999);
 if(fee+target>=10000n)throw new DomainError("margin_unachievable",400);
 const base=ceil(cost*q,1000n),total=base+extra;
 if(total>LIM)throw new DomainError("price_overflow",409);
 // Precisão conservadora: custo de compra e comissão arredondados para cima;
 // preço mínimo arredondado por unidade (nunca abaixo da margem anunciada).
 const denominator=10000n-fee-target;
 const revenueMin=ceil(total*10000n,denominator);
 let minUnit=ceil(revenueMin*1000n,q);
 // Uma tarifa arredondada para cima pode consumir mais 1 centavo.
 // Se esse centavo derrubar a margem, reservar uma unidade de centavo
 // ANTES de dividir por quantidade garante meta na aritmética exata.
 const meetsTarget=unit=>{
  const gross=round(unit*q,1000n);
  const net=gross-total-ceil(gross*fee,10000n);
  return net>=0n && (gross>0n||target===0n) &&
   net*10000n>=gross*target;
 };
 if(!meetsTarget(minUnit))
  minUnit=ceil(ceil((total+1n)*10000n,denominator)*1000n,q);
 if(!meetsTarget(minUnit))throw new DomainError("margin_unachievable",409);
 const chosen=input.saleUnitCent==null?minUnit:integer(input.saleUnitCent,0,9007199254740991);
 const revenue=round(chosen*q,1000n);
 const sellingCost=ceil(revenue*fee,10000n);
 const profit=revenue-total-sellingCost;
 const margin=revenue===0n?null:safe(profit*10000n/revenue);
 const markup=total===0n?null:safe(profit*10000n/total);
 return Object.freeze({
  formulaVersion:PRICING_FORMULA_VERSION,quantityMil:safe(q),costUnitCent:safe(cost),
  extraCostCent:safe(extra),saleFeeBps:safe(fee),targetMarginBps:safe(target),
  baseCostCent:safe(base),totalCostCent:safe(total),
  minimumUnitCent:safe(minUnit),suggestedUnitCent:safe(minUnit),
  saleUnitCent:safe(chosen),revenueCent:safe(revenue),
  saleFeesCent:safe(sellingCost),profitCent:safe(profit),
  actualMarginBps:margin,markupOverCostBps:markup,
  belowTargetMargin:profit<0n||(revenue===0n&&target>0n)||revenue*target>profit*10000n,
  isEstimate:true,realSaleConfirmed:false
 });
}
