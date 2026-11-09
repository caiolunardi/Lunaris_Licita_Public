// R7 / MIG01-MIG04: reconciliacao local fail-closed, sem acesso a Sheets,
// Drive, R2 nem credenciais. Conteudo LEGADO nunca e descartado ou inventado.
// O inventario de 350 campos so passa depois de evidencias de fonte/destino.
import { LEGACY_FIELD_KEYS } from "./legacy-field-keys.mjs";
const SAFE_HASH=/^[a-f0-9]{64}$/;
function id(v){return typeof v==="string"&&v.trim()===v&&v.length>0&&v.length<=256;}
function badRow(r){
 return !r||typeof r!=="object"||!id(r.sourceId)||!SAFE_HASH.test(r.sha256||"") ||
   !id(r.entityType)||r.hasFormula!==false||r.validCivilDate!==true||
   r.sourceAccessible!==true;
}
export function reconcileLegacySnapshot({sourceRows,destinationRows,
  documents,fieldsExpected,fieldsMapped,fieldKeys,importErrors=[]}={}){
 const reasons=[],sourceKeys=new Map(),destKeys=new Map();
 const arr=(v,name)=>{
  if(!Array.isArray(v)){reasons.push(name+"_missing");return [];}
  return v;
 };
 const sources=arr(sourceRows,"source_rows");
 const targets=arr(destinationRows,"destination_rows");
 const docs=arr(documents,"documents");
 const docsKeys=new Map();
 const errors=arr(importErrors,"import_errors");
 for(const r of sources){
  if(badRow(r)){reasons.push("source_row_unreconciled");continue;}
  const key=r.entityType+"\u0000"+r.sourceId;
  if(sourceKeys.has(key))reasons.push("duplicate_source_id");
  sourceKeys.set(key,r);
 }
 for(const r of targets){
  if(!r||!id(r.sourceId)||!id(r.entityType)||!SAFE_HASH.test(r.sha256||"")){
   reasons.push("destination_unidentified");continue;
  }
  const key=r.entityType+"\u0000"+r.sourceId;
  if(destKeys.has(key))reasons.push("duplicate_destination_id");
  destKeys.set(key,r);
 }
 for(const [key,r] of sourceKeys){
  const dest=destKeys.get(key);
  if(!dest)reasons.push("missing_destination_row");
  else if(r.sha256!==dest.sha256)reasons.push("row_hash_mismatch");
 }
 for(const key of destKeys.keys()){
  if(!sourceKeys.has(key))reasons.push("unmapped_destination_row");
 }
 for(const d of docs){
  if(!d||!id(d.sourceStableId)||!id(d.destDocumentId)||
     !Number.isSafeInteger(d.versionNumber)||d.versionNumber<1||
     !SAFE_HASH.test(d.sha256||"") ||
     d.destinationSha256!==d.sha256 ||
     d.sourceReadable!==true||d.destinationReadable!==true||
     d.bytesMatch!==true||d.versionsPreserved!==true){
    reasons.push("document_unreconciled");
    continue;
  }
  const key=d.sourceStableId+"\\u0000"+d.versionNumber;
  if(docsKeys.has(key))reasons.push("duplicate_document_version");
  docsKeys.set(key,d);
 }
 if(!Number.isSafeInteger(fieldsExpected)||fieldsExpected!==350 ||
    !Number.isSafeInteger(fieldsMapped)||fieldsMapped!==350){
  reasons.push("field_coverage_not_350_of_350");
 }
 const mapValid=Array.isArray(fieldKeys)&&fieldKeys.length===350&&
  fieldKeys.every(k=>typeof k==="string");
 const normalized=mapValid?[...fieldKeys].sort():[];
 if(!mapValid||normalized.some((key,i)=>key!==LEGACY_FIELD_KEYS[i])){
  reasons.push("field_inventory_incomplete");
 }
 if(errors.length>0)reasons.push("import_errors_unresolved");
 if(sources.length===0)reasons.push("empty_source_not_proof");
 if(sources.length!==targets.length)reasons.push("row_counts_differ");
 const distinct=Array.from(new Set(reasons));
 return Object.freeze({
  passedLocalReconciliation:distinct.length===0,
  approveCutover:false,
  reasons:Object.freeze(distinct),
  sourceRows:sources.length,
  destinationRows:targets.length,
  documentsChecked:docs.length
 });
}
