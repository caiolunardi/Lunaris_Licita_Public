import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { materializeRecurrence } from "../src/r7/recurrence.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const principal={issuer:"https://r7.cloudflareaccess.com",subject:"sub"};
const clock=Date.parse("2026-11-07T15:00:00Z");
const data=(over={})=>({intentId:"monthly-intent-1",recorrenciaId:"rec1",
 competencia:"2026-11",expectedVersion:1,...over});
function harness({role="OPERADOR",rule={},blockCount=0,previous=null,result=null}={}){
 const entries=[];let calls=0;
 const defaultRule={
  id:"rec1",empresa_id:"e1",beneficiario:"Internet",categoria_despesa:"INTERNET",
  descricao_boleto:null,valor_atual_cent:18000,dia_vencimento:31,
  primeiro_vencimento:"2026-10-31",ultima_competencia:"2026-10",
  versao:1,estado:"ATIVA",...rule
 };
 const db={
  entries,
  prepare(sql){const item={sql,args:[]};entries.push(item);
   return {bind(...args){item.args=args;
    return {first:async()=>{
     if(sql.includes("JOIN usuarios_empresas"))return {usuario_id:"actor1",papel:role};
     if(sql.includes("SELECT tipo,hash_pedido,estado FROM operacoes"))return previous;
     if(sql.includes("SELECT COUNT(*) AS n FROM recorrencia_revisoes"))return {n:blockCount};
     if(sql.includes("FROM recorrencias WHERE empresa_id=?"))return defaultRule;
     return null;
    }};
   }};
  },
  async batch(statements){calls++;return result || statements.map(()=>({meta:{changes:1}}));},
  get calls(){return calls;}
 };
 return db;
}
test("REC01 geracao unica por competencia exige journal e CAS no banco",async()=>{
 const db=harness();const r=await materializeRecurrence(db,principal,"e1",data(),{nowMs:clock});
 assert.equal(r.competencia,"2026-11");
 assert.equal(r.vencimento,"2026-11-30");
 assert.equal(r.newVersion,2);
 assert.equal(db.calls,1);
 const sql=db.entries.map(x=>x.sql).join("\n");
 assert.match(sql,/INSERT INTO titulos_pagar/);
 assert.match(sql,/AND NOT EXISTS\(SELECT 1 FROM titulos_pagar/);
 assert.match(sql,/UPDATE recorrencias SET ultima_competencia/);
 assert.match(sql,/INSERT INTO operacoes/);
});
test("REC02 primeiro vencimento da regra nao e sobrescrito",async()=>{
 const db=harness({rule:{primeiro_vencimento:"2026-11-07",ultima_competencia:null}});
 const r=await materializeRecurrence(db,principal,"e1",data(),{nowMs:clock});
 assert.equal(r.vencimento,"2026-11-07");
});
test("REC01 mesmo pedido concluido e mesma hash vira replay",async()=>{
 const d=data(), first=harness();
 await materializeRecurrence(first,principal,"e1",d,{nowMs:clock});
 const hashStatement=first.entries.find(x=>x.sql.includes("SELECT tipo,hash_pedido,estado"));
 assert.ok(hashStatement);
 const cryptoHash=await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(JSON.stringify(["GERAR_COMPETENCIA",
  ["rec1","2026-11",1]])));
 const hash=Array.from(new Uint8Array(cryptoHash)).map(x=>x.toString(16).padStart(2,"0")).join("");
 const db=harness({previous:{tipo:"GERAR_COMPETENCIA",hash_pedido:hash,estado:"CONCLUIDA"}});
 const r=await materializeRecurrence(db,principal,"e1",d,{nowMs:clock});
 assert.equal(r.replayed,true);
 assert.equal(db.calls,0);
});
test("REC03 versao obsoleta nao materializa",async()=>{
 const db=harness({rule:{versao:2}});
 await assert.rejects(()=>materializeRecurrence(db,principal,"e1",data(),
      {nowMs:clock}),e=>e.code==="recurrence_not_active_or_stale");
 assert.equal(db.calls,0);
});
test("REC04 regra encerrada ou competencia final nao materializa",async()=>{
 for(const rule of [{estado:"ENCERRADA"},{ultima_competencia:"2026-11"}]){
  const db=harness({rule});
  await assert.rejects(()=>materializeRecurrence(db,principal,"e1",data(),
       {nowMs:clock}),e=>e.code==="recurrence_not_active_or_stale");
  assert.equal(db.calls,0);
 }
});
test("REC03 revisao conflitante impede uso de valor historico",async()=>{
 const db=harness({blockCount:1});
 await assert.rejects(()=>materializeRecurrence(db,principal,"e1",data(),
      {nowMs:clock}),e=>e.code==="recurrence_revisions_require_reconciliation");
 assert.equal(db.calls,0);
});
test("REC02 competencia passada nao gera retroativamente nem altera titulo",async()=>{
 const db=harness();
 await assert.rejects(()=>materializeRecurrence(db,principal,"e1",
       data({competencia:"2026-10"}),{nowMs:clock}),e=>e.code==="past_competence_disabled");
 assert.equal(db.calls,0);
});
test("REC01 quantidade zero em SQL nao finge sucesso",async()=>{
 const db=harness({result:[{meta:{changes:0}},{meta:{changes:0}},{meta:{changes:0}}]});
 await assert.rejects(()=>materializeRecurrence(db,principal,"e1",data(),
      {nowMs:clock}),e=>e.code==="recurrence_conflict");
});
test("REC05 regra nao cria boleto adicional e nao soma dupla",async()=>{
 const db=harness();
 await materializeRecurrence(db,principal,"e1",data(),{nowMs:clock});
 const insert=db.entries.find(x=>x.sql.startsWith("INSERT INTO titulos_pagar"));
 assert.ok(insert);
 assert.match(insert.sql,/r\.valor_atual_cent/);
 assert.doesNotMatch(insert.sql,/documento_vinculos|documento_versoes/);
});
test("ACC01 papel CONSULTA nao materializa vencimentos",async()=>{
 const db=harness({role:"CONSULTA"});
 await assert.rejects(()=>materializeRecurrence(db,principal,"e1",data(),
      {nowMs:clock}),e=>e.status===403);
 assert.equal(db.calls,0);
});
test("ACC02 origem e empresa fornecidas no body nao passam",async()=>{
 const db=harness();
 await assert.rejects(()=>materializeRecurrence(db,principal,"e1",
       data({origem_dado:"LEGADO"}),{nowMs:clock}),e=>e.code==="invalid_fields");
 assert.equal(db.calls,0);
});
