import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import worker from "../src/hml/d1-transaction-canary.mjs";
const origin="https://hml.invalid",url=origin+"/__hml/d1-transacoes";
const ctx={access:{async getIdentity(){return {email:"tester@example.invalid"}}}};
const req=(path=url,method="GET",from=origin)=>new Request(path,{
 method,headers:method==="POST"?{origin:from}:{}
});
function mock({empty=true,rollback=true,integrity=true,leftover=false,wrongError=false}={}){
 const sent=[],queries=[],calls=[];
 const db={
  prepare(sql){
   queries.push(sql);
   return {
    bind(...values){
     const o={sql,values};
     return {
      async first(){
       if(sql.startsWith("SELECT (SELECT COUNT(*) FROM empresas)")){
        const n=empty?0:1;return {empresas:n,usuarios:n,titulos:n,baixas:n,operacoes:n}
       }
       if(sql.startsWith("SELECT (SELECT COUNT(*) FROM empresas WHERE")){
        const n=leftover?1:0;return {empresas:n,usuarios:n,titulos:n,baixas:n}
       }
       throw Error("unexpected first");
      },
      ...o
     };
    },
    async first(){
     if(sql.startsWith("SELECT (SELECT COUNT(*) FROM empresas)")){
      const n=empty?0:1;return {empresas:n,usuarios:n,titulos:n,baixas:n,operacoes:n}
     }
     throw Error("unexpected first");
    },
    async all(){if(sql==="PRAGMA foreign_key_check;")return {success:true,
      results:integrity?[]:[{table:"x"}]};throw Error("unexpected all")}
   };
  },
  async batch(stmts){
   sent.push(stmts);
   if(rollback)throw Error(wrongError?"D1_ERROR: service unavailable":(
     stmts.at(-1).sql.includes("titulo_baixas")
      ?"D1_ERROR: FOREIGN KEY constraint failed"
      :"D1_ERROR: R4: REPLACE nao pode substituir historico"));
   return stmts.map(()=>({meta:{changes:1}}));
  }
 };
 const env=new Proxy({DB:db},{get(o,k){
  if(k!=="DB")throw Error("forbidden binding read: "+String(k));
  return o[k];
 }});
 return {env,sent,queries,calls};
}
test("transacoes HML: todas as rotas comuns 503 e GET nao altera D1",async()=>{
 const m=mock();
 const off=await worker.fetch(req(origin+"/api/boletos"),m.env,ctx);
 assert.equal(off.status,503);assert.deepEqual(await off.json(),{error:"hml_not_ready"});
 const get=await worker.fetch(req(),m.env,ctx);
 assert.equal(get.status,200);
 assert.equal(get.headers.get("referrer-policy"),"same-origin");
 assert.match(await get.text(),/method="post"/);
 assert.equal(m.queries.length,0);assert.equal(m.sent.length,0);
});
test("transacoes HML: origem externa/null/ausente e headers forjados nao acionam DB",async()=>{
 const m=mock();
 for(const [request,identity] of [
  [req(),{}],
  [new Request(url,{headers:{"cf-access-jwt-assertion":"fake"}}),{}],
  [req(url,"POST","https://evil.invalid"),ctx],
  [req(url,"POST","null"),ctx],
  [new Request(url,{method:"POST"}),ctx],
  [req(url,"POST"),{access:{async getIdentity(){return {}}}}]
 ]){
  const r=await worker.fetch(request,m.env,identity);
  assert.equal(r.status,403);
 }
 assert.equal(m.queries.length,0);assert.equal(m.sent.length,0);
});
test("transacoes HML: duas falhas deliberadas e rollback sem resíduos",async()=>{
 const m=mock();
 const r=await worker.fetch(req(url,"POST"),m.env,ctx);
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{
  database:"lunaris-licita-hml",mode:"synthetic_rollback_only",
  tenant_fk:"rejected",duplicate_key:"rejected",
  atomic_rollback:"verified",business_data:"empty"
 });
 assert.equal(m.sent.length,2);
 for(const batch of m.sent){
  assert.equal(batch.length,6);
  assert.ok(batch.every(s=>s.sql.startsWith("INSERT INTO ")));
  assert.ok(batch.every(s=>!/\bDELETE\b|\bUPDATE\b|\bDROP\b|\bCREATE\b/i.test(s.sql)));
  assert.ok(batch.every(s=>s.values.every(v=>typeof v!=="string"||!v.includes("main"))));
 }
 assert.equal(m.sent[0][5].sql.includes("titulo_baixas"),true);
 assert.equal(m.sent[1][5].sql.includes("titulos_pagar"),true);
 assert.ok(m.queries.some(x=>x==="PRAGMA foreign_key_check;"));
});
test("transacoes HML: respostas fail-closed se banco sujo, drift ou rollback falho",async()=>{
 for(const flags of [
  {empty:false},{integrity:false},{rollback:false},{leftover:true},{wrongError:true}
 ]){
  const m=mock(flags);
  const r=await worker.fetch(req(url,"POST"),m.env,ctx);
  assert.equal(r.status,503,JSON.stringify(flags));
  const body=await r.json();assert.ok(body.error);
 }
 const absent=await worker.fetch(req(url,"POST"),{},ctx);
 assert.equal(absent.status,503);
});
test("transacoes HML: manifesto offline nao contem D1 real ou Worker produtivo",()=>{
 const read=x=>readFileSync(new URL("../../"+x,import.meta.url),"utf8");
 const manifest=JSON.parse(read("tests/wrangler-hml-transaction-canary.jsonc"));
 const prod=JSON.parse(read("wrangler.jsonc"));
 assert.equal(manifest.name,"lunaris-licita-hml-transactions-offline");
 assert.equal(manifest.main,"../web/src/hml/d1-transaction-canary.mjs");
 assert.equal(manifest.d1_databases[0].database_name,"lunaris-licita-hml");
 assert.equal(manifest.d1_databases[0].database_id,"00000000-0000-4000-8000-000000000000");
 assert.equal(manifest.workers_dev,false);
 assert.equal(manifest.preview_urls,false);
 assert.equal(prod.name,"lunaris-licita-lab");
});
