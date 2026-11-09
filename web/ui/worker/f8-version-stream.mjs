// F8: anexa nova VERSÃO binária por stream com prova R2 antes do D1.
// R7 appendDocumentVersion JSON ~8 KiB permanece disponível mas não é usada na UI F8.
// R2 não é apagado em falha/corrida; conciliação de órfão é obrigação operacional.
import {requireCompanyRole} from "../../src/r7/security.mjs";
import {DomainError,identifier,hashIntent,replayOrConflict,requireBatch} from "../../src/r7/domain.mjs";
import {requireDocumentPermission,requireEntityPermission} from "../../src/r7/iam.mjs";
import {drainPreflightedUpload} from "../../src/r7/stream-drain.mjs";
const MAX=8*1024*1024;
const MIME=new Set(["application/pdf","application/xml","image/png","image/jpeg","text/plain"]);
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
 .map(v=>v.toString(16).padStart(2,"0")).join("");
function meta(req){
 const h=req.headers;
 const intentId=identifier(h.get("x-doc-intent"));
 const expectedVersion=Number(h.get("x-doc-expected-version"));
 const filename=h.get("x-doc-name");
 const contentType=h.get("content-type")?.toLowerCase();
 const declared=h.get("content-length"),size=Number(declared);
 const digest=h.get("x-content-sha256");
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1||
  !filename||filename.length>255||filename.trim()!==filename||
  filename.includes("/")||filename.includes("\\")||
  !MIME.has(contentType)||!declared||!/^[1-9]\d{0,7}$/.test(declared)||
  !Number.isSafeInteger(size)||size<1||size>MAX||!/^[0-9a-f]{64}$/.test(digest||""))
  throw new DomainError("version_stream_invalid",400);
 return {intentId,expectedVersion,filename,contentType,size,digest};
}
export async function uploadDocumentVersionStream(db,r2,principal,company,documentId,request){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,company,"write");
 const doc=identifier(documentId),m=meta(request);
 if(!r2?.put||!r2?.get||!request.body)
  throw new DomainError("stream_r2_unavailable",503);
 await requireDocumentPermission(db,principal,company,doc,"WRITE");
 const requestHash=await hashIntent("NOVA_VERSAO_DOCUMENTO",[
  doc,m.expectedVersion,m.filename,m.contentType,m.size,m.digest]);
 const previous=await replayOrConflict(db,company,m.intentId,requestHash,"NOVA_VERSAO_DOCUMENTO");
 if(previous){
  await drainPreflightedUpload(request,m.size,"version_stream_size_mismatch");
  return previous;
 }
 const row=await db.prepare("SELECT d.id,d.versao,d.versao_corrente_id,v.numero_versao "+
  "FROM documentos d JOIN documento_versoes v ON v.id=d.versao_corrente_id "+
  "AND v.documento_id=d.id AND v.empresa_id=d.empresa_id "+
  "WHERE d.id=? AND d.empresa_id=? AND d.versao=? "+
  "AND d.origem_dado='NATIVO' AND v.estado_integridade='VERIFICADO' "+
  "AND EXISTS(SELECT 1 FROM documento_vinculos dv "+
  "WHERE dv.documento_id=d.id AND dv.empresa_id=d.empresa_id AND dv.ativo=1)")
  .bind(doc,company,m.expectedVersion).first();
 if(!row){
  await drainPreflightedUpload(request,m.size,"version_stream_size_mismatch");
  throw new DomainError("document_version_conflict",409);
 }
 await requireEntityPermission(db,principal,company,"DOCUMENTO_VERSAO",row.versao_corrente_id,"WRITE");
 const no=row.numero_versao+1;
 if(!Number.isSafeInteger(no)||no<2)throw new DomainError("document_version_conflict",409);
 const version=crypto.randomUUID(),loc=crypto.randomUUID(),key=company+"/"+doc+"/"+version;
 try{await r2.put(key,request.body);}catch{
  throw new DomainError("version_stream_write_uncertain",409);
 }
 const copy=await r2.get(key);
 if(!copy||copy.size!==m.size||typeof copy.arrayBuffer!=="function")
  throw new DomainError("version_stream_size_mismatch",409);
 const bytes=await copy.arrayBuffer();
 if(bytes.byteLength!==m.size||(await sha(bytes))!==m.digest)
  throw new DomainError("version_stream_hash_mismatch",409);
 const fresh=await requireCompanyRole(db,principal,company,"write");
 if(fresh.userId!==actor.userId)throw new DomainError("document_version_conflict",409);
 await requireDocumentPermission(db,principal,company,doc,"WRITE");
 await requireEntityPermission(db,principal,company,"DOCUMENTO_VERSAO",row.versao_corrente_id,"WRITE");
 const cmds=[],add=(sql,...args)=>cmds.push(db.prepare(sql).bind(...args));
 add("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
  "VALUES(?,?,'NOVA_VERSAO_DOCUMENTO',?,?,'CONCLUIDA','NATIVO','VALIDADO')",
  m.intentId,company,requestHash,actor.userId);
 add("INSERT INTO documento_versoes(id,empresa_id,documento_id,numero_versao,"+
  "nome_original,mime_type,tamanho_bytes,sha256,enviado_por,estado_integridade,"+
  "operacao_id,conferencia) VALUES(?,?,?,?,?,?,?,?,?,'PENDENTE',?,'VALIDADO')",
  version,company,doc,no,m.filename,m.contentType,m.size,m.digest,actor.userId,m.intentId);
 add("INSERT INTO documento_localizacoes(id,empresa_id,versao_id,provedor,chave_r2,"+
  "status,operacao_id,conferencia) VALUES(?,?,?,'R2',?,'PENDENTE',?,'VALIDADO')",
  loc,company,version,key,m.intentId);
 add("UPDATE documento_localizacoes SET status='VERIFICADO',"+
  "hash_verificado=?,tamanho_verificado=?,"+
  "verificado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
  "WHERE id=? AND empresa_id=? AND versao_id=? AND status='PENDENTE'",
  m.digest,m.size,loc,company,version);
 add("UPDATE documento_versoes SET estado_integridade='VERIFICADO',versao=versao+1 "+
  "WHERE id=? AND documento_id=? AND empresa_id=? AND estado_integridade='PENDENTE'",
  version,doc,company);
 add("UPDATE documentos SET versao_corrente_id=?,versao=versao+1 "+
  "WHERE id=? AND empresa_id=? AND versao=? AND versao_corrente_id=? "+
  "AND EXISTS(SELECT 1 FROM documento_versoes v "+
  "WHERE v.id=? AND v.documento_id=documentos.id "+
  "AND v.empresa_id=documentos.empresa_id AND v.estado_integridade='VERIFICADO')",
  version,doc,company,m.expectedVersion,row.versao_corrente_id,version);
 let result;try{result=await db.batch(cmds);}catch{
  throw new DomainError("document_version_db_conflict_requires_reconciliation",409);
 }
 if(!Array.isArray(result)||result.length!==cmds.length||
  result.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1))
  throw new DomainError("document_version_db_conflict_requires_reconciliation",409);
 return {replayed:false,intentId:m.intentId,documentoId:doc,versaoId:version,
  numeroVersao:no,tamanhoBytes:m.size,sha256:m.digest,
  r2DeletionAuthorized:false};
}
