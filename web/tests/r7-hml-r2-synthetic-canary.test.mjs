import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import worker from "../src/hml/r2-synthetic-canary.mjs";
const base="https://hml.invalid",url=base+"/__hml/r2-prova";
const ctx={access:{async getIdentity(){return {email:"tester@example.invalid"};}}};
function fixture({corrupt=false,deleteFails=false,writeFails=false}={}){
  const items=new Map(),ops=[];
  const R2={
    async put(key,bytes){ops.push(["put",key]);if(writeFails)throw Error("fail");
      items.set(key,Uint8Array.from(bytes));return {key};},
    async get(key){ops.push(["get",key]);if(!items.has(key))return null;
      return {async arrayBuffer(){const b=Uint8Array.from(items.get(key));
        if(corrupt)b[0]^=255;return b.buffer;}};},
    async delete(key){ops.push(["delete",key]);if(deleteFails)throw Error("fail");items.delete(key);}
  };
  const env=new Proxy({R2},{get(o,k){if(k!=="R2")throw Error("forbidden binding");return o[k];}});
  return {env,items,ops};
}
const req=(path=url,method="GET",origin=base)=>new Request(path,{
  method,headers:method==="POST"?{origin}:{}
});
test("R2 HML: GET sem mutacao; outras rotas 503",async()=>{
  const x=fixture();
  const a=await worker.fetch(req(base+"/api/boletos"),x.env,ctx);
  assert.equal(a.status,503);assert.deepEqual(await a.json(),{error:"hml_not_ready"});
  const page=await worker.fetch(req(),x.env,ctx);
  assert.equal(page.status,200);
  assert.equal(page.headers.get("referrer-policy"),"same-origin");
  assert.match(await page.text(),/method="post"/);
  assert.equal(x.ops.length,0);
  const head=await worker.fetch(req(base+"/","HEAD"),x.env,ctx);
  assert.equal(head.status,503);assert.equal(await head.text(),"");
});
test("R2 HML: acesso forjado e Origin externa sem escrita",async()=>{
  const x=fixture();
  for(const [request,identity] of [
    [req(),{}],
    [new Request(url,{headers:{"cf-access-jwt-assertion":"fake","x-user-email":"fake@x.invalid"}}),{}],
    [req(url,"POST","https://evil.invalid"),ctx],
    [req(url,"POST","null"),ctx],
    [new Request(url,{method:"POST"}),ctx],
    [req(url,"POST"),{access:{async getIdentity(){return {};}}}]
  ])assert.equal((await worker.fetch(request,x.env,identity)).status,403);
  assert.equal(x.ops.length,0);
});
test("R2 HML: grava, confere SHA/bytes, exclui e confirma ausente",async()=>{
  const x=fixture();const r=await worker.fetch(req(url,"POST"),x.env,ctx);
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{
    storage:"lunaris-licita-hml-anexos",mode:"synthetic_ephemeral_write_read_delete",
    bytes_verified:true,sha256_verified:true,cleanup:"confirmed"
  });
  assert.equal(x.items.size,0);
  const key=x.ops.find(o=>o[0]==="put")?.[1];
  assert.match(key,/^__licita_hml_prova_r2_v1\/[a-f0-9-]{36}$/);
  assert.equal(x.ops.filter(o=>o[0]==="delete"&&o[1]===key).length,1);
  assert.equal(x.ops.filter(o=>o[0]==="get"&&o[1]===key).length,2);
});
test("R2 HML: corrupção/erro de escrita falham fechado com limpeza",async()=>{
  for(const option of [{corrupt:true},{writeFails:true}]){
    const x=fixture(option);
    const r=await worker.fetch(req(url,"POST"),x.env,ctx);
    assert.equal(r.status,503);
    assert.deepEqual(await r.json(),{error:"r2_verification_failed",cleanup:"confirmed"});
    assert.equal(x.items.size,0);
  }
});
test("R2 HML: falha no delete nunca informa sucesso",async()=>{
  const x=fixture({deleteFails:true}),r=await worker.fetch(req(url,"POST"),x.env,ctx);
  assert.equal(r.status,503);
  const b=await r.json();assert.equal(b.error,"r2_cleanup_unverified");
  assert.match(b.cleanup_key,/^__licita_hml_prova_r2_v1\//);assert.equal(x.items.size,1);
});
test("R2 HML: bundle de CI somente offline e nome nao-produtivo",()=>{
  const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
  const cfg=JSON.parse(read("tests/wrangler-hml-r2-canary.jsonc"));
  const prod=JSON.parse(read("wrangler.jsonc")),hml=JSON.parse(read("wrangler.hml.jsonc"));
  assert.equal(cfg.name,"lunaris-licita-hml-r2-canary-offline");
  assert.equal(cfg.main,"../web/src/hml/r2-synthetic-canary.mjs");
  assert.equal(cfg.r2_buckets[0].bucket_name,"synthetic-hml-r2-no-deploy");
  assert.equal(cfg.workers_dev,false);assert.equal(cfg.preview_urls,false);
  assert.equal(cfg.d1_databases,undefined);
  assert.equal(prod.name,"lunaris-licita");
  assert.equal(hml.main,"./web/src/hml/index.mjs");
});
