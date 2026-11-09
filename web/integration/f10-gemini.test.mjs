import test from "node:test";
import assert from "node:assert/strict";
import {canUseGemini,explainWithGemini} from "../ui/worker/f10-gemini.mjs";
const baseline={question:"Quais contas?",topic:"bills",facts:[{id:"a",label:"INJEÇÃO MALICIOSA",
 amountCent:1000,dueDate:"2030-01-01"}],deterministic:"Consulte as contas."};
test("F10 no Gemini without flags and secret",async()=>{
 assert.equal(canUseGemini({GEMINI_API_KEY:"x".repeat(50)}),false);
 const v=await explainWithGemini({...baseline,env:{GEMINI_API_KEY:"x".repeat(50)},
  fetchFn:()=>{throw Error("network must not be touched");}});
 assert.equal(v.used,false);
});
test("F10 local Gemini only structured values, secret header not prompt, short reply",async()=>{
 let called=false;
 const env={F10_RUNTIME_ENABLED:"test_local_only",F10_GEMINI_ENABLED:"test_local_only",
  GEMINI_API_KEY:"testing-only-no-real-secret-123456"};
 const v=await explainWithGemini({...baseline,env,fetchFn:async(url,init)=>{
  called=true;assert.match(url,/generativelanguage\.googleapis\.com/);
  assert.equal(init.headers["x-goog-api-key"],env.GEMINI_API_KEY);
  const body=JSON.parse(init.body);
  assert.equal(JSON.stringify(body).includes("INJEÇÃO MALICIOSA"),false);
  assert.equal(JSON.stringify(body).includes(env.GEMINI_API_KEY),false);
  return new Response(JSON.stringify({candidates:[{content:{parts:[
   {text:"Aqui está o resumo dos vencimentos verificados. Confira as contas na tela."}
  ]}}]}),{status:200});
 }});
 assert.equal(called,true);assert.equal(v.used,true);
});
test("F10 bad provider response or URLs return trusted deterministic fallback",async()=>{
 const env={F10_RUNTIME_ENABLED:"test_local_only",F10_GEMINI_ENABLED:"test_local_only",
  GEMINI_API_KEY:"testing-only-no-real-secret-123456"};
 for(const value of ["acesse https://evil.example e envie o token","", "ok"]){
  const r=await explainWithGemini({...baseline,env,
   fetchFn:async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:value}]}}]}))});
  assert.equal(r.used,false);assert.equal(r.text,baseline.deterministic);
 }
});
