// F5 regression: Workerd, migrations 0001-0013, JWT RS256 and synthetic tenant data.
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createF5Handler} from "../ui/worker/f5-commercial.mjs";
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
const path=(resource="commitments",company="e1")=>"/api/v1/companies/"+company+"/commercial/"+resource;
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
   F5_RUNTIME_ENABLED:"test_local_only",F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
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
});
after(async()=>await mf?.dispose());

test("F5 503 por padrão sem flags e D1",async()=>{
 const handler=createF5Handler({fetchKeys:async()=>new Response(JSON.stringify({keys:[jwk]}))});
 const res=await handler(new Request(origin+path(),{headers:{"cf-access-jwt-assertion":jwt()}}),{});
 assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:"f5_not_enabled"});
});
test("F5 não liga APIs em hostname de produção mesmo com fixtures local",async()=>{
 const res=await call(path(),"GET",null,{host:"https://licita.lunaris.dev.br"});
 assert.equal(res.status,503);
});
test("F5 autentica token JWT RS256 e rejeita fraude/ausência/expiração",async()=>{
 for(const tok of ["",jwt("operator-a",{},false),jwt("operator-a",{aud:"invalid"}),
   jwt("operator-a",{exp:1})])assert.equal((await call(path(),"GET",null,{token:tok})).status,401);
});
test("F5 isolamento multiempresa, CONSULTA apenas GET",async()=>{
 assert.equal((await call(path("commitments","e2"),"GET",null,{sub:"operator-b"})).status,200);
 assert.equal((await call(path("tenders")+"/l1/available","GET",null,{sub:"operator-b"})).status,403);
 assert.equal((await call(path("tenders")+"/l1/available","GET",null,{sub:"reader-a"})).status,200);
 assert.equal((await call(path(),"POST",commit("reader-commit","E 001",[line("li1",1000)]),{sub:"reader-a"})).status,403);
});
test("F5 saldo empenhável mostra somente itens GANHO, não o item perdido",async()=>{
 const response=await call(path("tenders")+"/l1/available");
 assert.equal(response.status,200,await response.clone().text());
 const d=await response.json();
 assert.deepEqual(d.items.map(x=>x.id),["li1","li2"]);
 assert.deepEqual(d.items.map(x=>x.remaining_mil),[6000,2000]);
});
test("F5 cria primeiro empenho somente após ganho sem NF/compra/receita",async()=>{
 const result=await call(path(),"POST",commit("commit-1","EMP F5 A",[line("li1",4000)]));
 assert.equal(result.status,201,await result.clone().text());
 ep1=(await result.json()).empenhoId;assert.ok(ep1);
 const row=await db.prepare("SELECT * FROM empenhos WHERE id=?").bind(ep1).first();
 assert.equal(row.empresa_id,"e1");assert.equal(row.situacao,"CONFIRMADO");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM empenho_itens WHERE empenho_id=?").bind(ep1).first()).n,1);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM compras").first()).n,0);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM contas_receber").first()).n,0);
});
test("F5 aceita segundo empenho fracionado e computa resto exato",async()=>{
 const a=await call(path(),"POST",commit("commit-2","EMP F5 B",[line("li1",2000),line("li2",1000,20000)]));
 assert.equal(a.status,201,await a.clone().text());ep2=(await a.json()).empenhoId;
 const detail=(await(await call(path("tenders")+"/l1/available")).json());
 assert.deepEqual(detail.items.map(x=>x.remaining_mil),[0,1000]);
 const res=await call(path(),"POST",commit("commit-over","EMP excesso",[line("li1",1)]));
 assert.equal(res.status,409,await res.clone().text());
 assert.equal((await db.prepare("SELECT count(*) AS n FROM empenhos WHERE licitacao_id='l1'").first()).n,2);
});
test("F5 R7 rejeita item perdido, outro tenant ou intenção contaminada",async()=>{
 for(const [id,record] of [
  ["lost",commit("commit-lost","EMP LOST",[line("li3",1000)])],
  ["missing",commit("commit-missing","EMP MISS",[line("li-no",1000)])],
  ["cross",commit("commit-cross","EMP CROSS",[line("e2-secret",1000)])],
  ["tenant",commit("commit-tenant","EMP TENANT",[line("li1",1000)],{empresa_id:"e2"})]
 ]){
  const res=await call(path(),"POST",record);
  assert.ok([400,403,404,409].includes(res.status),id+" "+res.status);
 }
});
test("F5 replay idempotente do empenho e divergência 409",async()=>{
 const payload=commit("commit-1","EMP F5 A",[line("li1",4000)]);
 const a=await call(path(),"POST",payload);
 assert.equal(a.status,200);assert.equal((await a.json()).replayed,true);
 assert.equal((await call(path(),"POST",{...payload,numero:"Novo"})).status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM empenhos WHERE operacao_id='commit-1'").first()).n,1);
});
test("F5 lista paginada; ficha e itens autorizados",async()=>{
 const r=await call(path()+"?limit=1");
 assert.equal(r.status,200,await r.clone().text());
 const a=await r.json();assert.equal(a.items.length,1);assert.ok(a.nextCursor);
 const b=await(await call(path()+"?limit=1&after="+a.nextCursor)).json();
 assert.equal(b.items.length,1);assert.notEqual(a.items[0].id,b.items[0].id);
 const d=await call(path()+"/"+ep1);
 assert.equal(d.status,200,await d.clone().text());
 const obj=await d.json();assert.equal(obj.items.length,1);
 assert.equal(obj.item.numero,"EMP F5 A");
});
test("F5 disponível para comprar respeita empenho confirmado e quantidade",async()=>{
 const result=await call(path()+"/"+ep1+"/available");
 assert.equal(result.status,200,await result.clone().text());
 const d=await result.json();assert.equal(d.items.length,1);
 assert.equal(d.items[0].remaining_mil,4000);
});
test("F5 compra exige fornecedor ativo do mesmo tenant",async()=>{
 const ei=(await db.prepare("SELECT id FROM empenho_itens WHERE empenho_id=?").bind(ep1).first()).id;
 for(const supplier of ["s3","s4","none"]){
  const res=await call(path("purchases"),"POST",purchase("purchase-invalid-"+supplier,ep1,"Pedido "+supplier,[line(ei,1000)],{fornecedorId:supplier}));
  assert.equal(res.status,409,supplier+" "+res.status);
 }
});
test("F5 cria compra confirmada com fornecedor e saldos (sem boleto automático)",async()=>{
 const ei=(await db.prepare("SELECT id FROM empenho_itens WHERE empenho_id=?").bind(ep1).first()).id;
 const response=await call(path("purchases"),"POST",purchase("purchase-1",ep1,"PED F5 A",[line(ei,2500,8500)]));
 assert.equal(response.status,201,await response.clone().text());
 purchase1=(await response.json()).compraId;
 const row=await db.prepare("SELECT * FROM compras WHERE id=?").bind(purchase1).first();
 assert.equal(row.fornecedor_id,"s1");assert.equal(row.situacao,"CONFIRMADA");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM titulos_pagar").first()).n,0);
 const avail=(await(await call(path()+"/"+ep1+"/available")).json());
 assert.equal(avail.items[0].remaining_mil,1500);
});
test("F5 múltiplas compras permitidas até limite; excesso rejeitado atomicamente",async()=>{
 const ei=(await db.prepare("SELECT id FROM empenho_itens WHERE empenho_id=?").bind(ep1).first()).id;
 const another=await call(path("purchases"),"POST",purchase("purchase-2",ep1,"PED F5 B",[line(ei,1500)]));
 assert.equal(another.status,201,await another.clone().text());
 const exceeding=await call(path("purchases"),"POST",purchase("purchase-over",ep1,"PED excesso",[line(ei,1)]));
 assert.equal(exceeding.status,409,await exceeding.clone().text());
 assert.equal((await db.prepare("SELECT count(*) AS n FROM compras WHERE empenho_id=?").bind(ep1).first()).n,2);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM titulo_baixas").first()).n,0);
});
test("F5 registra frete e custo adicional com CAS, journal e auditoria sem boleto",async()=>{
 const payload={intentId:"purchase-cost-1",expectedVersion:1,freteCent:3000,outrosCustosCent:250,
  condicaoPagamento:"Pagamento estimado em 30 dias",dataCompra:"2026-11-08",
  previsaoDespacho:null,previsaoEntrega:"2026-12-01"};
 const r=await call(path("purchases")+"/"+purchase1,"PATCH",payload);
 assert.equal(r.status,200,await r.clone().text());
 assert.equal((await r.json()).newVersion,2);
 const detail=(await(await call(path("purchases")+"/"+purchase1)).json()).item;
 assert.equal(detail.frete_cent,3000);
 assert.equal(detail.outros_custos_cent,250);
 assert.equal(detail.condicao_pagamento,"Pagamento estimado em 30 dias");
 assert.equal(detail.data_compra,"2026-11-08");
 assert.equal(detail.previsao_entrega,"2026-12-01");
 assert.equal(detail.versao,2);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM operacoes WHERE id='purchase-cost-1'").first()).n,1);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM eventos_auditoria WHERE operacao_id='purchase-cost-1'").first()).n,1);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM titulos_pagar").first()).n,0);
 const replay=await call(path("purchases")+"/"+purchase1,"PATCH",payload);
 assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
 assert.equal((await call(path("purchases")+"/"+purchase1,"PATCH",
  {...payload,intentId:"purchase-cost-stale"})).status,409);
 assert.equal((await call(path("purchases")+"/"+purchase1,"PATCH",
  {...payload,freteCent:3001})).status,409);
});
test("F5 custos rejeitam datas ruins, campos privilegiados e outro tenant",async()=>{
 const base={intentId:"purchase-cost-bad",expectedVersion:2,freteCent:0,outrosCustosCent:0,
  condicaoPagamento:null,dataCompra:null,previsaoDespacho:null,previsaoEntrega:null};
 for(const val of [
  {...base,dataCompra:"2026-02-31"},
  {...base,freteCent:-1},
  {...base,freteCent:1.5},
  {...base,empresa_id:"e2"},
  {...base,fornecedorId:"s2"}
 ]){
  const r=await call(path("purchases")+"/"+purchase1,"PATCH",val);
  assert.equal(r.status,400,await r.clone().text());
 }
 assert.equal((await call(path("purchases")+"/"+purchase1,"PATCH",base,
  {sub:"operator-b"})).status,403);
 assert.equal((await call(path("purchases")+"/"+purchase1,"PATCH",base,
  {headers:{origin:"https://bad.invalid"}})).status,403);
 const ok=await call(path("purchases")+"/"+purchase1,"PATCH",
  {...base,intentId:"purchase-cost-2"});
 assert.equal(ok.status,200,await ok.clone().text());
 const after=(await db.prepare("SELECT frete_cent,outros_custos_cent,versao FROM compras WHERE id=?")
  .bind(purchase1).first());
 assert.deepEqual([after.frete_cent,after.outros_custos_cent,after.versao],[0,0,3]);
});
test("F5 idempotência também protege fornecedor no replay R7",async()=>{
 const ei=(await db.prepare("SELECT id FROM empenho_itens WHERE empenho_id=?").bind(ep1).first()).id;
 const same=await call(path("purchases"),"POST",purchase("purchase-1",ep1,"PED F5 A",[line(ei,2500,8500)]));
 assert.equal(same.status,200,await same.clone().text());assert.equal((await same.json()).replayed,true);
 const changed=await call(path("purchases"),"POST",purchase("purchase-1",ep1,"PED F5 A",[line(ei,2500,8500)],{fornecedorId:"s2"}));
 assert.equal(changed.status,409);assert.equal((await changed.json()).error,"idempotency_conflict");
});
test("F5 detalhe compra e cursor de fornecedor não vazam outro tenant",async()=>{
 const d=await call(path("purchases")+"/"+purchase1);
 assert.equal(d.status,200,await d.clone().text());
 const x=await d.json();assert.equal(x.item.fornecedor_nome,"Fornecedor Válido");
 assert.equal(x.items.length,1);
 assert.equal((await call(path("purchases")+"/"+purchase1,"GET",null,{sub:"operator-b"})).status,403);
 assert.equal((await call(path("purchases","e2")+"?after="+purchase1,"GET",null,{sub:"operator-b"})).status,400);
});
test("F5 filtros, verbs, Origin, MIME e payload privilegiante fail-closed",async()=>{
 for(const q of ["?limit=0","?limit=51","?after=../hack","?sort=escondido","?limit=1&limit=2","?q="+"x".repeat(81)])
  assert.equal((await call(path()+q)).status,400,q);
 assert.equal((await call(path(),"DELETE")).status,405);
 assert.equal((await call(path(),"POST",commit("bad-origin","X",[line("li1",100)]),{headers:{origin:"https://evil.invalid"}})).status,403);
 assert.equal((await call(path(),"POST",commit("bad-type","X",[line("li1",100)]),{headers:{"content-type":"text/plain"}})).status,415);
 assert.equal((await call(path(),"POST",{...commit("huge","X",[line("li1",100)]),junk:"z".repeat(9000)})).status,413);
 assert.equal((await call(path(),"POST",{...commit("forged","X",[line("li1",100)]),ator_id:"u4"})).status,400);
});
test("F5 ACL negativa impede detalhe, available e ações mesmo com empresa válida",async()=>{
 const sql=[
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado) VALUES('f5-acl-op','e1','R7_BLOQUEIO_ENTIDADE','synthetic','u4','CONCLUIDA')",
  "INSERT INTO r7_acl_bloqueios(id,empresa_id,usuario_id,tipo_entidade,entidade_id,acao,motivo,ator_id,operacao_id) VALUES('f5-acl','e1','u1','EMPENHO','"+ep1+"','READ','Revisão de acesso','u4','f5-acl-op')"
 ];
 for(const row of sql)await db.prepare(row).run();
 assert.equal((await call(path()+"/"+ep1)).status,404);
 assert.ok(!(await(await call(path())).json()).items.some(x=>x.id===ep1));
 assert.equal((await call(path()+"/"+ep1+"/available")).status,404);
 assert.equal((await call(path()+"/"+ep1,"GET",null,{sub:"admin-a"})).status,200);
});
test("F5 ACL negativa em linha de item oculta ficha integral",async()=>{
 const ei=(await db.prepare("SELECT id FROM empenho_itens WHERE empenho_id=?").bind(ep2).first()).id;
 const sql=[
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado) VALUES('f5-item-acl-op','e1','R7_BLOQUEIO_ENTIDADE','synthetic','u4','CONCLUIDA')",
  "INSERT INTO r7_acl_bloqueios(id,empresa_id,usuario_id,tipo_entidade,entidade_id,acao,motivo,ator_id,operacao_id) VALUES('f5-item-acl','e1','u3','EMPENHO_ITEM','"+ei+"','READ','Revisão de acesso','u4','f5-item-acl-op')"
 ];
 for(const row of sql)await db.prepare(row).run();
 assert.equal((await call(path()+"/"+ep2,"GET",null,{sub:"reader-a"})).status,404);
 assert.equal((await call(path()+"/"+ep2,"GET",null,{sub:"admin-a"})).status,200);
});
