-- R7 etapa 2: remediacao pontual dos GLOB compridos de R5 que
-- ultrapassam o limite de padrao no D1 workerd/Miniflare.
-- Mantem semantica: ISO UTC, data civil valida, hora, minuto, segundo,
-- e marco estritamente posterior a reabertura do ciclo anterior.
-- Apenas D1 --local; nenhuma mudanca de dados historicos nem remoto.
DROP TRIGGER trg_r5_encerramento_insercao_temporal;
CREATE TRIGGER trg_r5_encerramento_insercao_temporal
BEFORE INSERT ON licitacao_encerramentos
WHEN NOT (
 length(NEW.encerrada_em) IN (20,24)
 AND substr(NEW.encerrada_em,1,4) GLOB '[0-9][0-9][0-9][0-9]'
 AND substr(NEW.encerrada_em,6,2) GLOB '[0-9][0-9]'
 AND substr(NEW.encerrada_em,9,2) GLOB '[0-9][0-9]'
 AND substr(NEW.encerrada_em,12,2) GLOB '[0-9][0-9]'
 AND substr(NEW.encerrada_em,15,2) GLOB '[0-9][0-9]'
 AND substr(NEW.encerrada_em,18,2) GLOB '[0-9][0-9]'
 AND substr(NEW.encerrada_em,5,1)='-' AND substr(NEW.encerrada_em,8,1)='-'
 AND substr(NEW.encerrada_em,11,1)='T' AND substr(NEW.encerrada_em,14,1)=':'
 AND substr(NEW.encerrada_em,17,1)=':'
 AND ( (length(NEW.encerrada_em)=20 AND substr(NEW.encerrada_em,20,1)='Z')
   OR (length(NEW.encerrada_em)=24 AND substr(NEW.encerrada_em,20,1)='.'
      AND substr(NEW.encerrada_em,21,3) GLOB '[0-9][0-9][0-9]'
      AND substr(NEW.encerrada_em,24,1)='Z'))
 AND CAST(substr(NEW.encerrada_em,1,4) AS INTEGER) BETWEEN 1 AND 9999
 AND date(substr(NEW.encerrada_em,1,10),'+0 days')=substr(NEW.encerrada_em,1,10)
 AND CAST(substr(NEW.encerrada_em,12,2) AS INTEGER) BETWEEN 0 AND 23
 AND CAST(substr(NEW.encerrada_em,15,2) AS INTEGER) BETWEEN 0 AND 59
 AND CAST(substr(NEW.encerrada_em,18,2) AS INTEGER) BETWEEN 0 AND 59
)
 OR (NEW.reaberta_em IS NOT NULL AND
     (NOT (
 length(NEW.reaberta_em) IN (20,24)
 AND substr(NEW.reaberta_em,1,4) GLOB '[0-9][0-9][0-9][0-9]'
 AND substr(NEW.reaberta_em,6,2) GLOB '[0-9][0-9]'
 AND substr(NEW.reaberta_em,9,2) GLOB '[0-9][0-9]'
 AND substr(NEW.reaberta_em,12,2) GLOB '[0-9][0-9]'
 AND substr(NEW.reaberta_em,15,2) GLOB '[0-9][0-9]'
 AND substr(NEW.reaberta_em,18,2) GLOB '[0-9][0-9]'
 AND substr(NEW.reaberta_em,5,1)='-' AND substr(NEW.reaberta_em,8,1)='-'
 AND substr(NEW.reaberta_em,11,1)='T' AND substr(NEW.reaberta_em,14,1)=':'
 AND substr(NEW.reaberta_em,17,1)=':'
 AND ( (length(NEW.reaberta_em)=20 AND substr(NEW.reaberta_em,20,1)='Z')
   OR (length(NEW.reaberta_em)=24 AND substr(NEW.reaberta_em,20,1)='.'
      AND substr(NEW.reaberta_em,21,3) GLOB '[0-9][0-9][0-9]'
      AND substr(NEW.reaberta_em,24,1)='Z'))
 AND CAST(substr(NEW.reaberta_em,1,4) AS INTEGER) BETWEEN 1 AND 9999
 AND date(substr(NEW.reaberta_em,1,10),'+0 days')=substr(NEW.reaberta_em,1,10)
 AND CAST(substr(NEW.reaberta_em,12,2) AS INTEGER) BETWEEN 0 AND 23
 AND CAST(substr(NEW.reaberta_em,15,2) AS INTEGER) BETWEEN 0 AND 59
 AND CAST(substr(NEW.reaberta_em,18,2) AS INTEGER) BETWEEN 0 AND 59
)
      OR julianday(NEW.reaberta_em)<=julianday(NEW.encerrada_em)))
 OR EXISTS (
   SELECT 1 FROM licitacao_encerramentos prev
   WHERE prev.licitacao_id=NEW.licitacao_id
   AND prev.empresa_id=NEW.empresa_id AND prev.reaberta_em IS NOT NULL
   AND julianday(NEW.encerrada_em)<=julianday(prev.reaberta_em)
 )
BEGIN SELECT RAISE(ABORT,'R5: ciclo anterior a reabertura ou instante invalido'); END;

DROP TRIGGER trg_r5_reabertura_temporal;
CREATE TRIGGER trg_r5_reabertura_temporal
BEFORE UPDATE OF reaberta_em,motivo_reabertura ON licitacao_encerramentos
WHEN NEW.reaberta_em IS NOT NULL AND
 (NOT (
 length(NEW.reaberta_em) IN (20,24)
 AND substr(NEW.reaberta_em,1,4) GLOB '[0-9][0-9][0-9][0-9]'
 AND substr(NEW.reaberta_em,6,2) GLOB '[0-9][0-9]'
 AND substr(NEW.reaberta_em,9,2) GLOB '[0-9][0-9]'
 AND substr(NEW.reaberta_em,12,2) GLOB '[0-9][0-9]'
 AND substr(NEW.reaberta_em,15,2) GLOB '[0-9][0-9]'
 AND substr(NEW.reaberta_em,18,2) GLOB '[0-9][0-9]'
 AND substr(NEW.reaberta_em,5,1)='-' AND substr(NEW.reaberta_em,8,1)='-'
 AND substr(NEW.reaberta_em,11,1)='T' AND substr(NEW.reaberta_em,14,1)=':'
 AND substr(NEW.reaberta_em,17,1)=':'
 AND ( (length(NEW.reaberta_em)=20 AND substr(NEW.reaberta_em,20,1)='Z')
   OR (length(NEW.reaberta_em)=24 AND substr(NEW.reaberta_em,20,1)='.'
      AND substr(NEW.reaberta_em,21,3) GLOB '[0-9][0-9][0-9]'
      AND substr(NEW.reaberta_em,24,1)='Z'))
 AND CAST(substr(NEW.reaberta_em,1,4) AS INTEGER) BETWEEN 1 AND 9999
 AND date(substr(NEW.reaberta_em,1,10),'+0 days')=substr(NEW.reaberta_em,1,10)
 AND CAST(substr(NEW.reaberta_em,12,2) AS INTEGER) BETWEEN 0 AND 23
 AND CAST(substr(NEW.reaberta_em,15,2) AS INTEGER) BETWEEN 0 AND 59
 AND CAST(substr(NEW.reaberta_em,18,2) AS INTEGER) BETWEEN 0 AND 59
)
  OR julianday(NEW.reaberta_em)<=julianday(OLD.encerrada_em)
  OR length(trim(coalesce(NEW.motivo_reabertura,'')))=0
  OR (NEW.origem_dado='NATIVO' AND
     length(trim(coalesce(NEW.reaberta_por,'')))=0))
BEGIN SELECT RAISE(ABORT,'R5: reabertura exige data, motivo e autor valido'); END;
