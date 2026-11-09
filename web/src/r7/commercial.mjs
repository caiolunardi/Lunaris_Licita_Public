// R7 etapa 1 / OK01 — fluxo comercial atômico para resultado parcial
// e múltiplos empenhos, compras, NFs emitidas ANTES de remessas e entregas
// fracionadas. Escopo local: não substitui os demais endpoints comerciais.
// Quantidades milésimas e centavos exatos; D1.batch reverte toda falha.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier,positiveInt,money,
        hashIntent,replayOrConflict,requireBatch} from "./domain.mjs";

const FIELDS=new Set(["intentId","licitacaoId","licitacaoItemId",
                      "fornecedorId","empenhos"]);
const CHAIN_FIELDS=new Set(["quantidadeMil","entregasMil"]);
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
function lineTotal(q,price){
 const total=(BigInt(q)*BigInt(price)+500n)/1000n;
 if(total>MAX||total<=0n)throw new DomainError("commercial_value_overflow",409);
 return Number(total);
}
function params(statement,values){return [statement,values];}
export async function recordPartialAwardCycle(db,principal,companyId,body){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 strictlyObject(body,FIELDS);
 const intentId=identifier(body.intentId);
 const licitacaoId=identifier(body.licitacaoId);
 const itemId=identifier(body.licitacaoItemId);
 const fornecedorId=identifier(body.fornecedorId);
 if(!Array.isArray(body.empenhos)||body.empenhos.length<2||body.empenhos.length>8){
  throw new DomainError("partial_award_requires_multiple_commitments");
 }
 let expected=0n;
 const chains=body.empenhos.map(x=>{
   strictlyObject(x,CHAIN_FIELDS);
   if(!positiveInt(x.quantidadeMil)||!Array.isArray(x.entregasMil)||
      x.entregasMil.length!==2||!x.entregasMil.every(positiveInt)||
      x.entregasMil[0]+x.entregasMil[1]!==x.quantidadeMil){
     throw new DomainError("invalid_partial_shipments");
   }
   expected+=BigInt(x.quantidadeMil);
   return {quantidadeMil:x.quantidadeMil,entregasMil:[...x.entregasMil]};
 });
 if(expected>MAX)throw new DomainError("quantity_overflow");
 const hash=await hashIntent("CICLO_COMERCIAL_PARCIAL",[
   licitacaoId,itemId,fornecedorId,chains
 ]);
 const replay=await replayOrConflict(db,companyId,intentId,hash,"CICLO_COMERCIAL_PARCIAL");
 if(replay)return replay;
 const item=await db.prepare(
  "SELECT li.id,li.quantidade_ganha_mil,li.quantidade_prevista_mil,"+
  "li.valor_final_unit_cent,li.resultado,l.orgao_id,l.encerrada_em "+
  "FROM licitacao_itens li "+
  "JOIN licitacoes l ON l.id=li.licitacao_id AND l.empresa_id=li.empresa_id "+
  "WHERE li.id=? AND li.licitacao_id=? AND li.empresa_id=?"
 ).bind(itemId,licitacaoId,companyId).first();
 if(!item||item.resultado!=="GANHO"||item.encerrada_em!=null||
    !positiveInt(item.quantidade_ganha_mil)||
    !positiveInt(item.quantidade_prevista_mil)||
    item.quantidade_ganha_mil>item.quantidade_prevista_mil||
    !positiveInt(item.valor_final_unit_cent)||
    expected>BigInt(item.quantidade_ganha_mil)){
   throw new DomainError("licitacao_item_not_eligible",409);
 }
 const supplier=await db.prepare(
  "SELECT id FROM fornecedores WHERE id=? AND empresa_id=?"
 ).bind(fornecedorId,companyId).first();
 if(!supplier)throw new DomainError("supplier_not_found",409);
 const statements=[],ids=[];
 const statement=(sql,args)=>statements.push(db.prepare(sql).bind(...args));
 for(const [index,c] of chains.entries()){
   const ep=crypto.randomUUID(),epi=crypto.randomUUID();
   const cp=crypto.randomUUID(),cpi=crypto.randomUUID();
   const nf=crypto.randomUUID(),nfi=crypto.randomUUID(),cr=crypto.randomUUID();
   const total=lineTotal(c.quantidadeMil,item.valor_final_unit_cent);
   statement(
    "INSERT INTO empenhos (id,empresa_id,licitacao_id,orgao_id_escopo,"+
    "numero,situacao,operacao_id,conferencia) "+
    "VALUES (?,?,?,?,?,'CONFIRMADO',?,'VALIDADO')",
    [ep,companyId,licitacaoId,item.orgao_id,"PARCIAL-"+intentId+"-"+(index+1),intentId]
   );
   statement(
    "INSERT INTO empenho_itens (id,empresa_id,empenho_id,licitacao_item_id,"+
    "licitacao_id_escopo,quantidade_mil,valor_unit_cent,operacao_id,conferencia) "+
    "VALUES (?,?,?,?,?,?,?,?,'VALIDADO')",
    [epi,companyId,ep,itemId,licitacaoId,c.quantidadeMil,item.valor_final_unit_cent,intentId]
   );
   statement(
    "INSERT INTO compras (id,empresa_id,empenho_id,fornecedor_id,situacao,"+
    "operacao_id,conferencia) "+
    "VALUES (?,?,?,?,'CONFIRMADA',?,'VALIDADO')",
    [cp,companyId,ep,fornecedorId,intentId]
   );
   statement(
    "INSERT INTO compra_itens (id,empresa_id,compra_id,empenho_item_id,"+
    "empenho_id_escopo,quantidade_mil,valor_unit_cent,operacao_id,conferencia) "+
    "VALUES (?,?,?,?,?,?,?,?,'VALIDADO')",
    [cpi,companyId,cp,epi,ep,c.quantidadeMil,item.valor_final_unit_cent,intentId]
   );
   // NF ANTES das entregas, sem dependência de envio.
   statement(
    "INSERT INTO notas_fiscais (id,empresa_id,empenho_id,orgao_id_escopo,"+
    "situacao,valor_documento_cent,operacao_id,conferencia) "+
    "VALUES (?,?,?,?,'EMITIDA',?,?,'VALIDADO')",
    [nf,companyId,ep,item.orgao_id,total,intentId]
   );
   statement(
    "INSERT INTO nota_fiscal_itens (id,empresa_id,nota_fiscal_id,empenho_item_id,"+
    "empenho_id_escopo,quantidade_mil,valor_unit_cent,operacao_id,conferencia) "+
    "VALUES (?,?,?,?,?,?,?,?,'VALIDADO')",
    [nfi,companyId,nf,epi,ep,c.quantidadeMil,item.valor_final_unit_cent,intentId]
   );
   statement(
    "INSERT INTO contas_receber (id,empresa_id,nota_fiscal_id,parcela,"+
    "valor_bruto_cent,operacao_id,conferencia) "+
    "VALUES (?,?,?,1,?,?,'VALIDADO')",
    [cr,companyId,nf,total,intentId]
   );
   const shipments=[];
   for(const [idx,quantity] of c.entregasMil.entries()){
     const shipment=crypto.randomUUID(),shipmentItem=crypto.randomUUID();
     statement(
      "INSERT INTO envios (id,empresa_id,empenho_id,situacao,operacao_id,conferencia) "+
      "VALUES (?,?,?,'DESPACHADO',?,'VALIDADO')",
      [shipment,companyId,ep,intentId]
     );
     statement(
      "INSERT INTO envio_itens (id,empresa_id,envio_id,compra_item_id,"+
      "empenho_id_escopo,quantidade_mil,quantidade_aceita_mil,"+
      "quantidade_recusada_mil,operacao_id,conferencia) "+
      "VALUES (?,?,?,?,?,?,0,0,?,'VALIDADO')",
      [shipmentItem,companyId,shipment,cpi,ep,quantity,intentId]
     );
     shipments.push({envioId:shipment,quantidadeMil:quantity});
   }
   ids.push({empenhoId:ep,compraId:cp,notaFiscalId:nf,
             contaReceberId:cr,empenhadoMil:c.quantidadeMil,
             valorNFcent:total,envios:shipments});
 }
 statement(
  "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "origem_dado,conferencia) "+
  "VALUES (?,?,'CICLO_COMERCIAL_PARCIAL',?,?,'CONCLUIDA','NATIVO','VALIDADO')",
  [intentId,companyId,hash,actor.userId]
 );
 let res;
 try{res=await db.batch(statements);}
 catch{throw new DomainError("commercial_atomic_conflict",409);}
 if(!Array.isArray(res)||res.length!==statements.length||
    res.some(x=>x?.meta?.changes!==1)){
  throw new DomainError("commercial_atomic_incomplete",409);
 }
 return {replayed:false,intentId,licitacaoId,licitacaoItemId:itemId,
   totalEmpenhadoMil:Number(expected),compromissos:ids};
}
