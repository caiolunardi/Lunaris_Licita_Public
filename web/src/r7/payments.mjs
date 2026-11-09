// R7 FIN03/04/06/07/08 — eventos distintos: quitação, desfazimento e estorno.
// Nenhum estorno de recebimento cria transferência bancária negativa;
// dinheiro, retenções e data civil vêm sempre do recebimento original.
// Módulo restrito à API local, não conectado ao bootstrap público.
import { requireCompanyRole } from "./security.mjs";
import { DomainError, strictlyObject, identifier, positiveInt,
         money, dateCivil, hashIntent, replayOrConflict, requireBatch } from "./domain.mjs";

const PAYMENT_FIELDS=new Set([
  "intentId","tituloId","expectedVersion","dataPagamento",
  "valorPagoCent","comprovanteDocumentoId"
]);
const UNDO_FIELDS=new Set(["intentId","tituloId","expectedVersion","baixaOriginalId","motivo"]);
const REVERSAL_FIELDS=new Set(["intentId","recebimentoOriginalId","motivo"]);
function nonEmptyReason(reason){
  if(typeof reason!=="string"||!reason.trim()||reason.length>2000){
    throw new DomainError("reason_required");
  }
  return reason.trim();
}
function confirmBatch(results,expected,code){
  if(!Array.isArray(results)||results.length!==expected ||
     results.some(x=>x?.meta?.changes!==1))throw new DomainError(code,409);
}
export async function recordPayment(db,principal,companyId,body){
  requireBatch(db);
  const actor=await requireCompanyRole(db,principal,companyId,"write");
  strictlyObject(body,PAYMENT_FIELDS);
  const intentId=identifier(body.intentId),tituloId=identifier(body.tituloId);
  if(!positiveInt(body.expectedVersion)||!dateCivil(body.dataPagamento)||
     !money(body.valorPagoCent)||body.valorPagoCent===0)throw new DomainError("invalid_payment");
  const documentId=body.comprovanteDocumentoId==null
    ?null:identifier(body.comprovanteDocumentoId);
  const hash=await hashIntent("QUITACAO_TITULO",[
    tituloId,body.expectedVersion,body.dataPagamento,body.valorPagoCent,documentId
  ]);
  const previous=await replayOrConflict(db,companyId,intentId,hash,"QUITACAO_TITULO");
  if(previous)return previous;
  const paymentId=crypto.randomUUID();
  const payment=db.prepare(
    "INSERT INTO titulo_baixas (id,empresa_id,titulo_id,tipo,data_pagamento,"+
    "valor_pago_cent,comprovante_documento_id,ator_id,operacao_id,"+
    "origem_dado,conferencia) "+
    "SELECT ?,t.empresa_id,t.id,'QUITACAO',?,?,?,?,?,'NATIVO','VALIDADO' "+
    "FROM titulos_pagar t WHERE t.id=? AND t.empresa_id=? AND t.versao=? "+
    "AND t.cancelado=0 AND (t.origem_dado='NATIVO' OR t.conferencia='VALIDADO') "+
    "AND NOT EXISTS (SELECT 1 FROM titulo_baixas b "+
    "WHERE b.titulo_id=t.id AND b.empresa_id=t.empresa_id AND b.tipo='QUITACAO' "+
    "AND NOT EXISTS(SELECT 1 FROM titulo_baixas undo "+
    "WHERE undo.baixa_original_id=b.id AND undo.tipo='DESFAZIMENTO')) "+
    "AND NOT EXISTS(SELECT 1 FROM operacoes op WHERE op.id=?)"
  ).bind(paymentId,body.dataPagamento,body.valorPagoCent,documentId,
         actor.userId,intentId,tituloId,companyId,body.expectedVersion,intentId);
  const change=db.prepare(
    "UPDATE titulos_pagar SET versao=versao+1,operacao_id=? "+
    "WHERE id=? AND empresa_id=? AND versao=? "+
    "AND EXISTS (SELECT 1 FROM titulo_baixas b WHERE b.id=? "+
    "AND b.titulo_id=titulos_pagar.id AND b.empresa_id=titulos_pagar.empresa_id "+
    "AND b.operacao_id=?)"
  ).bind(intentId,tituloId,companyId,body.expectedVersion,paymentId,intentId);
  const journal=db.prepare(
    "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "SELECT ?,?,'QUITACAO_TITULO',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
    "FROM titulo_baixas b JOIN titulos_pagar t ON t.id=b.titulo_id AND t.empresa_id=b.empresa_id "+
    "WHERE b.id=? AND b.empresa_id=? AND b.operacao_id=? "+
    "AND t.versao=? AND t.operacao_id=?"
  ).bind(intentId,companyId,hash,actor.userId,paymentId,companyId,intentId,
         body.expectedVersion+1,intentId);
  let res;
  try{res=await db.batch([payment,change,journal]);}
  catch{throw new DomainError("payment_conflict",409);}
  const again=async()=>replayOrConflict(db,companyId,intentId,hash,"QUITACAO_TITULO");
  if(res?.[0]?.meta?.changes===0){const replay=await again();if(replay)return replay;}
  confirmBatch(res,3,"payment_not_allowed");
  return {replayed:false,intentId,paymentId,newVersion:body.expectedVersion+1};
}
export async function undoPayment(db,principal,companyId,body){
  requireBatch(db);
  const actor=await requireCompanyRole(db,principal,companyId,"write");
  strictlyObject(body,UNDO_FIELDS);
  const intentId=identifier(body.intentId),tituloId=identifier(body.tituloId);
  const original=identifier(body.baixaOriginalId);
  if(!positiveInt(body.expectedVersion))throw new DomainError("invalid_version");
  const motivo=nonEmptyReason(body.motivo);
  const hash=await hashIntent("DESFAZER_QUITACAO",[
    tituloId,original,body.expectedVersion,motivo
  ]);
  const previous=await replayOrConflict(db,companyId,intentId,hash,"DESFAZER_QUITACAO");
  if(previous)return previous;
  const undoId=crypto.randomUUID();
  const undo=db.prepare(
    "INSERT INTO titulo_baixas (id,empresa_id,titulo_id,tipo,baixa_original_id,"+
    "motivo,ator_id,operacao_id,origem_dado,conferencia) "+
    "SELECT ?,t.empresa_id,t.id,'DESFAZIMENTO',?,?,?,?,'NATIVO','VALIDADO' "+
    "FROM titulos_pagar t "+
    "JOIN titulo_baixas b ON b.titulo_id=t.id AND b.empresa_id=t.empresa_id "+
    "WHERE t.id=? AND t.empresa_id=? AND t.versao=? AND b.id=? "+
    "AND b.tipo='QUITACAO' AND t.cancelado=0 "+
    "AND NOT EXISTS(SELECT 1 FROM titulo_baixas d "+
    "WHERE d.baixa_original_id=b.id AND d.tipo='DESFAZIMENTO') "+
    "AND NOT EXISTS(SELECT 1 FROM operacoes op WHERE op.id=?)"
  ).bind(undoId,original,motivo,actor.userId,intentId,
         tituloId,companyId,body.expectedVersion,original,intentId);
  const change=db.prepare(
    "UPDATE titulos_pagar SET versao=versao+1,operacao_id=? "+
    "WHERE id=? AND empresa_id=? AND versao=? "+
    "AND EXISTS(SELECT 1 FROM titulo_baixas d WHERE d.id=? "+
    "AND d.titulo_id=titulos_pagar.id AND d.empresa_id=titulos_pagar.empresa_id "+
    "AND d.operacao_id=?)"
  ).bind(intentId,tituloId,companyId,body.expectedVersion,undoId,intentId);
  const journal=db.prepare(
    "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "SELECT ?,?,'DESFAZER_QUITACAO',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
    "FROM titulo_baixas d JOIN titulos_pagar t ON t.id=d.titulo_id AND t.empresa_id=d.empresa_id "+
    "WHERE d.id=? AND d.empresa_id=? AND d.operacao_id=? "+
    "AND t.versao=? AND t.operacao_id=?"
  ).bind(intentId,companyId,hash,actor.userId,undoId,companyId,intentId,
         body.expectedVersion+1,intentId);
  let results;
  try{results=await db.batch([undo,change,journal]);}
  catch{throw new DomainError("undo_conflict",409);}
  if(results?.[0]?.meta?.changes===0){
    const replay=await replayOrConflict(db,companyId,intentId,hash,"DESFAZER_QUITACAO");
    if(replay)return replay;
  }
  confirmBatch(results,3,"undo_not_allowed");
  return {replayed:false,intentId,undoId,newVersion:body.expectedVersion+1};
}
export async function reverseCredit(db,principal,companyId,body){
  requireBatch(db);
  const actor=await requireCompanyRole(db,principal,companyId,"write");
  strictlyObject(body,REVERSAL_FIELDS);
  const intentId=identifier(body.intentId),originalId=identifier(body.recebimentoOriginalId);
  const motivo=nonEmptyReason(body.motivo);
  const hash=await hashIntent("ESTORNAR_RECEBIMENTO",[originalId,motivo]);
  const previous=await replayOrConflict(db,companyId,intentId,hash,"ESTORNAR_RECEBIMENTO");
  if(previous)return previous;
  const reversedId=crypto.randomUUID();
  const reversal=db.prepare(
    "INSERT INTO recebimentos (id,empresa_id,conta_receber_id,tipo_movimento,estorno_de_id,"+
    "data_credito,valor_recebido_cent,retencao_confirmada_cent,motivo,operacao_id,"+
    "origem_dado,conferencia) "+
    "SELECT ?,orig.empresa_id,orig.conta_receber_id,'ESTORNO',orig.id,"+
    "orig.data_credito,orig.valor_recebido_cent,orig.retencao_confirmada_cent,?,?,"+
    "'NATIVO','VALIDADO' "+
    "FROM recebimentos orig WHERE orig.id=? AND orig.empresa_id=? "+
    "AND orig.tipo_movimento='RECEBIMENTO' "+
    "AND orig.origem_dado='NATIVO' "+
    "AND NOT EXISTS(SELECT 1 FROM recebimentos d "+
    "WHERE d.estorno_de_id=orig.id AND d.tipo_movimento='ESTORNO') "+
    "AND NOT EXISTS(SELECT 1 FROM operacoes op WHERE op.id=?)"
  ).bind(reversedId,motivo,intentId,originalId,companyId,intentId);
  const journal=db.prepare(
    "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "SELECT ?,?,'ESTORNAR_RECEBIMENTO',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
    "FROM recebimentos d WHERE d.id=? AND d.empresa_id=? "+
    "AND d.operacao_id=? AND d.tipo_movimento='ESTORNO'"
  ).bind(intentId,companyId,hash,actor.userId,reversedId,companyId,intentId);
  let res;
  try{res=await db.batch([reversal,journal]);}
  catch{throw new DomainError("reversal_conflict",409);}
  if(res?.[0]?.meta?.changes===0){
    const replay=await replayOrConflict(db,companyId,intentId,hash,"ESTORNAR_RECEBIMENTO");
    if(replay)return replay;
  }
  confirmBatch(res,2,"reversal_not_allowed");
  return {replayed:false,intentId,reversalId:reversedId};
}
