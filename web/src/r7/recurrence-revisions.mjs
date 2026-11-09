// R7 etapa 2 / REC03 REC04 — revisões append-only de recorrência.
// O mês passado, mês já gerado ou pago nunca é reescrito. Alteração de valor
// agenda novo valor a partir de competência ainda não materializada.
// Encerramento usa limite fim_depois, não cancela títulos e não finge que
// a recorrência foi apagada. Diario contém razão e instante do ato.
// Sem cron/publicação: somente Worker HTTP local.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier,positiveInt,money,
        hashIntent,replayOrConflict,requireBatch,dueDateForCompetence}
  from "./domain.mjs";

const REV_FIELDS=new Set(["intentId","recorrenciaId","expectedVersion",
  "vigenteAPartir","valorNovoCent","motivo"]);
const CLOSE_FIELDS=new Set(["intentId","recorrenciaId","expectedVersion",
  "fimDepois","motivo"]);
function monthLocal(nowMs){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",
  year:"numeric",month:"2-digit"}).formatToParts(new Date(nowMs));
 return parts.find(p=>p.type==="year").value+"-"+
        parts.find(p=>p.type==="month").value;
}
function checkMonth(month,nowMs){
 dueDateForCompetence(month,1);
 if(month<monthLocal(nowMs))throw new DomainError("historical_competence_not_editable",409);
}
function checkReason(s){
 if(typeof s!=="string"||s!==s.trim()||s.length<5||s.length>1000){
  throw new DomainError("revision_reason_required");
 }
 return s;
}
function complete(results,length){
 return Array.isArray(results)&&results.length===length&&
        results.every(x=>x?.meta?.changes===1);
}

export async function reviseRecurringAmount(db,principal,companyId,body,{nowMs=Date.now()}={}){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 strictlyObject(body,REV_FIELDS);
 const intent=identifier(body.intentId),rec=identifier(body.recorrenciaId);
 if(!positiveInt(body.expectedVersion)||!positiveInt(body.valorNovoCent)||
    !money(body.valorNovoCent))throw new DomainError("invalid_recurring_change");
 checkMonth(body.vigenteAPartir,nowMs);
 const reason=checkReason(body.motivo);
 const hash=await hashIntent("REVISAR_VALOR_RECORRENCIA",[
   rec,body.expectedVersion,body.vigenteAPartir,body.valorNovoCent,reason
 ]);
 const prior=await replayOrConflict(db,companyId,intent,hash,"REVISAR_VALOR_RECORRENCIA");
 if(prior)return prior;
 const rule=await db.prepare(
   "SELECT valor_atual_cent,ultima_competencia,estado,origem_dado,versao "+
   "FROM recorrencias WHERE id=? AND empresa_id=?"
 ).bind(rec,companyId).first();
 if(!rule||rule.estado!=="ATIVA"||rule.origem_dado!=="NATIVO"||
    !positiveInt(rule.valor_atual_cent)||rule.versao!==body.expectedVersion||
    rule.valor_atual_cent===body.valorNovoCent||
    (rule.ultima_competencia&&rule.ultima_competencia>=body.vigenteAPartir)){
   throw new DomainError("recurrence_revision_conflict",409);
 }
 const revisionId=crypto.randomUUID(),month=monthLocal(nowMs);
 const update=db.prepare(
  "UPDATE recorrencias SET valor_atual_cent=?,versao=versao+1,operacao_id=? "+
  "WHERE id=? AND empresa_id=? AND versao=? AND estado='ATIVA' "+
  "AND origem_dado='NATIVO' AND valor_atual_cent=? "+
  "AND (ultima_competencia IS NULL OR ultima_competencia<?) "+
  "AND NOT EXISTS (SELECT 1 FROM titulos_pagar t "+
  "WHERE t.empresa_id=recorrencias.empresa_id "+
  "AND t.recorrencia_id=recorrencias.id AND t.competencia>=?) "+
  "AND NOT EXISTS (SELECT 1 FROM recorrencia_revisoes rev "+
  "WHERE rev.empresa_id=recorrencias.empresa_id "+
  "AND rev.recorrencia_id=recorrencias.id AND "+
  "((rev.tipo='VALOR' AND rev.vigente_a_partir>?) "+
  "OR (rev.tipo='ENCERRAR' AND rev.fim_depois<?))) "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes op WHERE op.id=?)"
 ).bind(body.valorNovoCent,intent,rec,companyId,body.expectedVersion,
   rule.valor_atual_cent,body.vigenteAPartir,body.vigenteAPartir,
   month,body.vigenteAPartir,intent);
 const review=db.prepare(
  "INSERT INTO recorrencia_revisoes (id,empresa_id,recorrencia_id,tipo,"+
  "valor_antes_cent,valor_depois_cent,vigente_a_partir,ator_id,operacao_id,"+
  "conferencia,origem_dado) "+
  "SELECT ?,r.empresa_id,r.id,'VALOR',?,?,?,? ,?,'VALIDADO','NATIVO' "+
  "FROM recorrencias r WHERE r.id=? AND r.empresa_id=? "+
  "AND r.versao=? AND r.operacao_id=?"
 ).bind(revisionId,rule.valor_atual_cent,body.valorNovoCent,
   body.vigenteAPartir,actor.userId,intent,rec,companyId,
   body.expectedVersion+1,intent);
 const journal=db.prepare(
  "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "plano_json,origem_dado,conferencia) "+
  "SELECT ?,?,'REVISAR_VALOR_RECORRENCIA',?,?,'CONCLUIDA',?,'NATIVO','VALIDADO' "+
  "FROM recorrencia_revisoes rev WHERE rev.id=? AND rev.empresa_id=? "+
  "AND rev.operacao_id=?"
 ).bind(intent,companyId,hash,actor.userId,
   JSON.stringify({motivo:reason,vigenteAPartir:body.vigenteAPartir}),
   revisionId,companyId,intent);
 let results;
 try{results=await db.batch([update,review,journal]);}
 catch{throw new DomainError("recurrence_revision_conflict",409);}
 if(complete(results,3))return {replayed:false,intentId:intent,
  recorrenciaId:rec,newVersion:body.expectedVersion+1,
  vigenteAPartir:body.vigenteAPartir,valorNovoCent:body.valorNovoCent};
 const raced=await replayOrConflict(db,companyId,intent,hash,"REVISAR_VALOR_RECORRENCIA");
 if(raced)return raced;
 throw new DomainError("recurrence_revision_conflict",409);
}

export async function setRecurringLastMonth(db,principal,companyId,body,{nowMs=Date.now()}={}){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 strictlyObject(body,CLOSE_FIELDS);
 const intent=identifier(body.intentId),rec=identifier(body.recorrenciaId);
 if(!positiveInt(body.expectedVersion))throw new DomainError("invalid_version");
 checkMonth(body.fimDepois,nowMs);
 const reason=checkReason(body.motivo);
 const hash=await hashIntent("ENCERRAR_RECORRENCIA_APOS",[
  rec,body.expectedVersion,body.fimDepois,reason
 ]);
 const prior=await replayOrConflict(db,companyId,intent,hash,"ENCERRAR_RECORRENCIA_APOS");
 if(prior)return prior;
 const rule=await db.prepare(
  "SELECT ultima_competencia,estado,origem_dado,versao FROM recorrencias "+
  "WHERE id=? AND empresa_id=?"
 ).bind(rec,companyId).first();
 if(!rule||rule.estado!=="ATIVA"||rule.origem_dado!=="NATIVO"||
    rule.versao!==body.expectedVersion||
    (rule.ultima_competencia&&rule.ultima_competencia>body.fimDepois)){
  throw new DomainError("recurrence_end_conflict",409);
 }
 const reviewId=crypto.randomUUID();
 const update=db.prepare(
  "UPDATE recorrencias SET versao=versao+1,operacao_id=? "+
  "WHERE id=? AND empresa_id=? AND estado='ATIVA' "+
  "AND origem_dado='NATIVO' AND versao=? "+
  "AND (ultima_competencia IS NULL OR ultima_competencia<=?) "+
  "AND NOT EXISTS (SELECT 1 FROM titulos_pagar t "+
  "WHERE t.recorrencia_id=recorrencias.id "+
  "AND t.empresa_id=recorrencias.empresa_id AND t.competencia>?) "+
  "AND NOT EXISTS (SELECT 1 FROM recorrencia_revisoes v "+
  "WHERE v.recorrencia_id=recorrencias.id "+
  "AND v.empresa_id=recorrencias.empresa_id AND v.tipo='ENCERRAR') "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes op WHERE op.id=?)"
 ).bind(intent,rec,companyId,body.expectedVersion,
  body.fimDepois,body.fimDepois,intent);
 const review=db.prepare(
  "INSERT INTO recorrencia_revisoes (id,empresa_id,recorrencia_id,tipo,"+
  "fim_antes,fim_depois,ator_id,operacao_id,conferencia,origem_dado) "+
  "SELECT ?,r.empresa_id,r.id,'ENCERRAR',NULL,?,?,?,'VALIDADO','NATIVO' "+
  "FROM recorrencias r WHERE r.id=? AND r.empresa_id=? "+
  "AND r.versao=? AND r.operacao_id=?"
 ).bind(reviewId,body.fimDepois,actor.userId,intent,
        rec,companyId,body.expectedVersion+1,intent);
 const journal=db.prepare(
  "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "plano_json,origem_dado,conferencia) "+
  "SELECT ?,?,'ENCERRAR_RECORRENCIA_APOS',?,?,'CONCLUIDA',?,'NATIVO','VALIDADO' "+
  "FROM recorrencia_revisoes rv WHERE rv.id=? AND rv.empresa_id=? "+
  "AND rv.operacao_id=?"
 ).bind(intent,companyId,hash,actor.userId,
   JSON.stringify({motivo:reason,fimDepois:body.fimDepois}),
   reviewId,companyId,intent);
 let results;
 try{results=await db.batch([update,review,journal]);}
 catch{throw new DomainError("recurrence_end_conflict",409);}
 if(complete(results,3))return {replayed:false,intentId:intent,
   recorrenciaId:rec,newVersion:body.expectedVersion+1,
   ultimaCompetenciaPermitida:body.fimDepois};
 const raced=await replayOrConflict(db,companyId,intent,hash,"ENCERRAR_RECORRENCIA_APOS");
 if(raced)return raced;
 throw new DomainError("recurrence_end_conflict",409);
}
