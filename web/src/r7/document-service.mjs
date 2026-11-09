// R7 etapa 2 / DOC01-04, DOC09, OK10: upload e download locais
// ao nivel do owner e sua empresa. Adaptador R2 real apenas Miniflare local;
// nao exposto pelo bootstrap publicado, sem URL publica de arquivo.
//
// Limite JSON 8 KiB na etapa 2; upload streaming maior e concessao de acesso
// documental granular vao para etapa 3/4. Falha apos R2.put e antes de D1
// requer reconciliacao de objeto orfao: nunca apagar o blob automaticamente.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier,
        hashIntent,replayOrConflict,requireBatch} from "./domain.mjs";
const MAX=8192; // Base64 JSON da E2
const READ_MAX=8*1024*1024; // E4 binario com limite verificado
const CREATE_FIELDS=new Set(["intentId","ownerType","ownerId","papel",
  "documentType","nomeOriginal","mimeType","conteudoBase64"]);
export const OWNER_ROLES=Object.freeze({
  licitacao:{table:"licitacoes",column:"licitacao_id",roles:["EDITAL","PROPOSTA"]},
  empenho:{table:"empenhos",column:"empenho_id",roles:["EMPENHO"]},
  compra:{table:"compras",column:"compra_id",roles:["PEDIDO_COMPRA","NF_FORNECEDOR"]},
  envio:{table:"envios",column:"envio_id",roles:["DESPACHO","ENTREGA"]},
  nota_fiscal:{table:"notas_fiscais",column:"nota_fiscal_id",roles:["NF_VENDA_PDF","NF_VENDA_XML"]},
  titulo_pagar:{table:"titulos_pagar",column:"titulo_pagar_id",roles:["BOLETO","COMPROVANTE_PAGAMENTO"]},
  titulo_baixa:{table:"titulo_baixas",column:"titulo_baixa_id",roles:["COMPROVANTE_PAGAMENTO"]},
  conta_receber:{table:"contas_receber",column:"conta_receber_id",roles:["COMPROVANTE_CREDITO"]},
  recebimento:{table:"recebimentos",column:"recebimento_id",roles:["COMPROVANTE_CREDITO"]}
});
async function hash(bytes){
 const digest=await crypto.subtle.digest("SHA-256",bytes);
 return Array.from(new Uint8Array(digest))
   .map(x=>x.toString(16).padStart(2,"0")).join("");
}
function decodeBase64(input) {
 if(typeof input!=="string"||input.length===0||input.length>11000||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)){
  throw new DomainError("invalid_document_base64");
 }
 try{
  const text=atob(input);
  const out=Uint8Array.from(text,x=>x.charCodeAt(0));
  if(out.length===0||out.length>MAX)throw new DomainError("document_size_not_supported",413);
  return out;
 }catch(e){
  if(e instanceof DomainError)throw e;
  throw new DomainError("invalid_document_base64");
 }
}
async function ensureR2Bytes(r2,key,bytes,expectedHash){
 await r2.put(key,bytes);
 const file=await r2.get(key);
 if(!file||file.size!==bytes.length||typeof file.arrayBuffer!=="function"){
  throw new DomainError("uploaded_document_not_readable",409);
 }
 const got=new Uint8Array(await file.arrayBuffer());
 if(got.length!==bytes.length||(await hash(got))!==expectedHash){
  throw new DomainError("uploaded_document_hash_mismatch",409);
 }
}
export async function createDocumentAttachment(db,r2,principal,companyId,body){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 strictlyObject(body,CREATE_FIELDS);
 const intent=identifier(body.intentId),ownerId=identifier(body.ownerId);
 const spec=OWNER_ROLES[body.ownerType];
 if(!spec||!spec.roles.includes(body.papel)||
   typeof body.documentType!=="string"||
   !/^[A-Z][A-Z_]{2,63}$/.test(body.documentType)||
   (body.documentType==="COMPROVANTE_RETENCAO"&&
    !(body.ownerType==="conta_receber"&&body.papel==="COMPROVANTE_CREDITO"))||
   typeof body.nomeOriginal!=="string"||body.nomeOriginal.length<1||
   body.nomeOriginal.length>255||body.nomeOriginal.includes("/")||
   body.nomeOriginal.includes("\\")||
   typeof body.mimeType!=="string"||
   !/^(application\/pdf|application\/xml|image\/(png|jpeg)|text\/plain)$/.test(body.mimeType)){
    throw new DomainError("invalid_document_role_or_metadata");
 }
 if(!r2?.put||!r2?.get)throw new DomainError("r2_upload_unavailable",503);
 const bytes=decodeBase64(body.conteudoBase64);
 const digest=await hash(bytes);
 const requestHash=await hashIntent("ANEXAR_DOCUMENTO",[
   body.ownerType,ownerId,body.papel,body.documentType,body.nomeOriginal,
   body.mimeType,bytes.length,digest
 ]);
 const prior=await replayOrConflict(db,companyId,intent,requestHash,"ANEXAR_DOCUMENTO");
 if(prior)return prior;
 const owner=await db.prepare(
   "SELECT id FROM "+spec.table+" WHERE id=? AND empresa_id=?"
 ).bind(ownerId,companyId).first();
 if(!owner)throw new DomainError("document_owner_not_found",409);
 const duplicate=await db.prepare(
   "SELECT id FROM documento_vinculos WHERE empresa_id=? AND "+
   spec.column+"=? AND papel=? AND ativo=1 LIMIT 1"
 ).bind(companyId,ownerId,body.papel).first();
 if(duplicate)throw new DomainError("document_role_already_active",409);
 const docId=crypto.randomUUID(),versionId=crypto.randomUUID(),
       locationId=crypto.randomUUID(),linkId=crypto.randomUUID();
 const key=companyId+"/"+docId+"/"+versionId;
 // Se R2 divergir, nenhuma linha D1 nem journal sera escrita.
 await ensureR2Bytes(r2,key,bytes,digest);
 const statements=[];
 const add=(sql,args)=>statements.push(db.prepare(sql).bind(...args));
 add("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
     "origem_dado,conferencia) "+
     "VALUES (?,?,'ANEXAR_DOCUMENTO',?,?,'CONCLUIDA','NATIVO','VALIDADO')",
     [intent,companyId,requestHash,actor.userId]);
 add("INSERT INTO documentos(id,empresa_id,tipo,titulo,operacao_id,"+
     "conferencia) VALUES (?,?,?,?,?,'VALIDADO')",
     [docId,companyId,body.documentType,body.nomeOriginal,intent]);
 add("INSERT INTO documento_versoes(id,empresa_id,documento_id,numero_versao,"+
     "nome_original,mime_type,tamanho_bytes,sha256,enviado_por,"+
     "estado_integridade,operacao_id,conferencia) "+
     "VALUES (?,?,?,1,?,?,?,?,?,'PENDENTE',?,'VALIDADO')",
     [versionId,companyId,docId,body.nomeOriginal,body.mimeType,
      bytes.length,digest,actor.userId,intent]);
 add("INSERT INTO documento_localizacoes(id,empresa_id,versao_id,provedor,"+
     "chave_r2,status,operacao_id,conferencia) "+
     "VALUES (?,?,?,'R2',?,'PENDENTE',?,'VALIDADO')",
     [locationId,companyId,versionId,key,intent]);
 add("UPDATE documento_localizacoes SET status='VERIFICADO',"+
     "hash_verificado=?,tamanho_verificado=?,"+
     "verificado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
     "WHERE id=? AND versao_id=? AND empresa_id=? AND status='PENDENTE'",
     [digest,bytes.length,locationId,versionId,companyId]);
 add("UPDATE documento_versoes SET estado_integridade='VERIFICADO',"+
     "versao=versao+1 WHERE id=? AND documento_id=? AND "+
     "empresa_id=? AND estado_integridade='PENDENTE'",
     [versionId,docId,companyId]);
 add("UPDATE documentos SET versao_corrente_id=?,versao=versao+1 "+
     "WHERE id=? AND empresa_id=? AND versao_corrente_id IS NULL",
     [versionId,docId,companyId]);
 // Somente colunas whitelisted; FKs e indice unico ativo no D1
 // bloqueiam owner forjado e duplicata concorrente.
 add("INSERT INTO documento_vinculos "+
     "(id,empresa_id,documento_id,papel,"+spec.column+
     ",ativo,operacao_id,conferencia) "+
     "VALUES (?,?,?,?,?,1,?,'VALIDADO')",
     [linkId,companyId,docId,body.papel,ownerId,intent]);
 let results;
 try{results=await db.batch(statements);}
 catch{throw new DomainError("document_db_conflict_or_orphan_r2_requires_reconciliation",409);}
 if(!Array.isArray(results)||results.length!==statements.length||
   results.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1)){
   throw new DomainError("document_db_incomplete_requires_reconciliation",409);
 }
 return {replayed:false,intentId:intent,documentoId:docId,
   versaoId:versionId,ownerType:body.ownerType,ownerId,
   sha256:digest,tamanhoBytes:bytes.length};
}
export async function readDocumentAttachment(db,r2,principal,companyId,documentoId){
 await requireCompanyRole(db,principal,companyId,"read");
 const id=identifier(documentoId);
 if(!r2?.get)throw new DomainError("r2_download_unavailable",503);
 const v=await db.prepare(
  "SELECT v.sha256,v.tamanho_bytes,v.mime_type,l.chave_r2 "+
  "FROM documentos d JOIN documento_versoes v "+
  "ON v.id=d.versao_corrente_id AND v.documento_id=d.id "+
  "AND v.empresa_id=d.empresa_id "+
  "JOIN documento_localizacoes l ON l.versao_id=v.id "+
  "AND l.empresa_id=v.empresa_id "+
  "WHERE d.id=? AND d.empresa_id=? AND v.estado_integridade='VERIFICADO' "+
  "AND l.provedor='R2' AND l.status='VERIFICADO' "+
  "AND l.hash_verificado=v.sha256 AND l.tamanho_verificado=v.tamanho_bytes "+
  "AND EXISTS(SELECT 1 FROM documento_vinculos dv "+
  "WHERE dv.documento_id=d.id AND dv.empresa_id=d.empresa_id AND dv.ativo=1) "+
  "ORDER BY l.id LIMIT 1"
 ).bind(id,companyId).first();
 if(!v||!v.chave_r2?.startsWith(companyId+"/")||
   !/^[a-f0-9]{64}$/.test(v.sha256||"")||
   !Number.isInteger(v.tamanho_bytes)||v.tamanho_bytes>READ_MAX||
   v.tamanho_bytes<0)throw new DomainError("document_not_available",404);
 const file=await r2.get(v.chave_r2);
 if(!file||file.size!==v.tamanho_bytes||typeof file.arrayBuffer!=="function"){
   throw new DomainError("document_bytes_unavailable",409);
 }
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(bytes.length!==v.tamanho_bytes||(await hash(bytes))!==v.sha256){
  throw new DomainError("document_integrity_mismatch",409);
 }
 return {bytes,mime:v.mime_type,sha256:v.sha256};
}


const VERSION_FIELDS=new Set(["intentId","documentoId","expectedVersion",
  "nomeOriginal","mimeType","conteudoBase64"]);
// DOC04: nova versão, nunca UPDATE/DELETE da versão anterior.
// O ponteiro versao_corrente_id de documentos usa CAS; o hash da cópia R2
// é revalidado antes do diário. Se D1 falhar, preservar R2 até reconciliação.
export async function appendDocumentVersion(db,r2,principal,companyId,body){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 strictlyObject(body,VERSION_FIELDS);
 const intent=identifier(body.intentId),docId=identifier(body.documentoId);
 if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1||
    typeof body.nomeOriginal!=="string"||body.nomeOriginal.length<1||
    body.nomeOriginal.length>255||body.nomeOriginal.includes("/")||
    body.nomeOriginal.includes("\\")||
    typeof body.mimeType!=="string"||
    !/^(application\/pdf|application\/xml|image\/(png|jpeg)|text\/plain)$/.test(body.mimeType)){
  throw new DomainError("invalid_document_version_request");
 }
 if(!r2?.put||!r2?.get)throw new DomainError("r2_upload_unavailable",503);
 const bytes=decodeBase64(body.conteudoBase64),digest=await hash(bytes);
 const requestHash=await hashIntent("NOVA_VERSAO_DOCUMENTO",[
  docId,body.expectedVersion,body.nomeOriginal,body.mimeType,
  bytes.length,digest
 ]);
 const previous=await replayOrConflict(db,companyId,intent,requestHash,"NOVA_VERSAO_DOCUMENTO");
 if(previous)return previous;
 const row=await db.prepare(
  "SELECT d.id,d.versao,d.versao_corrente_id,"+
  "v.numero_versao FROM documentos d "+
  "JOIN documento_versoes v ON v.id=d.versao_corrente_id "+
  "AND v.documento_id=d.id AND v.empresa_id=d.empresa_id "+
  "WHERE d.id=? AND d.empresa_id=? AND d.versao=? "+
  "AND d.origem_dado='NATIVO' AND v.estado_integridade='VERIFICADO' "+
  "AND EXISTS(SELECT 1 FROM documento_vinculos dv "+
  "WHERE dv.documento_id=d.id AND dv.empresa_id=d.empresa_id AND dv.ativo=1)"
 ).bind(docId,companyId,body.expectedVersion).first();
 if(!row)throw new DomainError("document_version_conflict",409);
 const versionId=crypto.randomUUID(),locId=crypto.randomUUID();
 const newNo=row.numero_versao+1;
 if(!Number.isSafeInteger(newNo))throw new DomainError("document_version_overflow",409);
 const key=companyId+"/"+docId+"/"+versionId;
 await ensureR2Bytes(r2,key,bytes,digest);
 const statements=[];
 const add=(sql,args)=>statements.push(db.prepare(sql).bind(...args));
 add("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "origem_dado,conferencia) "+
  "VALUES (?,?,'NOVA_VERSAO_DOCUMENTO',?,?,'CONCLUIDA','NATIVO','VALIDADO')",
  [intent,companyId,requestHash,actor.userId]);
 add("INSERT INTO documento_versoes(id,empresa_id,documento_id,numero_versao,"+
  "nome_original,mime_type,tamanho_bytes,sha256,enviado_por,"+
  "estado_integridade,operacao_id,conferencia) "+
  "VALUES (?,?,?,?,?,?,?,?,?,'PENDENTE',?,'VALIDADO')",
  [versionId,companyId,docId,newNo,body.nomeOriginal,body.mimeType,
   bytes.length,digest,actor.userId,intent]);
 add("INSERT INTO documento_localizacoes(id,empresa_id,versao_id,provedor,"+
  "chave_r2,status,operacao_id,conferencia) "+
  "VALUES (?,?,?,'R2',?,'PENDENTE',?,'VALIDADO')",
  [locId,companyId,versionId,key,intent]);
 add("UPDATE documento_localizacoes SET status='VERIFICADO',"+
  "hash_verificado=?,tamanho_verificado=?,"+
  "verificado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
  "WHERE id=? AND empresa_id=? AND versao_id=? AND status='PENDENTE'",
  [digest,bytes.length,locId,companyId,versionId]);
 add("UPDATE documento_versoes SET estado_integridade='VERIFICADO',"+
  "versao=versao+1 WHERE id=? AND empresa_id=? AND documento_id=? "+
  "AND estado_integridade='PENDENTE'",
  [versionId,companyId,docId]);
 add("UPDATE documentos SET versao_corrente_id=?,versao=versao+1 "+
  "WHERE id=? AND empresa_id=? AND versao=? AND versao_corrente_id=? "+
  "AND EXISTS(SELECT 1 FROM documento_versoes v "+
  "WHERE v.id=? AND v.documento_id=documentos.id "+
  "AND v.empresa_id=documentos.empresa_id AND v.estado_integridade='VERIFICADO')",
  [versionId,docId,companyId,body.expectedVersion,row.versao_corrente_id,versionId]);
 let results;
 try{results=await db.batch(statements);}
 catch{throw new DomainError("document_version_db_conflict_requires_reconciliation",409);}
 if(!Array.isArray(results)||results.length!==statements.length||
   results.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1)){
  throw new DomainError("document_version_db_incomplete_requires_reconciliation",409);
 }
 return {replayed:false,intentId:intent,documentoId:docId,
   versaoId:versionId,numeroVersao:newNo,sha256:digest,tamanhoBytes:bytes.length};
}
export async function readDocumentHistoricVersion(db,r2,principal,companyId,docId,versionId){
 await requireCompanyRole(db,principal,companyId,"read");
 const doc=identifier(docId),version=identifier(versionId);
 if(!r2?.get)throw new DomainError("r2_download_unavailable",503);
 const v=await db.prepare(
  "SELECT v.sha256,v.tamanho_bytes,v.mime_type,l.chave_r2 "+
  "FROM documentos d JOIN documento_versoes v "+
  "ON v.documento_id=d.id AND v.empresa_id=d.empresa_id "+
  "JOIN documento_localizacoes l ON l.versao_id=v.id AND l.empresa_id=v.empresa_id "+
  "WHERE d.id=? AND v.id=? AND d.empresa_id=? "+
  "AND v.estado_integridade='VERIFICADO' AND l.provedor='R2' "+
  "AND l.status='VERIFICADO' AND l.hash_verificado=v.sha256 "+
  "AND l.tamanho_verificado=v.tamanho_bytes "+
  "AND EXISTS(SELECT 1 FROM documento_vinculos dv "+
  "WHERE dv.documento_id=d.id AND dv.empresa_id=d.empresa_id AND dv.ativo=1) "+
  "ORDER BY l.id LIMIT 1"
 ).bind(doc,version,companyId).first();
 if(!v||!v.chave_r2?.startsWith(companyId+"/")||
    !/^[a-f0-9]{64}$/.test(v.sha256||"")||
    !Number.isInteger(v.tamanho_bytes)||v.tamanho_bytes>READ_MAX||
    v.tamanho_bytes<0)throw new DomainError("document_not_available",404);
 const file=await r2.get(v.chave_r2);
 if(!file||file.size!==v.tamanho_bytes||typeof file.arrayBuffer!=="function"){
  throw new DomainError("document_bytes_unavailable",409);
 }
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(bytes.length!==v.tamanho_bytes||(await hash(bytes))!==v.sha256)
  throw new DomainError("document_integrity_mismatch",409);
 return {bytes,mime:v.mime_type,sha256:v.sha256};
}
