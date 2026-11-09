// R7 etapa 2 / Q01 Q05 Q07: comandos de negocio reais sobre D1.
// Toda mudanca acompanha versao/CAS e diario na mesma D1.batch.
// Sem privilegio herdado do corpo; origem LEGADO nao e alterada por atalho.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier,positiveInt,money,
 hashIntent,replayOrConflict,requireBatch} from "./domain.mjs";

const AWARD=new Set(["intentId","licitacaoId","licitacaoItemId","expectedVersion",
 "resultado","quantidadeGanhaMil","valorFinalUnitCent"]);
const DELIVERY=new Set(["intentId","envioId","envioItemId","expectedVersion",
 "quantidadeAceitaMil","quantidadeRecusadaMil","motivoRecusa"]);

function resultOk(results){
 return Array.isArray(results)&&results.length===2&&
        results.every(r=>r?.meta?.changes===1);
}
export async function decideAwardItem(db,principal,empresaId,body){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,empresaId,"write");
 strictlyObject(body,AWARD);
 const op=identifier(body.intentId),lic=identifier(body.licitacaoId),
       item=identifier(body.licitacaoItemId);
 const version=body.expectedVersion;
 if(!positiveInt(version)||!["GANHO","PERDIDO","CANCELADO"].includes(body.resultado)){
   throw new DomainError("invalid_award_decision");
 }
 const won=body.resultado==="GANHO";
 const qty=won?body.quantidadeGanhaMil:null;
 const price=won?body.valorFinalUnitCent:null;
 if(won?(!positiveInt(qty)||!positiveInt(price)||!money(price)):
       !(body.quantidadeGanhaMil==null&&body.valorFinalUnitCent==null)){
   throw new DomainError("invalid_award_quantity_or_price");
 }
 const hash=await hashIntent("RESULTADO_ITEM_LICITACAO",
   [lic,item,version,body.resultado,qty,price]);
 const prior=await replayOrConflict(db,empresaId,op,hash,"RESULTADO_ITEM_LICITACAO");
 if(prior)return prior;
 const change=db.prepare(
  "UPDATE licitacao_itens SET resultado=?,quantidade_ganha_mil=?,"+
  "valor_final_unit_cent=?,versao=versao+1,operacao_id=?,conferencia='VALIDADO' "+
  "WHERE id=? AND licitacao_id=? AND empresa_id=? AND versao=? "+
  "AND origem_dado='NATIVO' AND quantidade_prevista_mil IS NOT NULL "+
  "AND (? IS NULL OR ?<=quantidade_prevista_mil) "+
  "AND EXISTS(SELECT 1 FROM licitacoes l WHERE l.id=? "+
  "AND l.empresa_id=? AND l.encerrada_em IS NULL) "+
  "AND NOT EXISTS(SELECT 1 FROM empenho_itens ei "+
  "JOIN empenhos e ON e.id=ei.empenho_id AND e.empresa_id=ei.empresa_id "+
  "WHERE ei.empresa_id=licitacao_itens.empresa_id "+
  "AND ei.licitacao_item_id=licitacao_itens.id "+
  "AND e.situacao='CONFIRMADO') "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes o WHERE o.id=?)"
 ).bind(body.resultado,qty,price,op,item,lic,empresaId,version,
        qty,qty,lic,empresaId,op);
 const journal=db.prepare(
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "origem_dado,conferencia) "+
  "SELECT ?,?,'RESULTADO_ITEM_LICITACAO',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
  "FROM licitacao_itens li WHERE li.id=? AND li.licitacao_id=? "+
  "AND li.empresa_id=? AND li.versao=? AND li.operacao_id=?"
 ).bind(op,empresaId,hash,actor.userId,item,lic,empresaId,version+1,op);
 let results;
 try{results=await db.batch([change,journal]);}
 catch{throw new DomainError("award_state_conflict",409);}
 if(resultOk(results))return {replayed:false,intentId:op,
   licitacaoItemId:item,newVersion:version+1,resultado:body.resultado};
 const raced=await replayOrConflict(db,empresaId,op,hash,"RESULTADO_ITEM_LICITACAO");
 if(raced)return raced;
 throw new DomainError("award_state_conflict",409);
}

export async function registerDeliveryAcceptance(db,principal,empresaId,body){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,empresaId,"write");
 strictlyObject(body,DELIVERY);
 const op=identifier(body.intentId),shipment=identifier(body.envioId),
       item=identifier(body.envioItemId);
 const version=body.expectedVersion,accepted=body.quantidadeAceitaMil,
       refused=body.quantidadeRecusadaMil;
 const reason=body.motivoRecusa==null?null:body.motivoRecusa;
 if(!positiveInt(version)||!money(accepted)||!money(refused)||
   !positiveInt(accepted+refused)||!Number.isSafeInteger(accepted+refused)||
   (refused>0&&(typeof reason!=="string"||
     reason.trim().length<3||reason.length>2000))||
   (refused===0&&reason!==null)){
  throw new DomainError("invalid_delivery_acceptance");
 }
 const hash=await hashIntent("ACEITE_REMESSA",
   [shipment,item,version,accepted,refused,reason]);
 const prior=await replayOrConflict(db,empresaId,op,hash,"ACEITE_REMESSA");
 if(prior)return prior;
 const update=db.prepare(
   "UPDATE envio_itens SET quantidade_aceita_mil=?,"+
   "quantidade_recusada_mil=?,motivo_recusa=?,versao=versao+1,"+
   "operacao_id=?,conferencia='VALIDADO' "+
   "WHERE id=? AND envio_id=? AND empresa_id=? AND versao=? "+
   "AND origem_dado='NATIVO' AND quantidade_mil IS NOT NULL "+
   "AND ?+?<=quantidade_mil "+
   "AND EXISTS(SELECT 1 FROM envios e WHERE e.id=? AND "+
   "e.empresa_id=? AND e.situacao IN ('DESPACHADO','ENTREGUE')) "+
   "AND NOT EXISTS(SELECT 1 FROM operacoes o WHERE o.id=?)"
 ).bind(accepted,refused,reason,op,item,shipment,empresaId,version,
        accepted,refused,shipment,empresaId,op);
 const journal=db.prepare(
   "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
   "origem_dado,conferencia) "+
   "SELECT ?,?,'ACEITE_REMESSA',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
   "FROM envio_itens ei WHERE ei.id=? AND ei.envio_id=? "+
   "AND ei.empresa_id=? AND ei.versao=? AND ei.operacao_id=?"
 ).bind(op,empresaId,hash,actor.userId,item,shipment,empresaId,version+1,op);
 let res;
 try{res=await db.batch([update,journal]);}
 catch{throw new DomainError("delivery_acceptance_conflict",409);}
 if(resultOk(res))return {replayed:false,intentId:op,envioItemId:item,
   quantidadeAceitaMil:accepted,quantidadeRecusadaMil:refused,newVersion:version+1};
 const raced=await replayOrConflict(db,empresaId,op,hash,"ACEITE_REMESSA");
 if(raced)return raced;
 throw new DomainError("delivery_acceptance_conflict",409);
}
