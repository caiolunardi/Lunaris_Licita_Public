import test from "node:test";
import assert from "node:assert/strict";
import {assessEmailDispatch} from "../src/r7/notifications.mjs";
const base={recipientValid:true,quotaAvailable:true,companyAuthorized:true};
test("OPR02 nenhuma confirmação incerta pode ser reenviada automaticamente",()=>{
 const r=assessEmailDispatch({...base,existing:{estado:"INCERTO"}});
 assert.equal(r.canSend,false);
 assert.equal(r.canReserve,false);
 assert.equal(r.reason,"uncertain_delivery_manual_reconciliation");
});
test("OPR02 enviado/reservado repetido não cria duplicata",()=>{
 for(const estado of ["ENVIADO","RESERVADO","FALHA","SEM_COTA"]){
  const r=assessEmailDispatch({...base,existing:{estado}});
  assert.equal(r.canReserve,false);
 }
});
test("OPR02 registro novo pode reservar mas não disparar envio diretamente",()=>{
 const r=assessEmailDispatch(base);
 assert.equal(r.canReserve,true);
 assert.equal(r.canSend,false);
});
test("OPR02 falta de quota ou empresa bloqueia a fila",()=>{
 assert.equal(assessEmailDispatch({...base,companyAuthorized:false}).canReserve,false);
 assert.equal(assessEmailDispatch({...base,quotaAvailable:false}).canReserve,false);
});
