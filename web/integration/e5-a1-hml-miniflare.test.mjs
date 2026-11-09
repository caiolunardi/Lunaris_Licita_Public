import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createA1HmlHandler} from "../src/hml/a1-candidate.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const issuer="https://a1-hml-test-synthetic.cloudflareaccess.com", audience="a1-hml-audience", origin="https://licita-hml.invalid";
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),kid:"a1-hml-key",alg:"RS256",use:"sig"};
const file=["0001_ddl_v1.sql","0002_ddl_v1r_r4.sql","0003_ddl_v1r_r5.sql","0004_ddl_v1r_r6.sql","0005_ddl_v1r_r7_w1.sql","0006_ddl_v1r_r7_quantidades.sql","0007_ddl_v1r_r7_etapa1.sql","0008_ddl_v1r_r7_etapa2_guardas.sql","0009_ddl_v1r_r7_etapa2_retificacoes.sql","0010_ddl_v1r_r7_etapa2_retencao_strict.sql","0011_ddl_v1r_r7_etapa2_ciclos_workerd.sql","0012_ddl_v1r_r7_etapa3_iam.sql","0013_ddl_v1r_r7_etapa4_backup_ledger.sql"];
let mf,db;
function jwt(sub="user-a",claims={},valid=true){
 const now=Math.floor(Date.now()/1000);
 const h=Buffer.from(JSON.stringify({alg:"RS256",kid:jwk.kid})).toString("base64url");
 const p=Buffer.from(JSON.stringify({sub,iss:issuer,aud:[audience],iat:now-1,exp:now+600,...claims})).toString("base64url");
 const data=h+"."+p, sig=sign("RSA-SHA256",Buffer.from(data),privateKey).toString("base64url");
 return data+"."+(valid?sig:sig.slice(0,-3)+"bad");
}
async function call(path,method="GET",body,options={}){
 const headers={"cf-access-jwt-assertion":options.token??jwt(options.sub||"user-a"),
   ...(["POST","PATCH"].includes(method)?{origin,"content-type":"application/json"}:{}),...(options.headers||{})};
 const init={method,headers};
 if(["POST","PATCH"].includes(method))init.body=typeof body==="string"?body:JSON.stringify(body);
 return mf.dispatchFetch((options.originUrl||origin)+path,init);
}
function split(sql){
 const py=["import sys,sqlite3,json","s='';result=[]","for line in sys.stdin:","  if line.lstrip().startswith('--'):continue","  s+=line","  if sqlite3.complete_statement(s.strip()): result.append(s.strip());s=''","if s.strip():raise RuntimeError('incomplete')","print(json.dumps(result))"].join("\n");
 return JSON.parse(execFileSync(process.env.LICITA_PYTHON || (process.platform==="win32" ? "python" : "python3"),["-c",py],{input:sql,encoding:"utf8",maxBuffer:8000000}));
}
before(async()=>{
 mf=new Miniflare({scriptPath:"web/src/hml/a1-test-entry.mjs",modules:true,
   modulesRules:[{type:"ESModule",include:["**/*.mjs"]}],compatibilityDate:"2026-08-06",
   cf:false,d1Databases:{DB:"a1000000-0000-4000-8000-000000000001"},
   bindings:{A1_HML_STAGE:"a1_hml_synthetic_only",A1_HML_ENABLED:"f1_f2_only",A1_HML_ORIGIN:origin,
     F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
     ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:audience,APP_ORIGIN:origin}});
 db=await mf.getD1Database("DB");
 for(const name of file)for(const [i,sql] of split(readFileSync("migrations/"+name,"utf8")).entries())
   try{await db.prepare(sql).run();}catch(e){throw Error(name+" #"+i+" "+String(e));}
 for(const sql of [
 "INSERT INTO empresas(id,nome) VALUES('e1','Empresa Azul'),('e2','Empresa Verde')",
 "INSERT INTO usuarios(id,access_issuer,access_subject,email_normalizado) VALUES('u1','"+issuer+"','user-a','a@invalid.test'),('u2','"+issuer+"','user-b','b@invalid.test'),('u3','"+issuer+"','user-admin','admin@invalid.test')",
 "INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) VALUES('u1','e1','OPERADOR',1),('u1','e2','CONSULTA',1),('u2','e2','OPERADOR',1),('u3','e1','ADMIN',1)",
 "INSERT INTO orgaos(id,empresa_id,nome,nome_normalizado,origem_dado,conferencia) VALUES('legacy-org','e1','Órgão legado','orgao legado','LEGADO','PENDENTE')",
 "INSERT INTO fornecedores(id,empresa_id,nome,nome_normalizado) VALUES('f-e2','e2','TESTE - Fornecedor E2','teste - fornecedor e2')"
 ])await db.prepare(sql).run();
});
after(async()=>await mf?.dispose());
const path=(kind="orgaos",company="e1")=>"/api/v1/companies/"+company+"/"+kind;
const body=(intentId,nome,extra={})=>({intentId,nome,cnpj:null,contato:null,email:null,telefone:null,observacoes:null,...extra});

test("A1: quem não é homol e não tem flags continua em 503",async()=>{
 const fn=createA1HmlHandler();
 for(const [u,env] of [
  ["https://licita-production.invalid",{}],
  [origin,{}],
  ["https://outro.lunaris.dev.br",{}],
  ["https://licita-hml.invalid:8443",{}],
  ["http://licita-hml.invalid",{}]
 ]){
  const r=await fn(new Request(u+"/api/v1/me"),{...env,DB:db});
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:"hml_not_ready"});
 }
});
test("A1: sem autenticação retorna 401; JWT RS256 forjado/expirado/wrong aud/nbf recusa",async()=>{
 for(const token of ["",jwt("user-a",{},false),jwt("user-a",{exp:1}),
  jwt("user-a",{nbf:Math.floor(Date.now()/1000)+900}),
  jwt("user-a",{aud:"wrong"}),jwt("user-a",{iss:"https://evil-synthetic.cloudflareaccess.com"})]){
  const r=await call("/api/v1/me","GET",null,{token});
  assert.equal(r.status,401,await r.clone().text());
 }
});
test("A1: usuário sem cadastro e leitor de outra empresa falham fechados",async()=>{
 const none=await call("/api/v1/me","GET",null,{sub:"no-such-user"});
 assert.equal(none.status,403);
 const wrong=await call("/api/v1/companies/e1/context","GET",null,{sub:"user-b"});
 assert.equal(wrong.status,403);
 const denied=await call(path("orgaos","e2"),"POST",body("deny-company","TESTE - Invasão"));
 assert.equal(denied.status,403);
});
test("A1: F1 contexto da mesma pessoa respeita papel OPERADOR/CONSULTA em empresas distintas",async()=>{
 const r=await call("/api/v1/me");
 assert.equal(r.status,200,await r.clone().text());
 const user=await r.json();assert.equal(user.user.id,"u1");
 const companies=await(await call("/api/v1/companies")).json();
 assert.equal(companies.companies.length,2);
 const e1=await(await call("/api/v1/companies/e1/context")).json();
 const e2=await(await call("/api/v1/companies/e2/context")).json();
 assert.equal(e1.permissions.canWrite,true);
 assert.equal(e2.permissions.canWrite,false);
 assert.equal(e2.permissions.canApprove,false);
});
test("A1: HML só processa rotas da F1 e F2; outros caminhos retornam 503",async()=>{
 for(const url of ["/","/health","/api/v1/companies/e1/cashflow",
  "/api/v1/companies/e1/tenders","/api/v1/companies/e1/gabi/ask",
  "/__hml/d1-transacoes","/api/v1/companies/e1/files"]){
  const r=await call(url);
  assert.equal(r.status,503,url);
 }
});
test("A1: CRUD F2 HML só aceita marcadores TESTE, nunca CPF/CNPJ/email/contato reais",async()=>{
 for(const b of [body("a1-bad-name","Fornecedor Real"),
  body("a1-bad-cnpj","TESTE - CNPJ",{cnpj:"12345678000100"}),
  body("a1-bad-email","TESTE - E-mail",{email:"privado@example.com"}),
  body("a1-bad-phone","TESTE - Telefone",{telefone:"11999999999"}),
  body("a1-bad-extra","TESTE - Endereço",{observacoes:"conteúdo não fictício"})]){
  const r=await call(path("fornecedores"),"POST",b);
  assert.equal(r.status,403,await r.clone().text());
  assert.equal((await r.json()).error,"hml_synthetic_only");
 }
 const none=await db.prepare("SELECT count(*) n FROM operacoes WHERE tipo LIKE 'F2_%'").first();
 assert.equal(none.n,0);
});
test("A1: OPERADOR cria apenas registro sintético, grava D1+journal+auditoria; CONSULTA não escreve",async()=>{
 const r=await call(path("orgaos"),"POST",body("a1-create-1","TESTE - Órgão Novo"));
 assert.equal(r.status,201,await r.clone().text());
 const record=await r.json();assert.equal(record.newVersion,1);
 const e1=await db.prepare("SELECT id,empresa_id,origem_dado,conferencia FROM orgaos WHERE id=?")
  .bind(record.id).first();
 assert.equal(e1.empresa_id,"e1");assert.equal(e1.origem_dado,"NATIVO");
 assert.equal((await db.prepare("SELECT count(*) n FROM operacoes WHERE id='a1-create-1'").first()).n,1);
 assert.equal((await db.prepare("SELECT count(*) n FROM eventos_auditoria WHERE operacao_id='a1-create-1'").first()).n,1);
 const deny=await call(path("orgaos","e2"),"POST",body("a1-no-consultant","TESTE - Não Autorizado"));
 assert.equal(deny.status,403);
});
test("A1: listagem não revela legado nem empresa cruzada; detalhe por outro tenant 403",async()=>{
 const list=await(await call(path("orgaos"))).json();
 assert.equal(list.items.length,1);
 assert.match(list.items[0].nome,/^TESTE - /);
 assert.equal(JSON.stringify(list).includes("Órgão legado"),false);
 const e2=await(await call(path("fornecedores","e2"),"GET",null,{sub:"user-b"})).json();
 assert.equal(e2.items.length,1);
 assert.equal((await call(path("fornecedores","e2")+"/f-e2","GET",null,{sub:"user-a"})).status,200);
 assert.equal((await call(path("fornecedores","e2")+"/f-e2","GET",null,{sub:"user-admin"})).status,403);
});
test("A1: replay idempotente, CAS e corrida negada; update só em linha TESTE",async()=>{
 const r=await call(path("orgaos"),"POST",body("a1-create-1","TESTE - Órgão Novo"));
 assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);
 const diff=await call(path("orgaos"),"POST",body("a1-create-1","TESTE - Diferente"));
 assert.equal(diff.status,409);
 const row=await db.prepare("SELECT id,versao FROM orgaos WHERE operacao_id='a1-create-1'").first();
 const wrong=await call(path("orgaos")+"/legacy-org","PATCH",{
  intentId:"a1-legacy-edit",expectedVersion:1,nome:"TESTE - Substituir legado"});
 assert.equal(wrong.status,403);
 const [a,b]=await Promise.all([
  call(path("orgaos")+"/"+row.id,"PATCH",body("a1-race-a","TESTE - R1",{expectedVersion:1})),
  call(path("orgaos")+"/"+row.id,"PATCH",body("a1-race-b","TESTE - R2",{expectedVersion:1}))
 ]);
 assert.deepEqual([a.status,b.status].sort(),[200,409]);
 const updated=await db.prepare("SELECT versao FROM orgaos WHERE id=?").bind(row.id).first();
 assert.equal(updated.versao,2);
});
test("A1: CSRF, métodos indevidos, path traversal e URL alternativa falham",async()=>{
 const r=await call(path("fornecedores"),"POST",body("a1-evil-origin","TESTE - Recusado"),
  {headers:{origin:"https://evil.example"}});
 assert.equal(r.status,403);
 assert.equal((await call(path("orgaos"),"DELETE")).status,405);
 assert.equal((await call("/api/v1/companies/e1/%2e%2e/orgaos")).status,503);
 const alt=await call("/api/v1/me","GET",null,{originUrl:"https://licita-production.invalid"});
 assert.equal(alt.status,503);
});
test("A1: JWT revogado localmente no D1 bloqueia contextos e empresas em todas as próximas consultas",async()=>{
 const token=jwt("user-a",{jti:"a1-logout-unique-token"});
 assert.equal((await call("/api/v1/me","GET",null,{token})).status,200);
 const r=await call("/api/v1/session/logout","POST",
  {companyId:"e1",intentId:"a1-log-out"},{token});
 assert.equal(r.status,200,await r.clone().text());
 assert.equal((await call("/api/v1/me","GET",null,{token})).status,401);
 assert.equal((await call("/api/v1/companies/e2/context","GET",null,{token})).status,401);
 const n=await db.prepare("SELECT count(*) n FROM r7_sessoes_revogadas WHERE operacao_id='a1-log-out'").first();
 assert.equal(n.n,1);
});
