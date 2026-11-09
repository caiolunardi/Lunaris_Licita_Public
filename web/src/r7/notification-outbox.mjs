// R7 E2 / OPR02 + OPR01 — outbox local sem provedor real.
// RESERVADO grava snapshot; INCERTO ANTES do envio externo; ENVIADO apenas
// com aceite explícito do provedor. Timeout jamais autoriza reenvio automático.
// Este módulo NÃO é ativado no bootstrap nem envia e-mails reais.
import { requireCompanyRole } from "./security.mjs";
import { DomainError, strictlyObject, identifier, dateCivil, hashIntent,
         replayOrConflict, requireBatch, money } from "./domain.mjs";

const RESERVE_FIELDS=new Set(["intentId","preferenciaId","destinatarioId","dataReferencia","horario"]);
const DISPATCH_FIELDS=new Set(["intentId","envioId"]);
const HHMM=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function localDate(nowMs) {
 const p=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(nowMs));
 return p.find(x=>x.type==="year").value+"-"+
  p.find(x=>x.type==="month").value+"-"+
  p.find(x=>x.type==="day").value;
}
function dailySlot(pref,horario) {
 let hours,days;
 try{
  hours=JSON.parse(pref.horarios_json);
  days=JSON.parse(pref.dias_semana_json);
 }catch{throw new DomainError("notification_schedule_unverified",409);}
 if(!Array.isArray(hours)||!hours.includes(horario)||!hours.every(x=>typeof x==="string"&&HHMM.test(x))||
  !Array.isArray(days)||days.length<1||days.length>7||!days.every(x=>Number.isSafeInteger(x)&&x>=0&&x<=6)){
  throw new DomainError("notification_schedule_unverified",409);
 }
 return new Set(days);
}
function recordChanges(res,n) {
 return Array.isArray(res)&&res.length===n&&res.every(x=>
  Number.isInteger(x?.meta?.changes)&&x.meta.changes>=1);
}
export async function reserveNotification(db,principal,companyId,body,{nowMs=Date.now()}={}) {
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"approve");
 strictlyObject(body,RESERVE_FIELDS);
 const intentId=identifier(body.intentId),prefId=identifier(body.preferenciaId),
   recipientId=identifier(body.destinatarioId);
 if(!dateCivil(body.dataReferencia)||!HHMM.test(body.horario)||
   body.dataReferencia!==localDate(nowMs))throw new DomainError("invalid_notification_period",409);
 const pref=await db.prepare(
  "SELECT p.id,p.ativo,p.horarios_json,p.dias_semana_json,p.quantidade_proximos,"+
  "p.remetente,d.email_normalizado,d.ativo AS destinatario_ativo "+
  "FROM notificacoes_preferencias p "+
  "JOIN notificacoes_destinatarios d ON d.preferencia_id=p.id "+
  "AND d.empresa_id=p.empresa_id "+
  "WHERE p.id=? AND p.empresa_id=? AND d.id=?"
 ).bind(prefId,companyId,recipientId).first();
 if(!pref||pref.ativo!==1||pref.destinatario_ativo!==1||
    !EMAIL.test(pref.email_normalizado||"")||
    !Number.isSafeInteger(pref.quantidade_proximos)||pref.quantidade_proximos<1||
    pref.quantidade_proximos>50)throw new DomainError("notification_configuration_invalid",409);
 const validDays=dailySlot(pref,body.horario);
 const day=new Date(body.dataReferencia+"T12:00:00Z").getUTCDay();
 if(!validDays.has(day))throw new DomainError("notification_day_not_enabled",409);
 const selection=await db.prepare(
  "SELECT id,vencimento,valor_nominal_cent "+
  "FROM v_titulos_situacao WHERE empresa_id=? AND situacao='ABERTO' "+
  "AND vencimento>=? AND valor_nominal_cent IS NOT NULL "+
  "ORDER BY vencimento,id LIMIT ?"
 ).bind(companyId,body.dataReferencia,pref.quantidade_proximos).all();
 const docs=selection?.results||[];
 // Zero obrigações: não mandar resumo vazio (evita ruído operacional).
 if(!docs.length||docs.some(x=>!dateCivil(x.vencimento)||!money(x.valor_nominal_cent))){
  throw new DomainError("no_verifiable_upcoming_obligations",409);
 }
 const detail=docs.map(x=>[x.id,x.vencimento,x.valor_nominal_cent]);
 let sum=0n;
 for(const x of docs)sum+=BigInt(x.valor_nominal_cent);
 if(sum>BigInt(Number.MAX_SAFE_INTEGER))throw new DomainError("notification_amount_overflow",409);
 const summaryHash=await hashIntent("NOTIFICACAO_RESUMO",[companyId,detail]);
 const recipientHash=await hashIntent("DESTINATARIO",[companyId,pref.email_normalizado]);
 const hash=await hashIntent("RESERVAR_NOTIFICACAO",[prefId,recipientId,
  body.dataReferencia,body.horario,summaryHash]);
 const prior=await replayOrConflict(db,companyId,intentId,hash,"RESERVAR_NOTIFICACAO");
 if(prior)return prior;
 const id=crypto.randomUUID();
 const insert=db.prepare(
  "INSERT INTO notificacoes_envios(id,empresa_id,preferencia_id,"+
  "data_referencia,horario,destinatario_hash,estado,quantidade_boletos,"+
  "total_centavos,hash_resumo,remetente,operacao_id,origem_dado,conferencia) "+
  "SELECT ?,p.empresa_id,p.id,?,?,?,'RESERVADO',?,?,?,p.remetente,?,"+
  "'NATIVO','VALIDADO' FROM notificacoes_preferencias p "+
  "JOIN notificacoes_destinatarios d ON d.preferencia_id=p.id AND d.empresa_id=p.empresa_id "+
  "WHERE p.id=? AND p.empresa_id=? AND p.ativo=1 "+
  "AND d.id=? AND d.ativo=1 AND d.email_normalizado=? "+
  "AND NOT EXISTS (SELECT 1 FROM notificacoes_envios n WHERE "+
  "n.preferencia_id=p.id AND n.data_referencia=? AND n.horario=? "+
  "AND n.destinatario_hash=?)"
 ).bind(id,body.dataReferencia,body.horario,recipientHash,docs.length,
   Number(sum),summaryHash,intentId,prefId,companyId,recipientId,
   pref.email_normalizado,body.dataReferencia,body.horario,recipientHash);
 const journal=db.prepare(
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "plano_json,origem_dado,conferencia) "+
  "SELECT ?,?,'RESERVAR_NOTIFICACAO',?,?,'CONCLUIDA',?,'NATIVO','VALIDADO' "+
  "FROM notificacoes_envios n WHERE n.id=? AND n.empresa_id=? "+
  "AND n.operacao_id=?"
 ).bind(intentId,companyId,hash,actor.userId,
  JSON.stringify({destinatarioId:recipientId,resumo:detail}),
  id,companyId,intentId);
 let result;
 try{result=await db.batch([insert,journal]);}
 catch{throw new DomainError("notification_slot_already_reserved",409);}
 if(!recordChanges(result,2))throw new DomainError("notification_slot_already_reserved",409);
 return {replayed:false,intentId,envioId:id,estado:"RESERVADO",
   quantidadeBoletos:docs.length,totalCent:Number(sum)};
}

// Somente adaptador explicitamente injetado. Nenhum trabalho de cron em
// background e nenhuma chamada externa fora do comando administrado.
export async function dispatchNotification(db,principal,companyId,body,{sender}={}) {
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"approve");
 strictlyObject(body,DISPATCH_FIELDS);
 const intentId=identifier(body.intentId),envioId=identifier(body.envioId);
 if(typeof sender?.send!=="function")throw new DomainError("email_adapter_unavailable",503);
 const hash=await hashIntent("DISPARAR_NOTIFICACAO",[envioId]);
 const previous=await replayOrConflict(db,companyId,intentId,hash,"DISPARAR_NOTIFICACAO");
 if(previous)return {...previous,sendAuthorized:false};
 const row=await db.prepare(
  "SELECT n.id,n.estado,n.versao,n.hash_resumo,n.quantidade_boletos,"+
  "n.data_referencia,n.horario,n.destinatario_hash,op.plano_json,"+
  "d.id AS destinatario_id,d.email_normalizado "+
  "FROM notificacoes_envios n "+
  "JOIN operacoes op ON op.id=n.operacao_id AND op.empresa_id=n.empresa_id "+
  "JOIN notificacoes_preferencias p ON p.id=n.preferencia_id AND p.empresa_id=n.empresa_id "+
  "JOIN notificacoes_destinatarios d ON d.preferencia_id=p.id AND d.empresa_id=p.empresa_id "+
  "WHERE n.id=? AND n.empresa_id=? AND n.estado='RESERVADO' "+
  "AND op.tipo='RESERVAR_NOTIFICACAO' AND d.ativo=1 AND p.ativo=1"
 ).bind(envioId,companyId).all();
 const candidates=(row?.results||[]);
 let notification=null,plan=null;
 for(const c of candidates){
  let p;
  try {p=JSON.parse(c.plano_json);}catch{continue;}
  const recipientHash=await hashIntent("DESTINATARIO",[companyId,c.email_normalizado]);
  // Destinatário para esta reserva é reconstruído apenas de cadastro ativo.
  const saved=await db.prepare("SELECT destinatario_hash FROM notificacoes_envios "+
    "WHERE id=? AND empresa_id=?").bind(envioId,companyId).first();
  if(recipientHash!==saved?.destinatario_hash)continue;
  if(p?.destinatarioId===c.destinatario_id && Array.isArray(p.resumo)) {notification=c;plan=p;break;}
 }
 if(!notification||!Array.isArray(plan?.resumo)||plan.resumo.length<1||
    !EMAIL.test(notification.email_normalizado||"")) {
  throw new DomainError("notification_not_dispatchable",409);
 }
 const fresh=await hashIntent("NOTIFICACAO_RESUMO",[companyId,plan.resumo]);
 if(fresh!==notification.hash_resumo||plan.resumo.length!==notification.quantidade_boletos)
   throw new DomainError("notification_snapshot_invalid",409);
 // Marcar INCERTO primeiro. Qualquer interrupção após esta transação deixa
 // registro bloqueado para reenvio, mesmo se o provedor aceitou o e-mail.
 const mark=db.prepare("UPDATE notificacoes_envios SET estado='INCERTO',"+
  "versao=versao+1,operacao_id=? "+
  "WHERE id=? AND empresa_id=? AND estado='RESERVADO' AND versao=? "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes op WHERE op.id=?)"
 ).bind(intentId,envioId,companyId,notification.versao,intentId);
 const journal=db.prepare(
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "plano_json,origem_dado,conferencia) "+
  "SELECT ?,?,'DISPARAR_NOTIFICACAO',?,?,'EM_ANDAMENTO',?,'NATIVO','VALIDADO' "+
  "FROM notificacoes_envios n WHERE n.id=? AND n.empresa_id=? "+
  "AND n.estado='INCERTO' AND n.operacao_id=?"
 ).bind(intentId,companyId,hash,actor.userId,
  JSON.stringify({envioId,recipientHash:notification.destinatario_hash}),
  envioId,companyId,intentId);
 let reservation;
 try{reservation=await db.batch([mark,journal]);}
 catch{throw new DomainError("notification_dispatch_raced",409);}
 if(!recordChanges(reservation,2))throw new DomainError("notification_dispatch_raced",409);
 let response;
 try {
  response=await sender.send({
   to:notification.email_normalizado,
   deliveryKey:envioId,
   snapshot:plan.resumo.map(x=>[...x]),
   referenceDate:notification.data_referencia
  });
 }catch {throw new DomainError("notification_uncertain_no_auto_retry",409);}
 if(response?.accepted!==true)throw new DomainError("notification_uncertain_no_auto_retry",409);
 const delivered=db.prepare("UPDATE notificacoes_envios SET estado='ENVIADO',"+
  "versao=versao+1,enviado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
  "WHERE id=? AND empresa_id=? AND estado='INCERTO' AND operacao_id=?"
 ).bind(envioId,companyId,intentId);
 const complete=db.prepare(
  "UPDATE operacoes SET estado='CONCLUIDA',versao=versao+1 "+
  "WHERE id=? AND empresa_id=? AND tipo='DISPARAR_NOTIFICACAO' "+
  "AND estado='EM_ANDAMENTO'"
 ).bind(intentId,companyId);
 let ack;
 try{ack=await db.batch([delivered,complete]);}
 catch{throw new DomainError("notification_uncertain_no_auto_retry",409);}
 if(!recordChanges(ack,2))throw new DomainError("notification_uncertain_no_auto_retry",409);
 return {replayed:false,intentId,envioId,estado:"ENVIADO",sendAuthorized:false};
}
