// F5 regression: Workerd, migrations 0001-0013, JWT RS256 and synthetic tenant data.
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createF9Handler} from "../ui/worker/f9-tools.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const origin="https://licita.local.test",issuer="https://f5-local.cloudflareaccess.com",aud="f5-workerd-local-only";
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),kid:"f5-local-rs256",alg:"RS256",use:"sig"};
const migrations=Array.from({length:13},(_,i)=>["0001_ddl_v1.sql","0002_ddl_v1r_r4.sql",
"0003_ddl_v1r_r5.sql","0004_ddl_v1r_r6.sql","0005_ddl_v1r_r7_w1.sql",
"0006_ddl_v1r_r7_quantidades.sql","0007_ddl_v1r_r7_etapa1.sql",
"0008_ddl_v1r_r7_etapa2_guardas.sql","0009_ddl_v1r_r7_etapa2_retificacoes.sql",
"0010_ddl_v1r_r7_etapa2_retencao_strict.sql","0011_ddl_v1r_r7_etapa2_ciclos_workerd.sql",
"0012_ddl_v1r_r7_etapa3_iam.sql","0013_ddl_v1r_r7_etapa4_backup_ledger.sql"][i]);
const split=sql=>{
 const py=["import sys,sqlite3,json","s='';result=[]","for l in sys.stdin:",
 "  if l.lstrip().startswith('--'):continue","  s+=l",
 "  if sqlite3.complete_statement(s.strip()):result.append(s.strip());s=''",
 "if s.strip():raise Exception('incomplete')","print(json.dumps(result))"].join("\n");
 return JSON.parse(execFileSync("python3",["-c",py],{input:sql,encoding:"utf8",maxBuffer:12000000}));
};
let mf,db,ep1,ep2,purchase1;
function jwt(sub="operator-a",claims={},valid=true){
 const now=Math.floor(Date.now()/1000);
 const h=Buffer.from(JSON.stringify({alg:"RS256",kid:jwk.kid})).toString("base64url");
 const p=Buffer.from(JSON.stringify({iss:issuer,aud:[aud],sub,iat:now-1,exp:now+600,...claims})).toString("base64url");
 const d=h+"."+p,sig=sign("RSA-SHA256",Buffer.from(d),privateKey).toString("base64url");
 return d+"."+(valid?sig:sig.slice(0,-3)+"invalid");
}
const path=(resource="",company="e1")=>"/api/v1/companies/"+company+"/tools"+(resource?"/"+resource:"");
const commit=(intentId,numero,items,other={})=>({intentId,parentId:"l1",expectedParentVersion:1,numero,items,...other});
const purchase=(intentId,parentId,numero,items,other={})=>({intentId,parentId,
 expectedParentVersion:1,numero,fornecedorId:"s1",items,...other});
const line=(parentItemId,quantidadeMil,valorUnitCent=10000)=>({parentItemId,quantidadeMil,valorUnitCent});
async function call(url,method="GET",body,opts={}){
 const headers={"cf-access-jwt-assertion":opts.token??jwt(opts.sub||"operator-a"),
  ...(["POST","PATCH"].includes(method)?{origin,"content-type":"application/json"}:{}),
  ...(opts.headers||{})};
 const init={method,headers};
 if(method==="POST"||method==="PATCH")init.body=typeof body==="string"?body:JSON.stringify(body);
 return mf.dispatchFetch((opts.host||origin)+url,init);
}
before(async()=>{
 mf=new Miniflare({scriptPath:"web/ui/worker/test-local-entry.mjs",modules:true,
  modulesRules:[{type:"ESModule",include:["**/*.mjs"]}],
  compatibilityDate:"2026-08-06",cf:false,
  d1Databases:{DB:"50000000-0000-4000-8000-000000000001"},
  r2Buckets:["R2"],
  bindings:{F1_RUNTIME_ENABLED:"test_local_only",F2_RUNTIME_ENABLED:"test_local_only",
   F3_RUNTIME_ENABLED:"test_local_only",F4_RUNTIME_ENABLED:"test_local_only",
   F5_RUNTIME_ENABLED:"test_local_only",F6_RUNTIME_ENABLED:"test_local_only",
   F7_RUNTIME_ENABLED:"test_local_only",F8_RUNTIME_ENABLED:"test_local_only",
   F9_RUNTIME_ENABLED:"test_local_only",F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
   ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:aud,APP_ORIGIN:origin}});
 db=await mf.getD1Database("DB");
 for(const name of migrations)
  for(const [i,sql] of split(readFileSync("migrations/"+name,"utf8")).entries())
   try{await db.prepare(sql).run();}catch(e){throw Error(name+" #"+i+" "+e);}
 for(const sql of [
  "INSERT INTO empresas(id,nome) VALUES('e1','Empresa Aurora'),('e2','Empresa Horizonte')",
  "INSERT INTO usuarios(id,access_issuer,access_subject,email_normalizado) VALUES('u1','"+issuer+"','operator-a','op@invalid.test'),('u2','"+issuer+"','operator-b','b@invalid.test'),('u3','"+issuer+"','reader-a','r@invalid.test'),('u4','"+issuer+"','admin-a','adm@invalid.test')",
  "INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) VALUES('u1','e1','OPERADOR',1),('u2','e2','OPERADOR',1),('u3','e1','CONSULTA',1),('u4','e1','ADMIN',1)",
  "INSERT INTO orgaos(id,empresa_id,nome,nome_normalizado) VALUES('o1','e1','Órgão Sintético','orgao sintetico'),('o2','e2','Órgão Oculto','orgao oculto')",
  "INSERT INTO fornecedores(id,empresa_id,nome,nome_normalizado,ativo) VALUES('s1','e1','Fornecedor Válido','fornecedor valido',1),('s2','e1','Outro Fornecedor','outro fornecedor',1),('s3','e2','Fornecedor Outro Tenant','fornecedor outro tenant',1),('s4','e1','Fornecedor Inativo','fornecedor inativo',0)",
  "INSERT INTO licitacoes(id,empresa_id,orgao_id,numero,numero_normalizado,ano,decisao_participacao,situacao_participacao) VALUES('l1','e1','o1','Pregão F5 001','pregao f5 001',2027,'PARTICIPAR','RESULTADO_PENDENTE'),('l2','e2','o2','Segredo E2','segredo e2',2027,'PARTICIPAR','EM_ANALISE')",
  "INSERT INTO licitacao_itens(id,empresa_id,licitacao_id,numero_item,numero_item_normalizado,lote,quantidade_prevista_mil,resultado,quantidade_ganha_mil,valor_final_unit_cent,descricao_exigida,unidade,conferencia) VALUES('li1','e1','l1','1','1','L01',10000,'GANHO',6000,10000,'Computadores fictícios','UN','VALIDADO'),('li2','e1','l1','2','2','L02',5000,'GANHO',2000,20000,'Monitores fictícios','UN','VALIDADO'),('li3','e1','l1','3','3','L03',4000,'PERDIDO',NULL,NULL,'Item perdido','UN','VALIDADO')"
 ])try{await db.prepare(sql).run();}catch(e){throw Error("seed: "+sql.slice(0,100)+" : "+e);}
 for(const sql of [
  "INSERT INTO empenhos(id,empresa_id,licitacao_id,orgao_id_escopo,numero,situacao,conferencia) VALUES('ep1','e1','l1','o1','NE F6 A','CONFIRMADO','VALIDADO')",
  "INSERT INTO empenho_itens(id,empresa_id,empenho_id,licitacao_item_id,licitacao_id_escopo,quantidade_mil,valor_unit_cent,conferencia) VALUES('ei1','e1','ep1','li1','l1',5000,10000,'VALIDADO')",
  "INSERT INTO compras(id,empresa_id,empenho_id,fornecedor_id,numero_pedido,situacao,conferencia) VALUES('cp1','e1','ep1','s1','PED F6 A','CONFIRMADA','VALIDADO')",
  "INSERT INTO compra_itens(id,empresa_id,compra_id,empenho_item_id,empenho_id_escopo,quantidade_mil,valor_unit_cent,conferencia) VALUES('ci1','e1','cp1','ei1','ep1',4000,9000,'VALIDADO')"
 ])try{await db.prepare(sql).run();}catch(e){throw Error("F6 seed: "+e);}
});
after(async()=>await mf?.dispose());




const params={quantityMil:1000,costUnitCent:8000,extraCostCent:1000,
 saleFeeBps:1000,targetMarginBps:2000,saleUnitCent:null};
const quote=(intentId,other={})=>({intentId,descricao:"Cotação de equipamentos sintéticos",
 fornecedorTexto:"Fornecedor de teste",referenciaTexto:"EDITAL-001",...params,...other});
test("F9 Worker fail-closed on missing flag/DB and public hostname",async()=>{
 const handler=createF9Handler({fetchKeys:async()=>new Response(JSON.stringify({keys:[jwk]}))});
 const r=await handler(new Request(origin+path("quotes"),{
  headers:{"cf-access-jwt-assertion":jwt()}}),{});
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:"f9_not_enabled"});
 assert.equal((await call(path("quotes"),"GET",null,{
  host:"https://licita.lunaris.dev.br"})).status,503);
 assert.equal((await call(path("quotes"))).status,200);
});
test("F9 JWT signed required, revoked/forged/expired and no cross-tenant access",async()=>{
 for(const token of ["",jwt("operator-a",{},false),jwt("operator-a",{exp:1})])
  assert.equal((await call(path("quotes"),"GET",null,{token})).status,401);
 assert.equal((await call(path("quotes"),"GET",null,{sub:"operator-b"})).status,403);
 assert.equal((await call(path("quotes","e2"),"GET",null,{sub:"operator-b"})).status,200);
});
test("F9 read-only calculation for CONSULTA; no quote or money mutation",async()=>{
 const r=await call(path("pricing"),"POST",params,{sub:"reader-a"});
 assert.equal(r.status,200,await r.clone().text());
 const d=(await r.json()).calculation;
 assert.equal(d.minimumUnitCent,12858);assert.equal(d.actualMarginBps,2000);
 assert.equal(d.realSaleConfirmed,false);assert.equal(d.isEstimate,true);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM cotacoes_precos").first()).n,0);
});
test("F9 mathematical guard: impossible margins, decimals, overflow and unknown fields",async()=>{
 for(const invalid of [{...params,saleFeeBps:9000,targetMarginBps:2000},
 {...params,quantityMil:1.5},{...params,extraCostCent:-1},
 {...params,inject:true},{...params,costUnitCent:Number.MAX_SAFE_INTEGER,
 quantityMil:1000000000000}]){
  const r=await call(path("pricing"),"POST",invalid);
  assert.ok([400,409].includes(r.status),await r.clone().text());
 }
});
let quoteId;
test("F9 save price quote D1 local with operation, audit and replay",async()=>{
 let r=await call(path("quotes"),"POST",quote("f9-quote-1"));
 assert.equal(r.status,201,await r.clone().text());
 const v=await r.json();quoteId=v.cotacaoId;
 assert.ok(quoteId);assert.equal(v.calculation.minimumUnitCent,12858);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM cotacoes_precos "+
  "WHERE id=? AND empresa_id='e1' AND conferencia='VALIDADO'").bind(quoteId).first()).n,1);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM eventos_auditoria "+
  "WHERE tipo_entidade='COTACAO' AND entidade_id_texto=?").bind(quoteId).first()).n,1);
 r=await call(path("quotes"),"POST",quote("f9-quote-1"));
 assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);
 assert.equal((await call(path("quotes"),"POST",quote("f9-quote-1",{costUnitCent:500}))).status,409);
});
test("F9 quote list/detail protected and no direct duplicate quote by reader",async()=>{
 const r=await call(path("quotes?limit=20"));assert.equal(r.status,200,await r.clone().text());
 const quotes=await r.json();
 assert.equal(quotes.items.length,1);assert.equal(quotes.items[0].id,quoteId);
 const detail=await call(path("quotes/"+quoteId));
 assert.equal(detail.status,200);
 assert.equal((await detail.json()).item.profit_total_cent,undefined);
 assert.equal((await call(path("quotes/"+quoteId,"e2"),"GET",null,{sub:"operator-b"})).status,404);
 assert.equal((await call(path("quotes"),"POST",quote("f9-reader-save"),{sub:"reader-a"})).status,403);
 assert.equal((await call(path("quotes?limit=51"))).status,400);
 assert.equal((await call(path("quotes?limit=1&limit=2"))).status,400);
});
test("F9 cross-origin POST and wrong content type cannot calculate/write",async()=>{
 assert.equal((await call(path("quotes"),"POST",quote("f9-cross-origin"),{
  headers:{origin:"https://evil.test"}})).status,403);
 assert.equal((await call(path("pricing"),"POST",params,{headers:{"content-type":"text/html"}})).status,415);
});
test("F9 preferences ADMIN-only, safe CAS/upsert and idempotence",async()=>{
 assert.equal((await call(path("settings"),"GET",null,{sub:"reader-a"})).status,403);
 let r=await call(path("settings"),"GET",null,{sub:"admin-a"});
 assert.equal(r.status,200);assert.equal((await r.json()).items.length,0);
 r=await call(path("settings"),"PATCH",{intentId:"f9-setting-1",
  key:"exibir_dicas_iniciantes",value:"true",expectedValue:null},{sub:"admin-a"});
 assert.equal(r.status,200,await r.clone().text());
 assert.equal((await db.prepare("SELECT valor_texto FROM configuracoes "+
  "WHERE empresa_id='e1' AND chave='exibir_dicas_iniciantes'").first()).valor_texto,"true");
 const replay=await call(path("settings"),"PATCH",{intentId:"f9-setting-1",
  key:"exibir_dicas_iniciantes",value:"true",expectedValue:null},{sub:"admin-a"});
 assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
 assert.equal((await call(path("settings"),"PATCH",{intentId:"f9-stale",
  key:"exibir_dicas_iniciantes",value:"false",expectedValue:null},{sub:"admin-a"})).status,409);
 r=await call(path("settings"),"PATCH",{intentId:"f9-setting-2",
  key:"exibir_dicas_iniciantes",value:"false",expectedValue:"true"},{sub:"admin-a"});
 assert.equal(r.status,200,await r.clone().text());
 assert.equal((await db.prepare("SELECT valor_texto FROM configuracoes "+
  "WHERE empresa_id='e1' AND chave='exibir_dicas_iniciantes'").first()).valor_texto,"false");
 assert.equal((await call(path("settings"),"PATCH",{intentId:"f9-unknown",
  key:"oauth_secret",value:"evil",expectedValue:null},{sub:"admin-a"})).status,400);
});
test("F9 notification schedule persists disabled, no sender/cron dispatch",async()=>{
 let r=await call(path("notifications/schedule"),"PATCH",{
  intentId:"f9-notifications-1",expectedVersion:0,days:[1,2,3,4,5],
  times:["08:00","16:00"],quantityProximos:7},{sub:"admin-a"});
 assert.equal(r.status,200,await r.clone().text());
 assert.equal((await r.json()).dispatchEnabled,false);
 const row=await db.prepare("SELECT ativo,remetente,versao,dias_semana_json,horarios_json "+
  "FROM notificacoes_preferencias WHERE empresa_id='e1'").first();
 assert.equal(row.ativo,0);assert.equal(row.remetente,null);assert.equal(row.versao,1);
 assert.equal(row.dias_semana_json,"[1,2,3,4,5]");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM notificacoes_envios").first()).n,0);
 const replay=await call(path("notifications/schedule"),"PATCH",{
  intentId:"f9-notifications-1",expectedVersion:0,days:[1,2,3,4,5],
  times:["08:00","16:00"],quantityProximos:7},{sub:"admin-a"});
 assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
 assert.equal((await call(path("notifications/schedule"),"PATCH",{
  intentId:"f9-stale-schedule",expectedVersion:0,days:[1],times:["08:00"],
  quantityProximos:5},{sub:"admin-a"})).status,409);
 assert.equal((await call(path("notifications/schedule"),"PATCH",{
  intentId:"f9-bad-days",expectedVersion:1,days:[1,1],times:["08:00"],
  quantityProximos:5},{sub:"admin-a"})).status,400);
});
let recipientId;
test("F9 notification recipient CRUD safe: add, version CAS disable and no messages",async()=>{
 let r=await call(path("notifications/recipients"),"POST",{
  intentId:"f9-recipient-1",email:"TEST@INVALID.TEST"},{sub:"admin-a"});
 assert.equal(r.status,201,await r.clone().text());recipientId=(await r.json()).destinatarioId;
 const data=await(await call(path("notifications"),"GET",null,{sub:"admin-a"})).json();
 assert.equal(data.dispatchEnabled,false);assert.equal(data.providerConfigured,false);
 assert.equal(data.cronEnabled,false);
 assert.equal(data.recipients[0].email_normalizado,"test@invalid.test");
 assert.equal(data.history.length,0);
 assert.equal((await call(path("notifications/recipients"),"POST",{
  intentId:"f9-recipient-2",email:"test@invalid.test"},{sub:"admin-a"})).status,409);
 r=await call(path("notifications/recipients/"+recipientId),"POST",{
  intentId:"f9-recipient-disable",expectedVersion:1,motivo:"Não recebe mais alertas"},{sub:"admin-a"});
 assert.equal(r.status,201,await r.clone().text());
 assert.equal((await r.json()).disabled,true);
 assert.equal((await call(path("notifications/recipients/"+recipientId),"POST",{
  intentId:"f9-recipient-stale",expectedVersion:1,motivo:"Não recebe mais alertas"},{sub:"admin-a"})).status,409);
 assert.equal((await db.prepare("SELECT ativo FROM notificacoes_destinatarios WHERE id=?")
  .bind(recipientId).first()).ativo,0);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM notificacoes_envios").first()).n,0);
});
test("F9 preview does not reserve/send email or invent amount on empty schedule",async()=>{
 let r=await call(path("notifications/preview"),"GET",null,{sub:"admin-a"});
 assert.equal(r.status,200,await r.clone().text());
 let d=await r.json();assert.equal(d.count,0);assert.equal(d.totalCent,0);
 assert.equal(d.sent,false);assert.equal(d.sendAuthorized,false);
 assert.match(d.message,/Sem vencimentos/);
 await db.prepare("INSERT INTO titulos_pagar(id,empresa_id,tipo,beneficiario,"+
  "categoria_despesa,valor_nominal_cent,vencimento,conferencia) "+
  "VALUES('f9-title','e1','DIVERSO','Conta sintética','Internet',12990,'2030-01-01','VALIDADO')")
  .run();
 r=await call(path("notifications/preview"),"GET",null,{sub:"admin-a"});
 assert.equal(r.status,200,await r.clone().text());
 d=await r.json();assert.equal(d.count,1);assert.equal(d.totalCent,12990);
 assert.equal(d.sent,false);assert.equal(d.items[0].vencimento,"2030-01-01");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM notificacoes_envios").first()).n,0);
});
test("F9 TEAM member list ADMIN only, deny-only target list via ACL",async()=>{
 assert.equal((await call(path("members"),"GET",null,{sub:"operator-a"})).status,403);
 const r=await call(path("members"),"GET",null,{sub:"admin-a"});
 assert.equal(r.status,200);
 const members=(await r.json()).items;assert.equal(members.length,3);
 assert.ok(members.some(m=>m.id==="u4"&&m.papel==="ADMIN"));
 assert.equal((await call(path("restrictions/targets?type=LICITACAO"),"GET",null,{sub:"admin-a"})).status,200);
 assert.equal((await call(path("restrictions/targets?type=NOPE"),"GET",null,{sub:"admin-a"})).status,400);
 assert.equal((await call(path("members/u4/revoke"),"POST",{
  intentId:"f9-self",expectedVersion:1,motivo:"Auto revogação proibida",
  confirmUserId:"u4"},{sub:"admin-a"})).status,409);
});
test("F9 outra conta ADMIN nunca pode ser revogada por corrida entre dois admins",async()=>{
 await db.prepare("INSERT INTO usuarios(id,access_issuer,access_subject,email_normalizado) "+
  "VALUES('u5','"+issuer+"','admin-second','second@invalid.test')").run();
 await db.prepare("INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) "+
  "VALUES('u5','e1','ADMIN',1)").run();
 const r=await call(path("members/u5/revoke"),"POST",{
  intentId:"f9-other-admin",expectedVersion:1,motivo:"Retirada com quorum inseguro",
  confirmUserId:"u5"},{sub:"admin-a"});
 assert.equal(r.status,409);assert.equal((await db.prepare(
  "SELECT ativo FROM usuarios_empresas WHERE usuario_id='u5' AND empresa_id='e1'").first()).ativo,1);
});
test("F9 block exact tender for specific user and audit action locally",async()=>{
 const r=await call(path("restrictions"),"POST",{
  intentId:"f9-block-u3",targetUserId:"u3",tipoEntidade:"LICITACAO",
  entidadeId:"l1",acao:"READ",motivo:"Documento reservado para equipe"},{sub:"admin-a"});
 assert.equal(r.status,201,await r.clone().text());
 assert.ok((await r.json()).restrictionId);
 const roles=await call(path("restrictions?limit=20"),"GET",null,{sub:"admin-a"});
 assert.equal(roles.status,200);
 assert.equal((await roles.json()).items.length,1);
 const r2=await call(path("restrictions"),"POST",{
  intentId:"f9-block-other",targetUserId:"u2",tipoEntidade:"LICITACAO",
  entidadeId:"l1",acao:"READ",motivo:"Tentativa entre empresas"},{sub:"admin-a"});
 assert.ok([403,404].includes(r2.status));
 assert.equal((await call(path("restrictions/targets?type=LICITACAO"),"GET",null,{sub:"reader-a"})).status,403);
});
test("F9 audit restricted to ADMIN and excludes user payloads, paginated",async()=>{
 assert.equal((await call(path("audit"),"GET",null,{sub:"reader-a"})).status,403);
 const r=await call(path("audit?scope=events&limit=30"),"GET",null,{sub:"admin-a"});
 assert.equal(r.status,200,await r.clone().text());
 const body=await r.json();assert.ok(body.items.length>=4);
 assert.equal(JSON.stringify(body).includes("plano_json"),false);
 assert.equal(JSON.stringify(body).includes("payload_privado_ref"),false);
 assert.equal((await call(path("audit?scope=operations&limit=20"),"GET",null,{sub:"admin-a"})).status,200);
 assert.equal((await call(path("audit?scope=secret"),"GET",null,{sub:"admin-a"})).status,400);
});
test("F9 membership revocation server-side with confirmation and immutable journal",async()=>{
 assert.equal((await call(path("members/u3/revoke"),"POST",{
  intentId:"f9-no-confirm",expectedVersion:1,motivo:"Remoção de membro",
  confirmUserId:"u1"},{sub:"admin-a"})).status,400);
 let r=await call(path("members/u3/revoke"),"POST",{
  intentId:"f9-revoke-u3",expectedVersion:1,motivo:"Revogação sintética",
  confirmUserId:"u3"},{sub:"admin-a"});
 assert.equal(r.status,201,await r.clone().text());
 assert.equal((await r.json()).revokedUserId,"u3");
 assert.equal((await db.prepare("SELECT ativo FROM usuarios_empresas "+
  "WHERE empresa_id='e1' AND usuario_id='u3'").first()).ativo,0);
 assert.equal((await call(path("quotes"),"GET",null,{sub:"reader-a"})).status,403);
 assert.equal((await call(path("members/u3/revoke"),"POST",{
  intentId:"f9-revoke-u3-again",expectedVersion:1,motivo:"Revogação sintética",
  confirmUserId:"u3"},{sub:"admin-a"})).status,404);
});
test("F9 final: no messages, no remote R2/migrations and no cross-tenant member access",async()=>{
 assert.equal((await db.prepare("SELECT count(*) AS n FROM notificacoes_envios").first()).n,0);
 assert.equal((await call(path("members","e2"),"GET",null,{sub:"admin-a"})).status,403);
 assert.equal((await call(path("settings"),"GET",null,{sub:"operator-b"})).status,403);
 const secrets=await db.prepare("SELECT count(*) AS n FROM configuracoes "+
  "WHERE chave IN ('oauth_secret','access_token','drive_client_secret')").first();
 assert.equal(secrets.n,0);
});
