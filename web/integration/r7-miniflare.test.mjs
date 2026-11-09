// R7: HTTP end-to-end dentro de workerd/Miniflare e D1 LOCAL descartavel.
// NÃO usa Cloudflare remoto, Drive real ou chave Access de produção.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign, createHash, webcrypto } from "node:crypto";
import { Miniflare } from "miniflare";
import { verifyR2Evidence } from "../src/r7/documents.mjs";
import { copyDocumentVersionToDrive } from "../src/r7/archive.mjs";
import { dispatchNotification } from "../src/r7/notification-outbox.mjs";
import { materializeRecurrence } from "../src/r7/recurrence.mjs";
import { hashIntent } from "../src/r7/domain.mjs";
import { reviewArchiveEligibility } from "../src/r7/archive-eligibility.mjs";
import { assessArchiveEvidence } from "../src/r7/retention.mjs";
import { createDocumentAttachment } from "../src/r7/document-service.mjs";
import { LEGACY_FIELD_KEYS } from "../src/r7/legacy-field-keys.mjs";
import {beginArchiveCopy,inspectArchiveAttempt,reconcileArchiveAttempt} from "../src/r7/archive-e4.mjs";

if (!globalThis.crypto) globalThis.crypto=webcrypto;
const issuer="https://r7-workerd-test.cloudflareaccess.com";
const audience="r7-workerd-app";
const origin="https://licita.local.test";
const {publicKey,privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk={...publicKey.export({format:"jwk"}),kid:"r7-local-public",alg:"RS256",use:"sig"};
const uid="00000000-0000-4000-8000-000000000020";
const localDate=new Intl.DateTimeFormat("en-CA",{
  timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"
}).formatToParts(new Date());
const year=localDate.find(x=>x.type==="year").value;
const month=localDate.find(x=>x.type==="month").value;
const competence=year+"-"+month;
const today=competence+"-"+localDate.find(x=>x.type==="day").value;
const file=[
  "migrations/0001_ddl_v1.sql","migrations/0002_ddl_v1r_r4.sql",
  "migrations/0003_ddl_v1r_r5.sql","migrations/0004_ddl_v1r_r6.sql",
  "migrations/0005_ddl_v1r_r7_w1.sql","migrations/0006_ddl_v1r_r7_quantidades.sql",
  "migrations/0007_ddl_v1r_r7_etapa1.sql",
  "migrations/0008_ddl_v1r_r7_etapa2_guardas.sql",
  "migrations/0009_ddl_v1r_r7_etapa2_retificacoes.sql",
  "migrations/0010_ddl_v1r_r7_etapa2_retencao_strict.sql",
  "migrations/0011_ddl_v1r_r7_etapa2_ciclos_workerd.sql",
  "migrations/0012_ddl_v1r_r7_etapa3_iam.sql",
  "migrations/0013_ddl_v1r_r7_etapa4_backup_ledger.sql"
];
let mf,db;
function jwt(override={}){
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:"RS256",kid:jwk.kid,typ:"JWT"})).toString("base64url");
  const payload=Buffer.from(JSON.stringify({iss:issuer,aud:[audience],
    sub:"operator-sub",iat:now-10,exp:now+180,...override})).toString("base64url");
  const data=header+"."+payload;
  return data+"."+sign("RSA-SHA256",Buffer.from(data),privateKey).toString("base64url");
}
async function http(path,method="GET",body,header={}){
  const h={"cf-access-jwt-assertion":jwt(),
    ...(method==="POST"?{"origin":origin,"content-type":"application/json"}:{}),
    ...header
  };
  const params={method,headers:h};
  if(method==="POST")params.body=JSON.stringify(body);
  return mf.dispatchFetch(origin+path,params);
}
const credit=(i,ref,value=2000)=>({
 intentId:i,contaReceberId:"cr1",valorRecebidoCent:value,
 retencaoConfirmadaCent:0,dataCredito:"2026-11-07",
 contaDestino:"BB",referenciaExterna:ref
});
const note=(i,version,obs)=>({
 intentId:i,tituloId:"t1",expectedVersion:version,observacoes:obs
});

before(async()=>{
  mf=new Miniflare({
    scriptPath:"web/src/r7/miniflare-only-worker.mjs",
    modules:true,
    modulesRules:[{type:"ESModule",include:["**/*.mjs"]}],
    compatibilityDate:"2026-08-06",
    cf:false,
    d1Databases:{DB:uid},
    r2Buckets:["R2"],
    bindings:{
      R7_RUNTIME_ENABLED:"test_local_only",
      R7_TEST_ADAPTER:"strictly_local",
      R7_TEST_JWKS_PUBLIC:JSON.stringify({keys:[jwk]}),
      ACCESS_TEAM_DOMAIN:issuer,
      ACCESS_AUD:audience,
      APP_ORIGIN:origin
    }
  });
  db=await mf.getD1Database("DB");
  const splitSQL=(sql)=>{
    // SQLite oficial define a finalização de triggers/casos CASE, não split(';').
    // Python sqlite3.complete_statement disponível no runner local, sem rede.
    const py=[
      "import json, sqlite3, sys",
      "acc = ''",
      "out = []",
      "for line in sys.stdin:",
      "    if line.lstrip().startswith('--'): continue",
      "    acc += line",
      "    if sqlite3.complete_statement(acc.strip()):",
      "        out.append(acc.strip())",
      "        acc = ''",
      "if acc.strip(): raise RuntimeError('SQL INCOMPLETO')",
      "print(json.dumps(out))"
    ].join("\n");
    return JSON.parse(execFileSync("python3",["-c",py],{
      input:sql,encoding:"utf8",maxBuffer:4*1024*1024
    }));
  };
  for(const path of file){
    const statements=splitSQL(readFileSync(path,"utf8"));
    if(statements.length===0)throw Error("Migration vazia: "+path);
    for (let i=0;i<statements.length;i++) {
      const stmt=statements[i];
      try { await db.prepare(stmt).run(); }
      catch(error){throw Error("migration "+path+" statement "+i+" ["+
        stmt.slice(0,250)+"]: "+String(error),{cause:error});}
    }
  }
  // Somente dados sintéticos; compatibilidade com as seis migrations já
  // verificada no Wrangler local, agora também no workerd conectado por D1.
  const seedSql=`
    INSERT INTO empresas(id,nome) VALUES('e1','PJ local'),('e2','PJ isolada');
    INSERT INTO usuarios(id,access_issuer,access_subject,email_normalizado)
    VALUES('user1','${issuer}','operator-sub','operador@local.invalid'),
          ('user2','${issuer}','consult-sub','consulta@local.invalid'),
          ('userA','${issuer}','admin-sub','admin@local.invalid');
    INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo)
    VALUES('user1','e1','OPERADOR',1),('user2','e1','CONSULTA',1),
          ('userA','e1','ADMIN',1);
    INSERT INTO orgaos(id,empresa_id,nome) VALUES('o1','e1','Orgao local');
    INSERT INTO fornecedores(id,empresa_id,nome) VALUES('f1','e1','Fornecedor local');
    INSERT INTO licitacoes(id,empresa_id,orgao_id,numero)
    VALUES('l1','e1','o1','2026-01');
    INSERT INTO licitacao_itens
    (id,empresa_id,licitacao_id,numero_item,resultado,quantidade_prevista_mil,
     quantidade_ganha_mil,valor_final_unit_cent)
    VALUES('li1','e1','l1','1','GANHO',3000,3000,1000);
    INSERT INTO empenhos
    (id,empresa_id,licitacao_id,orgao_id_escopo,numero,situacao)
    VALUES('ep1','e1','l1','o1','EP1','CONFIRMADO');
    INSERT INTO empenho_itens
    (id,empresa_id,empenho_id,licitacao_item_id,licitacao_id_escopo,quantidade_mil)
    VALUES('ei1','e1','ep1','li1','l1',3000);
    INSERT INTO compras
    (id,empresa_id,empenho_id,fornecedor_id,situacao)
    VALUES('co1','e1','ep1','f1','CONFIRMADA');
    INSERT INTO compra_itens
    (id,empresa_id,compra_id,empenho_item_id,empenho_id_escopo,quantidade_mil)
    VALUES('ci1','e1','co1','ei1','ep1',3000);
    INSERT INTO notas_fiscais
    (id,empresa_id,empenho_id,orgao_id_escopo,situacao)
    VALUES('nf1','e1','ep1','o1','EMITIDA');
    INSERT INTO contas_receber
    (id,empresa_id,nota_fiscal_id,parcela,valor_bruto_cent)
    VALUES('cr1','e1','nf1',1,5000);
    INSERT INTO titulos_pagar
    (id,empresa_id,tipo,beneficiario,categoria_despesa,valor_nominal_cent)
    VALUES('t1','e1','DIVERSO','Serviço','SERVICO',3000),
          ('tpay','e1','DIVERSO','Pagamento livre','SERVICO',3000),
          ('tparallel','e1','DIVERSO','Pagamento simultaneo','SERVICO',3000);
    INSERT INTO recorrencias
    (id,empresa_id,beneficiario,categoria_despesa,dia_vencimento,
     primeiro_vencimento,valor_atual_cent,estado)
    VALUES('rec_m','e1','Internet','INTERNET',31,
           '${competence}-07',18000,'ATIVA');
  `;
  const statements=[];let current="";
  for(const row of seedSql.split("\n")){
    if(!row.trim())continue;
    current+=(current?" ":"")+row.trim();
    if(row.trim().endsWith(";")){statements.push(current);current="";}
  }
  if(current)throw Error("Fixture seed incompleta");
  for(const statement of statements) await db.prepare(statement).run();
});
after(async()=>{await mf?.dispose();});

test("workerd/D1 local sem JWT nao devolve nenhum titulo",async()=>{
  const r=await http("/r7/companies/e1/titles","GET",null,{"cf-access-jwt-assertion":""});
  assert.equal(r.status,401);
});
test("workerd/D1 local JWT RS256 valido retorna titulo somente e1",async()=>{
  const r=await http("/r7/companies/e1/titles");
  assert.equal(r.status,200);
  const j=await r.json();
  assert.equal(j.titulos.length,3);
  assert.deepEqual(j.titulos.map(t=>t.id).sort(),["t1","tparallel","tpay"]);
});
test("workerd/D1 local mesmo usuario nao tem acesso a e2",async()=>{
  const r=await http("/r7/companies/e2/titles");
  assert.equal(r.status,403);
});
test("workerd/D1 local consulta pode ler mas nao registrar credito",async()=>{
  const r=await http("/r7/companies/e1/credits","POST",credit("intent-consulta","PIX-10"),{
    "cf-access-jwt-assertion":jwt({sub:"consult-sub"})
  });
  assert.equal(r.status,403);
});
test("workerd/D1 local alteracao de empresa no body rejeitada",async()=>{
  const r=await http("/r7/companies/e1/credits","POST",
    {...credit("intent-spoof","PIX-11"),empresa_id:"e2"});
  assert.equal(r.status,400);
  const count=await db.prepare("SELECT count(*) AS n FROM recebimentos").first();
  assert.equal(count.n,0);
});
test("workerd/D1 local credito grava recebimento e journal em uma transacao",async()=>{
  const r=await http("/r7/companies/e1/credits","POST",credit("intentA","PIX-01"));
  assert.equal(r.status,201,await r.text());
  const row=await db.prepare("SELECT valor_recebido_cent,operacao_id "
    +"FROM recebimentos WHERE operacao_id='intentA'").first();
  assert.equal(row.valor_recebido_cent,2000);
  const journal=await db.prepare("SELECT estado FROM operacoes WHERE id='intentA'").first();
  assert.equal(journal.estado,"CONCLUIDA");
});
test("workerd/D1 local replay idempotente nao escreve nova linha",async()=>{
  const r=await http("/r7/companies/e1/credits","POST",credit("intentA","PIX-01"));
  assert.equal(r.status,200);
  assert.equal((await r.json()).replayed,true);
  const row=await db.prepare("SELECT count(*) AS n FROM recebimentos "
    +"WHERE operacao_id='intentA'").first();
  assert.equal(row.n,1);
});
test("workerd/D1 local intent igual com payload diferente recebe conflito",async()=>{
  const r=await http("/r7/companies/e1/credits","POST",credit("intentA","PIX-01",1000));
  assert.equal(r.status,409);
});
test("workerd/D1 local duas requisições concorrentes com referencia igual nao duplicam",async()=>{
  const [a,b]=await Promise.all([
    http("/r7/companies/e1/credits","POST",credit("intentB","PIX-C",1000)),
    http("/r7/companies/e1/credits","POST",credit("intentC","PIX-C",1000))
  ]);
  assert.deepEqual([a.status,b.status].sort(),[201,409]);
  const row=await db.prepare("SELECT count(*) AS n FROM recebimentos "
    +"WHERE referencia_externa='PIX-C'").first();
  assert.equal(row.n,1);
});
test("workerd/D1 local soma nao deixa ultrapassar parcela",async()=>{
  const r=await http("/r7/companies/e1/credits","POST",credit("intentD","PIX-OVER",2500));
  assert.equal(r.status,409);
  const row=await db.prepare("SELECT count(*) AS n FROM recebimentos "
    +"WHERE operacao_id='intentD'").first();
  assert.equal(row.n,0);
});
test("workerd/D1 local CAS concorrente apenas uma atualiza mesmo versao",async()=>{
  const [a,b]=await Promise.all([
    http("/r7/companies/e1/titles/observations","POST",note("noteA",1,"nova1")),
    http("/r7/companies/e1/titles/observations","POST",note("noteB",1,"nova2"))
  ]);
  assert.deepEqual([a.status,b.status].sort(),[201,409]);
  const t=await db.prepare("SELECT versao FROM titulos_pagar WHERE id='t1'").first();
  assert.equal(t.versao,2);
});
test("workerd/D1 local R2 simulado armazena e valida bytes reais",async()=>{
  const r2=await mf.getR2Bucket("R2");
  const bytes=new TextEncoder().encode("documento sintetico da auditoria");
  await r2.put("e1/doc1",bytes);
  const sha=createHash("sha256").update(bytes).digest("hex");
  const result=await verifyR2Evidence(r2,{
    chave_r2:"e1/doc1",tamanho_bytes:bytes.byteLength,sha256:sha
  },"e1");
  assert.equal(result.verified,true);
});
test("workerd/D1 local saldos e journals coerentes apos concorrencia",async()=>{
  const recv=await db.prepare("SELECT count(*) AS n FROM recebimentos WHERE operacao_id IS NOT NULL").first();
  const journals=await db.prepare("SELECT count(*) AS n FROM operacoes WHERE tipo IN ('RECEBIMENTO','TITULO_OBSERVACAO')").first();
  assert.ok(recv.n>=2);
  assert.ok(journals.n>=3);
});


test("OK04 Workerd/D1 local pagamento efetivo pode divergir do nominal",async()=>{
  const body={intentId:"payA",tituloId:"tpay",expectedVersion:1,
              dataPagamento:"2026-11-07",valorPagoCent:3500};
  const r=await http("/r7/companies/e1/payments","POST",body);
  assert.equal(r.status,201,await r.text());
  const got=await db.prepare("SELECT id,valor_pago_cent FROM titulo_baixas "
    +"WHERE titulo_id='tpay' AND tipo='QUITACAO'").first();
  assert.equal(got.valor_pago_cent,3500);
  assert.equal((await db.prepare("SELECT versao FROM titulos_pagar "
    +"WHERE id='tpay'").first()).versao,2);
});
test("workerd/D1 local retry da mesma quitacao faz replay e nao duplica",async()=>{
  const body={intentId:"payA",tituloId:"tpay",expectedVersion:1,
              dataPagamento:"2026-11-07",valorPagoCent:3500};
  const r=await http("/r7/companies/e1/payments","POST",body);
  assert.equal(r.status,200);
  assert.equal((await r.json()).replayed,true);
  const count=await db.prepare("SELECT count(*) AS n FROM titulo_baixas "
    +"WHERE titulo_id='tpay'").first();
  assert.equal(count.n,1);
});
test("FIN07 Workerd/D1 local desfazimento administrativo preserva original sem movimento bancario",async()=>{
  const original=await db.prepare("SELECT id FROM titulo_baixas "
    +"WHERE titulo_id='tpay' AND tipo='QUITACAO'").first();
  const body={intentId:"undoA",tituloId:"tpay",expectedVersion:2,
              baixaOriginalId:original.id,motivo:"Pagamento cancelado"};
  const r=await http("/r7/companies/e1/payments/undo","POST",body);
  assert.equal(r.status,201,await r.text());
  assert.equal((await db.prepare("SELECT situacao FROM v_titulos_situacao "
    +"WHERE id='tpay'").first()).situacao,"ABERTO");
  assert.equal((await db.prepare("SELECT count(*) AS n FROM recebimentos "
    +"WHERE tipo_movimento='ESTORNO'").first()).n,0);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM titulo_baixas "
    +"WHERE titulo_id='tpay'").first()).n,2);
});
test("workerd/D1 local duas quitacoes simultaneas nao podem coexistir",async()=>{
  const make=id=>({intentId:id,tituloId:"tparallel",expectedVersion:1,
                  dataPagamento:"2026-11-07",valorPagoCent:2000});
  const [a,b]=await Promise.all([
    http("/r7/companies/e1/payments","POST",make("payP1")),
    http("/r7/companies/e1/payments","POST",make("payP2"))
  ]);
  assert.deepEqual([a.status,b.status].sort(),[201,409]);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM titulo_baixas "
    +"WHERE titulo_id='tparallel' AND tipo='QUITACAO'").first()).n,1);
});
test("FIN04 Workerd/D1 local estorno copia data e valores originais sem alteracao bancaria negativa",async()=>{
  const orig=await db.prepare("SELECT id FROM recebimentos "
    +"WHERE operacao_id='intentA' AND tipo_movimento='RECEBIMENTO'").first();
  const r=await http("/r7/companies/e1/credits/reversal","POST",{
    intentId:"reversalA",recebimentoOriginalId:orig.id,motivo:"Conferencia"
  });
  assert.equal(r.status,201,await r.text());
  const row=await db.prepare("SELECT d.data_credito,d.valor_recebido_cent,"
    +"d.retencao_confirmada_cent,d.estorno_de_id FROM recebimentos d "
    +"WHERE d.operacao_id='reversalA'").first();
  assert.deepEqual(row,{
    data_credito:"2026-11-07",valor_recebido_cent:2000,
    retencao_confirmada_cent:0,estorno_de_id:orig.id
  });
});
test("workerd/D1 local segunda tentativa de estorno diferente nao duplica",async()=>{
  const orig=await db.prepare("SELECT id FROM recebimentos "
    +"WHERE operacao_id='intentA'").first();
  const r=await http("/r7/companies/e1/credits/reversal","POST",{
    intentId:"reversalB",recebimentoOriginalId:orig.id,motivo:"Segundo"
  });
  assert.equal(r.status,409);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM recebimentos "
    +"WHERE estorno_de_id=?").bind(orig.id).first()).n,1);
});
test("workerd/D1 local nao aceita origem/empresa forjadas no desfazimento",async()=>{
  const r=await http("/r7/companies/e1/payments/undo","POST",{
    intentId:"undo-forge",tituloId:"tpay",expectedVersion:3,
    baixaOriginalId:"qualquer",motivo:"Teste",ator_id:"outro"
  });
  assert.equal(r.status,400);
});


test("REC01 Workerd/D1 local materializa recorrencia opcional uma vez com vencimento civil",async()=>{
  const r=await http("/r7/companies/e1/recurrences/materialize","POST",{
    intentId:"recRunA",recorrenciaId:"rec_m",competencia:competence,expectedVersion:1
  });
  assert.equal(r.status,201,await r.text());
  const title=await db.prepare("SELECT tipo,competencia,vencimento,valor_nominal_cent FROM "
    +"titulos_pagar WHERE recorrencia_id='rec_m'").first();
  assert.equal(title.tipo,"DIVERSO");
  assert.equal(title.competencia,competence);
  assert.equal(title.vencimento,competence+"-07");
  assert.equal(title.valor_nominal_cent,18000);
  const docs=await db.prepare("SELECT count(*) AS n FROM documento_vinculos_extensao").first();
  assert.equal(docs.n,0);
});
test("REC01 Workerd/D1 local replay de competencia nao cria titulo novo",async()=>{
  const r=await http("/r7/companies/e1/recurrences/materialize","POST",{
    intentId:"recRunA",recorrenciaId:"rec_m",competencia:competence,expectedVersion:1
  });
  assert.equal(r.status,200);
  assert.equal((await r.json()).replayed,true);
  const titles=await db.prepare("SELECT count(*) AS n FROM titulos_pagar WHERE recorrencia_id='rec_m'").first();
  assert.equal(titles.n,1);
});
test("workerd/D1 local titulo mensal nao duplica competencia com outra intent",async()=>{
  const r=await http("/r7/companies/e1/recurrences/materialize","POST",{
    intentId:"recRunB",recorrenciaId:"rec_m",competencia:competence,expectedVersion:2
  });
  assert.equal(r.status,409);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM titulos_pagar "
    +"WHERE recorrencia_id='rec_m'").first()).n,1);
});


test("Q08 Workerd local recusa NF cuja soma monetaria nao bate",async()=>{
  await db.prepare("INSERT INTO notas_fiscais "+
    "(id,empresa_id,empenho_id,orgao_id_escopo,situacao,valor_documento_cent) "+
    "VALUES ('nfQ08','e1','ep1','o1','EMITIDA',151)").run();
  await db.prepare("INSERT INTO nota_fiscal_itens "+
    "(id,empresa_id,nota_fiscal_id,empenho_item_id,empenho_id_escopo,"+
    "quantidade_mil,valor_unit_cent,conferencia) "+
    "VALUES ('q08line1','e1','nfQ08','ei1','ep1',1000,101,'VALIDADO'),"+
    "('q08line2','e1','nfQ08','ei1','ep1',500,101,'VALIDADO')").run();
  await db.prepare("INSERT INTO contas_receber "+
    "(id,empresa_id,nota_fiscal_id,parcela,valor_bruto_cent,conferencia) "+
    "VALUES ('q08p1','e1','nfQ08',1,100,'VALIDADO'),"+
    "('q08p2','e1','nfQ08',2,52,'VALIDADO')").run();
  let r=await http("/r7/companies/e1/invoices/confirm","POST",{
    intentId:"q08bad",notaFiscalId:"nfQ08",expectedVersion:1
  });
  assert.equal(r.status,409);
  const count=await db.prepare("SELECT count(*) AS n FROM nf_conciliacoes "+
    "WHERE nota_fiscal_id='nfQ08'").first();
  assert.equal(count.n,0);
});
test("Q08 Workerd concilia HALF_UP por linha e sela itens e parcelas",async()=>{
  await db.prepare("UPDATE notas_fiscais SET valor_documento_cent=152 "+
    "WHERE id='nfQ08'").run();
  const r=await http("/r7/companies/e1/invoices/confirm","POST",{
    intentId:"q08good",notaFiscalId:"nfQ08",expectedVersion:1
  });
  assert.equal(r.status,201,await r.text());
  const seal=await db.prepare("SELECT valor_documento_cent,valor_itens_cent,"+
    "valor_parcelas_cent FROM nf_conciliacoes WHERE nota_fiscal_id='nfQ08'").first();
  assert.deepEqual(seal,{valor_documento_cent:152,
    valor_itens_cent:152,valor_parcelas_cent:152});
  await assert.rejects(db.prepare("UPDATE nota_fiscal_itens SET valor_unit_cent=999 "+
    "WHERE id='q08line1'").run());
  await assert.rejects(db.prepare("UPDATE contas_receber SET valor_bruto_cent=99 "+
    "WHERE id='q08p1'").run());
});
test("Q08 Workerd replay do mesmo selo nao altera ids",async()=>{
  const r=await http("/r7/companies/e1/invoices/confirm","POST",{
    intentId:"q08good",notaFiscalId:"nfQ08",expectedVersion:1
  });
  assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);
});
test("FIN05 retenção prevista sozinha nao autoriza credito",async()=>{
  await db.prepare("INSERT INTO contas_receber "+
    "(id,empresa_id,nota_fiscal_id,parcela,valor_bruto_cent,retencao_prevista_cent) "+
    "VALUES ('crRet','e1','nf1',2,5000,300)").run();
  const r=await http("/r7/companies/e1/credits","POST",{
    intentId:"retNoEvidence",contaReceberId:"crRet",valorRecebidoCent:1000,
    retencaoConfirmadaCent:100,dataCredito:"2026-11-07",
    contaDestino:"BB-RET",referenciaExterna:"PIX-RET"
  });
  assert.equal(r.status,409);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM recebimentos "+
    "WHERE conta_receber_id='crRet'").first()).n,0);
});
test("FIN05 Workerd exige ADMIN e verifica bytes de comprovante antes do atestado",async()=>{
  const bucket=await mf.getR2Bucket("R2");
  const bytes=new TextEncoder().encode("comprovante sintetico de retencao");
  const hash=createHash("sha256").update(bytes).digest("hex");
  await bucket.put("e1/retencao-verificada",bytes);
  await db.prepare("INSERT INTO documentos(id,empresa_id,tipo) "+
    "VALUES('dRet','e1','COMPROVANTE_RETENCAO')").run();
  await db.prepare("INSERT INTO documento_versoes "+
    "(id,empresa_id,documento_id,numero_versao,estado_integridade,tamanho_bytes,sha256) "+
    "VALUES ('vRet','e1','dRet',1,'PENDENTE',?,?)").bind(bytes.length,hash).run();
  await db.prepare("INSERT INTO documento_vinculos "+
    "(id,empresa_id,documento_id,papel,conta_receber_id,ativo) "+
    "VALUES('linkRet','e1','dRet','COMPROVANTE_CREDITO','crRet',1)").run();
  await db.prepare("INSERT INTO documento_localizacoes "+
    "(id,empresa_id,versao_id,provedor,chave_r2,status) "+
    "VALUES ('lRet','e1','vRet','R2','e1/retencao-verificada','PENDENTE')").run();
  await db.prepare("UPDATE documento_localizacoes SET status='VERIFICADO',"+
    "hash_verificado=?,tamanho_verificado=?,verificado_em="+
    "strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='lRet'").bind(hash,bytes.length).run();
  await db.prepare("INSERT INTO operacoes "+
    "(id,empresa_id,tipo,hash_pedido,ator_id,estado) "+
    "VALUES('verifyRet','e1','VERIFICAR_VERSAO','verify-hash','userA','CONCLUIDA')").run();
  await db.prepare("UPDATE documento_versoes SET estado_integridade='VERIFICADO',"+
    "versao=versao+1,operacao_id='verifyRet' WHERE id='vRet'").run();
  let r=await http("/r7/companies/e1/retentions/attest","POST",{
    intentId:"atestNoRole",contaReceberId:"crRet",
    documentoVersaoId:"vRet",valorConfirmadoCent:100
  });
  assert.equal(r.status,403);
  r=await http("/r7/companies/e1/retentions/attest","POST",{
    intentId:"atestE1",contaReceberId:"crRet",
    documentoVersaoId:"vRet",valorConfirmadoCent:100
  },{"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
  assert.equal(r.status,201,await r.text());
});
test("FIN05 credito sem atestado nao pode reutilizar valor previsto",async()=>{
  const r=await http("/r7/companies/e1/credits","POST",{
    intentId:"retNoProof2",contaReceberId:"crRet",valorRecebidoCent:1000,
    retencaoConfirmadaCent:300,dataCredito:"2026-11-07",
    contaDestino:"BB-RET",referenciaExterna:"PIX-RET-2"
  });
  assert.equal(r.status,409);
});
test("FIN05 recebimento com atestado exato e unico gera fato confirmado",async()=>{
  const a=await db.prepare("SELECT id FROM retencao_atestados WHERE operacao_id='atestE1'").first();
  assert.ok(a);
  const r=await http("/r7/companies/e1/credits","POST",{
    intentId:"retCredit",contaReceberId:"crRet",valorRecebidoCent:1000,
    retencaoConfirmadaCent:100,retencaoAtestadoId:a.id,
    dataCredito:"2026-11-07",contaDestino:"BB-RET",referenciaExterna:"PIX-RET-1"
  });
  assert.equal(r.status,201,await r.text());
  const record=await db.prepare("SELECT retencao_confirmada_cent,retencao_atestado_id "+
    "FROM recebimentos WHERE operacao_id='retCredit'").first();
  assert.equal(record.retencao_confirmada_cent,100);
  assert.equal(record.retencao_atestado_id,a.id);
});
test("FIN05 atestado usado nao confirma duas vezes",async()=>{
  const a=await db.prepare("SELECT id FROM retencao_atestados WHERE operacao_id='atestE1'").first();
  const r=await http("/r7/companies/e1/credits","POST",{
    intentId:"retDouble",contaReceberId:"crRet",valorRecebidoCent:100,
    retencaoConfirmadaCent:100,retencaoAtestadoId:a.id,
    dataCredito:"2026-11-07",contaDestino:"BB-RET",referenciaExterna:"PIX-RET-3"
  });
  assert.equal(r.status,409);
});
test("OK01 cadeia com dois empenhos duas compras e quatro remessas parciais",async()=>{
  await db.prepare("INSERT INTO licitacoes (id,empresa_id,orgao_id,numero) "+
    "VALUES ('lPartial','e1','o1','PARTIAL-2026')").run();
  await db.prepare("INSERT INTO licitacao_itens "+
    "(id,empresa_id,licitacao_id,numero_item,resultado,"+
    "quantidade_prevista_mil,quantidade_ganha_mil,valor_final_unit_cent) "+
    "VALUES ('liPartial','e1','lPartial','1','GANHO',10000,6000,120)").run();
  const r=await http("/r7/companies/e1/commercial/partial-award","POST",{
    intentId:"partialCycle",licitacaoId:"lPartial",
    licitacaoItemId:"liPartial",fornecedorId:"f1",
    empenhos:[
      {quantidadeMil:4000,entregasMil:[1000,3000]},
      {quantidadeMil:2000,entregasMil:[500,1500]}
    ]
  });
  assert.equal(r.status,201,await r.text());
  const out=await db.prepare("SELECT COUNT(*) AS n FROM empenhos WHERE licitacao_id='lPartial'").first();
  assert.equal(out.n,2);
  const stats=await db.prepare("SELECT SUM(ei.quantidade_mil) AS n "+
    "FROM empenho_itens ei JOIN empenhos e ON e.id=ei.empenho_id "+
    "WHERE e.licitacao_id='lPartial'").first();
  assert.equal(stats.n,6000);
  const invoices=await db.prepare("SELECT COUNT(*) AS n FROM notas_fiscais nf "+
    "JOIN empenhos e ON e.id=nf.empenho_id WHERE e.licitacao_id='lPartial' "+
    "AND nf.situacao='EMITIDA'").first();
  assert.equal(invoices.n,2);
  const shipments=await db.prepare("SELECT COUNT(*) AS n FROM envios en "+
    "JOIN empenhos e ON e.id=en.empenho_id WHERE e.licitacao_id='lPartial' "+
    "AND en.situacao='DESPACHADO'").first();
  assert.equal(shipments.n,4);
});
test("OK01 outra intent nao pode empenhar alem das unidades ganhas; rollback",async()=>{
  const r=await http("/r7/companies/e1/commercial/partial-award","POST",{
    intentId:"partialOver",licitacaoId:"lPartial",
    licitacaoItemId:"liPartial",fornecedorId:"f1",
    empenhos:[
      {quantidadeMil:4000,entregasMil:[1000,3000]},
      {quantidadeMil:2000,entregasMil:[500,1500]}
    ]
  });
  assert.equal(r.status,409);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM empenhos "+
    "WHERE licitacao_id='lPartial'").first()).n,2);
});


test("OK12 Workerd local copia duas versões para adaptadores Drive/backup sem apagar R2",async()=>{
  const bucket=await mf.getR2Bucket("R2");
  const principal={issuer,subject:"operator-sub"};
  const driveFiles=new Map(),restoredFiles=new Map();
  const clone=v=>new Uint8Array(v.buffer,v.byteOffset,v.byteLength).slice();
  const drive={
    async put(key,bytes){driveFiles.set(key,clone(bytes));return "MEM-DRIVE:"+key;},
    async get(id){const v=driveFiles.get(id.slice(10));return v?.slice();}
  };
  const backup={
    async put(key,bytes){restoredFiles.set(key,clone(bytes));return "MEM-BACKUP:"+key;},
    async restore(id){const v=restoredFiles.get(id.slice(11));return v?.slice();}
  };
  await db.prepare("INSERT INTO documentos(id,empresa_id,tipo) "+
    "VALUES ('dHist','e1','EDITAL')").run();
  await db.prepare("INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado) "+
    "VALUES('verifyHist','e1','VERIFICAR_VERSAO','hist-journal','user1','CONCLUIDA')").run();
  for(const [number,content] of [[1,"editais versão original"],[2,"editais versão revisada"]]){
    const id="vHist"+number,location="lHist"+number;
    const bytes=new TextEncoder().encode(content);
    const hash=createHash("sha256").update(bytes).digest("hex");
    await bucket.put("e1/historical-v"+number,bytes);
    await db.prepare("INSERT INTO documento_versoes "+
      "(id,empresa_id,documento_id,numero_versao,estado_integridade,tamanho_bytes,sha256) "+
      "VALUES (?, 'e1','dHist',?,'PENDENTE',?,?)").bind(id,number,bytes.length,hash).run();
    await db.prepare("INSERT INTO documento_localizacoes "+
      "(id,empresa_id,versao_id,provedor,chave_r2,status) "+
      "VALUES (?,'e1',?,'R2',?,'PENDENTE')").bind(location,id,
      "e1/historical-v"+number).run();
    await db.prepare("UPDATE documento_localizacoes SET status='VERIFICADO',"+
      "hash_verificado=?,tamanho_verificado=?,"+
      "verificado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
      "WHERE id=?").bind(hash,bytes.length,location).run();
    await db.prepare("UPDATE documento_versoes SET estado_integridade='VERIFICADO',"+
      "versao=versao+1,operacao_id='verifyHist' WHERE id=?").bind(id).run();
  }
  for(const number of [1,2]){
    const result=await copyDocumentVersionToDrive(db,principal,"e1",{
      intentId:"archive"+number,documentoVersaoId:"vHist"+number
    },{r2:bucket,drive,backup});
    assert.equal(result.documentoId,"dHist");
    assert.equal(result.numeroVersao,number);
    assert.equal(result.state,"SOBREPOSICAO_30_DIAS");
    assert.equal(result.r2DeletionAuthorized,false);
  }
  assert.equal((await db.prepare("SELECT count(*) AS n FROM documento_versoes "+
    "WHERE documento_id='dHist'").first()).n,2);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM documento_transferencias "+
    "WHERE empresa_id='e1' AND estado='SOBREPOSICAO_30_DIAS'").first()).n,2);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM documento_localizacoes "+
    "WHERE empresa_id='e1' AND versao_id IN ('vHist1','vHist2') AND "+
    "provedor='R2' AND status='VERIFICADO'").first()).n,2);
  assert.ok(await bucket.get("e1/historical-v1"));
  const replay=await copyDocumentVersionToDrive(db,principal,"e1",{
    intentId:"archive1",documentoVersaoId:"vHist1"
  },{r2:bucket,drive,backup});
  assert.equal(replay.replayed,true);
});
test("OK12 falha de restore simulado nunca marca nova transferencia no D1",async()=>{
  const bucket=await mf.getR2Bucket("R2");
  // Provar falha depois de copiar os bytes da origem, em versao nova que
  // ainda nao tem destino, em vez de depender do bloqueio de copia existente.
  const bytes3=new TextEncoder().encode("terceira versao inedita");
  const hash3=createHash("sha256").update(bytes3).digest("hex");
  await bucket.put("e1/historical-v3",bytes3);
  await db.prepare("INSERT INTO documento_versoes "+
    "(id,empresa_id,documento_id,numero_versao,estado_integridade,tamanho_bytes,sha256) "+
    "VALUES ('vHist3','e1','dHist',3,'PENDENTE',?,?)").bind(bytes3.length,hash3).run();
  await db.prepare("INSERT INTO documento_localizacoes "+
    "(id,empresa_id,versao_id,provedor,chave_r2,status) "+
    "VALUES ('lHist3','e1','vHist3','R2','e1/historical-v3','PENDENTE')").run();
  await db.prepare("UPDATE documento_localizacoes SET status='VERIFICADO',"+
    "hash_verificado=?,tamanho_verificado=?,"+
    "verificado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
    "WHERE id='lHist3'").bind(hash3,bytes3.length).run();
  await db.prepare("UPDATE documento_versoes SET estado_integridade='VERIFICADO',"+
    "versao=versao+1,operacao_id='verifyHist' WHERE id='vHist3'").run();
  const separateDrive=new Map();
  const drive={
    async put(key,bytes){separateDrive.set(key,Uint8Array.from(bytes));return key;},
    async get(key){return separateDrive.get(key)?.slice();}
  };
  const backup={
    async put(){return "invalid-backup";},
    async restore(){return new TextEncoder().encode("bytes corrompidos");}
  };
  await assert.rejects(()=>copyDocumentVersionToDrive(db,{
    issuer,subject:"operator-sub"
  },"e1",{intentId:"archiveCorrupt",documentoVersaoId:"vHist3"},
  {r2:bucket,drive,backup}),e=>e.code==="document_copy_hash_mismatch");
  assert.equal((await db.prepare("SELECT count(*) AS n FROM documento_transferencias "+
    "WHERE idempotencia='archiveCorrupt'").first()).n,0);
});
test("OK12 empresa sem membership nao consulta nem copia versao",async()=>{
  await assert.rejects(()=>copyDocumentVersionToDrive(db,{
    issuer,subject:"operator-sub"
  },"e2",{intentId:"archiveCross",documentoVersaoId:"vHist1"},{
    r2:{get:async()=>{throw Error("never");}},
    drive:{put:async()=>{throw Error("never");},get:async()=>{}},
    backup:{put:async()=>{},restore:async()=>{}}
  }),e=>e.status===403);
});


test("Q01 Workerd resultado parcial GANHO usa CAS e preserva montantes",async()=>{
 await db.prepare("INSERT INTO licitacoes (id,empresa_id,orgao_id,numero) "+
  "VALUES ('lAward','e1','o1','AWARD-ONLY')").run();
 await db.prepare("INSERT INTO licitacao_itens (id,empresa_id,licitacao_id,numero_item,"+
  "quantidade_prevista_mil,resultado) VALUES "+
  "('liAward','e1','lAward','1',10000,'PENDENTE')").run();
 const payload={intentId:"award-1",licitacaoId:"lAward",licitacaoItemId:"liAward",
  expectedVersion:1,resultado:"GANHO",quantidadeGanhaMil:3000,valorFinalUnitCent:125};
 const r=await http("/r7/companies/e1/commercial/award-item","POST",payload);
 assert.equal(r.status,201,await r.text());
 const row=await db.prepare("SELECT resultado,quantidade_ganha_mil,valor_final_unit_cent,versao "+
  "FROM licitacao_itens WHERE id='liAward'").first();
 assert.deepEqual(row,{resultado:"GANHO",quantidade_ganha_mil:3000,
  valor_final_unit_cent:125,versao:2});
 const retry=await http("/r7/companies/e1/commercial/award-item","POST",payload);
 assert.equal(retry.status,200);
 assert.equal((await retry.json()).replayed,true);
});
test("Q01 Workerd resultado maior que previsto não gera diário",async()=>{
 const r=await http("/r7/companies/e1/commercial/award-item","POST",{
  intentId:"award-too-high",licitacaoId:"lAward",licitacaoItemId:"liAward",
  expectedVersion:2,resultado:"GANHO",quantidadeGanhaMil:12000,valorFinalUnitCent:125
 });
 assert.equal(r.status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM operacoes WHERE id='award-too-high'").first()).n,0);
});
test("Q07 item já comprometido não muda preço por comando de resultado",async()=>{
 const r=await http("/r7/companies/e1/commercial/award-item","POST",{
  intentId:"award-change-committed",licitacaoId:"l1",licitacaoItemId:"li1",
  expectedVersion:1,resultado:"GANHO",quantidadeGanhaMil:3000,valorFinalUnitCent:10
 });
 assert.equal(r.status,409);
 assert.equal((await db.prepare("SELECT valor_final_unit_cent FROM licitacao_itens WHERE id='li1'").first()).valor_final_unit_cent,1000);
});
test("Q01 ACC01 usuário CONSULTA não decide resultado",async()=>{
 const r=await http("/r7/companies/e1/commercial/award-item","POST",{
  intentId:"award-by-reader",licitacaoId:"lAward",licitacaoItemId:"liAward",
  expectedVersion:2,resultado:"GANHO",quantidadeGanhaMil:3000,valorFinalUnitCent:125
 },{"cf-access-jwt-assertion":jwt({sub:"consult-sub"})});
 assert.equal(r.status,403);
});
test("Q05 Workerd aceite e recusa exatos têm motivo e versão CAS",async()=>{
 const item=await db.prepare("SELECT i.id,i.envio_id,i.quantidade_mil "+
  "FROM envio_itens i JOIN envios e ON e.id=i.envio_id "+
  "JOIN empenhos ep ON ep.id=e.empenho_id "+
  "WHERE ep.licitacao_id='lPartial' ORDER BY i.quantidade_mil DESC LIMIT 1").first();
 assert.ok(item);
 const body={intentId:"accept-delivery-1",envioId:item.envio_id,envioItemId:item.id,
  expectedVersion:1,quantidadeAceitaMil:item.quantidade_mil-250,
  quantidadeRecusadaMil:250,motivoRecusa:"Unidades com defeito"};
 const r=await http("/r7/companies/e1/commercial/delivery-acceptance","POST",body);
 assert.equal(r.status,201,await r.text());
 const row=await db.prepare("SELECT quantidade_aceita_mil,quantidade_recusada_mil,"+
  "motivo_recusa,versao FROM envio_itens WHERE id=?").bind(item.id).first();
 assert.equal(row.quantidade_aceita_mil,item.quantidade_mil-250);
 assert.equal(row.quantidade_recusada_mil,250);
 assert.equal(row.versao,2);
 const retry=await http("/r7/companies/e1/commercial/delivery-acceptance","POST",body);
 assert.equal(retry.status,200);
});
test("Q05 negativa de motivo ausente e excesso não deixa alteração",async()=>{
 const item=await db.prepare("SELECT i.id,i.envio_id,i.quantidade_mil "+
  "FROM envio_itens i WHERE quantidade_recusada_mil>0 LIMIT 1").first();
 for(const [id,accepted,refused,reason,expect] of [
  ["no-reason",0,100,null,400],
  ["too-much",item.quantidade_mil,100,"Recusado por defeito",409]
 ]){
  const r=await http("/r7/companies/e1/commercial/delivery-acceptance","POST",{
   intentId:id,envioId:item.envio_id,envioItemId:item.id,expectedVersion:2,
   quantidadeAceitaMil:accepted,quantidadeRecusadaMil:refused,motivoRecusa:reason
  });
  assert.equal(r.status,expect);
 }
 assert.equal((await db.prepare("SELECT versao FROM envio_itens WHERE id=?").bind(item.id).first()).versao,2);
});
test("Q05 duas edições simultâneas não sobrescrevem aceite",async()=>{
 const item=await db.prepare("SELECT i.id,i.envio_id,i.quantidade_mil "+
  "FROM envio_itens i WHERE quantidade_recusada_mil>0 LIMIT 1").first();
 const data=(id,accepted)=>({intentId:id,envioId:item.envio_id,
  envioItemId:item.id,expectedVersion:2,quantidadeAceitaMil:accepted,
  quantidadeRecusadaMil:0,motivoRecusa:null});
 const [a,b]=await Promise.all([
  http("/r7/companies/e1/commercial/delivery-acceptance","POST",data("deliveryRaceA",100)),
  http("/r7/companies/e1/commercial/delivery-acceptance","POST",data("deliveryRaceB",200))
 ]);
 assert.deepEqual([a.status,b.status].sort(),[201,409]);
 assert.equal((await db.prepare("SELECT versao FROM envio_itens WHERE id=?").bind(item.id).first()).versao,3);
});


test("REC03 revisao de valor registra linha imutavel e motivo em diario",async()=>{
  await db.prepare("INSERT INTO recorrencias "+
    "(id,empresa_id,beneficiario,categoria_despesa,dia_vencimento,"+
    "primeiro_vencimento,valor_atual_cent,estado,conferencia) "+
    "VALUES('recReview','e1','Conectividade','INTERNET',31,?,"+
    "10000,'ATIVA','VALIDADO')").bind(competence+"-07").run();
  const body={intentId:"revValue1",recorrenciaId:"recReview",
    expectedVersion:1,vigenteAPartir:competence,valorNovoCent:12500,
    motivo:"Novo contrato mensal"};
  const r=await http("/r7/companies/e1/recurrences/revise-value","POST",body);
  assert.equal(r.status,201,await r.text());
  const rev=await db.prepare("SELECT tipo,valor_antes_cent,valor_depois_cent,"+
    "vigente_a_partir FROM recorrencia_revisoes "+
    "WHERE recorrencia_id='recReview' AND tipo='VALOR'").first();
  assert.deepEqual(rev,{tipo:"VALOR",valor_antes_cent:10000,
    valor_depois_cent:12500,vigente_a_partir:competence});
  const op=await db.prepare("SELECT plano_json FROM operacoes WHERE id='revValue1'").first();
  assert.equal(JSON.parse(op.plano_json).motivo,"Novo contrato mensal");
  const replay=await http("/r7/companies/e1/recurrences/revise-value","POST",body);
  assert.equal(replay.status,200);
});
test("REC03 valor novo gera somente titulo atual sem reescrever original",async()=>{
  const r=await http("/r7/companies/e1/recurrences/materialize","POST",{
    intentId:"revMaterialize1",recorrenciaId:"recReview",
    competencia:competence,expectedVersion:2
  });
  assert.equal(r.status,201,await r.text());
  const t=await db.prepare("SELECT valor_nominal_cent,competencia,vencimento "+
    "FROM titulos_pagar WHERE recorrencia_id='recReview'").first();
  assert.equal(t.valor_nominal_cent,12500);
  assert.equal(t.competencia,competence);
  assert.equal(t.vencimento,competence+"-07");
  const again=await http("/r7/companies/e1/recurrences/revise-value","POST",{
    intentId:"revValueIllegal",recorrenciaId:"recReview",
    expectedVersion:3,vigenteAPartir:competence,
    valorNovoCent:14000,motivo:"Tentativa retroativa"
  });
  assert.equal(again.status,409);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM recorrencia_revisoes "+
    "WHERE recorrencia_id='recReview' AND tipo='VALOR'").first()).n,1);
});
test("REC04 encerramento apos mes atual nao apaga titulo existente",async()=>{
  const end=await http("/r7/companies/e1/recurrences/end-after","POST",{
    intentId:"revEnd1",recorrenciaId:"recReview",
    expectedVersion:3,fimDepois:competence,
    motivo:"Cancelamento programado do serviço"
  });
  assert.equal(end.status,201,await end.text());
  const nextDate=new Date(Date.UTC(Number(year),Number(month),1));
  const next=nextDate.getUTCFullYear()+"-"+String(nextDate.getUTCMonth()+1).padStart(2,"0");
  const noNew=await http("/r7/companies/e1/recurrences/materialize","POST",{
    intentId:"revNoNext",recorrenciaId:"recReview",
    competencia:next,expectedVersion:4
  });
  assert.equal(noNew.status,409);
  const title=await db.prepare("SELECT COUNT(*) AS n FROM titulos_pagar "+
    "WHERE recorrencia_id='recReview'").first();
  assert.equal(title.n,1);
});
test("REC04 encerramento não atravessa competencia futura gerada",async()=>{
  await db.prepare("INSERT INTO recorrencias "+
    "(id,empresa_id,beneficiario,categoria_despesa,dia_vencimento,"+
    "primeiro_vencimento,valor_atual_cent,estado) "+
    "VALUES('recFuture','e1','Hospedagem','INFRAESTRUTURA',7,?,"+
    "5000,'ATIVA')").bind(competence+"-07").run();
  const nextDate=new Date(Date.UTC(Number(year),Number(month),1));
  const next=nextDate.getUTCFullYear()+"-"+String(nextDate.getUTCMonth()+1).padStart(2,"0");
  await db.prepare("INSERT INTO titulos_pagar "+
    "(id,empresa_id,tipo,beneficiario,categoria_despesa,recorrencia_id,"+
    "competencia,valor_nominal_cent,vencimento) "+
    "VALUES('futureRecurrentTitle','e1','DIVERSO','Hospedagem','INFRAESTRUTURA',"+
    "'recFuture',?,5000,?)").bind(next,next+"-07").run();
  const r=await http("/r7/companies/e1/recurrences/end-after","POST",{
    intentId:"endFutureIllegal",recorrenciaId:"recFuture",
    expectedVersion:1,fimDepois:competence,
    motivo:"Nao apagar titulo futuro"
  });
  assert.equal(r.status,409);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM recorrencia_revisoes "+
    "WHERE recorrencia_id='recFuture'").first()).n,0);
});
test("REC03 concorrencia com versao 1 não gera duas alterações",async()=>{
  await db.prepare("INSERT INTO recorrencias "+
    "(id,empresa_id,beneficiario,categoria_despesa,dia_vencimento,"+
    "primeiro_vencimento,valor_atual_cent,estado) "+
    "VALUES('recRace','e1','Telefonia','TELECOM',7,?,8000,'ATIVA')"
    ).bind(competence+"-07").run();
  const payload=(id,value)=>({intentId:id,recorrenciaId:"recRace",
   expectedVersion:1,vigenteAPartir:competence,valorNovoCent:value,
   motivo:"Nova mensalidade autorizada"});
  const [a,b]=await Promise.all([
    http("/r7/companies/e1/recurrences/revise-value","POST",payload("recRace1",9000)),
    http("/r7/companies/e1/recurrences/revise-value","POST",payload("recRace2",9500))
  ]);
  assert.deepEqual([a.status,b.status].sort(),[201,409]);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM recorrencia_revisoes "+
    "WHERE recorrencia_id='recRace' AND tipo='VALOR'").first()).n,1);
});


test("DOC01 DOC03 Workerd anexa edital, verifica R2 e faz journal da versão",async()=>{
 const bytes=Buffer.from("Edital sintetico para licitacao e1", "utf8");
 const payload={intentId:"upload-doc-1",ownerType:"licitacao",ownerId:"l1",
  papel:"EDITAL",documentType:"EDITAL_DOCUMENTO",nomeOriginal:"edital.txt",
  mimeType:"text/plain",conteudoBase64:bytes.toString("base64")};
 const r=await http("/r7/companies/e1/documents","POST",payload);
 assert.equal(r.status,201,await r.clone().text());
 const data=await r.json();
 assert.ok(data.documentoId);
 const doc=await db.prepare("SELECT v.numero_versao,v.estado_integridade,v.sha256,"+
  "d.versao_corrente_id FROM documentos d JOIN documento_versoes v "+
  "ON v.id=d.versao_corrente_id WHERE d.id=?").bind(data.documentoId).first();
 assert.equal(doc.numero_versao,1);
 assert.equal(doc.estado_integridade,"VERIFICADO");
 assert.equal(doc.sha256,createHash("sha256").update(bytes).digest("hex"));
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM documento_vinculos "+
  "WHERE documento_id=? AND licitacao_id='l1' AND papel='EDITAL' AND ativo=1"
 ).bind(data.documentoId).first()).n,1);
 const retry=await http("/r7/companies/e1/documents","POST",payload);
 assert.equal(retry.status,200);
 assert.equal((await retry.json()).replayed,true);
});
test("OK10 DOC03 consulta autenticada pode baixar versão somente da empresa",async()=>{
 const id=await db.prepare("SELECT documento_id FROM documento_vinculos "+
  "WHERE licitacao_id='l1' AND papel='EDITAL' AND ativo=1").first();
 const r=await http("/r7/companies/e1/documents/"+id.documento_id,"GET",null,{
  "cf-access-jwt-assertion":jwt({sub:"consult-sub"})
 });
 assert.equal(r.status,200,await r.clone().text());
 assert.equal(r.headers.get("cache-control"),"no-store, private");
 assert.equal(await r.text(),"Edital sintetico para licitacao e1");
 const other=await http("/r7/companies/e2/documents/"+id.documento_id);
 assert.equal(other.status,403);
});
test("DOC02 R7 mesma função documental ativa no owner não duplica",async()=>{
 const r=await http("/r7/companies/e1/documents","POST",{
  intentId:"upload-doc-duplicate",ownerType:"licitacao",ownerId:"l1",
  papel:"EDITAL",documentType:"EDITAL_DOCUMENTO",nomeOriginal:"novo.txt",
  mimeType:"text/plain",conteudoBase64:Buffer.from("novo texto").toString("base64")
 });
 assert.equal(r.status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM operacoes "+
  "WHERE id='upload-doc-duplicate'").first()).n,0);
});
test("DOC01 ACC02 cliente não usa owner de outra empresa nem papel cruzado",async()=>{
 for(const payload of [
  {intentId:"doc-bad-company",ownerType:"licitacao",ownerId:"l2",
   papel:"EDITAL",documentType:"EDITAL_DOCUMENTO",nomeOriginal:"x.txt",
   mimeType:"text/plain",conteudoBase64:Buffer.from("test").toString("base64")},
  {intentId:"doc-bad-role",ownerType:"compra",ownerId:"co1",
   papel:"EDITAL",documentType:"EDITAL_DOCUMENTO",nomeOriginal:"x.txt",
   mimeType:"text/plain",conteudoBase64:Buffer.from("test").toString("base64")}
 ]){
  const r=await http("/r7/companies/e1/documents","POST",payload);
  assert.ok([400,409].includes(r.status));
 }
});
test("DOC03 R2 bytes corrompidos são bloqueados no download",async()=>{
 const ref=await db.prepare("SELECT d.id AS id,l.chave_r2 "+
  "FROM documentos d JOIN documento_versoes v ON d.versao_corrente_id=v.id "+
  "JOIN documento_localizacoes l ON l.versao_id=v.id "+
  "JOIN documento_vinculos dv ON dv.documento_id=d.id "+
  "WHERE dv.licitacao_id='l1' AND dv.papel='EDITAL'").first();
 const r2=await mf.getR2Bucket("R2");
 await r2.put(ref.chave_r2,new TextEncoder().encode("CORRUPT"));
 const r=await http("/r7/companies/e1/documents/"+ref.id);
 assert.equal(r.status,409);
 assert.equal((await r.json()).error,"document_bytes_unavailable");
});


test("FK01 Q02 cria empenho genérico sob item GANHO, com replay e diário",async()=>{
  await db.prepare("INSERT INTO licitacoes (id,empresa_id,orgao_id,numero) "+
    "VALUES('lGeneric','e1','o1','GENERAL-2026')").run();
  await db.prepare("INSERT INTO licitacao_itens (id,empresa_id,licitacao_id,"+
    "numero_item,resultado,quantidade_prevista_mil,quantidade_ganha_mil,"+
    "valor_final_unit_cent) VALUES ('liGeneric','e1','lGeneric','1',"+
    "'GANHO',10000,6000,100)").run();
  const body={intentId:"commitmentGen1",parentId:"lGeneric",
    expectedParentVersion:1,numero:"EMP-G1",items:[{
      parentItemId:"liGeneric",quantidadeMil:3000,valorUnitCent:100
    }]};
  const r=await http("/r7/companies/e1/commercial/commitment","POST",body);
  assert.equal(r.status,201,await r.clone().text());
  const data=await r.json();
  assert.ok(data.empenhoId);
  const item=await db.prepare("SELECT empenho_id,quantidade_mil FROM empenho_itens "+
    "WHERE empenho_id=?").bind(data.empenhoId).first();
  assert.equal(item.quantidade_mil,3000);
  const retry=await http("/r7/companies/e1/commercial/commitment","POST",body);
  assert.equal(retry.status,200);
  assert.equal((await retry.json()).replayed,true);
});
test("FK01 item de outra licitação não entra no novo empenho",async()=>{
 const r=await http("/r7/companies/e1/commercial/commitment","POST",{
  intentId:"commitmentWrongItem",parentId:"lGeneric",
  expectedParentVersion:1,numero:"EMP-WRONG",items:[{
   parentItemId:"li1",quantidadeMil:1000,valorUnitCent:100
  }]
 });
 assert.equal(r.status,409,await r.clone().text());
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM empenhos "+
  "WHERE operacao_id='commitmentWrongItem'").first()).n,0);
});
test("Q02 duas disputas pelos últimos 3000 milésimos geram um empenho",async()=>{
 const payload=intent=>({intentId:intent,parentId:"lGeneric",
  expectedParentVersion:1,numero:"EMP-"+intent,items:[{
   parentItemId:"liGeneric",quantidadeMil:3000,valorUnitCent:100
  }]});
 const [a,b]=await Promise.all([
  http("/r7/companies/e1/commercial/commitment","POST",payload("commitmentRaceA")),
  http("/r7/companies/e1/commercial/commitment","POST",payload("commitmentRaceB"))
 ]);
 assert.deepEqual([a.status,b.status].sort(),[201,409]);
 assert.equal((await db.prepare("SELECT SUM(ei.quantidade_mil) AS n "+
  "FROM empenho_itens ei JOIN empenhos e ON e.id=ei.empenho_id "+
  "WHERE e.licitacao_id='lGeneric'").first()).n,6000);
});
test("FK02 Q03 compra confirmada com item do empenho certo",async()=>{
 const ep=await db.prepare("SELECT id FROM empenhos "+
  "WHERE operacao_id='commitmentGen1'").first();
 const item=await db.prepare("SELECT id FROM empenho_itens WHERE empenho_id=?")
  .bind(ep.id).first();
 const body={intentId:"purchaseGen1",parentId:ep.id,expectedParentVersion:1,
  fornecedorId:"f1",numero:"COMPRA-G1",items:[{
   parentItemId:item.id,quantidadeMil:3000,valorUnitCent:100
  }]};
 const r=await http("/r7/companies/e1/commercial/purchase","POST",body);
 assert.equal(r.status,201,await r.clone().text());
 assert.ok((await r.json()).compraId);
});
test("FK02 compra com item de outro empenho não persiste",async()=>{
 const ep=await db.prepare("SELECT id FROM empenhos "+
  "WHERE operacao_id='commitmentGen1'").first();
 const r=await http("/r7/companies/e1/commercial/purchase","POST",{
  intentId:"purchaseWrongItem",parentId:ep.id,expectedParentVersion:1,
  fornecedorId:"f1",numero:"COMPRA-WRONG",
  items:[{parentItemId:"ei1",quantidadeMil:1000,valorUnitCent:100}]
 });
 assert.equal(r.status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM compras "+
  "WHERE operacao_id='purchaseWrongItem'").first()).n,0);
});
test("FK04 Q06 NF genérica é emitida antes do despacho, com duas parcelas",async()=>{
 const ep=await db.prepare("SELECT id FROM empenhos "+
  "WHERE operacao_id='commitmentGen1'").first();
 const item=await db.prepare("SELECT id FROM empenho_itens WHERE empenho_id=?")
  .bind(ep.id).first();
 const r=await http("/r7/companies/e1/commercial/invoice","POST",{
  intentId:"invoiceGen1",parentId:ep.id,expectedParentVersion:1,
  items:[{parentItemId:item.id,quantidadeMil:3000,valorUnitCent:100}],
  parcelasCent:[150,150]
 });
 assert.equal(r.status,201,await r.clone().text());
 const data=await r.json();
 assert.equal(data.parcelas.length,2);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM envios "+
  "WHERE empenho_id=?").bind(ep.id).first()).n,0);
 const c=await http("/r7/companies/e1/invoices/confirm","POST",{
  intentId:"sealGen1",notaFiscalId:data.notaFiscalId,expectedVersion:1
 });
 assert.equal(c.status,201,await c.clone().text());
 const seal=await db.prepare("SELECT valor_documento_cent,valor_itens_cent,"+
  "valor_parcelas_cent FROM nf_conciliacoes WHERE nota_fiscal_id=?"
 ).bind(data.notaFiscalId).first();
 assert.deepEqual(seal,{valor_documento_cent:300,
  valor_itens_cent:300,valor_parcelas_cent:300});
});
test("Q06 NF posterior não fatura unidades além das empenhadas",async()=>{
 const ep=await db.prepare("SELECT id FROM empenhos "+
  "WHERE operacao_id='commitmentGen1'").first();
 const item=await db.prepare("SELECT id FROM empenho_itens WHERE empenho_id=?")
  .bind(ep.id).first();
 const r=await http("/r7/companies/e1/commercial/invoice","POST",{
  intentId:"invoiceTooMuch",parentId:ep.id,expectedParentVersion:1,
  items:[{parentItemId:item.id,quantidadeMil:1000,valorUnitCent:100}],
  parcelasCent:[100]
 });
 assert.equal(r.status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM notas_fiscais "+
  "WHERE operacao_id='invoiceTooMuch'").first()).n,0);
});
test("FK03 Q04 remessas separadas depois da NF não excedem compra",async()=>{
 const ep=await db.prepare("SELECT id FROM empenhos "+
  "WHERE operacao_id='commitmentGen1'").first();
 const ci=await db.prepare("SELECT ci.id FROM compra_itens ci "+
  "JOIN compras c ON c.id=ci.compra_id WHERE c.operacao_id='purchaseGen1'").first();
 for(const [i,q] of [[1,1000],[2,2000]]){
  const r=await http("/r7/companies/e1/commercial/shipment","POST",{
   intentId:"shipmentG"+i,parentId:ep.id,expectedParentVersion:1,
   items:[{parentItemId:ci.id,quantidadeMil:q}]
  });
  assert.equal(r.status,201,await r.clone().text());
 }
 const invalid=await http("/r7/companies/e1/commercial/shipment","POST",{
  intentId:"shipmentExcess",parentId:ep.id,expectedParentVersion:1,
  items:[{parentItemId:ci.id,quantidadeMil:1}]
 });
 assert.equal(invalid.status,409);
 const n=await db.prepare("SELECT sum(ei.quantidade_mil) AS n FROM envio_itens ei "+
  "JOIN envios e ON e.id=ei.envio_id WHERE e.empenho_id=?").bind(ep.id).first();
 assert.equal(n.n,3000);
});
test("FK03 item de compra ligada a outro empenho é negado",async()=>{
 const ep=await db.prepare("SELECT id FROM empenhos "+
  "WHERE operacao_id='commitmentGen1'").first();
 const r=await http("/r7/companies/e1/commercial/shipment","POST",{
  intentId:"shipmentWrongItem",parentId:ep.id,expectedParentVersion:1,
  items:[{parentItemId:"ci1",quantidadeMil:1}]
 });
 assert.equal(r.status,409);
});
test("ACC01 operador sem vínculo na empresa e2 não consegue criar empenho",async()=>{
 const r=await http("/r7/companies/e2/commercial/commitment","POST",{
  intentId:"crossCompanyCommit",parentId:"lGeneric",expectedParentVersion:1,
  numero:"NAO",items:[{parentItemId:"liGeneric",quantidadeMil:1000,valorUnitCent:100}]
 });
 assert.equal(r.status,403);
});


test("DOC04 duas versões imutáveis compartilham documento e podem ser lidas",async()=>{
 const first=await http("/r7/companies/e1/documents","POST",{
  intentId:"versionOriginal1",ownerType:"licitacao",ownerId:"lAward",
  papel:"PROPOSTA",documentType:"PROPOSTA_DOC",nomeOriginal:"proposta-v1.txt",
  mimeType:"text/plain",conteudoBase64:Buffer.from("Original v1").toString("base64")
 });
 assert.equal(first.status,201,await first.clone().text());
 const created=await first.json();
 const versionFirst=created.versaoId;
 const upgraded=await http("/r7/companies/e1/documents/versions","POST",{
  intentId:"versionRev1",documentoId:created.documentoId,expectedVersion:2,
  nomeOriginal:"proposta-v2.txt",mimeType:"text/plain",
  conteudoBase64:Buffer.from("Revisado v2").toString("base64")
 });
 assert.equal(upgraded.status,201,await upgraded.clone().text());
 const next=await upgraded.json();
 assert.equal(next.documentoId,created.documentoId);
 assert.equal(next.numeroVersao,2);
 const versions=await db.prepare("SELECT numero_versao,estado_integridade "+
  "FROM documento_versoes WHERE documento_id=? ORDER BY numero_versao").bind(created.documentoId).all();
 assert.deepEqual(versions.results.map(x=>x.numero_versao),[1,2]);
 const original=await http("/r7/companies/e1/documents/"+created.documentoId+
  "/versions/"+versionFirst,"GET",null,{
  "cf-access-jwt-assertion":jwt({sub:"consult-sub"})
 });
 assert.equal(original.status,200,await original.clone().text());
 assert.equal(await original.text(),"Original v1");
 const current=await http("/r7/companies/e1/documents/"+created.documentoId);
 assert.equal(current.status,200,await current.clone().text());
 assert.equal(await current.text(),"Revisado v2");
});
test("DOC04 CAS simultâneo da nova versão não perde a versão anterior",async()=>{
 const doc=await db.prepare("SELECT id FROM documentos WHERE titulo='proposta-v1.txt'").first();
 const make=(id,content)=>({intentId:id,documentoId:doc.id,expectedVersion:3,
  nomeOriginal:"proposta-v3.txt",mimeType:"text/plain",
  conteudoBase64:Buffer.from(content).toString("base64")});
 const [a,b]=await Promise.all([
  http("/r7/companies/e1/documents/versions","POST",make("versionRaceA","R3-A")),
  http("/r7/companies/e1/documents/versions","POST",make("versionRaceB","R3-B"))
 ]);
 assert.deepEqual([a.status,b.status].sort(),[201,409]);
 const count=await db.prepare("SELECT count(*) AS n FROM documento_versoes "+
  "WHERE documento_id=?").bind(doc.id).first();
 assert.equal(count.n,3);
 const rows=await db.prepare("SELECT numero_versao FROM documento_versoes "+
  "WHERE documento_id=? ORDER BY numero_versao").bind(doc.id).all();
 assert.deepEqual(rows.results.map(x=>x.numero_versao),[1,2,3]);
});
test("DOC04 tentativas de reescrever versão histórica são bloqueadas",async()=>{
 const doc=await db.prepare("SELECT id FROM documentos WHERE titulo='proposta-v1.txt'").first();
 const old=await db.prepare("SELECT id FROM documento_versoes "+
  "WHERE documento_id=? AND numero_versao=1").bind(doc.id).first();
 await assert.rejects(db.prepare("UPDATE documento_versoes "+
  "SET sha256=? WHERE id=?").bind("f".repeat(64),old.id).run());
 await assert.rejects(db.prepare("DELETE FROM documento_versoes WHERE id=?").bind(old.id).run());
});


test("Q08 retificação fiscal de NF selada usa ADMIN e um único D1 batch",async()=>{
 const original=await db.prepare("SELECT id,empenho_id,versao FROM notas_fiscais "+
  "WHERE operacao_id='invoiceGen1'").first();
 const item=await db.prepare("SELECT id FROM empenho_itens WHERE empenho_id=?")
  .bind(original.empenho_id).first();
 const payload={intentId:"rectifyGen1",notaFiscalOriginalId:original.id,
  expectedVersion:original.versao,
  motivo:"Retificacao autorizada de valor da nota",
  items:[{empenhoItemId:item.id,quantidadeMil:3000,valorUnitCent:110}],
  parcelasCent:[200,130]};
 const rejected=await http("/r7/companies/e1/invoices/rectify","POST",payload);
 assert.equal(rejected.status,403);
 const r=await http("/r7/companies/e1/invoices/rectify","POST",payload,{
  "cf-access-jwt-assertion":jwt({sub:"admin-sub"})
 });
 assert.equal(r.status,201,await r.clone().text());
 const data=await r.json();
 assert.ok(data.notaFiscalSubstitutaId&&data.retificacaoId);
 assert.equal(data.valorDocumentoCent,330);
 const row=await db.prepare("SELECT situacao,versao FROM notas_fiscais "+
  "WHERE id=?").bind(original.id).first();
 assert.equal(row.situacao,"CANCELADA");
 assert.equal(row.versao,original.versao+1);
 const originalParts=await db.prepare("SELECT count(*) AS n,"+
  "sum(cancelada) AS canceladas FROM contas_receber "+
  "WHERE nota_fiscal_id=?").bind(original.id).first();
 assert.equal(originalParts.canceladas,originalParts.n);
 assert.equal(originalParts.n,2);
 const replacement=await db.prepare("SELECT valor_documento_cent,situacao "+
  "FROM notas_fiscais WHERE id=?").bind(data.notaFiscalSubstitutaId).first();
 assert.deepEqual(replacement,{valor_documento_cent:330,situacao:"EMITIDA"});
 const seal=await db.prepare("SELECT valor_documento_cent,valor_itens_cent,"+
  "valor_parcelas_cent FROM nf_conciliacoes "+
  "WHERE nota_fiscal_id=?").bind(data.notaFiscalSubstitutaId).first();
 assert.deepEqual(seal,{valor_documento_cent:330,
  valor_itens_cent:330,valor_parcelas_cent:330});
 const originalSeal=await db.prepare("SELECT count(*) AS n FROM nf_conciliacoes "+
  "WHERE nota_fiscal_id=?").bind(original.id).first();
 assert.equal(originalSeal.n,1);
 const ev=await db.prepare("SELECT nota_original_id,nota_substituta_id FROM "+
  "nf_retificacoes WHERE operacao_id='rectifyGen1'").first();
 assert.equal(ev.nota_original_id,original.id);
 assert.equal(ev.nota_substituta_id,data.notaFiscalSubstitutaId);
 const replay=await http("/r7/companies/e1/invoices/rectify","POST",payload,{
  "cf-access-jwt-assertion":jwt({sub:"admin-sub"})
 });
 assert.equal(replay.status,200);
 assert.equal((await replay.json()).replayed,true);
});
test("Q08 retificação não permite reabrir NF antiga nem duplicar correção",async()=>{
 const original=await db.prepare("SELECT n.id,n.empenho_id FROM notas_fiscais n "+
  "JOIN nf_retificacoes x ON x.nota_original_id=n.id AND x.empresa_id=n.empresa_id "+
  "WHERE x.operacao_id='rectifyGen1'").first();
 const row=await db.prepare("SELECT id FROM empenho_itens WHERE empenho_id=?")
  .bind(original.empenho_id).first();
 await assert.rejects(db.prepare("UPDATE notas_fiscais SET situacao='EMITIDA' "+
  "WHERE id=?").bind(original.id).run());
 const r=await http("/r7/companies/e1/invoices/rectify","POST",{
  intentId:"rectifyTwice",notaFiscalOriginalId:original.id,expectedVersion:2,
  motivo:"Duplicata de retificacao indevida",
  items:[{empenhoItemId:row.id,quantidadeMil:3000,valorUnitCent:100}],
  parcelasCent:[300]
 },{"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(r.status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM nf_retificacoes "+
  "WHERE nota_original_id=?").bind(original.id).first()).n,1);
});
test("FIN02 parcela da NF cancelada por retificação não recebe novos créditos",async()=>{
 const orig=await db.prepare("SELECT nota_original_id AS id FROM nf_retificacoes "+
  "WHERE operacao_id='rectifyGen1'").first();
 const part=await db.prepare("SELECT id FROM contas_receber "+
  "WHERE nota_fiscal_id=? LIMIT 1").bind(orig.id).first();
 const r=await http("/r7/companies/e1/credits","POST",{
  intentId:"creditAfterRectification",contaReceberId:part.id,
  valorRecebidoCent:100,retencaoConfirmadaCent:0,
  dataCredito:"2026-11-07",contaDestino:"BB",referenciaExterna:"no-credit"
 });
 assert.equal(r.status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM recebimentos "+
  "WHERE operacao_id='creditAfterRectification'").first()).n,0);
});


test("OK02 NF retificada com duas parcelas liquida credito+retencao confirmado",async()=>{
 const ref=await db.prepare("SELECT nota_substituta_id FROM nf_retificacoes "+
  "WHERE operacao_id='rectifyGen1'").first();
 assert.ok(ref);
 const notes=await db.prepare("SELECT id,parcela,valor_bruto_cent FROM contas_receber "+
  "WHERE nota_fiscal_id=? AND cancelada=0 ORDER BY parcela"
 ).bind(ref.nota_substituta_id).all();
 assert.deepEqual(notes.results.map(x=>x.valor_bruto_cent),[200,130]);
 const first=notes.results[0],second=notes.results[1];
 const file=await http("/r7/companies/e1/documents","POST",{
  intentId:"ok02-ret-file",ownerType:"conta_receber",ownerId:first.id,
  papel:"COMPROVANTE_CREDITO",documentType:"COMPROVANTE_RETENCAO",
  nomeOriginal:"retencao-ok02.txt",mimeType:"text/plain",
  conteudoBase64:Buffer.from("comprovante de retencao 50 centavos").toString("base64")
 });
 assert.equal(file.status,201,await file.clone().text());
 const doc=await file.json();
 const attest=await http("/r7/companies/e1/retentions/attest","POST",{
  intentId:"ok02-ret-attest",contaReceberId:first.id,
  documentoVersaoId:doc.versaoId,valorConfirmadoCent:50
 },{"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(attest.status,201,await attest.clone().text());
 const a=await attest.json();
 const one=await http("/r7/companies/e1/credits","POST",{
  intentId:"ok02-credit-a",contaReceberId:first.id,
  valorRecebidoCent:150,retencaoConfirmadaCent:50,
  retencaoAtestadoId:a.atestadoId,
  dataCredito:"2026-11-07",contaDestino:"BB-02",referenciaExterna:"OK02-1"
 });
 assert.equal(one.status,201,await one.clone().text());
 const two=await http("/r7/companies/e1/credits","POST",{
  intentId:"ok02-credit-b",contaReceberId:second.id,
  valorRecebidoCent:130,retencaoConfirmadaCent:0,
  dataCredito:"2026-11-07",contaDestino:"BB-02",referenciaExterna:"OK02-2"
 });
 assert.equal(two.status,201,await two.clone().text());
 const total=await db.prepare("SELECT sum(r.valor_recebido_cent) AS banco,"+
  "sum(r.retencao_confirmada_cent) AS retencao FROM recebimentos r "+
  "JOIN contas_receber c ON c.id=r.conta_receber_id "+
  "WHERE c.nota_fiscal_id=? AND r.tipo_movimento='RECEBIMENTO'"
 ).bind(ref.nota_substituta_id).first();
 assert.deepEqual(total,{banco:280,retencao:50});
 assert.equal(total.banco+total.retencao,330);
});
test("FIN02 parcela liquidada rejeita crédito excedente sem diário órfão",async()=>{
 const ref=await db.prepare("SELECT nota_substituta_id FROM nf_retificacoes "+
  "WHERE operacao_id='rectifyGen1'").first();
 const part=await db.prepare("SELECT id FROM contas_receber "+
  "WHERE nota_fiscal_id=? ORDER BY parcela LIMIT 1").bind(ref.nota_substituta_id).first();
 const r=await http("/r7/companies/e1/credits","POST",{
  intentId:"ok02-excess",contaReceberId:part.id,
  valorRecebidoCent:1,retencaoConfirmadaCent:0,
  dataCredito:"2026-11-07",contaDestino:"BB-02",referenciaExterna:"OK02-EXCESS"
 });
 assert.equal(r.status,409);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM operacoes "+
  "WHERE id='ok02-excess'").first()).n,0);
});
test("OK09 documento NF fornecedor liga compra e NF venda liga nota do orgao",async()=>{
 const buy=await db.prepare("SELECT id FROM compras WHERE operacao_id='purchaseGen1'").first();
 const ref=await db.prepare("SELECT nota_substituta_id FROM nf_retificacoes "+
  "WHERE operacao_id='rectifyGen1'").first();
 const base=(id,ownerType,ownerId,papel,type)=>({
  intentId:id,ownerType,ownerId,papel,documentType:type,nomeOriginal:id+".txt",
  mimeType:"text/plain",conteudoBase64:Buffer.from(id).toString("base64")
 });
 const supplier=await http("/r7/companies/e1/documents","POST",
  base("doc-supplier-invoice","compra",buy.id,"NF_FORNECEDOR","NF_COMPRA"));
 assert.equal(supplier.status,201,await supplier.clone().text());
 const sale=await http("/r7/companies/e1/documents","POST",
  base("doc-sale-invoice","nota_fiscal",ref.nota_substituta_id,
   "NF_VENDA_PDF","NF_VENDA"));
 assert.equal(sale.status,201,await sale.clone().text());
 const link1=await db.prepare("SELECT compra_id,nota_fiscal_id FROM documento_vinculos "+
  "WHERE documento_id=?").bind((await supplier.json()).documentoId).first();
 assert.equal(link1.compra_id,buy.id);
 assert.equal(link1.nota_fiscal_id,null);
 const link2=await db.prepare("SELECT compra_id,nota_fiscal_id FROM documento_vinculos "+
  "WHERE documento_id=?").bind((await sale.json()).documentoId).first();
 assert.equal(link2.nota_fiscal_id,ref.nota_substituta_id);
 assert.equal(link2.compra_id,null);
});


test("OPR02 outbox HTTP reserva uma mensagem por destinatario e horario, nunca e-mail vazio",async()=>{
  await db.prepare("INSERT INTO notificacoes_preferencias(id,empresa_id,ativo,"+
    "dias_semana_json,horarios_json,quantidade_proximos,remetente) "+
    "VALUES ('prefR7','e1',1,'[0,1,2,3,4,5,6]',"+
    "'[\"08:00\",\"12:00\",\"17:00\"]',3,'financeiro@local.invalid')").run();
  await db.prepare("INSERT INTO notificacoes_destinatarios(id,empresa_id,"+
    "preferencia_id,email_normalizado,ativo) "+
    "VALUES ('destR7','e1','prefR7','financeiro@local.invalid',1)").run();
  await db.prepare("INSERT INTO titulos_pagar (id,empresa_id,tipo,beneficiario,"+
    "categoria_despesa,valor_nominal_cent,vencimento) "+
    "VALUES('notifFuture','e1','DIVERSO','Serviço futuro','SERVICO',8000,'2027-12-31')").run();
  const body={intentId:"outboxReserve1",preferenciaId:"prefR7",
    destinatarioId:"destR7",dataReferencia:today,horario:"08:00"};
  const reader=await http("/r7/companies/e1/notifications/reserve","POST",body);
  assert.equal(reader.status,403);
  const r=await http("/r7/companies/e1/notifications/reserve","POST",body,{
   "cf-access-jwt-assertion":jwt({sub:"admin-sub"})
  });
  assert.equal(r.status,201,await r.clone().text());
  const data=await r.json();
  assert.equal(data.estado,"RESERVADO");
  assert.ok(data.quantidadeBoletos>=1);
  assert.ok(data.totalCent>=8000);
  const saved=await db.prepare("SELECT estado,quantidade_boletos,total_centavos "+
   "FROM notificacoes_envios WHERE id=?").bind(data.envioId).first();
  assert.equal(saved.estado,"RESERVADO");
  assert.equal(saved.quantidade_boletos,data.quantidadeBoletos);
  const replay=await http("/r7/companies/e1/notifications/reserve","POST",body,{
   "cf-access-jwt-assertion":jwt({sub:"admin-sub"})
  });
  assert.equal(replay.status,200);
  const duplicate=await http("/r7/companies/e1/notifications/reserve","POST",
   {...body,intentId:"outboxReserve2"},{
    "cf-access-jwt-assertion":jwt({sub:"admin-sub"})
   });
  assert.equal(duplicate.status,409);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM notificacoes_envios "+
    "WHERE preferencia_id='prefR7' AND horario='08:00'").first()).n,1);
});
test("OPR02 TIMEOUT apos aceite deixa INCERTO e nunca permite segundo send",async()=>{
 const envio=await db.prepare("SELECT id FROM notificacoes_envios "+
  "WHERE preferencia_id='prefR7' AND horario='08:00'").first();
 let sends=0;
 const sender={send:async()=>{sends++;throw Error("timeout apos API de entrega");}};
 const principal={issuer,subject:"admin-sub"};
 await assert.rejects(()=>dispatchNotification(db,principal,"e1",{
  intentId:"dispatchUncertain",envioId:envio.id
 },{sender}),e=>e.code==="notification_uncertain_no_auto_retry");
 assert.equal(sends,1);
 assert.equal((await db.prepare("SELECT estado FROM notificacoes_envios "+
  "WHERE id=?").bind(envio.id).first()).estado,"INCERTO");
 await assert.rejects(()=>dispatchNotification(db,principal,"e1",{
  intentId:"dispatchOther",envioId:envio.id
 },{sender}),e=>e.code==="notification_not_dispatchable");
 assert.equal(sends,1);
});
test("OPR02 aceite explicito ENVIADO + replay nao gera segundo envio",async()=>{
 const body={intentId:"outboxNoon",preferenciaId:"prefR7",
    destinatarioId:"destR7",dataReferencia:today,horario:"12:00"};
 const r=await http("/r7/companies/e1/notifications/reserve","POST",body,{
   "cf-access-jwt-assertion":jwt({sub:"admin-sub"})
 });
 assert.equal(r.status,201,await r.clone().text());
 const out=await r.json();
 let sends=0;
 const sender={send:async p=>{sends++;
   assert.equal(p.deliveryKey,out.envioId);
   assert.equal(p.to,"financeiro@local.invalid");
   assert.ok(p.snapshot.length);
   return {accepted:true,receiptId:"local-provider-accepted"};
 }};
 const principal={issuer,subject:"admin-sub"};
 const sent=await dispatchNotification(db,principal,"e1",{
  intentId:"dispatchNoon",envioId:out.envioId
 },{sender});
 assert.equal(sent.estado,"ENVIADO");
 assert.equal(sends,1);
 const replay=await dispatchNotification(db,principal,"e1",{
  intentId:"dispatchNoon",envioId:out.envioId
 },{sender});
 assert.equal(replay.replayed,true);
 assert.equal(replay.sendAuthorized,false);
 assert.equal(sends,1);
});
test("OPR02 consulta e empresa cruzada nao controlam notificacao",async()=>{
 const out=await db.prepare("SELECT id FROM notificacoes_envios "+
  "WHERE preferencia_id='prefR7' AND horario='12:00'").first();
 let sends=0;const sender={send:async()=>{sends++;return {accepted:true};}};
 await assert.rejects(()=>dispatchNotification(db,{issuer,subject:"consult-sub"},
  "e1",{intentId:"readerSends",envioId:out.id},{sender}),e=>e.status===403);
 await assert.rejects(()=>dispatchNotification(db,{issuer,subject:"admin-sub"},
  "e2",{intentId:"crossSends",envioId:out.id},{sender}),e=>e.status===403);
 assert.equal(sends,0);
});


test("REC05 projeção do mês soma regra apenas quando não há titulo gerado",async()=>{
 const first=competence+"-07";
 await db.prepare("INSERT INTO recorrencias "+
  "(id,empresa_id,beneficiario,categoria_despesa,dia_vencimento,"+
  "primeiro_vencimento,valor_atual_cent,estado,conferencia) "+
  "VALUES('recProj','e1','Projecao','SERVICO',31,?,9999,'ATIVA','VALIDADO')"
 ).bind(first).run();
 const request={competencia:competence};
 let r=await http("/r7/companies/e1/finance/monthly-preview","POST",request);
 assert.equal(r.status,201,await r.clone().text());
 const before=await r.json();
 const line=before.linhas.filter(x=>x.recorrenciaId==="recProj");
 assert.equal(line.length,1);
 assert.equal(line[0].tipo,"PREVISAO_RECORRENTE");
 assert.equal(line[0].valorCent,9999);
 const created=await http("/r7/companies/e1/recurrences/materialize","POST",{
  intentId:"recProjMaterialize",recorrenciaId:"recProj",
  competencia:competence,expectedVersion:1
 });
 assert.equal(created.status,201,await created.clone().text());
 r=await http("/r7/companies/e1/finance/monthly-preview","POST",request);
 assert.equal(r.status,201,await r.clone().text());
 const after=await r.json();
 const line2=after.linhas.filter(x=>x.recorrenciaId==="recProj");
 assert.equal(line2.length,1);
 assert.equal(line2[0].tipo,"TITULO");
 assert.equal(line2[0].valorCent,9999);
 assert.equal(after.totalConhecidoCent,before.totalConhecidoCent);
 assert.equal(after.regraDuplicadaNoTotal,false);
});
test("REC05 titulo de recorrencia cancelado nao revive regra na previsão",async()=>{
 await db.prepare("INSERT INTO recorrencias "+
  "(id,empresa_id,beneficiario,categoria_despesa,dia_vencimento,"+
  "primeiro_vencimento,valor_atual_cent,estado,conferencia) "+
  "VALUES('recCanceled','e1','Cancelada','SERVICO',31,?,4000,'ATIVA','VALIDADO')"
 ).bind(competence+"-07").run();
 await db.prepare("INSERT INTO titulos_pagar "+
  "(id,empresa_id,tipo,beneficiario,categoria_despesa,recorrencia_id,"+
  "competencia,valor_nominal_cent,vencimento,cancelado,motivo_cancelamento) "+
  "VALUES('titCanceled','e1','DIVERSO','Cancelada','SERVICO',"+
  "'recCanceled',?,4000,?,1,'Cancelamento da competência')").bind(competence,competence+"-07").run();
 const r=await http("/r7/companies/e1/finance/monthly-preview","POST",{competencia:competence});
 assert.equal(r.status,201,await r.clone().text());
 const data=await r.json();
 assert.equal(data.linhas.filter(x=>x.recorrenciaId==="recCanceled").length,0);
});
test("OK11 valor LEGADO não conferido fica pendente e nunca vira zero fabricado",async()=>{
 await db.prepare("INSERT INTO titulos_pagar(id,empresa_id,tipo,vencimento,"+
  "beneficiario,categoria_despesa,origem_dado,conferencia) "+
  "VALUES('legacyUnknownMoney','e1','DIVERSO',?,"+
  "'Historico','SERVICO','LEGADO','PENDENTE')"
 ).bind(competence+"-15").run();
 const r=await http("/r7/companies/e1/finance/monthly-preview","POST",{competencia:competence});
 assert.equal(r.status,201,await r.clone().text());
 const data=await r.json();
 assert.equal(data.completo,false);
 assert.ok(data.incompletos.includes("legacyUnknownMoney"));
 assert.equal(data.linhas.filter(x=>x.id==="legacyUnknownMoney").length,0);
});
test("REC02 OK07 calendário civil materializa dezembro janeiro fevereiro bissexto março",async()=>{
 const {issuer:identityIssuer}= {issuer};
 const principal={issuer:identityIssuer,subject:"operator-sub"};
 await db.prepare("INSERT INTO recorrencias(id,empresa_id,beneficiario,"+
  "categoria_despesa,dia_vencimento,primeiro_vencimento,"+
  "valor_atual_cent,estado,conferencia) "+
  "VALUES('recCal','e1','Calendario','SERVICO',31,'2027-12-31',"+
  "7100,'ATIVA','VALIDADO')").run();
 const examples=[
  ["2027-12","2027-12-31","2027-12-01T12:00:00Z",1],
  ["2028-01","2028-01-31","2028-01-01T12:00:00Z",2],
  ["2028-02","2028-02-29","2028-02-01T12:00:00Z",3],
  ["2028-03","2028-03-31","2028-03-01T12:00:00Z",4]
 ];
 for(const [month,expected,date,version] of examples){
  const r=await materializeRecurrence(db,principal,"e1",{
   intentId:"cal-"+month.replace("-",""),recorrenciaId:"recCal",
   competencia:month,expectedVersion:version
  },{nowMs:Date.parse(date)});
  assert.equal(r.vencimento,expected);
 }
 const count=await db.prepare("SELECT COUNT(*) AS n FROM titulos_pagar "+
  "WHERE recorrencia_id='recCal'").first();
 assert.equal(count.n,4);
 const feb=await db.prepare("SELECT vencimento FROM titulos_pagar "+
  "WHERE recorrencia_id='recCal' AND competencia='2028-02'").first();
 assert.equal(feb.vencimento,"2028-02-29");
});
test("REC02 ano não bissexto dia 31 em fevereiro e março volta para 31",async()=>{
 const principal={issuer,subject:"operator-sub"};
 await db.prepare("INSERT INTO recorrencias(id,empresa_id,beneficiario,"+
  "categoria_despesa,dia_vencimento,primeiro_vencimento,"+
  "valor_atual_cent,estado,conferencia) "+
  "VALUES('recNonLeap','e1','NaoBissexto','SERVICO',31,'2029-01-31',"+
  "1000,'ATIVA','VALIDADO')").run();
 for(const [month,date,version,expected] of [
  ["2029-01","2029-01-01T12:00:00Z",1,"2029-01-31"],
  ["2029-02","2029-02-01T12:00:00Z",2,"2029-02-28"],
  ["2029-03","2029-03-01T12:00:00Z",3,"2029-03-31"]
 ]){
  const result=await materializeRecurrence(db,principal,"e1",{
    intentId:"nonleap-"+month.replace("-",""),recorrenciaId:"recNonLeap",
    competencia:month,expectedVersion:version
  },{nowMs:Date.parse(date)});
  assert.equal(result.vencimento,expected);
 }
});


test("FIN08 revisão de valor/vencimento de titulo é CAS + diário com motivo",async()=>{
 await db.prepare("INSERT INTO titulos_pagar "+
  "(id,empresa_id,tipo,beneficiario,categoria_despesa,valor_nominal_cent,vencimento) "+
  "VALUES ('titleRevision','e1','DIVERSO','Serviço variável','SERVICO',"+
  "2000,'2027-01-31')").run();
 const body={intentId:"revTitle1",tituloId:"titleRevision",expectedVersion:1,
  novoValorCent:2550,novoVencimento:"2027-02-28",
  motivo:"Atualização autorizada da cobrança"};
 const r=await http("/r7/companies/e1/titles/revise","POST",body);
 assert.equal(r.status,201,await r.clone().text());
 const row=await db.prepare("SELECT valor_nominal_cent,vencimento,versao "+
  "FROM titulos_pagar WHERE id='titleRevision'").first();
 assert.deepEqual(row,{valor_nominal_cent:2550,
  vencimento:"2027-02-28",versao:2});
 const plan=await db.prepare("SELECT plano_json FROM operacoes WHERE id='revTitle1'").first();
 assert.equal(JSON.parse(plan.plano_json).motivo,body.motivo);
 const replay=await http("/r7/companies/e1/titles/revise","POST",body);
 assert.equal(replay.status,200);
 assert.equal((await replay.json()).replayed,true);
});
test("FIN08 corrida CAS de edição de titulo só confirma uma revisão",async()=>{
 const body=value=>({intentId:"revTitle"+value,tituloId:"titleRevision",
  expectedVersion:2,novoValorCent:value,
  motivo:"Atualização autorizada do valor"});
 const [a,b]=await Promise.all([
  http("/r7/companies/e1/titles/revise","POST",body(2500)),
  http("/r7/companies/e1/titles/revise","POST",body(2700))
 ]);
 assert.deepEqual([a.status,b.status].sort(),[201,409]);
 assert.equal((await db.prepare("SELECT versao FROM titulos_pagar "+
  "WHERE id='titleRevision'").first()).versao,3);
});
test("FIN06 título quitado não aceita nova edição nem cancelamento",async()=>{
 const paid=await http("/r7/companies/e1/payments","POST",{
  intentId:"titleRevisionPaid",tituloId:"titleRevision",expectedVersion:3,
  dataPagamento:"2026-11-07",valorPagoCent:2500
 });
 assert.equal(paid.status,201,await paid.clone().text());
 const revision=await http("/r7/companies/e1/titles/revise","POST",{
  intentId:"revAfterPayment",tituloId:"titleRevision",expectedVersion:4,
  novoValorCent:3100,motivo:"Tentativa após quitação"
 });
 assert.equal(revision.status,409);
 const cancel=await http("/r7/companies/e1/titles/cancel","POST",{
  intentId:"cancelPaid",tituloId:"titleRevision",expectedVersion:4,
  motivo:"Proibição de apagar quitação"
 });
 assert.equal(cancel.status,409);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM operacoes "+
  "WHERE id IN ('revAfterPayment','cancelPaid')").first()).n,0);
});
test("FIN06 cancelamento de titulo é auditado e não admite baixa posterior",async()=>{
 await db.prepare("INSERT INTO titulos_pagar "+
  "(id,empresa_id,tipo,beneficiario,categoria_despesa,valor_nominal_cent) "+
  "VALUES ('titleCancelLocal','e1','DIVERSO','Conta cancelada','SERVICO',3000)").run();
 const body={intentId:"cancelAllowed",tituloId:"titleCancelLocal",
  expectedVersion:1,motivo:"Serviço cancelado pelo fornecedor"};
 const r=await http("/r7/companies/e1/titles/cancel","POST",body);
 assert.equal(r.status,201,await r.clone().text());
 const d=await db.prepare("SELECT cancelado,motivo_cancelamento,versao "+
  "FROM titulos_pagar WHERE id='titleCancelLocal'").first();
 assert.deepEqual(d,{cancelado:1,motivo_cancelamento:body.motivo,versao:2});
 const replay=await http("/r7/companies/e1/titles/cancel","POST",body);
 assert.equal(replay.status,200);
 const paid=await http("/r7/companies/e1/payments","POST",{
  intentId:"cancelPaidInvalid",tituloId:"titleCancelLocal",
  expectedVersion:2,dataPagamento:"2026-11-07",valorPagoCent:3000
 });
 assert.equal(paid.status,409);
});
test("FIN08 titulo LEGADO ou de recorrência não sofre revisão direta",async()=>{
 const legacy=await http("/r7/companies/e1/titles/revise","POST",{
  intentId:"legacyUnauthorizedUpdate",tituloId:"legacyUnknownMoney",
  expectedVersion:1,novoValorCent:1,motivo:"Não inventar valor legado"
 });
 assert.equal(legacy.status,409);
 const recurring=await db.prepare("SELECT id,versao FROM titulos_pagar "+
  "WHERE recorrencia_id='recProj' AND competencia=?").bind(competence).first();
 assert.ok(recurring);
 const r=await http("/r7/companies/e1/titles/revise","POST",{
  intentId:"recurringUnauthorizedUpdate",tituloId:recurring.id,
  expectedVersion:recurring.versao,novoValorCent:1,
  motivo:"Revisão deve alterar regra recorrente"
 });
 assert.equal(r.status,409);
});


async function manifestForSyntheticMigration(){
 const snapshotId="synthetic-stable-2026-11";
 const sourceRows=[
  {entityType:"TITULO",sourceId:"sheet-row-101",
   sha256:"1".repeat(64),sourceAccessible:true,validCivilDate:true,hasFormula:false},
  {entityType:"RECORRENCIA",sourceId:"sheet-row-102",
   sha256:"2".repeat(64),sourceAccessible:true,validCivilDate:true,hasFormula:false}
 ];
 const sourceDocuments=[
  {sourceStableId:"driveDocOne",versionNumber:1,sha256:"a".repeat(64),
   sourceReadable:true,bytesMatch:true,versionsPreserved:true},
  {sourceStableId:"driveDocOne",versionNumber:2,sha256:"b".repeat(64),
   sourceReadable:true,bytesMatch:true,versionsPreserved:true}
 ];
 const normalizedRows=sourceRows.map(x=>[
  x.entityType,x.sourceId,x.sha256,x.sourceAccessible,x.validCivilDate,x.hasFormula
 ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const normalizedDocs=sourceDocuments.map(x=>[
  x.sourceStableId,x.versionNumber,x.sha256,
  x.sourceReadable,x.bytesMatch,x.versionsPreserved
 ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const fieldMapHash=await hashIntent("CAMPOS_LEGADO_V1",LEGACY_FIELD_KEYS);
 const snapshotHash=await hashIntent("SNAPSHOT_SINTETICO",
   [snapshotId,normalizedRows,normalizedDocs,fieldMapHash]);
 return {intentId:"migrationDryRun1",snapshotId,snapshotHash,
  mappingVersion:"local-v1",fieldsExpected:350,fieldsMapped:350,
  sourceCountExpected:2,documentCountExpected:2,
  sourceRows,sourceDocuments,fieldKeys:[...LEGACY_FIELD_KEYS]};
}
test("MIG01 MIG02 MIG03 MIG04 OK13 manifesto sintético cria ledger pendente sem migrar histórico",async()=>{
 const body=await manifestForSyntheticMigration();
 const reader=await http("/r7/companies/e1/migration/synthetic-prepare","POST",
  body);
 assert.equal(reader.status,403);
 const r=await http("/r7/companies/e1/migration/synthetic-prepare","POST",
  body,{"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(r.status,201,await r.clone().text());
 const out=await r.json();
 assert.equal(out.migrationExecuted,false);
 assert.equal(out.approveCutover,false);
 assert.equal(out.referencesPending,2);
 assert.equal(out.attachmentsPending,2);
 const lot=await db.prepare("SELECT estado FROM lotes_migracao "+
  "WHERE id=?").bind(out.loteId).first();
 assert.equal(lot.estado,"PREPARADO");
 const refs=await db.prepare("SELECT COUNT(*) AS n FROM migracao_referencias "+
  "WHERE lote_id=? AND estado='PENDENTE'").bind(out.loteId).first();
 assert.equal(refs.n,2);
 const versions=await db.prepare("SELECT COUNT(*) AS n FROM migracao_itens "+
  "WHERE lote_id=? AND estado='PENDENTE' AND entidade_tipo='DOCUMENTO_VERSAO'"
 ).bind(out.loteId).first();
 assert.equal(versions.n,2);
 const replay=await http("/r7/companies/e1/migration/synthetic-prepare","POST",
  body,{"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(replay.status,200);
 assert.equal((await replay.json()).migrationExecuted,false);
 const second=await http("/r7/companies/e1/migration/synthetic-prepare","POST",
  {...body,intentId:"migrationDryRunTwice"},
  {"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(second.status,409);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM lotes_migracao "+
  "WHERE origem_snapshot=?").bind(body.snapshotId).first()).n,1);
});
test("MIG01 formula/ID duplicado/data inválida nunca excluem linha silenciosamente",async()=>{
 const body=await manifestForSyntheticMigration();
 for(const [label,alter] of [
  ["dup",x=>{x.sourceRows[1]={...x.sourceRows[0]};}],
  ["formula",x=>{x.sourceRows[0].hasFormula=true;}],
  ["civil",x=>{x.sourceRows[0].validCivilDate=false;}],
  ["url",x=>{x.sourceRows[0].sourceAccessible=false;}],
  ["count",x=>{x.sourceCountExpected=3;}]
 ]){
  const clone=structuredClone(body);
  alter(clone);
  const r=await http("/r7/companies/e1/migration/synthetic-prepare","POST",
   {...clone,intentId:"migrationInvalid"+label},
   {"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
  assert.equal(r.status,409,await r.clone().text());
 }
});
test("MIG03 perda de versão ou arquivo ilegível bloqueia preparo",async()=>{
 const body=await manifestForSyntheticMigration();
 for(const [label,alter] of [
  ["missing",x=>{x.sourceDocuments.pop();}],
  ["inaccessible",x=>{x.sourceDocuments[0].sourceReadable=false;}],
  ["corrupt",x=>{x.sourceDocuments[0].bytesMatch=false;}],
  ["noHistory",x=>{x.sourceDocuments[0].versionsPreserved=false;}]
 ]){
  const clone=structuredClone(body);
  alter(clone);
  const r=await http("/r7/companies/e1/migration/synthetic-prepare","POST",
   {...clone,intentId:"migrationDocBad"+label},
   {"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
  assert.equal(r.status,409,await r.clone().text());
 }
});
test("MIG04 nomes exatos dos 350 campos impedem ausência, duplicação e troca",async()=>{
 const body=await manifestForSyntheticMigration();
 for(const [label,change] of [
  ["missing",x=>{x.fieldKeys.pop();}],
  ["duplicate",x=>{x.fieldKeys[0]=x.fieldKeys[1];}],
  ["unknown",x=>{x.fieldKeys[0]="CampoFantasma.Inexistente";}]
 ]){
  const bad=structuredClone(body);change(bad);
  const r=await http("/r7/companies/e1/migration/synthetic-prepare","POST",
   {...bad,intentId:"migrationMap"+label},
   {"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
  assert.equal(r.status,409,await r.clone().text());
 }
 assert.equal(LEGACY_FIELD_KEYS.length,350);
 assert.equal(new Set(LEGACY_FIELD_KEYS).size,350);
});
test("MIG04 349 de 350 campos ou hash falso jamais declara 100%",async()=>{
 const body=await manifestForSyntheticMigration();
 for(const [label,change] of [
  ["fields",x=>{x.fieldsMapped=349;}],
  ["hash",x=>{x.snapshotHash="0".repeat(64);}]
 ]){
  const clone=structuredClone(body);
  change(clone);
  const r=await http("/r7/companies/e1/migration/synthetic-prepare","POST",
   {...clone,intentId:"migrationFieldBad"+label},
   {"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
  assert.equal(r.status,409);
 }
});


test("Q03 duas compras confirmadas simultâneas disputam mesma quantidade empenhada",async()=>{
 await db.prepare("INSERT INTO licitacoes(id,empresa_id,orgao_id,numero) "+
  "VALUES('lConcur','e1','o1','COMP-CONCUR')").run();
 await db.prepare("INSERT INTO licitacao_itens (id,empresa_id,licitacao_id,"+
  "numero_item,resultado,quantidade_prevista_mil,quantidade_ganha_mil,"+
  "valor_final_unit_cent) VALUES('liConcur','e1','lConcur','1',"+
  "'GANHO',3000,3000,100)").run();
 await db.prepare("INSERT INTO empenhos(id,empresa_id,licitacao_id,"+
  "orgao_id_escopo,numero,situacao) "+
  "VALUES('epConcur','e1','lConcur','o1','EMP-CONCUR','CONFIRMADO')").run();
 await db.prepare("INSERT INTO empenho_itens(id,empresa_id,empenho_id,"+
  "licitacao_item_id,licitacao_id_escopo,quantidade_mil,valor_unit_cent) "+
  "VALUES('eiConcur','e1','epConcur','liConcur','lConcur',3000,100)").run();
 const make=(id)=>({intentId:id,parentId:"epConcur",expectedParentVersion:1,
  fornecedorId:"f1",numero:"PC-"+id,
  items:[{parentItemId:"eiConcur",quantidadeMil:3000,valorUnitCent:100}]});
 const [a,b]=await Promise.all([
  http("/r7/companies/e1/commercial/purchase","POST",make("buyConcurA")),
  http("/r7/companies/e1/commercial/purchase","POST",make("buyConcurB"))
 ]);
 assert.deepEqual([a.status,b.status].sort(),[201,409]);
 const sum=await db.prepare("SELECT sum(ci.quantidade_mil) AS n "+
  "FROM compra_itens ci JOIN compras c ON c.id=ci.compra_id "+
  "WHERE c.empenho_id='epConcur' AND c.situacao='CONFIRMADA'").first();
 assert.equal(sum.n,3000);
 const journal=await db.prepare("SELECT COUNT(*) AS n FROM operacoes "+
  "WHERE id IN ('buyConcurA','buyConcurB')").first();
 assert.equal(journal.n,1);
});
test("Q06 duas notas fiscais simultâneas não faturam mais que o empenhado",async()=>{
 const make=(id)=>({intentId:id,parentId:"epConcur",expectedParentVersion:1,
  items:[{parentItemId:"eiConcur",quantidadeMil:3000,valorUnitCent:100}],
  parcelasCent:[300]});
 const [a,b]=await Promise.all([
  http("/r7/companies/e1/commercial/invoice","POST",make("invoiceConcurA")),
  http("/r7/companies/e1/commercial/invoice","POST",make("invoiceConcurB"))
 ]);
 assert.deepEqual([a.status,b.status].sort(),[201,409]);
 const sum=await db.prepare("SELECT sum(nfi.quantidade_mil) AS n "+
  "FROM nota_fiscal_itens nfi JOIN notas_fiscais n ON n.id=nfi.nota_fiscal_id "+
  "WHERE n.empenho_id='epConcur' AND n.situacao IN ('EMITIDA','APRESENTADA')").first();
 assert.equal(sum.n,3000);
 const journal=await db.prepare("SELECT COUNT(*) AS n FROM operacoes "+
  "WHERE id IN ('invoiceConcurA','invoiceConcurB')").first();
 assert.equal(journal.n,1);
});


test("FIN03 OK03 estorno integral usa data civil do crédito original e preserva registro",async()=>{
 const orig=await db.prepare("SELECT id,conta_receber_id,data_credito,"+
  "valor_recebido_cent,retencao_confirmada_cent "+
  "FROM recebimentos WHERE operacao_id='ok02-credit-a'").first();
 assert.ok(orig);
 const body={intentId:"revOk02",recebimentoOriginalId:orig.id,
  motivo:"Reversão integral do crédito e da retenção"};
 const r=await http("/r7/companies/e1/credits/reversal","POST",body);
 assert.equal(r.status,201,await r.clone().text());
 const data=await r.json();
 const undo=await db.prepare("SELECT estorno_de_id,conta_receber_id,"+
  "tipo_movimento,data_credito,valor_recebido_cent,retencao_confirmada_cent "+
  "FROM recebimentos WHERE id=?").bind(data.reversalId).first();
 assert.equal(undo.estorno_de_id,orig.id);
 assert.equal(undo.conta_receber_id,orig.conta_receber_id);
 assert.equal(undo.data_credito,orig.data_credito);
 assert.equal(undo.valor_recebido_cent,orig.valor_recebido_cent);
 assert.equal(undo.retencao_confirmada_cent,orig.retencao_confirmada_cent);
 assert.equal(undo.tipo_movimento,"ESTORNO");
 const still=await db.prepare("SELECT COUNT(*) AS n FROM recebimentos "+
  "WHERE id=? AND tipo_movimento='RECEBIMENTO'").bind(orig.id).first();
 assert.equal(still.n,1);
 const replay=await http("/r7/companies/e1/credits/reversal","POST",body);
 assert.equal(replay.status,200);
 assert.equal((await replay.json()).replayed,true);
});
test("FIN03 estorno duplicado, estorno de estorno e id de outra empresa são recusados",async()=>{
 const orig=await db.prepare("SELECT id FROM recebimentos "+
  "WHERE operacao_id='ok02-credit-a'").first();
 const already=await db.prepare("SELECT id FROM recebimentos "+
  "WHERE operacao_id='revOk02' AND tipo_movimento='ESTORNO'").first();
 for(const [id,original] of [
  ["reverseAgain",orig.id],["reverseReversal",already.id]
 ]){
  const r=await http("/r7/companies/e1/credits/reversal","POST",{
   intentId:id,recebimentoOriginalId:original,
   motivo:"Proibido estorno adicional"
  });
  assert.equal(r.status,409);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM operacoes WHERE id=?")
   .bind(id).first()).n,0);
 }
 const r=await http("/r7/companies/e2/credits/reversal","POST",{
  intentId:"reverseOtherCompany",recebimentoOriginalId:orig.id,
  motivo:"Tentativa entre empresas"
 });
 assert.equal(r.status,403);
});


test("FIN09 OK08 OK15 ciclo fecha sem quitar boleto, reabre ADMIN e fecha com novo marco",async()=>{
 await db.prepare("INSERT INTO licitacoes(id,empresa_id,orgao_id,numero) "+
  "VALUES('lCycleR7','e1','o1','CYCLE-E2')").run();
 await db.prepare("INSERT INTO empenhos(id,empresa_id,licitacao_id,"+
  "orgao_id_escopo,numero,situacao) "+
  "VALUES('epCycleR7','e1','lCycleR7','o1','CYCLE-EMP','CONFIRMADO')").run();
 await db.prepare("INSERT INTO notas_fiscais(id,empresa_id,empenho_id,"+
  "orgao_id_escopo,situacao) "+
  "VALUES('nfCycleR7','e1','epCycleR7','o1','EMITIDA')").run();
 await db.prepare("INSERT INTO contas_receber(id,empresa_id,nota_fiscal_id,"+
  "parcela,valor_bruto_cent) "+
  "VALUES('crCycleR7','e1','nfCycleR7',1,5000)").run();
 await db.prepare("INSERT INTO titulos_pagar(id,empresa_id,tipo,"+
  "fornecedor_id,valor_nominal_cent,vencimento) "+
  "VALUES('billCycleR7','e1','FORNECEDOR','f1',3000,'2027-01-10')").run();
 const payload={intentId:"cycleClose1",licitacaoId:"lCycleR7",
  expectedVersion:1,motivo:"Objeto licitado comercialmente encerrado"};
 const r=await http("/r7/companies/e1/commercial/close","POST",payload);
 assert.equal(r.status,201,await r.clone().text());
 const cycle=await r.json();
 assert.ok(cycle.cicloId);
 assert.equal((await db.prepare("SELECT encerrada_em FROM licitacoes "+
  "WHERE id='lCycleR7'").first()).encerrada_em,cycle.encerradaEm);
 const openBill=await db.prepare("SELECT situacao FROM v_titulos_situacao "+
  "WHERE id='billCycleR7'").first();
 assert.equal(openBill.situacao,"ABERTO");
 const denied=await http("/r7/companies/e1/credits","POST",{
  intentId:"cycleCreditDenied",contaReceberId:"crCycleR7",
  valorRecebidoCent:1000,retencaoConfirmadaCent:0,
  dataCredito:"2026-11-07",contaDestino:"BB",referenciaExterna:"CYCLE-DENIED"
 });
 assert.equal(denied.status,409);
 const deniedReopen=await http("/r7/companies/e1/commercial/reopen","POST",{
  intentId:"cycleReopenOperator",licitacaoId:"lCycleR7",cicloId:cycle.cicloId,
  expectedVersion:2,motivo:"Reabertura administrativa motivada"
 });
 assert.equal(deniedReopen.status,403);
 const reopened=await http("/r7/companies/e1/commercial/reopen","POST",{
  intentId:"cycleReopen1",licitacaoId:"lCycleR7",cicloId:cycle.cicloId,
  expectedVersion:2,motivo:"Reabertura administrativa para recebimento"
 },{"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(reopened.status,201,await reopened.clone().text());
 assert.equal((await db.prepare("SELECT encerrada_em FROM licitacoes "+
  "WHERE id='lCycleR7'").first()).encerrada_em,null);
 const permitted=await http("/r7/companies/e1/credits","POST",{
  intentId:"cycleCreditNowAllowed",contaReceberId:"crCycleR7",
  valorRecebidoCent:1000,retencaoConfirmadaCent:0,
  dataCredito:"2026-11-07",contaDestino:"BB",referenciaExterna:"CYCLE-PERMITTED"
 });
 assert.equal(permitted.status,201,await permitted.clone().text());
 const second=await http("/r7/companies/e1/commercial/close","POST",{
  intentId:"cycleClose2",licitacaoId:"lCycleR7",expectedVersion:3,
  motivo:"Novo encerramento comercial posterior à reabertura"
 });
 assert.equal(second.status,201,await second.clone().text());
 const secondCycle=await second.json();
 assert.notEqual(secondCycle.cicloId,cycle.cicloId);
 const historic=await db.prepare("SELECT COUNT(*) AS n FROM licitacao_encerramentos "+
  "WHERE licitacao_id='lCycleR7'").first();
 assert.equal(historic.n,2);
 const firstCycle=await db.prepare("SELECT motivo_reabertura,reaberta_em "+
  "FROM licitacao_encerramentos WHERE id=?").bind(cycle.cicloId).first();
 assert.equal(firstCycle.motivo_reabertura,
  "Reabertura administrativa para recebimento");
 assert.ok(firstCycle.reaberta_em);
 assert.ok(Date.parse(secondCycle.encerradaEm)>Date.parse(firstCycle.reaberta_em));
});


test("DOC05 DOC06 D1 preview não acredita em 24 meses, backup ou overlay do cliente",async()=>{
 await db.prepare("INSERT INTO licitacoes(id,empresa_id,orgao_id,numero) "+
  "VALUES('licArqE2','e1','o1','RETENTION-E2')").run();
 const upload=await http("/r7/companies/e1/documents","POST",{
  intentId:"archiveDocAttachE2",ownerType:"licitacao",ownerId:"licArqE2",
  papel:"EDITAL",documentType:"EDITAL_DOCUMENTO",nomeOriginal:"retencao.txt",
  mimeType:"text/plain",conteudoBase64:Buffer.from("Evidencia retencao R7").toString("base64")
 });
 assert.equal(upload.status,201,await upload.clone().text());
 const doc=await upload.json(),request={documentoId:doc.documentoId,versaoId:doc.versaoId};
 let result=await http("/r7/companies/e1/documents/archive-preview","POST",request,
  {"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(result.status,201,await result.clone().text());
 let preview=await result.json();
 assert.equal(preview.eligibleForHumanReview,false);
 assert.ok(preview.reasons.includes("closure_unverified"));
 assert.equal(preview.deleteR2Authorized,false);
 const denied=await http("/r7/companies/e1/documents/archive-preview","POST",request);
 assert.equal(denied.status,403);
 const fabricated=await http("/r7/companies/e1/documents/archive-preview","POST",
  {...request,backup:{restored:true},monthsPassed:25},
  {"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(fabricated.status,400);
 const close=await http("/r7/companies/e1/commercial/close","POST",{
  intentId:"archiveCycleClose",licitacaoId:"licArqE2",expectedVersion:1,
  motivo:"Encerrado comercialmente para revisão documental"
 });
 assert.equal(close.status,201,await close.clone().text());
 result=await http("/r7/companies/e1/documents/archive-preview","POST",request,
  {"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 preview=await result.json();
 assert.equal(preview.eligibleForHumanReview,false);
 assert.ok(preview.reasons.includes("retention_24_months_not_elapsed"));
 assert.ok(preview.reasons.includes("drive_bytes_not_verified"));
 assert.ok(preview.reasons.includes("independent_backup_not_restored"));
 assert.ok(preview.reasons.includes("overlay_30_days_not_elapsed"));
 assert.equal(preview.deleteR2Authorized,false);
 const r2=await mf.getR2Bucket("R2");
 assert.ok(await r2.get("e1/"+doc.documentoId+"/"+doc.versaoId));
 const inYear=await reviewArchiveEligibility(db,{issuer,subject:"admin-sub"},"e1",
  request,{now:new Date(Date.now()+25*366*86400000)});
 assert.equal(inYear.eligibleForHumanReview,false);
 assert.ok(inYear.reasons.includes("drive_bytes_not_verified"));
});
test("DOC05 DOC06 backup e Drive verificados em memória não autorizam expurgo R2",async()=>{
 const doc=await db.prepare("SELECT d.id, v.id AS version_id FROM documentos d "+
  "JOIN documento_versoes v ON v.documento_id=d.id "+
  "JOIN documento_vinculos link ON link.documento_id=d.id "+
  "WHERE link.licitacao_id='licArqE2' AND link.papel='EDITAL'").first();
 assert.ok(doc);
 const driveFiles=new Map(),backupFiles=new Map();
 const clone=x=>Uint8Array.from(x);
 const adapters={
  r2:await mf.getR2Bucket("R2"),
  drive:{
    async put(key,bytes){driveFiles.set(key,clone(bytes));return "MEM-DRIVE:"+key;},
    async get(id){return driveFiles.get(id.slice(10))?.slice();}
  },
  backup:{
    async put(key,bytes){backupFiles.set(key,clone(bytes));return "MEM-BACKUP:"+key;},
    async restore(id){return backupFiles.get(id.slice(11))?.slice();}
  }
 };
 const copied=await copyDocumentVersionToDrive(db,{issuer,subject:"operator-sub"},"e1",{
  intentId:"archiveCopyE2",documentoVersaoId:doc.version_id
 },adapters);
 assert.equal(copied.state,"SOBREPOSICAO_30_DIAS");
 assert.equal(copied.r2DeletionAuthorized,false);
 const request={documentoId:doc.id,versaoId:doc.version_id};
 const gateNow=await reviewArchiveEligibility(db,{issuer,subject:"admin-sub"},
  "e1",request);
 assert.equal(gateNow.eligibleForHumanReview,false);
 const gateFuture=await reviewArchiveEligibility(db,{issuer,subject:"admin-sub"},
  "e1",request,{now:new Date("2030-03-31T12:00:00Z")});
 assert.equal(gateFuture.eligibleForHumanReview,true);
 assert.equal(gateFuture.deleteR2Authorized,false);
 assert.equal(gateFuture.externalEvidenceVerified,false);
 // Não é permitido fingir que o relógio do SQLITE passou: status R2
 // continua verificado e bytes preservados, sem DELETE físico.
 const stored=await db.prepare("SELECT status FROM documento_localizacoes "+
  "WHERE empresa_id='e1' AND versao_id=? AND provedor='R2'"
 ).bind(doc.version_id).first();
 assert.equal(stored.status,"VERIFICADO");
 assert.ok(await adapters.r2.get("e1/"+doc.id+"/"+doc.version_id));
});
test("DOC05 DOC07 conta DIVERSO não usa política de retenção de licitação",async()=>{
 const doc=await db.prepare("SELECT id FROM documentos WHERE titulo='retencao.txt'").first();
 const wrong=await http("/r7/companies/e1/documents/archive-preview","POST",{
  documentoId:doc.id,versaoId:"vHist1"
 },{"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(wrong.status,409);
 const res=assessArchiveEvidence({
  documentOwnerType:"DIVERSO",
  lastCommercialClosureAt:"2020-01-01T00:00:00.000Z",
  openSupplierTitles:0,openReceivables:0,legalBlocks:0,
  drive:{verified:true,verifiedAt:"2020-02-01T00:00:00.000Z",sha256:"a".repeat(64)},
  backup:{restoreTested:true,restoredAt:"2020-02-01T00:00:00.000Z",sha256:"a".repeat(64)},
  overlayStartedAt:"2020-02-01T00:00:00.000Z"
 },{now:new Date("2026-11-07T12:00:00Z")});
 assert.equal(res.eligibleForHumanReview,false);
 assert.ok(res.reasons.includes("diverse_bill_not_licitacao_archivable"));
 assert.equal(res.deleteR2Authorized,false);
});
test("FK05 FK06 exclusão de fornecedor e órgão relacionados é RESTRICT sem cascata",async()=>{
 const before=await db.prepare("SELECT COUNT(*) AS n FROM licitacoes "+
  "WHERE orgao_id='o1'").first();
 await assert.rejects(db.prepare("DELETE FROM orgaos WHERE id='o1'").run());
 await assert.rejects(db.prepare("DELETE FROM fornecedores WHERE id='f1'").run());
 const after=await db.prepare("SELECT COUNT(*) AS n FROM licitacoes "+
  "WHERE orgao_id='o1'").first();
 assert.equal(after.n,before.n);
 assert.ok(await db.prepare("SELECT id FROM fornecedores WHERE id='f1'").first());
});
test("FIN01 UNIQUE de parcela ativa rejeita duplicata sem modificar primeira",async()=>{
 const nf=await db.prepare("SELECT id FROM notas_fiscais "+
  "WHERE operacao_id='invoiceConcurA' OR operacao_id='invoiceConcurB' LIMIT 1").first();
 assert.ok(nf);
 const count=await db.prepare("SELECT COUNT(*) AS n FROM contas_receber "+
  "WHERE nota_fiscal_id=?").bind(nf.id).first();
 assert.equal(count.n,1);
 await assert.rejects(db.prepare("INSERT INTO contas_receber "+
  "(id,empresa_id,nota_fiscal_id,parcela,valor_bruto_cent) "+
  "VALUES('dupePartNumber','e1',?,1,100)"
 ).bind(nf.id).run());
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM contas_receber "+
  "WHERE nota_fiscal_id=?").bind(nf.id).first()).n,1);
});
test("ACC02 origem, empresa e autor forjados são rejeitados nos novos comandos",async()=>{
 const payload={intentId:"spoofCycle",licitacaoId:"licArqE2",
  expectedVersion:2,motivo:"Tentativa de autoria forjada",empresa_id:"e2"};
 const response=await http("/r7/companies/e1/commercial/reopen","POST",payload,
  {"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(response.status,400);
 const idem=await http("/r7/companies/e1/titles/cancel","POST",{
  intentId:"spoofCancelE2",tituloId:"t1",expectedVersion:1,
  motivo:"Cancelar sem autorização",ator_id:"userA",origem_dado:"LEGADO"
 });
 assert.equal(idem.status,400);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM operacoes "+
  "WHERE id IN ('spoofCancelE2','spoofCycle')").first()).n,0);
});


test("FK05 escopo composto bloqueia órgão, fornecedor e documento de e2 em e1",async()=>{
 await db.prepare("INSERT INTO orgaos(id,empresa_id,nome) VALUES('orgOtherE2','e2','Orgão e2')").run();
 await db.prepare("INSERT INTO fornecedores(id,empresa_id,nome) "+
  "VALUES('supplierOtherE2','e2','Fornecedor e2')").run();
 await assert.rejects(db.prepare("INSERT INTO licitacoes(id,empresa_id,orgao_id,numero) "+
  "VALUES('licOtherOrg','e1','orgOtherE2','INVALIDA')").run());
 await assert.rejects(db.prepare("INSERT INTO compras(id,empresa_id,empenho_id,"+
  "fornecedor_id,situacao) VALUES('coOtherSupplier','e1','ep1',"+
  "'supplierOtherE2','CONFIRMADA')").run());
 await db.prepare("INSERT INTO documentos(id,empresa_id,tipo) "+
  "VALUES('docE2Scoped','e2','COMPROVANTE')").run();
 await assert.rejects(db.prepare("INSERT INTO documento_vinculos"+
  "(id,empresa_id,documento_id,papel,titulo_pagar_id) "+
  "VALUES('crossDocument','e1','docE2Scoped','BOLETO','t1')").run());
 for(const id of ["licOtherOrg","coOtherSupplier"]){
  const table=id.startsWith("lic")?"licitacoes":"compras";
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM "+table+
   " WHERE id=?").bind(id).first()).n,0);
 }
});
test("DOC03 falha de upload R2 ou digest divergente não grava D1 nem journal",async()=>{
 const principal={issuer,subject:"operator-sub"};
 const body={intentId:"docR2Failure",ownerType:"licitacao",ownerId:"l1",
  papel:"PROPOSTA",documentType:"PROPOSTA_DOC",nomeOriginal:"failure.txt",
  mimeType:"text/plain",conteudoBase64:Buffer.from("prova sem upload").toString("base64")};
 await assert.rejects(()=>createDocumentAttachment(db,{
  async put(){throw Error("R2 indisponivel");},
  async get(){throw Error("R2 indisponivel");}
 },principal,"e1",body));
 const changed={...body,intentId:"docHashMismatch"};
 await assert.rejects(()=>createDocumentAttachment(db,{
  async put(){},
  async get(){return {size:Buffer.from("prova sem upload").length,async arrayBuffer(){
   return new TextEncoder().encode("bytes adulterados").buffer;
  }};}
 },principal,"e1",changed),e=>e.code==="uploaded_document_hash_mismatch");
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM operacoes "+
  "WHERE id IN ('docR2Failure','docHashMismatch')").first()).n,0);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM documentos "+
  "WHERE titulo='failure.txt'").first()).n,0);
});
test("DOC06 proteção SQL não permite excluir local R2 com Drive recém verificado",async()=>{
 const r=await db.prepare("SELECT l.id FROM documento_localizacoes l "+
  "JOIN documento_versoes v ON v.id=l.versao_id "+
  "JOIN documento_vinculos dv ON dv.documento_id=v.documento_id "+
  "WHERE dv.licitacao_id='licArqE2' AND l.provedor='R2' LIMIT 1").first();
 assert.ok(r);
 await assert.rejects(db.prepare("UPDATE documento_localizacoes "+
  "SET status='EXCLUIDO' WHERE id=?").bind(r.id).run());
 assert.equal((await db.prepare("SELECT status FROM documento_localizacoes "+
  "WHERE id=?").bind(r.id).first()).status,"VERIFICADO");
});
test("ACC01 usuário inativo e membro desativado não lê nem escreve",async()=>{
 await db.prepare("INSERT INTO usuarios(id,access_issuer,access_subject,"+
  "email_normalizado,ativo) "+
  "VALUES('uInactiveE2',?,'disabled-sub','inactive@local.invalid',0)"
 ).bind(issuer).run();
 await db.prepare("INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) "+
  "VALUES('uInactiveE2','e1','ADMIN',1)").run();
 const denied=await http("/r7/companies/e1/titles","GET",null,{
  "cf-access-jwt-assertion":jwt({sub:"disabled-sub"})});
 assert.equal(denied.status,403);
 const written=await http("/r7/companies/e1/titles/cancel","POST",{
  intentId:"inactiveWrite",tituloId:"t1",expectedVersion:1,
  motivo:"Tentativa de conta desativada"
 },{"cf-access-jwt-assertion":jwt({sub:"disabled-sub"})});
 assert.equal(written.status,403);
 await db.prepare("INSERT INTO usuarios(id,access_issuer,access_subject,"+
  "email_normalizado,ativo) "+
  "VALUES('uNoMembershipE2',?,'no-member-sub','nomem@local.invalid',1)"
 ).bind(issuer).run();
 const forbidden=await http("/r7/companies/e1/titles","GET",null,{
  "cf-access-jwt-assertion":jwt({sub:"no-member-sub"})});
 assert.equal(forbidden.status,403);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM operacoes "+
  "WHERE id='inactiveWrite'").first()).n,0);
});
test("OPR01 mesma intenção com hash diferente e concorrência não duplica baixa",async()=>{
 await db.prepare("INSERT INTO titulos_pagar (id,empresa_id,tipo,beneficiario,categoria_despesa,valor_nominal_cent) "+
  "VALUES('tE2OpsUnique','e1','DIVERSO','Operação idempotente','SERVICO',3000)").run();
 const payload={intentId:"e2IntentReplayed",tituloId:"tE2OpsUnique",
  expectedVersion:1,dataPagamento:"2026-11-07",valorPagoCent:2900};
 const first=await http("/r7/companies/e1/payments","POST",payload);
 assert.equal(first.status,201,await first.clone().text());
 const replay=await http("/r7/companies/e1/payments","POST",payload);
 assert.equal(replay.status,200);
 const mismatch=await http("/r7/companies/e1/payments","POST",
  {...payload,valorPagoCent:3000});
 assert.equal(mismatch.status,409);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM titulo_baixas "+
  "WHERE titulo_id='tE2OpsUnique' AND tipo='QUITACAO'").first()).n,1);
});
test("FIN06 desfazimento inexistente, cruzado e duplo nunca gera evento",async()=>{
 const payment=await db.prepare("SELECT b.id,t.versao FROM titulo_baixas b "+
  "JOIN titulos_pagar t ON t.id=b.titulo_id "+
  "WHERE b.titulo_id='tE2OpsUnique' AND b.tipo='QUITACAO'").first();
 assert.ok(payment);
 const other=await db.prepare("SELECT versao FROM titulos_pagar WHERE id='tpay'").first();
 const wrong=await http("/r7/companies/e1/payments/undo","POST",{
  intentId:"e2UndoWrong",tituloId:"tpay",expectedVersion:other.versao,
  baixaOriginalId:payment.id,motivo:"Desfazimento da parcela errada"
 });
 assert.equal(wrong.status,409);
 const first=await http("/r7/companies/e1/payments/undo","POST",{
  intentId:"e2UndoRight",tituloId:"tE2OpsUnique",expectedVersion:payment.versao,
  baixaOriginalId:payment.id,motivo:"Cancelamento autorizado da baixa"
 });
 assert.equal(first.status,201,await first.clone().text());
 const again=await http("/r7/companies/e1/payments/undo","POST",{
  intentId:"e2UndoTwice",tituloId:"tE2OpsUnique",
  expectedVersion:payment.versao+1,baixaOriginalId:payment.id,
  motivo:"Impossível desfazer a mesma baixa duas vezes"
 });
 assert.equal(again.status,409);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM titulo_baixas "+
  "WHERE baixa_original_id=? AND tipo='DESFAZIMENTO'").bind(payment.id).first()).n,1);
});


test("DOC05 OK08 bloqueio de archive consulta boleto, recebível e impedimento legal na licitação",async()=>{
 await db.prepare("INSERT INTO licitacoes(id,empresa_id,orgao_id,numero) "+
  "VALUES('licDebtE2','e1','o1','RETENCAO-DIVIDAS')").run();
 await db.prepare("INSERT INTO empenhos(id,empresa_id,licitacao_id,"+
  "orgao_id_escopo,numero,situacao) "+
  "VALUES('epDebtE2','e1','licDebtE2','o1','EMP-DEBT','CONFIRMADO')").run();
 await db.prepare("INSERT INTO compras(id,empresa_id,empenho_id,"+
  "fornecedor_id,situacao) "+
  "VALUES('coDebtE2','e1','epDebtE2','f1','CONFIRMADA')").run();
 await db.prepare("INSERT INTO titulos_pagar(id,empresa_id,tipo,"+
  "compra_id,fornecedor_id,valor_nominal_cent,vencimento) "+
  "VALUES('titleDebtE2','e1','FORNECEDOR','coDebtE2','f1',3000,'2027-03-01')").run();
 await db.prepare("INSERT INTO notas_fiscais(id,empresa_id,empenho_id,"+
  "orgao_id_escopo,situacao) "+
  "VALUES('nfDebtE2','e1','epDebtE2','o1','EMITIDA')").run();
 await db.prepare("INSERT INTO contas_receber(id,empresa_id,nota_fiscal_id,"+
  "parcela,valor_bruto_cent) "+
  "VALUES('crDebtE2','e1','nfDebtE2',1,4000)").run();
 const attach=await http("/r7/companies/e1/documents","POST",{
  intentId:"attachDebtE2",ownerType:"licitacao",ownerId:"licDebtE2",
  papel:"EDITAL",documentType:"EDITAL_DOCUMENTO",nomeOriginal:"debt-e2.txt",
  mimeType:"text/plain",conteudoBase64:Buffer.from("Edital com contas abertas").toString("base64")
 });
 assert.equal(attach.status,201,await attach.clone().text());
 const document=await attach.json();
 const closed=await http("/r7/companies/e1/commercial/close","POST",{
  intentId:"closeDebtE2",licitacaoId:"licDebtE2",expectedVersion:1,
  motivo:"Encerrado comercialmente apesar de finanças pendentes"
 });
 assert.equal(closed.status,201,await closed.clone().text());
 await db.prepare("INSERT INTO documento_bloqueios "+
  "(id,empresa_id,documento_id,motivo,criado_por) "+
  "VALUES('blockDebtE2','e1',?,'Bloqueio judicial documental','userA')"
 ).bind(document.documentoId).run();
 const gate=await reviewArchiveEligibility(db,{issuer,subject:"admin-sub"},"e1",{
  documentoId:document.documentoId,versaoId:document.versaoId
 },{now:new Date("2031-01-01T12:00:00Z")});
 assert.equal(gate.eligibleForHumanReview,false);
 for(const reason of ["openSupplierTitles_active","openReceivables_active","legalBlocks_active"]){
  assert.ok(gate.reasons.includes(reason),gate.reasons.join(","));
 }
 assert.equal(gate.deleteR2Authorized,false);
 assert.equal((await db.prepare("SELECT situacao FROM v_titulos_situacao "+
  "WHERE id='titleDebtE2'").first()).situacao,"ABERTO");
});
test("DOC07 DIVERSO com comprovante real não tem direito a archive de licitação",async()=>{
 const file=await http("/r7/companies/e1/documents","POST",{
  intentId:"attachDiversoE2",ownerType:"titulo_pagar",ownerId:"t1",
  papel:"COMPROVANTE_PAGAMENTO",documentType:"COMPROVANTE_DESPESA",
  nomeOriginal:"diverso.txt",mimeType:"text/plain",
  conteudoBase64:Buffer.from("Comprovante avulso sem licitacao").toString("base64")
 });
 assert.equal(file.status,201,await file.clone().text());
 const doc=await file.json();
 const gate=await http("/r7/companies/e1/documents/archive-preview","POST",{
  documentoId:doc.documentoId,versaoId:doc.versaoId
 },{"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(gate.status,409);
});
test("OK15 prazo de 24 meses reinicia no último fechamento após reabertura",async()=>{
 const records=await db.prepare("SELECT encerrada_em,reaberta_em "+
  "FROM licitacao_encerramentos WHERE licitacao_id='lCycleR7' "+
  "ORDER BY encerrada_em").all();
 assert.equal(records.results.length,2);
 const first=records.results[0],last=records.results[1];
 assert.ok(Date.parse(last.encerrada_em)>Date.parse(first.reaberta_em));
 const file=await http("/r7/companies/e1/documents","POST",{
  intentId:"attachNewCycleE2",ownerType:"licitacao",ownerId:"lCycleR7",
  papel:"EDITAL",documentType:"EDITAL_DOCUMENTO",nomeOriginal:"novo-ciclo.txt",
  mimeType:"text/plain",conteudoBase64:Buffer.from("Dois ciclos").toString("base64")
 });
 assert.equal(file.status,201,await file.clone().text());
 const doc=await file.json();
 const mid=new Date(first.encerrada_em);
 mid.setUTCFullYear(mid.getUTCFullYear()+2);
 const gate=await reviewArchiveEligibility(db,{issuer,subject:"admin-sub"},"e1",{
  documentoId:doc.documentoId,versaoId:doc.versaoId
 },{now:mid});
 assert.ok(gate.reasons.includes("retention_24_months_not_elapsed"),
   gate.reasons.join(","));
 assert.equal(gate.deleteR2Authorized,false);
});


test("OK05 DIVERSO avulso sem boleto é pago e depois possui comprovante vinculado",async()=>{
 await db.prepare("INSERT INTO titulos_pagar"+
  "(id,empresa_id,tipo,beneficiario,categoria_despesa,valor_nominal_cent,vencimento) "+
  "VALUES('diversoProofE2','e1','DIVERSO','Serviço sem boleto','SERVICO',1800,'2027-02-10')").run();
 const before=await db.prepare("SELECT COUNT(*) AS n FROM documento_vinculos "+
  "WHERE titulo_pagar_id='diversoProofE2'").first();
 assert.equal(before.n,0);
 const paid=await http("/r7/companies/e1/payments","POST",{
  intentId:"diversoPaidE2",tituloId:"diversoProofE2",
  expectedVersion:1,dataPagamento:"2026-11-07",valorPagoCent:1750
 });
 assert.equal(paid.status,201,await paid.clone().text());
 const baixa=await db.prepare("SELECT id,valor_pago_cent FROM titulo_baixas "+
  "WHERE titulo_id='diversoProofE2' AND tipo='QUITACAO'").first();
 assert.equal(baixa.valor_pago_cent,1750);
 const proof=await http("/r7/companies/e1/documents","POST",{
  intentId:"diversoPaidProof",ownerType:"titulo_baixa",ownerId:baixa.id,
  papel:"COMPROVANTE_PAGAMENTO",documentType:"COMPROVANTE_DESPESA",
  nomeOriginal:"avulso-pago.txt",mimeType:"text/plain",
  conteudoBase64:Buffer.from("Comprovante sem boleto avulso").toString("base64")
 });
 assert.equal(proof.status,201,await proof.clone().text());
 const data=await proof.json();
 const owned=await db.prepare("SELECT titulo_baixa_id,titulo_pagar_id FROM "+
  "documento_vinculos WHERE documento_id=?").bind(data.documentoId).first();
 assert.equal(owned.titulo_baixa_id,baixa.id);
 assert.equal(owned.titulo_pagar_id,null);
});
test("OK06 primeira competência com arquivo opcional não copia anexo aos próximos meses",async()=>{
 const one=await db.prepare("SELECT id,versao FROM titulos_pagar "+
  "WHERE recorrencia_id='rec_m' AND competencia=?").bind(competence).first();
 assert.ok(one);
 const file=await http("/r7/companies/e1/documents","POST",{
  intentId:"recMonthModelFileE2",ownerType:"titulo_pagar",ownerId:one.id,
  papel:"BOLETO",documentType:"BOLETO_MODELO",nomeOriginal:"modelo-mensal.txt",
  mimeType:"text/plain",conteudoBase64:Buffer.from("Boleto modelo somente um mes").toString("base64")
 });
 assert.equal(file.status,201,await file.clone().text());
 const nextDate=new Date(Date.UTC(Number(year),Number(month),1));
 const next=nextDate.getUTCFullYear()+"-"+String(nextDate.getUTCMonth()+1).padStart(2,"0");
 const result=await materializeRecurrence(db,{issuer,subject:"operator-sub"},
  "e1",{intentId:"recMonthNextE2",recorrenciaId:"rec_m",
    competencia:next,expectedVersion:2},{nowMs:nextDate.getTime()+86400000});
 assert.equal(result.competencia,next);
 const second=await db.prepare("SELECT id,vencimento FROM titulos_pagar "+
  "WHERE recorrencia_id='rec_m' AND competencia=?").bind(next).first();
 assert.ok(second);
 assert.notEqual(second.id,one.id);
 const documents=await db.prepare("SELECT COUNT(*) AS n FROM documento_vinculos "+
  "WHERE titulo_pagar_id=? AND ativo=1").bind(second.id).first();
 assert.equal(documents.n,0);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM documento_vinculos "+
  "WHERE titulo_pagar_id=? AND ativo=1").bind(one.id).first()).n,1);
});
test("REC01 cancelamento de competência não cria título substituto ao reexecutar",async()=>{
 const previous=await db.prepare("SELECT t.id,t.versao,r.versao AS rule_version "+
  "FROM titulos_pagar t JOIN recorrencias r "+
  "ON r.id=t.recorrencia_id WHERE t.recorrencia_id='rec_m' AND t.competencia=?"
 ).bind(competence).first();
 assert.ok(previous);
 const cancel=await http("/r7/companies/e1/titles/cancel","POST",{
  intentId:"cancelRecOriginalE2",tituloId:previous.id,
  expectedVersion:previous.versao,motivo:"Competência cancelada para ensaio de retomada"
 });
 assert.equal(cancel.status,201,await cancel.clone().text());
 const attempt=await http("/r7/companies/e1/recurrences/materialize","POST",{
  intentId:"rematerializeCancelledE2",recorrenciaId:"rec_m",
  competencia:competence,expectedVersion:previous.rule_version
 });
 assert.equal(attempt.status,409);
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM titulos_pagar "+
  "WHERE recorrencia_id='rec_m' AND competencia=?").bind(competence).first()).n,1);
});
test("OK14 trocar competência de consulta não altera data civil ou vencimento gravado",async()=>{
 const before=await db.prepare("SELECT vencimento,competencia,versao "+
  "FROM titulos_pagar WHERE recorrencia_id='rec_m' AND competencia=?"
 ).bind(competence).first();
 const nextDate=new Date(Date.UTC(Number(year),Number(month),1));
 const next=nextDate.getUTCFullYear()+"-"+String(nextDate.getUTCMonth()+1).padStart(2,"0");
 for(const period of [competence,next,competence]){
  const r=await http("/r7/companies/e1/finance/monthly-preview","POST",{
   competencia:period
  });
  assert.equal(r.status,201,await r.clone().text());
  assert.equal((await r.json()).competencia,period);
 }
 const after=await db.prepare("SELECT vencimento,competencia,versao "+
  "FROM titulos_pagar WHERE recorrencia_id='rec_m' AND competencia=?"
 ).bind(competence).first();
 assert.deepEqual(after,before);
 assert.equal(before.vencimento,competence+"-07");
 // Em São Paulo, 02:59 UTC ainda é o dia civil anterior. O campo DATE
 // preserva seu texto de origem e nunca sofre parse ISO UTC implícito.
 const saoPaulo=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",
  year:"numeric",month:"2-digit",day:"2-digit"});
 assert.notEqual(saoPaulo.format(new Date("2026-11-08T02:59:00Z")),
  saoPaulo.format(new Date("2026-11-08T03:01:00Z")));
});


// R7 E3: provas HTTP em Workerd/D1/R2 locais, tokens RS256 de fixture.
test("E3 logout revoga somente JWT assinado exato, preserva outras sessoes",async()=>{
 const now=Math.floor(Date.now()/1000);
 const signed=jwt({sub:"operator-sub",iat:now-10,exp:now+180,jti:"e3-logout-one"});
 const before=await http("/r7/companies/e1/titles","GET",null,
   {"cf-access-jwt-assertion":signed});
 assert.equal(before.status,200);
 const done=await http("/r7/companies/e1/access/logout","POST",
   {intentId:"e3-logout-one"},{"cf-access-jwt-assertion":signed});
 assert.equal(done.status,201,await done.text());
 const after=await http("/r7/companies/e1/titles","GET",null,
   {"cf-access-jwt-assertion":signed});
 assert.equal(after.status,401);
 assert.equal((await after.json()).error,"session_revoked");
 const other=await http("/r7/companies/e1/titles","GET",null,
   {"cf-access-jwt-assertion":jwt({sub:"operator-sub",jti:"e3-other-session"})});
 assert.equal(other.status,200);
 const digest=createHash("sha256").update(signed).digest("hex");
 const stored=await db.prepare("SELECT token_sha256,access_subject FROM r7_sessoes_revogadas "+
   "WHERE token_sha256=?").bind(digest).first();
 assert.equal(stored.access_subject,"operator-sub");
 assert.ok(!JSON.stringify(stored).includes(signed));
});
test("E3 Access com iat ausente e origem de empresa inativa falham fechados",async()=>{
 const missing=await http("/r7/companies/e1/titles","GET",null,
   {"cf-access-jwt-assertion":jwt({iat:null,jti:"e3-iat-missing"})});
 assert.equal(missing.status,401);
 await db.prepare("UPDATE empresas SET ativo=0 WHERE id='e2'").run();
 const req=await http("/r7/companies/e2/titles","GET",null,
   {"cf-access-jwt-assertion":jwt({sub:"operator-sub",jti:"e3-company-inactive"})});
 assert.equal(req.status,403);
 await db.prepare("UPDATE empresas SET ativo=1 WHERE id='e2'").run();
});
test("E3 ACL de leitura em titulo filtra listagem e nao oculta os demais",async()=>{
 const admin=jwt({sub:"admin-sub",jti:"e3-read-admin"});
 const request={intentId:"e3-deny-title-read",targetUserId:"user1",
   tipoEntidade:"TITULO_PAGAR",entidadeId:"tpay",acao:"READ",
   motivo:"Acesso financeiro restrito por entidade"};
 const result=await http("/r7/companies/e1/access/block-entity","POST",
   request,{"cf-access-jwt-assertion":admin});
 assert.equal(result.status,201,await result.text());
 const reader=await http("/r7/companies/e1/titles");
 assert.equal(reader.status,200);
 const ids=(await reader.json()).titulos.map(t=>t.id);
 assert.ok(!ids.includes("tpay"));
 assert.ok(ids.includes("t1"));
 // Mesmo intentId retorna replay; outro intentId com duplicata nao cria journal.
 const replay=await http("/r7/companies/e1/access/block-entity","POST",
   request,{"cf-access-jwt-assertion":admin});
 assert.equal(replay.status,201);
 assert.equal((await replay.json()).replayed,true);
 const audit=await db.prepare("SELECT count(*) AS n FROM eventos_auditoria "+
   "WHERE tipo_entidade='TITULO_PAGAR' AND entidade_id_texto='tpay' "+
   "AND acao='RESTRINGIR_READ'").first();
 assert.equal(audit.n,1);
});
test("E3 ACL herdada pelo documento protege bytes R2 e versoes historicas",async()=>{
 await db.prepare("INSERT INTO licitacoes(id,empresa_id,orgao_id,numero) "+
   "VALUES('lE3','e1','o1','E3-001')").run();
 const file=new TextEncoder().encode("%PDF-1.7 fixture E3");
 const create=await http("/r7/companies/e1/documents","POST",{
   intentId:"e3-document-create",ownerType:"licitacao",ownerId:"lE3",
   papel:"EDITAL",documentType:"EDITAL",nomeOriginal:"e3-edital.pdf",
   mimeType:"application/pdf",conteudoBase64:Buffer.from(file).toString("base64")
 });
 assert.equal(create.status,201,await create.clone().text());
 const doc=(await create.json()).documentoId;
 const admin=jwt({sub:"admin-sub",jti:"e3-admin-document"});
 const block=await http("/r7/companies/e1/access/block-entity","POST",{
  intentId:"e3-deny-doc-owner",targetUserId:"user1",
  tipoEntidade:"LICITACAO",entidadeId:"lE3",acao:"ALL",
  motivo:"Processo com acesso restrito por sigilo"
 },{"cf-access-jwt-assertion":admin});
 assert.equal(block.status,201,await block.text());
 const denied=await http("/r7/companies/e1/documents/"+doc);
 assert.equal(denied.status,404);
 const forbiddenWrite=await http("/r7/companies/e1/documents","POST",{
   intentId:"e3-document-denied",ownerType:"licitacao",ownerId:"lE3",
   papel:"PROPOSTA",documentType:"PROPOSTA",nomeOriginal:"e3-proposta.pdf",
   mimeType:"application/pdf",conteudoBase64:Buffer.from(file).toString("base64")
 });
 assert.equal(forbiddenWrite.status,404);
 const adminDownload=await http("/r7/companies/e1/documents/"+doc,"GET",null,
   {"cf-access-jwt-assertion":admin});
 assert.equal(adminDownload.status,200);
 assert.deepEqual(new Uint8Array(await adminDownload.arrayBuffer()),file);
});
test("E3 revogacao de membership e CAS impedem uso de JWT ainda valido",async()=>{
 const admin=jwt({sub:"admin-sub",jti:"e3-revoke-admin"});
 const consult=jwt({sub:"consult-sub",jti:"e3-consult-before-revoke"});
 const before=await http("/r7/companies/e1/titles","GET",null,
   {"cf-access-jwt-assertion":consult});
 assert.equal(before.status,200);
 const request={intentId:"e3-revoke-consult",targetUserId:"user2",
  expectedVersion:1,motivo:"Acesso da equipe removido por ADMIN"};
 const revoke=await http("/r7/companies/e1/access/revoke-member","POST",
  request,{"cf-access-jwt-assertion":admin});
 assert.equal(revoke.status,201,await revoke.text());
 const after=await http("/r7/companies/e1/titles","GET",null,
   {"cf-access-jwt-assertion":consult});
 assert.equal(after.status,403);
 const replay=await http("/r7/companies/e1/access/revoke-member","POST",
  request,{"cf-access-jwt-assertion":admin});
 assert.equal(replay.status,201); // rota de admin retorna 201 para replay, sem novo efeito
 const stale=await http("/r7/companies/e1/access/revoke-member","POST",
  {...request,intentId:"e3-revoke-stale"},{"cf-access-jwt-assertion":admin});
 assert.equal(stale.status,409);
 assert.equal((await db.prepare("SELECT versao FROM usuarios_empresas "+
  "WHERE usuario_id='user2' AND empresa_id='e1'").first()).versao,2);
 const audit=await db.prepare("SELECT resumo FROM eventos_auditoria "+
  "WHERE tipo_entidade='USUARIO_EMPRESA' AND entidade_id_texto='user2' "+
  "AND acao='REVOGAR_MEMBRO'").first();
 assert.equal(audit.resumo,request.motivo);
});
test("E3 duas revogacoes simultaneas por version CAS geram um unico efeito",async()=>{
 await db.prepare("INSERT INTO usuarios(id,access_issuer,access_subject,email_normalizado) "+
   "VALUES('e3_race_user',?,?,?)").bind(issuer,"e3-race-sub","race@local.invalid").run();
 await db.prepare("INSERT INTO usuarios_empresas(usuario_id,empresa_id,papel,ativo) "+
   "VALUES('e3_race_user','e1','OPERADOR',1)").run();
 const admin=jwt({sub:"admin-sub",jti:"e3-race-admin"});
 const make=intentId=>http("/r7/companies/e1/access/revoke-member","POST",{
  intentId,targetUserId:"e3_race_user",expectedVersion:1,
  motivo:"Revisao concorrente de vinculo e permissoes"
 },{"cf-access-jwt-assertion":admin});
 const responses=await Promise.all([make("e3-race-one"),make("e3-race-two")]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 const row=await db.prepare("SELECT ativo,versao FROM usuarios_empresas "+
   "WHERE usuario_id='e3_race_user' AND empresa_id='e1'").first();
 assert.deepEqual([row.ativo,row.versao],[0,2]);
 const journal=await db.prepare("SELECT count(*) AS n FROM operacoes "+
   "WHERE tipo='R7_REVOGAR_MEMBRO' AND id IN ('e3-race-one','e3-race-two')").first();
 assert.equal(journal.n,1);
 const audit=await db.prepare("SELECT count(*) AS n FROM eventos_auditoria "+
  "WHERE tipo_entidade='USUARIO_EMPRESA' AND entidade_id_texto='e3_race_user' "+
  "AND acao='REVOGAR_MEMBRO'").first();
 assert.equal(audit.n,1);
});

test("E3 bloqueio de versao documental afeta leitura atual e historica",async()=>{
 await db.prepare("INSERT INTO licitacoes(id,empresa_id,orgao_id,numero) "+
   "VALUES('lE3Version','e1','o1','E3-002')").run();
 const source=new TextEncoder().encode("%PDF-1.7 e3 versao bloqueada");
 const creation=await http("/r7/companies/e1/documents","POST",{
  intentId:"e3-document-version",ownerType:"licitacao",ownerId:"lE3Version",
  papel:"EDITAL",documentType:"EDITAL",nomeOriginal:"version-e3.pdf",
  mimeType:"application/pdf",conteudoBase64:Buffer.from(source).toString("base64")
 });
 assert.equal(creation.status,201,await creation.clone().text());
 const info=await creation.json();
 const admin=jwt({sub:"admin-sub",jti:"e3-version-admin"});
 const block=await http("/r7/companies/e1/access/block-entity","POST",{
  intentId:"e3-restrict-version",targetUserId:"user1",
  tipoEntidade:"DOCUMENTO_VERSAO",entidadeId:info.versaoId,acao:"READ",
  motivo:"Versao historica restrita ao administrador"
 },{"cf-access-jwt-assertion":admin});
 assert.equal(block.status,201,await block.text());
 const now=await http("/r7/companies/e1/documents/"+info.documentoId);
 assert.equal(now.status,404);
 const past=await http("/r7/companies/e1/documents/"+info.documentoId+
    "/versions/"+info.versaoId);
 assert.equal(past.status,404);
 const allowed=await http("/r7/companies/e1/documents/"+info.documentoId,
   "GET",null,{"cf-access-jwt-assertion":admin});
 assert.equal(allowed.status,200);
 assert.deepEqual(new Uint8Array(await allowed.arrayBuffer()),source);
});

test("E3 escopo cobre IDs de itens comerciais aninhados antes de gravar efeitos",async()=>{
 const admin=jwt({sub:"admin-sub",jti:"e3-nested-admin"});
 const blocked=await http("/r7/companies/e1/access/block-entity","POST",{
  intentId:"e3-block-nested",targetUserId:"user1",
  tipoEntidade:"EMPENHO_ITEM",entidadeId:"ei1",acao:"WRITE",
  motivo:"Item protegido contra compras por usuario"
 },{"cf-access-jwt-assertion":admin});
 assert.equal(blocked.status,201,await blocked.text());
 const res=await http("/r7/companies/e1/commercial/purchase","POST",{
  intentId:"e3-nested-denied",parentId:"ep1",expectedParentVersion:1,
  fornecedorId:"f1",numero:"E3-COMPRA-NEGADA",
  items:[{parentItemId:"ei1",quantidadeMil:1000,valorUnitCent:1000}]
 });
 assert.equal(res.status,404);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM operacoes "+
  "WHERE id='e3-nested-denied'").first()).n,0);
});


// E4. Provas em Workerd/D1/R2 local: nenhuma conta Drive ou backup real.
function e4MockAdapters({failRestoreOnce=false,missingBackup=false}={}){
 const driveMap=new Map(),backupMap=new Map();
 let restoreFails=failRestoreOnce,puts={drive:0,backup:0};
 const drive={providerId:"google-drive",failureDomain:"google-drive",isIdempotent:true,
  async findByKey(key){return driveMap.has(key)?"e4drive_"+key:null;},
  async put(key,data){
   if(!driveMap.has(key)){driveMap.set(key,Uint8Array.from(data));puts.drive++;}
   return "e4drive_"+key;
  },
  async get(id){return driveMap.get(id.slice(8))?.slice();}
 };
 const backup={providerId:"independent-https",failureDomain:"separate-account",isIdempotent:true,
  async findByKey(key){return backupMap.has(key)?key:null;},
  async put(key,data){
   if(!missingBackup&&!backupMap.has(key)){
    backupMap.set(key,Uint8Array.from(data));puts.backup++;
   }
   return key;
  },
  async restore(key){
   if(restoreFails){restoreFails=false;throw Error("timeout depois do put externo");}
   return backupMap.get(key)?.slice();
  }
 };
 return {drive,backup,r2:null,driveMap,backupMap,puts};
}
async function e4Fixture(intent,owner="licArqE2"){
 const up=await http("/r7/companies/e1/documents","POST",{
  intentId:intent+"-source",ownerType:"licitacao",ownerId:owner,
  papel:owner==="licArqE2"?"PROPOSTA":"EDITAL",
  documentType:"ARQUIVO_DOCUMENTO",nomeOriginal:"fixture-e4.pdf",
  mimeType:"application/pdf",
  conteudoBase64:Buffer.from("PDF SINTETICO E4 "+intent).toString("base64")
 });
 assert.equal(up.status,201,await up.clone().text());
 return up.json();
}
test("E4 copia administrativa antes dos 24 meses falha sem criar ledger",async()=>{
 const doc=await e4Fixture("e4-gate");
 const adapters=e4MockAdapters();adapters.r2=await mf.getR2Bucket("R2");
 const principal={issuer,subject:"admin-sub"};
 await assert.rejects(()=>beginArchiveCopy(db,principal,"e1",{
  intentId:"e4-too-early",documentoId:doc.documentoId,
  documentoVersaoId:doc.versaoId
 },adapters),e=>e.code==="archive_not_due_or_financial_hold");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM r7_e4_tentativas_copia "+
  "WHERE id='e4-too-early'").first()).n,0);
 assert.equal(adapters.puts.drive,0);assert.equal(adapters.puts.backup,0);
});
test("E4 integra copia idempotente Drive/backup verificados, trilha e nenhum delete R2",async()=>{
 const doc=await db.prepare("SELECT d.id,v.id AS versao_id FROM documentos d "+
  "JOIN documento_versoes v ON v.documento_id=d.id "+
  "WHERE d.titulo='fixture-e4.pdf' ORDER BY v.id LIMIT 1").first();
 assert.ok(doc);
 const adapters=e4MockAdapters();adapters.r2=await mf.getR2Bucket("R2");
 const principal={issuer,subject:"admin-sub"};
 const out=await beginArchiveCopy(db,principal,"e1",{
   intentId:"e4-transfer-ok",documentoId:doc.id,documentoVersaoId:doc.versao_id
 },adapters,{now:new Date("2031-01-01T12:00:00Z")});
 assert.equal(out.estado,"VERIFICADA");
 assert.equal(out.r2DeletionAuthorized,false);
 assert.equal(adapters.puts.drive,1);
 assert.equal(adapters.puts.backup,1);
 const status=await inspectArchiveAttempt(db,principal,"e1","e4-transfer-ok");
 assert.equal(status.estado,"VERIFICADA");
 await assert.rejects(()=>beginArchiveCopy(db,principal,"e1",{
   intentId:"e4-transfer-duplicate",documentoId:doc.id,documentoVersaoId:doc.versao_id
 },adapters,{now:new Date("2031-01-01T12:00:00Z")}),
 e=>e.code==="archive_attempt_already_reserved");
 assert.equal(adapters.puts.drive,1);
 const key=(await db.prepare("SELECT chave_r2 FROM documento_localizacoes "+
  "WHERE versao_id=? AND provedor='R2'").bind(doc.versao_id).first()).chave_r2;
 assert.ok(await adapters.r2.get(key));
 assert.equal((await db.prepare("SELECT status FROM documento_localizacoes "+
  "WHERE chave_r2=?").bind(key).first()).status,"VERIFICADO");
});
test("E4 falha de restore deixa INCERTA e retomada exige ADMIN e prova de ambos",async()=>{
 await db.prepare("INSERT INTO licitacoes(id,empresa_id,orgao_id,numero) "+
  "VALUES ('e4NewLic','e1','o1','E4-RECON')").run();
 // Criar anexo e fechar o processo pelo comando comercial com versao 1.
 const doc=await e4Fixture("e4-uncertain","e4NewLic");
 const closed=await http("/r7/companies/e1/commercial/close","POST",{
  intentId:"e4-close-lic",licitacaoId:"e4NewLic",expectedVersion:1,
  motivo:"Encerramento de fixture para teste de retencao E4"
 });
 assert.equal(closed.status,201,await closed.clone().text());
 const adapters=e4MockAdapters({failRestoreOnce:true});
 adapters.r2=await mf.getR2Bucket("R2");
 const principal={issuer,subject:"admin-sub"};
 await assert.rejects(()=>beginArchiveCopy(db,principal,"e1",{
  intentId:"e4-uncertain",documentoId:doc.documentoId,documentoVersaoId:doc.versaoId
 },adapters,{now:new Date("2031-01-01T12:00:00Z")}),
 e=>e.code==="archive_copy_uncertain_manual_reconciliation_required");
 const attempt=await inspectArchiveAttempt(db,principal,"e1","e4-uncertain");
 assert.equal(attempt.estado,"INCERTA");
 assert.equal((await db.prepare("SELECT count(*) AS n FROM documento_transferencias "+
  "WHERE idempotencia='e4-uncertain'").first()).n,0);
 await assert.rejects(()=>reconcileArchiveAttempt(db,
  {issuer,subject:"operator-sub"},"e1",{intentId:"e4-uncertain",
   motivo:"Verificacao manual de copia incerta"},adapters,
   {now:new Date("2031-01-01T12:00:00Z")}),e=>e.status===403);
 const after=await reconcileArchiveAttempt(db,principal,"e1",{
  intentId:"e4-uncertain",motivo:"Prova de restore duplo em conta isolada"
 },adapters,{now:new Date("2031-01-01T12:00:00Z")});
 assert.equal(after.estado,"VERIFICADA");
 assert.equal(adapters.puts.drive,1);assert.equal(adapters.puts.backup,1);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM documento_transferencias "+
  "WHERE idempotencia='e4-uncertain'").first()).n,1);
 assert.ok(await adapters.r2.get("e1/"+doc.documentoId+"/"+doc.versaoId));
});
test("E4 falha externa parcial nao e reexecutada automaticamente",async()=>{
 await db.prepare("INSERT INTO licitacoes(id,empresa_id,orgao_id,numero) "+
  "VALUES ('e4PartialLic','e1','o1','E4-PARTIAL')").run();
 const doc=await e4Fixture("e4-partial","e4PartialLic");
 const closed=await http("/r7/companies/e1/commercial/close","POST",{
  intentId:"e4-partial-close",licitacaoId:"e4PartialLic",expectedVersion:1,
  motivo:"Ciclo encerrado para falha documental parcial"
 });
 assert.equal(closed.status,201);
 const adapters=e4MockAdapters({missingBackup:true});
 adapters.r2=await mf.getR2Bucket("R2");
 const principal={issuer,subject:"admin-sub"};
 await assert.rejects(()=>beginArchiveCopy(db,principal,"e1",{
  intentId:"e4-partial",documentoId:doc.documentoId,documentoVersaoId:doc.versaoId
 },adapters,{now:new Date("2031-01-01T12:00:00Z")}),
 e=>e.code==="archive_copy_uncertain_manual_reconciliation_required");
 await assert.rejects(()=>reconcileArchiveAttempt(db,principal,"e1",{
   intentId:"e4-partial",motivo:"Revisao supervisionada de backend"
 },adapters,{now:new Date("2031-01-01T12:00:00Z")}),
 e=>e.code==="archive_partial_copy_requires_operator_review");
 assert.equal((await db.prepare("SELECT estado FROM r7_e4_tentativas_copia "+
   "WHERE id='e4-partial'").first()).estado,"INCERTA");
 assert.equal(adapters.puts.drive,1);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM documento_transferencias "+
   "WHERE idempotencia='e4-partial'").first()).n,0);
});


test("E4 HTTP upload binario R2 via stream preserva SHA, tamanho e acesso",async()=>{
 const lic="licStreamE4";
 await db.prepare("INSERT INTO licitacoes(id,empresa_id,orgao_id,numero) "+
  "VALUES (?,'e1','o1','STREAM-E4')").bind(lic).run();
 const bytes=new Uint8Array(300000);
 for(let i=0;i<bytes.length;i++)bytes[i]=(i*37)%256;
 const sha=createHash("sha256").update(bytes).digest("hex");
 const res=await mf.dispatchFetch(origin+"/r7/companies/e1/documents/stream",{
  method:"POST",
  headers:{"cf-access-jwt-assertion":jwt(),
   "origin":origin,"content-type":"application/pdf",
   "content-length":String(bytes.length),
   "x-content-sha256":sha,
   "x-doc-intent":"e4-stream-okay",
   "x-doc-owner-type":"licitacao",
   "x-doc-owner-id":lic,
   "x-doc-role":"EDITAL",
   "x-doc-type":"ARQUIVO_STREAM",
   "x-doc-name":"edital-grande.pdf"
  },
  body:bytes
 });
 assert.equal(res.status,201,await res.clone().text());
 const created=await res.json();
 assert.equal(created.sha256,sha);
 assert.equal(created.tamanhoBytes,bytes.length);
 const read=await http("/r7/companies/e1/documents/"+created.documentoId);
 assert.equal(read.status,200,await read.clone().text());
 const got=new Uint8Array(await read.arrayBuffer());
 assert.deepEqual(got,bytes);
 assert.equal(read.headers.get("x-content-sha256"),sha);
 const r2=await mf.getR2Bucket("R2");
 assert.equal((await r2.get("e1/"+created.documentoId+"/"+created.versaoId)).size,bytes.length);
 const journal=await db.prepare("SELECT estado FROM operacoes "+
  "WHERE id='e4-stream-okay'").first();
 assert.equal(journal.estado,"CONCLUIDA");
});
test("E4 upload streaming rejeita tamanho ausente, hash incorreto e tenant forjado",async()=>{
 const lic="licStreamE4";
 const bytes=new TextEncoder().encode("arquivo sintetico");
 const base={"cf-access-jwt-assertion":jwt(),"origin":origin,
  "content-type":"application/pdf","x-doc-owner-type":"licitacao",
  "x-doc-owner-id":lic,"x-doc-role":"PROPOSTA",
  "x-doc-type":"ARQUIVO_STREAM","x-doc-name":"proposta.pdf"};
 const request=(intent,headers)=>mf.dispatchFetch(origin+"/r7/companies/e1/documents/stream",{
  method:"POST",headers:{...base,"x-doc-intent":intent,...headers},body:bytes
 });
 const invalidHash=await request("e4-stream-hash",{
  "content-length":String(bytes.length),"x-content-sha256":"0".repeat(64)
 });
 assert.equal(invalidHash.status,409);
 const noSize=await request("e4-stream-missing-size",{
  "x-content-sha256":createHash("sha256").update(bytes).digest("hex")
 });
 assert.equal(noSize.status,413);
 const other=await request("e4-stream-fake-company",{
  "content-length":String(bytes.length),
  "x-content-sha256":createHash("sha256").update(bytes).digest("hex"),
  "x-doc-owner-id":"l2"
 });
 assert.ok([403,404,409].includes(other.status));
 for(const id of ["e4-stream-hash","e4-stream-missing-size","e4-stream-fake-company"]){
  assert.equal((await db.prepare("SELECT count(*) AS n FROM operacoes WHERE id=?").bind(id).first()).n,0);
 }
});
test("E4 rotas archive nao acessam rede sem adaptadores injetados",async()=>{
 const r=await http("/r7/companies/e1/documents/archive-copy","POST",{
   intentId:"e4-no-provider",documentoId:"dHist",documentoVersaoId:"vHist1"
 },{"cf-access-jwt-assertion":jwt({sub:"admin-sub"})});
 assert.equal(r.status,503);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM r7_e4_tentativas_copia "+
  "WHERE id='e4-no-provider'").first()).n,0);
});
