-- LICITA-ROD-20261107-020 / R7 W5: limites quantitativos transacionais.
-- D1 LOCAL somente. Regras derivadas do conjunto de itens na mesma instrucao
-- e nunca de SELECT do Worker seguido de UPDATE separado.
-- LEGADO PENDENTE permanece importavel: conferência exige saneamento posterior.
-- Para NATIVO, itens comprometidos com pais confirmados nao excedem os
-- limites conhecidos em licitacao_itens -> empenho_itens -> compra_itens
-- -> envio_itens e nota_fiscal_itens.

CREATE TRIGGER trg_r7_empenho_limite_insert
BEFORE INSERT ON empenho_itens
WHEN (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND EXISTS(SELECT 1 FROM empenhos par WHERE par.id=NEW.empenho_id AND par.empresa_id=NEW.empresa_id AND par.situacao IN ('CONFIRMADO'))
 AND EXISTS (
    SELECT 1 FROM licitacao_itens lim
    WHERE lim.id=NEW.licitacao_item_id AND lim.empresa_id=NEW.empresa_id AND lim.resultado='GANHO'
      AND lim.quantidade_ganha_mil IS NOT NULL
      AND (
        NEW.quantidade_mil IS NULL OR NEW.quantidade_mil
        + COALESCE((
           SELECT SUM(x.quantidade_mil) FROM empenho_itens x
             JOIN empenhos p ON p.id=x.empenho_id AND p.empresa_id=x.empresa_id
           WHERE x.empresa_id=NEW.empresa_id
             AND x.licitacao_item_id=NEW.licitacao_item_id
             AND p.situacao IN ('CONFIRMADO')
             
        ),0)>lim.quantidade_ganha_mil
      )
  )
BEGIN SELECT RAISE(ABORT,'R7: empenho excede quantidade comprometida'); END;

CREATE TRIGGER trg_r7_empenho_limite_update
BEFORE UPDATE ON empenho_itens
WHEN (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND EXISTS(SELECT 1 FROM empenhos par WHERE par.id=NEW.empenho_id AND par.empresa_id=NEW.empresa_id AND par.situacao IN ('CONFIRMADO'))
 AND EXISTS (
    SELECT 1 FROM licitacao_itens lim
    WHERE lim.id=NEW.licitacao_item_id AND lim.empresa_id=NEW.empresa_id AND lim.resultado='GANHO'
      AND lim.quantidade_ganha_mil IS NOT NULL
      AND (
        NEW.quantidade_mil IS NULL OR NEW.quantidade_mil
        + COALESCE((
           SELECT SUM(x.quantidade_mil) FROM empenho_itens x
             JOIN empenhos p ON p.id=x.empenho_id AND p.empresa_id=x.empresa_id
           WHERE x.empresa_id=NEW.empresa_id
             AND x.licitacao_item_id=NEW.licitacao_item_id
             AND p.situacao IN ('CONFIRMADO')
             AND x.id<>OLD.id
        ),0)>lim.quantidade_ganha_mil
      )
  )
BEGIN SELECT RAISE(ABORT,'R7: empenho excede quantidade comprometida'); END;

CREATE TRIGGER trg_r7_empenho_limite_confirmacao
BEFORE UPDATE OF situacao ON empenhos
WHEN NEW.situacao IN ('CONFIRMADO') AND (OLD.situacao IS NULL OR OLD.situacao NOT IN ('CONFIRMADO'))
 AND EXISTS (
  SELECT 1 FROM empenho_itens x
    JOIN licitacao_itens lim ON lim.id=x.licitacao_item_id AND lim.empresa_id=x.empresa_id
  WHERE x.empenho_id=NEW.id AND x.empresa_id=NEW.empresa_id
    AND (x.origem_dado='NATIVO' OR x.conferencia='VALIDADO')
    AND lim.resultado='GANHO'
    AND lim.quantidade_ganha_mil IS NOT NULL
    AND (
      x.quantidade_mil IS NULL OR
      COALESCE((SELECT SUM(own.quantidade_mil)
         FROM empenho_itens own WHERE own.empenho_id=NEW.id
         AND own.licitacao_item_id=x.licitacao_item_id
         AND own.empresa_id=NEW.empresa_id),0)
      +COALESCE((SELECT SUM(other.quantidade_mil)
         FROM empenho_itens other
         JOIN empenhos op ON op.id=other.empenho_id
           AND op.empresa_id=other.empresa_id
         WHERE other.licitacao_item_id=x.licitacao_item_id AND other.empresa_id=NEW.empresa_id
           AND other.empenho_id<>NEW.id
           AND op.situacao IN ('CONFIRMADO')),0)>lim.quantidade_ganha_mil
    )
 )
BEGIN SELECT RAISE(ABORT,'R7: empenho confirmacao excede limite'); END;

CREATE TRIGGER trg_r7_compra_limite_insert
BEFORE INSERT ON compra_itens
WHEN (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND EXISTS(SELECT 1 FROM compras par WHERE par.id=NEW.compra_id AND par.empresa_id=NEW.empresa_id AND par.situacao IN ('CONFIRMADA'))
 AND EXISTS (
    SELECT 1 FROM empenho_itens lim
    WHERE lim.id=NEW.empenho_item_id AND lim.empresa_id=NEW.empresa_id 
      AND lim.quantidade_mil IS NOT NULL
      AND (
        NEW.quantidade_mil IS NULL OR NEW.quantidade_mil
        + COALESCE((
           SELECT SUM(x.quantidade_mil) FROM compra_itens x
             JOIN compras p ON p.id=x.compra_id AND p.empresa_id=x.empresa_id
           WHERE x.empresa_id=NEW.empresa_id
             AND x.empenho_item_id=NEW.empenho_item_id
             AND p.situacao IN ('CONFIRMADA')
             
        ),0)>lim.quantidade_mil
      )
  )
BEGIN SELECT RAISE(ABORT,'R7: compra excede quantidade comprometida'); END;

CREATE TRIGGER trg_r7_compra_limite_update
BEFORE UPDATE ON compra_itens
WHEN (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND EXISTS(SELECT 1 FROM compras par WHERE par.id=NEW.compra_id AND par.empresa_id=NEW.empresa_id AND par.situacao IN ('CONFIRMADA'))
 AND EXISTS (
    SELECT 1 FROM empenho_itens lim
    WHERE lim.id=NEW.empenho_item_id AND lim.empresa_id=NEW.empresa_id 
      AND lim.quantidade_mil IS NOT NULL
      AND (
        NEW.quantidade_mil IS NULL OR NEW.quantidade_mil
        + COALESCE((
           SELECT SUM(x.quantidade_mil) FROM compra_itens x
             JOIN compras p ON p.id=x.compra_id AND p.empresa_id=x.empresa_id
           WHERE x.empresa_id=NEW.empresa_id
             AND x.empenho_item_id=NEW.empenho_item_id
             AND p.situacao IN ('CONFIRMADA')
             AND x.id<>OLD.id
        ),0)>lim.quantidade_mil
      )
  )
BEGIN SELECT RAISE(ABORT,'R7: compra excede quantidade comprometida'); END;

CREATE TRIGGER trg_r7_compra_limite_confirmacao
BEFORE UPDATE OF situacao ON compras
WHEN NEW.situacao IN ('CONFIRMADA') AND (OLD.situacao IS NULL OR OLD.situacao NOT IN ('CONFIRMADA'))
 AND EXISTS (
  SELECT 1 FROM compra_itens x
    JOIN empenho_itens lim ON lim.id=x.empenho_item_id AND lim.empresa_id=x.empresa_id
  WHERE x.compra_id=NEW.id AND x.empresa_id=NEW.empresa_id
    AND (x.origem_dado='NATIVO' OR x.conferencia='VALIDADO')
    
    AND lim.quantidade_mil IS NOT NULL
    AND (
      x.quantidade_mil IS NULL OR
      COALESCE((SELECT SUM(own.quantidade_mil)
         FROM compra_itens own WHERE own.compra_id=NEW.id
         AND own.empenho_item_id=x.empenho_item_id
         AND own.empresa_id=NEW.empresa_id),0)
      +COALESCE((SELECT SUM(other.quantidade_mil)
         FROM compra_itens other
         JOIN compras op ON op.id=other.compra_id
           AND op.empresa_id=other.empresa_id
         WHERE other.empenho_item_id=x.empenho_item_id AND other.empresa_id=NEW.empresa_id
           AND other.compra_id<>NEW.id
           AND op.situacao IN ('CONFIRMADA')),0)>lim.quantidade_mil
    )
 )
BEGIN SELECT RAISE(ABORT,'R7: compra confirmacao excede limite'); END;

CREATE TRIGGER trg_r7_nf_limite_insert
BEFORE INSERT ON nota_fiscal_itens
WHEN (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND EXISTS(SELECT 1 FROM notas_fiscais par WHERE par.id=NEW.nota_fiscal_id AND par.empresa_id=NEW.empresa_id AND par.situacao IN ('EMITIDA','APRESENTADA'))
 AND EXISTS (
    SELECT 1 FROM empenho_itens lim
    WHERE lim.id=NEW.empenho_item_id AND lim.empresa_id=NEW.empresa_id 
      AND lim.quantidade_mil IS NOT NULL
      AND (
        NEW.quantidade_mil IS NULL OR NEW.quantidade_mil
        + COALESCE((
           SELECT SUM(x.quantidade_mil) FROM nota_fiscal_itens x
             JOIN notas_fiscais p ON p.id=x.nota_fiscal_id AND p.empresa_id=x.empresa_id
           WHERE x.empresa_id=NEW.empresa_id
             AND x.empenho_item_id=NEW.empenho_item_id
             AND p.situacao IN ('EMITIDA','APRESENTADA')
             
        ),0)>lim.quantidade_mil
      )
  )
BEGIN SELECT RAISE(ABORT,'R7: nf excede quantidade comprometida'); END;

CREATE TRIGGER trg_r7_nf_limite_update
BEFORE UPDATE ON nota_fiscal_itens
WHEN (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND EXISTS(SELECT 1 FROM notas_fiscais par WHERE par.id=NEW.nota_fiscal_id AND par.empresa_id=NEW.empresa_id AND par.situacao IN ('EMITIDA','APRESENTADA'))
 AND EXISTS (
    SELECT 1 FROM empenho_itens lim
    WHERE lim.id=NEW.empenho_item_id AND lim.empresa_id=NEW.empresa_id 
      AND lim.quantidade_mil IS NOT NULL
      AND (
        NEW.quantidade_mil IS NULL OR NEW.quantidade_mil
        + COALESCE((
           SELECT SUM(x.quantidade_mil) FROM nota_fiscal_itens x
             JOIN notas_fiscais p ON p.id=x.nota_fiscal_id AND p.empresa_id=x.empresa_id
           WHERE x.empresa_id=NEW.empresa_id
             AND x.empenho_item_id=NEW.empenho_item_id
             AND p.situacao IN ('EMITIDA','APRESENTADA')
             AND x.id<>OLD.id
        ),0)>lim.quantidade_mil
      )
  )
BEGIN SELECT RAISE(ABORT,'R7: nf excede quantidade comprometida'); END;

CREATE TRIGGER trg_r7_nf_limite_confirmacao
BEFORE UPDATE OF situacao ON notas_fiscais
WHEN NEW.situacao IN ('EMITIDA','APRESENTADA') AND (OLD.situacao IS NULL OR OLD.situacao NOT IN ('EMITIDA','APRESENTADA'))
 AND EXISTS (
  SELECT 1 FROM nota_fiscal_itens x
    JOIN empenho_itens lim ON lim.id=x.empenho_item_id AND lim.empresa_id=x.empresa_id
  WHERE x.nota_fiscal_id=NEW.id AND x.empresa_id=NEW.empresa_id
    AND (x.origem_dado='NATIVO' OR x.conferencia='VALIDADO')
    
    AND lim.quantidade_mil IS NOT NULL
    AND (
      x.quantidade_mil IS NULL OR
      COALESCE((SELECT SUM(own.quantidade_mil)
         FROM nota_fiscal_itens own WHERE own.nota_fiscal_id=NEW.id
         AND own.empenho_item_id=x.empenho_item_id
         AND own.empresa_id=NEW.empresa_id),0)
      +COALESCE((SELECT SUM(other.quantidade_mil)
         FROM nota_fiscal_itens other
         JOIN notas_fiscais op ON op.id=other.nota_fiscal_id
           AND op.empresa_id=other.empresa_id
         WHERE other.empenho_item_id=x.empenho_item_id AND other.empresa_id=NEW.empresa_id
           AND other.nota_fiscal_id<>NEW.id
           AND op.situacao IN ('EMITIDA','APRESENTADA')),0)>lim.quantidade_mil
    )
 )
BEGIN SELECT RAISE(ABORT,'R7: nf confirmacao excede limite'); END;

CREATE TRIGGER trg_r7_envio_limite_insert
BEFORE INSERT ON envio_itens
WHEN (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND EXISTS (
   SELECT 1 FROM envios e WHERE e.id=NEW.envio_id
     AND e.empresa_id=NEW.empresa_id AND e.situacao IN ('DESPACHADO','ENTREGUE')
 )
 AND EXISTS (
   SELECT 1 FROM compra_itens ci
     JOIN compras c ON c.id=ci.compra_id AND c.empresa_id=ci.empresa_id
   WHERE ci.id=NEW.compra_item_id AND ci.empresa_id=NEW.empresa_id
     AND (
       c.situacao IS NOT 'CONFIRMADA'
       OR ci.quantidade_mil IS NULL OR NEW.quantidade_mil IS NULL
       OR NEW.quantidade_mil+COALESCE((
         SELECT SUM(x.quantidade_mil) FROM envio_itens x
         JOIN envios ev ON ev.id=x.envio_id AND ev.empresa_id=x.empresa_id
         WHERE x.empresa_id=NEW.empresa_id
           AND x.compra_item_id=NEW.compra_item_id
           AND ev.situacao IN ('DESPACHADO','ENTREGUE')
           
       ),0)>ci.quantidade_mil
     )
 )
BEGIN SELECT RAISE(ABORT,'R7: remessa maior que compra confirmada'); END;

CREATE TRIGGER trg_r7_envio_limite_update
BEFORE UPDATE ON envio_itens
WHEN (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
 AND EXISTS (
   SELECT 1 FROM envios e WHERE e.id=NEW.envio_id
     AND e.empresa_id=NEW.empresa_id AND e.situacao IN ('DESPACHADO','ENTREGUE')
 )
 AND EXISTS (
   SELECT 1 FROM compra_itens ci
     JOIN compras c ON c.id=ci.compra_id AND c.empresa_id=ci.empresa_id
   WHERE ci.id=NEW.compra_item_id AND ci.empresa_id=NEW.empresa_id
     AND (
       c.situacao IS NOT 'CONFIRMADA'
       OR ci.quantidade_mil IS NULL OR NEW.quantidade_mil IS NULL
       OR NEW.quantidade_mil+COALESCE((
         SELECT SUM(x.quantidade_mil) FROM envio_itens x
         JOIN envios ev ON ev.id=x.envio_id AND ev.empresa_id=x.empresa_id
         WHERE x.empresa_id=NEW.empresa_id
           AND x.compra_item_id=NEW.compra_item_id
           AND ev.situacao IN ('DESPACHADO','ENTREGUE')
           AND x.id<>OLD.id
       ),0)>ci.quantidade_mil
     )
 )
BEGIN SELECT RAISE(ABORT,'R7: remessa maior que compra confirmada'); END;

CREATE TRIGGER trg_r7_envio_limite_confirmacao
BEFORE UPDATE OF situacao ON envios
WHEN NEW.situacao IN ('DESPACHADO','ENTREGUE')
 AND (OLD.situacao IS NULL OR OLD.situacao NOT IN ('DESPACHADO','ENTREGUE'))
 AND EXISTS (
    SELECT 1 FROM envio_itens i
      JOIN compra_itens ci ON ci.id=i.compra_item_id AND ci.empresa_id=i.empresa_id
      JOIN compras c ON c.id=ci.compra_id AND c.empresa_id=ci.empresa_id
    WHERE i.envio_id=NEW.id AND i.empresa_id=NEW.empresa_id
      AND (i.origem_dado='NATIVO' OR i.conferencia='VALIDADO')
      AND (
          c.situacao IS NOT 'CONFIRMADA'
          OR ci.quantidade_mil IS NULL OR i.quantidade_mil IS NULL
          OR (SELECT COALESCE(SUM(own.quantidade_mil),0)
              FROM envio_itens own WHERE own.envio_id=NEW.id
                AND own.compra_item_id=i.compra_item_id
                AND own.empresa_id=NEW.empresa_id)
          + (SELECT COALESCE(SUM(other.quantidade_mil),0)
              FROM envio_itens other JOIN envios e
                ON e.id=other.envio_id AND e.empresa_id=other.empresa_id
              WHERE other.compra_item_id=i.compra_item_id
                AND other.empresa_id=NEW.empresa_id
                AND other.envio_id<>NEW.id
                AND e.situacao IN ('DESPACHADO','ENTREGUE'))>ci.quantidade_mil
      )
 )
BEGIN SELECT RAISE(ABORT,'R7: envio nao pode despachar acima do comprado'); END;

-- A quantidade ja confirmada/faturada nao pode ser apagada do saldo pela
-- reducao silenciosa do item pai. Correcoes devem usar revisao auditada.
CREATE TRIGGER trg_r7_empenho_item_nao_rebaixar_quantidade
BEFORE UPDATE OF quantidade_mil ON empenho_itens
WHEN OLD.quantidade_mil IS NOT NEW.quantidade_mil
 AND (OLD.origem_dado='NATIVO' OR OLD.conferencia='VALIDADO')
 AND EXISTS (SELECT 1 FROM empenhos e WHERE e.id=OLD.empenho_id
   AND e.empresa_id=OLD.empresa_id AND e.situacao='CONFIRMADO')
 AND EXISTS (SELECT 1 FROM compra_itens i JOIN compras c
     ON c.id=i.compra_id AND c.empresa_id=i.empresa_id
   WHERE i.empenho_item_id=OLD.id AND i.empresa_id=OLD.empresa_id
     AND c.situacao='CONFIRMADA')
BEGIN SELECT RAISE(ABORT,'R7: item de empenho comprometido nao reescreve quantidade'); END;
