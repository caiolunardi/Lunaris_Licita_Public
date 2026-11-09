// R7 etapa 1 / FIN05 — atestado humano de retenção, vinculado à
// versão documental VERIFICADA. Não inferir retenção confirmada da PREVISTA.
// Sem acesso Drive real nesta etapa; comprovante deve existir no D1 local.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier,positiveInt,money,
        hashIntent,replayOrConflict,requireBatch} from "./domain.mjs";

const FIELDS=new Set(["intentId","contaReceberId","documentoVersaoId","valorConfirmadoCent"]);
export async function attestRetention(db,principal,companyId,body){
  requireBatch(db);
  // Atestar é ação privilegiada, distinta de digitar recebimento.
  const actor=await requireCompanyRole(db,principal,companyId,"approve");
  strictlyObject(body,FIELDS);
  const intentId=identifier(body.intentId);
  const accountId=identifier(body.contaReceberId);
  const versionId=identifier(body.documentoVersaoId);
  const value=body.valorConfirmadoCent;
  if(!money(value)||!positiveInt(value))throw new DomainError("invalid_retention_amount");
  const hash=await hashIntent("ATESTAR_RETENCAO",[accountId,versionId,value]);
  const replay=await replayOrConflict(db,companyId,intentId,hash,"ATESTAR_RETENCAO");
  if(replay)return replay;
  const attestId=crypto.randomUUID();
  const insertJournal=db.prepare(
    "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "VALUES (?,?,'ATESTAR_RETENCAO',?,?,'CONCLUIDA','NATIVO','VALIDADO')"
  ).bind(intentId,companyId,hash,actor.userId);
  const insertAttest=db.prepare(
    "INSERT INTO retencao_atestados (id,empresa_id,conta_receber_id,documento_versao_id,"+
    "valor_confirmado_cent,atestado_por_id,operacao_id) "+
    "VALUES (?,?,?,?,?,?,?)"
  ).bind(attestId,companyId,accountId,versionId,value,actor.userId,intentId);
  let r;
  try{r=await db.batch([insertJournal,insertAttest]);}
  catch{throw new DomainError("retention_attestation_conflict",409);}
  if(r?.length===2&&r[0]?.meta?.changes===1&&r[1]?.meta?.changes===1)
    return {replayed:false,intentId,atestadoId:attestId,valorConfirmadoCent:value};
  const raced=await replayOrConflict(db,companyId,intentId,hash,"ATESTAR_RETENCAO");
  if(raced)return raced;
  throw new DomainError("retention_attestation_not_allowed",409);
}
