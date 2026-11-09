-- R7 E4: ledger duravel para tentativa externa/retomada SUPERVISIONADA.
-- D1 LOCAL somente; nenhum DROP, expurgo, conexao remota nem ALTER legado.
CREATE TABLE r7_e4_tentativas_copia (
 id TEXT NOT NULL PRIMARY KEY,
 empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
 documento_id TEXT NOT NULL,
 versao_id TEXT NOT NULL,
 ator_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
 estado TEXT NOT NULL CHECK(estado IN ('RESERVADA','INCERTA','VERIFICADA')),
 motivo TEXT,
 destino_id TEXT,
 criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 confirmado_em TEXT,
 UNIQUE(empresa_id,versao_id),
 FOREIGN KEY(documento_id,empresa_id) REFERENCES documentos(id,empresa_id) ON DELETE RESTRICT,
 FOREIGN KEY(versao_id,documento_id,empresa_id) REFERENCES documento_versoes(id,documento_id,empresa_id) ON DELETE RESTRICT,
 FOREIGN KEY(destino_id,empresa_id) REFERENCES documento_transferencias(id,empresa_id) ON DELETE RESTRICT,
 CHECK(estado<>'VERIFICADA' OR (destino_id IS NOT NULL AND confirmado_em IS NOT NULL))
) STRICT;
CREATE INDEX idx_r7_e4_por_estado ON r7_e4_tentativas_copia(empresa_id,estado,criado_em);
CREATE TRIGGER trg_r7_e4_sem_delete BEFORE DELETE ON r7_e4_tentativas_copia
BEGIN SELECT RAISE(ABORT,'e4_attempt_immutable'); END;
CREATE TRIGGER trg_r7_e4_sem_alterar_verificado BEFORE UPDATE ON r7_e4_tentativas_copia
WHEN OLD.estado='VERIFICADA' OR
  OLD.empresa_id<>NEW.empresa_id OR OLD.documento_id<>NEW.documento_id OR
  OLD.versao_id<>NEW.versao_id OR OLD.ator_id<>NEW.ator_id
BEGIN SELECT RAISE(ABORT,'e4_verified_or_owner_immutable'); END;


-- Proíbe o Worker de afirmar sucesso com mero nome/ref externo sem a
-- transferência documental local e duas provas de hash/cópia.
CREATE TRIGGER trg_r7_e4_transferencia_verificada
BEFORE UPDATE OF estado,destino_id ON r7_e4_tentativas_copia
WHEN NEW.estado='VERIFICADA' AND NOT EXISTS (
 SELECT 1 FROM documento_transferencias t
 JOIN documento_localizacoes l ON l.id=t.destino_localizacao_id
  AND l.versao_id=t.versao_id AND l.empresa_id=t.empresa_id
 JOIN documento_versoes v ON v.id=t.versao_id AND v.empresa_id=t.empresa_id
 WHERE t.id=NEW.destino_id AND t.empresa_id=NEW.empresa_id
  AND t.versao_id=NEW.versao_id AND t.idempotencia=NEW.id
  AND t.estado='SOBREPOSICAO_30_DIAS'
  AND l.provedor='DRIVE' AND l.status='VERIFICADO'
  AND l.hash_verificado=v.sha256 AND l.tamanho_verificado=v.tamanho_bytes
  AND t.backup_independente_sha256=v.sha256
  AND t.backup_independente_ref IS NOT NULL AND t.backup_verificado_em IS NOT NULL
)
BEGIN SELECT RAISE(ABORT,'e4_transfer_without_verified_copies'); END;

CREATE TRIGGER trg_r7_e4_sem_regressao_status
BEFORE UPDATE OF estado ON r7_e4_tentativas_copia
WHEN OLD.estado='INCERTA' AND NEW.estado='RESERVADA'
BEGIN SELECT RAISE(ABORT,'e4_reopen_uncertain_forbidden'); END;

-- Eventos de auditoria permanecem append-only no registro original do app.
CREATE TRIGGER trg_r7_e4_auditoria_reserva
AFTER INSERT ON r7_e4_tentativas_copia
BEGIN
 INSERT INTO eventos_auditoria(id,empresa_id,tipo_entidade,entidade_id_texto,
  acao,ator_id,resumo,origem_dado,conferencia)
 VALUES(lower(hex(randomblob(16))),NEW.empresa_id,'DOCUMENTO_VERSAO',
  NEW.versao_id,'RESERVAR_COPIA',NEW.ator_id,
  'E4: tentativa de copia externa reservada','NATIVO','VALIDADO');
END;
CREATE TRIGGER trg_r7_e4_auditoria_estado
AFTER UPDATE OF estado ON r7_e4_tentativas_copia
WHEN NEW.estado<>OLD.estado
BEGIN
 INSERT INTO eventos_auditoria(id,empresa_id,tipo_entidade,entidade_id_texto,
  acao,ator_id,resumo,origem_dado,conferencia)
 VALUES(lower(hex(randomblob(16))),NEW.empresa_id,'DOCUMENTO_VERSAO',
  NEW.versao_id,
  CASE WHEN NEW.estado='VERIFICADA' THEN 'CONFIRMAR_COPIA'
       ELSE 'COPIA_INCERTA' END,
  NEW.ator_id,'E4: nova situacao auditada de tentativa externa',
  'NATIVO','VALIDADO');
END;
