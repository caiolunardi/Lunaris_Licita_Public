import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {assessArchiveEvidence} from "../src/r7/retention.mjs";
import {reconcileLegacySnapshot} from "../src/r7/reconciliation.mjs";
import {LEGACY_FIELD_KEYS} from "../src/r7/legacy-field-keys.mjs";
const now=new Date("2026-11-07T15:00:00Z");
const sha="a".repeat(64);
const valid=()=>({
 documentOwnerType:"LICITACAO",
 lastCommercialClosureAt:"2024-11-06T10:00:00Z",
 lastReopeningAt:null,
 openSupplierTitles:0,openReceivables:0,legalBlocks:0,
 drive:{verified:true,verifiedAt:"2026-10-01T10:00:00Z",sha256:sha},
 backup:{restoreTested:true,restoredAt:"2026-10-01T12:00:00Z",sha256:sha},
 overlayStartedAt:"2026-10-01T10:00:00Z"
});
const assess=v=>assessArchiveEvidence(v,{now});
test("DOC05 DOC06 24 meses+30 dias com backup restaurado gera apenas revisão humana",()=>{
 const r=assess(valid());
 assert.equal(r.eligibleForHumanReview,true);
 assert.equal(r.deleteR2Authorized,false);
 assert.deepEqual(r.reasons,[]);
});
test("DOC05 23 meses não autoriza arquivamento",()=>{
 const r=assess({...valid(),lastCommercialClosureAt:"2025-01-01T10:00:00Z"});
 assert.ok(r.reasons.includes("retention_24_months_not_elapsed"));
});
test("DOC05 boleto aberto, saldo a receber ou bloqueio legal barram",()=>{
 for(const key of ["openSupplierTitles","openReceivables","legalBlocks"]){
  const r=assess({...valid(),[key]:1});
  assert.equal(r.eligibleForHumanReview,false);
  assert.ok(r.reasons.includes(key+"_active"));
 }
});
test("DOC05 reabertura sem novo encerramento invalida janela anterior",()=>{
 const r=assess({...valid(),lastReopeningAt:"2025-05-01T12:00:00Z"});
 assert.ok(r.reasons.includes("commercial_period_reopened"));
});
test("DOC06 Drive sem prova de bytes não permite revisão",()=>{
 const r=assess({...valid(),drive:{verified:false,verifiedAt:null,sha256:sha}});
 assert.ok(r.reasons.includes("drive_bytes_not_verified"));
});
test("DOC06 backup sem restore não passa, mesmo com hash declarado",()=>{
 const r=assess({...valid(),backup:{restoreTested:false,sha256:sha,restoredAt:null}});
 assert.ok(r.reasons.includes("independent_backup_not_restored"));
});
test("DOC06 29 dias de sobreposição não bastam",()=>{
 const r=assess({...valid(),overlayStartedAt:"2026-10-20T10:00:00Z"});
 assert.ok(r.reasons.includes("overlay_30_days_not_elapsed"));
});
test("DOC07 conta avulsa DIVERSO não herda arquivo de licitação",()=>{
 const r=assess({...valid(),documentOwnerType:"DIVERSO"});
 assert.ok(r.reasons.includes("diverse_bill_not_licitacao_archivable"));
 assert.equal(r.deleteR2Authorized,false);
});
const hash=x=>createHash("sha256").update(x).digest("hex");
const src=(id="rec-1",extra={})=>({
  sourceId:id,entityType:"TITULO",sha256:hash(id),
  hasFormula:false,validCivilDate:true,sourceAccessible:true,...extra
});
const dst=(id="rec-1",extra={})=>({sourceId:id,entityType:"TITULO",sha256:hash(id),...extra});
const doc=(extra={})=>({
  sourceStableId:"drive-1",versionNumber:1,destDocumentId:"d1",
  sha256:sha,destinationSha256:sha,
  sourceReadable:true,destinationReadable:true,bytesMatch:true,
  versionsPreserved:true,...extra
});
const fixture=(options={})=>({
 sourceRows:[src()],destinationRows:[dst()],documents:[doc()],
 fieldsExpected:350,fieldsMapped:350,fieldKeys:[...LEGACY_FIELD_KEYS],importErrors:[],...options
});
test("MIG04 inventario completo sintético é reconciliado, mas não aprova cutover",()=>{
 const r=reconcileLegacySnapshot(fixture());
 assert.equal(r.passedLocalReconciliation,true);
 assert.equal(r.approveCutover,false);
});
test("MIG01 duplicidade ID na fonte é falha sem descarte",()=>{
 const r=reconcileLegacySnapshot(fixture({sourceRows:[src(),src()]}));
 assert.ok(r.reasons.includes("duplicate_source_id"));
 assert.equal(r.passedLocalReconciliation,false);
});
test("MIG01 formula, data invalida e URL inacessivel são quarentena",()=>{
 for(const bad of [{hasFormula:true},{validCivilDate:false},{sourceAccessible:false}]){
  const r=reconcileLegacySnapshot(fixture({sourceRows:[src("rec-1",bad)]}));
  assert.ok(r.reasons.includes("source_row_unreconciled"));
 }
});
test("MIG02 reimportação sem mapa de destino não duplica aprovações",()=>{
 const r=reconcileLegacySnapshot(fixture({destinationRows:[dst(),dst()]}));
 assert.ok(r.reasons.includes("duplicate_destination_id"));
});
test("MIG03 arquivo histórico ilegível nunca é considerado migrado",()=>{
 const r=reconcileLegacySnapshot(fixture({documents:[doc({destinationReadable:false})]}));
 assert.ok(r.reasons.includes("document_unreconciled"));
});
test("MIG03 versão perdida e hash diferente bloqueiam",()=>{
 for(const bad of [{versionsPreserved:false},{bytesMatch:false}]){
  const r=reconcileLegacySnapshot(fixture({documents:[doc(bad)]}));
  assert.ok(r.reasons.includes("document_unreconciled"));
 }
});
test("MIG04 uma linha perdida rejeita 100% migrado",()=>{
 const r=reconcileLegacySnapshot(fixture({destinationRows:[]}));
 assert.ok(r.reasons.includes("missing_destination_row"));
});
test("MIG04 mapa 349/350 não libera cutover",()=>{
 const r=reconcileLegacySnapshot(fixture({fieldsMapped:349}));
 assert.ok(r.reasons.includes("field_coverage_not_350_of_350"));
});
test("MIG01 erros de importação nunca ocultos",()=>{
 const r=reconcileLegacySnapshot(fixture({importErrors:[{sourceId:"x",reason:"bad_date"}]}));
 assert.ok(r.reasons.includes("import_errors_unresolved"));
});


test("MIG01 fail-closed quando fórmula/data válida não são verificadas",()=>{
 for(const bad of [{hasFormula:undefined},{validCivilDate:undefined}]){
  const r=reconcileLegacySnapshot(fixture({sourceRows:[src("rec-1",bad)]}));
  assert.ok(r.reasons.includes("source_row_unreconciled"));
 }
});
test("MIG03 duas versões com mesmo ID histórico são duplicidade explícita",()=>{
 const r=reconcileLegacySnapshot(fixture({documents:[doc(),doc({destDocumentId:"d2"})]}));
 assert.ok(r.reasons.includes("duplicate_document_version"));
 assert.equal(r.passedLocalReconciliation,false);
});
test("MIG03 hash diferente da versão de destino impede aprovação",()=>{
 const r=reconcileLegacySnapshot(fixture({
   documents:[doc({destinationSha256:"f".repeat(64)})]
 }));
 assert.ok(r.reasons.includes("document_unreconciled"));
});
test("MIG04 mesmo número 350 não basta se nome de campo foi trocado",()=>{
 const list=[...LEGACY_FIELD_KEYS];list[0]="CampoFalso.Inventado";
 const r=reconcileLegacySnapshot(fixture({fieldKeys:list}));
 assert.ok(r.reasons.includes("field_inventory_incomplete"));
});


test("DOC05 OK15 24 meses contam milissegundos e o último encerramento",()=>{
 const old="2024-11-06T10:00:00.000Z";
 const newClose="2024-11-06T10:00:00.001Z";
 const cutoffOld=new Date("2026-11-06T10:00:00.000Z");
 const early=assessArchiveEvidence({...valid(),lastCommercialClosureAt:old},
  {now:new Date(cutoffOld.getTime()-1)});
 assert.ok(early.reasons.includes("retention_24_months_not_elapsed"));
 const exact=assessArchiveEvidence({...valid(),lastCommercialClosureAt:old},
  {now:cutoffOld});
 assert.equal(exact.eligibleForHumanReview,true);
 assert.equal(exact.deleteR2Authorized,false);
 const reopened=assessArchiveEvidence({...valid(),
  lastCommercialClosureAt:newClose,lastReopeningAt:"2024-11-06T10:00:00.000Z"},
  {now:cutoffOld});
 assert.ok(reopened.reasons.includes("retention_24_months_not_elapsed"));
});


test("DOC05 timestamp impossível ou prova de backup no futuro não habilitam revisão",()=>{
 const impossible=assessArchiveEvidence({...valid(),
  lastCommercialClosureAt:"2024-02-31T10:00:00.000Z"},{now});
 assert.ok(impossible.reasons.includes("closure_unverified"));
 const unverifiable=assessArchiveEvidence({...valid(),
  backup:{...valid().backup,restoredAt:"2027-01-01T12:00:00.000Z"}},{now});
 assert.ok(unverifiable.reasons.includes("independent_backup_not_restored"));
 const imaginary=assessArchiveEvidence({...valid(),
  drive:{...valid().drive,verifiedAt:"2026-02-30T12:00:00.000Z"}},{now});
 assert.ok(imaginary.reasons.includes("drive_bytes_not_verified"));
});
