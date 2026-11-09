// R7 E3: direitos locais por entidade e revogacao server-side de tokens/membros.
// Nenhuma rota de migracao LEGADO, expurgo R2, permissao positiva ou deploy.
import { requireCompanyRole, SecurityError } from "./security.mjs";
import { DomainError, strictlyObject, identifier, hashIntent,
  replayOrConflict, requireBatch } from "./domain.mjs";

const ENTITY_TABLES = Object.freeze({
  LICITACAO:"licitacoes", LICITACAO_ITEM:"licitacao_itens",
  EMPENHO:"empenhos", EMPENHO_ITEM:"empenho_itens",
  COMPRA:"compras", COMPRA_ITEM:"compra_itens",
  ENVIO:"envios", ENVIO_ITEM:"envio_itens",
  NOTA_FISCAL:"notas_fiscais", TITULO_PAGAR:"titulos_pagar",
  TITULO_BAIXA:"titulo_baixas", CONTA_RECEBER:"contas_receber",
  RECEBIMENTO:"recebimentos", RECORRENCIA:"recorrencias",
  DOCUMENTO:"documentos", DOCUMENTO_VERSAO:"documento_versoes",
  COTACAO:"cotacoes_precos",
  PREFERENCIA_NOTIFICACAO:"notificacoes_preferencias",
  DESTINATARIO_NOTIFICACAO:"notificacoes_destinatarios"
});
const OWNER_COLUMNS = Object.freeze({
  licitacao:["LICITACAO","licitacao_id"],
  empenho:["EMPENHO","empenho_id"],
  compra:["COMPRA","compra_id"],
  envio:["ENVIO","envio_id"],
  nota_fiscal:["NOTA_FISCAL","nota_fiscal_id"],
  titulo_pagar:["TITULO_PAGAR","titulo_pagar_id"],
  titulo_baixa:["TITULO_BAIXA","titulo_baixa_id"],
  conta_receber:["CONTA_RECEBER","conta_receber_id"],
  recebimento:["RECEBIMENTO","recebimento_id"],
  licitacao_item:["LICITACAO_ITEM","licitacao_item_id"],
  cotacao:["COTACAO","cotacao_id"]
});
const HASH=/^[0-9a-f]{64}$/;

export async function assertSessionActive(db,principal) {
  if(!db?.prepare||!principal?.tokenSha256||!HASH.test(principal.tokenSha256) ||
    !Number.isSafeInteger(principal.expiresAt))throw new SecurityError("invalid_session",401);
  const row=await db.prepare(
    "SELECT token_sha256 FROM r7_sessoes_revogadas WHERE token_sha256=? AND exp_epoch>?"
  ).bind(principal.tokenSha256,Math.floor(Date.now()/1000)).first();
  if(row)throw new SecurityError("session_revoked",401);
}

export async function requireEntityPermission(db,principal,companyId,type,entityId,action) {
  const member=await requireCompanyRole(db,principal,companyId,
    action==="READ"?"read":"write");
  if(!Object.hasOwn(ENTITY_TABLES,type)||!["READ","WRITE"].includes(action))
    throw new SecurityError("entity_type_forbidden");
  const id=identifier(entityId);
  // A checagem de existencia e do tenant nao concede direitos: a empresa/papel
  // continua necessaria e ACL negativa prevalece inclusive para ADMIN.
  const row=await db.prepare(
    "SELECT id FROM "+ENTITY_TABLES[type]+" WHERE id=? AND empresa_id=?"
  ).bind(id,companyId).first();
  if(!row)throw new SecurityError("entity_unavailable",404);
  const denied=await db.prepare(
    "SELECT 1 AS blocked FROM r7_acl_bloqueios "+
    "WHERE empresa_id=? AND usuario_id=? AND tipo_entidade=? "+
    "AND entidade_id=? AND acao IN (?,'ALL') LIMIT 1"
  ).bind(companyId,member.userId,type,id,action).first();
  if(denied)throw new SecurityError("entity_unavailable",404);
  return member;
}

// Um documento pode herdar negativa do seu registro dono.
// SEM vinculo ativo tipado, nem sequer existe permissao para download.
export async function requireDocumentPermission(db,principal,companyId,documentoId,action) {
  const id=identifier(documentoId);
  const member=await requireEntityPermission(db,principal,companyId,"DOCUMENTO",id,action);
  const linked=await db.prepare(
    "SELECT * FROM documento_vinculos WHERE documento_id=? AND empresa_id=? AND ativo=1"
  ).bind(id,companyId).all();
  if(!Array.isArray(linked?.results)||linked.results.length===0)
    throw new SecurityError("document_owner_unavailable",404);
  for(const link of linked.results){
    const pairs=Object.values(OWNER_COLUMNS).filter(([,column])=>link[column]!=null);
    if(pairs.length!==1)throw new SecurityError("document_owner_unavailable",404);
    await requireEntityPermission(db,principal,companyId,pairs[0][0],link[pairs[0][1]],action);
  }
  return member;
}

// Portas de servico ja validam existencia/FK de destino. Esta guarda
// exige empresa e papel antes de usar ACL, sem transformar um ID ausente
// em acesso permitido: a operacao do dominio continua a rejeita-lo.
export async function assertEntityNotBlocked(db,principal,companyId,type,entityId,action) {
  if(!Object.hasOwn(ENTITY_TABLES,type)||!["READ","WRITE"].includes(action))
    throw new SecurityError("entity_type_forbidden");
  const id=identifier(entityId);
  const member=await requireCompanyRole(db,principal,companyId,
    action==="READ"?"read":"write");
  const denied=await db.prepare(
    "SELECT 1 AS blocked FROM r7_acl_bloqueios "+
    "WHERE empresa_id=? AND usuario_id=? AND tipo_entidade=? "+
    "AND entidade_id=? AND acao IN (?,'ALL') LIMIT 1"
  ).bind(companyId,member.userId,type,id,action).first();
  if(denied)throw new SecurityError("entity_unavailable",404);
  return member;
}

export async function assertAggregateAccess(db,principal,companyId) {
  const actor=await requireCompanyRole(db,principal,companyId,"read");
  // Relatorios/snapshots de totais nao podem contornar ACL por linha.
  const blocked=await db.prepare(
    "SELECT 1 AS blocked FROM r7_acl_bloqueios WHERE empresa_id=? "+
    "AND usuario_id=? AND tipo_entidade IN ('TITULO_PAGAR','RECORRENCIA') "+
    "AND acao IN ('READ','ALL') LIMIT 1"
  ).bind(companyId,actor.userId).first();
  if(blocked)throw new SecurityError("aggregate_with_restricted_rows",403);
}

const BLOCK_FIELDS=new Set(["intentId","targetUserId","tipoEntidade",
  "entidadeId","acao","motivo"]);
export async function blockEntityForUser(db,principal,companyId,body) {
  requireBatch(db);
  const actor=await requireCompanyRole(db,principal,companyId,"approve");
  strictlyObject(body,BLOCK_FIELDS);
  const intent=identifier(body.intentId),target=identifier(body.targetUserId);
  const id=identifier(body.entidadeId),type=body.tipoEntidade,action=body.acao;
  if(!Object.hasOwn(ENTITY_TABLES,type)||!["READ","WRITE","ALL"].includes(action) ||
     typeof body.motivo!=="string"||body.motivo.trim().length<8||
     body.motivo.trim().length>500||target===actor.userId)
    throw new DomainError("invalid_entity_block",400);
  // ALLOW nao existe; bloqueio de outro tenant/entidade inexistente nao e gravado.
  const targetRow=await db.prepare(
    "SELECT 1 AS allowed FROM usuarios_empresas WHERE usuario_id=? AND empresa_id=?"
  ).bind(target,companyId).first();
  if(!targetRow)throw new SecurityError("target_unavailable",404);
  const entity=await db.prepare(
    "SELECT id FROM "+ENTITY_TABLES[type]+" WHERE id=? AND empresa_id=?"
  ).bind(id,companyId).first();
  if(!entity)throw new SecurityError("entity_unavailable",404);
  const hash=await hashIntent("R7_BLOQUEIO_ENTIDADE",[target,type,id,action,body.motivo.trim()]);
  const previous=await replayOrConflict(db,companyId,intent,hash,"R7_BLOQUEIO_ENTIDADE");
  if(previous)return previous;
  const rowId=crypto.randomUUID();
  const op=db.prepare(
    "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "SELECT ?,?,'R7_BLOQUEIO_ENTIDADE',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
    "WHERE EXISTS (SELECT 1 FROM usuarios_empresas WHERE usuario_id=? "+
    "AND empresa_id=? AND ativo=1 AND papel='ADMIN')"
  ).bind(intent,companyId,hash,actor.userId,actor.userId,companyId);
  const deny=db.prepare(
    "INSERT INTO r7_acl_bloqueios(id,empresa_id,usuario_id,tipo_entidade,entidade_id,"+
    "acao,motivo,ator_id,operacao_id) VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(rowId,companyId,target,type,id,action,body.motivo.trim(),actor.userId,intent);
  const audit=db.prepare(
    "INSERT INTO eventos_auditoria(id,empresa_id,tipo_entidade,entidade_id_texto,"+
    "acao,ator_id,resumo,operacao_id,origem_dado,conferencia) "+
    "VALUES (?,?,?,?,?,?,?,?,'NATIVO','VALIDADO')"
  ).bind(crypto.randomUUID(),companyId,type,id,"RESTRINGIR_"+action,
    actor.userId,body.motivo.trim(),intent);
  let result;
  try{result=await db.batch([op,deny,audit]);}
  catch{throw new DomainError("entity_block_conflict",409);}
  if(result?.length!==3||result.some(x=>x?.meta?.changes!==1))
    throw new DomainError("entity_block_incomplete",409);
  return {replayed:false,intentId:intent,restrictionId:rowId};
}

const REVOKE_FIELDS=new Set(["intentId","targetUserId","expectedVersion","motivo"]);
export async function revokeCompanyMembership(db,principal,companyId,body) {
  requireBatch(db);
  const actor=await requireCompanyRole(db,principal,companyId,"approve");
  strictlyObject(body,REVOKE_FIELDS);
  const intent=identifier(body.intentId),target=identifier(body.targetUserId);
  if(target===actor.userId||!Number.isSafeInteger(body.expectedVersion)||
    body.expectedVersion<1||typeof body.motivo!=="string"||
    body.motivo.trim().length<8||body.motivo.trim().length>500)
    throw new DomainError("invalid_revocation",400);
  const hash=await hashIntent("R7_REVOGAR_MEMBRO",
    [target,body.expectedVersion,body.motivo.trim()]);
  const prior=await replayOrConflict(db,companyId,intent,hash,"R7_REVOGAR_MEMBRO");
  if(prior)return prior;
  const op=db.prepare(
    "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "SELECT ?,?,'R7_REVOGAR_MEMBRO',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
    "WHERE EXISTS (SELECT 1 FROM usuarios_empresas WHERE empresa_id=? AND usuario_id=? "+
    "AND ativo=1 AND versao=?) AND EXISTS (SELECT 1 FROM usuarios_empresas "+
    "WHERE empresa_id=? AND usuario_id=? AND ativo=1 AND papel='ADMIN')"
  ).bind(intent,companyId,hash,actor.userId,companyId,target,
    body.expectedVersion,companyId,actor.userId);
  const update=db.prepare(
    "UPDATE usuarios_empresas SET ativo=0,versao=versao+1 "+
    "WHERE empresa_id=? AND usuario_id=? AND ativo=1 AND versao=? "+
    "AND EXISTS (SELECT 1 FROM operacoes WHERE id=? AND empresa_id=? "+
    "AND tipo='R7_REVOGAR_MEMBRO' AND ator_id=?)"
  ).bind(companyId,target,body.expectedVersion,intent,companyId,actor.userId);
  const audit=db.prepare(
    "INSERT INTO eventos_auditoria(id,empresa_id,tipo_entidade,entidade_id_texto,"+
    "acao,ator_id,resumo,operacao_id,origem_dado,conferencia) "+
    "SELECT ?,?,'USUARIO_EMPRESA',?,"+
    "CASE WHEN changes()=1 THEN 'REVOGAR_MEMBRO' ELSE NULL END,"+
    "?,?,?,'NATIVO','VALIDADO' "+
    "WHERE EXISTS (SELECT 1 FROM usuarios_empresas WHERE empresa_id=? "+
    "AND usuario_id=? AND ativo=0 AND versao=?)"
  ).bind(crypto.randomUUID(),companyId,target,actor.userId,body.motivo.trim(),
    intent,companyId,target,body.expectedVersion+1);
  let res;
  try{res=await db.batch([op,update,audit]);}
  catch{throw new DomainError("membership_revocation_conflict",409);}
  if(res?.length!==3||res.some(x=>x?.meta?.changes!==1))
    throw new DomainError("membership_version_conflict",409);
  return {replayed:false,intentId:intent,revokedUserId:target};
}

const LOGOUT_FIELDS=new Set(["intentId"]);
export async function revokeCurrentSession(db,principal,companyId,body) {
  requireBatch(db);
  const member=await requireCompanyRole(db,principal,companyId,"read");
  strictlyObject(body,LOGOUT_FIELDS);
  const intent=identifier(body.intentId);
  if(!HASH.test(principal?.tokenSha256||"")||
     !Number.isSafeInteger(principal.expiresAt)||
     principal.expiresAt<=Math.floor(Date.now()/1000))
    throw new SecurityError("invalid_session",401);
  const hash=await hashIntent("R7_REVOGAR_SESSAO",[principal.tokenSha256]);
  // Nao guardar o JWT bruto nem permitir revoke de token arbitrario do body.
  const op=db.prepare(
    "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "VALUES (?,?,'R7_REVOGAR_SESSAO',?,?,'CONCLUIDA','NATIVO','VALIDADO')"
  ).bind(intent,companyId,hash,member.userId);
  const revoked=db.prepare(
    "INSERT INTO r7_sessoes_revogadas(token_sha256,access_issuer,access_subject,"+
    "exp_epoch,empresa_id,usuario_id,operacao_id) VALUES (?,?,?,?,?,?,?)"
  ).bind(principal.tokenSha256,principal.issuer,principal.subject,
    principal.expiresAt,companyId,member.userId,intent);
  const audit=db.prepare(
    "INSERT INTO eventos_auditoria(id,empresa_id,tipo_entidade,entidade_id_texto,"+
    "acao,ator_id,resumo,operacao_id,origem_dado,conferencia) "+
    "VALUES (?,?,'USUARIO',?,'REVOGAR_SESSAO',?,?,?,'NATIVO','VALIDADO')"
  ).bind(crypto.randomUUID(),companyId,member.userId,member.userId,
    "Sessao JWT revogada localmente",intent);
  let res;
  try{res=await db.batch([op,revoked,audit]);}
  catch{throw new DomainError("session_revocation_conflict",409);}
  if(res?.length!==3||res.some(x=>x?.meta?.changes!==1))
    throw new DomainError("session_revocation_incomplete",409);
  return {replayed:false,revoked:true};
}
