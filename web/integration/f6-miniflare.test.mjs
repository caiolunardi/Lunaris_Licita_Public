// F5 regression: Workerd, migrations 0001-0013, JWT RS256 and synthetic tenant data.
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createF6Handler} from "../ui/worker/f6-fulfillment.mjs";
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
const path=(resource="shipments",company="e1")=>"/api/v1/companies/"+company+"/fulfillment/"+resource;
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
   F5_RUNTIME_ENABLED:"test_local_only",F6_RUNTIME_ENABLED:"test_local_only",F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
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


const shipment=(intentId,q)=>({intentId,parentId:"ep1",expectedParentVersion:1,
 items:[{parentItemId:"ci1",quantidadeMil:q}]});
const invoice=(intentId,q,price=10000,parts)=>({intentId,parentId:"ep1",expectedParentVersion:1,
 items:[{parentItemId:"ei1",quantidadeMil:q,valorUnitCent:price}],parcelasCent:parts});
let sh1,nf1;
test("F6 fail closed sem DB/flags e em host remoto, mesmo com flags",async()=>{
 const handler=createF6Handler({fetchKeys:async()=>new Response(JSON.stringify({keys:[jwk]}))});
 let r=await handler(new Request(origin+path(),{headers:{"cf-access-jwt-assertion":jwt()}}),{});
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:"f6_not_enabled"});
 r=await call(path(),"GET",null,{host:"https://licita.lunaris.dev.br"});
 assert.equal(r.status,503);
});
test("F6 rejeita autenticação ausente, forjada e autorização interempresa",async()=>{
 for(const token of ["",jwt("operator-a",{},false),jwt("operator-a",{exp:1})]){
  assert.equal((await call(path(),"GET",null,{token})).status,401);
 }
 assert.equal((await call(path("commitments/ep1/available-to-ship"),"GET",null,{sub:"operator-b"})).status,403);
 assert.equal((await call(path("shipments","e2"),"GET",null,{sub:"operator-b"})).status,200);
 assert.equal((await call(path(),"POST",shipment("r6-reader",500),{sub:"reader-a"})).status,403);
});
test("F6 available-to-ship deriva compra confirmada, saldo e fornecedor",async()=>{
 const r=await call(path("commitments/ep1/available-to-ship"));
 assert.equal(r.status,200,await r.clone().text());
 const a=await r.json();assert.equal(a.parent.id,"ep1");assert.equal(a.items.length,1);
 assert.equal(a.items[0].id,"ci1");assert.equal(a.items[0].remaining_mil,4000);
});
test("F6 cria nota antes da entrega com parcelas exatas, sem crédito bancário",async()=>{
 const r=await call(path("invoices"),"POST",invoice("f6-invoice-1",2000,10000,[12000,8000]));
 assert.equal(r.status,201,await r.clone().text());nf1=(await r.json()).notaFiscalId;
 const nf=await db.prepare("SELECT * FROM notas_fiscais WHERE id=?").bind(nf1).first();
 assert.equal(nf.valor_documento_cent,20000);assert.equal(nf.situacao,"EMITIDA");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM contas_receber WHERE nota_fiscal_id=?")
  .bind(nf1).first()).n,2);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM recebimentos").first()).n,0);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM envios").first()).n,0);
});
test("F6 nota com parcelas divergentes/excesso falha atomicamente",async()=>{
 for(const payload of [invoice("f6-nf-bad",2000,10000,[19999]),
   invoice("f6-nf-over",4000,10000,[40000])]){
  const r=await call(path("invoices"),"POST",payload);
  assert.ok([409,400].includes(r.status),await r.clone().text());
 }
 assert.equal((await db.prepare("SELECT count(*) AS n FROM notas_fiscais").first()).n,1);
});
test("F6 consulta nota e saldo faturável autorizados e sem vazamento",async()=>{
 const a=await call(path("commitments/ep1/available-to-invoice"));
 assert.equal(a.status,200,await a.clone().text());
 assert.equal((await a.json()).items[0].remaining_mil,3000);
 const d=await call(path("invoices/")+nf1);
 assert.equal(d.status,200,await d.clone().text());
 const doc=await d.json();assert.equal(doc.items.length,1);assert.equal(doc.parcelas.length,2);
 assert.equal(doc.selo,null);
 assert.equal((await call(path("invoices/")+nf1,"GET",null,{sub:"operator-b"})).status,403);
});
test("F6 grava metadados de nota com CAS, journal e audit antes do selo",async()=>{
 const data={intentId:"f6-nf-meta",expectedVersion:1,numero:"123",serie:"1",
  chaveAcesso:null,emissao:"2026-11-08",protocolo:"Protocolo sintético",
  apresentadaEm:null,observacoes:null};
 const r=await call(path("invoices/")+nf1+"/metadata","PATCH",data);
 assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).newVersion,2);
 assert.equal((await db.prepare("SELECT numero,emissao,versao FROM notas_fiscais WHERE id=?").bind(nf1).first()).numero,"123");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM eventos_auditoria WHERE operacao_id='f6-nf-meta'").first()).n,1);
 assert.equal((await call(path("invoices/")+nf1+"/metadata","PATCH",data)).status,200);
 assert.equal((await call(path("invoices/")+nf1+"/metadata","PATCH",
  {...data,intentId:"f6-nf-stale"})).status,409);
});
test("F6 concilia a NF e bloqueia alterações após selo",async()=>{
 const payload={intentId:"f6-nf-seal",notaFiscalId:nf1,expectedVersion:2};
 const r=await call(path("invoices/")+nf1+"/confirm","POST",payload);
 assert.equal(r.status,201,await r.clone().text());
 assert.ok((await r.json()).sealId);
 assert.equal((await call(path("invoices/")+nf1+"/confirm","POST",payload)).status,200);
 const patch={intentId:"f6-nf-meta-after",expectedVersion:2,numero:"124",serie:"1",
  chaveAcesso:null,emissao:null,protocolo:null,apresentadaEm:null,observacoes:null};
 assert.equal((await call(path("invoices/")+nf1+"/metadata","PATCH",patch)).status,409);
});
test("F6 retificação exige ADMIN, mantém histórico e cria nova NF com parcelas",async()=>{
 const data={intentId:"f6-nf-rectify",notaFiscalOriginalId:nf1,expectedVersion:2,
  motivo:"Revisão tributária sintética",items:[{empenhoItemId:"ei1",quantidadeMil:2000,valorUnitCent:12000}],
  parcelasCent:[12000,12000]};
 assert.equal((await call(path("invoices/")+nf1+"/rectify","POST",data)).status,403);
 const r=await call(path("invoices/")+nf1+"/rectify","POST",data,{sub:"admin-a"});
 assert.equal(r.status,201,await r.clone().text());
 const result=await r.json();assert.ok(result.notaFiscalSubstitutaId);
 assert.equal((await db.prepare("SELECT situacao FROM notas_fiscais WHERE id=?").bind(nf1).first()).situacao,"CANCELADA");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM nf_retificacoes WHERE nota_original_id=?").bind(nf1).first()).n,1);
 assert.equal((await call(path("invoices/")+nf1+"/rectify","POST",
  {...data,intentId:"f6-nf-again"},{sub:"admin-a"})).status,409);
});
test("F6 cria remessas parciais dentro de compra confirmada",async()=>{
 const r=await call(path(),"POST",shipment("f6-ship-1",1500));
 assert.equal(r.status,201,await r.clone().text());sh1=(await r.json()).envioId;
 assert.equal((await db.prepare("SELECT situacao FROM envios WHERE id=?").bind(sh1).first()).situacao,"DESPACHADO");
 assert.equal((await call(path(),"POST",shipment("f6-ship-2",2000))).status,201);
 const av=await (await call(path("commitments/ep1/available-to-ship"))).json();
 assert.equal(av.items[0].remaining_mil,500);
 assert.equal((await call(path(),"POST",shipment("f6-ship-over",501))).status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM envios").first()).n,2);
});
test("F6 remessa replay mesma intenção sem duplicar e mudança gera conflito",async()=>{
 assert.equal((await call(path(),"POST",shipment("f6-ship-1",1500))).status,200);
 assert.equal((await call(path(),"POST",shipment("f6-ship-1",1400))).status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM envios WHERE empenho_id='ep1'").first()).n,2);
});
test("F6 ficha remessa devolve item de compra e rejeita outro tenant",async()=>{
 const r=await call(path()+"/"+sh1);
 assert.equal(r.status,200,await r.clone().text());
 const d=await r.json();assert.equal(d.items[0].compra_item_id,"ci1");
 assert.equal((await call(path()+"/"+sh1,"GET",null,{sub:"operator-b"})).status,403);
});
test("F6 não marca ENTREGA antes de aceite total, URL exige HTTPS",async()=>{
 const m={intentId:"f6-meta-1",expectedVersion:1,situacao:"ENTREGUE",
  transportadora:"Logística fictícia",codigoRastreio:"TRACK F6",urlRastreio:"https://carrier.example/123",
  dataDespacho:"2026-11-08",previsaoEntrega:"2026-11-12",dataEntrega:"2026-11-12",
  recebedor:"Pessoa fictícia",enderecoEntrega:"Local fictício",observacoes:null};
 assert.equal((await call(path()+"/"+sh1+"/metadata","PATCH",m)).status,409);
 assert.equal((await call(path()+"/"+sh1+"/metadata","PATCH",
  {...m,intentId:"f6-meta-badurl",situacao:"DESPACHADO",urlRastreio:"javascript:alert(1)"})).status,400);
 assert.equal((await call(path()+"/"+sh1+"/metadata","PATCH",
  {...m,intentId:"f6-meta-ok",situacao:"DESPACHADO"})).status,200);
});
test("F6 recusa parcial exige motivo, aceita totais e mantém CAS por item",async()=>{
 const row=await db.prepare("SELECT id FROM envio_itens WHERE envio_id=?").bind(sh1).first();
 const body={intentId:"f6-accept-1",envioId:sh1,envioItemId:row.id,expectedVersion:1,
  quantidadeAceitaMil:500,quantidadeRecusadaMil:1000,motivoRecusa:"Produto avariado"};
 const r=await call(path()+"/"+sh1+"/acceptances","POST",body);
 assert.equal(r.status,201,await r.clone().text());
 const line=await db.prepare("SELECT * FROM envio_itens WHERE id=?").bind(row.id).first();
 assert.deepEqual([line.quantidade_aceita_mil,line.quantidade_recusada_mil],[500,1000]);
 assert.equal((await call(path()+"/"+sh1+"/acceptances","POST",body)).status,200);
 assert.equal((await call(path()+"/"+sh1+"/acceptances","POST",
  {...body,intentId:"f6-accept-stale"})).status,409);
});
test("F6 metadados ENTREGUE após aceite integral; não altera recebíveis",async()=>{
 const m={intentId:"f6-meta-entregue",expectedVersion:2,situacao:"ENTREGUE",
  transportadora:"Logística fictícia",codigoRastreio:"TRACK F6",urlRastreio:"https://carrier.example/123",
  dataDespacho:"2026-11-08",previsaoEntrega:"2026-11-12",dataEntrega:"2026-11-12",
  recebedor:"Pessoa fictícia",enderecoEntrega:"Local fictício",observacoes:"Recebimento parcial aceito"};
 const r=await call(path()+"/"+sh1+"/metadata","PATCH",m);
 assert.equal(r.status,200,await r.clone().text());
 assert.equal((await db.prepare("SELECT situacao FROM envios WHERE id=?").bind(sh1).first()).situacao,"ENTREGUE");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM recebimentos").first()).n,0);
});
test("F6 valida verbo, JSON, Origin, campos privilegiados e cursor",async()=>{
 for(const url of [path()+"?limit=0",path()+"?limit=100",path()+"?sort=internal",
  path()+"?after=../escape",path()+"?limit=1&limit=2"]){
  assert.equal((await call(url)).status,400,url);
 }
 assert.equal((await call(path(),"DELETE")).status,405);
 assert.equal((await call(path(),"POST",shipment("bad-origin",100),
  {headers:{origin:"https://evil.invalid"}})).status,403);
 assert.equal((await call(path(),"POST",shipment("bad-mime",100),
  {headers:{"content-type":"text/plain"}})).status,415);
 assert.equal((await call(path(),"POST",{...shipment("bad-actor",100),ator_id:"u4"})).status,400);
});
test("F6 ACL negativa em pai e filhos impede operações e fichas",async()=>{
 const part=await db.prepare("SELECT id FROM contas_receber WHERE nota_fiscal_id=? LIMIT 1").bind(nf1).first();
 await db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado) VALUES('f6-acl-op','e1','R7_BLOQUEIO_ENTIDADE','synthetic','u4','CONCLUIDA')").run();
 await db.prepare("INSERT INTO r7_acl_bloqueios(id,empresa_id,usuario_id,tipo_entidade,entidade_id,acao,motivo,ator_id,operacao_id) VALUES('f6-acl','e1','u3','CONTA_RECEBER',?,'READ','Restrição de leitura','u4','f6-acl-op')").bind(part.id).run();
 assert.equal((await call(path("invoices/")+nf1,"GET",null,{sub:"reader-a"})).status,404);
 assert.equal((await call(path("invoices/")+nf1,"GET",null,{sub:"admin-a"})).status,200);
});
test("F6 nao expõe lista/cursor de outro tenant nem campos artificiais",async()=>{
 assert.equal((await call(path("invoices","e2")+"?after="+nf1,"GET",null,{sub:"operator-b"})).status,400);
 assert.equal((await call(path("commitments/ep1/available-to-invoice"),"GET",null,{sub:"operator-b"})).status,403);
 assert.equal((await call(path("invoices"),"POST",
  {...invoice("f6-forged",1000,10000,[10000]),empresa_id:"e2"})).status,400);
});
