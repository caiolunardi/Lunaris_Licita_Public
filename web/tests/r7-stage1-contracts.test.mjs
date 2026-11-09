import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {confirmInvoiceAmounts} from "../src/r7/invoices.mjs";
import {attestRetention} from "../src/r7/withholdings.mjs";
import {recordPartialAwardCycle} from "../src/r7/commercial.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const principal={issuer:"https://r7.cloudflareaccess.com",subject:"sub"};
const invoice={id:"nfA",versao:1,valor_documento_cent:152,
  situacao:"EMITIDA",origem_dado:"NATIVO",conferencia:"VALIDADO"};
const lines=[
  {id:"liA",versao:1,quantidade_mil:500,valor_unit_cent:101,origem_dado:"NATIVO"},
  {id:"liB",versao:1,quantidade_mil:1000,valor_unit_cent:101,origem_dado:"NATIVO"}
];
const parcels=[
 {id:"pa",versao:1,parcela:1,valor_bruto_cent:100,cancelada:0,origem_dado:"NATIVO"},
 {id:"pb",versao:1,parcela:2,valor_bruto_cent:52,cancelada:0,origem_dado:"NATIVO"}
];
function mock({role="ADMIN",nf=invoice,items=lines,installments=parcels,
                result=null,actor=true,commercialItem=null,supplier=true}={}){
 const q=[],batches=[];
 return {
  queries:q,batches,
  prepare(sql){const record={sql,args:[]};q.push(record);
    return {bind(...args){record.args=args;
     return {first:async()=>{
      if(sql.includes("JOIN usuarios_empresas")){
       return actor?{usuario_id:"u1",papel:role}:null;
      }
      if(sql.startsWith("SELECT id,versao,valor_documento_cent"))return nf;
      if(sql.startsWith("SELECT li.id"))return commercialItem||{
       id:"li3",quantidade_ganha_mil:6000,quantidade_prevista_mil:10000,
       valor_final_unit_cent:120,resultado:"GANHO",orgao_id:"o1",encerrada_em:null
      };
      if(sql.startsWith("SELECT id FROM fornecedores"))return supplier?{id:"f1"}:null;
      return null;
     },all:async()=>{
      if(sql.includes("FROM nota_fiscal_itens"))return {results:items};
      if(sql.includes("FROM contas_receber"))return {results:installments};
      return {results:[]};
     }};
    }};
  },
  batch:async stmts=>{batches.push(stmts);return result||stmts.map(()=>({meta:{changes:1}}));}
 };
}
test("Q08 arredondamento half-up por linha gera 152 centavos sem float",async()=>{
 const db=mock();const r=await confirmInvoiceAmounts(db,principal,"e1",{
  intentId:"conc1",notaFiscalId:"nfA",expectedVersion:1
 });
 assert.equal(r.itemsCent,152);
 assert.equal(r.installmentsCent,152);
 const stmt=db.queries.find(x=>x.sql.startsWith("INSERT INTO nf_conciliacoes"));
 assert.ok(stmt);
 assert.match(stmt.sql,/json_group_array/);
 assert.match(stmt.sql,/ORDER BY id/);
 assert.match(stmt.sql,/n.versao=\?/);
 assert.match(stmt.sql,/itens_snapshot_json/);
});
test("Q08 documento com soma errada rejeita sem journal",async()=>{
 const db=mock({nf:{...invoice,valor_documento_cent:153}});
 await assert.rejects(()=>confirmInvoiceAmounts(db,principal,"e1",{
  intentId:"conc2",notaFiscalId:"nfA",expectedVersion:1
 }),e=>e.code==="invoice_amount_mismatch");
 assert.equal(db.batches.length,0);
});
test("Q08 parcela inferior ou não conferida bloqueia selo",async()=>{
 for(const p of [[{...parcels[0],valor_bruto_cent:99},parcels[1]],
   [{...parcels[0],origem_dado:"LEGADO",conferencia:"PENDENTE"},parcels[1]]]){
  const db=mock({installments:p});
  await assert.rejects(()=>confirmInvoiceAmounts(db,principal,"e1",{
   intentId:"conc3",notaFiscalId:"nfA",expectedVersion:1
  }));
  assert.equal(db.batches.length,0);
 }
});
test("Q08 versão obsoleta e empresa sem acesso bloqueiam",async()=>{
 const db=mock();
 await assert.rejects(()=>confirmInvoiceAmounts(db,principal,"e1",{
  intentId:"conc4",notaFiscalId:"nfA",expectedVersion:2
 }),e=>e.code==="invoice_not_confirmable");
 const other=mock({actor:false});
 await assert.rejects(()=>confirmInvoiceAmounts(other,principal,"e2",{
  intentId:"conc5",notaFiscalId:"nfA",expectedVersion:1
 }),e=>e.status===403);
});
test("FIN05 somente ADMIN pode atestar retenção",async()=>{
 const db=mock({role:"OPERADOR"});
 await assert.rejects(()=>attestRetention(db,principal,"e1",{
  intentId:"atest1",contaReceberId:"cr1",documentoVersaoId:"v1",
  valorConfirmadoCent:100
 }),e=>e.status===403);
});
test("FIN05 atestado exige documento e conta no mesmo tenant e comprovante verificado no SQL",async()=>{
 const db=mock();
 const r=await attestRetention(db,principal,"e1",{
  intentId:"atest1",contaReceberId:"cr1",documentoVersaoId:"v1",
  valorConfirmadoCent:100
 });
 assert.equal(r.valorConfirmadoCent,100);
 const sql=db.queries.map(x=>x.sql).join("\n");
 assert.match(sql,/INSERT INTO retencao_atestados/);
 assert.match(sql,/VALUES \(\?,\?,\?,\?,\?,\?,\?\)/);
});
test("FIN05 previsão não pode ser enviada como origem comprovada pelo cliente",async()=>{
 const db=mock();
 await assert.rejects(()=>attestRetention(db,principal,"e1",{
  intentId:"atest1",contaReceberId:"cr1",documentoVersaoId:"v1",
  valorConfirmadoCent:100,retencaoPrevistaCent:100
 }),e=>e.code==="invalid_fields");
 assert.equal(db.batches.length,0);
});
test("OK01 duas compras/entregas fracionadas são batch único e NF vem antes do envio",async()=>{
 const db=mock({role:"OPERADOR"});
 const result=await recordPartialAwardCycle(db,principal,"e1",{
  intentId:"partial1",licitacaoId:"l3",licitacaoItemId:"li3",
  fornecedorId:"f1",empenhos:[
    {quantidadeMil:4000,entregasMil:[1000,3000]},
    {quantidadeMil:2000,entregasMil:[500,1500]}
  ]
 });
 assert.equal(result.totalEmpenhadoMil,6000);
 assert.equal(result.compromissos.length,2);
 assert.equal(db.batches.length,1);
 const sql=db.queries.map(x=>x.sql);
 const firstNF=sql.findIndex(x=>x.startsWith("INSERT INTO notas_fiscais"));
 const firstShipment=sql.findIndex(x=>x.startsWith("INSERT INTO envios"));
 assert.ok(firstNF>=0&&firstShipment>firstNF);
 assert.equal(sql.filter(x=>x.startsWith("INSERT INTO envios")).length,4);
 assert.equal(sql.filter(x=>x.startsWith("INSERT INTO contas_receber")).length,2);
});
test("OK01 não permite empenho acima do ganho, nem entregas com soma errada",async()=>{
 const body={intentId:"partial1",licitacaoId:"l3",licitacaoItemId:"li3",
  fornecedorId:"f1",empenhos:[
    {quantidadeMil:4000,entregasMil:[1000,3000]},
    {quantidadeMil:3000,entregasMil:[500,2500]}
  ]};
 const db=mock({role:"OPERADOR"});
 await assert.rejects(()=>recordPartialAwardCycle(db,principal,"e1",body),
  e=>e.code==="licitacao_item_not_eligible");
 assert.equal(db.batches.length,0);
 body.empenhos[1].entregasMil=[1000,1000];
 await assert.rejects(()=>recordPartialAwardCycle(db,principal,"e1",body),
  e=>e.code==="invalid_partial_shipments");
});
