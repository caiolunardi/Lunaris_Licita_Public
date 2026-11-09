-- LICITA-ROD-20261107-019 / R6 -- portas de extensao, SEM integracao PNCP/Orbita.
-- Apply em D1 LOCAL somente, na ordem 0001 -> 0002 -> 0003 -> 0004.
-- A migration e puramente aditiva: nao importa dados, nao altera tabelas base,
-- nao introduz origem_dado='ORBITA' e nao conecta outro banco a este produto.

-- Identidade externa de licitacao separada da PK interna e do registro manual.
-- A referencia canonica e fornecida por adaptador deterministico futuro (Worker).
CREATE TABLE licitacao_referencias_externas (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  provedor TEXT NOT NULL CHECK (
    length(provedor) BETWEEN 2 AND 48
    AND provedor=upper(trim(provedor))
    AND provedor NOT GLOB '*[^A-Z0-9_]*'
  ),
  referencia_externa TEXT NOT NULL CHECK (
    length(referencia_externa) BETWEEN 1 AND 256
    AND referencia_externa=trim(referencia_externa)
  ),
  modo_captura TEXT NOT NULL CHECK (modo_captura IN ('API','IMPORTACAO','MANUAL')),
  licitacao_id TEXT,
  vinculada_por_operacao_id TEXT,
  registrada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (licitacao_id IS NULL AND vinculada_por_operacao_id IS NULL)
    OR (licitacao_id IS NOT NULL AND vinculada_por_operacao_id IS NOT NULL)
  ),
  UNIQUE (empresa_id,provedor,referencia_externa),
  UNIQUE (id,empresa_id),
  FOREIGN KEY (licitacao_id,empresa_id) REFERENCES licitacoes(id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (vinculada_por_operacao_id,empresa_id)
    REFERENCES operacoes(id,empresa_id) ON DELETE RESTRICT
) STRICT;

-- Capturas de origem, versionadas e imutaveis. Payload bruto nao e reescrito
-- por normalizador futuro. A hash aqui e declarada, nao comprovada por SQLite.
CREATE TABLE licitacao_capturas_externas (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  referencia_id TEXT NOT NULL,
  revisao INTEGER NOT NULL CHECK (revisao>=1),
  chave_idempotencia TEXT NOT NULL CHECK (
    length(trim(chave_idempotencia)) BETWEEN 1 AND 256
  ),
  payload_bruto_json TEXT NOT NULL CHECK (
    json_valid(payload_bruto_json) AND
    json_type(payload_bruto_json) IN ('object','array')
  ),
  hash_bruto_sha256 TEXT NOT NULL CHECK (
    length(hash_bruto_sha256)=64 AND hash_bruto_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  normalizado_json TEXT CHECK (
    normalizado_json IS NULL
    OR (json_valid(normalizado_json) AND
        json_type(normalizado_json) IN ('object','array'))
  ),
  normalizador_versao TEXT,
  fonte_url TEXT,
  capturado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (normalizado_json IS NULL AND normalizador_versao IS NULL)
    OR (normalizado_json IS NOT NULL AND
        length(trim(coalesce(normalizador_versao,'')))>0)
  ),
  UNIQUE (referencia_id,revisao),
  UNIQUE (empresa_id,chave_idempotencia),
  UNIQUE (id,empresa_id),
  FOREIGN KEY (referencia_id,empresa_id)
    REFERENCES licitacao_referencias_externas(id,empresa_id) ON DELETE RESTRICT
) STRICT;

-- Vínculos ativos para donos tipados que nao tinham papel no núcleo V1.
-- Um titulo mensal continua possuindo seu BOLETO próprio; o modelo da regra
-- recorrente é um documento opcional e separado. Nunca deriva obrigacao.
CREATE TABLE documento_vinculos_extensao (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  documento_id TEXT NOT NULL,
  papel TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  licitacao_item_id TEXT,
  cotacao_id TEXT,
  recorrencia_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO'
    CHECK (origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  desativada_por_operacao_id TEXT,
  CHECK (
    (licitacao_item_id IS NOT NULL)
    + (cotacao_id IS NOT NULL)
    + (recorrencia_id IS NOT NULL) = 1
  ),
  CHECK (
       (papel IN ('ESPECIFICACAO_ITEM','PROPOSTA_ITEM') AND licitacao_item_id IS NOT NULL)
    OR (papel IN ('COTACAO_PDF','MEMORIA_CALCULO') AND cotacao_id IS NOT NULL)
    OR (papel IN ('CONTRATO_RECORRENCIA','BOLETO_MODELO') AND recorrencia_id IS NOT NULL)
    OR (papel NOT IN (
      'ESPECIFICACAO_ITEM','PROPOSTA_ITEM','COTACAO_PDF','MEMORIA_CALCULO',
      'CONTRATO_RECORRENCIA','BOLETO_MODELO'
    ) AND origem_dado='LEGADO' AND conferencia<>'VALIDADO' AND ativo=0)
  ),
  UNIQUE(id,empresa_id),
  FOREIGN KEY (documento_id,empresa_id) REFERENCES documentos(id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (licitacao_item_id,empresa_id) REFERENCES licitacao_itens(id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (cotacao_id,empresa_id) REFERENCES cotacoes_precos(id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (recorrencia_id,empresa_id) REFERENCES recorrencias(id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (desativada_por_operacao_id,empresa_id) REFERENCES operacoes(id,empresa_id) ON DELETE RESTRICT,
  CHECK ((ativo=1 AND desativada_por_operacao_id IS NULL)
      OR (ativo=0 AND (origem_dado='LEGADO' OR desativada_por_operacao_id IS NOT NULL)))
) STRICT;

CREATE UNIQUE INDEX uq_r6_doc_item_papel_ativo
  ON documento_vinculos_extensao(licitacao_item_id,papel)
  WHERE ativo=1 AND licitacao_item_id IS NOT NULL;
CREATE UNIQUE INDEX uq_r6_doc_cotacao_papel_ativo
  ON documento_vinculos_extensao(cotacao_id,papel)
  WHERE ativo=1 AND cotacao_id IS NOT NULL;
CREATE UNIQUE INDEX uq_r6_doc_recorrencia_papel_ativo
  ON documento_vinculos_extensao(recorrencia_id,papel)
  WHERE ativo=1 AND recorrencia_id IS NOT NULL;
CREATE INDEX ix_r6_ref_licitacao ON licitacao_referencias_externas(empresa_id,licitacao_id);
CREATE INDEX ix_r6_captura_ref_data ON licitacao_capturas_externas(empresa_id,referencia_id,capturado_em);

-- Publicacao de referencia e identidade separadas.
-- Nao auto-vincular licitacao na mesma insercao da referencia.
CREATE TRIGGER trg_r6_ref_insert_unlinked
BEFORE INSERT ON licitacao_referencias_externas
WHEN NEW.licitacao_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'R6: referencia deve nascer desvinculada'); END;

CREATE TRIGGER trg_r6_ref_no_replace
BEFORE INSERT ON licitacao_referencias_externas
WHEN EXISTS (
  SELECT 1 FROM licitacao_referencias_externas r
  WHERE r.id=NEW.id OR (
    r.empresa_id=NEW.empresa_id AND r.provedor=NEW.provedor
    AND r.referencia_externa=NEW.referencia_externa
  )
)
BEGIN SELECT RAISE(ABORT,'R6: identidade externa ja existe; REPLACE proibido'); END;

-- So uma ligacao explicita, apos ao menos uma captura, com operacao revisora.
-- Nao autentica JWT: Worker R7 e responsavel pela permissao do ator.
CREATE TRIGGER trg_r6_ref_update_somente_vinculo
BEFORE UPDATE ON licitacao_referencias_externas
WHEN NOT (
  OLD.licitacao_id IS NULL
  AND NEW.licitacao_id IS NOT NULL
  AND NEW.vinculada_por_operacao_id IS NOT NULL
  AND NEW.id IS OLD.id AND NEW.empresa_id IS OLD.empresa_id
  AND NEW.provedor IS OLD.provedor
  AND NEW.referencia_externa IS OLD.referencia_externa
  AND NEW.modo_captura IS OLD.modo_captura
  AND NEW.registrada_em IS OLD.registrada_em
)
BEGIN SELECT RAISE(ABORT,'R6: somente vinculo inicial e permitido'); END;

CREATE TRIGGER trg_r6_ref_link_evidencia
BEFORE UPDATE OF licitacao_id,vinculada_por_operacao_id ON licitacao_referencias_externas
WHEN NEW.licitacao_id IS NOT NULL
  AND (
    NOT EXISTS (
      SELECT 1 FROM licitacao_capturas_externas s
      WHERE s.referencia_id=OLD.id AND s.empresa_id=OLD.empresa_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM operacoes o
      WHERE o.id=NEW.vinculada_por_operacao_id
        AND o.empresa_id=NEW.empresa_id
        AND o.tipo='VINCULAR_REFERENCIA_EXTERNA'
        AND (o.ator_id IS NOT NULL
          OR length(trim(coalesce(o.ator_original,'')))>0)
    )
  )
BEGIN SELECT RAISE(ABORT,'R6: vinculo exige captura e operacao com ator'); END;

CREATE TRIGGER trg_r6_ref_auditar_vinculo
AFTER UPDATE OF licitacao_id ON licitacao_referencias_externas
WHEN OLD.licitacao_id IS NULL AND NEW.licitacao_id IS NOT NULL
BEGIN
 INSERT INTO eventos_auditoria
 (id,empresa_id,tipo_entidade,entidade_id_texto,licitacao_id,acao,
  data_hora,operacao_id,ator_id,ator_original,resumo)
 SELECT 'r6ref_'||lower(hex(randomblob(16))),NEW.empresa_id,
        'REFERENCIA_EXTERNA',NEW.id,NEW.licitacao_id,'VINCULAR_REFERENCIA_EXTERNA',
        strftime('%Y-%m-%dT%H:%M:%fZ','now'),o.id,o.ator_id,o.ator_original,
        NEW.provedor||':'||NEW.referencia_externa
 FROM operacoes o WHERE o.id=NEW.vinculada_por_operacao_id AND o.empresa_id=NEW.empresa_id;
END;

CREATE TRIGGER trg_r6_ref_no_delete BEFORE DELETE ON licitacao_referencias_externas
BEGIN SELECT RAISE(ABORT,'R6: referencia externa e historica'); END;

-- Snapshot e append-only, inclusive com PRAGMA recursive_triggers=OFF.
CREATE TRIGGER trg_r6_captura_no_update BEFORE UPDATE ON licitacao_capturas_externas
BEGIN SELECT RAISE(ABORT,'R6: captura imutavel; usar nova revisao'); END;
CREATE TRIGGER trg_r6_captura_no_delete BEFORE DELETE ON licitacao_capturas_externas
BEGIN SELECT RAISE(ABORT,'R6: captura nao pode ser apagada'); END;
CREATE TRIGGER trg_r6_captura_no_replace BEFORE INSERT ON licitacao_capturas_externas
WHEN EXISTS (
 SELECT 1 FROM licitacao_capturas_externas s
 WHERE s.id=NEW.id OR (s.referencia_id=NEW.referencia_id AND s.revisao=NEW.revisao)
    OR (s.empresa_id=NEW.empresa_id AND s.chave_idempotencia=NEW.chave_idempotencia)
)
BEGIN SELECT RAISE(ABORT,'R6: captura duplicada ou REPLACE destrutivo'); END;

-- Qualquer inativacao de documento ativo exige operacao com autor e deixa
-- evento append-only. Reativacao / troca de dono exige novo registro.
CREATE TRIGGER trg_r6_doc_ext_update_inativacao
BEFORE UPDATE ON documento_vinculos_extensao
WHEN NOT (
 OLD.ativo=1 AND NEW.ativo=0
 AND NEW.desativada_por_operacao_id IS NOT NULL
 AND NEW.id IS OLD.id AND NEW.empresa_id IS OLD.empresa_id
 AND NEW.documento_id IS OLD.documento_id
 AND NEW.papel IS OLD.papel
 AND NEW.licitacao_item_id IS OLD.licitacao_item_id
 AND NEW.cotacao_id IS OLD.cotacao_id
 AND NEW.recorrencia_id IS OLD.recorrencia_id
 AND NEW.origem_dado IS OLD.origem_dado
 AND NEW.conferencia IS OLD.conferencia
 AND NEW.criado_em IS OLD.criado_em
)
BEGIN SELECT RAISE(ABORT,'R6: documento nao pode trocar dono ou reativar'); END;

CREATE TRIGGER trg_r6_doc_ext_gate_inativacao
BEFORE UPDATE OF ativo,desativada_por_operacao_id ON documento_vinculos_extensao
WHEN NEW.ativo=0 AND NOT EXISTS(
 SELECT 1 FROM operacoes o
 WHERE o.id=NEW.desativada_por_operacao_id AND o.empresa_id=NEW.empresa_id
   AND o.tipo='DESATIVAR_VINCULO_DOCUMENTO'
   AND (o.ator_id IS NOT NULL OR length(trim(coalesce(o.ator_original,'')))>0)
)
BEGIN SELECT RAISE(ABORT,'R6: inativacao exige operacao com ator'); END;

CREATE TRIGGER trg_r6_doc_ext_audit_inativacao
AFTER UPDATE OF ativo ON documento_vinculos_extensao
WHEN OLD.ativo=1 AND NEW.ativo=0
BEGIN
 INSERT INTO eventos_auditoria
 (id,empresa_id,tipo_entidade,entidade_id_texto,acao,data_hora,
  operacao_id,ator_id,ator_original,resumo)
 SELECT 'r6doc_'||lower(hex(randomblob(16))),NEW.empresa_id,'DOCUMENTO_VINCULO',NEW.id,
        'DESATIVAR_VINCULO_DOCUMENTO',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        o.id,o.ator_id,o.ator_original,NEW.papel
 FROM operacoes o WHERE o.id=NEW.desativada_por_operacao_id AND o.empresa_id=NEW.empresa_id;
END;

CREATE TRIGGER trg_r6_doc_ext_no_delete BEFORE DELETE ON documento_vinculos_extensao
BEGIN SELECT RAISE(ABORT,'R6: documento historico nao pode sumir'); END;
CREATE TRIGGER trg_r6_doc_ext_no_replace BEFORE INSERT ON documento_vinculos_extensao
WHEN EXISTS(
 SELECT 1 FROM documento_vinculos_extensao v
 WHERE v.id=NEW.id OR (NEW.ativo=1 AND v.ativo=1 AND v.papel=NEW.papel AND
    (NEW.licitacao_item_id IS NOT NULL AND v.licitacao_item_id=NEW.licitacao_item_id
     OR NEW.cotacao_id IS NOT NULL AND v.cotacao_id=NEW.cotacao_id
     OR NEW.recorrencia_id IS NOT NULL AND v.recorrencia_id=NEW.recorrencia_id))
)
BEGIN SELECT RAISE(ABORT,'R6: vinculo existente nao pode ser substituido'); END;

-- A consulta unificada e somente leitura: novas extensoes NAO ocupam papeis
-- do nucleo nem mudam as 11 FKs tipadas do documento_vinculos legado.
CREATE VIEW v_documento_vinculos_tipados AS
SELECT v.id,v.empresa_id,v.documento_id,v.papel,v.ativo,'NUCLEO' AS camada,
 CASE
  WHEN v.licitacao_id IS NOT NULL THEN 'LICITACAO'
  WHEN v.licitacao_item_id IS NOT NULL THEN 'LICITACAO_ITEM'
  WHEN v.empenho_id IS NOT NULL THEN 'EMPENHO'
  WHEN v.compra_id IS NOT NULL THEN 'COMPRA'
  WHEN v.envio_id IS NOT NULL THEN 'ENVIO'
  WHEN v.nota_fiscal_id IS NOT NULL THEN 'NOTA_FISCAL'
  WHEN v.titulo_pagar_id IS NOT NULL THEN 'TITULO_PAGAR'
  WHEN v.titulo_baixa_id IS NOT NULL THEN 'TITULO_BAIXA'
  WHEN v.conta_receber_id IS NOT NULL THEN 'CONTA_RECEBER'
  WHEN v.recebimento_id IS NOT NULL THEN 'RECEBIMENTO'
  WHEN v.cotacao_id IS NOT NULL THEN 'COTACAO'
 END AS tipo_dono,
 coalesce(v.licitacao_id,v.licitacao_item_id,v.empenho_id,v.compra_id,
   v.envio_id,v.nota_fiscal_id,v.titulo_pagar_id,v.titulo_baixa_id,
   v.conta_receber_id,v.recebimento_id,v.cotacao_id) AS dono_id,
 v.origem_dado,v.conferencia
FROM documento_vinculos v
UNION ALL
SELECT v.id,v.empresa_id,v.documento_id,v.papel,v.ativo,'EXTENSAO' AS camada,
 CASE
  WHEN v.licitacao_item_id IS NOT NULL THEN 'LICITACAO_ITEM'
  WHEN v.cotacao_id IS NOT NULL THEN 'COTACAO'
  ELSE 'RECORRENCIA'
 END AS tipo_dono,
 coalesce(v.licitacao_item_id,v.cotacao_id,v.recorrencia_id) AS dono_id,
 v.origem_dado,v.conferencia
FROM documento_vinculos_extensao v;


-- Defesa transversal da R4 tambem nas novas tabelas R6, sem alterar 0002.
CREATE TRIGGER trg_r4_licitacao_referencias_externas_escopo_proveniencia
BEFORE UPDATE OF empresa_id ON licitacao_referencias_externas
WHEN NEW.empresa_id IS NOT OLD.empresa_id
BEGIN SELECT RAISE(ABORT,'R6: escopo da referencia imutavel'); END;

CREATE TRIGGER trg_r4_licitacao_capturas_externas_escopo_proveniencia
BEFORE UPDATE OF empresa_id ON licitacao_capturas_externas
WHEN NEW.empresa_id IS NOT OLD.empresa_id
BEGIN SELECT RAISE(ABORT,'R6: escopo da captura imutavel'); END;

CREATE TRIGGER trg_r4_documento_vinculos_extensao_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON documento_vinculos_extensao
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R6: escopo e origem de vinculo imutaveis'); END;
