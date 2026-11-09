// F5 regression: Workerd, migrations 0001-0013, JWT RS256 and synthetic tenant data.
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createF8Handler} from "../ui/worker/f8-files.mjs";
import {createHash} from "node:crypto";
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
const path=(resource="",company="e1")=>"/api/v1/companies/"+company+"/files"+(resource?"/"+resource:"");
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
   F7_RUNTIME_ENABLED:"test_local_only",F8_RUNTIME_ENABLED:"test_local_only",F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
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



const bytesA=new TextEncoder().encode("%PDF-1.7\nF8 documento sintético\n"+ "x".repeat(115000));
const bytesB=new TextEncoder().encode("%PDF-1.7\nF8 versão revisada\n"+ "y".repeat(74000));
const digest=b=>createHash("sha256").update(b).digest("hex");
const hdr=(filename,raw,intent,other={})=>({
  "cf-access-jwt-assertion":jwt("operator-a"),origin,
  "content-type":"application/pdf","content-length":String(raw.byteLength),
  "x-content-sha256":digest(raw),"x-doc-intent":intent,"x-doc-name":filename,...other
});
async function upload(raw,intent="f8-upload-1",overrides={}){
 return mf.dispatchFetch(origin+path("upload"),{
  method:"POST",headers:hdr("Edital de demonstracao.pdf",raw,intent,{
    "x-doc-owner-type":"licitacao","x-doc-owner-id":"l1",
    "x-doc-role":"EDITAL","x-doc-type":"EDITAL",...overrides}),body:raw
 });
}
async function version(raw,doc,expected,intent="f8-version-1",overrides={}){
 return mf.dispatchFetch(origin+path(doc+"/versions/stream"),{
  method:"POST",headers:hdr("Edital revisado.pdf",raw,intent,{
   "x-doc-expected-version":String(expected),...overrides}),body:raw
 });
}
let fileId=null,oldVersion=null,newVersion=null;
test("F8 closed without flags/R2 and on public domain",async()=>{
 const handler=createF8Handler({fetchKeys:async()=>new Response(JSON.stringify({keys:[jwk]}))});
 const r=await handler(new Request(origin+path(),{headers:{"cf-access-jwt-assertion":jwt()}}),{});
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:"f8_not_enabled"});
 assert.equal((await call(path(),"GET",null,{host:"https://licita.lunaris.dev.br"})).status,503);
 const request=await call(path());assert.equal(request.status,200);
});
test("F8 rejects unsigned, expired and wrong tenant identity",async()=>{
 for(const token of ["",jwt("operator-a",{},false),jwt("operator-a",{exp:1})])
  assert.equal((await call(path(),"GET",null,{token})).status,401);
 assert.equal((await call(path(),"GET",null,{sub:"operator-b"})).status,403);
 assert.equal((await call(path("","e2"),"GET",null,{sub:"operator-b"})).status,200);
});
test("F8 owner picker gives authorized business records, not typed IDs",async()=>{
 const r=await call(path("owners?type=licitacao"));
 assert.equal(r.status,200,await r.clone().text());
 const data=await r.json();assert.equal(data.items[0].id,"l1");
 assert.equal((await call(path("owners?type=INVALID"))).status,400);
 assert.equal((await call(path("owners?type=licitacao&type=compra"))).status,400);
 assert.equal((await call(path("owners?type=licitacao"),"GET",null,{sub:"operator-b"})).status,403);
});
test("F8 stream >8KiB R2 put/read-back SHA, document+link+version D1 atomic",async()=>{
 const r=await upload(bytesA);
 assert.equal(r.status,201,await r.clone().text());
 const doc=await r.json();fileId=doc.documentoId;oldVersion=doc.versaoId;
 assert.ok(fileId&&oldVersion);assert.equal(doc.sha256,digest(bytesA));
 const row=await db.prepare("SELECT d.tipo,v.sha256,v.estado_integridade,l.status,l.hash_verificado "+
  "FROM documentos d JOIN documento_versoes v ON v.id=d.versao_corrente_id "+
  "JOIN documento_localizacoes l ON l.versao_id=v.id WHERE d.id=?").bind(fileId).first();
 assert.equal(row.tipo,"EDITAL");assert.equal(row.sha256,digest(bytesA));
 assert.equal(row.estado_integridade,"VERIFICADO");assert.equal(row.hash_verificado,digest(bytesA));
 assert.equal((await db.prepare("SELECT count(*) AS n FROM documento_vinculos WHERE documento_id=?")
  .bind(fileId).first()).n,1);
 const bucket=await mf.getR2Bucket("R2");
 const key="e1/"+fileId+"/"+oldVersion;
 assert.equal((await bucket.get(key)).size,bytesA.length);
});
test("F8 list/details expose no private R2 key and show verified versions",async()=>{
 const r=await call(path()+"?limit=25");
 assert.equal(r.status,200,await r.clone().text());
 const listing=await r.json();
 assert.equal(listing.items[0].id,fileId);assert.equal(listing.nextCursor,null);
 const d=await call(path(fileId));assert.equal(d.status,200,await d.clone().text());
 const detail=await d.json();
 assert.equal(detail.item.id,fileId);assert.equal(detail.versions.length,1);
 assert.equal(detail.versions[0].locations[0].status,"VERIFICADO");
 assert.ok(!JSON.stringify(detail).includes("e1/"+fileId));
 assert.equal(detail.r2DeletionAuthorized,false);
});
test("F8 download current and exact historic version checks SHA + attachment",async()=>{
 for(const resource of [fileId+"/content",fileId+"/versions/"+oldVersion+"/content"]){
  const r=await call(path(resource));
  assert.equal(r.status,200,await r.clone().text());
  assert.equal(r.headers.get("x-content-sha256"),digest(bytesA));
  assert.match(r.headers.get("content-disposition"),/^attachment;/);
  assert.equal(r.headers.get("content-type"),"application/octet-stream");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from(bytesA));
 }
});
test("F8 idempotent upload, no duplicate, different intent duplicate role conflict",async()=>{
 const r=await upload(bytesA);assert.equal(r.status,200,await r.clone().text());
 assert.equal((await r.json()).replayed,true);
 assert.equal((await upload(bytesB,"f8-duplicate-role")).status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM documentos").first()).n,1);
});
test("F8 rejects malformed upload/origin/bad mime/wrong owner/overlong",async()=>{
 assert.equal((await upload(bytesA,"f8-origin",{origin:"https://evil.invalid"})).status,403);
 assert.equal((await upload(bytesA,"f8-mime",{"content-type":"text/html"})).status,400);
 assert.equal((await upload(bytesA,"f8-over",{ "x-doc-role":"COMPROVANTE_RETENCAO"})).status,400);
 assert.equal((await upload(bytesA,"f8-cross",{ "x-doc-owner-id":"l2"})).status,404);
 assert.equal((await upload(bytesA,"f8-badhash",{"x-content-sha256":"0".repeat(64)})).status,409);
 assert.equal((await upload(new Uint8Array(8*1024*1024+1),"f8-invalid-size")).status,413);
 assert.equal((await upload(bytesA,"f8-reader",{"cf-access-jwt-assertion":jwt("reader-a")})).status,403);
});
test("F8 new 74 KiB version atomic, exact old bytes intact",async()=>{
 const details=await(await call(path(fileId))).json();
 const r=await version(bytesB,fileId,details.item.versao);
 assert.equal(r.status,201,await r.clone().text());
 const out=await r.json();newVersion=out.versaoId;
 assert.equal(out.numeroVersao,2);assert.equal(out.sha256,digest(bytesB));
 const detail=await(await call(path(fileId))).json();
 assert.equal(detail.versions.length,2);assert.equal(detail.item.versao_corrente_id,newVersion);
 assert.equal(detail.versions[0].id,newVersion);
 assert.equal(detail.versions[1].id,oldVersion);
 assert.equal(Buffer.from(await(await call(path(fileId+"/versions/"+oldVersion+"/content"))).arrayBuffer()).length,bytesA.length);
 const current=await call(path(fileId+"/content"));assert.equal(current.headers.get("x-content-sha256"),digest(bytesB));
 assert.deepEqual(Buffer.from(await current.arrayBuffer()),Buffer.from(bytesB));
});
test("F8 version idempotence and stale version CAS never replace verified current",async()=>{
 const r=await version(bytesB,fileId,2);
 assert.equal(r.status,200,await r.clone().text());
 assert.equal((await r.json()).replayed,true);
 assert.equal((await version(bytesA,fileId,2,"f8-stale")).status,409);
 assert.equal((await version(bytesA,fileId,3,"f8-incorrect-mime",{"content-type":"text/html"})).status,400);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM documento_versoes WHERE documento_id=?")
  .bind(fileId).first()).n,2);
});
test("F8 archive preview never authorizes R2 deletion (24m/Drive/backup/overlay)",async()=>{
 assert.equal((await call(path(fileId+"/versions/"+newVersion+"/archive-preview"))).status,403);
 const r=await call(path(fileId+"/versions/"+newVersion+"/archive-preview"),"GET",null,{sub:"admin-a"});
 assert.equal(r.status,200,await r.clone().text());
 const info=await r.json();assert.equal(info.eligibleForHumanReview,false);
 assert.equal(info.deleteR2Authorized,false);assert.equal(info.externalEvidenceVerified,false);
 assert.ok(info.reasons.includes("retention_24_months_not_elapsed")||
  info.reasons.includes("closure_unverified"));
 assert.ok(info.reasons.includes("drive_bytes_not_verified"));
 assert.equal((await call(path(fileId+"/versions/"+newVersion+"/archive-copy"),"POST",
   {intentId:"f8-copy"}, {sub:"admin-a"})).status,503);
 assert.equal((await call(path(fileId+"/delete"),"DELETE")).status,405);
 const bucket=await mf.getR2Bucket("R2");
 assert.equal((await bucket.get("e1/"+fileId+"/"+oldVersion)).size,bytesA.length);
});
test("F8 link ACL and parent negative ACL fail closed in list/details/download",async()=>{
 const journal="f8-acl-journal";
 await db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado) "+
  "VALUES(?,?,'R7_BLOQUEIO_ENTIDADE','synthetic','u4','CONCLUIDA')")
  .bind(journal,"e1").run();
 await db.prepare("INSERT INTO r7_acl_bloqueios(id,empresa_id,usuario_id,tipo_entidade,"+
  "entidade_id,acao,motivo,ator_id,operacao_id) "+
  "VALUES('f8-acl-1','e1','u3','LICITACAO','l1','READ','Restrição local','u4',?)")
  .bind(journal).run();
 const r=await call(path()+"?limit=25","GET",null,{sub:"reader-a"});
 assert.equal(r.status,200);assert.equal((await r.json()).items.length,0);
 assert.equal((await call(path(fileId),"GET",null,{sub:"reader-a"})).status,404);
 assert.equal((await call(path(fileId+"/content"),"GET",null,{sub:"reader-a"})).status,404);
 assert.equal((await call(path("owners?type=licitacao"),"GET",null,{sub:"reader-a"})).status,200);
});
test("F8 never crosses tenants in list, details or binary upload",async()=>{
 assert.equal((await call(path(fileId,"e2"),"GET",null,{sub:"operator-b"})).status,404);
 const r=await call(path("","e2"),"GET",null,{sub:"operator-b"});
 assert.equal(r.status,200);assert.equal((await r.json()).items.length,0);
});
test("F8 tampered R2 bytes fail sha verification, never silently serve content",async()=>{
 const bucket=await mf.getR2Bucket("R2");
 const key="e1/"+fileId+"/"+newVersion;
 await bucket.put(key,new TextEncoder().encode("z".repeat(bytesB.length)));
 const r=await call(path(fileId+"/content"));
 assert.equal(r.status,409);assert.equal(r.headers.get("cache-control").includes("no-store"),true);
 await bucket.put(key,bytesB);
 assert.equal((await call(path(fileId+"/content"))).status,200);
});
test("F8 retention proof from credit receivable creates document version verified",async()=>{
 const r=await call("/api/v1/companies/e1/fulfillment/invoices","POST",{
  intentId:"f8-demo-invoice",parentId:"ep1",expectedParentVersion:1,
  items:[{parentItemId:"ei1",quantidadeMil:1000,valorUnitCent:5000}],
  parcelasCent:[5000]});
 assert.equal(r.status,201,await r.clone().text());
 const invoice=(await r.json()).notaFiscalId;
 const account=await db.prepare("SELECT id FROM contas_receber WHERE nota_fiscal_id=?")
  .bind(invoice).first();
 assert.ok(account?.id);
 const bytes=new TextEncoder().encode("%PDF-1.7\nR8 retencao tributaria sintetica");
 const result=await upload(bytes,"f8-retention-proof",{
  "x-doc-owner-type":"conta_receber","x-doc-owner-id":account.id,
  "x-doc-role":"COMPROVANTE_CREDITO","x-doc-type":"COMPROVANTE_RETENCAO",
  "x-doc-name":"Comprovante de retencao.pdf"});
 assert.equal(result.status,201,await result.clone().text());
 const data=await result.json();
 assert.equal((await db.prepare("SELECT tipo FROM documentos WHERE id=?")
  .bind(data.documentoId).first()).tipo,"COMPROVANTE_RETENCAO");
 assert.equal((await db.prepare("SELECT estado_integridade FROM documento_versoes WHERE id=?")
  .bind(data.versaoId).first()).estado_integridade,"VERIFICADO");
 const att=await call("/api/v1/companies/e1/cash/receivables/"+account.id+
  "/retentions","POST",{intentId:"f8-retention-attest",
   documentoVersaoId:data.versaoId,valorConfirmadoCent:400},{sub:"admin-a"});
 assert.equal(att.status,201,await att.clone().text());
 assert.ok((await att.json()).atestadoId);
});
