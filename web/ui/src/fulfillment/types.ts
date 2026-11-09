import type {IdentityState} from "../identity/session";
export type Kind="shipments"|"invoices";
export type Props={kind:Kind;identity:IdentityState;onIdentity:()=>void};
export type Row={id:string;empenho_id:string;empenho_numero?:string|null;numero?:string|null;serie?:string|null;
 emissao?:string|null;situacao:string;versao:number;origem_dado:"NATIVO"|"LEGADO";conferencia:string;
 valor_documento_cent?:number|null;transportadora?:string|null;codigo_rastreio?:string|null;
 url_rastreio?:string|null;data_despacho?:string|null;previsao_entrega?:string|null;
 data_entrega?:string|null;recebedor?:string|null;endereco_entrega?:string|null;
 chave_acesso?:string|null;protocolo?:string|null;apresentada_em?:string|null;observacoes?:string|null};
export type Line={id:string;quantidade_mil:number;valor_unit_cent?:number;numero_item:string;
 descricao_exigida:string;unidade:string;versao?:number;compra_item_id?:string;compra_id?:string;
 empenho_item_id?:string;licitacao_item_id?:string;quantidade_aceita_mil?:number;
 quantidade_recusada_mil?:number;motivo_recusa?:string|null;allocated_mil?:number;remaining_mil?:number};
export type Parcel={id:string;parcela:number;valor_bruto_cent:number;cancelada:number;versao:number};
export type Detail={item:Row;items:Line[];parcelas?:Parcel[];
 selo?:{id:string;numero_versao_nf:number;valor_documento_cent:number}|null;
 retificacoes?:{nota_original_id:string;nota_substituta_id:string;motivo:string}[]};
export type Available={parent:{id:string;numero:string|null;versao:number;origem_dado:string;
 situacao:string|null};items:Line[]};
export type DraftLine={id:string;quantidade:string;preco:string};
export function milText(x:number|null|undefined):string{
 if(x===null||x===undefined||!Number.isSafeInteger(x)||x<0)return "—";
 return new Intl.NumberFormat("pt-BR",{maximumFractionDigits:3}).format(x/1000);
}
export function moneyText(x:number|null|undefined):string{
 if(x===null||x===undefined||!Number.isSafeInteger(x)||x<0)return "—";
 return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(x/100);
}
export function rowAmount(q:number,unit:number):number|null{
 if(!Number.isSafeInteger(q)||q<=0||!Number.isSafeInteger(unit)||unit<=0)return null;
 const n=(BigInt(q)*BigInt(unit)+500n)/1000n;
 return n>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(n);
}
export function lineTotal(lines:{quantidadeMil:number;valorUnitCent:number}[]):number|null{
 let sum=0n;for(const x of lines){const n=rowAmount(x.quantidadeMil,x.valorUnitCent);
  if(n===null)return null;sum+=BigInt(n);}
 return sum>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(sum);
}
export function validList(x:unknown):x is {items:Row[];nextCursor:string|null}{
 const v=x as {items?:unknown;nextCursor?:unknown}|null;
 return !!v&&Array.isArray(v.items)&&v.items.length<=50&&
  v.items.every(a=>!!a&&typeof a.id==="string"&&typeof a.versao==="number"&&typeof a.situacao==="string")&&
  (v.nextCursor===null||typeof v.nextCursor==="string");
}
export function validDetail(x:unknown):x is Detail{
 const v=x as Partial<Detail>|null;
 return !!v&&!!v.item&&typeof v.item.id==="string"&&Array.isArray(v.items)&&
  v.items.length<=100&&v.items.every(a=>typeof a.id==="string"&&Number.isSafeInteger(a.quantidade_mil));
}
export function validAvailable(x:unknown):x is Available{
 const v=x as Partial<Available>|null;
 return !!v&&!!v.parent&&typeof v.parent.id==="string"&&Number.isSafeInteger(v.parent.versao)&&
  Array.isArray(v.items)&&v.items.length<=100&&v.items.every(a=>
   typeof a.id==="string"&&Number.isSafeInteger(a.remaining_mil)&&
   a.remaining_mil!==undefined&&a.remaining_mil>=0);
}
