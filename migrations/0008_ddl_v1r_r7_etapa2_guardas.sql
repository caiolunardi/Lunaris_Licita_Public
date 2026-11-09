-- R7 etapa 2 / LICITA-ROD-20261107-020
-- Aplicar APENAS localmente apos 0007; nenhuma aplicacao D1 remoto.
-- FIN05: a prova documental pertence à conta do mesmo tenant, não apenas
-- a um documento válido mas não relacionado.
CREATE TRIGGER trg_r8_fin05_comprovante_do_proprio_recebivel
BEFORE INSERT ON retencao_atestados
WHEN NOT EXISTS(
 SELECT 1 FROM documento_versoes v
 JOIN documento_vinculos link ON link.documento_id=v.documento_id
   AND link.empresa_id=v.empresa_id
 WHERE v.id=NEW.documento_versao_id AND v.empresa_id=NEW.empresa_id
 AND link.conta_receber_id=NEW.conta_receber_id
 AND link.papel='COMPROVANTE_CREDITO' AND link.ativo=1
)
BEGIN SELECT RAISE(ABORT,'R7 FIN05: comprovante deve pertencer a conta receber'); END;

-- Q07: um item com empenho CONFIRMADO não aceita reescrita econômica
-- ou reclassificação do resultado por SQL direto. Reversões são fatos novos.
CREATE TRIGGER trg_r8_q07_item_ganho_comprometido_imutavel
BEFORE UPDATE OF resultado,quantidade_prevista_mil,quantidade_ganha_mil,
 valor_final_unit_cent,licitacao_id,empresa_id ON licitacao_itens
WHEN (NEW.resultado IS NOT OLD.resultado
 OR NEW.quantidade_prevista_mil IS NOT OLD.quantidade_prevista_mil
 OR NEW.quantidade_ganha_mil IS NOT OLD.quantidade_ganha_mil
 OR NEW.valor_final_unit_cent IS NOT OLD.valor_final_unit_cent
 OR NEW.licitacao_id IS NOT OLD.licitacao_id
 OR NEW.empresa_id IS NOT OLD.empresa_id)
 AND EXISTS(SELECT 1 FROM empenho_itens ei
  JOIN empenhos e ON e.id=ei.empenho_id AND e.empresa_id=ei.empresa_id
  WHERE ei.licitacao_item_id=OLD.id AND ei.empresa_id=OLD.empresa_id
    AND e.situacao='CONFIRMADO')
BEGIN SELECT RAISE(ABORT,'R7 Q07: item comprometido nao pode ser reescrito'); END;
