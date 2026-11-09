import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { recordPayment, undoPayment, reverseCredit } from "../src/r7/payments.mjs";
import { DomainError } from "../src/r7/domain.mjs";
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const principal={issuer:"https://local.cloudflareaccess.com",subject:"sub"};
function mock({role="OPERADOR",member=true,previous=null,batchResult=null,fail=false}={}){
 const sql=[];let batches=0;
 return {
   sql,
   prepare(query){const item={query,args:[]};sql.push(item);
     return {bind(...args){item.args=args;return {first:async()=>{
       if(query.includes("JOIN usuarios_empresas"))return member?{usuario_id:"user1",papel:role}:null;
       if(query.includes("FROM operacoes WHERE"))return previous;
       return null;
     }};}};
   },
   async batch(queries){batches++;if(fail)throw Error("rollback");
     return batchResult||queries.map(()=>({meta:{changes:1}}));
   },
   get batches(){return batches;}
 };
}
const pay=(over={})=>({
 intentId:"pay-1",tituloId:"t1",expectedVersion:1,
 dataPagamento:"2026-11-07",valorPagoCent:1200,...over
});
const undo=(over={})=>({
 intentId:"undo-1",tituloId:"t1",expectedVersion:2,
 baixaOriginalId:"baixa-1",motivo:"Duplicado",...over
});
const rev=(over={})=>({
 intentId:"rev-1",recebimentoOriginalId:"receipt-1",motivo:"Extrato",...over
});
test("FIN06 quitacao requer perfil de escrita",async()=>{
 const db=mock({role:"CONSULTA"});
 await assert.rejects(()=>recordPayment(db,principal,"e1",pay()),e=>e.status===403);
 assert.equal(db.batches,0);
});
test("FIN06 pagamento efetivo diferente do nominal nao compara com titulo",async()=>{
 const db=mock();
 const r=await recordPayment(db,principal,"e1",pay({valorPagoCent:2000}));
 assert.equal(r.replayed,false);
 assert.equal(db.batches,1);
 assert.equal(db.sql.filter(x=>x.query.startsWith("INSERT INTO titulo_baixas")).length,1);
 assert.match(db.sql.map(x=>x.query).join("\n"),/t\.versao=\?/);
 assert.match(db.sql.map(x=>x.query).join("\n"),/NOT EXISTS.*FROM titulo_baixas/);
});
test("FIN06 quitacao sem data civil ou valor invalido recusa",async()=>{
 const cases=[pay({dataPagamento:"2026-02-30"}),pay({valorPagoCent:0}),
              pay({valorPagoCent:-1}),pay({expectedVersion:0})];
 for(const data of cases) {
   const db=mock();
   await assert.rejects(()=>recordPayment(db,principal,"e1",data));
   assert.equal(db.batches,0);
 }
});
test("FIN08 dados privilegiados no body nao entram no SQL",async()=>{
 const db=mock();
 await assert.rejects(()=>recordPayment(db,principal,"e1",pay({empresa_id:"e2"})));
 await assert.rejects(()=>undoPayment(db,principal,"e1",undo({ator_id:"admin"})));
 assert.equal(db.batches,0);
});
test("FIN06 idempotencia com mesma intent e hash conflitante e rejeitada",async()=>{
 const db=mock({previous:{tipo:"QUITACAO_TITULO",hash_pedido:"outro",estado:"CONCLUIDA"}});
 await assert.rejects(()=>recordPayment(db,principal,"e1",pay()),e=>e.code==="idempotency_conflict");
 assert.equal(db.batches,0);
});
test("FIN06 banco devolvendo 0 nao vira pagamento realizado",async()=>{
 const db=mock({batchResult:Array.from({length:3},()=>({meta:{changes:0}}))});
 await assert.rejects(()=>recordPayment(db,principal,"e1",pay()),e=>e.code==="payment_not_allowed");
});
test("FIN06 desfazimento exige motivo e CAS",async()=>{
 const db=mock();const r=await undoPayment(db,principal,"e1",undo());
 assert.equal(r.newVersion,3);
 assert.equal(db.batches,1);
 const text=db.sql.map(x=>x.query).join("\n");
 assert.match(text,/DESFAZIMENTO/);assert.match(text,/t\.versao=\?/);
 assert.match(text,/baixa_original_id/);
});
test("FIN06 desfazimento sem justificativa e rejeitado",async()=>{
 const db=mock();
 await assert.rejects(()=>undoPayment(db,principal,"e1",undo({motivo:"   "})),
   e=>e.code==="reason_required");
 assert.equal(db.batches,0);
});
test("FIN03 estorno espelha data/valor/retenção da linha original",async()=>{
 const db=mock();const r=await reverseCredit(db,principal,"e1",rev());
 assert.equal(r.replayed,false);
 assert.equal(db.batches,1);
 const st=db.sql.find(x=>x.query.startsWith("INSERT INTO recebimentos"));
 assert.match(st.query,/orig\.data_credito,orig\.valor_recebido_cent,orig\.retencao_confirmada_cent/);
 assert.match(st.query,/orig\.tipo_movimento='RECEBIMENTO'/);
 assert.match(st.query,/NOT EXISTS\(SELECT 1 FROM recebimentos d/);
});
test("FIN04 body nao pode fornecer data ou valor para estorno",async()=>{
 const db=mock();
 await assert.rejects(()=>reverseCredit(db,principal,"e1",
   rev({dataCredito:"2026-11-08"})));
 assert.equal(db.batches,0);
});
test("FIN03 estorno repetido com linha 0 recusa sem sucesso",async()=>{
 const db=mock({batchResult:[{meta:{changes:0}},{meta:{changes:0}}]});
 await assert.rejects(()=>reverseCredit(db,principal,"e1",rev()),
   e=>e.code==="reversal_not_allowed");
});
test("FIN03 falha de D1 batch nao reporta sucesso financeiro",async()=>{
 const db=mock({fail:true});
 await assert.rejects(()=>reverseCredit(db,principal,"e1",rev()),
   e=>e.code==="reversal_conflict");
});
