// Testes de contrato A1 sem acesso externo, sem permissões de deploy.
import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {a1RuntimeMode,A1_HML_ORIGIN,A1_HML_STAGE,A1_HML_ENABLE}
 from "../ui/worker/a1-runtime-gate.mjs";
const db={prepare(){},batch(){}};
const env={DB:db,A1_HML_ORIGIN,APP_ORIGIN:A1_HML_ORIGIN,
 A1_HML_STAGE,A1_HML_ENABLED:A1_HML_ENABLE};
test("A1 origin/flag/port/prod fail closed",()=>{
 const req=url=>new Request(url+"/api/v1/me");
 assert.equal(a1RuntimeMode(req(A1_HML_ORIGIN),env,"F1"),"hml");
 assert.equal(a1RuntimeMode(req(A1_HML_ORIGIN),env,"F2"),"hml");
 for(const url of ["https://licita-production.invalid",
 "https://outro.lunaris.dev.br","http://licita-hml.invalid",
 "https://licita-hml.invalid:8443"]){
  assert.equal(a1RuntimeMode(req(url),env,"F1"),null,url);
 }
 for(const changes of [
  {A1_HML_ENABLED:"off"},{A1_HML_STAGE:"prod"},
  {A1_HML_ORIGIN:"https://licita-production.invalid"},
  {APP_ORIGIN:"https://licita-production.invalid"},
  {F1_RUNTIME_ENABLED:"test_local_only"},{F3_RUNTIME_ENABLED:"test_local_only"},
  {DB:{}}
 ]){
  assert.equal(a1RuntimeMode(req(A1_HML_ORIGIN),{...env,...changes},"F1"),null);
 }
});
test("A1 local Workerd path not regressed; prod Wrangler and HML rollback unchanged",()=>{
 assert.equal(a1RuntimeMode(new Request("https://licita.local.test/api/v1/me"),
  {DB:db,F1_RUNTIME_ENABLED:"test_local_only"},"F1"),"local");
 const root=JSON.parse(readFileSync("wrangler.jsonc","utf8"));
 const hml=JSON.parse(readFileSync("wrangler.hml.jsonc","utf8"));
 assert.equal(root.main,"./web/ui/worker/index.mjs");
 assert.equal(root.d1_databases,undefined);
 assert.equal(hml.main,"./web/src/hml/index.mjs");
 assert.equal(hml.d1_databases[0].database_id,"00000000-0000-4000-8000-000000000000");
});
