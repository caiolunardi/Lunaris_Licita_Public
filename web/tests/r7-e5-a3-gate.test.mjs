import test from "node:test";
import assert from "node:assert/strict";
import {a3F8RuntimeMode,a3FinancialEnvironment,a3CompanyIsSynthetic,
 a3ValidateSyntheticDocumentRequest,A3_HML_ENABLED,A3_HML_STAGE,A3_HML_SCOPE}
 from "../ui/worker/a3-runtime-gate.mjs";
import {A1_HML_ORIGIN,A1_HML_STAGE,A1_HML_ENABLE}
 from "../ui/worker/a1-runtime-gate.mjs";
import {A2_HML_SCOPE,A2_HML_ENABLED,A2_HML_STAGE}
 from "../ui/worker/a2-runtime-gate.mjs";
const db={prepare(){},batch(){}},r2={get(){},put(){}};
const env={DB:db,R2:r2,APP_ORIGIN:A1_HML_ORIGIN,
 A1_HML_ORIGIN,A1_HML_STAGE,A1_HML_ENABLED:A1_HML_ENABLE,
 A2_HML_SCOPE,A2_HML_ENABLED,A2_HML_STAGE,
 A3_HML_SCOPE,A3_HML_ENABLED,A3_HML_STAGE};
const url=A1_HML_ORIGIN+"/api/v1/companies/e1/files/upload";
const req=host=>new Request((host||A1_HML_ORIGIN)+"/api/v1/companies/e1/files");
function upload(overrides={}){
 const h={origin:A1_HML_ORIGIN,"x-lunaris-synthetic-only":"confirmed",
  "content-type":"application/pdf","content-length":"32",
  "x-content-sha256":"a".repeat(64),"x-doc-name":"TESTE - Edital.pdf",
  "x-doc-intent":"a3-test-upload-1","x-doc-owner-type":"licitacao",
  "x-doc-owner-id":"l1","x-doc-role":"EDITAL","x-doc-type":"EDITAL",
  ...overrides};
 return new Request(url,{method:"POST",headers:h});
}
test("A3: host exato, D1, R2, A1/A2 e flags isoladas",()=>{
 assert.equal(a3F8RuntimeMode(req(),env),"hml");
 for(const host of ["https://licita-production.invalid","http://licita-hml.invalid",
  "https://outro.lunaris.dev.br"])
  assert.equal(a3F8RuntimeMode(req(host),env),null,host);
 for(const override of [{R2:undefined},{DB:{}},{A3_HML_STAGE:"prod"},
  {A3_HML_ENABLED:"all"},{A3_HML_SCOPE:"prod"},
  {F8_RUNTIME_ENABLED:"test_local_only"},{GEMINI_API_KEY:"x"},
  {A2_HML_STAGE:"bad"},{APP_ORIGIN:"https://evil.invalid"}])
  assert.equal(a3F8RuntimeMode(req(),{...env,...override}),null,JSON.stringify(override));
});
test("A3: a rota financeira A2 não herda acesso ao R2",()=>{
 const financial=a3FinancialEnvironment(env);
 assert.equal(financial.R2,undefined);
 assert.equal(env.R2,r2);
 assert.equal(financial.DB,db);
});
test("A3: F8 local preservado sob flags test_local_only",()=>{
 assert.equal(a3F8RuntimeMode(req("https://licita.local.test"),
  {DB:db,R2:r2,F1_RUNTIME_ENABLED:"test_local_only",
   F8_RUNTIME_ENABLED:"test_local_only"}),"local");
 assert.equal(a3F8RuntimeMode(req("https://licita.local.test"),{DB:db,R2:r2}),null);
});
test("A3: upload exige nome TESTE, Origin e declaração sintética",()=>{
 assert.equal(a3ValidateSyntheticDocumentRequest(upload()),true);
 for(const override of [{"x-doc-name":"Documento real.pdf"},
  {"x-doc-name":"TESTE - https://example.org"},
  {"x-doc-intent":"real-id"},{"x-lunaris-synthetic-only":"no"},
  {origin:"https://evil.invalid"},{"content-length":"9000000"},
  {"x-doc-owner-type":"desconhecido"},{"x-doc-owner-id":"../bad"},
  {"x-content-sha256":"bad"}])
  assert.equal(a3ValidateSyntheticDocumentRequest(upload(override)),false,JSON.stringify(override));
});
test("A3: tenant com documento LEGADO, localização Drive ou transferência é bloqueado",async()=>{
 function fake(bad){
  return {prepare(sql){return {bind(){return {first:async()=>{
   if(sql.includes("FROM empresas"))return {nome:"TESTE - Empresa",documento_identificacao:null};
   if(bad==="documento"&&sql.includes("FROM documentos"))return {bad:1};
   if(bad==="drive"&&sql.includes("FROM documento_localizacoes"))return {bad:1};
   if(bad==="transferencia"&&sql.includes("FROM documento_transferencias"))return {bad:1};
   return null;
  }}}}}};
 }
 assert.equal(await a3CompanyIsSynthetic(fake(),"e1"),true);
 for(const issue of ["documento","drive","transferencia"])
  assert.equal(await a3CompanyIsSynthetic(fake(issue),"e1"),false,issue);
});
