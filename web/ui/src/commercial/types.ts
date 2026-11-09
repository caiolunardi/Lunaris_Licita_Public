import type {IdentityState} from "../identity/session";
export type Kind="commitments"|"purchases";
export type CommercialProps={kind:Kind;identity:IdentityState;onIdentity:()=>void;onNavigate:(kind:Kind)=>void};
export type RecordRow={
 id:string;numero:string|null;numero_pedido?:string|null;situacao:string;
 licitacao_id?:string;licitacao_numero?:string;orgao_nome?:string;
 empenho_id?:string;empenho_numero?:string;fornecedor_id?:string;fornecedor_nome?:string;
 versao:number;origem_dado:"NATIVO"|"LEGADO";conferencia:string;
 frete_cent?:number|null;outros_custos_cent?:number|null;
 condicao_pagamento?:string|null;data_compra?:string|null;
 previsao_despacho?:string|null;previsao_entrega?:string|null;
};
export type CommitmentLine={id:string;empenho_id:string;licitacao_item_id:string;quantidade_mil:number;
 valor_unit_cent:number;versao:number;origem_dado:string;numero_item:string;descricao_exigida:string;
 unidade:string;quantidade_ganha_mil:number;resultado:string};
export type PurchaseLine={id:string;compra_id:string;empenho_item_id:string;quantidade_mil:number;
 valor_unit_cent:number;versao:number;origem_dado:string;licitacao_item_id:string;
 numero_item:string;descricao_exigida:string;unidade:string};
export type Detail={item:RecordRow;items:(CommitmentLine|PurchaseLine)[]};
export type AvailableLine={
 id:string;numero_item:string;descricao_exigida:string;unidade:string;
 quantidade_ganha_mil?:number;valor_final_unit_cent?:number;
 quantidade_mil?:number;valor_unit_cent?:number;
 allocated_mil:number;remaining_mil:number;
};
export type ParentAvailable={parent:{id:string;numero:string;versao:number;origem_dado:string;
 situacao?:string;encerrada_em?:string|null;situacao_participacao?:string};
 items:AvailableLine[]};
export type ParentOption={id:string;numero:string;versao:number;label:string;};
export type Supplier={id:string;nome:string;ativo?:number};
export type DraftLine={id:string;quantity:string;price:string};
export function blankLine(row:AvailableLine):DraftLine{
 const cent=row.valor_unit_cent??row.valor_final_unit_cent??null;
 return {id:row.id,quantity:"",price:cent===null?"":(cent/100).toFixed(2).replace(".",",")};
}
export function safeRemaining(total:number,used:number):number{
 if(!Number.isSafeInteger(total)||!Number.isSafeInteger(used)||used<0||total<used)
  throw new Error("invalid_commercial_quantity");
 return total-used;
}
export function moneyText(n:number|null|undefined):string{
 if(n===null||n===undefined||!Number.isSafeInteger(n))return "—";
 return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(n/100);
}
export function sumValue(lines:{quantidade_mil:number;valor_unit_cent:number}[]):number|null{
 let sum=0n;
 for(const l of lines){
  if(!Number.isSafeInteger(l.quantidade_mil)||!Number.isSafeInteger(l.valor_unit_cent))return null;
  sum+=(BigInt(l.quantidade_mil)*BigInt(l.valor_unit_cent)+500n)/1000n;
 }
 return sum>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(sum);
}
