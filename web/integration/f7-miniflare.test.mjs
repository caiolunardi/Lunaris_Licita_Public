// F7 real D1 Workerd: Workerd, migrations 0001-0013, JWT RS256 and synthetic tenant data.
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createF7Handler} from "../ui/worker/f7-cashflow.mjs";
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
const path=(resource="overview",company="e1")=>"/api/v1/companies/"+company+"/cash/"+resource;
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
  bindings:{F1_RUNTIME_ENABLED:"test_local_only",F2_RUNTIME_ENABLED:"test_local_only",
   F3_RUNTIME_ENABLED:"test_local_only",F4_RUNTIME_ENABLED:"test_local_only",
   F5_RUNTIME_ENABLED:"test_local_only",F6_RUNTIME_ENABLED:"test_local_only",F7_RUNTIME_ENABLED:"test_local_only",F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
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



const month=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",
 year:"numeric",month:"2-digit"}).formatToParts(new Date());
const y=month.find(x=>x.type==="year").value,m=month.find(x=>x.type==="month").value;
const current=y+"-"+m,monthEnd=new Date(Date.UTC(Number(y),Number(m),0)).getUTCDate();
const due=current+"-"+String(Math.min(monthEnd,22)).padStart(2,"0");
const prior=y+"-"+String(Number(m)===1?12:Number(m)-1).padStart(2,"0")+"-01";
const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
const todaySP=today.find(x=>x.type==="year").value+"-"+today.find(x=>x.type==="month").value+"-"+today.find(x=>x.type==="day").value;
const f6url="/api/v1/companies/e1/fulfillment/invoices";
let accountId=null, nfId=null,creditId=null;
async function f6Invoice(){
 const res=await mf.dispatchFetch(origin+f6url,{method:"POST",headers:{
  origin,"content-type":"application/json","cf-access-jwt-assertion":jwt()},
  body:JSON.stringify({intentId:"f7-f6-invoice-create",parentId:"ep1",
   expectedParentVersion:1,items:[{parentItemId:"ei1",quantidadeMil:2000,valorUnitCent:50000}],
   parcelasCent:[100000]})});
 return res;
}
const income=(intentId,value=20000,extra={})=>({intentId,
 valorRecebidoCent:value,retencaoConfirmadaCent:0,dataCredito:todaySP,
 contaDestino:null,referenciaExterna:null,retencaoAtestadoId:null,...extra});
const schedule=(intentId,version=1,date=due)=>({intentId,expectedVersion:version,
 vencimento:date,motivo:"Prazo combinado com órgão sintético"});
test("F7 fail closed 503 without flags/DB and on remote host",async()=>{
 const f=createF7Handler({fetchKeys:async()=>new Response(JSON.stringify({keys:[jwk]}))});
 const r=await f(new Request(origin+path(),{headers:{"cf-access-jwt-assertion":jwt()}}),{});
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:"f7_not_enabled"});
 assert.equal((await call(path(),"GET",null,{host:"https://licita.lunaris.dev.br"})).status,503);
});
test("F7 JWT/tenant: absent, forged, expired and another company",async()=>{
 for(const token of ["",jwt("operator-a",{},false),jwt("operator-a",{exp:1})])
  assert.equal((await call(path()+"?month="+current,"GET",null,{token})).status,401);
 assert.equal((await call(path()+"?month="+current,"GET",null,{sub:"operator-b"})).status,403);
 assert.equal((await call(path("overview","e2")+"?month="+current,"GET",null,{sub:"operator-b"})).status,200);
});
test("F7 reads F6 receivable and never creates a duplicate title or credit",async()=>{
 const r=await f6Invoice();assert.equal(r.status,201,await r.clone().text());
 nfId=(await r.json()).notaFiscalId;
 const c=await db.prepare("SELECT id,valor_bruto_cent,vencimento FROM contas_receber "+
  "WHERE nota_fiscal_id=?").bind(nfId).first();
 assert.equal(c.valor_bruto_cent,100000);assert.equal(c.vencimento,null);
 accountId=c.id;
 assert.equal((await db.prepare("SELECT count(*) AS n FROM contas_receber WHERE nota_fiscal_id=?")
  .bind(nfId).first()).n,1);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM recebimentos").first()).n,0);
 const overview=await call(path()+"?month="+current);
 assert.equal(overview.status,200,await overview.clone().text());
 const model=await overview.json();
 assert.equal(model.receivable.creditedInMonthCent,0);
 assert.equal(model.receivable.expectedDueInMonthCent,0);
 assert.equal(model.receivable.missingDueCount,1);
 assert.ok(model.warnings.incoming.length>0);
});
test("F7 list/detail obey hierarchy and lack of cash settlement",async()=>{
 const r=await call(path("receivables")+"?state=open&limit=1");
 assert.equal(r.status,200,await r.clone().text());
 const list=await r.json();assert.equal(list.items.length,1);assert.equal(list.items[0].id,accountId);
 const d=await call(path("receivables/"+accountId));
 assert.equal(d.status,200,await d.clone().text());assert.equal((await d.json()).events.length,0);
 assert.equal((await call(path("receivables/"+accountId),"GET",null,{sub:"operator-b"})).status,403);
 assert.equal((await call(path("receivables/"+accountId+"/credits"),"POST",income("f7-reader",1000),
  {sub:"reader-a"})).status,403);
});
test("F7 versioned due date, journal/audit, retry and stale CAS",async()=>{
 const r=await call(path("receivables/"+accountId+"/schedule"),"PATCH",schedule("f7-due-1"));
 assert.equal(r.status,200,await r.clone().text());
 assert.equal((await r.json()).newVersion,2);
 const item=await db.prepare("SELECT vencimento,versao FROM contas_receber WHERE id=?").bind(accountId).first();
 assert.equal(item.vencimento,due);assert.equal(item.versao,2);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM eventos_auditoria WHERE operacao_id='f7-due-1'").first()).n,1);
 assert.equal((await call(path("receivables/"+accountId+"/schedule"),"PATCH",schedule("f7-due-1"))).status,200);
 assert.equal((await call(path("receivables/"+accountId+"/schedule"),"PATCH",schedule("f7-due-stale"))).status,409);
 assert.equal((await call(path("receivables/"+accountId+"/schedule"),"PATCH",
  {...schedule("f7-invalid-date",2),"vencimento":"2026-02-30"})).status,400);
});
test("F7 scheduled expected money is NOT credited income",async()=>{
 const r=await call(path()+"?month="+current);
 assert.equal(r.status,200,await r.clone().text());
 const s=await r.json();assert.equal(s.receivable.expectedDueInMonthCent,100000);
 assert.equal(s.receivable.creditedInMonthCent,0);
 assert.equal(s.receivable.missingDueCount,0);
});
test("F7 R7 partial credit creates only actual bank inflow and reduces residual",async()=>{
 const r=await call(path("receivables/"+accountId+"/credits"),"POST",income("f7-credit-1"));
 assert.equal(r.status,201,await r.clone().text());
 creditId=(await r.json()).creditId;assert.ok(creditId);
 const d=await(await call(path("receivables/"+accountId))).json();
 assert.equal(d.item.saldo_cent,80000);assert.equal(d.item.creditado_cent,20000);
 assert.equal(d.events.length,1);
 const s=await(await call(path()+"?month="+current)).json();
 assert.equal(s.receivable.creditedInMonthCent,20000);
 assert.equal(s.receivable.expectedDueInMonthCent,80000);
 assert.equal(s.receivable.retainedInMonthCent,0);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM contas_receber WHERE nota_fiscal_id=?")
  .bind(nfId).first()).n,1);
});
test("F7 credit idempotence, conflicting intent and excess fail closed",async()=>{
 assert.equal((await call(path("receivables/"+accountId+"/credits"),"POST",income("f7-credit-1"))).status,200);
 assert.equal((await call(path("receivables/"+accountId+"/credits"),"POST",income("f7-credit-1",19999))).status,409);
 assert.equal((await call(path("receivables/"+accountId+"/credits"),"POST",income("f7-credit-over",80001))).status,409);
 assert.equal((await call(path("receivables/"+accountId+"/credits"),"POST",
  income("f7-credit-future",1000,{dataCredito:"2099-12-31"}))).status,400);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM recebimentos WHERE tipo_movimento='RECEBIMENTO'").first()).n,1);
});
test("F7 retentions cannot become imaginary cash, require verified attestation",async()=>{
 const r=await call(path("receivables/"+accountId+"/credits"),"POST",
  income("f7-unattested",10000,{retencaoConfirmadaCent:5000}));
 assert.equal(r.status,409,await r.clone().text());
 assert.equal((await call(path("receivables/"+accountId+"/retentions"),"POST",
  {intentId:"f7-at-reader",documentoVersaoId:"missing",valorConfirmadoCent:500},
  {sub:"reader-a"})).status,403);
 const a=await call(path("receivables/"+accountId+"/retentions"),"POST",
  {intentId:"f7-at-missing",documentoVersaoId:"missing",valorConfirmadoCent:500},
  {sub:"admin-a"});
 assert.ok([404,409].includes(a.status),await a.clone().text());
});
test("F7 reversal never erases original, and increases remaining amount",async()=>{
 const r=await call(path("receivables/"+accountId+"/credits/"+creditId+"/reverse"),
  "POST",{intentId:"f7-reverse-1",motivo:"Lançado em conta incorreta"});
 assert.equal(r.status,201,await r.clone().text());
 const d=await(await call(path("receivables/"+accountId))).json();
 assert.equal(d.events.length,2);assert.equal(d.item.saldo_cent,100000);
 const s=await(await call(path()+"?month="+current)).json();
 assert.equal(s.receivable.creditedInMonthCent,0);
 assert.equal(s.receivable.expectedDueInMonthCent,100000);
 assert.equal((await call(path("receivables/"+accountId+"/credits/"+creditId+"/reverse"),
  "POST",{intentId:"f7-reverse-1",motivo:"Lançado em conta incorreta"})).status,200);
 assert.equal((await call(path("receivables/"+accountId+"/credits/"+creditId+"/reverse"),
  "POST",{intentId:"f7-reverse-2",motivo:"Outra tentativa"})).status,409);
});
test("F7 due schedule refuses historical credit even when reversed",async()=>{
 assert.equal((await call(path("receivables/"+accountId+"/schedule"),"PATCH",schedule("f7-after-credit",2))).status,409);
});
test("F7 titles payable and recurring count once, past due counted before spend",async()=>{
 for(const sql of [
  "INSERT INTO titulos_pagar(id,empresa_id,tipo,beneficiario,categoria_despesa,valor_nominal_cent,vencimento,conferencia) VALUES('out1','e1','DIVERSO','Conta de infraestrutura','Serviços',12000,'"+due+"','VALIDADO')",
  "INSERT INTO titulos_pagar(id,empresa_id,tipo,beneficiario,categoria_despesa,valor_nominal_cent,vencimento,conferencia) VALUES('outold','e1','DIVERSO','Conta vencida antiga','Serviços',3000,'"+prior+"','VALIDADO')",
  "INSERT INTO recorrencias(id,empresa_id,beneficiario,categoria_despesa,valor_atual_cent,dia_vencimento,primeiro_vencimento,estado,conferencia) VALUES('rec1','e1','Internet mensal','Conectividade',4000,18,'"+current+"-18','ATIVA','VALIDADO')",
  "INSERT INTO titulos_pagar(id,empresa_id,tipo,beneficiario,categoria_despesa,valor_nominal_cent,vencimento,recorrencia_id,competencia,conferencia) VALUES('outrec','e1','DIVERSO','Internet materializada','Conectividade',4000,'"+current+"-18','rec1','"+current+"','VALIDADO')",
  "INSERT INTO recorrencias(id,empresa_id,beneficiario,categoria_despesa,valor_atual_cent,dia_vencimento,primeiro_vencimento,estado,conferencia) VALUES('rec2','e1','Aluguel mensal','Operação',15000,25,'"+current+"-25','ATIVA','VALIDADO')"
 ])await db.prepare(sql).run();
 const s=await(await call(path()+"?month="+current)).json();
 assert.equal(s.payable.outstandingToEndCent,34000);
 assert.equal(s.payable.dueInMonthCent,31000);
 assert.equal(s.payable.overdueBeforeMonthCent,3000);
 assert.equal(s.payable.recurringNotMaterializedCent,15000);
 assert.equal(s.payable.openCount,4);
});
test("F7 real payment decreases outstanding only; no double subtraction",async()=>{
 const r=await call("/api/v1/companies/e1/finance/titles/out1/payments","POST",{
  intentId:"f7-expense-pay",expectedVersion:1,dataPagamento:due,valorPagoCent:12000});
 assert.equal(r.status,201,await r.clone().text());
 const s=await(await call(path()+"?month="+current)).json();
 assert.equal(s.payable.outstandingToEndCent,22000);
 assert.equal(s.payable.paidInMonthCent,12000);
});
test("F7 unknown historical payable blocks safe estimate instead of ignoring value",async()=>{
 await db.prepare("INSERT INTO titulos_pagar(id,empresa_id,tipo,beneficiario,categoria_despesa,valor_nominal_cent,vencimento,origem_dado,conferencia) "+
  "VALUES('old-unknown','e1','DIVERSO','Conta legada não revista','Histórico',1000,?,'LEGADO','PENDENTE')").bind(due).run();
 const s=await(await call(path()+"?month="+current)).json();
 assert.equal(s.eligibleForSpendEstimate,false);
 assert.ok(s.warnings.outgoing.length>0);
});
test("F7 aggregate denied if any financial item blocked; no misleading partial totals",async()=>{
 await db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado) "+
  "VALUES('f7-acl-op','e1','R7_BLOQUEIO_ENTIDADE','synthetic','u4','CONCLUIDA')").run();
 await db.prepare("INSERT INTO r7_acl_bloqueios(id,empresa_id,usuario_id,tipo_entidade,entidade_id,acao,motivo,ator_id,operacao_id) "+
  "VALUES('f7-acl-1','e1','u3','TITULO_PAGAR','out1','READ','Restrito','u4','f7-acl-op')").run();
 assert.equal((await call(path()+"?month="+current,"GET",null,{sub:"reader-a"})).status,403);
 assert.equal((await call(path()+"?month="+current,"GET",null,{sub:"admin-a"})).status,200);
});
test("F7 blocked receipt prevents detail and list residual disclosure",async()=>{
 const r=await db.prepare("SELECT id FROM recebimentos WHERE conta_receber_id=? LIMIT 1").bind(accountId).first();
 await db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado) "+
  "VALUES('f7-acl-op-2','e1','R7_BLOQUEIO_ENTIDADE','synthetic','u4','CONCLUIDA')").run();
 await db.prepare("INSERT INTO r7_acl_bloqueios(id,empresa_id,usuario_id,tipo_entidade,entidade_id,acao,motivo,ator_id,operacao_id) "+
  "VALUES('f7-acl-2','e1','u3','RECEBIMENTO',?,'READ','Restrito','u4','f7-acl-op-2')").bind(r.id).run();
 assert.equal((await call(path("receivables/"+accountId),"GET",null,{sub:"reader-a"})).status,404);
 const list=await(await call(path("receivables")+"?state=all","GET",null,{sub:"reader-a"})).json();
 assert.equal(list.items.some(x=>x.id===accountId),false);
});
test("F7 request contracts: unknown query, origin, verb and privileged fields denied",async()=>{
 for(const suffix of ["?month=2026-13","?month="+current+"&export=1",
  "?month="+current+"&month="+current])
  assert.equal((await call(path()+suffix)).status,400);
 for(const suffix of ["?limit=0","?limit=100","?state=other","?after=../../bad",
  "?limit=1&limit=2"])
  assert.equal((await call(path("receivables")+suffix)).status,400);
 assert.equal((await call(path("receivables"),"DELETE")).status,405);
 assert.equal((await call(path("receivables/"+accountId+"/credits"),"POST",income("f7-bad-origin"),
  {headers:{origin:"https://evil.invalid"}})).status,403);
 assert.equal((await call(path("receivables/"+accountId+"/credits"),"POST",
  {...income("f7-bad-actor"),ator_id:"u4"})).status,400);
 assert.equal((await call(path("receivables/"+accountId+"/credits"),"POST",
  {...income("f7-bad-company"),empresa_id:"e2"})).status,400);
});
test("F7 tenant B cannot see A invoice or monthly income",async()=>{
 const overview=await call(path("overview","e2")+"?month="+current,"GET",null,{sub:"operator-b"});
 assert.equal(overview.status,200);
 assert.equal((await overview.json()).receivable.remainingTotalCent,0);
 assert.equal((await call(path("receivables/"+accountId,"e2"),"GET",null,{sub:"operator-b"})).status,404);
});
