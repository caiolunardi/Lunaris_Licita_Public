// R7 E2 / MIG01–MIG04: preparo de importacao APENAS com dados sinteticos.
// Persiste ledger de linhas e anexos PENDENTES; NÃO grava linhas nas entidades
// comerciais, NÃO copia anexos, NÃO autoriza cutover nem dados do usuário.
// A validação impede sumiço silencioso, identidade duplicada e reimportação
// que criaria novas referencias para o mesmo snapshot.
import { requireCompanyRole } from "./security.mjs";
import { DomainError,strictlyObject,identifier,positiveInt,hashIntent,
         replayOrConflict,requireBatch } from "./domain.mjs";
import { LEGACY_FIELD_KEYS } from "./legacy-field-keys.mjs";

const FIELDS=new Set(["intentId","snapshotId","snapshotHash","mappingVersion",
  "fieldsExpected","fieldsMapped","sourceCountExpected","documentCountExpected",
  "sourceRows","sourceDocuments","fieldKeys"]);
const ROW_FIELDS=new Set(["sourceId","entityType","sha256",
 "sourceAccessible","validCivilDate","hasFormula"]);
const DOC_FIELDS=new Set(["sourceStableId","versionNumber","sha256",
 "sourceReadable","bytesMatch","versionsPreserved"]);
const ENTITY_TYPES=new Set(["LICITACAO","ITEM","EMPENHO","COMPRA","ENVIO","NF",
  "TITULO","BAIXA","ESTORNO","RECEBIMENTO","RECORRENCIA","REVISAO"]);
const HASH=/^[0-9a-f]{64}$/;
function validHash(h){return typeof h==="string"&&HASH.test(h);}
function verifyRows(rows){
 if(!Array.isArray(rows)||rows.length<1||rows.length>40)
  throw new DomainError("synthetic_snapshot_row_count_invalid",409);
 const seen=new Set();
 for(const r of rows){
  strictlyObject(r,ROW_FIELDS);
  if(!r||!ENTITY_TYPES.has(r.entityType)||!identifier(r.sourceId)||
      !validHash(r.sha256)||r.sourceAccessible!==true||
      r.validCivilDate!==true||r.hasFormula!==false){
   throw new DomainError("source_row_not_reconcilable",409);
  }
  const key=r.entityType+"\u0000"+r.sourceId;
  if(seen.has(key))throw new DomainError("duplicate_source_identity",409);
  seen.add(key);
 }
}
function verifyDocuments(docs){
 if(!Array.isArray(docs)||docs.length>40)
  throw new DomainError("synthetic_document_count_invalid",409);
 const seen=new Set();
 for(const d of docs){
  strictlyObject(d,DOC_FIELDS);
  if(!d||!identifier(d.sourceStableId)||!positiveInt(d.versionNumber)||
    !validHash(d.sha256)||d.sourceReadable!==true||
    d.bytesMatch!==true||d.versionsPreserved!==true){
   throw new DomainError("historic_document_unreconciled",409);
  }
  const key=d.sourceStableId+"\u0000"+d.versionNumber;
  if(seen.has(key))throw new DomainError("duplicate_historic_document_version",409);
  seen.add(key);
 }
}
export async function prepareSyntheticLegacyDryRun(db,principal,companyId,body){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"approve");
 strictlyObject(body,FIELDS);
 const intent=identifier(body.intentId);
 const snapshot=identifier(body.snapshotId);
 if(!snapshot.startsWith("synthetic-")||
    typeof body.mappingVersion!=="string"||
    !/^local-v\d+$/.test(body.mappingVersion)||
    !validHash(body.snapshotHash)||body.fieldsExpected!==350||
    body.fieldsMapped!==350||
    !Number.isSafeInteger(body.sourceCountExpected)||
    !Number.isSafeInteger(body.documentCountExpected)){
  throw new DomainError("synthetic_migration_only_or_mapping_incomplete",409);
 }
 if(!Array.isArray(body.fieldKeys)||body.fieldKeys.length!==350||
    !body.fieldKeys.every(k=>typeof k==="string")){
  throw new DomainError("legacy_field_inventory_incomplete",409);
 }
 const observed=[...body.fieldKeys].sort();
 if(observed.some((key,i)=>key!==LEGACY_FIELD_KEYS[i])){
  throw new DomainError("legacy_field_inventory_incomplete",409);
 }
 verifyRows(body.sourceRows);
 verifyDocuments(body.sourceDocuments);
 if(body.sourceRows.length!==body.sourceCountExpected||
    body.sourceDocuments.length!==body.documentCountExpected){
  throw new DomainError("snapshot_inventory_mismatch",409);
 }
 const normalizedRows=body.sourceRows.map(r=>[
  r.entityType,r.sourceId,r.sha256,r.sourceAccessible,r.validCivilDate,r.hasFormula
 ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const normalizedDocs=body.sourceDocuments.map(d=>[
  d.sourceStableId,d.versionNumber,d.sha256,d.sourceReadable,
  d.bytesMatch,d.versionsPreserved
 ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const fieldMapHash=await hashIntent("CAMPOS_LEGADO_V1",observed);
 const calculated=await hashIntent("SNAPSHOT_SINTETICO",
  [snapshot,normalizedRows,normalizedDocs,fieldMapHash]);
 if(calculated!==body.snapshotHash){
  throw new DomainError("snapshot_hash_mismatch",409);
 }
 const hash=await hashIntent("PREPARAR_LEGADO_SINTETICO",[
  snapshot,calculated,body.mappingVersion,body.fieldsExpected,body.fieldsMapped,fieldMapHash
 ]);
 const previous=await replayOrConflict(db,companyId,intent,hash,"PREPARAR_LEGADO_SINTETICO");
 if(previous)return {...previous,migrationExecuted:false,approveCutover:false};
 const lot=crypto.randomUUID();
 const steps=[];
 const add=(sql,args)=>steps.push(db.prepare(sql).bind(...args));
 add("INSERT INTO lotes_migracao (id,empresa_id,origem_snapshot,hash_origem,"+
  "versao_mapeamento,estado,operacao_id,origem_dado,conferencia) "+
  "VALUES (?,?,?,?,?,'PREPARADO',?,'NATIVO','VALIDADO')",
  [lot,companyId,snapshot,calculated,body.mappingVersion,intent]);
 for(const r of normalizedRows){
  add("INSERT INTO migracao_referencias(id,empresa_id,lote_id,tipo_origem,"+
   "id_origem_estavel,id_destino,hash_linha,estado,operacao_id) "+
   "VALUES(?,?,?,?,?,?,?,'PENDENTE',?)",
   [crypto.randomUUID(),companyId,lot,r[0],r[1],
    crypto.randomUUID(),r[2],intent]);
 }
 for(const d of normalizedDocs){
  add("INSERT INTO migracao_itens(id,empresa_id,lote_id,entidade_tipo,"+
   "hash_origem,estado,operacao_id) "+
   "VALUES(?,?,?,'DOCUMENTO_VERSAO',?,'PENDENTE',?)",
   [crypto.randomUUID(),companyId,lot,d[2],intent]);
 }
 add("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "plano_json,origem_dado,conferencia) "+
  "VALUES (?,?,'PREPARAR_LEGADO_SINTETICO',?,?,'CONCLUIDA',?,"+
  "'NATIVO','VALIDADO')",
  [intent,companyId,hash,actor.userId,
   JSON.stringify({snapshotId:snapshot,sourceCount:normalizedRows.length,
    documentCount:normalizedDocs.length,mappingVersion:body.mappingVersion,
    fieldMapHash,fieldsVerified:observed.length,
    resultado:"DRY_RUN_APENAS",approveCutover:false})]);
 let result;
 try{result=await db.batch(steps);}
 catch{throw new DomainError("migration_snapshot_duplicate_or_conflict",409);}
 if(!Array.isArray(result)||result.length!==steps.length||
    result.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1)){
  throw new DomainError("migration_dry_run_atomicity_failure",409);
 }
 return {replayed:false,intentId:intent,loteId:lot,
  referencesPending:normalizedRows.length,attachmentsPending:normalizedDocs.length,
  migrationExecuted:false,approveCutover:false};
}
