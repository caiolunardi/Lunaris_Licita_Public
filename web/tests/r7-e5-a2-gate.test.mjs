import test from "node:test";
import assert from "node:assert/strict";
import {a2RuntimeMode,a2CompanyIsSynthetic,a2ValidateSyntheticMutation,
 A2_HML_SCOPE,A2_HML_ENABLED,A2_HML_STAGE}
 from "../ui/worker/a2-runtime-gate.mjs";
import {A1_HML_ORIGIN,A1_HML_STAGE,A1_HML_ENABLE}
 from "../ui/worker/a1-runtime-gate.mjs";
const db={prepare(){},batch(){}};
const env={DB:db,A1_HML_ORIGIN,APP_ORIGIN:A1_HML_ORIGIN,
 A1_HML_STAGE,A1_HML_ENABLED:A1_HML_ENABLE,
 A2_HML_SCOPE,A2_HML_ENABLED,A2_HML_STAGE};
const req=(host=A1_HML_ORIGIN)=>new Request(host+"/api/v1/companies/e1/finance/titles");
const request=(body,header={})=>new Request(A1_HML_ORIGIN+
 "/api/v1/companies/e1/finance/titles",{
 method:"POST",headers:{origin:A1_HML_ORIGIN,"content-type":"application/json",
 "x-lunaris-synthetic-only":"confirmed",...header},body:JSON.stringify(body)
});
const item=(intentId="a2-test-guard-1",o={})=>({intentId,beneficiario:"TESTE - Conta",
 categoriaDespesa:"TESTE - Despesa",valorCent:1800,
 vencimento:"2030-03-03",...o});
test("A2 HML: todas as cinco F3-F7 só ligam com host e flags exatas",()=>{
 for(const phase of ["F3","F4","F5","F6","F7"]){
  assert.equal(a2RuntimeMode(req(),env,phase),"hml");
  for(const url of ["https://licita-production.invalid",
   "http://licita-hml.invalid","https://licita-hml.invalid:8443",
   "https://outro.lunaris.dev.br"]){
   assert.equal(a2RuntimeMode(req(url),env,phase),null,url);
  }
  for(const extra of [{DB:{}},{A1_HML_STAGE:"invalid"},{A2_HML_STAGE:"prod"},
   {A2_HML_ENABLED:"all"},{A2_HML_SCOPE:"prod"},
   {F1_RUNTIME_ENABLED:"test_local_only"},
   {F8_RUNTIME_ENABLED:"test_local_only"},{R7_RUNTIME_ENABLED:"test_local_only"},
   {GEMINI_API_KEY:"SECRET"},{R2:{}}]){
   assert.equal(a2RuntimeMode(req(),{...env,...extra},phase),null,JSON.stringify(extra));
  }
 }
 assert.equal(a2RuntimeMode(req(),env,"F8"),null);
});
test("A2 HML: local Workerd F3-F7 mantém compatibilidade com flags antigas",()=>{
 for(const phase of ["F3","F4","F5","F6","F7"]){
  assert.equal(a2RuntimeMode(req("https://licita.local.test"),
   {DB:db,F1_RUNTIME_ENABLED:"test_local_only",
    [phase+"_RUNTIME_ENABLED"]:"test_local_only"},phase),"local");
 }
});
test("A2 HML: empresa e base devem ser inteiramente fictícias",async()=>{
 const fakeDb=(violated)=>({prepare(sql){return{bind(){return{first:async()=>{
  if(sql.includes("FROM empresas"))return {nome:"TESTE - Empresa Aurora",
   documento_identificacao:violated==="identifier"?"123":null};
  if(violated==="email"&&sql.includes("FROM fornecedores")&&sql.includes("email"))
   return {bad:1};
  if(violated==="legacy"&&sql.includes("FROM titulos_pagar")&&sql.includes("origem_dado"))
   return {bad:1};
  return null;
 }}}}}});
 assert.equal(await a2CompanyIsSynthetic(fakeDb(), "e1"),true);
 for(const issue of ["identifier","email","legacy"])
  assert.equal(await a2CompanyIsSynthetic(fakeDb(issue),"e1"),false,issue);
});
test("A2 HML: toda mutação precisa de intenção TESTE, Origin e declaração sintética",async()=>{
 assert.equal(await a2ValidateSyntheticMutation(request(item())),true);
 for(const q of [item("wrong-id"),item("a2-test-bad-name",{beneficiario:"Pessoa Real"}),
  item("a2-test-bad-email",{email:"someone@example.org"}),
  item("a2-test-bad-num",{valorCent:10000001}),
  item("a2-test-bad-url",{descricao:"https://evil.example"}),
  item("a2-test-bad-phone",{telefone:"11999999999"})]){
  assert.equal(await a2ValidateSyntheticMutation(request(q)),false);
 }
 for(const headers of [{origin:"https://evil.example"},
  {"x-lunaris-synthetic-only":"no"},{"content-type":"text/plain"}]){
  assert.equal(await a2ValidateSyntheticMutation(request(item(),headers)),false);
 }
});
