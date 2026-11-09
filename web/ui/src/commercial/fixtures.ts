import {demoTenders} from "../tenders/fixtures";
import {safeRemaining,type RecordRow,type Detail,type AvailableLine,type ParentAvailable,type ParentOption,type Kind,type Supplier} from "./types";
export type DemoState={commitments:Detail[];purchases:Detail[]};
const prefix=(id:string)=>id.includes("horizonte")?"h":"a";
export function demoSuppliers(company:string):Supplier[]{
 return prefix(company)==="h"?[{id:"f5-demo-h-s1",nome:"Fornecedor Horizonte (fictício)",ativo:1}]:
 [{id:"f5-demo-a-s1",nome:"Fornecedor Sul (fictício)",ativo:1},
  {id:"f5-demo-a-s2",nome:"Distribuidora Norte (fictícia)",ativo:1}];
}
export function demoCommercial(company:string):DemoState{
 const q=prefix(company),t=demoTenders(company)[0],li=t.items[0];
 if(q==="h")return {commitments:[],purchases:[]};
 const empenho="f5-demo-a-empenho-1",compra="f5-demo-a-compra-1";
 const e:RecordRow={id:empenho,numero:"NE 042/2027 (fictícia)",
  situacao:"CONFIRMADO",licitacao_id:t.item.id,licitacao_numero:t.item.numero,
  orgao_nome:t.item.orgao_nome,versao:1,origem_dado:"NATIVO",conferencia:"VALIDADO"};
 const c:RecordRow={id:compra,numero:"PED 010/2027 (fictício)",numero_pedido:"PED 010/2027 (fictício)",
  situacao:"CONFIRMADA",empenho_id:empenho,empenho_numero:e.numero||"",
  fornecedor_id:"f5-demo-a-s1",fornecedor_nome:"Fornecedor Sul (fictício)",
  versao:1,origem_dado:"NATIVO",conferencia:"VALIDADO"};
 return {
  commitments:[{item:e,items:[{id:"f5-demo-a-ei-1",empenho_id:empenho,
   licitacao_item_id:li.id,quantidade_mil:2000,valor_unit_cent:li.valor_final_unit_cent||78000,
   numero_item:li.numero_item,descricao_exigida:li.descricao_exigida,unidade:li.unidade,
   quantidade_ganha_mil:li.quantidade_ganha_mil||3000,resultado:"GANHO",versao:1,origem_dado:"NATIVO"}]}],
  purchases:[{item:c,items:[{id:"f5-demo-a-ci-1",compra_id:compra,
   empenho_item_id:"f5-demo-a-ei-1",quantidade_mil:1000,valor_unit_cent:70000,
   numero_item:li.numero_item,descricao_exigida:li.descricao_exigida,unidade:li.unidade,
   licitacao_item_id:li.id,versao:1,origem_dado:"NATIVO"}]}]
 };
}
export function demoParents(company:string,kind:Kind,state:DemoState):ParentOption[]{
 if(kind==="commitments")return demoTenders(company)
  .map(t=>({id:t.item.id,numero:t.item.numero,versao:t.item.versao,
   label:t.item.numero+" · "+t.item.orgao_nome}));
 return state.commitments.map(c=>({id:c.item.id,numero:c.item.numero||"",
  versao:c.item.versao,label:(c.item.numero||"Empenho")+" · "+c.item.orgao_nome}));
}
export function demoAvailable(company:string,kind:Kind,parentId:string,state:DemoState):ParentAvailable|null{
 if(kind==="commitments"){
  const t=demoTenders(company).find(x=>x.item.id===parentId);
  if(!t)return null;
  const lines:AvailableLine[]=t.items.filter(x=>x.resultado==="GANHO").map(x=>{
   const used=state.commitments.flatMap(c=>c.items).filter(y=>y.licitacao_item_id===x.id)
    .reduce((s,y)=>s+y.quantidade_mil,0);
   const won=x.quantidade_ganha_mil||0;
   return {id:x.id,numero_item:x.numero_item,descricao_exigida:x.descricao_exigida,
    unidade:x.unidade,quantidade_ganha_mil:won,valor_final_unit_cent:x.valor_final_unit_cent||0,
    allocated_mil:used,remaining_mil:safeRemaining(won,used)};
  });
  return {parent:{id:t.item.id,numero:t.item.numero,versao:t.item.versao,
   origem_dado:t.item.origem_dado,encerrada_em:t.item.encerrada_em,
   situacao_participacao:t.item.situacao_participacao},items:lines};
 }
 const e=state.commitments.find(x=>x.item.id===parentId);
 if(!e)return null;
 const lines:AvailableLine[]=e.items.map(x=>{
  const used=state.purchases.flatMap(c=>c.items).filter(y=>"empenho_item_id" in y&&y.empenho_item_id===x.id)
   .reduce((s,y)=>s+y.quantidade_mil,0);
  return {id:x.id,numero_item:x.numero_item,descricao_exigida:x.descricao_exigida,
   unidade:x.unidade,quantidade_mil:x.quantidade_mil,valor_unit_cent:x.valor_unit_cent,
   allocated_mil:used,remaining_mil:safeRemaining(x.quantidade_mil,used)};
 });
 return {parent:{id:e.item.id,numero:e.item.numero||"",versao:e.item.versao,
  origem_dado:e.item.origem_dado,situacao:e.item.situacao},items:lines};
}
