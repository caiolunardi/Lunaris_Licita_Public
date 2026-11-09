-- R7 E2: FIN05 protege a retenção em TODOS os recebimentos NATIVO,
-- inclusive SQL direto sem operacao_id. Somente origem LEGADO inconferida
-- conserva valores históricos sem forjar provas.
-- Roda APENAS em D1 local/SQLite descartável após migration 0009.
DROP TRIGGER trg_r7_retencao_recebimento_journal;

CREATE TRIGGER trg_r7_fin05_requer_atestado_em_todo_recebimento_nativo
BEFORE INSERT ON recebimentos
WHEN NEW.tipo_movimento='RECEBIMENTO' AND NEW.origem_dado='NATIVO'
AND (
  (NEW.retencao_confirmada_cent>0 AND
    (NEW.retencao_atestado_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM retencao_atestados a
      WHERE a.id=NEW.retencao_atestado_id
        AND a.empresa_id=NEW.empresa_id
        AND a.conta_receber_id=NEW.conta_receber_id
        AND a.valor_confirmado_cent=NEW.retencao_confirmada_cent
    )))
  OR (NEW.retencao_confirmada_cent=0 AND NEW.retencao_atestado_id IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT,'R7 FIN05: retenção NATIVO exige atestado verificável mesmo sem diário'); END;

CREATE TRIGGER trg_r7_fin05_recebimento_nativo_economico_imutavel
BEFORE UPDATE OF empresa_id,conta_receber_id,retencao_confirmada_cent,
 retencao_atestado_id ON recebimentos
WHEN OLD.origem_dado='NATIVO' AND OLD.tipo_movimento='RECEBIMENTO'
AND (
  NEW.empresa_id IS NOT OLD.empresa_id
  OR NEW.conta_receber_id IS NOT OLD.conta_receber_id
  OR NEW.retencao_confirmada_cent IS NOT OLD.retencao_confirmada_cent
  OR NEW.retencao_atestado_id IS NOT OLD.retencao_atestado_id
)
BEGIN SELECT RAISE(ABORT,'R7 FIN05: retenção confirmada imutável'); END;
