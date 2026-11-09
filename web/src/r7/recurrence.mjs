// R7 / REC01-REC05: gera titulo mensal sem copiar documento modelo.
// So meses presentes/futuros (America/Sao_Paulo), jamais reescreve historico.
// Service isolado da aplicacao publica, sem job/agendador ativado.
import { requireCompanyRole } from "./security.mjs";
import { DomainError,strictlyObject,identifier,positiveInt,
         money,hashIntent,replayOrConflict,requireBatch,dueDateForCompetence }
  from "./domain.mjs";

const FIELDS=new Set(["intentId","recorrenciaId","competencia","expectedVersion"]);
function monthLocal(nowMs){
  const d=new Date(nowMs);
  if(!Number.isFinite(d.getTime()))throw new DomainError("invalid_clock",503);
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit"
  }).formatToParts(d);
  const y=parts.find(p=>p.type==="year")?.value;
  const m=parts.find(p=>p.type==="month")?.value;
  return y+"-"+m;
}
export async function materializeRecurrence(
  db,principal,companyId,body,{nowMs=Date.now()}={}
){
  requireBatch(db);
  const actor=await requireCompanyRole(db,principal,companyId,"write");
  strictlyObject(body,FIELDS);
  const intentId=identifier(body.intentId);
  const recurrenceId=identifier(body.recorrenciaId);
  if(!positiveInt(body.expectedVersion))throw new DomainError("invalid_version");
  // Valida ate o dia 31 e evita normalizar meses inexistentes.
  dueDateForCompetence(body.competencia,31);
  if(body.competencia<monthLocal(nowMs))throw new DomainError("past_competence_disabled",409);
  const hash=await hashIntent("GERAR_COMPETENCIA",[
    recurrenceId,body.competencia,body.expectedVersion
  ]);
  const previous=await replayOrConflict(db,companyId,intentId,hash,"GERAR_COMPETENCIA");
  if(previous)return previous;
  const rule=await db.prepare(
    "SELECT id,empresa_id,beneficiario,categoria_despesa,descricao_boleto,"+
    "valor_atual_cent,dia_vencimento,primeiro_vencimento,ultima_competencia,versao,estado "+
    "FROM recorrencias WHERE empresa_id=? AND id=?"
  ).bind(companyId,recurrenceId).first();
  if(!rule||rule.versao!==body.expectedVersion||rule.estado!=="ATIVA"||
     !money(rule.valor_atual_cent)||rule.valor_atual_cent===0 ||
     typeof rule.primeiro_vencimento!=="string" ||
     body.competencia<rule.primeiro_vencimento.slice(0,7) ||
     (rule.ultima_competencia && body.competencia<=rule.ultima_competencia)){
    throw new DomainError("recurrence_not_active_or_stale",409);
  }
  const block=await db.prepare(
    "SELECT COUNT(*) AS n FROM recorrencia_revisoes r "+
    "WHERE r.empresa_id=? AND r.recorrencia_id=? AND "+
    "((r.tipo='VALOR' AND r.vigente_a_partir>?) "+
    " OR (r.tipo='ENCERRAR' AND r.fim_depois<?)) "+
    "AND (r.origem_dado='NATIVO' OR r.conferencia='VALIDADO')"
  ).bind(companyId,recurrenceId,body.competencia,body.competencia).first();
  if(!block||block.n!==0)throw new DomainError("recurrence_revisions_require_reconciliation",409);
  const vencimento=body.competencia===rule.primeiro_vencimento.slice(0,7)
    ? rule.primeiro_vencimento
    : dueDateForCompetence(body.competencia,rule.dia_vencimento);
  const titleId=crypto.randomUUID();
  const insert=db.prepare(
    "INSERT INTO titulos_pagar (id,empresa_id,tipo,beneficiario,categoria_despesa,"+
    "descricao_boleto,recorrencia_id,competencia,valor_nominal_cent,vencimento,"+
    "operacao_id,origem_dado,conferencia) "+
    "SELECT ?,r.empresa_id,'DIVERSO',r.beneficiario,r.categoria_despesa,"+
    "r.descricao_boleto,r.id,?,r.valor_atual_cent,?,?,'NATIVO','VALIDADO' "+
    "FROM recorrencias r WHERE r.id=? AND r.empresa_id=? AND r.estado='ATIVA' "+
    "AND r.versao=? AND r.valor_atual_cent=? "+
    "AND (r.ultima_competencia IS NULL OR r.ultima_competencia<?) "+
    "AND NOT EXISTS(SELECT 1 FROM titulos_pagar t "+
    "WHERE t.recorrencia_id=r.id AND t.competencia=?) "+
    "AND NOT EXISTS(SELECT 1 FROM operacoes o WHERE o.id=?)"
  ).bind(titleId,body.competencia,vencimento,intentId,
         recurrenceId,companyId,body.expectedVersion,rule.valor_atual_cent,
         body.competencia,body.competencia,intentId);
  const advance=db.prepare(
    "UPDATE recorrencias SET ultima_competencia=?,versao=versao+1,operacao_id=? "+
    "WHERE id=? AND empresa_id=? AND estado='ATIVA' AND versao=? "+
    "AND EXISTS(SELECT 1 FROM titulos_pagar t WHERE t.id=? "+
    "AND t.recorrencia_id=recorrencias.id AND t.empresa_id=recorrencias.empresa_id "+
    "AND t.operacao_id=?)"
  ).bind(body.competencia,intentId,recurrenceId,companyId,
         body.expectedVersion,titleId,intentId);
  const journal=db.prepare(
    "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "SELECT ?,?,'GERAR_COMPETENCIA',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
    "FROM recorrencias r JOIN titulos_pagar t "+
    "ON t.recorrencia_id=r.id AND t.empresa_id=r.empresa_id "+
    "WHERE r.id=? AND r.empresa_id=? AND r.versao=? AND r.operacao_id=? "+
    "AND t.id=? AND t.operacao_id=?"
  ).bind(intentId,companyId,hash,actor.userId,recurrenceId,companyId,
         body.expectedVersion+1,intentId,titleId,intentId);
  let res;
  try{res=await db.batch([insert,advance,journal]);}
  catch{throw new DomainError("recurrence_conflict",409);}
  if(res?.[0]?.meta?.changes===0){
    const replay=await replayOrConflict(db,companyId,intentId,hash,"GERAR_COMPETENCIA");
    if(replay)return replay;
  }
  if(!Array.isArray(res)||res.length!==3||res.some(x=>x?.meta?.changes!==1))
    throw new DomainError("recurrence_conflict",409);
  return {replayed:false,intentId,titleId,competencia:body.competencia,
          vencimento,newVersion:body.expectedVersion+1};
}
