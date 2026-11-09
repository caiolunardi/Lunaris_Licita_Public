// F3: finanças sintéticas no Workerd + D1, sem acesso a Cloudflare remoto.
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createA2HmlHandler} from "../src/hml/a2-candidate.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const issuer="https://f3-local-only.invalid",audience="f3-local-only-audience";
const origin="https://licita-hml.invalid",uuid="30000000-0000-4000-8000-000000000001";
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),kid:"local-f3-rsa",alg:"RS256",use:"sig"};
const files=["0001_ddl_v1.sql","0002_ddl_v1r_r4.sql","0003_ddl_v1r_r5.sql",
 "0004_ddl_v1r_r6.sql","0005_ddl_v1r_r7_w1.sql","0006_ddl_v1r_r7_quantidades.sql",
 "0007_ddl_v1r_r7_etapa1.sql","0008_ddl_v1r_r7_etapa2_guardas.sql",
 "0009_ddl_v1r_r7_etapa2_retificacoes.sql","0010_ddl_v1r_r7_etapa2_retencao_strict.sql",
 "0011_ddl_v1r_r7_etapa2_ciclos_workerd.sql","0012_ddl_v1r_r7_etapa3_iam.sql",
 "0013_ddl_v1r_r7_etapa4_backup_ledger.sql"];
const comp=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit"}).formatToParts(new Date());
const yy=Number(comp.find(x=>x.type==="year").value)+2;
const future=String(yy)+"-03",next=String(yy)+"-04";
function token(sub="person-a",custom={},valid=true){
 const now=Math.floor(Date.now()/1000);
 const h=Buffer.from(JSON.stringify({alg:"RS256",kid:jwk.kid,typ:"JWT"})).toString("base64url");
 const p=Buffer.from(JSON.stringify({iss:issuer,aud:[audience],sub,iat:now-10,exp:now+900,...custom})).toString("base64url");
 const data=h+"."+p,signature=sign("RSA-SHA256",Buffer.from(data),privateKey).toString("base64url");
 return data+"."+(valid?signature:signature.slice(0,-3)+"bad");
}
let mf,db;
function split(sql){
 const py=["import sys,sqlite3,json","s='';parts=[]","for line in sys.stdin:","  if line.lstrip().startswith('--'):continue","  s+=line","  if sqlite3.complete_statement(s.strip()): parts.append(s.strip());s=''","if s.strip():raise ValueError('SQL_INCOMPLETO')","print(json.dumps(parts))"].join("\n");
 return JSON.parse(execFileSync(process.env.LICITA_PYTHON || (process.platform==="win32" ? "python" : "python3"),["-c",py],{input:sql,encoding:"utf8",maxBuffer:12000000}));
}
async function req(path,method="GET",body,opts={}){
 const headers={"cf-access-jwt-assertion":opts.token??token(opts.sub||"person-a"),
   ...method==="POST"?{"content-type":"application/json",origin,"x-lunaris-synthetic-only":"confirmed"}: {},
   ...(opts.headers||{})};
 const init={method,headers};
 if(method==="POST")init.body=typeof body==="string"?body:JSON.stringify(body);
 return mf.dispatchFetch((opts.host||origin)+path,init);
}
const base=(c="e1")=>"/api/v1/companies/"+c+"/finance";
const title=(id,c="e1")=>base(c)+"/titles"+(id?"/"+id:"");
const recurrence=(id,c="e1")=>base(c)+"/recurrences"+(id?"/"+id:"");
const once=(intentId,beneficiario="TESTE - Conta Mensal",extra={})=>({
 intentId,tipo:"DIVERSO",beneficiario,categoriaDespesa:"TESTE - Despesas fixas",
 valorCent:109900,vencimento:future+"-31",descricao:"TESTE - Sem boleto por opção",...extra
});
const recurring=(intentId,beneficiario="TESTE - Internet",extra={})=>({
 intentId,beneficiario,categoriaDespesa:"TESTE - Serviços",descricao:"TESTE - Plano mensal",
 diaVencimento:31,primeiroVencimento:future+"-31",valorCent:12990,...extra
});
before(async()=>{
 mf=new Miniflare({scriptPath:"web/src/hml/a2-test-entry.mjs",modules:true,
  modulesRules:[{type:"ESModule",include:["**/*.mjs"]}],
  compatibilityDate:"2026-08-06",cf:false,d1Databases:{DB:uuid},
  bindings:{A1_HML_ORIGIN:origin,A1_HML_STAGE:"a1_hml_synthetic_only",
   A1_HML_ENABLED:"f1_f2_only",A2_HML_STAGE:"a2_synthetic_financial",
   A2_HML_ENABLED:"f3_f7_synthetic_only",A2_HML_SCOPE:"isolated_hml_d1_only",F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
   ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:audience,APP_ORIGIN:origin}});
 db=await mf.getD1Database("DB");
 for(const name of files)for(const [i,sql] of split(readFileSync("migrations/"+name,"utf8")).entries()){
  try{await db.prepare(sql).run();}catch(e){throw Error(name+" #"+i+": "+e);}
 }
 for(const sql of [
  "INSERT INTO empresas(id,nome) VALUES('e1','TESTE - Empresa Azul'),('e2','TESTE - Empresa Verde')",
  "INSERT INTO usuarios(id,access_issuer,access_subject,email_normalizado) VALUES('u1','"+issuer+"','person-a','a@invalid.test'),('u2','"+issuer+"','person-b','b@invalid.test'),('u3','"+issuer+"','person-admin','admin@invalid.test')",
  "INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) VALUES('u1','e1','OPERADOR',1),('u1','e2','CONSULTA',1),('u2','e2','ADMIN',1),('u3','e1','ADMIN',1)",
  "INSERT INTO orgaos(id,empresa_id,nome,nome_normalizado) VALUES('o1','e1','TESTE - Órgão Demo','teste - orgao demo')",
  "INSERT INTO fornecedores(id,empresa_id,nome,nome_normalizado) VALUES('supplier-e1','e1','TESTE - Fornecedor Alpha','teste - fornecedor alpha')"
 ])await db.prepare(sql).run();
});
after(async()=>await mf?.dispose());


const data=async(response)=>{const raw=await response.clone().text();
 try{return JSON.parse(raw);}catch{return {raw};}};
test("A2: fail closed sem variáveis, outro host, versão, upload e demais módulos",async()=>{
 const fn=createA2HmlHandler({fetchKeys:async()=>new Response(JSON.stringify({keys:[jwk]}))});
 const noFlags=await fn(new Request(origin+title(),{
  headers:{"cf-access-jwt-assertion":token()}}),{DB:db});
 assert.equal(noFlags.status,503);
 for(const url of ["/api/v1/companies/e1/files","/api/v1/companies/e1/tools/quotes",
  "/api/v1/companies/e1/gabi/ask","/api/v1/companies/e1/licitacoes/l1/documents",
  "/api/v1/companies/e1/cash/receivables/r1/retentions",
  "/__hml/d1-transacoes"]){
  const r=await req(url);assert.equal(r.status,503,url);
 }
 assert.equal((await req(title(),"GET",undefined,
  {host:"https://licita-production.invalid"})).status,503);
});
test("A2: JWT ausente, falso, expirado, issuer e audience errados retornam 401",async()=>{
 for(const t of ["",token("person-a",{},false),token("person-a",{exp:1}),
  token("person-a",{aud:"wrong"}),token("person-a",{iss:"https://wrong.example"})]){
  const r=await req(title(),"GET",undefined,{token:t});
  assert.equal(r.status,401,await r.clone().text());
 }
});
test("A2: CONSULTA não pode escrever; empresa não vinculada nega inclusive leitura",async()=>{
 assert.equal((await req(title(undefined,"e2"),"GET")).status,200);
 assert.equal((await req(title(undefined,"e2"),"POST",once("a2-test-read-deny"))).status,403);
 assert.equal((await req(title(),"GET",undefined,{sub:"person-b"})).status,403);
 assert.equal((await req("/api/v1/companies/e2/licitacoes","GET",undefined,
  {sub:"person-admin"})).status,403);
});
test("A2: F1/F2 continuam disponíveis sob os mesmos gates de A1",async()=>{
 const me=await req("/api/v1/me");
 assert.equal(me.status,200,await me.clone().text());
 const context=await req("/api/v1/companies/e1/context");
 assert.equal(context.status,200,await context.clone().text());
 const r=await req("/api/v1/companies/e1/fornecedores","GET");
 assert.equal(r.status,200);
});
test("A2: F3 cria título avulso em centavos no banco com journal e auditoria",async()=>{
 const body=once("a2-test-title-create");
 const r=await req(title(),"POST",body);
 assert.equal(r.status,201,await r.clone().text());
 const v=await r.json();
 const row=await db.prepare("SELECT id,valor_nominal_cent,origem_dado,conferencia,beneficiario "+
  "FROM titulos_pagar WHERE id=?").bind(v.id).first();
 assert.equal(row.valor_nominal_cent,109900);
 assert.equal(row.origem_dado,"NATIVO");assert.equal(row.conferencia,"VALIDADO");
 assert.match(row.beneficiario,/^TESTE - /);
 assert.equal((await db.prepare("SELECT count(*) n FROM operacoes WHERE id='a2-test-title-create'").first()).n,1);
 assert.equal((await db.prepare("SELECT count(*) n FROM eventos_auditoria WHERE operacao_id='a2-test-title-create'").first()).n,1);
});
test("A2: replay e conflito de mesmo intentId não duplicam compromisso",async()=>{
 const again=await req(title(),"POST",once("a2-test-title-create"));
 assert.equal(again.status,201,await again.clone().text());
 assert.equal((await again.json()).replayed,true);
 const changed=await req(title(),"POST",once("a2-test-title-create","TESTE - Diferente"));
 assert.equal(changed.status,409);
 assert.equal((await db.prepare("SELECT count(*) n FROM titulos_pagar WHERE operacao_id='a2-test-title-create'").first()).n,1);
});
test("A2: HML bloqueia dados reais e mantém zero writes para payload impróprio",async()=>{
 const total=(await db.prepare("SELECT count(*) n FROM titulos_pagar").first()).n;
 for(const [body,opts] of [
  [once("a2-test-real-name","Maria Silva"),{}],
  [once("bad-id","TESTE - Conta"),{}],
  [once("a2-test-leak","TESTE - Conta",{descricao:"http://evil.example"}),{}],
  [once("a2-test-value","TESTE - Conta",{valorCent:20000000}),{}],
  [once("a2-test-cpf","TESTE - Conta",{cpf:"12345678901"}),{}],
  [once("a2-test-noheader"),{headers:{"x-lunaris-synthetic-only":"no"}}],
  [once("a2-test-origin"),{headers:{origin:"https://attacker.example"}}]
 ]){
  const r=await req(title(),"POST",body,opts);
  assert.equal(r.status,403,await r.clone().text());
  assert.equal((await r.json()).error,"hml_synthetic_only");
 }
 assert.equal((await db.prepare("SELECT count(*) n FROM titulos_pagar").first()).n,total);
});
test("A2: empresa identificada ou LEGADO falha fechada sem contaminar os demais tenants",async()=>{
 const before=(await db.prepare("SELECT count(*) n FROM titulos_pagar WHERE empresa_id=?").bind("e1").first()).n;
 // Fixtures isoladas: R4 proibe a exclusao fisica de historico.
 await db.prepare("INSERT INTO empresas(id,nome,documento_identificacao) VALUES"+
  "(?,?,?),(?,?,?)").bind("e3","TESTE - Tenant Legado",null,
   "e4","TESTE - Tenant Identificado","SIMULADO_NAO_NULO").run();
 await db.prepare("INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) VALUES"+
  "(?,?,?,1),(?,?,?,1)").bind("u3","e3","ADMIN","u3","e4","ADMIN").run();
 await db.prepare("INSERT INTO titulos_pagar(id,empresa_id,tipo,beneficiario,categoria_despesa,"+
  "valor_nominal_cent,vencimento,origem_dado,conferencia) VALUES (?,?,?,?,?,?,?,?,?)")
  .bind("a2-legacy-test","e3","DIVERSO","TESTE - Legado Sintetico",
   "TESTE - Categoria",1000,"2030-01-01","LEGADO","PENDENTE").run();
 for(const company of ["e3","e4"]){
  const response=await req(title(undefined,company),"GET",undefined,{sub:"person-admin"});
  assert.equal(response.status,503,company+" "+await response.clone().text());
  assert.equal((await response.json()).error,"hml_synthetic_only");
 }
 assert.equal((await db.prepare("SELECT count(*) n FROM titulos_pagar WHERE empresa_id=?").bind("e1").first()).n,before);
 assert.equal((await req(title(),"GET")).status,200);
 assert.equal((await req(title(undefined,"e2"),"GET")).status,200);
});
test("A2: recorrência e prévia mensal não executam pagamento ou envio",async()=>{
 const r=await req(recurrence(),"POST",recurring("a2-test-rec-create"));
 assert.equal(r.status,201,await r.clone().text());
 const obj=await r.json();
 assert.equal(obj.replayed,false);
 const preview=await req(base()+"/monthly?month="+future);
 assert.equal(preview.status,200,await preview.clone().text());
 const d=await preview.json();
 assert.equal(d.linhas.some(x=>x.tipo==="REGRA"||x.tipo==="TITULO"),true);
 assert.equal((await db.prepare("SELECT count(*) n FROM titulo_baixas").first()).n,0);
});
test("A2: F4 cria licitação fictícia, prova idempotência, não altera receita",async()=>{
 const form={intentId:"a2-test-new-tender",orgaoId:"o1",numero:"TESTE - Pregão 001",
  ano:2027,modalidade:"Pregão eletrônico",objeto:"TESTE - Aquisição de equipamentos",
  portal:"TESTE - Portal fictício",urlProcesso:null,limitePropostaEm:null,
  inicioDisputaEm:null,decisaoParticipacao:"PARTICIPAR",
  situacaoParticipacao:"EM_ANALISE",responsavelTexto:"TESTE - Responsável",observacoes:null};
 const path="/api/v1/companies/e1/licitacoes";
 const r=await req(path,"POST",form);
 assert.equal(r.status,201,await r.clone().text());
 const d=await r.json();
 assert.equal((await db.prepare("SELECT numero,conferencia FROM licitacoes WHERE id=?").bind(d.id).first()).numero,
  "TESTE - Pregão 001");
 const again=await req(path,"POST",form);
 assert.equal(again.status,200,await again.clone().text());
 assert.equal((await again.json()).replayed,true);
 const e2=await req("/api/v1/companies/e2/licitacoes","GET",null,{sub:"person-b"});
 assert.equal(e2.status,200);
 assert.equal(JSON.stringify(await e2.json()).includes("TESTE - Pregão 001"),false);
});
test("A2: F5/F6/F7 rotas distintas integradas e protegidas por tenant, sem receita fictícia",async()=>{
 for(const path of [
  "/api/v1/companies/e1/commercial/commitments",
  "/api/v1/companies/e1/commercial/purchases",
  "/api/v1/companies/e1/fulfillment/shipments",
  "/api/v1/companies/e1/fulfillment/invoices",
  "/api/v1/companies/e1/cash/receivables"
 ]){
  const r=await req(path);
  assert.equal(r.status,200,path+" "+await r.clone().text());
 }
 const money=await req("/api/v1/companies/e1/cash/overview?month="+future);
 assert.equal(money.status,200,await money.clone().text());
 const totals=await money.json();
 assert.equal(JSON.stringify(totals).includes("person-b"),false);
});
test("A2: F3 a F7 mantêm autorização e Origin mesmo após ativação do candidato",async()=>{
 for(const path of [title(),"/api/v1/companies/e1/licitacoes",
  "/api/v1/companies/e1/commercial/commitments",
  "/api/v1/companies/e1/fulfillment/shipments",
  "/api/v1/companies/e1/cash/receivables"]){
  const denied=await req(path,"GET",null,{sub:"person-b"});
  assert.equal(denied.status,403,path);
 }
 const attack=await req(title(),"POST",once("a2-test-csrf"),{
  headers:{origin:"https://evil.example"}});
 assert.equal(attack.status,403);
});
