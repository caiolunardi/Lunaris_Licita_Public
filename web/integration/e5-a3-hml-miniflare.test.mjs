// A3 HML: Workerd, D1, R2 sintéticos; execução local, sem rede ou deploy.
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,createHash,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const origin="https://licita-hml.invalid";
const issuer="https://a3-local-only.invalid",aud="a3-local-only";
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),kid:"a3-test-key",alg:"RS256",use:"sig"};
const files=["0001_ddl_v1.sql","0002_ddl_v1r_r4.sql","0003_ddl_v1r_r5.sql",
 "0004_ddl_v1r_r6.sql","0005_ddl_v1r_r7_w1.sql","0006_ddl_v1r_r7_quantidades.sql",
 "0007_ddl_v1r_r7_etapa1.sql","0008_ddl_v1r_r7_etapa2_guardas.sql",
 "0009_ddl_v1r_r7_etapa2_retificacoes.sql","0010_ddl_v1r_r7_etapa2_retencao_strict.sql",
 "0011_ddl_v1r_r7_etapa2_ciclos_workerd.sql","0012_ddl_v1r_r7_etapa3_iam.sql",
 "0013_ddl_v1r_r7_etapa4_backup_ledger.sql"];
function split(sql){
 const script=["import sys,sqlite3,json","s='';p=[]","for line in sys.stdin:",
 "  if line.lstrip().startswith('--'): continue","  s+=line",
 "  if sqlite3.complete_statement(s.strip()):p.append(s.strip());s=''",
 "if s.strip():raise ValueError('SQL_INCOMPLETO')","print(json.dumps(p))"].join("\n");
 const bin=process.env.LICITA_PYTHON||(process.platform==="win32"?"python":"python3");
 return JSON.parse(execFileSync(bin,["-c",script],{
  input:sql,encoding:"utf8",maxBuffer:12000000}));
}
function jwt(sub="operator-a"){
 const now=Math.floor(Date.now()/1000);
 const h=Buffer.from(JSON.stringify({alg:"RS256",kid:jwk.kid,typ:"JWT"})).toString("base64url");
 const p=Buffer.from(JSON.stringify({iss:issuer,aud:[aud],sub,iat:now-5,exp:now+900})).toString("base64url");
 const d=h+"."+p;return d+"."+sign("RSA-SHA256",Buffer.from(d),privateKey).toString("base64url");
}
const b=path=>"/api/v1/companies/e1/files"+(path?"/"+path:"");
const raw=new TextEncoder().encode("%PDF-1.7\nTESTE - Documento sintetico A3\n"+"x".repeat(9000));
const hash=createHash("sha256").update(raw).digest("hex");
let mf,db,doc,version;
function call(path,method="GET",headers={},body){
 return mf.dispatchFetch(origin+path,{method,
  headers:{"cf-access-jwt-assertion":jwt(),...headers},...(body?{body}:{})});
}
const headers=(intent="a3-test-upload-001",name="TESTE - Edital.pdf")=>({
  origin,"x-lunaris-synthetic-only":"confirmed","content-type":"application/pdf",
  "content-length":String(raw.length),"x-content-sha256":hash,
  "x-doc-intent":intent,"x-doc-name":name,
  "x-doc-owner-type":"licitacao","x-doc-owner-id":"l1",
  "x-doc-role":"EDITAL","x-doc-type":"EDITAL"});
before(async()=>{
 mf=new Miniflare({scriptPath:"web/src/hml/a3-test-entry.mjs",modules:true,
  modulesRules:[{type:"ESModule",include:["**/*.mjs"]}],
  compatibilityDate:"2026-08-06",cf:false,
  d1Databases:{DB:"70000000-0000-4000-8000-000000000001"},r2Buckets:["R2"],
  bindings:{A1_HML_ORIGIN:origin,A1_HML_STAGE:"a1_hml_synthetic_only",
   A1_HML_ENABLED:"f1_f2_only",A2_HML_STAGE:"a2_synthetic_financial",
   A2_HML_ENABLED:"f3_f7_synthetic_only",A2_HML_SCOPE:"isolated_hml_d1_only",
   A3_HML_STAGE:"a3_synthetic_documents",A3_HML_ENABLED:"f8_r2_synthetic_only",
   A3_HML_SCOPE:"isolated_hml_d1_r2_only",
   F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
   ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:aud,APP_ORIGIN:origin}});
 db=await mf.getD1Database("DB");
 for(const file of files){
  for(const [i,sql] of split(readFileSync("migrations/"+file,"utf8")).entries()){
   try{await db.prepare(sql).run();}catch(e){throw Error(file+" #"+i+": "+e);}
  }
 }
 for(const sql of [
  "INSERT INTO empresas(id,nome) VALUES('e1','TESTE - Empresa A'),('e2','TESTE - Empresa B')",
  "INSERT INTO usuarios(id,access_issuer,access_subject,email_normalizado) VALUES('u1','"+issuer+"','operator-a','a@invalid.test'),('u2','"+issuer+"','operator-b','b@invalid.test')",
  "INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) VALUES('u1','e1','OPERADOR',1),('u2','e2','ADMIN',1)",
  "INSERT INTO orgaos(id,empresa_id,nome,nome_normalizado) VALUES('o1','e1','TESTE - Orgao A','teste - orgao a')",
  "INSERT INTO licitacoes(id,empresa_id,orgao_id,numero,numero_normalizado,ano,decisao_participacao,situacao_participacao) VALUES('l1','e1','o1','TESTE - Pregao A','teste - pregao a',2027,'PARTICIPAR','EM_ANALISE')"
 ])await db.prepare(sql).run();
});
after(async()=>await mf?.dispose());
test("A3: rejeita produção e rotas externas de Drive",async()=>{
 assert.equal((await mf.dispatchFetch("https://licita-production.invalid"+b())).status,503);
 assert.equal((await call(b("archive-attempts/abc"))).status,503);
 const r=await call(b("any/versions/any/archive-copy"),"POST",{
  origin,"content-type":"application/json","x-lunaris-synthetic-only":"confirmed"
 },JSON.stringify({intentId:"a3-test-archive-001"}));
 assert.equal(r.status,503);
});
test("A3: JWT obrigatório e isolamento por empresa",async()=>{
 assert.equal((await mf.dispatchFetch(origin+b())).status,401);
 assert.equal((await mf.dispatchFetch(origin+b(),{
  headers:{"cf-access-jwt-assertion":jwt("operator-b")}})).status,403);
});
test("A3: upload R2 com read-back SHA, diário e versão VERIFICADA",async()=>{
 const r=await call(b("upload"),"POST",headers(),raw);
 assert.equal(r.status,201,await r.clone().text());
 const j=await r.json();doc=j.documentoId;version=j.versaoId;
 assert.equal(j.sha256,hash);
 const row=await db.prepare("SELECT v.sha256,l.status FROM documento_versoes v JOIN documento_localizacoes l ON l.versao_id=v.id WHERE v.id=?").bind(version).first();
 assert.equal(row.sha256,hash);assert.equal(row.status,"VERIFICADO");
 const bucket=await mf.getR2Bucket("R2");
 assert.equal((await bucket.get("e1/"+doc+"/"+version)).size,raw.length);
});
test("A3: listagem e download íntegro do documento",async()=>{
 const list=await call(b());assert.equal(list.status,200,await list.clone().text());
 const download=await call(b(doc+"/content"));
 assert.equal(download.status,200,await download.clone().text());
 assert.equal(download.headers.get("x-content-sha256"),hash);
 assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(raw));
});
test("A3: replay sem duplicar; nome e Origin reais são recusados",async()=>{
 const again=await call(b("upload"),"POST",headers(),raw);
 assert.equal(again.status,200,await again.clone().text());
 assert.equal((await again.json()).replayed,true);
 for(const h of [headers("a3-test-unsafe-1","Documento real.pdf"),
  {...headers("a3-test-unsafe-2"),"x-lunaris-synthetic-only":"no"},
  {...headers("a3-test-unsafe-3"),origin:"https://evil.invalid"}]){
  const r=await call(b("upload"),"POST",h,raw);
  assert.equal(r.status,403,await r.clone().text());
 }
 assert.equal((await db.prepare("SELECT count(*) n FROM documentos WHERE empresa_id='e1'").first()).n,1);
});
test("A3: leitura financeira A2 continua disponível sem receber R2",async()=>{
 const r=await call("/api/v1/companies/e1/finance/titles");
 assert.equal(r.status,200,await r.clone().text());
});
