// R7 E2 / FIN09 OK08 OK15: encerramento COMERCIAL separado do
// financeiro. Reabertura só ADMIN com motivo, não apaga ciclo anterior;
// novo encerramento cria novo marco e não quita boletos automaticamente.
// Horário e autor exclusivamente do servidor, não do browser.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier,positiveInt,
 hashIntent,replayOrConflict,requireBatch} from "./domain.mjs";
const FIELDS=new Set(["intentId","licitacaoId","expectedVersion","motivo"]);
const REOPEN=new Set([...FIELDS,"cicloId"]);
function validate(body,allowed){
 strictlyObject(body,allowed);
 const intent=identifier(body.intentId),id=identifier(body.licitacaoId);
 if(!positiveInt(body.expectedVersion)||
    typeof body.motivo!=="string"||body.motivo.trim()!==body.motivo||
    body.motivo.length<6||body.motivo.length>2000){
  throw new DomainError("invalid_licitation_cycle");
 }
 return {intent,id};
}
function okay(r){return Array.isArray(r)&&r.length===2&&
  r.every(x=>Number.isInteger(x?.meta?.changes)&&x.meta.changes>=1);}
export async function closeCommercialCycle(db,principal,companyId,body){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 const {intent,id}=validate(body,FIELDS);
 const hash=await hashIntent("ENCERRAR_COMERCIAL",[
   id,body.expectedVersion,body.motivo]);
 const previous=await replayOrConflict(db,companyId,intent,hash,"ENCERRAR_COMERCIAL");
 if(previous)return previous;
 const recent=await db.prepare(
  "SELECT MAX(reaberta_em) AS last_reopen FROM licitacao_encerramentos "+
  "WHERE licitacao_id=? AND empresa_id=?"
 ).bind(id,companyId).first();
 const lastMs=Date.parse(recent?.last_reopen||"");
 const clock=Number.isFinite(lastMs)?Math.max(Date.now(),lastMs+1):Date.now();
 const cycleId=crypto.randomUUID(),at=new Date(clock).toISOString();
 const close=db.prepare(
  "INSERT INTO licitacao_encerramentos "+
  "(id,empresa_id,licitacao_id,encerrada_em,encerrada_por,motivo,"+
  "operacao_id,conferencia) "+
  "SELECT ?,l.empresa_id,l.id,?,?,?,?,'VALIDADO' "+
  "FROM licitacoes l WHERE l.id=? AND l.empresa_id=? AND l.versao=? "+
  "AND l.origem_dado='NATIVO' AND l.encerrada_em IS NULL "+
  "AND NOT EXISTS(SELECT 1 FROM licitacao_encerramentos x "+
  "WHERE x.empresa_id=l.empresa_id AND x.licitacao_id=l.id "+
  "AND x.reaberta_em IS NULL) "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes o WHERE o.id=?)"
 ).bind(cycleId,at,actor.userId,body.motivo,intent,
   id,companyId,body.expectedVersion,intent);
 const journal=db.prepare(
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "plano_json,origem_dado,conferencia) "+
  "SELECT ?,?,'ENCERRAR_COMERCIAL',?,?,'CONCLUIDA',?,'NATIVO','VALIDADO' "+
  "FROM licitacao_encerramentos x JOIN licitacoes l ON "+
  "l.id=x.licitacao_id AND l.empresa_id=x.empresa_id "+
  "WHERE x.id=? AND x.empresa_id=? AND x.operacao_id=? "+
  "AND l.versao=? AND l.encerrada_em=x.encerrada_em"
 ).bind(intent,companyId,hash,actor.userId,
   JSON.stringify({motivo:body.motivo,at,cicloId:cycleId}),
   cycleId,companyId,intent,body.expectedVersion+1);
 let res;
 try{res=await db.batch([close,journal]);}
 catch{throw new DomainError("commercial_closure_conflict",409);}
 if(okay(res))return {replayed:false,intentId:intent,cicloId:cycleId,
  encerradaEm:at,newVersion:body.expectedVersion+1};
 const raced=await replayOrConflict(db,companyId,intent,hash,"ENCERRAR_COMERCIAL");
 if(raced)return raced;
 throw new DomainError("commercial_closure_conflict",409);
}
export async function reopenCommercialCycle(db,principal,companyId,body){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"approve");
 const {intent,id}=validate(body,REOPEN),cycleId=identifier(body.cicloId);
 const hash=await hashIntent("REABRIR_COMERCIAL",[
   id,cycleId,body.expectedVersion,body.motivo]);
 const previous=await replayOrConflict(db,companyId,intent,hash,"REABRIR_COMERCIAL");
 if(previous)return previous;
 const cycle=await db.prepare(
  "SELECT encerrada_em FROM licitacao_encerramentos "+
  "WHERE id=? AND licitacao_id=? AND empresa_id=? AND reaberta_em IS NULL"
 ).bind(cycleId,id,companyId).first();
 if(!cycle)throw new DomainError("commercial_reopen_conflict",409);
 const closedMs=Date.parse(cycle.encerrada_em);
 if(!Number.isFinite(closedMs))throw new DomainError("invalid_licitation_cycle",409);
 const at=new Date(Math.max(Date.now(),closedMs+1)).toISOString();
 const change=db.prepare(
  "UPDATE licitacao_encerramentos SET reaberta_em=?,"+
  "reaberta_por=?,motivo_reabertura=?,versao=versao+1,operacao_id=? "+
  "WHERE id=? AND licitacao_id=? AND empresa_id=? AND reaberta_em IS NULL "+
  "AND julianday(?)>julianday(encerrada_em) "+
  "AND EXISTS(SELECT 1 FROM licitacoes l WHERE l.id=? AND "+
  "l.empresa_id=? AND l.versao=? AND l.encerrada_em="+
  "licitacao_encerramentos.encerrada_em AND l.origem_dado='NATIVO') "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes o WHERE o.id=?)"
 ).bind(at,actor.userId,body.motivo,intent,cycleId,id,companyId,
   at,id,companyId,body.expectedVersion,intent);
 const journal=db.prepare(
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "plano_json,origem_dado,conferencia) "+
  "SELECT ?,?,'REABRIR_COMERCIAL',?,?,'CONCLUIDA',?,'NATIVO','VALIDADO' "+
  "FROM licitacao_encerramentos x JOIN licitacoes l "+
  "ON l.id=x.licitacao_id AND l.empresa_id=x.empresa_id "+
  "WHERE x.id=? AND x.licitacao_id=? AND x.empresa_id=? "+
  "AND x.operacao_id=? AND l.versao=? AND l.encerrada_em IS NULL"
 ).bind(intent,companyId,hash,actor.userId,
   JSON.stringify({motivo:body.motivo,at,cicloId:cycleId}),
   cycleId,id,companyId,intent,body.expectedVersion+1);
 let res;
 try{res=await db.batch([change,journal]);}
 catch{throw new DomainError("commercial_reopen_conflict",409);}
 if(okay(res))return {replayed:false,intentId:intent,cicloId:cycleId,
   reabertaEm:at,newVersion:body.expectedVersion+1};
 const raced=await replayOrConflict(db,companyId,intent,hash,"REABRIR_COMERCIAL");
 if(raced)return raced;
 throw new DomainError("commercial_reopen_conflict",409);
}
