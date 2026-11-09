// R7 / W7: prova de bytes R2 com limite de memoria. NAO publica downloads,
// upload, expurgo ou fallback para Drive; falta autenticar relacao dono->arquivo.
import { SecurityError } from "./security.mjs";
import { DomainError } from "./domain.mjs";

const MAX_INLINE_BYTES = 8 * 1024 * 1024;
export async function verifyR2Evidence(r2Bucket, record, companyId) {
  if (!r2Bucket?.get || !record || typeof companyId!=="string" ||
      !record.chave_r2?.startsWith(companyId+"/") ||
      record.chave_r2.length > 512 || record.chave_r2.includes("..") ||
      record.chave_r2.includes("//") ||
      !Number.isSafeInteger(record.tamanho_bytes) ||
      record.tamanho_bytes<0 || record.tamanho_bytes>MAX_INLINE_BYTES ||
      !/^[0-9a-f]{64}$/.test(record.sha256||"")) {
    throw new SecurityError("invalid_document_reference");
  }
  const copy = await r2Bucket.get(record.chave_r2);
  if (!copy || copy.size !== record.tamanho_bytes || typeof copy.arrayBuffer !== "function") {
    throw new DomainError("r2_copy_unavailable_or_wrong_size",409);
  }
  const bytes=await copy.arrayBuffer();
  if(bytes.byteLength!==record.tamanho_bytes) {
    throw new DomainError("r2_content_size_mismatch",409);
  }
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
    .map(x=>x.toString(16).padStart(2,"0")).join("");
  if(hash!==record.sha256) throw new DomainError("r2_content_hash_mismatch",409);
  return Object.freeze({verified:true,size:bytes.byteLength,sha256:hash});
}
// Deliberadamente NAO exportar metodo de delecao ou arquivamento. A politica
// exige ultimo encerramento +24 meses, Drive verificado, backup independente
// restaurado e +30 dias gerados pelo banco; nenhuma dessas provas esta pronta.
export function refuseR2Deletion() {
  throw new SecurityError("r2_deletion_disabled_pending_restore_gate");
}
