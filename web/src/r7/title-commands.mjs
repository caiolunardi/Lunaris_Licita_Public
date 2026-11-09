// R7 E2 / FIN06 FIN08: revisao e cancelamento de titulo com CAS + diario.
// Nenhum body fornece empresa_id, origem_dado, ator_id ou status.
// Alterar titulo recorrente exige revisao da regra na competencia, nao reescrita.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier,positiveInt,money,dateCivil,
  hashIntent,replayOrConflict,requireBatch} from "./domain.mjs";
const REVISION=new Set(["intentId","tituloId","expectedVersion",
  "novoValorCent","novoVencimento","motivo"]);
const CANCEL=new Set(["intentId","tituloId","expectedVersion","motivo"]);
function reason(s){
 if(typeof s!=="string"||s.trim()!==s||s.length<5||s.length>1500)
  throw new DomainError("title_reason_required");
 return s;
}
function okay(r){return Array.isArray(r)&&r.length===2&&r.every(x=>x?.meta?.changes===1);}
const NO_PAYMENTS=
 "NOT EXISTS(SELECT 1 FROM titulo_baixas b "+
 "WHERE b.titulo_id=titulos_pagar.id AND b.empresa_id=titulos_pagar.empresa_id "+
 "AND b.tipo='QUITACAO' AND NOT EXISTS(SELECT 1 FROM titulo_baixas u "+
 "WHERE u.baixa_original_id=b.id AND u.empresa_id=b.empresa_id "+
 "AND u.tipo='DESFAZIMENTO'))";
export async function reviseTitle(db,principal,companyId,body) {
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 strictlyObject(body,REVISION);
 const intent=identifier(body.intentId),title=identifier(body.tituloId),
   version=body.expectedVersion;
 if(!positiveInt(version))throw new DomainError("invalid_title_version");
 const reasonText=reason(body.motivo);
 const hasAmount=Object.hasOwn(body,"novoValorCent");
 const hasDue=Object.hasOwn(body,"novoVencimento");
 if((!hasAmount&&!hasDue)||
   (hasAmount&&(!money(body.novoValorCent)||!positiveInt(body.novoValorCent)))||
   (hasDue&&!dateCivil(body.novoVencimento))){
   throw new DomainError("invalid_title_revision");
 }
 const newAmount=hasAmount?body.novoValorCent:null,
  newDue=hasDue?body.novoVencimento:null;
 const hash=await hashIntent("REVISAR_TITULO",[title,version,newAmount,newDue,reasonText]);
 const previous=await replayOrConflict(db,companyId,intent,hash,"REVISAR_TITULO");
 if(previous)return previous;
 const current=await db.prepare("SELECT valor_nominal_cent,vencimento,recorrencia_id "+
   "FROM titulos_pagar WHERE id=? AND empresa_id=? AND versao=? "+
   "AND cancelado=0 AND origem_dado='NATIVO'"
 ).bind(title,companyId,version).first();
 if(!current||current.recorrencia_id!==null||
   (newAmount===null||newAmount===current.valor_nominal_cent)&&
   (newDue===null||newDue===current.vencimento)){
   throw new DomainError("title_revision_not_allowed",409);
 }
 const update=db.prepare(
  "UPDATE titulos_pagar SET valor_nominal_cent=COALESCE(?,valor_nominal_cent),"+
  "vencimento=COALESCE(?,vencimento),versao=versao+1,operacao_id=? "+
  "WHERE id=? AND empresa_id=? AND versao=? AND cancelado=0 "+
  "AND origem_dado='NATIVO' AND recorrencia_id IS NULL "+
  "AND "+NO_PAYMENTS+" AND NOT EXISTS(SELECT 1 FROM operacoes o WHERE o.id=?)"
 ).bind(newAmount,newDue,intent,title,companyId,version,intent);
 const journal=db.prepare(
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "plano_json,origem_dado,conferencia) "+
  "SELECT ?,?,'REVISAR_TITULO',?,?,'CONCLUIDA',?,'NATIVO','VALIDADO' "+
  "FROM titulos_pagar t WHERE t.id=? AND t.empresa_id=? "+
  "AND t.versao=? AND t.operacao_id=?"
 ).bind(intent,companyId,hash,actor.userId,
  JSON.stringify({motivo:reasonText,
   valorAnteriorCent:current.valor_nominal_cent,
   vencimentoAnterior:current.vencimento,
   novoValorCent:newAmount,novoVencimento:newDue}),
  title,companyId,version+1,intent);
 let results;
 try{results=await db.batch([update,journal]);}
 catch{throw new DomainError("title_revision_conflict",409);}
 if(okay(results))return {replayed:false,intentId:intent,tituloId:title,
  newVersion:version+1};
 const raced=await replayOrConflict(db,companyId,intent,hash,"REVISAR_TITULO");
 if(raced)return raced;
 throw new DomainError("title_revision_conflict",409);
}
export async function cancelTitle(db,principal,companyId,body) {
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 strictlyObject(body,CANCEL);
 const intent=identifier(body.intentId),title=identifier(body.tituloId),
   version=body.expectedVersion;
 if(!positiveInt(version))throw new DomainError("invalid_title_version");
 const reasonText=reason(body.motivo);
 const hash=await hashIntent("CANCELAR_TITULO",[title,version,reasonText]);
 const previous=await replayOrConflict(db,companyId,intent,hash,"CANCELAR_TITULO");
 if(previous)return previous;
 const update=db.prepare(
  "UPDATE titulos_pagar SET cancelado=1,motivo_cancelamento=?,"+
  "versao=versao+1,operacao_id=? "+
  "WHERE id=? AND empresa_id=? AND versao=? AND cancelado=0 "+
  "AND origem_dado='NATIVO' AND "+NO_PAYMENTS+
  " AND NOT EXISTS(SELECT 1 FROM operacoes o WHERE o.id=?)"
 ).bind(reasonText,intent,title,companyId,version,intent);
 const journal=db.prepare(
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "plano_json,origem_dado,conferencia) "+
  "SELECT ?,?,'CANCELAR_TITULO',?,?,'CONCLUIDA',?,'NATIVO','VALIDADO' "+
  "FROM titulos_pagar t WHERE t.id=? AND t.empresa_id=? AND t.versao=? "+
  "AND t.operacao_id=? AND t.cancelado=1"
 ).bind(intent,companyId,hash,actor.userId,
  JSON.stringify({motivo:reasonText}),title,companyId,version+1,intent);
 let results;
 try{results=await db.batch([update,journal]);}
 catch{throw new DomainError("title_cancel_conflict",409);}
 if(okay(results))return {replayed:false,intentId:intent,tituloId:title,
  newVersion:version+1,cancelado:true};
 const raced=await replayOrConflict(db,companyId,intent,hash,"CANCELAR_TITULO");
 if(raced)return raced;
 throw new DomainError("title_cancel_conflict",409);
}
