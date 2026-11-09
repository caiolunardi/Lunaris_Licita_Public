-- LICITA-ROD-20261107-018 — R5: consultas, ciclos e higiene (LOCAL).
-- Sequencia obrigatoria: 0001 -> 0002 -> 0003. D1 remoto NAO autorizado.
-- A compatibilidade com dados LEGADO pendentes e preservada; nao criar prova falsa.

-- N12: o resumo nao deve tratar a alegacao legada como quitação validada.
-- A view expoe a origem e a conferencia para que dashboards nao convertam
-- DESCONHECIDO, pendencia ou quitação legada pendente em boleto ABERTO/PAGO.
DROP VIEW v_titulos_situacao;
CREATE VIEW v_titulos_situacao AS
SELECT t.id, t.empresa_id, t.valor_nominal_cent, t.vencimento, t.cancelado,
       t.origem_dado, t.conferencia, t.pago_legado_status,
       CASE
         WHEN t.cancelado=1 THEN 'CANCELADO'
         WHEN t.conferencia='INCONSISTENTE' THEN 'INCONSISTENTE'
         WHEN EXISTS (
           SELECT 1 FROM titulo_baixas b
           WHERE b.titulo_id=t.id AND b.empresa_id=t.empresa_id
             AND b.tipo='QUITACAO' AND b.origem_dado='LEGADO'
             AND b.conferencia<>'VALIDADO'
             AND NOT EXISTS (
               SELECT 1 FROM titulo_baixas d WHERE d.baixa_original_id=b.id
                 AND d.empresa_id=b.empresa_id AND d.tipo='DESFAZIMENTO')
         ) THEN 'PENDENTE_CONFERENCIA'
         WHEN t.origem_dado='LEGADO' AND t.pago_legado_status='SIM'
           AND NOT EXISTS (
             SELECT 1 FROM titulo_baixas b WHERE b.titulo_id=t.id
               AND b.empresa_id=t.empresa_id AND b.tipo='QUITACAO'
               AND NOT EXISTS (
                 SELECT 1 FROM titulo_baixas d WHERE d.baixa_original_id=b.id
                   AND d.empresa_id=b.empresa_id AND d.tipo='DESFAZIMENTO')
           ) THEN 'PAGO_LEGADO_SEM_BAIXA'
         WHEN t.origem_dado='LEGADO'
           AND (t.conferencia<>'VALIDADO' OR
                t.pago_legado_status='DESCONHECIDO' OR t.pago_legado_status IS NULL)
           THEN 'PENDENTE_CONFERENCIA'
         WHEN EXISTS (
           SELECT 1 FROM titulo_baixas b
           WHERE b.titulo_id=t.id AND b.empresa_id=t.empresa_id
             AND b.tipo='QUITACAO'
             AND NOT EXISTS (
               SELECT 1 FROM titulo_baixas d WHERE d.baixa_original_id=b.id
                 AND d.empresa_id=b.empresa_id AND d.tipo='DESFAZIMENTO')
         ) THEN 'PAGO'
         WHEN t.origem_dado='LEGADO' AND t.pago_legado_status='SIM'
           THEN 'PAGO_LEGADO_SEM_BAIXA'
         ELSE 'ABERTO'
       END AS situacao
FROM titulos_pagar t;

-- N13: parcela cancelada nao vira saldo confiavel nem entra em totais abertos.
-- Mantem os creditos observados para auditoria, nao os apresenta como saldo.
DROP VIEW v_contas_receber_saldos;
CREATE VIEW v_contas_receber_saldos AS
SELECT c.id, c.empresa_id, c.nota_fiscal_id, c.parcela, c.valor_bruto_cent,
       c.cancelada,
       coalesce(sum(a.valor_recebido_cent),0) AS creditado_cent,
       coalesce(sum(a.retencao_confirmada_cent),0) AS retido_cent,
       CASE
         WHEN c.cancelada=1 THEN 'CANCELADA'
         WHEN c.valor_bruto_cent IS NULL THEN 'DESCONHECIDO'
         WHEN coalesce(sum(CASE WHEN a.origem_dado='LEGADO'
            AND a.conferencia='INCONSISTENTE' THEN 1 ELSE 0 END),0)>0 THEN 'INCONSISTENTE'
         WHEN coalesce(sum(CASE WHEN a.origem_dado='LEGADO'
            AND a.conferencia='PENDENTE' THEN 1 ELSE 0 END),0)>0 THEN 'PENDENTE_CONFERENCIA'
         WHEN coalesce(sum(a.valor_recebido_cent),0)
              +coalesce(sum(a.retencao_confirmada_cent),0)>c.valor_bruto_cent
           THEN 'INCONSISTENTE'
         ELSE 'CONFERIDO'
       END AS estado_saldo,
       CASE
         WHEN c.cancelada=1 OR c.valor_bruto_cent IS NULL
           OR coalesce(sum(CASE WHEN a.origem_dado='LEGADO'
              AND a.conferencia<>'VALIDADO' THEN 1 ELSE 0 END),0)>0
           OR coalesce(sum(a.valor_recebido_cent),0)
              +coalesce(sum(a.retencao_confirmada_cent),0)>c.valor_bruto_cent
           THEN NULL
         ELSE c.valor_bruto_cent-coalesce(sum(a.valor_recebido_cent),0)
              -coalesce(sum(a.retencao_confirmada_cent),0)
       END AS saldo_cent
FROM contas_receber c
LEFT JOIN v_recebimentos_ativos a
  ON a.conta_receber_id=c.id AND a.empresa_id=c.empresa_id
GROUP BY c.id;

-- N16/A12: nenhum ciclo novo anterior a reabertura anterior pode ser ativo.
-- Instantes civis com formato inventado/invalidos nao sao marcadores de 24 meses.
-- Historicos invalidos sao armazenados em quarentena de migracao, nao projetados.
CREATE TRIGGER trg_r5_encerramento_insercao_temporal
BEFORE INSERT ON licitacao_encerramentos
WHEN NOT (
 ( (length(NEW.encerrada_em)=20 AND NEW.encerrada_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z')
   OR (length(NEW.encerrada_em)=24 AND NEW.encerrada_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z') )
 AND CAST(substr(NEW.encerrada_em,1,4) AS INTEGER) BETWEEN 1 AND 9999
 AND date(substr(NEW.encerrada_em,1,10),'+0 days')=substr(NEW.encerrada_em,1,10)
 AND CAST(substr(NEW.encerrada_em,12,2) AS INTEGER) BETWEEN 0 AND 23
 AND CAST(substr(NEW.encerrada_em,15,2) AS INTEGER) BETWEEN 0 AND 59
 AND CAST(substr(NEW.encerrada_em,18,2) AS INTEGER) BETWEEN 0 AND 59
)
 OR (NEW.reaberta_em IS NOT NULL AND (
      NOT (
 ( (length(NEW.reaberta_em)=20 AND NEW.reaberta_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z')
   OR (length(NEW.reaberta_em)=24 AND NEW.reaberta_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z') )
 AND CAST(substr(NEW.reaberta_em,1,4) AS INTEGER) BETWEEN 1 AND 9999
 AND date(substr(NEW.reaberta_em,1,10),'+0 days')=substr(NEW.reaberta_em,1,10)
 AND CAST(substr(NEW.reaberta_em,12,2) AS INTEGER) BETWEEN 0 AND 23
 AND CAST(substr(NEW.reaberta_em,15,2) AS INTEGER) BETWEEN 0 AND 59
 AND CAST(substr(NEW.reaberta_em,18,2) AS INTEGER) BETWEEN 0 AND 59
) OR julianday(NEW.reaberta_em)<=julianday(NEW.encerrada_em)))
 OR EXISTS (
    SELECT 1 FROM licitacao_encerramentos prev
    WHERE prev.licitacao_id=NEW.licitacao_id
      AND prev.empresa_id=NEW.empresa_id AND prev.reaberta_em IS NOT NULL
      AND julianday(NEW.encerrada_em)<=julianday(prev.reaberta_em)
 )
BEGIN SELECT RAISE(ABORT,'R5: ciclo anterior a reabertura ou instante invalido'); END;

CREATE TRIGGER trg_r5_reabertura_temporal
BEFORE UPDATE OF reaberta_em,motivo_reabertura ON licitacao_encerramentos
WHEN NEW.reaberta_em IS NOT NULL AND (
     NOT (
 ( (length(NEW.reaberta_em)=20 AND NEW.reaberta_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z')
   OR (length(NEW.reaberta_em)=24 AND NEW.reaberta_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z') )
 AND CAST(substr(NEW.reaberta_em,1,4) AS INTEGER) BETWEEN 1 AND 9999
 AND date(substr(NEW.reaberta_em,1,10),'+0 days')=substr(NEW.reaberta_em,1,10)
 AND CAST(substr(NEW.reaberta_em,12,2) AS INTEGER) BETWEEN 0 AND 23
 AND CAST(substr(NEW.reaberta_em,15,2) AS INTEGER) BETWEEN 0 AND 59
 AND CAST(substr(NEW.reaberta_em,18,2) AS INTEGER) BETWEEN 0 AND 59
) OR julianday(NEW.reaberta_em)<=julianday(OLD.encerrada_em)
     OR length(trim(coalesce(NEW.motivo_reabertura,'')))=0
     OR (NEW.origem_dado='NATIVO' AND length(trim(coalesce(NEW.reaberta_por,'')))=0)
 )
BEGIN SELECT RAISE(ABORT,'R5: reabertura exige data, motivo e autor valido'); END;

CREATE TRIGGER trg_r5_ciclo_reabertura_inserida
BEFORE INSERT ON licitacao_encerramentos
WHEN NEW.reaberta_em IS NOT NULL
 AND (length(trim(coalesce(NEW.motivo_reabertura,'')))=0
      OR (NEW.origem_dado='NATIVO' AND length(trim(coalesce(NEW.reaberta_por,'')))=0))
BEGIN SELECT RAISE(ABORT,'R5: ciclo historico reaberto exige motivo e origem'); END;

-- N17: qualquer fonte de QUITACAO compete pela unica quitacao ativa.
-- A segunda QUITACAO legada nao e apagada: importador registra sua evidencia
-- na fila de quarentena, mas nao a ativa como pagamento duplo.
DROP TRIGGER trg_baixa_uma_ativa;
CREATE TRIGGER trg_baixa_uma_ativa
BEFORE INSERT ON titulo_baixas
WHEN NEW.tipo='QUITACAO'
 AND EXISTS (
    SELECT 1 FROM titulo_baixas b
    WHERE b.titulo_id=NEW.titulo_id AND b.empresa_id=NEW.empresa_id
      AND b.tipo='QUITACAO'
      AND NOT EXISTS (
        SELECT 1 FROM titulo_baixas d
        WHERE d.baixa_original_id=b.id AND d.empresa_id=b.empresa_id
          AND d.tipo='DESFAZIMENTO')
 )
BEGIN SELECT RAISE(ABORT,'R5: titulo ja possui quitacao ativa'); END;

CREATE TRIGGER trg_r5_desfazimento_motivo
BEFORE INSERT ON titulo_baixas
WHEN NEW.tipo='DESFAZIMENTO'
 AND (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND length(trim(coalesce(NEW.motivo,'')))=0
BEGIN SELECT RAISE(ABORT,'R5: desfazimento exige motivo'); END;

-- N18: um registro NATIVO ou LEGADO validado nao usa classificação mista;
-- a quarentena LEGADO pendente preserva exatamente o que existia.
CREATE TRIGGER trg_r5_titulo_classificacao_insert
BEFORE INSERT ON titulos_pagar
WHEN NEW.tipo='FORNECEDOR' AND (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND (length(trim(coalesce(NEW.beneficiario,'')))>0
   OR length(trim(coalesce(NEW.categoria_despesa,'')))>0)
BEGIN SELECT RAISE(ABORT,'R5: titulo fornecedor nao aceita atributos DIVERSO'); END;
CREATE TRIGGER trg_r5_titulo_classificacao_update
BEFORE UPDATE ON titulos_pagar
WHEN NEW.tipo='FORNECEDOR' AND (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND (length(trim(coalesce(NEW.beneficiario,'')))>0
   OR length(trim(coalesce(NEW.categoria_despesa,'')))>0)
BEGIN SELECT RAISE(ABORT,'R5: titulo fornecedor nao aceita atributos DIVERSO'); END;

CREATE TRIGGER trg_r5_titulo_cancelar_insert
BEFORE INSERT ON titulos_pagar
WHEN NEW.cancelado=1 AND (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND length(trim(coalesce(NEW.motivo_cancelamento,'')))=0
BEGIN SELECT RAISE(ABORT,'R5: cancelamento de titulo requer justificativa'); END;
CREATE TRIGGER trg_r5_titulo_cancelar_update
BEFORE UPDATE OF cancelado,conferencia,motivo_cancelamento ON titulos_pagar
WHEN NEW.cancelado=1 AND (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND length(trim(coalesce(NEW.motivo_cancelamento,'')))=0
BEGIN SELECT RAISE(ABORT,'R5: cancelamento de titulo requer justificativa'); END;
-- Uma reativacao futura exigira comando auditado proprio do Worker;
-- nao reescrever silenciosamente cancelamento antigo.
CREATE TRIGGER trg_r5_titulo_nao_descancelar
BEFORE UPDATE OF cancelado ON titulos_pagar
WHEN OLD.cancelado=1 AND NEW.cancelado=0
BEGIN SELECT RAISE(ABORT,'R5: reativacao exige procedimento auditado'); END;

CREATE TRIGGER trg_r5_parcela_cancelar_insert
BEFORE INSERT ON contas_receber
WHEN NEW.cancelada=1 AND (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND length(trim(coalesce(NEW.motivo_cancelamento,'')))=0
BEGIN SELECT RAISE(ABORT,'R5: cancelar parcela exige motivo'); END;
CREATE TRIGGER trg_r5_parcela_cancelar_update
BEFORE UPDATE OF cancelada,conferencia,motivo_cancelamento ON contas_receber
WHEN NEW.cancelada=1 AND (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND length(trim(coalesce(NEW.motivo_cancelamento,'')))=0
BEGIN SELECT RAISE(ABORT,'R5: cancelar parcela exige motivo'); END;
CREATE TRIGGER trg_r5_parcela_nao_reativar_sem_rastro
BEFORE UPDATE OF cancelada ON contas_receber
WHEN OLD.cancelada=1 AND NEW.cancelada=0
BEGIN SELECT RAISE(ABORT,'R5: reativacao de parcela exige nova linha e trilha'); END;

-- N19/A03: a versao pode voltar a INCONSISTENTE/AUSENTE quando perde copia;
-- ao certificar VERIFICADO, a operacao identifica explicitamente o atestador.
CREATE TRIGGER trg_r5_versao_verificar_atribuir_ator
BEFORE UPDATE OF estado_integridade ON documento_versoes
WHEN NEW.estado_integridade='VERIFICADO' AND OLD.estado_integridade<>'VERIFICADO'
 AND NOT EXISTS (
   SELECT 1 FROM operacoes o WHERE o.id=NEW.operacao_id
     AND o.empresa_id=NEW.empresa_id
     AND (o.ator_id IS NOT NULL OR length(trim(coalesce(o.ator_original,'')))>0)
 )
BEGIN SELECT RAISE(ABORT,'R5: verificar versao exige operacao com ator'); END;

DROP TRIGGER trg_versao_estado_evento;
CREATE TRIGGER trg_versao_estado_evento
AFTER UPDATE OF estado_integridade ON documento_versoes
WHEN OLD.estado_integridade IS NOT NEW.estado_integridade
BEGIN
 INSERT INTO eventos_auditoria
 (id,empresa_id,tipo_entidade,entidade_id_texto,acao,data_hora,
  operacao_id,ator_id,ator_original,resumo)
 VALUES
 ('verif_'||lower(hex(randomblob(16))),NEW.empresa_id,'DOCUMENTO_VERSAO',NEW.id,
  'VERIFICAR_ESTADO',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  CASE WHEN OLD.estado_integridade='VERIFICADO'
         AND NEW.estado_integridade='INCONSISTENTE'
         AND NOT EXISTS (SELECT 1 FROM documento_localizacoes l
                         WHERE l.versao_id=NEW.id AND l.empresa_id=NEW.empresa_id
                           AND l.status='VERIFICADO')
       THEN NULL ELSE NEW.operacao_id END,
  CASE WHEN OLD.estado_integridade='VERIFICADO'
         AND NEW.estado_integridade='INCONSISTENTE'
         AND NOT EXISTS (SELECT 1 FROM documento_localizacoes l
                         WHERE l.versao_id=NEW.id AND l.empresa_id=NEW.empresa_id
                           AND l.status='VERIFICADO')
       THEN NULL ELSE (SELECT o.ator_id FROM operacoes o
                        WHERE o.id=NEW.operacao_id AND o.empresa_id=NEW.empresa_id) END,
  CASE WHEN OLD.estado_integridade='VERIFICADO'
         AND NEW.estado_integridade='INCONSISTENTE'
         AND NOT EXISTS (SELECT 1 FROM documento_localizacoes l
                         WHERE l.versao_id=NEW.id AND l.empresa_id=NEW.empresa_id
                           AND l.status='VERIFICADO')
       THEN 'SISTEMA_D1_PERDA_DE_COPIA'
       ELSE coalesce((SELECT o.ator_original FROM operacoes o
                     WHERE o.id=NEW.operacao_id AND o.empresa_id=NEW.empresa_id),
                     'SISTEMA_D1_TRANSICAO_AUTOMATICA') END,
  OLD.estado_integridade||'->'||NEW.estado_integridade);
END;
