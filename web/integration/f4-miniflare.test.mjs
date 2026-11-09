// F4: testes de ponta a ponta Workerd+D1 sintético e R7. Nenhum dado remoto.
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createF4Handler} from "../ui/worker/f4-tenders.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const issuer="https://f4-local.cloudflareaccess.com",aud="f4-local-audience";
const origin="https://licita.local.test";
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),kid:"f4-test-rsa",alg:"RS256",use:"sig"};
const files=["0001_ddl_v1.sql","0002_ddl_v1r_r4.sql","0003_ddl_v1r_r5.sql",
 "0004_ddl_v1r_r6.sql","0005_ddl_v1r_r7_w1.sql","0006_ddl_v1r_r7_quantidades.sql",
 "0007_ddl_v1r_r7_etapa1.sql","0008_ddl_v1r_r7_etapa2_guardas.sql",
 "0009_ddl_v1r_r7_etapa2_retificacoes.sql","0010_ddl_v1r_r7_etapa2_retencao_strict.sql",
 "0011_ddl_v1r_r7_etapa2_ciclos_workerd.sql","0012_ddl_v1r_r7_etapa3_iam.sql",
 "0013_ddl_v1r_r7_etapa4_backup_ledger.sql"];
let mf,db,licitacaoId,item1,item2;
function jwt(sub="operator-a",claims={},valid=true){
 const now=Math.floor(Date.now()/1000);
 const h=Buffer.from(JSON.stringify({alg:"RS256",kid:jwk.kid,typ:"JWT"})).toString("base64url");
 const p=Buffer.from(JSON.stringify({iss:issuer,aud:[aud],sub,iat:now-2,exp:now+600,...claims})).toString("base64url");
 const data=h+"."+p,sig=sign("RSA-SHA256",Buffer.from(data),privateKey).toString("base64url");
 return data+"."+(valid?sig:sig.slice(0,-3)+"bad");
}
function split(sql){
 const py=["import sys,sqlite3,json","s='';parts=[]","for line in sys.stdin:","  if line.lstrip().startswith('--'):continue","  s+=line","  if sqlite3.complete_statement(s.strip()): parts.append(s.strip());s=''","if s.strip():raise ValueError('SQL_INCOMPLETO')","print(json.dumps(parts))"].join("\n");
 return JSON.parse(execFileSync("python3",["-c",py],{input:sql,encoding:"utf8",maxBuffer:13000000}));
}
const base=(company="e1")=>"/api/v1/companies/"+company+"/licitacoes";
const tender=(id,company="e1")=>base(company)+(id?"/"+id:"");
const items=(id)=>tender(id)+"/items";
const item=(id,i)=>items(id)+"/"+i;
const form=(intentId="new-tender",extra={})=>({
 intentId,orgaoId:"o1",numero:"Pregão 001/2027",ano:2027,modalidade:"Pregão eletrônico",
 objeto:"Aquisição sintética de equipamentos",portal:"Portal fictício",
 urlProcesso:"https://invalid.test/processo",limitePropostaEm:null,inicioDisputaEm:null,
 decisaoParticipacao:"PARTICIPAR",situacaoParticipacao:"EM_ANALISE",
 responsavelTexto:"Responsável fictício",observacoes:null,...extra
});
const tenderEdit=(intentId,expectedVersion=1,extra={})=>{
 const {orgaoId:__,numero:___,ano:____,...fields}=form(intentId,extra);void __;void ___;void ____;
 return {...fields,expectedVersion};
};
const itemBody=(intentId,numeroItem="1",extra={})=>({
 intentId,numeroItem,lote:"L01",descricaoExigida:"Equipamento sintético tipo A",
 unidade:"UN",quantidadePrevistaMil:5000,valorPropostaUnitCent:85000,
 produtoOfertado:"Produto fictício",marcaOfertada:"Marca Modelo",modeloOfertado:"X1",
 observacoes:null,...extra
});
async function call(path,method="GET",body,opts={}){
 const headers={"cf-access-jwt-assertion":opts.token??jwt(opts.sub||"operator-a"),
  ...(["POST","PATCH"].includes(method)?{origin,"content-type":"application/json"}:{}),
  ...(opts.headers||{})};
 const init={method,headers};
 if(["POST","PATCH"].includes(method))init.body=typeof body==="string"?body:JSON.stringify(body);
 return mf.dispatchFetch((opts.host||origin)+path,init);
}
before(async()=>{
 mf=new Miniflare({scriptPath:"web/ui/worker/test-local-entry.mjs",modules:true,
  modulesRules:[{type:"ESModule",include:["**/*.mjs"]}],compatibilityDate:"2026-08-06",
  cf:false,d1Databases:{DB:"40000000-0000-4000-8000-000000000001"},
  bindings:{F1_RUNTIME_ENABLED:"test_local_only",F2_RUNTIME_ENABLED:"test_local_only",
    F3_RUNTIME_ENABLED:"test_local_only",F4_RUNTIME_ENABLED:"test_local_only",
    F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
    ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:aud,APP_ORIGIN:origin}});
 db=await mf.getD1Database("DB");
 for(const name of files)for(const [i,sql] of split(readFileSync("migrations/"+name,"utf8")).entries())
  try{await db.prepare(sql).run();}catch(e){throw Error(name+" #"+i+" "+String(e));}
 for(const sql of [
  "INSERT INTO empresas(id,nome) VALUES('e1','Empresa Aurora'),('e2','Empresa Horizonte')",
  "INSERT INTO usuarios(id,access_issuer,access_subject,email_normalizado) VALUES('u1','"+issuer+"','operator-a','a@invalid.test'),('u2','"+issuer+"','operator-b','b@invalid.test'),('u3','"+issuer+"','reader-a','r@invalid.test'),('u4','"+issuer+"','admin-a','admin@invalid.test')",
  "INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) VALUES('u1','e1','OPERADOR',1),('u2','e2','OPERADOR',1),('u3','e1','CONSULTA',1),('u4','e1','ADMIN',1)",
  "INSERT INTO orgaos(id,empresa_id,nome,nome_normalizado,ativo) VALUES('o1','e1','Órgão Alfa sintético','orgao alfa sintetico',1),('o2','e1','Órgão desativado','orgao desativado',0),('o3','e2','Órgão da outra empresa','orgao da outra empresa',1)",
  "INSERT INTO licitacoes(id,empresa_id,orgao_id,numero,numero_normalizado,ano,origem_dado,conferencia) VALUES('legacy-tender','e1','o1','Antigo 009','antigo 009',2021,'LEGADO','PENDENTE')",
  "INSERT INTO documentos(id,empresa_id,tipo,titulo,origem_dado,conferencia) VALUES('doc-e1','e1','EDITAL','Documento PDF sintético','NATIVO','VALIDADO'),('doc-e2','e2','EDITAL','Documento secreto e2','NATIVO','VALIDADO')",
  "INSERT INTO documento_vinculos(id,empresa_id,documento_id,papel,licitacao_id,ativo,origem_dado,conferencia) VALUES('link-legacy','e1','doc-e1','EDITAL','legacy-tender',1,'NATIVO','VALIDADO')"
 ])try{await db.prepare(sql).run();}catch(e){throw Error("seed "+sql.slice(0,80)+" : "+e);}
});
after(async()=>await mf?.dispose());
test("F4 default fail-closed sem flags e binding",async()=>{
 const fn=createF4Handler({fetchKeys:async()=>new Response(JSON.stringify({keys:[jwk]}))});
 const r=await fn(new Request(origin+base(),{headers:{"cf-access-jwt-assertion":jwt()}}),{});
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:"f4_not_enabled"});
});
test("F4 hostname remoto permanece 503 apesar do D1 e flags de teste",async()=>{
 assert.equal((await call(base(),"GET",null,{host:"https://licita.lunaris.dev.br"})).status,503);
});
test("F4 JWT forjado, expirado ou sem autenticação é 401",async()=>{
 for(const t of ["",jwt("operator-a",{},false),jwt("operator-a",{aud:"outro"}),
    jwt("operator-a",{exp:1})])assert.equal((await call(base(),"GET",null,{token:t})).status,401);
});
test("F4 segregação de empresa e CONSULTA somente leitura",async()=>{
 assert.equal((await call(base(),"GET",undefined,{sub:"operator-b"})).status,403);
 assert.equal((await call(tender("legacy-tender"),"GET",undefined,{sub:"operator-b"})).status,403);
 assert.equal((await call(base(),"GET",undefined,{sub:"reader-a"})).status,200);
 assert.equal((await call(base(),"POST",form("reader-create"),{sub:"reader-a"})).status,403);
});
test("F4 criação rejeita órgão inativo, de outro tenant e campos privilegiados",async()=>{
 for(const payload of [
  form("bad-inactive",{orgaoId:"o2"}),
  form("bad-cross-org",{orgaoId:"o3"}),
  {...form("bad-tenant"),empresa_id:"e2"},
  {...form("bad-result"),encerrada_em:"2026-01-01"},
  form("bad-year",{ano:1800}),
  form("bad-link",{urlProcesso:"javascript:alert(1)"}),
  form("bad-timestamp",{limitePropostaEm:"2026-02-30T12:00:00.000Z"})
 ]){
  const res=await call(base(),"POST",payload);
  assert.ok([400,409].includes(res.status),payload.intentId+" : "+res.status);
 }
});
test("F4 cria licitação única e auditável sem gerar empenho/recebível",async()=>{
 const res=await call(base(),"POST",form("create-tender"));
 assert.equal(res.status,201,await res.clone().text());
 licitacaoId=(await res.json()).id;assert.ok(licitacaoId);
 const l=await db.prepare("SELECT * FROM licitacoes WHERE id=?").bind(licitacaoId).first();
 assert.equal(l.numero_normalizado,"pregao 001/2027");assert.equal(l.empresa_id,"e1");
 assert.equal(l.origem_dado,"NATIVO");assert.equal(l.conferencia,"VALIDADO");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM empenhos WHERE licitacao_id=?").bind(licitacaoId).first()).n,0);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM eventos_auditoria WHERE operacao_id='create-tender'").first()).n,1);
});
test("F4 replay não duplica; colisão de ID ou R4 natural rejeita",async()=>{
 const res=await call(base(),"POST",form("create-tender"));
 assert.equal(res.status,200);assert.equal((await res.json()).replayed,true);
 assert.equal((await call(base(),"POST",form("create-tender",{numero:"Alterado"}))).status,409);
 assert.equal((await call(base(),"POST",form("duplicate-tender",{numero:"PREGÃO   001/2027"}))).status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM licitacoes WHERE orgao_id='o1' AND ano=2027").first()).n,1);
});
test("F4 lista com busca e cursor restringido por tenant/ano/estado/ACL",async()=>{
 for(const [op,numero] of [["create-tender-b","Pregão 002/2027"],["create-tender-c","Pregão 003/2027"]])
  assert.equal((await call(base(),"POST",form(op,{numero}))).status,201);
 const p=(await(await call(base()+"?q=pregao&year=2027&limit=1")).json());
 assert.equal(p.items.length,1);assert.ok(p.nextCursor);
 const n=(await(await call(base()+"?q=pregao&year=2027&limit=1&after="+p.nextCursor)).json());
 assert.equal(n.items.length,1);assert.notEqual(n.items[0].id,p.items[0].id);
 assert.equal((await call(base("e2")+"?after="+p.nextCursor,"GET",null,{sub:"operator-b"})).status,400);
 assert.equal((await call(base()+"?year=2021&after="+p.nextCursor)).status,400);
});
test("F4 PATCH metadata CAS; não altera número, órgão, ano; LEGADO imutável",async()=>{
 const r=await call(tender(licitacaoId),"PATCH",tenderEdit("tender-edit",1,{objeto:"Objeto revisado sem alterar identidade",situacaoParticipacao:"EM_PREPARACAO"}));
 assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).newVersion,2);
 assert.equal((await call(tender(licitacaoId),"PATCH",tenderEdit("tender-stale",1))).status,409);
 assert.equal((await call(tender(licitacaoId),"PATCH",{...tenderEdit("change-id",2),orgaoId:"o3"})).status,400);
 assert.equal((await call(tender("legacy-tender"),"PATCH",tenderEdit("edit-legacy",1))).status,409);
 const d=(await(await call(tender(licitacaoId))).json()).item;
 assert.equal(d.objeto,"Objeto revisado sem alterar identidade");assert.equal(d.versao,2);
});
test("F4 itens criados com quantidade milésimos, centavos e observações",async()=>{
 const a=await call(items(licitacaoId),"POST",itemBody("create-item-1"));
 assert.equal(a.status,201,await a.clone().text());item1=(await a.json()).id;
 const b=await call(items(licitacaoId),"POST",itemBody("create-item-2","2",{lote:"L02",quantidadePrevistaMil:2000,valorPropostaUnitCent:70000}));
 assert.equal(b.status,201,await b.clone().text());item2=(await b.json()).id;
 const detail=(await(await call(tender(licitacaoId))).json());
 assert.equal(detail.items.length,2);
 assert.equal(detail.items[0].quantidade_prevista_mil,5000);
 assert.equal(detail.items[0].resultado,"PENDENTE");
 assert.equal(detail.commitments.length,0);
});
test("F4 item duplicado mesmo lote+número bloqueado e CAS protege edição",async()=>{
 assert.equal((await call(items(licitacaoId),"POST",itemBody("item-duplicate"))).status,409);
 const edit=await call(item(licitacaoId,item1),"PATCH",
  {...itemBody("item-edit","1",{marcaOfertada:"Marca revisada"}),expectedVersion:1});
 assert.equal(edit.status,200,await edit.clone().text());
 assert.equal((await call(item(licitacaoId,item1),"PATCH",
  {...itemBody("item-stale"),expectedVersion:1})).status,409);
});
test("F4 resultado R7 por item: ganho parcial legítimo e perda sem empenho fictício",async()=>{
 const a=await call(item(licitacaoId,item1)+"/award","POST",{
  intentId:"award-partial",expectedVersion:2,resultado:"GANHO",
  quantidadeGanhaMil:1500,valorFinalUnitCent:80000});
 assert.equal(a.status,201,await a.clone().text());
 const b=await call(item(licitacaoId,item2)+"/award","POST",{
  intentId:"award-lost",expectedVersion:1,resultado:"PERDIDO",
  quantidadeGanhaMil:null,valorFinalUnitCent:null});
 assert.equal(b.status,201,await b.clone().text());
 const detail=(await(await call(tender(licitacaoId))).json());
 assert.equal(detail.items.filter(x=>x.resultado==="GANHO").length,1);
 assert.equal(detail.items.filter(x=>x.resultado==="PERDIDO").length,1);
 const won=detail.items.find(x=>x.id===item1);
 assert.equal(won.quantidade_ganha_mil,1500);assert.equal(won.valor_final_unit_cent,80000);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM empenhos WHERE licitacao_id=?").bind(licitacaoId).first()).n,0);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM contas_receber").first()).n,0);
});
test("F4 ganho superior à quantidade e resultado adulterado são rejeitados",async()=>{
 assert.equal((await call(item(licitacaoId,item1)+"/award","POST",{
  intentId:"oversell",expectedVersion:3,resultado:"GANHO",
  quantidadeGanhaMil:900000,valorFinalUnitCent:1000})).status,409);
 assert.equal((await call(item(licitacaoId,item2)+"/award","POST",{
  intentId:"bad-win",expectedVersion:2,resultado:"GANHO",
  quantidadeGanhaMil:0,valorFinalUnitCent:1000})).status,400);
 assert.equal((await call(item(licitacaoId,item2),"PATCH",
  {...itemBody("change-result"),expectedVersion:2,resultado:"GANHO"})).status,400);
 assert.equal((await call(item(licitacaoId,item1),"PATCH",
  {...itemBody("edit-after-award"),expectedVersion:3})).status,409);
});
test("F4 documentos: vínculo explícito para documento existente autorizado sem receber bytes",async()=>{
 const r=await call(tender(licitacaoId)+"/documents","POST",{
  intentId:"link-doc",documentoId:"doc-e1",papel:"PROPOSTA"});
 assert.equal(r.status,201,await r.clone().text());
 const d=(await(await call(tender(licitacaoId))).json());
 assert.equal(d.documents.length,1);assert.equal(d.documents[0].documento_id,"doc-e1");
 assert.equal(d.documents[0].papel,"PROPOSTA");
 assert.equal((await call(tender(licitacaoId)+"/documents","POST",{
  intentId:"link-doc-new",documentoId:"doc-e2",papel:"EDITAL"})).status,404);
 assert.equal((await call(tender(licitacaoId)+"/documents","POST",{
  intentId:"link-doc-different",documentoId:"doc-e1",papel:"PROPOSTA"})).status,409);
});
test("F4 ACL da licitação prevalece até para ADMIN, sem vazamento em lista/ficha",async()=>{
 for(const sql of [
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado) VALUES('block-tender-op','e1','R7_BLOQUEIO_ENTIDADE','hash','u4','CONCLUIDA')",
  "INSERT INTO r7_acl_bloqueios(id,empresa_id,usuario_id,tipo_entidade,entidade_id,acao,motivo,ator_id,operacao_id) VALUES('block-tender','e1','u1','LICITACAO','"+licitacaoId+"','READ','Restrição de auditoria','u4','block-tender-op')"
 ])await db.prepare(sql).run();
 assert.equal((await call(tender(licitacaoId))).status,404);
 assert.ok(!(await(await call(base()+"?state=all")).json()).items.some(x=>x.id===licitacaoId));
 assert.equal((await call(base()+"?state=all&after="+licitacaoId)).status,400);
 assert.equal((await call(tender(licitacaoId),"GET",null,{sub:"admin-a"})).status,200);
});
test("F4 detalhe falha fechado se item ou documento é bloqueado",async()=>{
 for(const sql of [
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado) VALUES('block-item-op','e1','R7_BLOQUEIO_ENTIDADE','hash','u4','CONCLUIDA')",
  "INSERT INTO r7_acl_bloqueios(id,empresa_id,usuario_id,tipo_entidade,entidade_id,acao,motivo,ator_id,operacao_id) VALUES('block-item','e1','u3','LICITACAO_ITEM','"+item1+"','READ','Bloqueio de item','u4','block-item-op')"
 ])await db.prepare(sql).run();
 assert.equal((await call(tender(licitacaoId),"GET",null,{sub:"reader-a"})).status,404);
 assert.equal((await call(tender(licitacaoId),"GET",null,{sub:"admin-a"})).status,200);
});
test("F4 ciclo R7 encerra com motivo, bloqueia mutação e só ADMIN reabre",async()=>{
 const latest=(await db.prepare("SELECT versao FROM licitacoes WHERE id=?").bind(licitacaoId).first()).versao;
 const close=await call(tender(licitacaoId)+"/cycle/close","POST",{
  intentId:"close-tender",expectedVersion:latest,motivo:"Processo comercial concluído e auditado"});
 assert.equal(close.status,201,await close.clone().text());
 const cycleId=(await close.json()).cicloId;assert.ok(cycleId);
 assert.equal((await call(items(licitacaoId),"POST",itemBody("item-after-close","3"))).status,409);
 assert.equal((await call(tender(licitacaoId)+"/cycle/"+cycleId+"/reopen","POST",{
  intentId:"reopen-reader",expectedVersion:latest+1,motivo:"Reabrir decisão por revisão"}, {sub:"operator-a"})).status,403);
 const reopen=await call(tender(licitacaoId)+"/cycle/"+cycleId+"/reopen","POST",{
  intentId:"reopen-admin",expectedVersion:latest+1,motivo:"Reabrir por necessidade de reanálise formal"}, {sub:"admin-a"});
 assert.equal(reopen.status,201,await reopen.clone().text());
 const detail=(await(await call(tender(licitacaoId),"GET",null,{sub:"admin-a"})).json());
 assert.equal(detail.item.encerrada_em,null);assert.equal(detail.cycles.length,1);
 assert.ok(detail.cycles[0].reaberta_em);
});
test("F4 CSRF, MIME, tamanho, filtros e métodos rejeitados",async()=>{
 assert.equal((await call(base(),"POST",form("csrf"),{headers:{origin:"https://attacker.invalid"}})).status,403);
 assert.equal((await call(base(),"POST",form("mime"),{headers:{"content-type":"text/plain"}})).status,415);
 assert.equal((await call(base(),"POST",{...form("huge"),observacoes:"x".repeat(9100)})).status,413);
 for(const q of ["?limit=0","?limit=51","?after=../../foo","?year=190","?state=outro",
    "?limit=5&limit=5","?sort=datacriacao"])
  assert.equal((await call(base()+q)).status,400,q);
 assert.equal((await call(base(),"DELETE")).status,405);
 assert.equal((await call(tender(licitacaoId)+"/items","GET")).status,405);
});
