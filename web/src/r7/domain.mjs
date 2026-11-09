// R7 / W1 W4 W5 W6: comandos financeiros privados. NAO ligados ao
// fetch publico do bootstrap. Cada batch D1 e uma transacao; erro faz rollback.
// Nenhum campo privilegiado de provenance/empresa/ator vem do body.
import { requireCompanyRole, SecurityError } from "./security.mjs";

export class DomainError extends Error {
  constructor(code = "invalid_request", status = 400) {
    super(code); this.name = "DomainError"; this.code = code; this.status = status;
  }
}
const ALLOWED_CREDIT = new Set([
  "intentId","contaReceberId","valorRecebidoCent","retencaoConfirmadaCent",
  "dataCredito","contaDestino","referenciaExterna","retencaoAtestadoId"
]);
const ALLOWED_NOTE = new Set(["intentId","tituloId","expectedVersion","observacoes"]);
export function strictlyObject(o, allowed) {
  if (!o || typeof o !== "object" || Array.isArray(o) ||
    Object.keys(o).some(k => !allowed.has(k))) throw new DomainError("invalid_fields");
}
export function identifier(x) {
  if (typeof x !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(x)) {
    throw new DomainError("invalid_id");
  }
  return x;
}
export function positiveInt(x) {
  return Number.isSafeInteger(x) && x > 0;
}
export function money(x) {
  return Number.isSafeInteger(x) && x >= 0 && x <= 9007199254740991;
}
export function dateCivil(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y,m,d] = s.split("-").map(Number);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const last = new Date(Date.UTC(2000, m, 0)).getUTCDate();
  const feb = m === 2 ? ((y%400 === 0 || (y%4===0 && y%100!==0))?29:28):last;
  return d <= feb;
}
export async function hashIntent(type, payload) {
  const canonical = JSON.stringify([type, payload]);
  const raw = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(raw)).map(v=>v.toString(16).padStart(2,"0")).join("");
}
export async function replayOrConflict(db, companyId, intentId, hash, type) {
  const existing = await db.prepare(
    "SELECT tipo,hash_pedido,estado FROM operacoes WHERE empresa_id=? AND id=?"
  ).bind(companyId,intentId).first();
  if (!existing) return null;
  if (existing.tipo===type && existing.hash_pedido===hash &&
      existing.estado==="CONCLUIDA") return {replayed:true,intentId};
  throw new DomainError("idempotency_conflict",409);
}
export function requireBatch(db) {
  if (!db?.prepare || !db?.batch) throw new DomainError("db_not_configured",503);
}
export async function registerCredit(db, principal, companyId, body) {
  requireBatch(db);
  // Confirma vínculo e papel no servidor ANTES de qualquer leitura de operação.
  const member = await requireCompanyRole(db,principal,companyId,"write");
  strictlyObject(body,ALLOWED_CREDIT);
  const intentId=identifier(body.intentId), contaReceberId=identifier(body.contaReceberId);
  const val=body.valorRecebidoCent, ret=body.retencaoConfirmadaCent;
  if (!money(val)||!money(ret)||!positiveInt(val+ret)||!dateCivil(body.dataCredito)) {
    throw new DomainError("invalid_credit");
  }
  const conta=body.contaDestino ?? null, referencia=body.referenciaExterna ?? null;
  if ((conta===null)!==(referencia===null) ||
      (conta!==null && (typeof conta!=="string" || conta.length>128 ||
                         !conta.trim() || conta!==conta.trim())) ||
      (referencia!==null && (typeof referencia!=="string" || referencia.length>128 ||
                         !referencia.trim() || referencia!==referencia.trim()))) {
    throw new DomainError("invalid_reference");
  }
  const attestation=body.retencaoAtestadoId == null ? null :
    identifier(body.retencaoAtestadoId);
  if((ret>0 && attestation===null)||(ret===0&&attestation!==null)){
    throw new DomainError("retention_attestation_required",409);
  }
  const payload=[contaReceberId,val,ret,body.dataCredito,conta,referencia,attestation];
  const hash=await hashIntent("RECEBIMENTO",payload);
  const previous=await replayOrConflict(db,companyId,intentId,hash,"RECEBIMENTO");
  if(previous) return previous;
  const creditId=crypto.randomUUID();
  const insertCredit=db.prepare(
    "INSERT INTO recebimentos (id,empresa_id,conta_receber_id,tipo_movimento,"+
    "data_credito,valor_recebido_cent,retencao_confirmada_cent,conta_destino,"+
    "referencia_externa,retencao_atestado_id,operacao_id,conferencia,origem_dado) "+
    "SELECT ?,c.empresa_id,c.id,'RECEBIMENTO',?,?,?,?,?,?,?,'VALIDADO','NATIVO' "+
    "FROM contas_receber c "+
    "JOIN notas_fiscais n ON n.id=c.nota_fiscal_id AND n.empresa_id=c.empresa_id "+
    "JOIN empenhos e ON e.id=n.empenho_id AND e.empresa_id=n.empresa_id "+
    "JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id "+
    "WHERE c.empresa_id=? AND c.id=? AND c.cancelada=0 "+
    "AND c.valor_bruto_cent IS NOT NULL "+
    "AND n.situacao IN ('EMITIDA','APRESENTADA') AND e.situacao='CONFIRMADO' "+
    "AND l.encerrada_em IS NULL "+
    "AND coalesce(l.situacao_participacao,'')<>'CANCELADA' "+
    "AND ?<=c.valor_bruto_cent-coalesce((SELECT sum(r.valor_recebido_cent+r.retencao_confirmada_cent) "+
    "FROM recebimentos r WHERE r.empresa_id=c.empresa_id AND r.conta_receber_id=c.id "+
    "AND r.tipo_movimento='RECEBIMENTO' AND NOT EXISTS( "+
    "SELECT 1 FROM recebimentos est WHERE est.empresa_id=r.empresa_id "+
    "AND est.tipo_movimento='ESTORNO' AND est.estorno_de_id=r.id)),0) "+
    "AND NOT EXISTS(SELECT 1 FROM v_recebimentos_ativos v WHERE v.empresa_id=c.empresa_id "+
    "AND v.conta_receber_id=c.id AND v.origem_dado='LEGADO' AND v.conferencia<>'VALIDADO') "+
    "AND (?=0 OR EXISTS (SELECT 1 FROM retencao_atestados a "+
    "WHERE a.id=? AND a.empresa_id=c.empresa_id AND a.conta_receber_id=c.id "+
    "AND a.valor_confirmado_cent=?)) "+
    "AND NOT EXISTS(SELECT 1 FROM operacoes op WHERE op.id=?)"
  ).bind(creditId,body.dataCredito,val,ret,conta,referencia,attestation,intentId,
         companyId,contaReceberId,val+ret,ret,attestation,ret,intentId);
  const insertJournal=db.prepare(
    "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "SELECT ?,?,'RECEBIMENTO',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
    "FROM recebimentos r WHERE r.id=? AND r.empresa_id=? AND r.operacao_id=? "+
    "AND NOT EXISTS(SELECT 1 FROM operacoes op WHERE op.id=?)"
  ).bind(intentId,companyId,hash,member.userId,creditId,companyId,intentId,intentId);
  let results;
  try { results = await db.batch([insertCredit,insertJournal]); }
  catch { throw new DomainError("credit_conflict",409); }
  if (results?.[0]?.meta?.changes===1 && results?.[1]?.meta?.changes===1) {
    return {replayed:false,intentId,creditId};
  }
  const raced=await replayOrConflict(db,companyId,intentId,hash,"RECEBIMENTO");
  if(raced) return raced;
  // 0 writes in both statements; no false success after SQL predicate failure.
  throw new DomainError("credit_not_allowed_or_insufficient_balance",409);
}
export async function updateTitleObservation(db,principal,companyId,body) {
  requireBatch(db);
  const member=await requireCompanyRole(db,principal,companyId,"write");
  strictlyObject(body,ALLOWED_NOTE);
  const intentId=identifier(body.intentId), titleId=identifier(body.tituloId);
  if(!positiveInt(body.expectedVersion)||typeof body.observacoes!=="string"||
     body.observacoes.length>5000) throw new DomainError("invalid_note");
  const hash=await hashIntent("TITULO_OBSERVACAO",
    [titleId,body.expectedVersion,body.observacoes]);
  const previous=await replayOrConflict(db,companyId,intentId,hash,"TITULO_OBSERVACAO");
  if(previous)return previous;
  const change=db.prepare(
    "UPDATE titulos_pagar SET observacoes=?,versao=versao+1,operacao_id=? "+
    "WHERE id=? AND empresa_id=? AND versao=? AND cancelado=0 AND origem_dado='NATIVO' "+
    "AND NOT EXISTS (SELECT 1 FROM operacoes o WHERE o.id=?)"
  ).bind(body.observacoes,intentId,titleId,companyId,body.expectedVersion,intentId);
  const journal=db.prepare(
    "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "SELECT ?,?,'TITULO_OBSERVACAO',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
    "FROM titulos_pagar t WHERE t.id=? AND t.empresa_id=? "+
    "AND t.versao=? AND t.operacao_id=? "+
    "AND NOT EXISTS (SELECT 1 FROM operacoes o WHERE o.id=?)"
  ).bind(intentId,companyId,hash,member.userId,titleId,companyId,body.expectedVersion+1,intentId,intentId);
  let results;
  try {results=await db.batch([change,journal]);}
  catch {throw new DomainError("update_conflict",409);}
  if(results?.[0]?.meta?.changes===1 && results?.[1]?.meta?.changes===1)
    return {replayed:false,intentId,newVersion:body.expectedVersion+1};
  const raced=await replayOrConflict(db,companyId,intentId,hash,"TITULO_OBSERVACAO");
  if(raced)return raced;
  throw new DomainError("version_conflict",409);
}
// W3: calendario civil de recorrencia; o cadastro/regra revisada e o Worker
// devem conferir competencia e versao ANTES de qualquer materializacao.
export function dueDateForCompetence(competence,day) {
  if(typeof competence!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/.test(competence) ||
      !Number.isInteger(day)||day<1||day>31) throw new DomainError("invalid_competence");
  const [y,m]=competence.split("-").map(Number);
  if(y<1||y>9999) throw new DomainError("invalid_competence");
  const last=m===2?((y%400===0||(y%4===0&&y%100!==0))?29:28):
    [4,6,9,11].includes(m)?30:31;
  return competence+"-"+String(Math.min(day,last)).padStart(2,"0");
}
