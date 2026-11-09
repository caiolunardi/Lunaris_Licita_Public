// R7 / OPR02: gate puro de outbox. Não envia e-mails.
// Estado INCERTO deve ser conciliado manualmente com provedor, nunca reenviado.
export function assessEmailDispatch({
  existing=null, quotaAvailable=false, recipientValid=false,
  companyAuthorized=false
}={}){
 const deny=(reason)=>Object.freeze({canReserve:false,canSend:false,reason});
 if(!companyAuthorized)return deny("company_not_authorized");
 if(!recipientValid)return deny("recipient_invalid");
 if(!quotaAvailable)return deny("quota_unavailable");
 if(existing){
  const state=existing.estado;
  if(state==="INCERTO")return deny("uncertain_delivery_manual_reconciliation");
  if(["RESERVADO","ENVIADO","SEM_COTA","BLOQUEADO_DADOS","FALHA"].includes(state)){
   return deny("existing_outbox_record");
  }
  return deny("unknown_state_fail_closed");
 }
 return Object.freeze({
  canReserve:true,canSend:false,reason:"reserve_then_send_outside_transaction"
 });
}
