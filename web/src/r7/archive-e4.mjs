// R7 E4: porta administrativa de arquivamento 24m e tentativa duravel.
// Efeito externo incerto NUNCA dispara repeticao automatica. R2 nao e apagado.
import {requireCompanyRole,SecurityError} from "./security.mjs";
import {requireDocumentPermission,requireEntityPermission} from "./iam.mjs";
import {DomainError,strictlyObject,identifier,requireBatch} from "./domain.mjs";
import {reviewArchiveEligibility} from "./archive-eligibility.mjs";
import {copyDocumentVersionToDrive} from "./archive.mjs";

const START=new Set(["intentId","documentoId","documentoVersaoId"]);
const RECOVER=new Set(["intentId","motivo"]);
const EXTERNAL_REASONS=new Set([
 "drive_bytes_not_verified","independent_backup_not_restored",
 "overlay_30_days_not_elapsed"
]);
async function checksum(input){
 if(!(input instanceof ArrayBuffer||ArrayBuffer.isView(input)))
  throw new DomainError("archive_recovery_bytes_unavailable",409);
 const bytes=input instanceof ArrayBuffer?new Uint8Array(input):
  new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
 return {bytes,sha:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
  .map(x=>x.toString(16).padStart(2,"0")).join("")};
}
function adaptersValid({r2,drive,backup}={}){
 if(!r2?.get||!drive?.put||!drive?.get||!drive?.findByKey||
    !backup?.put||!backup?.restore||!backup?.findByKey||
    drive.providerId!=="google-drive"||backup.providerId!=="independent-https"||
    !drive.isIdempotent||!backup.isIdempotent||
    !drive.failureDomain||!backup.failureDomain||
    drive.failureDomain===backup.failureDomain){
  throw new DomainError("archive_independent_adapters_unavailable",503);
 }
}
async function provePermission(db,principal,companyId,doc,version){
 await requireDocumentPermission(db,principal,companyId,doc,"WRITE");
 await requireEntityPermission(db,principal,companyId,"DOCUMENTO_VERSAO",version,"WRITE");
 const row=await db.prepare(
  "SELECT sha256,tamanho_bytes,documento_id FROM documento_versoes "+
  "WHERE id=? AND empresa_id=? AND documento_id=? AND estado_integridade='VERIFICADO'"
 ).bind(version,companyId,doc).first();
 if(!row||!/^[a-f0-9]{64}$/.test(row.sha256||"")||
  !Number.isSafeInteger(row.tamanho_bytes)||row.tamanho_bytes<1||
  row.tamanho_bytes>8*1024*1024)throw new SecurityError("archive_version_unavailable",404);
 return row;
}
async function preflight(db,principal,companyId,doc,version,now){
 const view=await reviewArchiveEligibility(db,principal,companyId,
  {documentoId:doc,versaoId:version},{now});
 const blocking=view.reasons.filter(r=>!EXTERNAL_REASONS.has(r));
 if(blocking.length)throw new DomainError("archive_not_due_or_financial_hold",409);
}
async function markUncertain(db,companyId,intent,reason){
 // Nao registrar erro de transporte bruto, token ou dado identificavel.
 try{
  await db.prepare(
   "UPDATE r7_e4_tentativas_copia SET estado='INCERTA',motivo=? "+
   "WHERE id=? AND empresa_id=? AND estado='RESERVADA'"
  ).bind(reason, intent,companyId).run();
 }catch{ /* RESERVADA e igualmente estado bloqueante; reconciliacao manual */ }
}
async function markVerified(db,companyId,intent,transferId){
 const result=await db.prepare(
  "UPDATE r7_e4_tentativas_copia SET estado='VERIFICADA',destino_id=?,"+
  "confirmado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now'),motivo=NULL "+
  "WHERE id=? AND empresa_id=? AND estado IN ('RESERVADA','INCERTA')"
 ).bind(transferId, intent,companyId).run();
 if(!Number.isInteger(result?.meta?.changes)||result.meta.changes<1)throw new DomainError("archive_ledger_uncertain",409);
}
export async function beginArchiveCopy(db,principal,companyId,body,
 adapters,{now=new Date()}={}){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"approve");
 strictlyObject(body,START);
 const intent=identifier(body.intentId),doc=identifier(body.documentoId),
       version=identifier(body.documentoVersaoId);
 adaptersValid(adapters);
 await provePermission(db,principal,companyId,doc,version);
 await preflight(db,principal,companyId,doc,version,now);
 // UNIQUE(empresa_id,versao_id) impede duas chamadas/atores concorrentes
 // de gravarem arquivos externos para o mesmo recurso.
 try {
  const start=await db.prepare(
   "INSERT INTO r7_e4_tentativas_copia"+
   "(id,empresa_id,documento_id,versao_id,ator_id,estado) "+
   "VALUES (?,?,?,?,?,'RESERVADA')"
  ).bind(intent,companyId,doc,version,actor.userId).run();
  if(!Number.isInteger(start?.meta?.changes)||start.meta.changes<1)throw Error("not_reserved");
 }catch{throw new DomainError("archive_attempt_already_reserved",409);}
 try{
  const result=await copyDocumentVersionToDrive(db,principal,companyId,
   {intentId:intent,documentoVersaoId:version},adapters);
  if(!result?.transferId)throw new DomainError("archive_copy_unconfirmed",409);
  await markVerified(db,companyId,intent,result.transferId);
  return {intentId:intent,estado:"VERIFICADA",documentoId:doc,
   documentoVersaoId:version,r2DeletionAuthorized:false};
 }catch{
  await markUncertain(db,companyId,intent,"external_or_journal_uncertain");
  throw new DomainError("archive_copy_uncertain_manual_reconciliation_required",409);
 }
}
export async function inspectArchiveAttempt(db,principal,companyId,intent){
 await requireCompanyRole(db,principal,companyId,"approve");
 const id=identifier(intent);
 const row=await db.prepare(
  "SELECT id,documento_id,versao_id,estado,criado_em,confirmado_em "+
  "FROM r7_e4_tentativas_copia WHERE id=? AND empresa_id=?"
 ).bind(id,companyId).first();
 if(!row)throw new DomainError("archive_attempt_not_found",404);
 await provePermission(db,principal,companyId,row.documento_id,row.versao_id);
 return {intentId:row.id,documentoId:row.documento_id,
  documentoVersaoId:row.versao_id,estado:row.estado,
  criadoEm:row.criado_em,confirmadoEm:row.confirmado_em,
  r2DeletionAuthorized:false};
}
async function matching(bytes,row){
 const value=await checksum(bytes);
 if(value.bytes.length!==row.tamanho_bytes||value.sha!==row.sha256)
  throw new DomainError("archive_recovery_hash_mismatch",409);
}
export async function reconcileArchiveAttempt(db,principal,companyId,body,
 adapters,{now=new Date()}={}){
 requireBatch(db);
 await requireCompanyRole(db,principal,companyId,"approve");
 strictlyObject(body,RECOVER);
 const intent=identifier(body.intentId);
 if(typeof body.motivo!=="string"||body.motivo.trim().length<12||
    body.motivo.length>500)throw new DomainError("archive_recovery_reason_required",400);
 adaptersValid(adapters);
 const attempt=await db.prepare(
  "SELECT id,documento_id,versao_id,estado FROM r7_e4_tentativas_copia "+
  "WHERE id=? AND empresa_id=?"
 ).bind(intent,companyId).first();
 if(!attempt||!["RESERVADA","INCERTA"].includes(attempt.estado))
  throw new DomainError("archive_attempt_not_reconcilable",409);
 const record=await provePermission(db,principal,companyId,
  attempt.documento_id,attempt.versao_id);
 await preflight(db,principal,companyId,attempt.documento_id,attempt.versao_id,now);
 const externalKey=companyId+"/"+attempt.versao_id+"/"+record.sha256;
 // Nao criar objetos durante a reconciliacao se um destino estiver ausente.
 // O tratamento de copia parcial precisa de decisao operacional registrada.
 let driveId,backupRef;
 try{
  [driveId,backupRef]=await Promise.all([
   adapters.drive.findByKey(externalKey),adapters.backup.findByKey(externalKey)
  ]);
 }catch{throw new DomainError("archive_recovery_provider_uncertain",409);}
 if(!driveId||!backupRef)
  throw new DomainError("archive_partial_copy_requires_operator_review",409);
 await matching(await adapters.drive.get(driveId),record);
 await matching(await adapters.backup.restore(backupRef),record);
 // Se a primeira chamada confirmou D1 mas falhou na atualizacao do ledger,
 // valida a copia externa e conclui SOMENTE o ledger.
 const committed=await db.prepare(
  "SELECT t.id FROM documento_transferencias t "+
  "JOIN documento_localizacoes l ON l.id=t.destino_localizacao_id "+
  "AND l.versao_id=t.versao_id AND l.empresa_id=t.empresa_id "+
  "WHERE t.empresa_id=? AND t.versao_id=? AND t.idempotencia=? "+
  "AND t.estado='SOBREPOSICAO_30_DIAS' "+
  "AND t.backup_independente_ref=? AND l.drive_file_id=? "+
  "AND l.hash_verificado=? AND t.backup_independente_sha256=?"
 ).bind(companyId,attempt.versao_id,intent,backupRef,driveId,
  record.sha256,record.sha256).first();
 let transferId=committed?.id;
 if(!transferId){
  // Apenas decisao explicita de ADMIN executa novo D1.batch. put() e
  // idempotente e read-back verificado; nao dispara reenvio duplicado.
  const result=await copyDocumentVersionToDrive(db,principal,companyId,
   {intentId:intent,documentoVersaoId:attempt.versao_id},adapters);
  transferId=result?.transferId;
 }
 if(!transferId)throw new DomainError("archive_recovery_journal_uncertain",409);
 await markVerified(db,companyId,intent,transferId);
 return {intentId:intent,estado:"VERIFICADA",documentoId:attempt.documento_id,
  documentoVersaoId:attempt.versao_id,r2DeletionAuthorized:false};
}
