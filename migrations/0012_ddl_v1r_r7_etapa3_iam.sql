-- R7 E3: revogacao local de sessao, versao de membership e negativas granulares.
-- Somente D1 LOCAL. Nao implica ligacao a Worker publico ou autorizacao remota.
ALTER TABLE usuarios_empresas
  ADD COLUMN versao INTEGER NOT NULL DEFAULT 1 CHECK(versao>=1);

CREATE TABLE r7_sessoes_revogadas (
  token_sha256 TEXT NOT NULL PRIMARY KEY CHECK(length(token_sha256)=64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'),
  access_issuer TEXT NOT NULL,
  access_subject TEXT NOT NULL,
  exp_epoch INTEGER NOT NULL CHECK(exp_epoch>0),
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  operacao_id TEXT NOT NULL UNIQUE REFERENCES operacoes(id) ON DELETE RESTRICT,
  revogado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX idx_r7_sessoes_exp_epoch ON r7_sessoes_revogadas(exp_epoch);
CREATE TRIGGER trg_r7_sessoes_sem_update BEFORE UPDATE ON r7_sessoes_revogadas
BEGIN SELECT RAISE(ABORT,'r7_session_revocation_immutable'); END;
CREATE TRIGGER trg_r7_sessoes_sem_delete BEFORE DELETE ON r7_sessoes_revogadas
BEGIN SELECT RAISE(ABORT,'r7_session_revocation_immutable'); END;

-- Negativas append-only. 'ALL' equivale a READ+WRITE.
-- Nenhum direito positivo e concedido por esta tabela, em nenhuma empresa.
CREATE TABLE r7_acl_bloqueios (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  tipo_entidade TEXT NOT NULL CHECK(tipo_entidade IN (
    'LICITACAO','LICITACAO_ITEM','EMPENHO','EMPENHO_ITEM','COMPRA',
    'COMPRA_ITEM','ENVIO','ENVIO_ITEM','NOTA_FISCAL','TITULO_PAGAR',
    'TITULO_BAIXA','CONTA_RECEBER','RECEBIMENTO','RECORRENCIA',
    'DOCUMENTO','DOCUMENTO_VERSAO','COTACAO','PREFERENCIA_NOTIFICACAO',
    'DESTINATARIO_NOTIFICACAO'
  )),
  entidade_id TEXT NOT NULL,
  acao TEXT NOT NULL CHECK(acao IN ('READ','WRITE','ALL')),
  motivo TEXT NOT NULL CHECK(length(trim(motivo)) BETWEEN 8 AND 500),
  ator_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  operacao_id TEXT NOT NULL UNIQUE REFERENCES operacoes(id) ON DELETE RESTRICT,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(empresa_id,usuario_id,tipo_entidade,entidade_id,acao)
) STRICT;
CREATE INDEX idx_r7_acl_consulta
  ON r7_acl_bloqueios(empresa_id,usuario_id,tipo_entidade,entidade_id,acao);
CREATE TRIGGER trg_r7_acl_admin_autorizado
BEFORE INSERT ON r7_acl_bloqueios
WHEN NEW.ator_id=NEW.usuario_id OR NOT EXISTS (
  SELECT 1 FROM usuarios u
  JOIN usuarios_empresas ue ON ue.usuario_id=u.id
  WHERE u.id=NEW.ator_id AND u.ativo=1
    AND ue.empresa_id=NEW.empresa_id AND ue.ativo=1 AND ue.papel='ADMIN'
) OR NOT EXISTS (
  SELECT 1 FROM usuarios_empresas te
  WHERE te.usuario_id=NEW.usuario_id AND te.empresa_id=NEW.empresa_id
)
BEGIN SELECT RAISE(ABORT,'r7_acl_admin_or_target_invalid'); END;
CREATE TRIGGER trg_r7_acl_sem_update BEFORE UPDATE ON r7_acl_bloqueios
BEGIN SELECT RAISE(ABORT,'r7_acl_immutable'); END;
CREATE TRIGGER trg_r7_acl_sem_delete BEFORE DELETE ON r7_acl_bloqueios
BEGIN SELECT RAISE(ABORT,'r7_acl_immutable'); END;
