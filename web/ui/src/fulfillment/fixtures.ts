import type {CommitmentLine,PurchaseLine} from "../commercial/types";
import {demoCommercial} from "../commercial/fixtures";
import {rowAmount,type Available,type Detail,type Kind,type Line} from "./types";
export type DemoState={shipments:Detail[];invoices:Detail[]};
export function demoFulfillment(company:string):DemoState{
 if(company.includes("horizonte"))return {shipments:[],invoices:[]};
 const f5=demoCommercial(company),e=f5.commitments[0],c=f5.purchases[0];
 const p=c.items[0] as PurchaseLine,ei=e.items[0] as CommitmentLine;
 return {shipments:[{item:{id:"f6-demo-shipment-1",empenho_id:e.item.id,empenho_numero:e.item.numero,
  situacao:"DESPACHADO",versao:1,origem_dado:"NATIVO",conferencia:"VALIDADO",
  transportadora:"Transportadora fictícia",codigo_rastreio:"DEMO-0001"},
  items:[{id:"f6-demo-shipment-item-1",compra_item_id:p.id,compra_id:c.item.id,
   empenho_item_id:p.empenho_item_id,quantidade_mil:500,quantidade_aceita_mil:0,
   quantidade_recusada_mil:0,numero_item:p.numero_item,descricao_exigida:p.descricao_exigida,
   unidade:p.unidade,versao:1}]}],
 invoices:[{item:{id:"f6-demo-invoice-1",empenho_id:e.item.id,empenho_numero:e.item.numero,
   numero:"NF DEMO 001",serie:"1",situacao:"EMITIDA",versao:1,origem_dado:"NATIVO",
   conferencia:"VALIDADO",valor_documento_cent:78000,emissao:"2027-01-15"},
   items:[{id:"f6-demo-invoice-item-1",empenho_item_id:ei.id,
    quantidade_mil:1000,valor_unit_cent:78000,numero_item:ei.numero_item,
    descricao_exigida:ei.descricao_exigida,unidade:ei.unidade}],
   parcelas:[{id:"f6-demo-parcela-1",parcela:1,valor_bruto_cent:78000,
    cancelada:0,versao:1}],selo:null,retificacoes:[]}]};
}
export function demoParents(company:string):{id:string;numero:string;versao:number}[]{
 return demoCommercial(company).commitments.map(x=>({id:x.item.id,
  numero:x.item.numero||"Empenho sem número",versao:x.item.versao}));
}
export function demoAvailable(company:string,kind:Kind,empenhoId:string,state:DemoState):Available|null{
 const f5=demoCommercial(company),e=f5.commitments.find(x=>x.item.id===empenhoId);
 if(!e)return null;
 let rows:Line[]=[];
 if(kind==="shipments"){
  rows=f5.purchases.filter(x=>x.item.empenho_id===empenhoId).flatMap(p=>p.items.map(source=>{const x=source as PurchaseLine;
   const used=state.shipments.flatMap(d=>d.items).filter(y=>y.compra_item_id===x.id)
    .reduce((sum,y)=>sum+y.quantidade_mil,0);
   return {id:x.id,compra_id:p.item.id,empenho_item_id:x.empenho_item_id,
    numero_item:x.numero_item,descricao_exigida:x.descricao_exigida,unidade:x.unidade,
    quantidade_mil:x.quantidade_mil,valor_unit_cent:x.valor_unit_cent,
    allocated_mil:used,remaining_mil:Math.max(0,x.quantidade_mil-used)};
  }));
 }else{
  rows=e.items.map(source=>{const x=source as CommitmentLine;
   const used=state.invoices.filter(n=>n.item.situacao!=="CANCELADA")
    .flatMap(n=>n.items).filter(y=>y.empenho_item_id===x.id).reduce((sum,y)=>sum+y.quantidade_mil,0);
   return {id:x.id,empenho_item_id:x.id,numero_item:x.numero_item,
    descricao_exigida:x.descricao_exigida,unidade:x.unidade,quantidade_mil:x.quantidade_mil,
    valor_unit_cent:x.valor_unit_cent,allocated_mil:used,remaining_mil:Math.max(0,x.quantidade_mil-used)};
  });
 }
 return {parent:{id:e.item.id,numero:e.item.numero,versao:e.item.versao,
  origem_dado:"NATIVO",situacao:"CONFIRMADO"},items:rows};
}
export function demoCreate(company:string,kind:Kind,state:DemoState,parentId:string,
 lines:{parentItemId:string;quantidadeMil:number;valorUnitCent?:number}[],
 parcelasCent:number[]):Detail{
 const e=demoParents(company).find(x=>x.id===parentId),av=demoAvailable(company,kind,parentId,state);
 const id="f6-preview-"+crypto.randomUUID();
 const items=lines.map((l,index)=>{
  const source=av?.items.find(x=>x.id===l.parentItemId);
  return {id:id+"-"+index,numero_item:source?.numero_item||String(index+1),
   descricao_exigida:source?.descricao_exigida||"Item fictício",unidade:source?.unidade||"UN",
   quantidade_mil:l.quantidadeMil,...(kind==="shipments"?
    {compra_item_id:l.parentItemId,compra_id:source?.compra_id,
     empenho_item_id:source?.empenho_item_id,quantidade_aceita_mil:0,quantidade_recusada_mil:0,versao:1}:
    {empenho_item_id:l.parentItemId,valor_unit_cent:l.valorUnitCent||0})};
 });
 const total=kind==="invoices"?items.reduce((s,x)=>s+(rowAmount(x.quantidade_mil,("valor_unit_cent" in x?x.valor_unit_cent||0:0))||0),0):null;
 return {item:{id,empenho_id:parentId,empenho_numero:e?.numero,
  situacao:kind==="shipments"?"DESPACHADO":"EMITIDA",versao:1,origem_dado:"NATIVO",
  conferencia:"VALIDADO",...(kind==="invoices"?{valor_documento_cent:total}:{})},
 items,...(kind==="invoices"?{parcelas:parcelasCent.map((v,i)=>({
  id:id+"-p-"+i,parcela:i+1,valor_bruto_cent:v,cancelada:0,versao:1})),selo:null,retificacoes:[]}:{})};
}
