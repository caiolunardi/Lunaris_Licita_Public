// F1: valida GET de identidade, ACL, revogação e negativa em Workerd + D1 real LOCAL.
import test, {before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createF1Handler} from "../ui/worker/f1-identity.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const issuer="https://f1-only-local.cloudflareaccess.com";
const aud="f1-local-audience";
const origin="https://licita.local.test";
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),kid:"f1-only-local-key",alg:"RS256",use:"sig"};
const migrationFiles=[
  "0001_ddl_v1.sql","0002_ddl_v1r_r4.sql","0003_ddl_v1r_r5.sql",
  "0004_ddl_v1r_r6.sql","0005_ddl_v1r_r7_w1.sql",
  "0006_ddl_v1r_r7_quantidades.sql","0007_ddl_v1r_r7_etapa1.sql",
  "0008_ddl_v1r_r7_etapa2_guardas.sql","0009_ddl_v1r_r7_etapa2_retificacoes.sql",
  "0010_ddl_v1r_r7_etapa2_retencao_strict.sql",
  "0011_ddl_v1r_r7_etapa2_ciclos_workerd.sql",
  "0012_ddl_v1r_r7_etapa3_iam.sql","0013_ddl_v1r_r7_etapa4_backup_ledger.sql"
];
function signedToken(claims={},signatureValid=true) {
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:"RS256",kid:jwk.kid,typ:"JWT"})).toString("base64url");
  const payload=Buffer.from(JSON.stringify({
    iss:issuer,aud:[aud],sub:"user-A",iat:now-10,exp:now+600,...claims
  })).toString("base64url");
  const data=header+"."+payload;
  const signature=sign("RSA-SHA256",Buffer.from(data),privateKey).toString("base64url");
  return data+"."+(signatureValid?signature:signature.slice(0,-2)+"ab");
}
const localUuid="10000000-0000-4000-8000-000000000001";
let mf,db;
async function call(path,method="GET",body,options={}) {
  const headers={
    "cf-access-jwt-assertion": options.token??signedToken(),
    ...method==="POST"?{"origin":origin,"content-type":"application/json"}:{},
    ...(options.headers||{})
  };
  const init={method,headers};
  if(method==="POST")init.body=typeof body==="string"?body:JSON.stringify(body);
  return mf.dispatchFetch(origin+path,init);
}
function splitSQL(sql){
  const script=[
    "import sqlite3, json, sys",
    "s=''; a=[]",
    "for line in sys.stdin:",
    "  if line.lstrip().startswith('--'): continue",
    "  s+=line",
    "  if sqlite3.complete_statement(s.strip()):",
    "    a.append(s.strip());s=''",
    "if s.strip(): raise RuntimeError('SQL INCOMPLETO')",
    "print(json.dumps(a))"
  ].join("\n");
  return JSON.parse(execFileSync("python3",["-c",script],{input:sql,encoding:"utf8",maxBuffer:8*1024*1024}));
}
before(async()=>{
  mf=new Miniflare({
    scriptPath:"web/ui/worker/test-local-entry.mjs",modules:true,
    modulesRules:[{type:"ESModule",include:["**/*.mjs"]}],
    compatibilityDate:"2026-08-06",cf:false,
    d1Databases:{DB:localUuid},
    bindings:{
      F1_RUNTIME_ENABLED:"test_local_only", F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
      ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:aud,APP_ORIGIN:origin
    }
  });
  db=await mf.getD1Database("DB");
  for(const name of migrationFiles){
    const statements=splitSQL(readFileSync("migrations/"+name,"utf8"));
    for(let i=0;i<statements.length;i++){
      try{await db.prepare(statements[i]).run();}
      catch(e){throw Error("Migration "+name+" #"+i+": "+String(e));}
    }
  }
  for(const sql of [
    "INSERT INTO empresas(id,nome,ativo) VALUES ('e1','Empresa Azul',1),('e2','Empresa Verde',1),('e3','Empresa Bloqueada',0)",
    "INSERT INTO usuarios(id,access_issuer,access_subject,email_normalizado,nome,ativo) VALUES ('uA','"+issuer+"','user-A','a@invalid.test','Pessoa A',1),('uB','"+issuer+"','user-B','b@invalid.test','Pessoa B',1),('uC','"+issuer+"','user-C','c@invalid.test','Sem Empresa',1),('uD','"+issuer+"','user-D','d@invalid.test','Inativo',0)",
    "INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) VALUES ('uA','e1','OPERADOR',1),('uA','e2','CONSULTA',1),('uB','e2','ADMIN',1),('uB','e1','CONSULTA',0),('uA','e3','ADMIN',1)"
  ])await db.prepare(sql).run();
});
after(async()=>{await mf?.dispose();});

test("F1 fail-closed quando backend remoto não está autorizado",async()=>{
  const handler=createF1Handler({fetchKeys:async()=>new Response(JSON.stringify({keys:[jwk]}))});
  const r=await handler(new Request(origin+"/api/v1/me",{headers:{"cf-access-jwt-assertion":signedToken()}}),{});
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{error:"f1_not_enabled"});
});
test("F1 bloqueia hostname remoto mesmo que alguém injete flag local",async()=>{
  const r=await mf.dispatchFetch("https://licita.lunaris.dev.br/api/v1/me",{
    method:"GET",headers:{"cf-access-jwt-assertion":signedToken()}
  });
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{error:"f1_not_enabled"});
});
test("F1 health não declara conexão operacional",async()=>{
  const r=await call("/health");
  assert.equal(r.status,200);
  assert.equal((await r.json()).connected,false);
});
test("F1 sem JWT não revela perfil, empresa nem autorização",async()=>{
  for(const path of ["/api/v1/me","/api/v1/companies","/api/v1/companies/e1/context"]){
    const r=await call(path,"GET",null,{token:""});
    assert.equal(r.status,401,path);
    assert.equal((await r.json()).error,"access_token_required");
  }
});
test("F1 JWT válido apresenta somente usuário ativo do banco",async()=>{
  const r=await call("/api/v1/me");
  assert.equal(r.status,200);
  assert.equal(r.headers.get("cache-control"),"private, no-store, max-age=0");
  assert.deepEqual((await r.json()).user,{id:"uA",name:"Pessoa A",email:"a@invalid.test"});
});
test("F1 lista somente empresas ativas e memberships ativos",async()=>{
  const r=await call("/api/v1/companies");
  assert.equal(r.status,200);
  assert.deepEqual((await r.json()).companies,[
    {id:"e1",name:"Empresa Azul",role:"OPERADOR"},
    {id:"e2",name:"Empresa Verde",role:"CONSULTA"}
  ]);
});
test("F1 permissions são derivadas no servidor e variam por empresa",async()=>{
  const a=await call("/api/v1/companies/e1/context");
  const b=await call("/api/v1/companies/e2/context");
  assert.deepEqual((await a.json()).permissions,{canRead:true,canWrite:true,canApprove:false});
  assert.deepEqual((await b.json()).permissions,{canRead:true,canWrite:false,canApprove:false});
  const admin=await call("/api/v1/companies/e2/context","GET",undefined,{token:signedToken({sub:"user-B"})});
  assert.equal(admin.status,200);
  assert.equal((await admin.json()).permissions.canApprove,true);
});
test("F1 rejeita tenant inativo, membership revogado e usuário sem vínculo",async()=>{
  assert.equal((await call("/api/v1/companies/e3/context")).status,403);
  assert.equal((await call("/api/v1/companies/e1/context","GET",undefined,{token:signedToken({sub:"user-B"})})).status,403);
  const empty=await call("/api/v1/companies","GET",undefined,{token:signedToken({sub:"user-C"})});
  assert.equal(empty.status,200);
  assert.deepEqual((await empty.json()).companies,[]);
});
test("F1 rejeita usuário inativo, não cadastrado e cabeçalhos forjados",async()=>{
  for(const sub of ["user-D","not-registered"]){
    const r=await call("/api/v1/me","GET",null,{token:signedToken({sub}),headers:{"x-user":"uA","x-company":"e1"}});
    assert.equal(r.status,403);
  }
});
test("F1 assinatura, emissor, audiência e expiração inválidos dão 401",async()=>{
  for(const [label,token] of [
    ["assinatura",signedToken({},false)],
    ["emissor",signedToken({iss:"https://outro.cloudflareaccess.com"})],
    ["aud",signedToken({aud:["outro-app"]})],
    ["expiração",signedToken({exp:Math.floor(Date.now()/1000)-1})]
  ]){
    const r=await call("/api/v1/me","GET",null,{token});
    assert.equal(r.status,401,label);
  }
});
test("F1 não permite API desconhecida nem métodos inseguros",async()=>{
  assert.equal((await call("/api/v1/boletos")).status,404);
  assert.equal((await call("/api/v1/me","DELETE")).status,405);
  assert.equal((await call("/api/v1/companies/e1/context","POST",{})).status,405);
});
test("F1 logout recusa Origin falso, empresa não autorizada e payload extra",async()=>{
  const body={companyId:"e1",intentId:"f1-logout-a"};
  assert.equal((await call("/api/v1/session/logout","POST",body,{headers:{origin:"https://outro.example"}})).status,403);
  assert.equal((await call("/api/v1/session/logout","POST",{...body,companyId:"e3"})).status,403);
  assert.equal((await call("/api/v1/session/logout","POST",{...body,ator_id:"uB"})).status,400);
});
test("F1 revogação R7 real local bloqueia qualquer empresa no mesmo token",async()=>{
  const token=signedToken();
  const beforeLogout=await call("/api/v1/me","GET",undefined,{token});
  assert.equal(beforeLogout.status,200);
  const r=await call("/api/v1/session/logout","POST",
    {companyId:"e1",intentId:"f1-logout-ok"},{token});
  assert.equal(r.status,200,await r.text());
  assert.deepEqual(JSON.parse(await (await call("/api/v1/me","GET",undefined,{token})).text()),{error:"session_revoked"});
  const deny=await call("/api/v1/companies/e2/context","GET",undefined,{token});
  assert.equal(deny.status,401);
  const rows=await db.prepare("SELECT token_sha256 FROM r7_sessoes_revogadas").all();
  assert.equal(rows.results.length,1);
  assert.match(rows.results[0].token_sha256,/^[a-f0-9]{64}$/);
});
