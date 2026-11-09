-- R7 etapa 2 / Q08: reemissao fiscal versionada e transacional.
-- Migracao 0009 apos 0008, SOMENTE local. Proibido UPDATE direto do
-- conteudo/valor original: corretivo cria nova NF, preserva selo e liga ambas.
-- A cancelacao da NF selada e suas parcelas so ocorre sob operacao
-- RETIFICAR_NF validada em operacoes. Nenhuma retificacao de NF recebida.

CREATE TABLE nf_retificacoes (
 id TEXT PRIMARY KEY NOT NULL,
 empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
 nota_original_id TEXT NOT NULL,
 nota_substituta_id TEXT NOT NULL,
 motivo TEXT NOT NULL CHECK(length(trim(motivo)) BETWEEN 5 AND 2000),
 atestado_por_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
 operacao_id TEXT NOT NULL,
 criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(nota_original_id<>nota_substituta_id),
 UNIQUE(empresa_id,nota_original_id),
 UNIQUE(empresa_id,nota_substituta_id),
 FOREIGN KEY(nota_original_id,empresa_id) REFERENCES notas_fiscais(id,empresa_id) ON DELETE RESTRICT,
 FOREIGN KEY(nota_substituta_id,empresa_id) REFERENCES notas_fiscais(id,empresa_id) ON DELETE RESTRICT,
 FOREIGN KEY(operacao_id,empresa_id) REFERENCES operacoes(id,empresa_id) ON DELETE RESTRICT,
 UNIQUE(id,empresa_id)
) STRICT;

CREATE TRIGGER trg_r4_nf_retificacoes_escopo_proveniencia
BEFORE UPDATE OF empresa_id ON nf_retificacoes
WHEN NEW.empresa_id IS NOT OLD.empresa_id
BEGIN SELECT RAISE(ABORT,'R7: identidade da empresa da retificacao imutavel'); END;

CREATE TRIGGER trg_r9_nf_retificacoes_no_update
BEFORE UPDATE ON nf_retificacoes
BEGIN SELECT RAISE(ABORT,'R7 Q08: retificacao imutavel'); END;
CREATE TRIGGER trg_r9_nf_retificacoes_no_delete
BEFORE DELETE ON nf_retificacoes
BEGIN SELECT RAISE(ABORT,'R7 Q08: retificacao historica'); END;
CREATE TRIGGER trg_r9_nf_retificacoes_no_replace
BEFORE INSERT ON nf_retificacoes
WHEN EXISTS (SELECT 1 FROM nf_retificacoes x
  WHERE x.id=NEW.id OR (x.empresa_id=NEW.empresa_id AND (
  x.nota_original_id=NEW.nota_original_id
  OR x.nota_substituta_id=NEW.nota_substituta_id)))
BEGIN SELECT RAISE(ABORT,'R7 Q08: retificacao ja existe'); END;

CREATE TRIGGER trg_r9_nf_retificacoes_gate
BEFORE INSERT ON nf_retificacoes
WHEN NOT EXISTS(
 SELECT 1 FROM notas_fiscais orig
 JOIN notas_fiscais nova ON nova.id=NEW.nota_substituta_id
   AND nova.empresa_id=orig.empresa_id
 JOIN nf_conciliacoes seloOrig ON seloOrig.nota_fiscal_id=orig.id
   AND seloOrig.empresa_id=orig.empresa_id
 JOIN nf_conciliacoes seloNova ON seloNova.nota_fiscal_id=nova.id
   AND seloNova.empresa_id=nova.empresa_id
 JOIN operacoes op ON op.id=NEW.operacao_id AND op.empresa_id=orig.empresa_id
 WHERE orig.id=NEW.nota_original_id AND orig.empresa_id=NEW.empresa_id
   AND orig.situacao='CANCELADA' AND nova.situacao IN ('EMITIDA','APRESENTADA')
   AND orig.empenho_id=nova.empenho_id
   AND orig.orgao_id_escopo=nova.orgao_id_escopo
   AND op.tipo='RETIFICAR_NF' AND op.ator_id=NEW.atestado_por_id
   AND json_extract(op.plano_json,'$.notaOriginalId')=orig.id
   AND json_extract(op.plano_json,'$.notaSubstitutaId')=nova.id
   AND NOT EXISTS(
    SELECT 1 FROM contas_receber c
    WHERE c.nota_fiscal_id=orig.id AND c.empresa_id=orig.empresa_id
      AND c.cancelada=0
   )
   AND NOT EXISTS(
    SELECT 1 FROM contas_receber c
    JOIN recebimentos r ON r.conta_receber_id=c.id AND r.empresa_id=c.empresa_id
    WHERE c.nota_fiscal_id=orig.id AND c.empresa_id=orig.empresa_id
   )
)
BEGIN SELECT RAISE(ABORT,'R7 Q08: retificacao sem substituta selada, cancelamento ou diário'); END;

-- Reusar os guardas originais em modo fail-closed, permitindo uma unica
-- transicao de estado cancelada por journal autenticado.
DROP TRIGGER trg_r7_nf_selada_header;
CREATE TRIGGER trg_r7_nf_selada_header
BEFORE UPDATE OF valor_documento_cent,situacao,empresa_id ON notas_fiscais
WHEN EXISTS (SELECT 1 FROM nf_conciliacoes c
 WHERE c.empresa_id=OLD.empresa_id AND c.nota_fiscal_id=OLD.id)
 AND (NEW.valor_documento_cent IS NOT OLD.valor_documento_cent
   OR NEW.empresa_id IS NOT OLD.empresa_id
   OR (NEW.situacao IS NOT OLD.situacao AND NOT (
      OLD.situacao IN ('EMITIDA','APRESENTADA') AND NEW.situacao='CANCELADA'
      AND NEW.operacao_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM operacoes o
        WHERE o.id=NEW.operacao_id AND o.empresa_id=OLD.empresa_id
          AND o.tipo='RETIFICAR_NF'
          AND json_extract(o.plano_json,'$.notaOriginalId')=OLD.id)
      AND NOT EXISTS(SELECT 1 FROM contas_receber c
        JOIN recebimentos r ON r.conta_receber_id=c.id AND r.empresa_id=c.empresa_id
        WHERE c.nota_fiscal_id=OLD.id AND c.empresa_id=OLD.empresa_id)
   )))
BEGIN SELECT RAISE(ABORT,'R7 Q08: NF selada somente cancelada via retificacao'); END;

DROP TRIGGER trg_r7_nf_selada_parcela_update;
CREATE TRIGGER trg_r7_nf_selada_parcela_update
BEFORE UPDATE OF valor_bruto_cent,nota_fiscal_id,empresa_id,cancelada ON contas_receber
WHEN EXISTS (SELECT 1 FROM nf_conciliacoes c
 WHERE c.empresa_id=OLD.empresa_id AND c.nota_fiscal_id=OLD.nota_fiscal_id)
 AND (NEW.valor_bruto_cent IS NOT OLD.valor_bruto_cent
  OR NEW.nota_fiscal_id IS NOT OLD.nota_fiscal_id
  OR NEW.empresa_id IS NOT OLD.empresa_id
  OR (NEW.cancelada IS NOT OLD.cancelada AND NOT (
     OLD.cancelada=0 AND NEW.cancelada=1
     AND NEW.motivo_cancelamento='RETIFICACAO_FISCAL'
     AND NEW.operacao_id IS NOT NULL
     AND EXISTS(SELECT 1 FROM operacoes o
       WHERE o.id=NEW.operacao_id AND o.empresa_id=OLD.empresa_id
         AND o.tipo='RETIFICAR_NF'
         AND json_extract(o.plano_json,'$.notaOriginalId')=OLD.nota_fiscal_id)
   )))
BEGIN SELECT RAISE(ABORT,'R7 Q08: parcela selada somente cancelada via retificacao'); END;

-- O cancelamento da NF original cancela as parcelas NA MESMA INSTRUCAO;
-- sem estorno/mutacao de recebimento (qualquer recebimento bloqueia a transicao).
CREATE TRIGGER trg_r9_nf_retificacao_cancela_parcelas
AFTER UPDATE OF situacao ON notas_fiscais
WHEN OLD.situacao IN ('EMITIDA','APRESENTADA') AND NEW.situacao='CANCELADA'
 AND EXISTS(SELECT 1 FROM nf_conciliacoes c
  WHERE c.nota_fiscal_id=OLD.id AND c.empresa_id=OLD.empresa_id)
BEGIN
 UPDATE contas_receber SET cancelada=1,
  motivo_cancelamento='RETIFICACAO_FISCAL',operacao_id=NEW.operacao_id,
  versao=versao+1 WHERE nota_fiscal_id=NEW.id AND empresa_id=NEW.empresa_id
  AND cancelada=0;
END;
