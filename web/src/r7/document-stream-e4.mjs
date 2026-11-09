// R7 E4: POST binario com tamanho conhecido -> R2.put(Request.body).
// Sem arquivo integral em base64 ou buffer antes do upload. O read-back
// limitado a 8 MiB verifica bytes reais SHA-256 antes de journal D1.
// Nunca faz delete R2 em falha; blob orfao exige reconciliacao posterior.
import {requireCompanyRole} from "./security.mjs";
import {assertEntityNotBlocked} from "./iam.mjs";
import {DomainError,identifier,hashIntent,replayOrConflict,requireBatch} from "./domain.mjs";
import {OWNER_ROLES} from "./document-service.mjs";
import {drainPreflightedUpload} from "./stream-drain.mjs";
const MAX=8*1024*1024;
const MIME=new Set(["application/pdf","application/xml","image/png","image/jpeg","text/plain"]);
const TYPES=Object.freeze({
 licitacao:"LICITACAO",empenho:"EMPENHO",compra:"COMPRA",envio:"ENVIO",
 nota_fiscal:"NOTA_FISCAL",titulo_pagar:"TITULO_PAGAR",
 titulo_baixa:"TITULO_BAIXA",conta_receber:"CONTA_RECEBER",
 recebimento:"RECEBIMENTO"
});
async function digest(data){
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data)))
  .map(x=>x.toString(16).padStart(2,"0")).join("");
}
function metadata(request) {
 const h=request.headers;
 const intent=identifier(h.get("x-doc-intent"));
 const ownerType=h.get("x-doc-owner-type"),ownerId=identifier(h.get("x-doc-owner-id"));
 const role=h.get("x-doc-role"),kind=h.get("x-doc-type");
 const name=h.get("x-doc-name"),mime=h.get("content-type")?.toLowerCase();
 const sha=h.get("x-content-sha256");
 const len=h.get("content-length"),size=Number(len);
 if(!len||!String(len).match(/^[1-9]\d{0,7}$/)||!Number.isSafeInteger(size)||
    size<1||size>MAX||!/^[a-f0-9]{64}$/.test(sha||""))
  throw new DomainError("stream_content_length_or_hash_required",413);
 const spec=OWNER_ROLES[ownerType];
 if(!spec||!spec.roles.includes(role)||!Object.hasOwn(TYPES,ownerType)||
    !/^[A-Z][A-Z_]{2,63}$/.test(kind||"")||
    (kind==="COMPROVANTE_RETENCAO"&&
     !(ownerType==="conta_receber"&&role==="COMPROVANTE_CREDITO"))||
    !name||name.length>255||name.trim()!==name||name.includes("/")||
    name.includes("\\")||!MIME.has(mime)){
   throw new DomainError("invalid_stream_document_metadata",400);
 }
 return {intent,ownerType,ownerId,role,kind,name,mime,sha,size,spec};
}
export async function uploadStreamToR2(db,r2,principal,companyId,request){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 const m=metadata(request);
 if(!r2?.put||!r2?.get||!request.body)
  throw new DomainError("stream_r2_unavailable",503);
 await assertEntityNotBlocked(db,principal,companyId,TYPES[m.ownerType],m.ownerId,"WRITE");
 const hash=await hashIntent("ANEXAR_DOCUMENTO_STREAM",[
  m.ownerType,m.ownerId,m.role,m.kind,m.name,m.mime,m.sha,m.size
 ]);
 const prior=await replayOrConflict(db,companyId,m.intent,hash,"ANEXAR_DOCUMENTO_STREAM");
 if(prior){
  await drainPreflightedUpload(request,m.size,"stream_size_mismatch_or_orphan");
  return prior;
 }
 const owner=await db.prepare("SELECT id FROM "+m.spec.table+
  " WHERE id=? AND empresa_id=?").bind(m.ownerId,companyId).first();
 if(!owner)throw new DomainError("document_owner_not_found",409);
 const duplicate=await db.prepare("SELECT id FROM documento_vinculos WHERE empresa_id=? AND "+
  m.spec.column+"=? AND papel=? AND ativo=1 LIMIT 1"
 ).bind(companyId,m.ownerId,m.role).first();
 if(duplicate){
  await drainPreflightedUpload(request,m.size,"stream_size_mismatch_or_orphan");
  throw new DomainError("document_role_already_active",409);
 }
 const doc=crypto.randomUUID(),version=crypto.randomUUID(),
  local=crypto.randomUUID(),link=crypto.randomUUID(),
  key=companyId+"/"+doc+"/"+version;
 // Request.body com Content-Length e stream de tamanho conhecido; Cloudflare
 // R2 recusa stream sem tamanho (nao usar TransformStream indeterminado).
 try{await r2.put(key,request.body);}catch{
  throw new DomainError("stream_r2_copy_uncertain",409);
 }
 const stored=await r2.get(key);
 if(!stored||stored.size!==m.size||!stored.arrayBuffer)
  throw new DomainError("stream_size_mismatch_or_orphan",409);
 const bytes=await stored.arrayBuffer();
 if(bytes.byteLength!==m.size||(await digest(bytes))!==m.sha)
  throw new DomainError("stream_digest_mismatch_or_orphan",409);
 // Permissoes podem ter mudado enquanto a origem era recebida.
 const fresh=await requireCompanyRole(db,principal,companyId,"write");
 if(fresh.userId!==actor.userId)throw new DomainError("document_actor_changed",409);
 await assertEntityNotBlocked(db,principal,companyId,TYPES[m.ownerType],m.ownerId,"WRITE");
 const statements=[];const add=(sql,...args)=>statements.push(db.prepare(sql).bind(...args));
 add("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
     "VALUES (?,?,'ANEXAR_DOCUMENTO_STREAM',?,?,'CONCLUIDA','NATIVO','VALIDADO')",
     m.intent,companyId,hash,actor.userId);
 add("INSERT INTO documentos(id,empresa_id,tipo,titulo,operacao_id,conferencia) "+
     "VALUES (?,?,?,?,?,'VALIDADO')",doc,companyId,m.kind,m.name,m.intent);
 add("INSERT INTO documento_versoes(id,empresa_id,documento_id,numero_versao,"+
     "nome_original,mime_type,tamanho_bytes,sha256,enviado_por,estado_integridade,"+
     "operacao_id,conferencia) VALUES (?,?,?,1,?,?,?,?,?,'PENDENTE',?,'VALIDADO')",
     version,companyId,doc,m.name,m.mime,m.size,m.sha,actor.userId,m.intent);
 add("INSERT INTO documento_localizacoes(id,empresa_id,versao_id,provedor,chave_r2,"+
     "status,operacao_id,conferencia) VALUES (?,?,?,'R2',?,'PENDENTE',?,'VALIDADO')",
     local,companyId,version,key,m.intent);
 add("UPDATE documento_localizacoes SET status='VERIFICADO',"+
     "hash_verificado=?,tamanho_verificado=?,"+
     "verificado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
     "WHERE id=? AND versao_id=? AND empresa_id=? AND status='PENDENTE'",
     m.sha,m.size,local,version,companyId);
 add("UPDATE documento_versoes SET estado_integridade='VERIFICADO',versao=versao+1 "+
     "WHERE id=? AND documento_id=? AND empresa_id=? AND estado_integridade='PENDENTE'",
     version,doc,companyId);
 add("UPDATE documentos SET versao_corrente_id=?,versao=versao+1 "+
     "WHERE id=? AND empresa_id=? AND versao_corrente_id IS NULL",
     version,doc,companyId);
 add("INSERT INTO documento_vinculos(id,empresa_id,documento_id,papel,"+
     m.spec.column+",ativo,operacao_id,conferencia) "+
     "VALUES (?,?,?,?,?,1,?,'VALIDADO')",
     link,companyId,doc,m.role,m.ownerId,m.intent);
 let result;
 try{result=await db.batch(statements);}catch{
  throw new DomainError("stream_db_conflict_or_orphan_requires_review",409);
 }
 if(!Array.isArray(result)||result.length!==statements.length||
    result.some(r=>!Number.isInteger(r?.meta?.changes)||r.meta.changes<1)){
  throw new DomainError("stream_db_incomplete_requires_review",409);
 }
 return {replayed:false,intentId:m.intent,documentoId:doc,versaoId:version,
   tamanhoBytes:m.size,sha256:m.sha,r2DeletionAuthorized:false};
}
