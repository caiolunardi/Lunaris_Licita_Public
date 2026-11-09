// R7 etapa 1 / OK12 — adaptador reversível de cópia R2 -> Drive,
// por VERSÃO, sem substituir documento_id ou apagar objeto R2.
// Drive/backup são adaptadores injetados para ensaios locais. Prova real de
// Google Drive/backup pertence à etapa 4 e NÃO é inferida aqui.
// Copiar e revalidar acontece ANTES do batch D1: falha deixa possível cópia
// órfã externa, mas nunca marca transferência concluída/apaga origem.
// Chaves idempotentes no destino são derivadas de empresa+versão+SHA.
import {requireCompanyRole,SecurityError} from "./security.mjs";
import {DomainError,strictlyObject,identifier,hashIntent,
        replayOrConflict,requireBatch} from "./domain.mjs";

const FIELDS=new Set(["intentId","documentoVersaoId"]);
const MAX_BYTES=8*1024*1024;
const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
  .map(x=>x.toString(16).padStart(2,"0")).join("");
function goodBytes(bytes){
 if(!(bytes instanceof ArrayBuffer||ArrayBuffer.isView(bytes))){
   throw new DomainError("copy_bytes_unavailable",409);
 }
 const v=bytes instanceof ArrayBuffer?new Uint8Array(bytes):
   new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(v.byteLength>MAX_BYTES)throw new DomainError("copy_too_large",409);
 return v;
}
async function match(bytes,record){
 const value=goodBytes(bytes);
 if(value.byteLength!==record.tamanho_bytes ||
    (await sha256(value))!==record.sha256){
   throw new DomainError("document_copy_hash_mismatch",409);
 }
 return value;
}
export async function copyDocumentVersionToDrive(
  db,principal,companyId,body,{r2,drive,backup}={}
){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 strictlyObject(body,FIELDS);
 const intentId=identifier(body.intentId);
 const versionId=identifier(body.documentoVersaoId);
 if(!r2?.get||!drive?.put||!drive?.get||!backup?.put||!backup?.restore){
   throw new DomainError("copy_adapters_unavailable",503);
 }
 const hash=await hashIntent("COPIAR_VERSAO_DRIVE",[versionId]);
 const replay=await replayOrConflict(db,companyId,intentId,hash,"COPIAR_VERSAO_DRIVE");
 if(replay)return replay;
 const record=await db.prepare(
   "SELECT v.id,v.documento_id,v.numero_versao,v.sha256,v.tamanho_bytes,"+
   "o.id AS origem_localizacao_id,o.chave_r2 "+
   "FROM documento_versoes v "+
   "JOIN documentos d ON d.id=v.documento_id AND d.empresa_id=v.empresa_id "+
   "JOIN documento_localizacoes o ON o.versao_id=v.id "+
   "AND o.empresa_id=v.empresa_id "+
   "WHERE v.id=? AND v.empresa_id=? "+
   "AND v.estado_integridade='VERIFICADO' AND o.provedor='R2' "+
   "AND o.status='VERIFICADO' AND o.hash_verificado=v.sha256 "+
   "AND o.tamanho_verificado=v.tamanho_bytes ORDER BY o.id LIMIT 1"
 ).bind(versionId,companyId).first();
 if(!record||!record.chave_r2?.startsWith(companyId+"/")||
    !/^[0-9a-f]{64}$/.test(record.sha256||"")||
    !Number.isSafeInteger(record.tamanho_bytes)||
    record.tamanho_bytes<0||record.tamanho_bytes>MAX_BYTES){
   throw new DomainError("origin_document_unverified",409);
 }
 // A transferência não altera o histórico; se já existe localização
 // DRIVE verificada, o próximo trabalho de reprocessamento deve conciliar.
 const existing=await db.prepare(
   "SELECT id FROM documento_localizacoes WHERE versao_id=? AND empresa_id=? "+
   "AND provedor='DRIVE' AND status='VERIFICADO' LIMIT 1"
 ).bind(versionId,companyId).first();
 if(existing)throw new DomainError("existing_drive_copy_requires_reconciliation",409);
 const origin=await r2.get(record.chave_r2);
 if(!origin||origin.size!==record.tamanho_bytes||typeof origin.arrayBuffer!=="function"){
   throw new DomainError("origin_r2_unavailable",409);
 }
 const originalBytes=await match(await origin.arrayBuffer(),record);
 const externalKey=companyId+"/"+versionId+"/"+record.sha256;
 // NÃO enviar automaticamente segredos/identificadores do usuário ao destino.
 const driveId=await drive.put(externalKey,originalBytes);
 if(typeof driveId!=="string"||!driveId.trim())throw new DomainError("drive_copy_failed",409);
 await match(await drive.get(driveId),record);
 const backupRef=await backup.put(externalKey,originalBytes);
 if(typeof backupRef!=="string"||!backupRef.trim()){
   throw new DomainError("independent_backup_failed",409);
 }
 await match(await backup.restore(backupRef),record);
 // Drive e backup verificados por leitura REAL dos bytes dos adaptadores.
 // Estes resultados ainda NÃO provam execução nas contas reais do usuário.
 const locationId=crypto.randomUUID(),transferId=crypto.randomUUID();
 const location=db.prepare(
   "INSERT INTO documento_localizacoes (id,empresa_id,versao_id,provedor,"+
   "drive_file_id,status,origem_dado,conferencia) "+
   "VALUES (?,?,?,'DRIVE',?,'PENDENTE','NATIVO','VALIDADO')"
 ).bind(locationId,companyId,versionId,driveId);
 const verified=db.prepare(
   "UPDATE documento_localizacoes SET status='VERIFICADO',"+
   "hash_verificado=?,tamanho_verificado=?,"+
   "verificado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
   "WHERE id=? AND empresa_id=? AND versao_id=? AND status='PENDENTE'"
 ).bind(record.sha256,record.tamanho_bytes,locationId,companyId,versionId);
 const transfer=db.prepare(
   "INSERT INTO documento_transferencias (id,empresa_id,versao_id,"+
   "origem_localizacao_id,destino_localizacao_id,destino_provedor,"+
   "estado,idempotencia,operacao_id,origem_dado,conferencia) "+
   "VALUES (?,?,?,?,?,'DRIVE','PENDENTE',?,?,'NATIVO','VALIDADO')"
 ).bind(transferId,companyId,versionId,record.origem_localizacao_id,
         locationId,intentId,intentId);
 const toCopy=db.prepare(
   "UPDATE documento_transferencias SET estado='COPIANDO' "+
   "WHERE id=? AND empresa_id=? AND estado='PENDENTE'"
 ).bind(transferId,companyId);
 const toValidate=db.prepare(
   "UPDATE documento_transferencias SET estado='VALIDANDO' "+
   "WHERE id=? AND empresa_id=? AND estado='COPIANDO'"
 ).bind(transferId,companyId);
 const toOverlap=db.prepare(
   "UPDATE documento_transferencias SET estado='SOBREPOSICAO_30_DIAS' "+
   "WHERE id=? AND empresa_id=? AND estado='VALIDANDO'"
 ).bind(transferId,companyId);
 const attest=db.prepare(
   "UPDATE documento_transferencias SET backup_independente_ref=?,"+
   "backup_independente_sha256=?,backup_verificado_em="+
   "strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
   "WHERE id=? AND empresa_id=? AND estado='SOBREPOSICAO_30_DIAS' "+
   "AND backup_independente_ref IS NULL"
 ).bind(backupRef,record.sha256,transferId,companyId);
 const journal=db.prepare(
   "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
   "origem_dado,conferencia) VALUES (?,?,'COPIAR_VERSAO_DRIVE',?,"+
   "?,'CONCLUIDA','NATIVO','VALIDADO')"
 ).bind(intentId,companyId,hash,actor.userId);
 let res;
 try{res=await db.batch([
   location,verified,transfer,toCopy,toValidate,toOverlap,attest,journal
 ]);}
 catch {throw new DomainError("drive_copy_db_conflict_requires_reconciliation",409);}
 if(!Array.isArray(res)||res.length!==8||res.some(r=>!Number.isInteger(r?.meta?.changes)||r.meta.changes<1)){
   throw new DomainError("drive_copy_db_incomplete_requires_reconciliation",409);
 }
 return {replayed:false,intentId,documentoId:record.documento_id,
   versaoId:versionId,numeroVersao:record.numero_versao,
   localizacaoDriveId:locationId,transferId,
   state:"SOBREPOSICAO_30_DIAS",r2DeletionAuthorized:false};
}
