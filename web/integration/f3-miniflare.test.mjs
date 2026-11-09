// F3: finanças sintéticas no Workerd + D1, sem acesso a Cloudflare remoto.
import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createF3Handler} from "../ui/worker/f3-finance.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const issuer="https://f3-local-only.cloudflareaccess.com",audience="f3-local-only-audience";
const origin="https://licita.local.test",uuid="30000000-0000-4000-8000-000000000001";
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
 return JSON.parse(execFileSync("python3",["-c",py],{input:sql,encoding:"utf8",maxBuffer:12000000}));
}
async function req(path,method="GET",body,opts={}){
 const headers={"cf-access-jwt-assertion":opts.token??token(opts.sub||"person-a"),
   ...method==="POST"?{"content-type":"application/json",origin}: {},
   ...(opts.headers||{})};
 const init={method,headers};
 if(method==="POST")init.body=typeof body==="string"?body:JSON.stringify(body);
 return mf.dispatchFetch((opts.host||origin)+path,init);
}
const base=(c="e1")=>"/api/v1/companies/"+c+"/finance";
const title=(id,c="e1")=>base(c)+"/titles"+(id?"/"+id:"");
const recurrence=(id,c="e1")=>base(c)+"/recurrences"+(id?"/"+id:"");
const once=(intentId,beneficiario="Conta Mensal",extra={})=>({
 intentId,tipo:"DIVERSO",beneficiario,categoriaDespesa:"Despesas fixas",
 valorCent:109900,vencimento:future+"-31",descricao:"Sem boleto por opção",...extra
});
const recurring=(intentId,beneficiario="Internet",extra={})=>({
 intentId,beneficiario,categoriaDespesa:"Serviços",descricao:"Plano mensal",
 diaVencimento:31,primeiroVencimento:future+"-31",valorCent:12990,...extra
});
before(async()=>{
 mf=new Miniflare({scriptPath:"web/ui/worker/test-local-entry.mjs",modules:true,
  modulesRules:[{type:"ESModule",include:["**/*.mjs"]}],
  compatibilityDate:"2026-08-06",cf:false,d1Databases:{DB:uuid},
  bindings:{F1_RUNTIME_ENABLED:"test_local_only",F2_RUNTIME_ENABLED:"test_local_only",
   F3_RUNTIME_ENABLED:"test_local_only",F1_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
   ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUD:audience,APP_ORIGIN:origin}});
 db=await mf.getD1Database("DB");
 for(const name of files)for(const [i,sql] of split(readFileSync("migrations/"+name,"utf8")).entries()){
  try{await db.prepare(sql).run();}catch(e){throw Error(name+" #"+i+": "+e);}
 }
 for(const sql of [
  "INSERT INTO empresas(id,nome) VALUES('e1','Empresa Azul'),('e2','Empresa Verde')",
  "INSERT INTO usuarios(id,access_issuer,access_subject,email_normalizado) VALUES('u1','"+issuer+"','person-a','a@invalid.test'),('u2','"+issuer+"','person-b','b@invalid.test'),('u3','"+issuer+"','person-admin','admin@invalid.test')",
  "INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) VALUES('u1','e1','OPERADOR',1),('u1','e2','CONSULTA',1),('u2','e2','ADMIN',1),('u3','e1','ADMIN',1)",
  "INSERT INTO fornecedores(id,empresa_id,nome,nome_normalizado) VALUES('supplier-e1','e1','Fornecedor Alpha','fornecedor alpha')",
  "INSERT INTO titulos_pagar(id,empresa_id,tipo,beneficiario,categoria_despesa,valor_nominal_cent,vencimento,origem_dado,conferencia,pago_legado_status) VALUES('legacy-bill','e1','DIVERSO','Conta Antiga','Legado',1000,'"+future+"-01','LEGADO','PENDENTE','DESCONHECIDO')"
 ])await db.prepare(sql).run();
});
after(async()=>await mf?.dispose());

test("F3 default fail-closed sem flag e sem D1",async()=>{
 const fn=createF3Handler({fetchKeys:async()=>new Response(JSON.stringify({keys:[jwk]}))});
 const res=await fn(new Request(origin+title(),{headers:{"cf-access-jwt-assertion":token()}}),{});
 assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:"f3_not_enabled"});
});
test("F3 recusa hostname externo mesmo com flags locais",async()=>{
 assert.equal((await req(title(),"GET",undefined,{host:"https://licita.lunaris.dev.br"})).status,503);
});
test("F3 autentica JWT por issuer, aud, exp e assinatura",async()=>{
 for(const t of ["",token("person-a",{},false),token("person-a",{aud:["wrong"]}),
  token("person-a",{iss:"https://another.example"}),token("person-a",{exp:1})]){
  const res=await req(title(),"GET",undefined,{token:t});assert.equal(res.status,401);
 }
});
test("F3 RBAC: CONSULTA não cria despesas na empresa e2",async()=>{
 assert.equal((await req(title(undefined,"e2"))).status,200);
 assert.equal((await req(title(undefined,"e2"),"POST",once("read-only"))).status,403);
});
test("F3 isolamento entre empresas antes de consultar qualquer entidade",async()=>{
 for(const path of [title(undefined,"e1"),recurrence(undefined,"e1"),base("e1")+"/monthly?month="+future]){
  assert.equal((await req(path,"GET",undefined,{sub:"person-b"})).status,403);
 }
});
test("F3 cria despesa DIVERSO sem boleto, com journal+auditoria e centavos exatos",async()=>{
 const res=await req(title(),"POST",once("bill-create"));
 assert.equal(res.status,201,await res.clone().text());
 const data=await res.json();assert.equal(data.replayed,false);assert.equal(data.newVersion,1);
 const row=await db.prepare("SELECT tipo,valor_nominal_cent,origem_dado,conferencia,operacao_id,beneficiario "+
  "FROM titulos_pagar WHERE id=?").bind(data.id).first();
 assert.equal(row.tipo,"DIVERSO");assert.equal(row.valor_nominal_cent,109900);
 assert.equal(row.origem_dado,"NATIVO");assert.equal(row.conferencia,"VALIDADO");
 assert.equal(row.operacao_id,"bill-create");
 assert.equal((await db.prepare("SELECT count(*) n FROM operacoes WHERE id='bill-create'").first()).n,1);
 assert.equal((await db.prepare("SELECT count(*) n FROM eventos_auditoria WHERE operacao_id='bill-create'").first()).n,1);
});
test("F3 replay idêntico e payload divergente não causam duplicação",async()=>{
 const r=await req(title(),"POST",once("bill-create"));
 assert.equal(r.status,201);assert.equal((await r.json()).replayed,true);
 assert.equal((await req(title(),"POST",once("bill-create","Outro nome"))).status,409);
 assert.equal((await db.prepare("SELECT count(*) n FROM titulos_pagar WHERE operacao_id='bill-create'").first()).n,1);
});
test("F3 cria título FORNECEDOR sem compra, vinculado ao cadastro do mesmo tenant",async()=>{
 const body={intentId:"supplier-bill",tipo:"FORNECEDOR",fornecedorId:"supplier-e1",
  descricao:"Boleto opcional",valorCent:40000,vencimento:future+"-20"};
 const r=await req(title(),"POST",body);
 assert.equal(r.status,201,await r.clone().text());
 const row=await db.prepare("SELECT fornecedor_id,compra_id FROM titulos_pagar WHERE operacao_id='supplier-bill'").first();
 assert.equal(row.fornecedor_id,"supplier-e1");assert.equal(row.compra_id,null);
});
test("F3 não permite vincular fornecedor de outra empresa nem campos privilegiados",async()=>{
 const invalid=[{...once("cross-supplier"),tipo:"FORNECEDOR",beneficiario:null,categoriaDespesa:null,
 fornecedorId:"supplier-e2"},{...once("fake-tenant"),empresa_id:"e2"},
 {...once("fake-actor"),ator_id:"u3"},
 {...once("fake-status"),cancelado:1},
 {...once("fake-prov"),origem_dado:"LEGADO"},
 {...once("bad-value"),valorCent:0},
 {...once("bad-date"),vencimento:"2026-02-30"}];
 for(const input of invalid){
  const res=await req(title(),"POST",input);
  assert.ok(res.status===400||res.status===409,res.status+" "+input.intentId);
 }
});
test("F3 lista por mês e estado, e protege LEGADO de edição posterior",async()=>{
 const result=await req(title()+"?month="+future+"&state=active&limit=1");
 assert.equal(result.status,200);
 const body=await result.json();assert.equal(body.items.length,1);assert.ok(body.nextCursor);
 const next=await req(title()+"?month="+future+"&state=active&limit=1&after="+body.nextCursor);
 assert.equal(next.status,200);
 const detail=await req(title("legacy-bill"));
 assert.equal(detail.status,200);assert.equal((await detail.json()).item.origem_dado,"LEGADO");
 assert.equal((await req(title("legacy-bill")+"/revise","POST",
   {intentId:"legacy-revise",expectedVersion:1,novoValorCent:1500,motivo:"Teste de histórico"})).status,409);
});
test("F3 revisão de título com CAS não mexe na origem e histórico",async()=>{
 const rec=await db.prepare("SELECT id,versao FROM titulos_pagar WHERE operacao_id='bill-create'").first();
 const r=await req(title(rec.id)+"/revise","POST",
  {intentId:"bill-revise",expectedVersion:1,novoValorCent:139900,motivo:"Nova condição pactuada"});
 assert.equal(r.status,201,await r.clone().text());assert.equal((await r.json()).newVersion,2);
 const stale=await req(title(rec.id)+"/revise","POST",
  {intentId:"bill-revise-stale",expectedVersion:1,novoValorCent:149900,motivo:"Tentativa obsoleta"});
 assert.equal(stale.status,409);
});
test("F3 pagamento R7 contabiliza valor pago e impede dupla quitação",async()=>{
 const rec=await db.prepare("SELECT id,versao FROM titulos_pagar WHERE operacao_id='bill-revise'").first();
 const r=await req(title(rec.id)+"/payments","POST",
  {intentId:"bill-pay",expectedVersion:2,dataPagamento:future+"-17",valorPagoCent:139900});
 assert.equal(r.status,201,await r.clone().text());
 const j=await r.json();assert.ok(j.paymentId);
 const detail=(await(await req(title(rec.id))).json());
 assert.equal(detail.item.situacao,"PAGO");assert.equal(detail.payments.length,1);
 assert.equal(detail.payments[0].valor_pago_cent,139900);
 const d=await req(title(rec.id)+"/payments","POST",
  {intentId:"bill-double-pay",expectedVersion:3,dataPagamento:future+"-18",valorPagoCent:100});
 assert.equal(d.status,409);
});
test("F3 pagamento com comprovante de outro tenant e ACL é proibido",async()=>{
 const rec=await db.prepare("SELECT id,versao FROM titulos_pagar WHERE operacao_id='supplier-bill'").first();
 const d=await req(title(rec.id)+"/payments","POST",
  {intentId:"fake-doc",expectedVersion:1,dataPagamento:future+"-17",valorPagoCent:40000,
   comprovanteDocumentoId:"doc-not-in-company"});
 assert.ok(d.status===403||d.status===404);
});
test("F3 desfazimento R7 preserva evento original e reabre título",async()=>{
 const rec=await db.prepare("SELECT id,versao FROM titulos_pagar WHERE operacao_id='bill-pay'").first();
 const before=(await(await req(title(rec.id))).json()).payments[0];
 const res=await req(title(rec.id)+"/payments/"+before.id+"/undo","POST",
  {intentId:"bill-undo",expectedVersion:3,motivo:"Pagamento lançado em duplicidade"});
 assert.equal(res.status,201,await res.clone().text());
 const detail=(await(await req(title(rec.id))).json());
 assert.equal(detail.item.situacao,"ABERTO");assert.equal(detail.payments.length,2);
 assert.equal(detail.payments.filter(x=>x.tipo==="QUITACAO").length,1);
 assert.equal(detail.payments.filter(x=>x.tipo==="DESFAZIMENTO").length,1);
});
test("F3 cria regra recorrente sem boleto, com auditoria e sem materializar automaticamente",async()=>{
 const res=await req(recurrence(),"POST",recurring("rec-create"));
 assert.equal(res.status,201,await res.clone().text());
 const j=await res.json();assert.ok(j.id);
 const row=await db.prepare("SELECT * FROM recorrencias WHERE operacao_id='rec-create'").first();
 assert.equal(row.dia_vencimento,31);assert.equal(row.estado,"ATIVA");
 assert.equal((await db.prepare("SELECT count(*) n FROM titulos_pagar WHERE recorrencia_id=?").bind(j.id).first()).n,0);
 assert.equal((await db.prepare("SELECT count(*) n FROM eventos_auditoria WHERE operacao_id='rec-create'").first()).n,1);
});
test("F3 regra exige calendário válido e rejeita dia de primeiro vencimento divergente",async()=>{
 const r=await req(recurrence(),"POST",recurring("bad-rec","Teste",{primeiroVencimento:future+"-15"}));
 assert.equal(r.status,400);
});
test("F3 prévia R7 prevê regra e inclui despesa aberta sem duplicar",async()=>{
 const r=await req(base()+"/monthly?month="+future);
 assert.equal(r.status,200,await r.clone().text());
 const m=await r.json();
 assert.equal(m.competencia,future);assert.equal(m.regraDuplicadaNoTotal,false);
 assert.ok(m.linhas.some(x=>x.tipo==="PREVISAO_RECORRENTE"));
 assert.equal(m.completo,false);assert.ok(m.incompletos.includes("legacy-bill"));
});
test("F3 materializar regra do mês cria título e prévia NÃO duplica valor",async()=>{
 const rec=await db.prepare("SELECT id,versao FROM recorrencias WHERE operacao_id='rec-create'").first();
 const r=await req(recurrence(rec.id)+"/materialize","POST",
  {intentId:"rec-march",expectedVersion:1,competencia:future});
 assert.equal(r.status,201,await r.clone().text());
 const preview=(await(await req(base()+"/monthly?month="+future)).json());
 assert.equal(preview.linhas.filter(x=>x.recorrenciaId===rec.id).length,1);
 assert.equal(preview.linhas.filter(x=>x.recorrenciaId===rec.id&&x.tipo==="TITULO").length,1);
 const dup=await req(recurrence(rec.id)+"/materialize","POST",
  {intentId:"rec-march-again",expectedVersion:2,competencia:future});
 assert.equal(dup.status,409);
});
test("F3 revisão de valor recorrente afeta meses futuros, preserva título gerado",async()=>{
 const rec=await db.prepare("SELECT id,versao FROM recorrencias WHERE operacao_id='rec-march'").first();
 const r=await req(recurrence(rec.id)+"/revise-value","POST",
  {intentId:"rec-april-value",expectedVersion:2,vigenteAPartir:next,
   valorNovoCent:13500,motivo:"Reajuste futuro válido"});
 assert.equal(r.status,201,await r.clone().text());
 const march=await db.prepare("SELECT valor_nominal_cent FROM titulos_pagar "+
  "WHERE recorrencia_id=? AND competencia=?").bind(rec.id,future).first();
 assert.equal(march.valor_nominal_cent,12990);
 const april=(await(await req(base()+"/monthly?month="+next)).json());
 assert.equal(april.linhas.find(x=>x.recorrenciaId===rec.id).valorCent,13500);
});
test("F3 encerramento após competência não apaga título nem prevê mês posterior",async()=>{
 const rec=await db.prepare("SELECT id,versao FROM recorrencias WHERE operacao_id='rec-april-value'").first();
 const r=await req(recurrence(rec.id)+"/end-after","POST",
  {intentId:"rec-end",expectedVersion:3,fimDepois:next,motivo:"Fim do contrato no mês combinado"});
 assert.equal(r.status,201,await r.clone().text());
 const later=String(yy)+"-05";
 const sum=(await(await req(base()+"/monthly?month="+later)).json());
 assert.ok(!sum.linhas.some(x=>x.recorrenciaId===rec.id));
 const march=await db.prepare("SELECT count(*) n FROM titulos_pagar WHERE recorrencia_id=?").bind(rec.id).first();
 assert.equal(march.n,1);
});
test("F3 ACL negativa oculta título da lista/ficha e bloqueia agregação",async()=>{
 const id=(await db.prepare("SELECT id FROM titulos_pagar WHERE beneficiario='Conta Mensal'").first()).id;
 for(const sql of [
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado) VALUES('block-f3','e1','R7_BLOQUEIO_ENTIDADE','hash','u3','CONCLUIDA')",
  "INSERT INTO r7_acl_bloqueios(id,empresa_id,usuario_id,tipo_entidade,entidade_id,acao,motivo,ator_id,operacao_id) VALUES('block-row-f3','e1','u1','TITULO_PAGAR','"+id+"','READ','Restrição explícita registrada','u3','block-f3')"
 ])await db.prepare(sql).run();
 const read=await req(title(id));
 assert.equal(read.status,404);
 const list=(await(await req(title()+"?state=all")).json()).items;
 assert.ok(!list.some(x=>x.id===id));
 const preview=await req(base()+"/monthly?month="+future);
 assert.equal(preview.status,403);
 const admin=await req(base()+"/monthly?month="+future,"GET",null,{sub:"person-admin"});
 assert.equal(admin.status,200);
});
test("F3 títulos cancelados não somam; cancelamento preserva registros",async()=>{
 const t=await db.prepare("SELECT id,versao FROM titulos_pagar WHERE operacao_id='supplier-bill'").first();
 const res=await req(title(t.id)+"/cancel","POST",
  {intentId:"supplier-cancel",expectedVersion:1,motivo:"Fornecedor cancelou a cobrança"});
 assert.equal(res.status,201,await res.clone().text());
 assert.equal((await(await req(title(t.id),"GET",null,{sub:"person-admin"})).json()).item.situacao,"CANCELADO");
 assert.equal((await db.prepare("SELECT count(*) n FROM titulos_pagar WHERE id=?").bind(t.id).first()).n,1);
});
test("F3 API bloqueada em preview sem flags e sem migração nova",async()=>{
 assert.equal((await req(title(),"DELETE")).status,405);
 for(const route of [title()+"?limit=100",title()+"?after=../../x",recurrence()+"?limit=0",
  base()+"/monthly?month=2026-13",base()+"/monthly?month="+future+"&extra=1"]){
  assert.equal((await req(route)).status,400,route);
 }
 const wrong=await req(title(),"POST",once("csrf-f3"),{headers:{origin:"https://attacker.invalid"}});
 assert.equal(wrong.status,403);
 const oversized=await req(title(),"POST",{...once("huge-f3"),observacoes:"a".repeat(9000)});
 assert.equal(oversized.status,413);
});

test("F3 cursor respeita filtros e ACL e não ancora em registro oculto",async()=>{
 const id=(await db.prepare("SELECT id FROM titulos_pagar WHERE beneficiario='Conta Mensal'").first()).id;
 const blocked=await req(title()+"?state=all&after="+id);
 assert.equal(blocked.status,400);
 assert.deepEqual(await blocked.json(),{error:"invalid_cursor"});
 assert.equal((await req(title()+"?state=paid&after=legacy-bill")).status,400);
});
test("F3 prévia antiga falha fechado se reajuste futuro não materializado distorce valor",async()=>{
 const created=await req(recurrence(),"POST",recurring("future-only-created","Contrato a reajustar"));
 assert.equal(created.status,201,await created.clone().text());
 const id=(await created.json()).id;
 const changed=await req(recurrence(id)+"/revise-value","POST",
  {intentId:"future-only-update",expectedVersion:1,vigenteAPartir:next,
   valorNovoCent:25200,motivo:"Reajuste válido de mês futuro"});
 assert.equal(changed.status,201,await changed.clone().text());
 const result=await req(base()+"/monthly?month="+future,"GET",undefined,{sub:"person-admin"});
 assert.equal(result.status,409);
 assert.deepEqual(await result.json(),{error:"monthly_revision_requires_historical_reconciliation"});
 const after=await req(base()+"/monthly?month="+next,"GET",undefined,{sub:"person-admin"});
 assert.equal(after.status,200);
});
