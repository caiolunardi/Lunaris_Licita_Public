import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {generateKeyPairSync,sign,webcrypto} from "node:crypto";
import {Miniflare} from "miniflare";
import {createF2Handler} from "../ui/worker/f2-cadastros.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const issuer="https://f2-workerd-local.cloudflareaccess.com", audience="f2-local-only-audience", origin="https://licita.local.test";
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),kid:"f2-local-only-key",alg:"RS256",use:"sig"};
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
 return JSON.parse(execFileSync("python3",["-c",py],{input:sql,encoding:"utf8",maxBuffer:8000000}));
}
before(async()=>{
 mf=new Miniflare({scriptPath:"web/ui/worker/test-local-entry.mjs",modules:true,
   modulesRules:[{type:"ESModule",include:["**/*.mjs"]}],compatibilityDate:"2026-08-06",
   cf:false,d1Databases:{DB:"20000000-0000-4000-8000-000000000001"},
   bindings:{F1_RUNTIME_ENABLED:"test_local_only",F2_RUNTIME_ENABLED:"test_local_only",
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
 "INSERT INTO fornecedores(id,empresa_id,nome,nome_normalizado) VALUES('f-e2','e2','Fornecedor Secreto','fornecedor secreto')"
 ])await db.prepare(sql).run();
});
after(async()=>await mf?.dispose());
const path=(kind="orgaos",company="e1")=>"/api/v1/companies/"+company+"/"+kind;
const body=(intentId,nome,extra={})=>({intentId,nome,cnpj:null,contato:null,email:null,telefone:null,observacoes:null,...extra});
test("sem D1/flag há 503 fail-closed",async()=>{
 const fn=createF2Handler({fetchKeys:async()=>new Response(JSON.stringify({keys:[jwk]}))});
 const r=await fn(new Request(origin+path(),{headers:{"cf-access-jwt-assertion":jwt()}}),{});
 assert.equal(r.status,503);
});
test("hostname remoto 503 mesmo com flags locais",async()=>{
 const r=await call(path(),"GET",undefined,{originUrl:"https://licita.lunaris.dev.br"});
 assert.equal(r.status,503);
});
test("JWT inválido, forjado ou não enviado é 401",async()=>{
 for(const token of ["",jwt("user-a",{},false),jwt("user-a",{aud:"outra"})])
   assert.equal((await call(path(),"GET",null,{token})).status,401);
});
test("leitor CONSULTA pode GET e nunca POST em sua empresa",async()=>{
 const r=await call(path("fornecedores","e2"));
 assert.equal(r.status,200);assert.equal((await r.json()).items.length,1);
 assert.equal((await call(path("fornecedores","e2"),"POST",body("consulta-1","Negado"))).status,403);
});
test("empresa cruzada é negada em lista, detalhe e alteração",async()=>{
 const token=jwt("user-b");
 for(const [url,method,payload] of [
 [path(),"GET",undefined],[path()+"/legacy-org","GET",undefined],
 [path(),"POST",body("cross-create","Negado")],
 [path()+"/legacy-org","PATCH",{intentId:"cross-patch",expectedVersion:1,ativo:false}]
 ])assert.equal((await call(url,method,payload,{token})).status,403);
});
test("criar órgão normaliza nome, gera auditoria+journal e mantém provenance",async()=>{
 const r=await call(path(),"POST",body("org-create","Órgão   Alfa",{uasg:"123456",email:"orgao@invalid.test",endereco_entrega_padrao:"Rua Teste"}));
 assert.equal(r.status,201,await r.clone().text());
 const a=await r.json();assert.equal(a.newVersion,1);
 const row=await db.prepare("SELECT * FROM orgaos WHERE id=?").bind(a.id).first();
 assert.equal(row.empresa_id,"e1");assert.equal(row.nome_normalizado,"orgao alfa");assert.equal(row.origem_dado,"NATIVO");
 assert.equal((await db.prepare("SELECT count(*) n FROM operacoes WHERE id='org-create'").first()).n,1);
 assert.equal((await db.prepare("SELECT count(*) n FROM eventos_auditoria WHERE operacao_id='org-create'").first()).n,1);
});
test("listagem paginada cursor keyset e filtro por prefixo de empresa",async()=>{
 for(const [id,nome] of [["org-beta","Órgão Beta"],["org-ceres","Órgão Ceres"]])
   assert.equal((await call(path(),"POST",body(id,nome))).status,201);
 const first=await(await call(path()+"?q=orgao&limit=1")).json();
 assert.equal(first.items.length,1);assert.ok(first.nextCursor);
 const second=await(await call(path()+"?q=orgao&limit=1&after="+first.nextCursor)).json();
 assert.notEqual(first.items[0].id,second.items[0].id);
 assert.equal((await call(path("orgaos","e2")+"?after="+first.nextCursor)).status,400);
});
test("mesma intenção é replay sem evento adicional; hash diferente rejeita",async()=>{
 const payload=body("org-create","Órgão   Alfa",{uasg:"123456",email:"orgao@invalid.test",endereco_entrega_padrao:"Rua Teste"});
 const r=await call(path(),"POST",payload);
 assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);
 assert.equal((await call(path(),"POST",body("org-create","Outro Nome"))).status,409);
 assert.equal((await db.prepare("SELECT count(*) n FROM eventos_auditoria WHERE operacao_id='org-create'").first()).n,1);
});
test("unicidade R4 de nome normalizado rejeita duplicação",async()=>{
 assert.equal((await call(path(),"POST",body("org-dup","ÓRGÃO ALFA"))).status,409);
});
test("PATCH CAS válido persiste, stale CAS bloqueia e audit permanece",async()=>{
 const old=await db.prepare("SELECT id,versao FROM orgaos WHERE operacao_id='org-create'").first();
 const r=await call(path()+"/"+old.id,"PATCH",body("org-update","Órgão Alfa Novo",{expectedVersion:old.versao,contato:"Setor"}));
 assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).newVersion,2);
 assert.equal((await call(path()+"/"+old.id,"PATCH",body("org-stale","Mudança",{expectedVersion:1}))).status,409);
 const item=(await(await call(path()+"/"+old.id)).json()).item;
 assert.equal(item.nome,"Órgão Alfa Novo");assert.equal(item.versao,2);
});
test("concorrência CAS permite uma atualização somente",async()=>{
 const old=await db.prepare("SELECT id,versao FROM orgaos WHERE operacao_id='org-update'").first();
 const [a,b]=await Promise.all([
  call(path()+"/"+old.id,"PATCH",body("org-race-a","Primeira Versão",{expectedVersion:old.versao})),
  call(path()+"/"+old.id,"PATCH",body("org-race-b","Segunda Versão",{expectedVersion:old.versao}))
 ]);
 assert.deepEqual([a.status,b.status].sort(),[200,409]);
});
test("desativação lógica e filtro inactive; DELETE não autorizado",async()=>{
 const old=await db.prepare("SELECT id,versao FROM orgaos WHERE operacao_id IN ('org-race-a','org-race-b')").first();
 const r=await call(path()+"/"+old.id,"PATCH",{intentId:"org-disable",expectedVersion:old.versao,ativo:false});
 assert.equal(r.status,200,await r.clone().text());
 const inactive=(await(await call(path()+"?state=inactive")).json()).items;
 assert.ok(inactive.some(x=>x.id===old.id));
 const active=(await(await call(path()+"?state=active&q=primeira")).json()).items;
 assert.ok(!active.some(x=>x.id===old.id));
 assert.equal((await call(path()+"/"+old.id,"DELETE")).status,405);
});
test("registro LEGADO não pode ser editado mesmo com vínculo OPERADOR",async()=>{
 assert.equal((await call(path()+"/legacy-org","PATCH",body("legacy-edit","Muda Legado",{expectedVersion:1}))).status,409);
 assert.equal((await db.prepare("SELECT origem_dado FROM orgaos WHERE id='legacy-org'").first()).origem_dado,"LEGADO");
});
test("fornecedor utiliza schema próprio; CNPJ alfanumérico sem gravar conteúdo estranho",async()=>{
 const r=await call(path("fornecedores"),"POST",body("supplier-create","Fornecedor Teste",{cnpj:"12ABC34501DE45"}));
 assert.equal(r.status,201,await r.clone().text());
 const id=(await r.json()).id;
 const item=(await(await call(path("fornecedores")+"/"+id)).json()).item;
 assert.equal(item.cnpj,"12ABC34501DE45");
 assert.equal((await call(path("fornecedores")+"/"+id,"PATCH",body("supplier-edit","Fornecedor Atualizado",{expectedVersion:1}))).status,200);
 assert.equal((await db.prepare("SELECT count(*) n FROM eventos_auditoria WHERE entidade_id_texto=?").bind(id).first()).n,2);
});
test("limites e filtros inválidos são rejeitados",async()=>{
 for(const q of ["?limit=300","?limit=0","?after=../../x","?state=erro","?q="+"x".repeat(81),"?limit=1&limit=2","?sort=created"])
   assert.equal((await call(path()+q)).status,400,q);
});
test("campos privilegiados, Origin errado e dados inválidos nunca gravam",async()=>{
 for(const obj of [
 {...body("bad-company","A"),empresa_id:"e2"},
 {...body("bad-user","B"),ator_id:"u3"},
 {...body("bad-provenance","C"),origem_dado:"LEGADO"},
 {...body("bad-version","D"),versao:1},
 {...body("bad-status","E"),ativo:false}
 ])assert.equal((await call(path(),"POST",obj)).status,400);
 assert.equal((await call(path(),"POST",body("bad-csrf","Outra"),{headers:{origin:"https://evil.invalid"}})).status,403);
});
test("tamanho máximo, MIME e verbos rejeitados",async()=>{
 assert.equal((await call(path(),"POST",{...body("huge","Muito Grande"),observacoes:"x".repeat(9500)})).status,413);
 assert.equal((await call(path(),"POST",body("mime","Teste"),{headers:{"content-type":"text/plain"}})).status,415);
 assert.equal((await call(path()+"/legacy-org","POST",body("post-detail","Teste"))).status,405);
});
