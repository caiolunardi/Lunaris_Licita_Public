import test from "node:test";
import assert from "node:assert/strict";
import {createA2UiHandler} from "../src/hml/a2-ui-entry.mjs";
import {A1_HML_ORIGIN} from "../ui/worker/a1-runtime-gate.mjs";
import {A2_HML_ENABLED,A2_HML_STAGE,A2_HML_SCOPE}
 from "../ui/worker/a2-runtime-gate.mjs";

const makeEnv=()=>({
 DB:{prepare(){return {bind(){return {first:async()=>null,all:async()=>({results:[]})}}}},batch:async()=>[]},
 A1_HML_ORIGIN,APP_ORIGIN:A1_HML_ORIGIN,A1_HML_STAGE:"a1_hml_synthetic_only",
 A1_HML_ENABLED:"f1_f2_only",A2_HML_ENABLED,A2_HML_STAGE,A2_HML_SCOPE,
 ASSETS:{fetch:async(request)=>new Response(request.url.includes("/assets/")?"console.log(1)":"<html></html>",
  {status:200,headers:{"content-type":request.url.includes("/assets/")?
   "application/javascript":"text/html"}})}
});
test("A2 HML UI serves finance and F1/F2 but never F8/F10",async()=>{
 const worker=createA2UiHandler(),env=makeEnv();
 for(const pathname of ["/identidade","/fornecedores","/financeiro","/contas-pagar",
  "/recorrencias","/licitacoes","/empenhos","/compras","/envios","/notas-fiscais","/contas-receber"]){
  const r=await worker(new Request(A1_HML_ORIGIN+pathname),env);
  assert.equal(r.status,200,pathname);
  assert.equal(r.headers.get("cache-control"),"private, no-store, max-age=0");
 }
 for(const pathname of ["/documentos","/cotacoes","/notificacoes","/gabi","/__hml/d1",
  "/api/v1/companies/a/documents"]){
  const r=await worker(new Request(A1_HML_ORIGIN+pathname),env);
  assert.equal(r.status,503,pathname);
 }
 assert.equal((await worker(new Request(A1_HML_ORIGIN+"/"),env)).status,302);
});
test("A2 static routing is strict and forbids cross-host and HTML-as-JS",async()=>{
 const worker=createA2UiHandler(),env=makeEnv();
 assert.equal((await worker(new Request(A1_HML_ORIGIN+"/assets/app.js"),env)).status,200);
 assert.equal((await worker(new Request("https://different.invalid/financeiro"),env)).status,503);
 assert.equal((await worker(new Request(A1_HML_ORIGIN+"/financeiro",{method:"POST"}),env)).status,503);
 const bad={...env,ASSETS:{fetch:async()=>new Response("<html>fallback</html>",{
  status:200,headers:{"content-type":"text/html"}})}};
 assert.equal((await worker(new Request(A1_HML_ORIGIN+"/assets/no.js"),bad)).status,503);
});
test("A2 remains closed without stage flags, D1 binding or with R2",async()=>{
 const worker=createA2UiHandler();
 for(const override of [
  {A2_HML_ENABLED:undefined},{DB:undefined},{R2:{put(){}}},
  {A1_HML_ORIGIN:"https://wrong.invalid"}
 ]){
  const env={...makeEnv(),...override};
  assert.equal((await worker(new Request(A1_HML_ORIGIN+"/financeiro"),env)).status,503);
 }
});
