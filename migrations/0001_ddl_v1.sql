-- Lunaris Licita / DDL V1 / schema integral (39 tabelas)
-- Compatível com SQLite STRICT; Cloudflare D1: FKs ativadas por padrão.
-- APENAS para ensaios locais; nenhuma execução remota aprovada.
-- Preserva IDs legados; não contem dados de clientes ou anexos.
-- NÃO aplicar com --remote até validação adversarial e autorização específica.
-- Migração versionada: executar UMA única vez, não usar IF NOT EXISTS para ocultar drift.


-- empresas
CREATE TABLE empresas (
  id TEXT NOT NULL PRIMARY KEY,
  nome TEXT NOT NULL,
  documento_identificacao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT
) STRICT;

-- usuarios
CREATE TABLE usuarios (
  id TEXT NOT NULL PRIMARY KEY,
  access_issuer TEXT NOT NULL,
  access_subject TEXT NOT NULL,
  email_normalizado TEXT NOT NULL,
  nome TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT,
  UNIQUE(access_issuer, access_subject)
) STRICT;

-- usuarios_empresas
CREATE TABLE usuarios_empresas (
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  papel TEXT NOT NULL CHECK (papel IS NULL OR papel IN ('ADMIN','OPERADOR','CONSULTA')),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  PRIMARY KEY(usuario_id, empresa_id)
) STRICT;

-- orgaos
CREATE TABLE orgaos (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  nome TEXT NOT NULL,
  nome_normalizado TEXT,
  cnpj TEXT,
  uasg TEXT,
  contato TEXT,
  email TEXT,
  telefone TEXT,
  endereco_entrega_padrao TEXT,
  observacoes TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, empresa_id)
) STRICT;

-- fornecedores
CREATE TABLE fornecedores (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  nome TEXT NOT NULL,
  nome_original_legado TEXT,
  nome_normalizado TEXT,
  cnpj TEXT,
  contato TEXT,
  email TEXT,
  telefone TEXT,
  observacoes TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  legado_migrado_em TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, empresa_id)
) STRICT;

-- licitacoes
CREATE TABLE licitacoes (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  orgao_id TEXT NOT NULL,
  numero TEXT NOT NULL,
  numero_normalizado TEXT,
  ano INTEGER CHECK (ano IS NULL OR ano BETWEEN 1900 AND 9999),
  modalidade TEXT,
  objeto TEXT,
  portal TEXT,
  url_processo TEXT,
  limite_proposta_em TEXT,
  inicio_disputa_em TEXT,
  decisao_participacao TEXT  CHECK (decisao_participacao IS NULL OR decisao_participacao IN ('PENDENTE','PARTICIPAR','NAO_PARTICIPAR')),
  motivo_decisao TEXT,
  situacao_participacao TEXT  CHECK (situacao_participacao IS NULL OR situacao_participacao IN ('EM_ANALISE','EM_PREPARACAO','AGUARDANDO_DISPUTA','RESULTADO_PENDENTE','CANCELADA')),
  responsavel_texto TEXT,
  encerrada_em TEXT,
  motivo_encerramento TEXT,
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, orgao_id, empresa_id),
  FOREIGN KEY (orgao_id, empresa_id) REFERENCES orgaos (id, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- licitacao_itens
CREATE TABLE licitacao_itens (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  licitacao_id TEXT NOT NULL,
  numero_item TEXT NOT NULL,
  numero_item_normalizado TEXT,
  lote TEXT,
  lote_normalizado TEXT,
  descricao_exigida TEXT,
  unidade TEXT,
  quantidade_prevista_mil INTEGER  CHECK (quantidade_prevista_mil IS NULL OR quantidade_prevista_mil BETWEEN 0 AND 9007199254740991),
  especificacao_exigida TEXT,
  produto_ofertado TEXT,
  marca_ofertada TEXT,
  modelo_ofertado TEXT,
  especificacao_ofertada TEXT,
  valor_referencia_unit_cent INTEGER  CHECK (valor_referencia_unit_cent IS NULL OR valor_referencia_unit_cent BETWEEN 0 AND 9007199254740991),
  custo_estimado_unit_cent INTEGER  CHECK (custo_estimado_unit_cent IS NULL OR custo_estimado_unit_cent BETWEEN 0 AND 9007199254740991),
  frete_estimado_cent INTEGER  CHECK (frete_estimado_cent IS NULL OR frete_estimado_cent BETWEEN 0 AND 9007199254740991),
  outros_custos_estimados_cent INTEGER  CHECK (outros_custos_estimados_cent IS NULL OR outros_custos_estimados_cent BETWEEN 0 AND 9007199254740991),
  tributos_estimados_cent INTEGER  CHECK (tributos_estimados_cent IS NULL OR tributos_estimados_cent BETWEEN 0 AND 9007199254740991),
  valor_proposta_unit_cent INTEGER  CHECK (valor_proposta_unit_cent IS NULL OR valor_proposta_unit_cent BETWEEN 0 AND 9007199254740991),
  resultado TEXT  CHECK (resultado IS NULL OR resultado IN ('PENDENTE','GANHO','PERDIDO','CANCELADO')),
  quantidade_ganha_mil INTEGER  CHECK (quantidade_ganha_mil IS NULL OR quantidade_ganha_mil BETWEEN 0 AND 9007199254740991),
  valor_final_unit_cent INTEGER  CHECK (valor_final_unit_cent IS NULL OR valor_final_unit_cent BETWEEN 0 AND 9007199254740991),
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, licitacao_id, empresa_id),
  FOREIGN KEY (licitacao_id, empresa_id) REFERENCES licitacoes (id, empresa_id) ON DELETE RESTRICT,
  CHECK(quantidade_ganha_mil IS NULL OR quantidade_prevista_mil IS NULL OR quantidade_ganha_mil <= quantidade_prevista_mil),
  CHECK(resultado <> 'GANHO' OR (origem_dado='LEGADO' AND conferencia<>'VALIDADO') OR (coalesce(quantidade_ganha_mil,0)>0 AND coalesce(valor_final_unit_cent,0)>0)),
  UNIQUE(id, empresa_id)
) STRICT;

-- empenhos
CREATE TABLE empenhos (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  licitacao_id TEXT NOT NULL,
  orgao_id_escopo TEXT NOT NULL,
  numero TEXT NOT NULL,
  numero_normalizado TEXT,
  ano INTEGER CHECK (ano IS NULL OR ano BETWEEN 1900 AND 9999),
  emissao TEXT  CHECK (emissao IS NULL OR (emissao GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(emissao,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(emissao,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(emissao,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(emissao,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(emissao,1,4) AS INTEGER)%400=0 OR (CAST(substr(emissao,1,4) AS INTEGER)%4=0 AND CAST(substr(emissao,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(emissao,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  recebido_em TEXT  CHECK (recebido_em IS NULL OR (recebido_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(recebido_em,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(recebido_em,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(recebido_em,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(recebido_em,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(recebido_em,1,4) AS INTEGER)%400=0 OR (CAST(substr(recebido_em,1,4) AS INTEGER)%4=0 AND CAST(substr(recebido_em,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(recebido_em,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  valor_documento_cent INTEGER  CHECK (valor_documento_cent IS NULL OR valor_documento_cent BETWEEN 0 AND 9007199254740991),
  texto_prazo_entrega TEXT,
  marco_prazo_entrega TEXT,
  data_base_entrega TEXT  CHECK (data_base_entrega IS NULL OR (data_base_entrega GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_base_entrega,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_base_entrega,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_base_entrega,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_base_entrega,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_base_entrega,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_base_entrega,1,4) AS INTEGER)%4=0 AND CAST(substr(data_base_entrega,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_base_entrega,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  prazo_entrega_dias INTEGER CHECK (prazo_entrega_dias IS NULL OR prazo_entrega_dias >= 0),
  tipo_dias_entrega TEXT  CHECK (tipo_dias_entrega IS NULL OR tipo_dias_entrega IN ('CORRIDOS','UTEIS','DATA_FIXA')),
  data_limite_entrega TEXT  CHECK (data_limite_entrega IS NULL OR (data_limite_entrega GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_limite_entrega,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_limite_entrega,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_limite_entrega,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_limite_entrega,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_limite_entrega,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_limite_entrega,1,4) AS INTEGER)%4=0 AND CAST(substr(data_limite_entrega,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_limite_entrega,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  endereco_entrega TEXT,
  contato_entrega TEXT,
  instrucoes_entrega TEXT,
  situacao TEXT  CHECK (situacao IS NULL OR situacao IN ('RASCUNHO','CONFIRMADO','CANCELADO')),
  motivo_alteracao_prazo TEXT,
  referencia_alteracao_prazo TEXT,
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, licitacao_id, empresa_id),
  UNIQUE(id, orgao_id_escopo, empresa_id),
  FOREIGN KEY (licitacao_id, orgao_id_escopo, empresa_id) REFERENCES licitacoes (id, orgao_id, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- empenho_itens
CREATE TABLE empenho_itens (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  empenho_id TEXT NOT NULL,
  licitacao_item_id TEXT NOT NULL,
  licitacao_id_escopo TEXT NOT NULL,
  numero_item_documento TEXT,
  descricao TEXT,
  unidade TEXT,
  quantidade_mil INTEGER  CHECK (quantidade_mil IS NULL OR quantidade_mil > 0 AND quantidade_mil <= 9007199254740991),
  valor_unit_cent INTEGER  CHECK (valor_unit_cent IS NULL OR valor_unit_cent BETWEEN 0 AND 9007199254740991),
  marca TEXT,
  modelo TEXT,
  especificacao TEXT,
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, empenho_id, empresa_id),
  FOREIGN KEY (empenho_id, licitacao_id_escopo, empresa_id) REFERENCES empenhos (id, licitacao_id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (licitacao_item_id, licitacao_id_escopo, empresa_id) REFERENCES licitacao_itens (id, licitacao_id, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- compras
CREATE TABLE compras (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  empenho_id TEXT NOT NULL,
  fornecedor_id TEXT NOT NULL,
  numero_pedido TEXT,
  data_compra TEXT  CHECK (data_compra IS NULL OR (data_compra GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_compra,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_compra,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_compra,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_compra,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_compra,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_compra,1,4) AS INTEGER)%4=0 AND CAST(substr(data_compra,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_compra,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  frete_cent INTEGER  CHECK (frete_cent IS NULL OR frete_cent BETWEEN 0 AND 9007199254740991),
  outros_custos_cent INTEGER  CHECK (outros_custos_cent IS NULL OR outros_custos_cent BETWEEN 0 AND 9007199254740991),
  condicao_pagamento TEXT,
  previsao_despacho TEXT  CHECK (previsao_despacho IS NULL OR (previsao_despacho GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(previsao_despacho,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(previsao_despacho,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(previsao_despacho,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(previsao_despacho,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(previsao_despacho,1,4) AS INTEGER)%400=0 OR (CAST(substr(previsao_despacho,1,4) AS INTEGER)%4=0 AND CAST(substr(previsao_despacho,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(previsao_despacho,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  previsao_entrega TEXT  CHECK (previsao_entrega IS NULL OR (previsao_entrega GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(previsao_entrega,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(previsao_entrega,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(previsao_entrega,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(previsao_entrega,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(previsao_entrega,1,4) AS INTEGER)%400=0 OR (CAST(substr(previsao_entrega,1,4) AS INTEGER)%4=0 AND CAST(substr(previsao_entrega,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(previsao_entrega,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  situacao TEXT  CHECK (situacao IS NULL OR situacao IN ('RASCUNHO','CONFIRMADA','CANCELADA')),
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, empenho_id, empresa_id),
  UNIQUE(id, fornecedor_id, empresa_id),
  FOREIGN KEY (empenho_id, empresa_id) REFERENCES empenhos (id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (fornecedor_id, empresa_id) REFERENCES fornecedores (id, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- compra_itens
CREATE TABLE compra_itens (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  compra_id TEXT NOT NULL,
  empenho_item_id TEXT NOT NULL,
  empenho_id_escopo TEXT NOT NULL,
  produto_comprado TEXT,
  marca TEXT,
  modelo TEXT,
  especificacao TEXT,
  unidade TEXT,
  quantidade_mil INTEGER  CHECK (quantidade_mil IS NULL OR quantidade_mil > 0 AND quantidade_mil <= 9007199254740991),
  valor_unit_cent INTEGER  CHECK (valor_unit_cent IS NULL OR valor_unit_cent BETWEEN 0 AND 9007199254740991),
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, empenho_id_escopo, empresa_id),
  FOREIGN KEY (compra_id, empenho_id_escopo, empresa_id) REFERENCES compras (id, empenho_id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (empenho_item_id, empenho_id_escopo, empresa_id) REFERENCES empenho_itens (id, empenho_id, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- envios
CREATE TABLE envios (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  empenho_id TEXT NOT NULL,
  origem TEXT,
  transportadora TEXT,
  codigo_rastreio TEXT,
  url_rastreio TEXT,
  data_despacho TEXT  CHECK (data_despacho IS NULL OR (data_despacho GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_despacho,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_despacho,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_despacho,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_despacho,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_despacho,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_despacho,1,4) AS INTEGER)%4=0 AND CAST(substr(data_despacho,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_despacho,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  previsao_entrega TEXT  CHECK (previsao_entrega IS NULL OR (previsao_entrega GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(previsao_entrega,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(previsao_entrega,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(previsao_entrega,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(previsao_entrega,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(previsao_entrega,1,4) AS INTEGER)%400=0 OR (CAST(substr(previsao_entrega,1,4) AS INTEGER)%4=0 AND CAST(substr(previsao_entrega,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(previsao_entrega,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  data_entrega TEXT  CHECK (data_entrega IS NULL OR (data_entrega GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_entrega,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_entrega,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_entrega,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_entrega,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_entrega,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_entrega,1,4) AS INTEGER)%4=0 AND CAST(substr(data_entrega,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_entrega,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  recebedor TEXT,
  endereco_entrega TEXT,
  situacao TEXT  CHECK (situacao IS NULL OR situacao IN ('PLANEJADO','DESPACHADO','ENTREGUE','CANCELADO')),
  ocorrencia TEXT,
  ocorrencia_resolvida_em TEXT,
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, empenho_id, empresa_id),
  FOREIGN KEY (empenho_id, empresa_id) REFERENCES empenhos (id, empresa_id) ON DELETE RESTRICT,
  CHECK(situacao <> 'ENTREGUE' OR (origem_dado='LEGADO' AND conferencia<>'VALIDADO') OR data_entrega IS NOT NULL),
  UNIQUE(id, empresa_id)
) STRICT;

-- envio_itens
CREATE TABLE envio_itens (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  envio_id TEXT NOT NULL,
  compra_item_id TEXT NOT NULL,
  empenho_id_escopo TEXT NOT NULL,
  quantidade_mil INTEGER  CHECK (quantidade_mil IS NULL OR quantidade_mil > 0 AND quantidade_mil <= 9007199254740991),
  quantidade_aceita_mil INTEGER NOT NULL CHECK (quantidade_aceita_mil IS NULL OR quantidade_aceita_mil BETWEEN 0 AND 9007199254740991),
  quantidade_recusada_mil INTEGER NOT NULL CHECK (quantidade_recusada_mil IS NULL OR quantidade_recusada_mil BETWEEN 0 AND 9007199254740991),
  motivo_recusa TEXT,
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (envio_id, empenho_id_escopo, empresa_id) REFERENCES envios (id, empenho_id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (compra_item_id, empenho_id_escopo, empresa_id) REFERENCES compra_itens (id, empenho_id_escopo, empresa_id) ON DELETE RESTRICT,
  CHECK(quantidade_mil IS NULL OR quantidade_aceita_mil + quantidade_recusada_mil <= quantidade_mil),
  CHECK(quantidade_recusada_mil = 0 OR (origem_dado='LEGADO' AND conferencia<>'VALIDADO') OR length(trim(coalesce(motivo_recusa,''))) > 0),
  UNIQUE(id, empresa_id)
) STRICT;

-- notas_fiscais
CREATE TABLE notas_fiscais (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  empenho_id TEXT NOT NULL,
  orgao_id_escopo TEXT NOT NULL,
  numero TEXT,
  numero_normalizado TEXT,
  serie TEXT,
  chave_acesso TEXT,
  emissao TEXT  CHECK (emissao IS NULL OR (emissao GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(emissao,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(emissao,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(emissao,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(emissao,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(emissao,1,4) AS INTEGER)%400=0 OR (CAST(substr(emissao,1,4) AS INTEGER)%4=0 AND CAST(substr(emissao,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(emissao,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  apresentada_em TEXT  CHECK (apresentada_em IS NULL OR (apresentada_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(apresentada_em,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(apresentada_em,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(apresentada_em,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(apresentada_em,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(apresentada_em,1,4) AS INTEGER)%400=0 OR (CAST(substr(apresentada_em,1,4) AS INTEGER)%4=0 AND CAST(substr(apresentada_em,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(apresentada_em,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  protocolo TEXT,
  valor_documento_cent INTEGER  CHECK (valor_documento_cent IS NULL OR valor_documento_cent BETWEEN 0 AND 9007199254740991),
  marco_pagamento TEXT,
  data_base_pagamento TEXT  CHECK (data_base_pagamento IS NULL OR (data_base_pagamento GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_base_pagamento,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_base_pagamento,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_base_pagamento,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_base_pagamento,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_base_pagamento,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_base_pagamento,1,4) AS INTEGER)%4=0 AND CAST(substr(data_base_pagamento,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_base_pagamento,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  prazo_pagamento_dias INTEGER CHECK (prazo_pagamento_dias IS NULL OR prazo_pagamento_dias >= 0),
  tipo_dias_pagamento TEXT  CHECK (tipo_dias_pagamento IS NULL OR tipo_dias_pagamento IN ('CORRIDOS','UTEIS','DATA_FIXA')),
  situacao TEXT  CHECK (situacao IS NULL OR situacao IN ('RASCUNHO','EMITIDA','APRESENTADA','CANCELADA')),
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, empenho_id, empresa_id),
  FOREIGN KEY (empenho_id, orgao_id_escopo, empresa_id) REFERENCES empenhos (id, orgao_id_escopo, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- nota_fiscal_itens
CREATE TABLE nota_fiscal_itens (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  nota_fiscal_id TEXT NOT NULL,
  empenho_item_id TEXT NOT NULL,
  empenho_id_escopo TEXT NOT NULL,
  numero_item_documento TEXT,
  descricao TEXT,
  unidade TEXT,
  quantidade_mil INTEGER  CHECK (quantidade_mil IS NULL OR quantidade_mil > 0 AND quantidade_mil <= 9007199254740991),
  valor_unit_cent INTEGER  CHECK (valor_unit_cent IS NULL OR valor_unit_cent BETWEEN 0 AND 9007199254740991),
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (nota_fiscal_id, empenho_id_escopo, empresa_id) REFERENCES notas_fiscais (id, empenho_id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (empenho_item_id, empenho_id_escopo, empresa_id) REFERENCES empenho_itens (id, empenho_id, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- recorrencias
CREATE TABLE recorrencias (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  beneficiario TEXT NOT NULL,
  categoria_despesa TEXT NOT NULL,
  descricao_boleto TEXT,
  valor_atual_cent INTEGER  CHECK (valor_atual_cent IS NULL OR valor_atual_cent > 0 AND valor_atual_cent <= 9007199254740991),
  dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  primeiro_vencimento TEXT NOT NULL CHECK (primeiro_vencimento IS NULL OR (primeiro_vencimento GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(primeiro_vencimento,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(primeiro_vencimento,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(primeiro_vencimento,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(primeiro_vencimento,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(primeiro_vencimento,1,4) AS INTEGER)%400=0 OR (CAST(substr(primeiro_vencimento,1,4) AS INTEGER)%4=0 AND CAST(substr(primeiro_vencimento,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(primeiro_vencimento,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  ultima_competencia TEXT  CHECK (ultima_competencia IS NULL OR (length(ultima_competencia) = 7 AND ultima_competencia GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(ultima_competencia,6,2) BETWEEN '01' AND '12')),
  estado TEXT  CHECK (estado IS NULL OR estado IN ('ATIVA','ENCERRADA','LEGADO_PENDENTE')),
  status_geracao TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, empresa_id)
) STRICT;

-- titulos_pagar
CREATE TABLE titulos_pagar (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IS NULL OR tipo IN ('FORNECEDOR','DIVERSO')),
  compra_id TEXT,
  fornecedor_id TEXT,
  fornecedor_nome_original TEXT,
  beneficiario TEXT,
  categoria_despesa TEXT,
  descricao_boleto TEXT,
  recorrencia_id TEXT,
  competencia TEXT  CHECK (competencia IS NULL OR (length(competencia) = 7 AND competencia GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(competencia,6,2) BETWEEN '01' AND '12')),
  valor_nominal_cent INTEGER  CHECK (valor_nominal_cent IS NULL OR valor_nominal_cent > 0 AND valor_nominal_cent <= 9007199254740991),
  vencimento TEXT  CHECK (vencimento IS NULL OR (vencimento GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(vencimento,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(vencimento,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(vencimento,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(vencimento,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(vencimento,1,4) AS INTEGER)%400=0 OR (CAST(substr(vencimento,1,4) AS INTEGER)%4=0 AND CAST(substr(vencimento,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(vencimento,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  observacoes TEXT,
  cancelado INTEGER NOT NULL DEFAULT 0 CHECK (cancelado IN (0,1)),
  motivo_cancelamento TEXT,
  pago_legado_status TEXT  CHECK (pago_legado_status IS NULL OR pago_legado_status IN ('SIM','NAO','DESCONHECIDO')),
  data_pagamento_legado TEXT  CHECK (data_pagamento_legado IS NULL OR (data_pagamento_legado GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_pagamento_legado,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_pagamento_legado,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_pagamento_legado,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_pagamento_legado,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_pagamento_legado,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_pagamento_legado,1,4) AS INTEGER)%4=0 AND CAST(substr(data_pagamento_legado,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_pagamento_legado,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  valor_pago_legado_cent INTEGER  CHECK (valor_pago_legado_cent IS NULL OR valor_pago_legado_cent BETWEEN 0 AND 9007199254740991),
  legado_migrado_em TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  CHECK((recorrencia_id IS NULL AND competencia IS NULL) OR (recorrencia_id IS NOT NULL AND competencia IS NOT NULL)),
  CHECK(recorrencia_id IS NULL OR tipo = 'DIVERSO'),
  CHECK(tipo <> 'DIVERSO' OR (compra_id IS NULL AND fornecedor_id IS NULL) OR (origem_dado='LEGADO' AND conferencia <> 'VALIDADO')),
  CHECK(tipo <> 'DIVERSO' OR (origem_dado='LEGADO' AND conferencia<>'VALIDADO') OR (length(trim(coalesce(beneficiario,'')))>0 AND length(trim(coalesce(categoria_despesa,'')))>0)),
  UNIQUE(id, compra_id, fornecedor_id, empresa_id),
  -- Compra opcional para boletos historicos e avulsos, MAS nunca referencia quebrada.
  CHECK(compra_id IS NULL OR (tipo='FORNECEDOR' AND fornecedor_id IS NOT NULL)),
  -- Boleto avulso fornecedor: sem compra, mas com identificacao legivel.
  CHECK(tipo<>'FORNECEDOR' OR origem_dado='LEGADO'
        OR fornecedor_id IS NOT NULL OR length(trim(coalesce(fornecedor_nome_original,'')))>0),
  FOREIGN KEY (compra_id, empresa_id) REFERENCES compras (id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (compra_id, fornecedor_id, empresa_id) REFERENCES compras (id, fornecedor_id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (fornecedor_id, empresa_id) REFERENCES fornecedores (id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (recorrencia_id, empresa_id) REFERENCES recorrencias (id, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- titulo_baixas
CREATE TABLE titulo_baixas (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  titulo_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IS NULL OR tipo IN ('QUITACAO','DESFAZIMENTO')),
  baixa_original_id TEXT,
  data_pagamento TEXT  CHECK (data_pagamento IS NULL OR (data_pagamento GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_pagamento,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_pagamento,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_pagamento,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_pagamento,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_pagamento,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_pagamento,1,4) AS INTEGER)%4=0 AND CAST(substr(data_pagamento,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_pagamento,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  valor_pago_cent INTEGER  CHECK (valor_pago_cent IS NULL OR valor_pago_cent BETWEEN 0 AND 9007199254740991),
  comprovante_documento_id TEXT,
  motivo TEXT,
  ator_id TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id, titulo_id, empresa_id),
  FOREIGN KEY (titulo_id, empresa_id) REFERENCES titulos_pagar (id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (baixa_original_id, titulo_id, empresa_id) REFERENCES titulo_baixas (id, titulo_id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (comprovante_documento_id, empresa_id) REFERENCES documentos (id, empresa_id) ON DELETE RESTRICT,
  CHECK((tipo='QUITACAO' AND baixa_original_id IS NULL) OR (tipo='DESFAZIMENTO' AND baixa_original_id IS NOT NULL)),
  CHECK(tipo='DESFAZIMENTO' OR origem_dado='LEGADO' OR (data_pagamento IS NOT NULL AND valor_pago_cent > 0)),
  UNIQUE(id, empresa_id)
) STRICT;

-- recorrencia_revisoes
CREATE TABLE recorrencia_revisoes (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  recorrencia_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IS NULL OR tipo IN ('VALOR','ENCERRAR')),
  valor_antes_cent INTEGER  CHECK (valor_antes_cent IS NULL OR valor_antes_cent BETWEEN 0 AND 9007199254740991),
  valor_depois_cent INTEGER  CHECK (valor_depois_cent IS NULL OR valor_depois_cent BETWEEN 0 AND 9007199254740991),
  fim_antes TEXT  CHECK (fim_antes IS NULL OR (length(fim_antes) = 7 AND fim_antes GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(fim_antes,6,2) BETWEEN '01' AND '12')),
  fim_depois TEXT  CHECK (fim_depois IS NULL OR (length(fim_depois) = 7 AND fim_depois GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(fim_depois,6,2) BETWEEN '01' AND '12')),
  vigente_a_partir TEXT  CHECK (vigente_a_partir IS NULL OR (length(vigente_a_partir) = 7 AND vigente_a_partir GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(vigente_a_partir,6,2) BETWEEN '01' AND '12')),
  ator_id TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (recorrencia_id, empresa_id) REFERENCES recorrencias (id, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- contas_receber
CREATE TABLE contas_receber (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  nota_fiscal_id TEXT NOT NULL,
  parcela INTEGER NOT NULL CHECK(parcela >= 1),
  valor_bruto_cent INTEGER  CHECK (valor_bruto_cent IS NULL OR valor_bruto_cent > 0 AND valor_bruto_cent <= 9007199254740991),
  retencao_prevista_cent INTEGER  CHECK (retencao_prevista_cent IS NULL OR retencao_prevista_cent BETWEEN 0 AND 9007199254740991),
  marco_vencimento TEXT,
  data_base TEXT  CHECK (data_base IS NULL OR (data_base GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_base,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_base,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_base,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_base,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_base,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_base,1,4) AS INTEGER)%4=0 AND CAST(substr(data_base,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_base,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  vencimento TEXT  CHECK (vencimento IS NULL OR (vencimento GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(vencimento,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(vencimento,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(vencimento,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(vencimento,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(vencimento,1,4) AS INTEGER)%400=0 OR (CAST(substr(vencimento,1,4) AS INTEGER)%4=0 AND CAST(substr(vencimento,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(vencimento,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  motivo_ajuste_vencimento TEXT,
  cancelada INTEGER NOT NULL DEFAULT 0 CHECK (cancelada IN (0,1)),
  motivo_cancelamento TEXT,
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  -- N01: unicidade condicionada a parcela ATIVA no indice parcial.
  UNIQUE(id,nota_fiscal_id,empresa_id),
  FOREIGN KEY (nota_fiscal_id, empresa_id) REFERENCES notas_fiscais (id, empresa_id) ON DELETE RESTRICT,
  CHECK(valor_bruto_cent IS NULL OR retencao_prevista_cent IS NULL OR retencao_prevista_cent <= valor_bruto_cent),
  UNIQUE(id, empresa_id)
) STRICT;

-- recebimentos
CREATE TABLE recebimentos (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  conta_receber_id TEXT NOT NULL,
  tipo_movimento TEXT NOT NULL CHECK (tipo_movimento IS NULL OR tipo_movimento IN ('RECEBIMENTO','ESTORNO')),
  estorno_de_id TEXT,
  data_credito TEXT NOT NULL CHECK (data_credito IS NULL OR (data_credito GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_credito,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_credito,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_credito,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_credito,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_credito,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_credito,1,4) AS INTEGER)%4=0 AND CAST(substr(data_credito,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_credito,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  valor_recebido_cent INTEGER NOT NULL CHECK (valor_recebido_cent IS NULL OR valor_recebido_cent BETWEEN 0 AND 9007199254740991),
  retencao_confirmada_cent INTEGER NOT NULL CHECK (retencao_confirmada_cent IS NULL OR retencao_confirmada_cent BETWEEN 0 AND 9007199254740991),
  conta_destino TEXT,
  referencia_externa TEXT,
  motivo TEXT,
  observacoes TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  conferencia_legado_original TEXT CHECK (
    conferencia_legado_original IS NULL OR (
      origem_dado='LEGADO' AND conferencia_legado_original IN ('PENDENTE','VALIDADO','INCONSISTENTE')
    )
  ),
  UNIQUE(id, conta_receber_id, empresa_id),
  FOREIGN KEY (conta_receber_id, empresa_id) REFERENCES contas_receber (id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (estorno_de_id, conta_receber_id, empresa_id) REFERENCES recebimentos (id, conta_receber_id, empresa_id) ON DELETE RESTRICT,
  CHECK(valor_recebido_cent + retencao_confirmada_cent > 0),
  CHECK((tipo_movimento='RECEBIMENTO' AND estorno_de_id IS NULL) OR (tipo_movimento='ESTORNO' AND estorno_de_id IS NOT NULL AND length(trim(coalesce(motivo,'')))>0)),
  UNIQUE(id, empresa_id)
) STRICT;

-- N14: atestado de verificacao aditivo, sem reescrever o movimento bancario.
CREATE TABLE recebimento_conferencias (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  recebimento_id TEXT NOT NULL,
  revisao INTEGER NOT NULL DEFAULT 1 CHECK(revisao>=1),
  substitui_conferencia_id TEXT,
  resultado TEXT NOT NULL CHECK(resultado IN ('VALIDADO','INCONSISTENTE')),
  justificativa TEXT NOT NULL CHECK(length(trim(justificativa))>0),
  evidencia_ref TEXT NOT NULL CHECK(length(trim(evidencia_ref))>0),
  conferido_por TEXT NOT NULL CHECK(length(trim(conferido_por))>0),
  conferido_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  operacao_id TEXT,
  UNIQUE(id,recebimento_id,empresa_id),
  UNIQUE(recebimento_id,empresa_id,revisao),
  CHECK((revisao=1 AND substitui_conferencia_id IS NULL)
     OR (revisao>1 AND substitui_conferencia_id IS NOT NULL)),
  FOREIGN KEY(recebimento_id,empresa_id) REFERENCES recebimentos(id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY(substitui_conferencia_id,recebimento_id,empresa_id)
    REFERENCES recebimento_conferencias(id,recebimento_id,empresa_id) ON DELETE RESTRICT
) STRICT;

-- cotacoes_precos
CREATE TABLE cotacoes_precos (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  descricao TEXT,
  fornecedor_texto TEXT,
  referencia_texto TEXT,
  licitacao_id TEXT,
  item_licitacao_id TEXT,
  quantidade_mil INTEGER  CHECK (quantidade_mil IS NULL OR quantidade_mil BETWEEN 0 AND 9007199254740991),
  custo_unit_cent INTEGER  CHECK (custo_unit_cent IS NULL OR custo_unit_cent BETWEEN 0 AND 9007199254740991),
  custo_efetivo_total_cent INTEGER  CHECK (custo_efetivo_total_cent IS NULL OR custo_efetivo_total_cent BETWEEN 0 AND 9007199254740991),
  preco_minimo_unit_cent INTEGER  CHECK (preco_minimo_unit_cent IS NULL OR preco_minimo_unit_cent BETWEEN 0 AND 9007199254740991),
  preco_venda_unit_cent INTEGER  CHECK (preco_venda_unit_cent IS NULL OR preco_venda_unit_cent BETWEEN 0 AND 9007199254740991),
  receita_total_cent INTEGER  CHECK (receita_total_cent IS NULL OR receita_total_cent BETWEEN 0 AND 9007199254740991),
  custos_venda_total_cent INTEGER  CHECK (custos_venda_total_cent IS NULL OR custos_venda_total_cent BETWEEN 0 AND 9007199254740991),
  lucro_total_cent INTEGER CHECK (lucro_total_cent IS NULL OR lucro_total_cent BETWEEN -9007199254740991 AND 9007199254740991),
  margem_percentual_escala INTEGER,
  lucro_sobre_custo_escala INTEGER,
  objetivo TEXT,
  entrada_json TEXT CHECK(entrada_json IS NULL OR json_valid(entrada_json)),
  resultado_json TEXT CHECK(resultado_json IS NULL OR json_valid(resultado_json)),
  versao_calculo INTEGER CHECK(versao_calculo IS NULL OR versao_calculo >= 1),
  cotacao_origem_id TEXT,
  observacoes TEXT,
  criado_por_texto TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (licitacao_id, empresa_id) REFERENCES licitacoes (id, empresa_id) ON DELETE RESTRICT,
  CHECK(item_licitacao_id IS NULL OR licitacao_id IS NOT NULL),
  FOREIGN KEY (item_licitacao_id, licitacao_id, empresa_id) REFERENCES licitacao_itens (id, licitacao_id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (item_licitacao_id, empresa_id) REFERENCES licitacao_itens (id, empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (cotacao_origem_id, empresa_id) REFERENCES cotacoes_precos (id, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- documentos
CREATE TABLE documentos (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL,
  titulo TEXT,
  versao_corrente_id TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id,empresa_id,versao_corrente_id),
  FOREIGN KEY (versao_corrente_id, id, empresa_id) REFERENCES documento_versoes (id, documento_id, empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- documento_versoes
CREATE TABLE documento_versoes (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  documento_id TEXT NOT NULL,
  numero_versao INTEGER NOT NULL CHECK(numero_versao >= 1),
  nome_original TEXT,
  mime_type TEXT,
  tamanho_bytes INTEGER  CHECK (tamanho_bytes IS NULL OR tamanho_bytes BETWEEN 0 AND 9007199254740991),
  sha256 TEXT CHECK(sha256 IS NULL OR (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  enviado_por TEXT,
  estado_integridade TEXT NOT NULL CHECK (estado_integridade IS NULL OR estado_integridade IN ('PENDENTE','VERIFICADO','AUSENTE','INCONSISTENTE')),
  estado_legado_original TEXT CHECK (estado_legado_original IS NULL OR origem_dado='LEGADO'),
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(documento_id,numero_versao),
  UNIQUE(id,documento_id,empresa_id),
  FOREIGN KEY (documento_id,empresa_id) REFERENCES documentos (id,empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- documento_vinculos
CREATE TABLE documento_vinculos (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  documento_id TEXT NOT NULL,
  papel TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  licitacao_id TEXT,
  licitacao_item_id TEXT,
  empenho_id TEXT,
  compra_id TEXT,
  envio_id TEXT,
  nota_fiscal_id TEXT,
  titulo_pagar_id TEXT,
  titulo_baixa_id TEXT,
  conta_receber_id TEXT,
  recebimento_id TEXT,
  cotacao_id TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  CHECK((licitacao_id IS NOT NULL) + (licitacao_item_id IS NOT NULL) + (empenho_id IS NOT NULL) + (compra_id IS NOT NULL) + (envio_id IS NOT NULL) + (nota_fiscal_id IS NOT NULL) + (titulo_pagar_id IS NOT NULL) + (titulo_baixa_id IS NOT NULL) + (conta_receber_id IS NOT NULL) + (recebimento_id IS NOT NULL) + (cotacao_id IS NOT NULL) = 1),
  -- Papéis conhecidos são permitidos somente no dono correto.
  CHECK(
       (papel IN ('EDITAL','PROPOSTA') AND licitacao_id IS NOT NULL)
    OR (papel='EMPENHO' AND empenho_id IS NOT NULL)
    OR (papel IN ('PEDIDO_COMPRA','NF_FORNECEDOR') AND compra_id IS NOT NULL)
    OR (papel IN ('DESPACHO','ENTREGA') AND envio_id IS NOT NULL)
    OR (papel IN ('NF_VENDA_PDF','NF_VENDA_XML') AND nota_fiscal_id IS NOT NULL)
    OR (papel='BOLETO' AND titulo_pagar_id IS NOT NULL)
    OR (papel='COMPROVANTE_PAGAMENTO' AND (titulo_baixa_id IS NOT NULL OR titulo_pagar_id IS NOT NULL))
    OR (papel='COMPROVANTE_CREDITO' AND (recebimento_id IS NOT NULL OR conta_receber_id IS NOT NULL))
    OR (papel NOT IN ('EDITAL','PROPOSTA','EMPENHO','PEDIDO_COMPRA','NF_FORNECEDOR','DESPACHO','ENTREGA','NF_VENDA_PDF','NF_VENDA_XML','BOLETO','COMPROVANTE_PAGAMENTO','COMPROVANTE_CREDITO')
        AND origem_dado='LEGADO' AND conferencia <> 'VALIDADO' AND ativo=0)
  ),
  FOREIGN KEY (documento_id,empresa_id) REFERENCES documentos (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (licitacao_id,empresa_id) REFERENCES licitacoes (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (licitacao_item_id,empresa_id) REFERENCES licitacao_itens (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (empenho_id,empresa_id) REFERENCES empenhos (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (compra_id,empresa_id) REFERENCES compras (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (envio_id,empresa_id) REFERENCES envios (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (nota_fiscal_id,empresa_id) REFERENCES notas_fiscais (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (titulo_pagar_id,empresa_id) REFERENCES titulos_pagar (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (titulo_baixa_id,empresa_id) REFERENCES titulo_baixas (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (conta_receber_id,empresa_id) REFERENCES contas_receber (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (recebimento_id,empresa_id) REFERENCES recebimentos (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (cotacao_id,empresa_id) REFERENCES cotacoes_precos (id,empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- documento_localizacoes
CREATE TABLE documento_localizacoes (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  versao_id TEXT NOT NULL,
  provedor TEXT NOT NULL CHECK (provedor IS NULL OR provedor IN ('R2','DRIVE','URL_EXTERNA')),
  chave_r2 TEXT,
  drive_file_id TEXT,
  url_externa TEXT,
  status TEXT NOT NULL CHECK (status IS NULL OR status IN ('PENDENTE','VERIFICADO','AUSENTE','INCONSISTENTE','EXCLUIDO')),
  status_legado_original TEXT CHECK(status_legado_original IS NULL OR origem_dado='LEGADO'),
  tamanho_verificado INTEGER  CHECK (tamanho_verificado IS NULL OR tamanho_verificado BETWEEN 0 AND 9007199254740991),
  hash_verificado TEXT CHECK(hash_verificado IS NULL OR (length(hash_verificado)=64 AND hash_verificado NOT GLOB '*[^0-9a-f]*')),
  verificado_em TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(id,versao_id,empresa_id),
  FOREIGN KEY (versao_id,empresa_id) REFERENCES documento_versoes (id,empresa_id) ON DELETE RESTRICT,
  CHECK((provedor='R2' AND chave_r2 IS NOT NULL AND drive_file_id IS NULL AND url_externa IS NULL) OR (provedor='DRIVE' AND chave_r2 IS NULL AND drive_file_id IS NOT NULL AND url_externa IS NULL) OR (provedor='URL_EXTERNA' AND chave_r2 IS NULL AND drive_file_id IS NULL AND url_externa IS NOT NULL)),
  CHECK(status <> 'VERIFICADO' OR (verificado_em IS NOT NULL AND hash_verificado IS NOT NULL AND tamanho_verificado IS NOT NULL)),
  UNIQUE(id, empresa_id)
) STRICT;

-- documento_transferencias
CREATE TABLE documento_transferencias (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  versao_id TEXT NOT NULL,
  origem_localizacao_id TEXT,
  destino_localizacao_id TEXT,
  destino_provedor TEXT NOT NULL CHECK (destino_provedor IS NULL OR destino_provedor IN ('R2','DRIVE')),
  estado TEXT NOT NULL CHECK (estado IS NULL OR estado IN ('PENDENTE','COPIANDO','VALIDANDO','SOBREPOSICAO_30_DIAS','ARQUIVADO','FALHA','BLOQUEADO')),
  tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  erro TEXT,
  verificado_em TEXT,
  sobreposicao_iniciada_em TEXT,
  estado_legado_original TEXT CHECK (estado_legado_original IS NULL OR origem_dado='LEGADO'),
  verificado_legado_original_em TEXT CHECK (verificado_legado_original_em IS NULL OR origem_dado='LEGADO'),
  backup_independente_ref TEXT,
  backup_independente_sha256 TEXT CHECK (backup_independente_sha256 IS NULL OR (length(backup_independente_sha256)=64 AND backup_independente_sha256 NOT GLOB '*[^0-9a-f]*')),
  backup_verificado_em TEXT,
  prazo_sobreposicao_em TEXT  CHECK (prazo_sobreposicao_em IS NULL OR (prazo_sobreposicao_em GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(prazo_sobreposicao_em,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(prazo_sobreposicao_em,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(prazo_sobreposicao_em,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(prazo_sobreposicao_em,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(prazo_sobreposicao_em,1,4) AS INTEGER)%400=0 OR (CAST(substr(prazo_sobreposicao_em,1,4) AS INTEGER)%4=0 AND CAST(substr(prazo_sobreposicao_em,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(prazo_sobreposicao_em,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  idempotencia TEXT NOT NULL,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(empresa_id,idempotencia),
  CHECK(estado <> 'ARQUIVADO' OR (destino_localizacao_id IS NOT NULL AND verificado_em IS NOT NULL AND sobreposicao_iniciada_em IS NOT NULL AND prazo_sobreposicao_em IS NOT NULL AND backup_independente_ref IS NOT NULL AND backup_independente_sha256 IS NOT NULL AND backup_verificado_em IS NOT NULL)),
  CHECK(estado <> 'SOBREPOSICAO_30_DIAS' OR destino_localizacao_id IS NOT NULL),
  FOREIGN KEY (versao_id,empresa_id) REFERENCES documento_versoes (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (origem_localizacao_id,versao_id,empresa_id) REFERENCES documento_localizacoes (id,versao_id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (destino_localizacao_id,versao_id,empresa_id) REFERENCES documento_localizacoes (id,versao_id,empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- documento_bloqueios
CREATE TABLE documento_bloqueios (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  documento_id TEXT NOT NULL,
  motivo TEXT NOT NULL,
  criado_por TEXT,
  liberado_por TEXT,
  liberado_em TEXT,
  liberado_legado_original_em TEXT CHECK(liberado_legado_original_em IS NULL OR origem_dado='LEGADO'),
  liberado_por_original_legado TEXT CHECK(liberado_por_original_legado IS NULL OR origem_dado='LEGADO'),
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (documento_id,empresa_id) REFERENCES documentos (id,empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- licitacao_encerramentos
CREATE TABLE licitacao_encerramentos (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  licitacao_id TEXT NOT NULL,
  encerrada_em TEXT NOT NULL,
  encerrada_por TEXT,
  motivo TEXT NOT NULL,
  reaberta_em TEXT,
  reaberta_por TEXT,
  motivo_reabertura TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (licitacao_id,empresa_id) REFERENCES licitacoes (id,empresa_id) ON DELETE RESTRICT,
  CHECK(reaberta_em IS NULL OR (motivo_reabertura IS NOT NULL AND julianday(reaberta_em) > julianday(encerrada_em))),
  UNIQUE(id, empresa_id)
) STRICT;

-- operacoes
CREATE TABLE operacoes (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL,
  hash_pedido TEXT NOT NULL,
  ator_id TEXT,
  ator_original TEXT,
  estado TEXT NOT NULL CHECK (estado IS NULL OR estado IN ('REGISTRADA','EM_ANDAMENTO','PENDENTE','CONCLUIDA','RECUSADA','FALHA')),
  etapa_atual TEXT,
  plano_json TEXT CHECK(plano_json IS NULL OR json_valid(plano_json)),
  resultado_json TEXT CHECK(resultado_json IS NULL OR json_valid(resultado_json)),
  payload_privado_ref TEXT,
  erro TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (ator_id) REFERENCES usuarios (id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- eventos_auditoria
CREATE TABLE eventos_auditoria (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  tipo_entidade TEXT NOT NULL,
  entidade_id_texto TEXT NOT NULL,
  licitacao_id TEXT,
  acao TEXT NOT NULL,
  data_hora TEXT,
  ator_id TEXT,
  ator_original TEXT,
  resumo TEXT,
  alteracoes_json TEXT CHECK(alteracoes_json IS NULL OR json_valid(alteracoes_json)),
  payload_privado_ref TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (licitacao_id,empresa_id) REFERENCES licitacoes (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (ator_id) REFERENCES usuarios (id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- tarefas_assincronas
CREATE TABLE tarefas_assincronas (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  operacao_id_ref TEXT,
  tipo TEXT NOT NULL,
  chave_idempotencia TEXT NOT NULL,
  payload_ref TEXT,
  estado TEXT NOT NULL CHECK (estado IS NULL OR estado IN ('PENDENTE','EM_EXECUCAO','CONCLUIDA','FALHA','INCERTA','BLOQUEADA')),
  tentativas INTEGER NOT NULL DEFAULT 0 CHECK(tentativas >= 0),
  executar_em TEXT,
  lease_ate TEXT,
  erro TEXT,
  concluida_em TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(empresa_id,chave_idempotencia),
  FOREIGN KEY (operacao_id_ref,empresa_id) REFERENCES operacoes (id,empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- configuracoes
CREATE TABLE configuracoes (
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  chave TEXT NOT NULL,
  valor_texto TEXT,
  tipo TEXT  CHECK (tipo IS NULL OR tipo IN ('TEXTO','INTEIRO','JSON','BOOLEANO')),
  descricao TEXT,
  atualizado_em TEXT,
  PRIMARY KEY(empresa_id,chave),
  CHECK(tipo <> 'JSON' OR valor_texto IS NULL OR json_valid(valor_texto))
) STRICT;

-- notificacoes_preferencias
CREATE TABLE notificacoes_preferencias (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  ativo INTEGER NOT NULL DEFAULT 0 CHECK (ativo IN (0,1)),
  dias_semana_json TEXT CHECK(dias_semana_json IS NULL OR json_valid(dias_semana_json)),
  horarios_json TEXT CHECK(horarios_json IS NULL OR json_valid(horarios_json)),
  quantidade_proximos INTEGER NOT NULL DEFAULT 5 CHECK(quantidade_proximos BETWEEN 1 AND 50),
  remetente TEXT,
  vigente_desde TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(empresa_id),
  UNIQUE(id, empresa_id)
) STRICT;

-- notificacoes_destinatarios
CREATE TABLE notificacoes_destinatarios (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  preferencia_id TEXT NOT NULL,
  email_normalizado TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (preferencia_id,empresa_id) REFERENCES notificacoes_preferencias (id,empresa_id) ON DELETE RESTRICT,
  UNIQUE(preferencia_id,email_normalizado),
  UNIQUE(id, empresa_id)
) STRICT;

-- notificacoes_envios
CREATE TABLE notificacoes_envios (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  preferencia_id TEXT NOT NULL,
  data_referencia TEXT NOT NULL CHECK (data_referencia IS NULL OR (data_referencia GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND CAST(substr(data_referencia,1,4) AS INTEGER) BETWEEN 1 AND 9999 AND CAST(substr(data_referencia,6,2) AS INTEGER) BETWEEN 1 AND 12 AND CAST(substr(data_referencia,9,2) AS INTEGER) BETWEEN 1 AND CASE WHEN CAST(substr(data_referencia,6,2) AS INTEGER)=2 THEN CASE WHEN (CAST(substr(data_referencia,1,4) AS INTEGER)%400=0 OR (CAST(substr(data_referencia,1,4) AS INTEGER)%4=0 AND CAST(substr(data_referencia,1,4) AS INTEGER)%100<>0)) THEN 29 ELSE 28 END WHEN CAST(substr(data_referencia,6,2) AS INTEGER) IN (4,6,9,11) THEN 30 ELSE 31 END)),
  horario TEXT NOT NULL,
  destinatario_hash TEXT NOT NULL,
  email_protegido TEXT,
  estado TEXT NOT NULL CHECK (estado IS NULL OR estado IN ('RESERVADO','ENVIADO','INCERTO','SEM_COTA','BLOQUEADO_DADOS','FALHA')),
  quantidade_boletos INTEGER CHECK(quantidade_boletos IS NULL OR quantidade_boletos >= 0),
  total_centavos INTEGER  CHECK (total_centavos IS NULL OR total_centavos BETWEEN 0 AND 9007199254740991),
  hash_resumo TEXT,
  remetente TEXT,
  erro TEXT,
  enviado_em TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (preferencia_id,empresa_id) REFERENCES notificacoes_preferencias (id,empresa_id) ON DELETE RESTRICT,
  UNIQUE(preferencia_id,data_referencia,horario,destinatario_hash),
  UNIQUE(id, empresa_id)
) STRICT;

-- lotes_migracao
CREATE TABLE lotes_migracao (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  origem_snapshot TEXT NOT NULL,
  hash_origem TEXT NOT NULL,
  versao_mapeamento TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IS NULL OR estado IN ('PREPARADO','EM_ANDAMENTO','CONFERENCIA','APROVADO','BLOQUEADO')),
  iniciado_em TEXT,
  concluido_em TEXT,
  inventario_privado_ref TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  UNIQUE(empresa_id,origem_snapshot,hash_origem),
  UNIQUE(id, empresa_id)
) STRICT;

-- migracao_referencias
CREATE TABLE migracao_referencias (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  lote_id TEXT NOT NULL,
  tipo_origem TEXT NOT NULL,
  id_origem_estavel TEXT NOT NULL,
  id_destino TEXT NOT NULL,
  hash_linha TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IS NULL OR estado IN ('MIGRADO','PENDENTE','INCONSISTENTE')),
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (lote_id,empresa_id) REFERENCES lotes_migracao (id,empresa_id) ON DELETE RESTRICT,
  UNIQUE(lote_id,tipo_origem,id_origem_estavel),
  UNIQUE(id, empresa_id)
) STRICT;

-- migracao_itens
CREATE TABLE migracao_itens (
  id TEXT NOT NULL PRIMARY KEY,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  lote_id TEXT NOT NULL,
  entidade_tipo TEXT NOT NULL,
  referencia_id TEXT,
  documento_versao_id TEXT,
  hash_origem TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IS NULL OR estado IN ('PENDENTE','IMPORTADO','VERIFICADO','INCONSISTENTE')),
  tentativas INTEGER NOT NULL DEFAULT 0 CHECK(tentativas >= 0),
  erro TEXT,
  verificado_em TEXT,
  criado_em TEXT,
  atualizado_em TEXT,
  versao INTEGER NOT NULL DEFAULT 1 CHECK (versao >= 1),
  operacao_id TEXT,
  origem_dado TEXT NOT NULL DEFAULT 'NATIVO' CHECK (origem_dado IS NULL OR origem_dado IN ('NATIVO','LEGADO')),
  conferencia TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (conferencia IS NULL OR conferencia IN ('PENDENTE','VALIDADO','INCONSISTENTE')),
  FOREIGN KEY (lote_id,empresa_id) REFERENCES lotes_migracao (id,empresa_id) ON DELETE RESTRICT,
  FOREIGN KEY (documento_versao_id,empresa_id) REFERENCES documento_versoes (id,empresa_id) ON DELETE RESTRICT,
  UNIQUE(id, empresa_id)
) STRICT;

-- Indices
CREATE UNIQUE INDEX uq_orgao_nome_ativo ON orgaos(empresa_id,nome_normalizado) WHERE (origem_dado='NATIVO' OR conferencia='VALIDADO') AND nome_normalizado IS NOT NULL;
CREATE UNIQUE INDEX uq_fornecedor_nome_ativo ON fornecedores(empresa_id,nome_normalizado) WHERE (origem_dado='NATIVO' OR conferencia='VALIDADO') AND nome_normalizado IS NOT NULL;
CREATE UNIQUE INDEX uq_licitacao_natural ON licitacoes(empresa_id,orgao_id,numero_normalizado,ano) WHERE (origem_dado='NATIVO' OR conferencia='VALIDADO') AND numero_normalizado IS NOT NULL AND ano IS NOT NULL;
CREATE UNIQUE INDEX uq_item_licitacao_numero ON licitacao_itens(licitacao_id,coalesce(lote_normalizado,''),numero_item_normalizado) WHERE (origem_dado='NATIVO' OR conferencia='VALIDADO') AND numero_item_normalizado IS NOT NULL;
CREATE UNIQUE INDEX uq_empenho_natural ON empenhos(empresa_id,orgao_id_escopo,numero_normalizado,ano) WHERE (origem_dado='NATIVO' OR conferencia='VALIDADO') AND numero_normalizado IS NOT NULL AND ano IS NOT NULL;
CREATE UNIQUE INDEX uq_nf_chave ON notas_fiscais(empresa_id,chave_acesso) WHERE (origem_dado='NATIVO' OR conferencia='VALIDADO') AND chave_acesso IS NOT NULL AND trim(chave_acesso) <> '';
CREATE UNIQUE INDEX uq_nf_natural ON notas_fiscais(empresa_id,orgao_id_escopo,numero_normalizado,coalesce(serie,'')) WHERE (origem_dado='NATIVO' OR conferencia='VALIDADO') AND numero_normalizado IS NOT NULL;
CREATE UNIQUE INDEX uq_titulo_competencia ON titulos_pagar(recorrencia_id,competencia) WHERE recorrencia_id IS NOT NULL;
CREATE UNIQUE INDEX uq_baixa_desfeita ON titulo_baixas(baixa_original_id) WHERE baixa_original_id IS NOT NULL;
CREATE UNIQUE INDEX uq_recebimento_estornado ON recebimentos(estorno_de_id) WHERE estorno_de_id IS NOT NULL;
CREATE INDEX idx_licitacoes_orgao ON licitacoes(empresa_id,orgao_id,ano);
CREATE INDEX idx_licitacoes_encerradas ON licitacoes(empresa_id,encerrada_em);
CREATE INDEX idx_licitacao_itens_pai ON licitacao_itens(licitacao_id);
CREATE INDEX idx_empenhos_pai ON empenhos(licitacao_id,situacao);
CREATE INDEX idx_emp_itens_pai ON empenho_itens(empenho_id);
CREATE INDEX idx_compras_empenho ON compras(empenho_id,situacao);
CREATE INDEX idx_compra_itens_pai ON compra_itens(compra_id);
CREATE INDEX idx_envios_empenho ON envios(empenho_id,situacao);
CREATE INDEX idx_envio_itens_pai ON envio_itens(envio_id);
CREATE INDEX idx_nf_empenho ON notas_fiscais(empenho_id,situacao);
CREATE INDEX idx_nf_itens_pai ON nota_fiscal_itens(nota_fiscal_id);
CREATE INDEX idx_titulos_vencimento ON titulos_pagar(empresa_id,vencimento,cancelado);
CREATE INDEX idx_titulos_compra ON titulos_pagar(compra_id);
CREATE INDEX idx_baixas_titulo ON titulo_baixas(titulo_id,criado_em);
CREATE INDEX idx_recorrencias_mes ON recorrencias(empresa_id,primeiro_vencimento);
CREATE INDEX idx_contas_nf ON contas_receber(nota_fiscal_id,parcela);
CREATE UNIQUE INDEX uq_contas_receber_parcela_ativa
  ON contas_receber(nota_fiscal_id,parcela) WHERE cancelada=0;
CREATE INDEX idx_recebimentos_conta ON recebimentos(conta_receber_id,data_credito);
CREATE INDEX idx_cotacoes_data ON cotacoes_precos(empresa_id,criado_em,id);
CREATE INDEX idx_doc_vinc_doc ON documento_vinculos(documento_id);
CREATE UNIQUE INDEX uq_doc_licitacao_id_papel ON documento_vinculos(licitacao_id,papel) WHERE ativo=1 AND licitacao_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_licitacao_item_id_papel ON documento_vinculos(licitacao_item_id,papel) WHERE ativo=1 AND licitacao_item_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_empenho_id_papel ON documento_vinculos(empenho_id,papel) WHERE ativo=1 AND empenho_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_compra_id_papel ON documento_vinculos(compra_id,papel) WHERE ativo=1 AND compra_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_envio_id_papel ON documento_vinculos(envio_id,papel) WHERE ativo=1 AND envio_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_nota_fiscal_id_papel ON documento_vinculos(nota_fiscal_id,papel) WHERE ativo=1 AND nota_fiscal_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_titulo_pagar_id_papel ON documento_vinculos(titulo_pagar_id,papel) WHERE ativo=1 AND titulo_pagar_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_titulo_baixa_id_papel ON documento_vinculos(titulo_baixa_id,papel) WHERE ativo=1 AND titulo_baixa_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_conta_receber_id_papel ON documento_vinculos(conta_receber_id,papel) WHERE ativo=1 AND conta_receber_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_recebimento_id_papel ON documento_vinculos(recebimento_id,papel) WHERE ativo=1 AND recebimento_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_cotacao_id_papel ON documento_vinculos(cotacao_id,papel) WHERE ativo=1 AND cotacao_id IS NOT NULL;
CREATE INDEX idx_doc_localizacoes ON documento_localizacoes(versao_id,provedor,status);
-- R4/N07: R2 bucket e Google Drive possuem identificadores globais.
CREATE UNIQUE INDEX uq_chave_r2_privada ON documento_localizacoes(chave_r2)
  WHERE provedor='R2' AND chave_r2 IS NOT NULL;
CREATE UNIQUE INDEX uq_drive_file_id_global ON documento_localizacoes(drive_file_id)
  WHERE provedor='DRIVE' AND drive_file_id IS NOT NULL AND length(trim(drive_file_id))>0;
CREATE INDEX idx_doc_transferencias ON documento_transferencias(empresa_id,estado,prazo_sobreposicao_em);
CREATE INDEX idx_tarefas_pendentes ON tarefas_assincronas(empresa_id,estado,executar_em);
CREATE INDEX idx_eventos_lic ON eventos_auditoria(empresa_id,licitacao_id,data_hora);
CREATE INDEX idx_migracao_origem ON migracao_referencias(lote_id,tipo_origem,id_origem_estavel);
CREATE UNIQUE INDEX uq_encerramento_aberto ON licitacao_encerramentos(licitacao_id) WHERE reaberta_em IS NULL;

-- Imutabilidade financeira e historica
CREATE TRIGGER trg_cotacoes_precos_no_update BEFORE UPDATE ON cotacoes_precos BEGIN SELECT RAISE(ABORT,'cotacoes_precos: append-only'); END;
CREATE TRIGGER trg_cotacoes_precos_no_delete BEFORE DELETE ON cotacoes_precos BEGIN SELECT RAISE(ABORT,'cotacoes_precos: append-only'); END;
-- N14: nenhuma comprovacao importada confere um credito por conta propria.
CREATE TRIGGER trg_recebimento_legado_inicia_pendente
BEFORE INSERT ON recebimentos
WHEN NEW.origem_dado='LEGADO' AND NEW.conferencia<>'PENDENTE'
BEGIN SELECT RAISE(ABORT,'recebimento LEGADO deve iniciar PENDENTE'); END;
CREATE TRIGGER trg_recebimentos_no_update BEFORE UPDATE ON recebimentos BEGIN SELECT RAISE(ABORT,'recebimentos: append-only'); END;
CREATE TRIGGER trg_recebimentos_no_delete BEFORE DELETE ON recebimentos BEGIN SELECT RAISE(ABORT,'recebimentos: append-only'); END;
CREATE TRIGGER trg_titulo_baixas_no_update BEFORE UPDATE ON titulo_baixas BEGIN SELECT RAISE(ABORT,'titulo_baixas: append-only'); END;
CREATE TRIGGER trg_titulo_baixas_no_delete BEFORE DELETE ON titulo_baixas BEGIN SELECT RAISE(ABORT,'titulo_baixas: append-only'); END;
CREATE TRIGGER trg_recorrencia_revisoes_no_update BEFORE UPDATE ON recorrencia_revisoes BEGIN SELECT RAISE(ABORT,'recorrencia_revisoes: append-only'); END;
CREATE TRIGGER trg_recorrencia_revisoes_no_delete BEFORE DELETE ON recorrencia_revisoes BEGIN SELECT RAISE(ABORT,'recorrencia_revisoes: append-only'); END;
CREATE TRIGGER trg_eventos_auditoria_no_update BEFORE UPDATE ON eventos_auditoria BEGIN SELECT RAISE(ABORT,'eventos_auditoria: append-only'); END;
CREATE TRIGGER trg_eventos_auditoria_no_delete BEFORE DELETE ON eventos_auditoria BEGIN SELECT RAISE(ABORT,'eventos_auditoria: append-only'); END;
-- Identidade e bytes da versao sao imutaveis; somente estado de verificacao
-- pode progredir, com revisao otimista e evento de auditoria.
CREATE TRIGGER trg_documento_versoes_no_update BEFORE UPDATE ON documento_versoes
WHEN NEW.id IS NOT OLD.id OR NEW.empresa_id IS NOT OLD.empresa_id
 OR NEW.documento_id IS NOT OLD.documento_id OR NEW.numero_versao IS NOT OLD.numero_versao
 OR NEW.nome_original IS NOT OLD.nome_original OR NEW.mime_type IS NOT OLD.mime_type
 OR NEW.tamanho_bytes IS NOT OLD.tamanho_bytes OR NEW.sha256 IS NOT OLD.sha256
 OR NEW.enviado_por IS NOT OLD.enviado_por OR NEW.criado_em IS NOT OLD.criado_em
 OR NEW.origem_dado IS NOT OLD.origem_dado OR NEW.estado_legado_original IS NOT OLD.estado_legado_original
 OR NEW.estado_integridade IS OLD.estado_integridade
 OR NOT (
   (OLD.estado_integridade='PENDENTE' AND NEW.estado_integridade IN ('VERIFICADO','AUSENTE','INCONSISTENTE'))
   OR (OLD.estado_integridade IN ('AUSENTE','INCONSISTENTE') AND NEW.estado_integridade IN ('PENDENTE','VERIFICADO'))
   OR (OLD.estado_integridade='VERIFICADO' AND NEW.estado_integridade IN ('AUSENTE','INCONSISTENTE'))
 )
 OR NEW.versao <> OLD.versao+1
BEGIN SELECT RAISE(ABORT,'versao documental: conteudo imutavel e transicao de verificacao auditada'); END;
CREATE TRIGGER trg_documento_versoes_no_delete BEFORE DELETE ON documento_versoes BEGIN SELECT RAISE(ABORT,'documento_versoes: append-only'); END;

-- Views derivadas (nao armazenam saldos)
CREATE VIEW v_recebimentos_ativos AS
 SELECT r.id, r.empresa_id, r.conta_receber_id, r.data_credito, r.valor_recebido_cent, r.retencao_confirmada_cent,
        r.origem_dado,
        CASE WHEN r.origem_dado='LEGADO' THEN coalesce(rc.resultado,'PENDENTE')
             ELSE r.conferencia END AS conferencia
 FROM recebimentos r
 LEFT JOIN recebimento_conferencias rc
   ON rc.recebimento_id=r.id AND rc.empresa_id=r.empresa_id
  AND NOT EXISTS (
    SELECT 1 FROM recebimento_conferencias mais_nova
    WHERE mais_nova.recebimento_id=rc.recebimento_id
      AND mais_nova.empresa_id=rc.empresa_id
      AND mais_nova.revisao>rc.revisao
  )
 WHERE r.tipo_movimento='RECEBIMENTO'
   AND NOT EXISTS (SELECT 1 FROM recebimentos e WHERE e.estorno_de_id=r.id AND e.tipo_movimento='ESTORNO');
CREATE VIEW v_contas_receber_saldos AS
 SELECT c.id, c.empresa_id, c.nota_fiscal_id, c.parcela, c.valor_bruto_cent,
        coalesce(sum(a.valor_recebido_cent),0) AS creditado_cent,
        coalesce(sum(a.retencao_confirmada_cent),0) AS retido_cent,
        CASE
          WHEN c.valor_bruto_cent IS NULL THEN 'DESCONHECIDO'
          WHEN coalesce(sum(CASE WHEN a.origem_dado='LEGADO' AND a.conferencia='INCONSISTENTE' THEN 1 ELSE 0 END),0)>0 THEN 'INCONSISTENTE'
          WHEN coalesce(sum(CASE WHEN a.origem_dado='LEGADO' AND a.conferencia='PENDENTE' THEN 1 ELSE 0 END),0)>0 THEN 'PENDENTE_CONFERENCIA'
          WHEN coalesce(sum(a.valor_recebido_cent),0)+coalesce(sum(a.retencao_confirmada_cent),0)>c.valor_bruto_cent THEN 'INCONSISTENTE'
          ELSE 'CONFERIDO'
        END AS estado_saldo,
        CASE
          WHEN c.valor_bruto_cent IS NULL
            OR coalesce(sum(CASE WHEN a.origem_dado='LEGADO' AND a.conferencia<>'VALIDADO' THEN 1 ELSE 0 END),0)>0
            OR coalesce(sum(a.valor_recebido_cent),0)+coalesce(sum(a.retencao_confirmada_cent),0)>c.valor_bruto_cent
          THEN NULL
          ELSE c.valor_bruto_cent - coalesce(sum(a.valor_recebido_cent),0)
               - coalesce(sum(a.retencao_confirmada_cent),0)
        END AS saldo_cent
 FROM contas_receber c LEFT JOIN v_recebimentos_ativos a ON a.conta_receber_id=c.id AND a.empresa_id=c.empresa_id
 GROUP BY c.id;
CREATE VIEW v_titulos_situacao AS
 SELECT t.id, t.empresa_id, t.valor_nominal_cent, t.vencimento, t.cancelado,
 CASE WHEN t.cancelado=1 THEN 'CANCELADO'
 WHEN EXISTS (
   SELECT 1 FROM titulo_baixas b
   WHERE b.titulo_id=t.id AND b.tipo='QUITACAO'
     AND NOT EXISTS (SELECT 1 FROM titulo_baixas d WHERE d.tipo='DESFAZIMENTO' AND d.baixa_original_id=b.id)
 ) THEN 'PAGO'
 WHEN t.origem_dado='LEGADO' AND t.pago_legado_status='SIM'
      AND NOT EXISTS (SELECT 1 FROM titulo_baixas b WHERE b.titulo_id=t.id) THEN 'PAGO_LEGADO_SEM_BAIXA'
 ELSE 'ABERTO' END AS situacao
 FROM titulos_pagar t;

-- Guardas transacionais de eventos financeiros: evitam estados impossiveis no proprio SQLite.
-- O Worker ainda deve fazer autorizacao, revisao CAS e validacao do processo.
CREATE TRIGGER trg_baixa_original_qualificada
BEFORE INSERT ON titulo_baixas
WHEN NEW.tipo='DESFAZIMENTO'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM titulo_baixas original
    WHERE original.id=NEW.baixa_original_id AND original.titulo_id=NEW.titulo_id
      AND original.empresa_id=NEW.empresa_id AND original.tipo='QUITACAO'
  ) THEN RAISE(ABORT,'desfazimento exige quitacao original do mesmo titulo') END;
END;

CREATE TRIGGER trg_baixa_uma_ativa
BEFORE INSERT ON titulo_baixas
WHEN NEW.tipo='QUITACAO' AND NEW.origem_dado='NATIVO'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM titulo_baixas b
    WHERE b.titulo_id=NEW.titulo_id AND b.empresa_id=NEW.empresa_id
      AND b.tipo='QUITACAO'
      AND NOT EXISTS (
        SELECT 1 FROM titulo_baixas d
        WHERE d.baixa_original_id=b.id AND d.tipo='DESFAZIMENTO'
      )
  ) THEN RAISE(ABORT,'titulo ja possui quitacao administrativa ativa') END;
END;

CREATE TRIGGER trg_estorno_espelho
BEFORE INSERT ON recebimentos
WHEN NEW.tipo_movimento='ESTORNO'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM recebimentos original
    WHERE original.id=NEW.estorno_de_id
      AND original.empresa_id=NEW.empresa_id
      AND original.conta_receber_id=NEW.conta_receber_id
      AND original.tipo_movimento='RECEBIMENTO'
      AND original.valor_recebido_cent=NEW.valor_recebido_cent
      AND original.retencao_confirmada_cent=NEW.retencao_confirmada_cent
      AND original.data_credito=NEW.data_credito
  ) THEN RAISE(ABORT,'estorno deve espelhar data valores retencao e parcela originais') END;
END;

CREATE TRIGGER trg_recebimento_sem_excesso
BEFORE INSERT ON recebimentos
WHEN NEW.tipo_movimento='RECEBIMENTO'
  AND (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM contas_receber c
    WHERE c.id=NEW.conta_receber_id AND c.empresa_id=NEW.empresa_id
      AND c.valor_bruto_cent IS NOT NULL AND c.cancelada=0
      AND NEW.valor_recebido_cent + NEW.retencao_confirmada_cent
         + coalesce((
             SELECT SUM(r.valor_recebido_cent + r.retencao_confirmada_cent)
             FROM recebimentos r
             WHERE r.conta_receber_id=c.id AND r.empresa_id=c.empresa_id
               AND r.tipo_movimento='RECEBIMENTO'
               AND NOT EXISTS (
                 SELECT 1 FROM recebimentos e
                 WHERE e.estorno_de_id=r.id AND e.tipo_movimento='ESTORNO'
               )
           ),0) <= c.valor_bruto_cent
  ) THEN RAISE(ABORT,'recebimento somado a retencoes excede saldo bruto') END;
END;

CREATE TRIGGER trg_conta_com_credito_protegida
BEFORE UPDATE ON contas_receber
WHEN EXISTS (
    SELECT 1 FROM recebimentos r
    WHERE r.conta_receber_id=OLD.id AND r.empresa_id=OLD.empresa_id
  )
  AND (
       NEW.valor_bruto_cent IS NOT OLD.valor_bruto_cent
    OR NEW.retencao_prevista_cent IS NOT OLD.retencao_prevista_cent
    OR NEW.parcela IS NOT OLD.parcela
    OR NEW.nota_fiscal_id IS NOT OLD.nota_fiscal_id
    OR NEW.cancelada IS NOT OLD.cancelada
  )
BEGIN
  SELECT RAISE(ABORT,'parcela com eventos financeiros nao admite reescrita de base');
END;


-- A03: somente declarar versao VERIFICADA depois de localizacao comprovada.
CREATE TRIGGER trg_versao_nova_exige_pendente
BEFORE INSERT ON documento_versoes
WHEN NEW.estado_integridade <> 'PENDENTE'
BEGIN SELECT RAISE(ABORT,'nova versao deve iniciar pendente'); END;
CREATE TRIGGER trg_versao_verificada_requer_localizacao
BEFORE UPDATE OF estado_integridade ON documento_versoes
WHEN NEW.estado_integridade='VERIFICADO'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM documento_localizacoes l WHERE l.versao_id=NEW.id AND l.empresa_id=NEW.empresa_id
       AND l.status='VERIFICADO'
       AND NEW.sha256 IS NOT NULL AND NEW.tamanho_bytes IS NOT NULL
       AND l.hash_verificado=NEW.sha256 AND l.tamanho_verificado=NEW.tamanho_bytes
       AND l.provedor IN ('R2','DRIVE')
  ) THEN RAISE(ABORT,'versao sem copia R2/Drive verificada por hash e tamanho') END;
END;
CREATE TRIGGER trg_versao_estado_evento
AFTER UPDATE OF estado_integridade ON documento_versoes
WHEN OLD.estado_integridade IS NOT NEW.estado_integridade
BEGIN
  INSERT INTO eventos_auditoria
    (id,empresa_id,tipo_entidade,entidade_id_texto,acao,data_hora,operacao_id,resumo)
  VALUES
    ('verif_'||lower(hex(randomblob(16))),NEW.empresa_id,'DOCUMENTO_VERSAO',NEW.id,
     'VERIFICAR_ESTADO',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.operacao_id,
     OLD.estado_integridade||'->'||NEW.estado_integridade);
END;

-- A04/A05: quitação e cancelamento administrativos não podem se contradizer.
CREATE TRIGGER trg_titulo_cancelamento_com_baixa
BEFORE UPDATE OF cancelado ON titulos_pagar
WHEN OLD.cancelado=0 AND NEW.cancelado=1 AND (
      (OLD.pago_legado_status='SIM')
    OR EXISTS (
      SELECT 1 FROM titulo_baixas b WHERE b.titulo_id=OLD.id AND b.tipo='QUITACAO'
        AND NOT EXISTS (SELECT 1 FROM titulo_baixas d WHERE d.baixa_original_id=b.id AND d.tipo='DESFAZIMENTO')
    ))
BEGIN SELECT RAISE(ABORT,'titulo quitado nao pode ser cancelado'); END;
CREATE TRIGGER trg_titulo_quitacao_cancelada
BEFORE INSERT ON titulo_baixas
WHEN NEW.tipo='QUITACAO' AND EXISTS (
    SELECT 1 FROM titulos_pagar t WHERE t.id=NEW.titulo_id AND t.empresa_id=NEW.empresa_id AND t.cancelado=1
)
BEGIN SELECT RAISE(ABORT,'titulo cancelado nao admite quitacao'); END;

-- A08: dinheiro real só em NF de venda EMITIDA/APRESENTADA,
-- empenho CONFIRMADO e licitacao aberta; importação pendente vai à conferência.
CREATE TRIGGER trg_credito_requer_origem_ativa
BEFORE INSERT ON recebimentos
WHEN NEW.tipo_movimento='RECEBIMENTO' AND (NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO')
BEGIN
 SELECT CASE WHEN NOT EXISTS (
   SELECT 1 FROM contas_receber c
   JOIN notas_fiscais nf ON nf.id=c.nota_fiscal_id AND nf.empresa_id=c.empresa_id
   JOIN empenhos e ON e.id=nf.empenho_id AND e.empresa_id=nf.empresa_id
   JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id
   WHERE c.id=NEW.conta_receber_id AND c.empresa_id=NEW.empresa_id AND c.cancelada=0
     AND nf.situacao IN ('EMITIDA','APRESENTADA') AND e.situacao='CONFIRMADO'
     AND coalesce(l.situacao_participacao,'')<>'CANCELADA'
     AND NOT EXISTS (SELECT 1 FROM licitacao_encerramentos ce
       WHERE ce.licitacao_id=l.id AND ce.empresa_id=l.empresa_id AND ce.reaberta_em IS NULL)
 ) THEN RAISE(ABORT,'parcela ou NF/empenho/licitacao nao habilitam recebimento') END;
END;

-- N14: conferencia posterior e um evento administrativo, nao estorno ficticio.
CREATE TRIGGER trg_recebimento_conferencia_validar
BEFORE INSERT ON recebimento_conferencias
BEGIN
 SELECT CASE WHEN NEW.conferido_em<>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    THEN RAISE(ABORT,'conferencia deve usar horario do banco') END;
 SELECT CASE WHEN NEW.revisao<>coalesce((
   SELECT max(x.revisao) FROM recebimento_conferencias x
   WHERE x.recebimento_id=NEW.recebimento_id AND x.empresa_id=NEW.empresa_id
 ),0)+1 OR (NEW.revisao>1 AND NOT EXISTS (
   SELECT 1 FROM recebimento_conferencias anterior
   WHERE anterior.id=NEW.substitui_conferencia_id
     AND anterior.empresa_id=NEW.empresa_id
     AND anterior.recebimento_id=NEW.recebimento_id
     AND anterior.revisao=NEW.revisao-1
 )) THEN RAISE(ABORT,'conferencia deve seguir ultima revisao imutavel') END;
 SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM recebimentos r
    WHERE r.id=NEW.recebimento_id AND r.empresa_id=NEW.empresa_id
      AND r.origem_dado='LEGADO' AND r.conferencia='PENDENTE'
 ) THEN RAISE(ABORT,'conferencia exige evento LEGADO pendente') END;
 SELECT CASE WHEN NEW.resultado='VALIDADO' AND NOT EXISTS(
    SELECT 1 FROM recebimentos r
    JOIN contas_receber c ON c.id=r.conta_receber_id AND c.empresa_id=r.empresa_id
    JOIN notas_fiscais nf ON nf.id=c.nota_fiscal_id AND nf.empresa_id=c.empresa_id
    JOIN empenhos e ON e.id=nf.empenho_id AND e.empresa_id=nf.empresa_id
    JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id
    WHERE r.id=NEW.recebimento_id AND r.empresa_id=NEW.empresa_id
      AND c.cancelada=0 AND c.valor_bruto_cent IS NOT NULL
      AND nf.situacao IN ('EMITIDA','APRESENTADA')
      AND e.situacao='CONFIRMADO'
      AND coalesce(l.situacao_participacao,'')<>'CANCELADA'
      -- Encerramento nao elimina a existencia de um credito bancario historico.
      AND coalesce((
         SELECT sum(a.valor_recebido_cent+a.retencao_confirmada_cent)
         FROM recebimentos a
         WHERE a.conta_receber_id=c.id AND a.empresa_id=c.empresa_id
           AND a.tipo_movimento='RECEBIMENTO'
           AND NOT EXISTS(
             SELECT 1 FROM recebimentos z
             WHERE z.estorno_de_id=a.id AND z.tipo_movimento='ESTORNO'
           )
      ),0)<=c.valor_bruto_cent
      AND (
        r.tipo_movimento='RECEBIMENTO'
        OR (r.tipo_movimento='ESTORNO' AND EXISTS (
            SELECT 1 FROM recebimentos orig
            WHERE orig.id=r.estorno_de_id AND orig.empresa_id=r.empresa_id
              AND orig.conta_receber_id=r.conta_receber_id
              AND orig.tipo_movimento='RECEBIMENTO'
        ))
      )
 ) THEN RAISE(ABORT,'evento legado sem documento financeiro conferivel ou saldo valido') END;
END;
CREATE TRIGGER trg_recebimento_conferencia_no_update
BEFORE UPDATE ON recebimento_conferencias
BEGIN SELECT RAISE(ABORT,'atestado historico imutavel'); END;
CREATE TRIGGER trg_recebimento_conferencia_no_delete
BEFORE DELETE ON recebimento_conferencias
BEGIN SELECT RAISE(ABORT,'atestado historico nao pode ser apagado'); END;
CREATE TRIGGER trg_recebimento_conferencia_evento
AFTER INSERT ON recebimento_conferencias
BEGIN
 INSERT INTO eventos_auditoria
  (id,empresa_id,tipo_entidade,entidade_id_texto,acao,data_hora,
   ator_original,resumo,operacao_id)
 VALUES (
  'conf_'||lower(hex(randomblob(16))),NEW.empresa_id,'RECEBIMENTO',
  NEW.recebimento_id,'CONFERIR_LEGADO',NEW.conferido_em,NEW.conferido_por,
  'R'||NEW.revisao||' '||NEW.resultado||': '||NEW.justificativa,NEW.operacao_id
 );
END;

-- A10: idempotência não pode ser reescrita após o primeiro pedido.
CREATE TRIGGER trg_operacoes_identidade_congelada
BEFORE UPDATE ON operacoes
WHEN NEW.id IS NOT OLD.id OR NEW.empresa_id IS NOT OLD.empresa_id
 OR NEW.tipo IS NOT OLD.tipo OR NEW.hash_pedido IS NOT OLD.hash_pedido
 OR NEW.ator_id IS NOT OLD.ator_id OR NEW.ator_original IS NOT OLD.ator_original
 OR NEW.criado_em IS NOT OLD.criado_em OR NEW.origem_dado IS NOT OLD.origem_dado
 OR (OLD.estado='CONCLUIDA' AND (
      NEW.estado IS NOT OLD.estado OR NEW.plano_json IS NOT OLD.plano_json
      OR NEW.resultado_json IS NOT OLD.resultado_json OR NEW.payload_privado_ref IS NOT OLD.payload_privado_ref))
BEGIN SELECT RAISE(ABORT,'operacao tem identidade e resultado concluido imutaveis'); END;

-- A12: encerramento histórico é a fonte de verdade; data na licitação é projeção.
CREATE TRIGGER trg_licitacao_nao_inicia_encerrada
BEFORE INSERT ON licitacoes
WHEN NEW.encerrada_em IS NOT NULL
BEGIN SELECT RAISE(ABORT,'registrar ciclo de encerramento em licitacao_encerramentos'); END;
CREATE TRIGGER trg_licitacao_encerrada_so_por_ciclo
BEFORE UPDATE OF encerrada_em ON licitacoes
WHEN NEW.encerrada_em IS NOT (
    SELECT ce.encerrada_em FROM licitacao_encerramentos ce
    WHERE ce.licitacao_id=NEW.id AND ce.empresa_id=NEW.empresa_id AND ce.reaberta_em IS NULL
    ORDER BY ce.encerrada_em DESC LIMIT 1
)
BEGIN SELECT RAISE(ABORT,'data de encerramento deve refletir ciclo vigente'); END;
CREATE TRIGGER trg_encerramento_proteger_identidade
BEFORE UPDATE ON licitacao_encerramentos
WHEN NEW.id IS NOT OLD.id OR NEW.empresa_id IS NOT OLD.empresa_id
 OR NEW.licitacao_id IS NOT OLD.licitacao_id OR NEW.encerrada_em IS NOT OLD.encerrada_em
 OR NEW.motivo IS NOT OLD.motivo OR NEW.encerrada_por IS NOT OLD.encerrada_por
 OR NEW.criado_em IS NOT OLD.criado_em OR (OLD.reaberta_em IS NOT NULL)
 OR (NEW.reaberta_em IS NOT NULL AND (NEW.motivo_reabertura IS NULL OR length(trim(NEW.motivo_reabertura))=0))
BEGIN SELECT RAISE(ABORT,'ciclo encerramento historico imutavel; reabertura unica exige motivo'); END;
CREATE TRIGGER trg_encerramento_nao_apagar
BEFORE DELETE ON licitacao_encerramentos
BEGIN SELECT RAISE(ABORT,'ciclo historico nao pode ser apagado'); END;
CREATE TRIGGER trg_encerramento_proj_inserir
AFTER INSERT ON licitacao_encerramentos
WHEN NEW.reaberta_em IS NULL
BEGIN
 UPDATE licitacoes SET encerrada_em=NEW.encerrada_em,
 atualizado_em=coalesce(NEW.criado_em,atualizado_em), versao=versao+1
 WHERE id=NEW.licitacao_id AND empresa_id=NEW.empresa_id;
END;
CREATE TRIGGER trg_encerramento_proj_reabrir
AFTER UPDATE OF reaberta_em ON licitacao_encerramentos
WHEN OLD.reaberta_em IS NULL AND NEW.reaberta_em IS NOT NULL
BEGIN
 UPDATE licitacoes SET encerrada_em=NULL,versao=versao+1
 WHERE id=NEW.licitacao_id AND empresa_id=NEW.empresa_id;
END;


-- R1 segue no bloco de guardas documentais abaixo.

-- R1: registros documentais são evidência, inclusive quando vindos do Apps Script.
-- LEGADO preserva seu estado histórico em campo próprio; estado operacional sempre
-- parte de PENDENTE até haver uma verificação real feita pelo futuro Worker.
CREATE TRIGGER trg_transferencia_inicia_pendente
BEFORE INSERT ON documento_transferencias
WHEN NEW.estado<>'PENDENTE' OR NEW.verificado_em IS NOT NULL
 OR NEW.sobreposicao_iniciada_em IS NOT NULL OR NEW.prazo_sobreposicao_em IS NOT NULL
 OR NEW.backup_independente_ref IS NOT NULL OR NEW.backup_independente_sha256 IS NOT NULL
 OR NEW.backup_verificado_em IS NOT NULL
BEGIN SELECT RAISE(ABORT,'transferencia de qualquer origem inicia pendente sem prazo de exclusao'); END;

CREATE TRIGGER trg_transferencia_transicao
BEFORE UPDATE OF estado ON documento_transferencias
WHEN NEW.estado IS NOT OLD.estado AND NOT (
     (OLD.estado='PENDENTE' AND NEW.estado IN ('COPIANDO','BLOQUEADO','FALHA'))
  OR (OLD.estado='COPIANDO' AND NEW.estado IN ('VALIDANDO','BLOQUEADO','FALHA'))
  OR (OLD.estado='VALIDANDO' AND NEW.estado IN ('SOBREPOSICAO_30_DIAS','BLOQUEADO','FALHA'))
  OR (OLD.estado='SOBREPOSICAO_30_DIAS' AND NEW.estado IN ('ARQUIVADO','BLOQUEADO','FALHA'))
  OR (OLD.estado IN ('FALHA','BLOQUEADO') AND OLD.sobreposicao_iniciada_em IS NULL
      AND NEW.estado='PENDENTE')
)
BEGIN SELECT RAISE(ABORT,'transicao de transferencia fora do fluxo'); END;

-- Somente o AFTER UPDATE abaixo pode inaugurar a janela, com hora do SQLite;
-- no SQL não se aceita data fornecida/retroativa como início de sobreposição.
CREATE TRIGGER trg_transferencia_identidade_imutavel
BEFORE UPDATE ON documento_transferencias
WHEN OLD.estado='ARQUIVADO'
 OR NEW.id IS NOT OLD.id OR NEW.empresa_id IS NOT OLD.empresa_id
 OR NEW.versao_id IS NOT OLD.versao_id OR NEW.idempotencia IS NOT OLD.idempotencia
 OR NEW.destino_provedor IS NOT OLD.destino_provedor
 OR NEW.origem_dado IS NOT OLD.origem_dado
 OR NEW.criado_em IS NOT OLD.criado_em
 OR NEW.estado_legado_original IS NOT OLD.estado_legado_original
 OR NEW.verificado_legado_original_em IS NOT OLD.verificado_legado_original_em
 OR (OLD.origem_localizacao_id IS NOT NULL
     AND NEW.origem_localizacao_id IS NOT OLD.origem_localizacao_id)
 OR (OLD.destino_localizacao_id IS NOT NULL
     AND NEW.destino_localizacao_id IS NOT OLD.destino_localizacao_id)
 OR NOT (
     NEW.sobreposicao_iniciada_em IS OLD.sobreposicao_iniciada_em
     OR (OLD.estado='SOBREPOSICAO_30_DIAS'
         AND NEW.estado='SOBREPOSICAO_30_DIAS'
         AND OLD.sobreposicao_iniciada_em IS NULL
         AND NEW.sobreposicao_iniciada_em=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 )
 OR NOT (
     NEW.verificado_em IS OLD.verificado_em
     OR (OLD.estado='SOBREPOSICAO_30_DIAS' AND NEW.estado='SOBREPOSICAO_30_DIAS'
         AND OLD.verificado_em IS NULL
         AND NEW.verificado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 )
 OR NOT (
     NEW.prazo_sobreposicao_em IS OLD.prazo_sobreposicao_em
     OR (OLD.estado='SOBREPOSICAO_30_DIAS' AND NEW.estado='SOBREPOSICAO_30_DIAS'
         AND OLD.prazo_sobreposicao_em IS NULL
         AND NEW.prazo_sobreposicao_em=date('now','+30 days'))
 )
 OR (
     (NEW.backup_independente_ref IS NOT OLD.backup_independente_ref
      OR NEW.backup_independente_sha256 IS NOT OLD.backup_independente_sha256
      OR NEW.backup_verificado_em IS NOT OLD.backup_verificado_em)
     AND NOT (
       OLD.estado='SOBREPOSICAO_30_DIAS' AND NEW.estado='SOBREPOSICAO_30_DIAS'
       AND OLD.backup_independente_ref IS NULL
       AND OLD.backup_independente_sha256 IS NULL
       AND OLD.backup_verificado_em IS NULL
       AND length(trim(coalesce(NEW.backup_independente_ref,'')))>0
       AND NEW.backup_independente_sha256 IS NOT NULL
       AND unixepoch(NEW.backup_verificado_em) IS NOT NULL
       AND unixepoch(NEW.backup_verificado_em)<=unixepoch('now')
       AND EXISTS (
           SELECT 1 FROM documento_versoes v
           WHERE v.id=NEW.versao_id AND v.empresa_id=NEW.empresa_id
             AND v.sha256=NEW.backup_independente_sha256
       )
     )
 )
BEGIN SELECT RAISE(ABORT,'transferencia: identidade, prazo e atestado imutaveis'); END;

-- Início do período: geração no próprio banco, não em formulário, API ou
-- timestamp fornecido pelo importador. Date ajuda exibição; epoch conta 30x24h.
CREATE TRIGGER trg_transferencia_marcar_inicio_real
AFTER UPDATE OF estado ON documento_transferencias
WHEN OLD.estado='VALIDANDO' AND NEW.estado='SOBREPOSICAO_30_DIAS'
BEGIN
 UPDATE documento_transferencias
 SET sobreposicao_iniciada_em=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
     verificado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
     prazo_sobreposicao_em=date('now','+30 days')
 WHERE id=NEW.id;
END;

CREATE TRIGGER trg_transferencia_destino_verificado
BEFORE UPDATE ON documento_transferencias
WHEN NEW.estado IN ('SOBREPOSICAO_30_DIAS','ARQUIVADO')
BEGIN
 SELECT CASE WHEN NEW.destino_provedor<>'DRIVE'
    OR NEW.origem_localizacao_id IS NULL OR NEW.destino_localizacao_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM documento_localizacoes d
      JOIN documento_localizacoes o ON o.id=NEW.origem_localizacao_id
         AND o.versao_id=d.versao_id AND o.empresa_id=d.empresa_id
      JOIN documento_versoes v ON v.id=d.versao_id AND v.empresa_id=d.empresa_id
      WHERE d.id=NEW.destino_localizacao_id
        AND d.versao_id=NEW.versao_id AND d.empresa_id=NEW.empresa_id
        AND d.provedor='DRIVE' AND d.status='VERIFICADO'
        AND o.provedor='R2' AND o.status='VERIFICADO'
        AND v.estado_integridade='VERIFICADO'
        AND v.sha256 IS NOT NULL AND v.tamanho_bytes IS NOT NULL
        AND d.hash_verificado=v.sha256 AND d.tamanho_verificado=v.tamanho_bytes
        AND o.hash_verificado=v.sha256 AND o.tamanho_verificado=v.tamanho_bytes
    ) OR EXISTS (
      SELECT 1 FROM documento_versoes v
      JOIN documento_bloqueios b ON b.documento_id=v.documento_id AND b.empresa_id=v.empresa_id
      WHERE v.id=NEW.versao_id AND v.empresa_id=NEW.empresa_id AND b.liberado_em IS NULL
    )
 THEN RAISE(ABORT,'transferencia: destino Drive nao verificado ou bloqueio ativo') END;
 SELECT CASE WHEN NEW.estado='ARQUIVADO' AND (
    OLD.estado<>'SOBREPOSICAO_30_DIAS'
    OR OLD.sobreposicao_iniciada_em IS NULL
    OR unixepoch(OLD.sobreposicao_iniciada_em) IS NULL
    OR unixepoch('now')-unixepoch(OLD.sobreposicao_iniciada_em)<2592000
    OR NEW.backup_independente_ref IS NULL
    OR NEW.backup_independente_sha256 IS NULL
    OR NEW.backup_verificado_em IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM documento_versoes v
      WHERE v.id=NEW.versao_id AND v.empresa_id=NEW.empresa_id
        AND v.sha256=NEW.backup_independente_sha256
    )
 ) THEN RAISE(ABORT,'arquivo: 30 dias reais e backup independente exigidos') END;
END;

CREATE TRIGGER trg_transferencia_no_delete
BEFORE DELETE ON documento_transferencias
BEGIN SELECT RAISE(ABORT,'registro de transferencia e historico imutavel'); END;

-- Não se exclui uma localização só porque não está mais ativa.
CREATE TRIGGER trg_localizacao_no_delete
BEFORE DELETE ON documento_localizacoes
BEGIN SELECT RAISE(ABORT,'localizacao documental nao pode ser apagada fisicamente'); END;

CREATE TRIGGER trg_localizacao_no_insert_excluido
BEFORE INSERT ON documento_localizacoes WHEN NEW.status='EXCLUIDO'
BEGIN SELECT RAISE(ABORT,'localizacao nova nao pode nascer excluida'); END;

-- Um campo histórico que DIZ "verificado" não é evidência de bytes.
-- A importação conserva a alegação original em coluna própria.
CREATE TRIGGER trg_localizacao_legado_inicia_pendente
BEFORE INSERT ON documento_localizacoes
WHEN NEW.origem_dado='LEGADO' AND NEW.status<>'PENDENTE'
BEGIN SELECT RAISE(ABORT,'localizacao legado entra pendente ate confirmar bytes'); END;

CREATE TRIGGER trg_localizacao_identidade_imutavel
BEFORE UPDATE ON documento_localizacoes
WHEN NEW.id IS NOT OLD.id OR NEW.empresa_id IS NOT OLD.empresa_id
 OR NEW.versao_id IS NOT OLD.versao_id OR NEW.provedor IS NOT OLD.provedor
 OR NEW.chave_r2 IS NOT OLD.chave_r2 OR NEW.drive_file_id IS NOT OLD.drive_file_id
 OR NEW.url_externa IS NOT OLD.url_externa OR NEW.origem_dado IS NOT OLD.origem_dado
 OR NEW.status_legado_original IS NOT OLD.status_legado_original
 OR NEW.criado_em IS NOT OLD.criado_em
 OR (OLD.status<>'PENDENTE' AND (
     NEW.hash_verificado IS NOT OLD.hash_verificado
     OR NEW.tamanho_verificado IS NOT OLD.tamanho_verificado
     OR NEW.verificado_em IS NOT OLD.verificado_em
 ))
 OR (NEW.status IS NOT OLD.status AND NOT (
       (OLD.status='PENDENTE' AND NEW.status IN ('VERIFICADO','AUSENTE','INCONSISTENTE'))
    OR (OLD.status='VERIFICADO' AND NEW.status IN ('AUSENTE','INCONSISTENTE','EXCLUIDO'))
 ))
BEGIN SELECT RAISE(ABORT,'localizacao: identidade ou estado protegido'); END;

-- Sem backup real atestado, sobreposição real, cópia Drive íntegra e ausência
-- de bloqueio, NENHUMA localização R2 pode ser marcada como EXCLUIDO.
-- Drive não possui política de exclusão nesta V1; logo é fail-closed.
CREATE TRIGGER trg_exclusao_r2_exige_arquivo
BEFORE UPDATE OF status ON documento_localizacoes
WHEN NEW.status='EXCLUIDO' AND OLD.status<>'EXCLUIDO'
BEGIN
 SELECT CASE WHEN OLD.provedor<>'R2' OR OLD.status<>'VERIFICADO'
    OR EXISTS (
      SELECT 1 FROM documento_versoes v
      JOIN documento_bloqueios b ON b.documento_id=v.documento_id AND b.empresa_id=v.empresa_id
      WHERE v.id=OLD.versao_id AND v.empresa_id=OLD.empresa_id AND b.liberado_em IS NULL
    )
    OR NOT EXISTS (
      SELECT 1 FROM documento_transferencias t
      JOIN documento_localizacoes d ON d.id=t.destino_localizacao_id
        AND d.versao_id=t.versao_id AND d.empresa_id=t.empresa_id
      JOIN documento_versoes v ON v.id=t.versao_id AND v.empresa_id=t.empresa_id
      WHERE t.origem_localizacao_id=OLD.id
        AND t.versao_id=OLD.versao_id AND t.empresa_id=OLD.empresa_id
        AND t.estado='ARQUIVADO'
        AND t.sobreposicao_iniciada_em IS NOT NULL
        AND unixepoch('now')-unixepoch(t.sobreposicao_iniciada_em)>=2592000
        AND d.provedor='DRIVE' AND d.status='VERIFICADO'
        AND v.estado_integridade='VERIFICADO'
        AND v.sha256=OLD.hash_verificado AND v.sha256=d.hash_verificado
        AND v.tamanho_bytes=OLD.tamanho_verificado
        AND v.tamanho_bytes=d.tamanho_verificado
        AND t.backup_independente_ref IS NOT NULL
        AND t.backup_independente_sha256=v.sha256
        AND t.backup_verificado_em IS NOT NULL
    )
 THEN RAISE(ABORT,'nao excluir R2: arquivamento, copia, prazo, backup ou bloqueio') END;
END;

CREATE TRIGGER trg_localizacao_perda_integridade_versao
AFTER UPDATE OF status ON documento_localizacoes
WHEN OLD.status='VERIFICADO' AND NEW.status IN ('AUSENTE','INCONSISTENTE','EXCLUIDO')
 AND NOT EXISTS (
   SELECT 1 FROM documento_localizacoes l
   WHERE l.versao_id=NEW.versao_id AND l.empresa_id=NEW.empresa_id
     AND l.status='VERIFICADO'
 )
BEGIN
 UPDATE documento_versoes
 SET estado_integridade='INCONSISTENTE', versao=versao+1,
     atualizado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE id=NEW.versao_id AND empresa_id=NEW.empresa_id
   AND estado_integridade='VERIFICADO';
END;

CREATE TRIGGER trg_bloqueio_inicia_ativo
BEFORE INSERT ON documento_bloqueios
WHEN NEW.liberado_em IS NOT NULL OR NEW.liberado_por IS NOT NULL
BEGIN SELECT RAISE(ABORT,'bloqueio de qualquer origem nasce ativo; liberacao exige verificacao'); END;

CREATE TRIGGER trg_bloqueio_no_delete
BEFORE DELETE ON documento_bloqueios
BEGIN SELECT RAISE(ABORT,'bloqueio documental deve permanecer no historico'); END;

CREATE TRIGGER trg_bloqueio_identidade_imutavel
BEFORE UPDATE ON documento_bloqueios
WHEN NEW.id IS NOT OLD.id OR NEW.empresa_id IS NOT OLD.empresa_id
 OR NEW.documento_id IS NOT OLD.documento_id OR NEW.motivo IS NOT OLD.motivo
 OR NEW.criado_por IS NOT OLD.criado_por OR NEW.criado_em IS NOT OLD.criado_em
 OR NEW.origem_dado IS NOT OLD.origem_dado
 OR NEW.liberado_legado_original_em IS NOT OLD.liberado_legado_original_em
 OR NEW.liberado_por_original_legado IS NOT OLD.liberado_por_original_legado
 OR (OLD.liberado_em IS NOT NULL AND (
    NEW.liberado_em IS NOT OLD.liberado_em
    OR NEW.liberado_por IS NOT OLD.liberado_por))
 OR (OLD.liberado_em IS NULL AND (
    (NEW.liberado_em IS NULL AND NEW.liberado_por IS NOT OLD.liberado_por)
    OR (NEW.liberado_em IS NOT NULL AND
      (NEW.liberado_por IS NULL OR length(trim(NEW.liberado_por))=0))
 ))
BEGIN SELECT RAISE(ABORT,'bloqueio: identidade imutavel e liberacao unica com responsavel'); END;

-- N02: nunca trocar NATIVE para LEGADO para contornar a compra cancelada.
CREATE TRIGGER trg_titulo_origem_fixa
BEFORE UPDATE OF origem_dado ON titulos_pagar
WHEN NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'origem de titulo e imutavel'); END;

-- R3 / N15: retroceder/cancelar compra com boleto NATIVO ativo referenciado
-- reproduz bypass de guarda unilateral em titulos_pagar.
-- A excecao de boleto LEGADO cancelado em compra CANCELADA (R2) permanece.
CREATE TRIGGER trg_compra_com_titulo_nativo_ativo_mantem_confirmada
BEFORE UPDATE OF situacao ON compras
WHEN NEW.situacao IS NOT 'CONFIRMADA' AND EXISTS (
  SELECT 1 FROM titulos_pagar t
  WHERE t.compra_id=OLD.id AND t.empresa_id=OLD.empresa_id
    AND t.tipo='FORNECEDOR' AND t.origem_dado='NATIVO' AND t.cancelado=0
)
BEGIN SELECT RAISE(ABORT,'compra com boleto nativo ativo deve permanecer confirmada'); END;

-- R3 / A08: inserir credito nativo ja exigia NF/Empenho/Licitacao habilitados;
-- agora a operacao inversa tambem nao pode invalidar fato bancario existente.
-- Consulta-se qualquer RECEBIMENTO NATIVO (mesmo ja estornado) como no legado:
-- corrigir fato financeiro exige procedimento proprio, nunca rebaixar pais.
CREATE TRIGGER trg_nf_com_credito_nativo_nao_rebaixar
BEFORE UPDATE OF situacao,empenho_id,orgao_id_escopo ON notas_fiscais
WHEN (NEW.situacao NOT IN ('EMITIDA','APRESENTADA')
      OR NEW.situacao IS NULL
      OR NEW.empenho_id IS NOT OLD.empenho_id
      OR NEW.orgao_id_escopo IS NOT OLD.orgao_id_escopo)
 AND EXISTS (
  SELECT 1 FROM contas_receber c
  JOIN recebimentos r ON r.conta_receber_id=c.id AND r.empresa_id=c.empresa_id
  WHERE c.nota_fiscal_id=OLD.id AND c.empresa_id=OLD.empresa_id
    AND r.origem_dado='NATIVO' AND r.tipo_movimento='RECEBIMENTO'
 )
BEGIN SELECT RAISE(ABORT,'NF com credito nativo nao pode retroceder/cancelar ou trocar empenho'); END;

CREATE TRIGGER trg_empenho_com_credito_nativo_nao_rebaixar
BEFORE UPDATE OF situacao,licitacao_id,orgao_id_escopo ON empenhos
WHEN (NEW.situacao IS NOT 'CONFIRMADO'
      OR NEW.licitacao_id IS NOT OLD.licitacao_id
      OR NEW.orgao_id_escopo IS NOT OLD.orgao_id_escopo)
 AND EXISTS (
  SELECT 1 FROM notas_fiscais nf
  JOIN contas_receber c ON c.nota_fiscal_id=nf.id AND c.empresa_id=nf.empresa_id
  JOIN recebimentos r ON r.conta_receber_id=c.id AND r.empresa_id=c.empresa_id
  WHERE nf.empenho_id=OLD.id AND nf.empresa_id=OLD.empresa_id
    AND r.origem_dado='NATIVO' AND r.tipo_movimento='RECEBIMENTO'
 )
BEGIN SELECT RAISE(ABORT,'empenho com credito nativo nao pode retroceder/cancelar ou trocar licitacao'); END;

CREATE TRIGGER trg_licitacao_com_credito_nativo_nao_cancelar
BEFORE UPDATE OF situacao_participacao,orgao_id ON licitacoes
WHEN (NEW.situacao_participacao='CANCELADA'
      OR NEW.orgao_id IS NOT OLD.orgao_id)
 AND EXISTS (
  SELECT 1 FROM empenhos e
  JOIN notas_fiscais nf ON nf.empenho_id=e.id AND nf.empresa_id=e.empresa_id
  JOIN contas_receber c ON c.nota_fiscal_id=nf.id AND c.empresa_id=nf.empresa_id
  JOIN recebimentos r ON r.conta_receber_id=c.id AND r.empresa_id=c.empresa_id
  WHERE e.licitacao_id=OLD.id AND e.empresa_id=OLD.empresa_id
    AND r.origem_dado='NATIVO' AND r.tipo_movimento='RECEBIMENTO'
 )
BEGIN SELECT RAISE(ABORT,'licitacao com credito nativo nao pode ser cancelada ou trocar orgao'); END;

-- Boleto de fornecedor vinculado a compra precisa de compra confirmada.
-- Boleto avulso de fornecedor continua plenamente permitido (compra_id NULL).
CREATE TRIGGER trg_titulo_compra_confirmada_inserir
BEFORE INSERT ON titulos_pagar
WHEN NEW.compra_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM compras c WHERE c.id=NEW.compra_id AND c.empresa_id=NEW.empresa_id
    AND c.fornecedor_id=NEW.fornecedor_id
    AND (c.situacao='CONFIRMADA'
         OR (c.situacao='CANCELADA' AND NEW.origem_dado='LEGADO'
             AND NEW.cancelado=1 AND NEW.conferencia IN ('PENDENTE','INCONSISTENTE')))
  ) THEN RAISE(ABORT,'vinculo exige compra confirmada do mesmo fornecedor') END;
END;
CREATE TRIGGER trg_titulo_compra_confirmada_atualizar
BEFORE UPDATE OF compra_id,fornecedor_id,cancelado,conferencia,origem_dado ON titulos_pagar
WHEN NEW.compra_id IS NOT NULL OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM compras c WHERE c.id=NEW.compra_id AND c.empresa_id=NEW.empresa_id
    AND c.fornecedor_id=NEW.fornecedor_id
    AND (c.situacao='CONFIRMADA'
         OR (c.situacao='CANCELADA' AND NEW.origem_dado='LEGADO'
             AND NEW.cancelado=1 AND NEW.conferencia IN ('PENDENTE','INCONSISTENTE')))
  ) THEN RAISE(ABORT,'vinculo exige compra confirmada do mesmo fornecedor') END;
END;
