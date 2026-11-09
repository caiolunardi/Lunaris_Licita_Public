import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, webcrypto } from "node:crypto";
import { createR7Handler } from "../src/r7/http.mjs";
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const { publicKey, privateKey }=generateKeyPairSync("rsa",{modulusLength:2048});
const issuer="https://r7-http-test.cloudflareaccess.com",aud="r7-app-unique";
const jwk={...publicKey.export({format:"jwk"}),alg:"RS256",kid:"r7-http-key",use:"sig"};
const b64=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
function jwt(overrides={}){
  const date=Math.floor(Date.now()/1000);
  const h=b64({alg:"RS256",kid:"r7-http-key",typ:"JWT"});
  const p=b64({iss:issuer,aud:[aud],sub:"http-user",exp:date+300,iat:date-5,...overrides});
  return h+"."+p+"."+sign("RSA-SHA256",Buffer.from(h+"."+p),privateKey).toString("base64url");
}
const fetchKeys=async()=>new Response(JSON.stringify({keys:[jwk]}));
const handler=createR7Handler({fetchKeys});
const appOrigin="https://licita.local.test";
function mockDB(member={usuario_id:"uid1",papel:"OPERADOR"},batchResult) {
  const queries=[]; let batchCalls=0;
  const db={
    queries,
    prepare(sql){
      const item={sql,args:[]};queries.push(item);
      return {bind(...args){
        item.args=args;
        return {
          first:async()=>sql.includes("JOIN usuarios_empresas")?member:null,
          all:async()=>({results:[{id:"t1",situacao:"ABERTO",valor_nominal_cent:10000,
                                   vencimento:"2026-11-08"}]})
        };
      }};
    },
    batch:async()=>{batchCalls++;return batchResult||[
      {meta:{changes:1}},{meta:{changes:1}}
    ];},
    get batchCalls(){return batchCalls;}
  };
  return db;
}
function env(db=mockDB(),ext={}) {
  return {DB:db,R7_RUNTIME_ENABLED:"test_local_only",ACCESS_TEAM_DOMAIN:issuer,
    ACCESS_AUD:aud,APP_ORIGIN:appOrigin,...ext};
}
function req(path,method="GET",body=null,overrides={}){
  return new Request("https://licita.local.test"+path,{method,
    headers:{"cf-access-jwt-assertion":jwt(),
       ...(method==="POST"?{"origin":appOrigin,"content-type":"application/json"}:{}),
       ...overrides},
    ...(body!==null?{body:typeof body==="string"?body:JSON.stringify(body)}:{})
  });
}
const credit=()=>({intentId:"r7-http-credit",contaReceberId:"cr1",
 valorRecebidoCent:1000,retencaoConfirmadaCent:0,
 dataCredito:"2026-11-07",contaDestino:"BB",referenciaExterna:"PIX-001"});
const note=()=>({intentId:"r7-http-note",tituloId:"t1",
 expectedVersion:1,observacoes:"teste"});
test("HTTP R7 fechado em producao mesmo com token valido",async()=>{
  const response=await handler(req("/r7/companies/e1/titles"),env(mockDB(),
                             {R7_RUNTIME_ENABLED:""}));
  assert.equal(response.status,503);
});
test("HTTP GET requer token Access real, nao confia em email header",async()=>{
  const db=mockDB();
  const request=new Request("https://licita.local.test/r7/companies/e1/titles",
    {headers:{"x-email":"admin@example.test"}});
  const response=await handler(request,env(db));
  assert.equal(response.status,401);
  assert.equal(db.queries.length,0);
});
test("HTTP GET token alterado nao pode consultar empresa",async()=>{
  const db=mockDB();
  const request=req("/r7/companies/e1/titles");
  request.headers.set("cf-access-jwt-assertion",jwt({aud:["unexpected"]}));
  const response=await handler(request,env(db));
  assert.equal(response.status,401);
  assert.equal(db.queries.length,0);
});
test("HTTP consulta de empresa autorizada retorna so titulos escopados",async()=>{
  const db=mockDB({usuario_id:"uid1",papel:"CONSULTA"});
  const response=await handler(req("/r7/companies/e1/titles"),env(db));
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.titulos[0].id,"t1");
  assert.match(db.queries[2].sql,/WHERE empresa_id=\?/);
  assert.deepEqual(db.queries[2].args,["e1","uid1"]);
  assert.equal(response.headers.get("cache-control"),"no-store, private");
  assert.equal(response.headers.get("x-frame-options"),"DENY");
});
test("HTTP nao retorna titulos de empresa sem membership",async()=>{
  const db=mockDB(null);
  const response=await handler(req("/r7/companies/e2/titles"),env(db));
  assert.equal(response.status,403);
  assert.equal(db.queries.length,2);
});
test("HTTP CONSULTA nao registra credito",async()=>{
  const db=mockDB({usuario_id:"uid1",papel:"CONSULTA"});
  const response=await handler(req("/r7/companies/e1/credits","POST",credit()),env(db));
  assert.equal(response.status,403);
  assert.equal(db.batchCalls,0);
});
test("HTTP credito valido gera 201 e batch com identidade SQL",async()=>{
  const db=mockDB();
  const response=await handler(req("/r7/companies/e1/credits","POST",credit()),env(db));
  assert.equal(response.status,201);
  const body=await response.json();
  assert.equal(body.replayed,false);
  assert.equal(db.batchCalls,1);
  assert.ok(db.queries.some(q=>q.sql.includes("JOIN usuarios_empresas")));
  assert.ok(db.queries.some(q=>q.sql.includes("FROM contas_receber c")));
});
test("HTTP titulo CAS valido usa versao e gera 201",async()=>{
  const db=mockDB();
  const response=await handler(req("/r7/companies/e1/titles/observations","POST",note()),env(db));
  assert.equal(response.status,201);
  const body=await response.json();
  assert.equal(body.newVersion,2);
  assert.equal(db.batchCalls,1);
});
test("HTTP token e conta valida nao substituem CSRF origin",async()=>{
  const db=mockDB();
  const response=await handler(req("/r7/companies/e1/credits","POST",credit(),
                                   {"origin":"https://evil.example"}),env(db));
  assert.equal(response.status,403);
  assert.equal(db.queries.length,0);
  assert.equal(db.batchCalls,0);
});
test("HTTP POST sem configuracao de origin falha fechado",async()=>{
  const db=mockDB();
  const response=await handler(req("/r7/companies/e1/credits","POST",credit()),
    env(db,{APP_ORIGIN:null}));
  assert.equal(response.status,503);
});
test("HTTP rejeita content-type que permite CSRF simples",async()=>{
  const db=mockDB();
  const response=await handler(req("/r7/companies/e1/credits","POST",credit(),
                                   {"content-type":"text/plain"}),env(db));
  assert.equal(response.status,415);
  assert.equal(db.batchCalls,0);
});
test("HTTP payload maior que 16k nunca executa creditos",async()=>{
  const db=mockDB();
  const response=await handler(req("/r7/companies/e1/credits","POST",
    {...credit(),valor_extra:"x".repeat(20000)}),env(db));
  assert.equal(response.status,413);
  assert.equal(db.batchCalls,0);
});
test("HTTP JSON malformado nao vira erro 500 nem grava",async()=>{
  const db=mockDB();
  const response=await handler(req("/r7/companies/e1/credits","POST","{"),
    env(db));
  assert.equal(response.status,400);
  assert.equal(db.batchCalls,0);
});
test("HTTP id de empresa forjado no body rejeitado",async()=>{
  const db=mockDB();
  const response=await handler(req("/r7/companies/e1/credits","POST",
    {...credit(),empresa_id:"e2"}),env(db));
  assert.equal(response.status,400);
  assert.equal(db.batchCalls,0);
});
test("HTTP path que tenta codigo de importacao nao responde",async()=>{
  const db=mockDB();
  const response=await handler(req("/r7/companies/e1/import-legacy","POST",
                                  credit()),env(db));
  assert.equal(response.status,404);
  assert.equal(db.queries.length,0);
});
test("HTTP sem DB ou sem runtime explicitamente local nunca abre API",async()=>{
  const db=mockDB();
  const response=await handler(req("/r7/companies/e1/titles"),env(db,{DB:null}));
  assert.equal(response.status,503);
});
test("HTTP sem GET/POST permitido nao cria efeito colateral",async()=>{
  const db=mockDB();
  const request=new Request("https://licita.local.test/r7/companies/e1/titles",
    {method:"DELETE",headers:{"cf-access-jwt-assertion":jwt()}});
  const response=await handler(request,env(db));
  assert.equal(response.status,404);
  assert.equal(db.queries.length,0);
});
test("HTTP nao devolve SQL ou segredo ao cliente em erro inesperado",async()=>{
  const db=mockDB();
  db.prepare=()=>{throw Error("SQLITE secret-stack");};
  const response=await handler(req("/r7/companies/e1/titles"),env(db));
  assert.equal(response.status,500);
  const text=await response.text();
  assert.doesNotMatch(text,/secret-stack|SQLITE/);
});
