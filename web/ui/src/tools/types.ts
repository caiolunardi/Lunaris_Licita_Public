import type {IdentityState} from "../identity/session";
export type Mode="pricing"|"notifications"|"settings"|"team"|"audit"|"help";
export type ToolsProps={identity:IdentityState;mode:Mode;onIdentity:()=>void};
export type PriceInputs={quantityMil:number;costUnitCent:number;extraCostCent:number;
 saleFeeBps:number;targetMarginBps:number;saleUnitCent:number|null};
export type Pricing={formulaVersion:1;quantityMil:number;costUnitCent:number;
 extraCostCent:number;saleFeeBps:number;targetMarginBps:number;
 baseCostCent:number;totalCostCent:number;minimumUnitCent:number;
 suggestedUnitCent:number;saleUnitCent:number;revenueCent:number;
 saleFeesCent:number;profitCent:number;actualMarginBps:number|null;
 markupOverCostBps:number|null;belowTargetMargin:boolean;
 isEstimate:true;realSaleConfirmed:false};
export type Quote={id:string;descricao:string;fornecedor_texto:string|null;
 referencia_texto:string|null;quantidade_mil:number;custo_unit_cent:number;
 custo_efetivo_total_cent:number;preco_minimo_unit_cent:number;
 preco_venda_unit_cent:number;receita_total_cent:number;custos_venda_total_cent:number;
 lucro_total_cent:number;margem_percentual_escala:number|null;
 lucro_sobre_custo_escala:number|null;entrada_json:string;
 resultado_json:string;versao_calculo:number;origem_dado:string;
 conferencia:string;criado_em:string|null;licitacao_id:string|null};
export type Schedule={id:string;ativo:number;dias_semana_json:string|null;
 horarios_json:string|null;quantidade_proximos:number;remetente:string|null;
 versao:number;origem_dado:string;conferencia:string};
export type Recipient={id:string;email_normalizado:string;ativo:number;versao:number;
 conferencia:string};
export type Send={id:string;data_referencia:string;horario:string;estado:string;
 quantidade_boletos:number|null;total_centavos:number|null;criado_em:string|null;
 enviado_em:string|null};
export type Notifications={preference:Schedule|null;recipients:Recipient[];
 history:Send[];dispatchEnabled:false;providerConfigured:false;cronEnabled:false;
 deliveryStatus:string};
export type Setting={chave:string;valor_texto:string;tipo:string;atualizado_em:string|null};
export type Member={id:string;nome:string|null;email_normalizado:string;papel:string;
 ativo:number;versao:number};
export type Restriction={id:string;usuario_id:string;tipo_entidade:string;
 entidade_id:string;acao:string;motivo:string;criado_em:string|null};
export type Audit={seq:number;id:string;tipo:string;acao:string;ator_id:string|null;
 criado_em:string|null;data_hora:string|null};
const LIMIT=BigInt(Number.MAX_SAFE_INTEGER);
function fromDecimal(value:string,scale:number):number|null{
 const normalized=value.trim().replace(/^R\$\s*/i,"");
 const r=normalized.match(new RegExp("^([0-9]{1,13})(?:,([0-9]{1,"+scale+"}))?$"));
 if(!r)return null;
 const units=BigInt(r[1])*10n**BigInt(scale)+
  BigInt((r[2]||"").padEnd(scale,"0"));
 if(units>LIMIT)return null;
 return Number(units);
}
export function moneyFromPtBR(s:string){return fromDecimal(s,2);}
export function quantityFromPtBR(s:string){return fromDecimal(s,3);}
export function rateFromPtBR(s:string){
 const v=fromDecimal(s,2);return v!==null&&v>=0&&v<=9999?v:null;
}
export function formatMoney(cents:number|null):string{
 return cents===null||!Number.isSafeInteger(cents)?"Não informado":
 new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(cents/100);
}
export function formatPercent(bps:number|null):string{
 return bps===null||!Number.isFinite(bps)?"Indefinida":
 new Intl.NumberFormat("pt-BR",{maximumFractionDigits:2,minimumFractionDigits:0})
 .format(bps/100)+"%";
}
export function formatQuantity(mil:number):string{
 return new Intl.NumberFormat("pt-BR",{maximumFractionDigits:3}).format(mil/1000);
}
export function priceInputs(fields:{qty:string;cost:string;extra:string;
 fee:string;margin:string;sale:string}):PriceInputs|null{
 const quantityMil=quantityFromPtBR(fields.qty),costUnitCent=moneyFromPtBR(fields.cost),
  extraCostCent=moneyFromPtBR(fields.extra),saleFeeBps=rateFromPtBR(fields.fee),
  targetMarginBps=rateFromPtBR(fields.margin),
  saleUnitCent=fields.sale.trim()===""?null:moneyFromPtBR(fields.sale);
 if(quantityMil===null||quantityMil<1||costUnitCent===null||
  extraCostCent===null||saleFeeBps===null||targetMarginBps===null||
  saleFeeBps+targetMarginBps>=10000||
  fields.sale.trim()!==""&&saleUnitCent===null)return null;
 return {quantityMil,costUnitCent,extraCostCent,saleFeeBps,targetMarginBps,saleUnitCent};
}
const ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
const round=(a:bigint,b:bigint)=>(a+b/2n)/b;
function safe(v:bigint):number{if(v>LIMIT||v< -LIMIT)throw Error("Valor ultrapassa o limite seguro.");return Number(v);}
export function simulatePricing(p:PriceInputs):Pricing{
 // Equação idêntica à calculadora Worker F9; usada APENAS em modo de demonstração.
 const q=BigInt(p.quantityMil),cost=BigInt(p.costUnitCent),
  extra=BigInt(p.extraCostCent),fee=BigInt(p.saleFeeBps),
  margin=BigInt(p.targetMarginBps);
 const base=ceil(cost*q,1000n),total=base+extra;
 const denominator=10000n-fee-margin;
 let minimumUnit=ceil(ceil(total*10000n,denominator)*1000n,q);
 const meetsTarget=(u:bigint)=>{
  const rev=round(u*q,1000n),comm=ceil(rev*fee,10000n),profit=rev-total-comm;
  return profit>=0n&&(rev>0n||margin===0n)&&profit*10000n>=rev*margin;
 };
 if(!meetsTarget(minimumUnit))
  minimumUnit=ceil(ceil((total+1n)*10000n,denominator)*1000n,q);
 if(!meetsTarget(minimumUnit))throw Error("Margem não alcançável.");
 const chosen=p.saleUnitCent===null?minimumUnit:BigInt(p.saleUnitCent);
 const revenue=round(chosen*q,1000n),fees=ceil(revenue*fee,10000n),profit=revenue-total-fees;
 return {formulaVersion:1,...p,baseCostCent:safe(base),totalCostCent:safe(total),
  minimumUnitCent:safe(minimumUnit),suggestedUnitCent:safe(minimumUnit),
  saleUnitCent:safe(chosen),revenueCent:safe(revenue),saleFeesCent:safe(fees),
  profitCent:safe(profit),actualMarginBps:revenue===0n?null:safe(profit*10000n/revenue),
  markupOverCostBps:total===0n?null:safe(profit*10000n/total),
  belowTargetMargin:profit<0n||(revenue===0n&&margin>0n)||revenue*margin>profit*10000n,
  isEstimate:true,realSaleConfirmed:false};
}
export function validatedNotifications(v:unknown):v is Notifications{
 const x=v as Partial<Notifications>|null;
 return !!x&&x.dispatchEnabled===false&&x.providerConfigured===false&&
  x.cronEnabled===false&&Array.isArray(x.recipients)&&x.recipients.length<=100&&
  Array.isArray(x.history)&&x.history.length<=50;
}
export function validatedQuoteList(v:unknown):v is {items:Quote[];nextCursor:string|null}{
 const r=v as {items?:Quote[];nextCursor?:string|null}|null;
 return !!r&&Array.isArray(r.items)&&r.items.length<=50&&
  r.items.every(x=>typeof x.id==="string"&&typeof x.descricao==="string")&&
  (r.nextCursor===null||typeof r.nextCursor==="string");
}
