-- LICITA-ROD-20261107-020 — R7 foundation (W1).
-- Completar 0001..0005 somente em D1 local descartavel. Nenhum deploy remoto.
-- Uma referencia bancaria NATIVA nao pode ser duplicada na mesma conta destino
-- enquanto existir recebimento nao estornado. D1 serializa INSERT dentro de
-- transacao; a segunda instrucao concorrente deve falhar/nao produzir credito.
-- Historico LEGADO potencialmente duplicado fica PENDENTE em quarentena
-- para conciliacao posterior, sem INVENTAR estorno/alterar o credito original.
CREATE TRIGGER trg_r7_recebimento_referencia_nativa_valida
BEFORE INSERT ON recebimentos
WHEN NEW.tipo_movimento='RECEBIMENTO' AND NEW.origem_dado='NATIVO'
 AND (
   (NEW.referencia_externa IS NULL) IS NOT (NEW.conta_destino IS NULL)
   OR (NEW.referencia_externa IS NOT NULL AND (
       length(trim(NEW.referencia_externa))=0 OR
       NEW.referencia_externa IS NOT trim(NEW.referencia_externa)
       OR length(trim(coalesce(NEW.conta_destino,'')))=0
       OR NEW.conta_destino IS NOT trim(NEW.conta_destino)
   ))
 )
BEGIN SELECT RAISE(ABORT,'R7 W1: referencia bancaria exige conta e chave canonica'); END;

CREATE TRIGGER trg_r7_recebimento_referencia_ativa_unica
BEFORE INSERT ON recebimentos
WHEN NEW.tipo_movimento='RECEBIMENTO' AND NEW.origem_dado='NATIVO'
 AND NEW.referencia_externa IS NOT NULL AND NEW.conta_destino IS NOT NULL
 AND EXISTS (
   SELECT 1 FROM recebimentos anterior
   WHERE anterior.empresa_id=NEW.empresa_id
     AND anterior.tipo_movimento='RECEBIMENTO'
     AND anterior.conta_destino=NEW.conta_destino
     AND anterior.referencia_externa=NEW.referencia_externa
     AND NOT EXISTS (
       SELECT 1 FROM recebimentos estorno
       WHERE estorno.empresa_id=anterior.empresa_id
         AND estorno.tipo_movimento='ESTORNO'
         AND estorno.estorno_de_id=anterior.id
     )
 )
BEGIN SELECT RAISE(ABORT,'R7 W1: referencia bancaria ativa ja utilizada'); END;
