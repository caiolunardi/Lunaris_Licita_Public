-- Segunda migration LOCAL, sequencial a 0001; nao aplicar a nenhum D1 remoto.
-- R4: N07-N11, A04/A10 parcialmente; propriedade, proveniencia e retencao.
-- Isolamento e origem nao substituem autenticacao JWT/Worker.
-- R4/N07: prefixo por empresa em TODA origem; chave opaca criada no Worker.
-- Drive: id original vazio do LEGADO pode ser guardado somente em quarentena.
-- Um ponteiro sem id nunca pode adquirir status VERIFICADO.
CREATE TRIGGER trg_r4_localizador_inserir BEFORE INSERT ON documento_localizacoes
WHEN (NEW.provedor='R2' AND (
  NEW.chave_r2 IS NULL
  OR length(NEW.chave_r2)<=length(NEW.empresa_id)+1
  OR substr(NEW.chave_r2,1,length(NEW.empresa_id)+1)<>NEW.empresa_id||'/'
  OR instr(NEW.chave_r2,'//')>0 OR instr(NEW.chave_r2,'/../')>0
  OR instr(NEW.chave_r2,'/./')>0
  OR substr(NEW.chave_r2,-3)='/..' OR substr(NEW.chave_r2,-2)='/.'
  OR instr(NEW.chave_r2,char(92))>0))
 OR (NEW.provedor='DRIVE' AND length(trim(coalesce(NEW.drive_file_id,'')))=0
     AND NOT (NEW.origem_dado='LEGADO' AND NEW.status IN ('PENDENTE','INCONSISTENTE','AUSENTE')))
BEGIN SELECT RAISE(ABORT,'R4: localizador invalido ou fora do namespace'); END;
CREATE TRIGGER trg_r4_localizador_atualizar
BEFORE UPDATE OF chave_r2,drive_file_id,provedor,status,origem_dado,empresa_id ON documento_localizacoes
WHEN (NEW.provedor='R2' AND (
  NEW.chave_r2 IS NULL
  OR length(NEW.chave_r2)<=length(NEW.empresa_id)+1
  OR substr(NEW.chave_r2,1,length(NEW.empresa_id)+1)<>NEW.empresa_id||'/'
  OR instr(NEW.chave_r2,'//')>0 OR instr(NEW.chave_r2,'/../')>0
  OR instr(NEW.chave_r2,'/./')>0
  OR substr(NEW.chave_r2,-3)='/..' OR substr(NEW.chave_r2,-2)='/.'
  OR instr(NEW.chave_r2,char(92))>0))
 OR (NEW.provedor='DRIVE' AND length(trim(coalesce(NEW.drive_file_id,'')))=0
     AND NOT (NEW.origem_dado='LEGADO' AND NEW.status IN ('PENDENTE','INCONSISTENTE','AUSENTE')))
BEGIN SELECT RAISE(ABORT,'R4: localizador invalido ou fora do namespace'); END;

-- R4/N09/A04: preserva fatos economicos inclusive depois de DESFAZIMENTO.
CREATE TRIGGER trg_r4_titulo_pago_base_congelada
BEFORE UPDATE OF tipo,compra_id,fornecedor_id,fornecedor_nome_original,beneficiario,categoria_despesa,descricao_boleto,recorrencia_id,competencia,valor_nominal_cent,vencimento ON titulos_pagar
WHEN (OLD.pago_legado_status='SIM' OR EXISTS (
  SELECT 1 FROM titulo_baixas b WHERE b.titulo_id=OLD.id
    AND b.empresa_id=OLD.empresa_id AND b.tipo='QUITACAO'))
AND (NEW.tipo IS NOT OLD.tipo
  OR NEW.compra_id IS NOT OLD.compra_id
  OR NEW.fornecedor_id IS NOT OLD.fornecedor_id
  OR NEW.fornecedor_nome_original IS NOT OLD.fornecedor_nome_original
  OR NEW.beneficiario IS NOT OLD.beneficiario
  OR NEW.categoria_despesa IS NOT OLD.categoria_despesa
  OR NEW.descricao_boleto IS NOT OLD.descricao_boleto
  OR NEW.recorrencia_id IS NOT OLD.recorrencia_id
  OR NEW.competencia IS NOT OLD.competencia
  OR NEW.valor_nominal_cent IS NOT OLD.valor_nominal_cent
  OR NEW.vencimento IS NOT OLD.vencimento)
BEGIN SELECT RAISE(ABORT,'R4: titulo pago preserva sua base economica'); END;
CREATE TRIGGER trg_r4_titulo_pagamento_legado_fixo
BEFORE UPDATE OF pago_legado_status,data_pagamento_legado,valor_pago_legado_cent,legado_migrado_em ON titulos_pagar
WHEN NEW.pago_legado_status IS NOT OLD.pago_legado_status
 OR NEW.data_pagamento_legado IS NOT OLD.data_pagamento_legado
 OR NEW.valor_pago_legado_cent IS NOT OLD.valor_pago_legado_cent
 OR NEW.legado_migrado_em IS NOT OLD.legado_migrado_em
BEGIN SELECT RAISE(ABORT,'R4: metadados historicos de pagamento imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_usuarios_empresas_escopo_proveniencia
BEFORE UPDATE OF empresa_id ON usuarios_empresas
WHEN NEW.empresa_id IS NOT OLD.empresa_id
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_orgaos_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON orgaos
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_fornecedores_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON fornecedores
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_licitacoes_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON licitacoes
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_licitacao_itens_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON licitacao_itens
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_empenhos_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON empenhos
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_empenho_itens_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON empenho_itens
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_compras_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON compras
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_compra_itens_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON compra_itens
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_envios_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON envios
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_envio_itens_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON envio_itens
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_notas_fiscais_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON notas_fiscais
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_nota_fiscal_itens_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON nota_fiscal_itens
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_recorrencias_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON recorrencias
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_titulos_pagar_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON titulos_pagar
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_titulo_baixas_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON titulo_baixas
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_recorrencia_revisoes_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON recorrencia_revisoes
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_contas_receber_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON contas_receber
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_recebimentos_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON recebimentos
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_recebimento_conferencias_escopo_proveniencia
BEFORE UPDATE OF empresa_id ON recebimento_conferencias
WHEN NEW.empresa_id IS NOT OLD.empresa_id
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_cotacoes_precos_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON cotacoes_precos
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_documentos_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON documentos
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_documento_versoes_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON documento_versoes
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_documento_vinculos_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON documento_vinculos
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_documento_localizacoes_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON documento_localizacoes
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_documento_transferencias_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON documento_transferencias
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_documento_bloqueios_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON documento_bloqueios
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_licitacao_encerramentos_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON licitacao_encerramentos
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_operacoes_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON operacoes
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_eventos_auditoria_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON eventos_auditoria
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_tarefas_assincronas_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON tarefas_assincronas
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_configuracoes_escopo_proveniencia
BEFORE UPDATE OF empresa_id ON configuracoes
WHEN NEW.empresa_id IS NOT OLD.empresa_id
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_notificacoes_preferencias_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON notificacoes_preferencias
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_notificacoes_destinatarios_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON notificacoes_destinatarios
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_notificacoes_envios_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON notificacoes_envios
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_lotes_migracao_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON lotes_migracao
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_migracao_referencias_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON migracao_referencias
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

-- R4/N08,N10: o isolamento nao depende de FK filha preenchida.
CREATE TRIGGER trg_r4_migracao_itens_escopo_proveniencia
BEFORE UPDATE OF empresa_id,origem_dado ON migracao_itens
WHEN NEW.empresa_id IS NOT OLD.empresa_id OR NEW.origem_dado IS NOT OLD.origem_dado
BEGIN SELECT RAISE(ABORT,'R4: empresa e origem imutaveis'); END;

CREATE TRIGGER trg_r4_orgaos_no_delete BEFORE DELETE ON orgaos
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_fornecedores_no_delete BEFORE DELETE ON fornecedores
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_licitacoes_no_delete BEFORE DELETE ON licitacoes
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_licitacao_itens_no_delete BEFORE DELETE ON licitacao_itens
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_empenhos_no_delete BEFORE DELETE ON empenhos
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_empenho_itens_no_delete BEFORE DELETE ON empenho_itens
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_compras_no_delete BEFORE DELETE ON compras
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_compra_itens_no_delete BEFORE DELETE ON compra_itens
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_envios_no_delete BEFORE DELETE ON envios
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_envio_itens_no_delete BEFORE DELETE ON envio_itens
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_notas_fiscais_no_delete BEFORE DELETE ON notas_fiscais
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_nota_fiscal_itens_no_delete BEFORE DELETE ON nota_fiscal_itens
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_recorrencias_no_delete BEFORE DELETE ON recorrencias
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_titulos_pagar_no_delete BEFORE DELETE ON titulos_pagar
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_contas_receber_no_delete BEFORE DELETE ON contas_receber
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_documentos_no_delete BEFORE DELETE ON documentos
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_documento_vinculos_no_delete BEFORE DELETE ON documento_vinculos
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_operacoes_no_delete BEFORE DELETE ON operacoes
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_lotes_migracao_no_delete BEFORE DELETE ON lotes_migracao
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_migracao_referencias_no_delete BEFORE DELETE ON migracao_referencias
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

CREATE TRIGGER trg_r4_migracao_itens_no_delete BEFORE DELETE ON migracao_itens
BEGIN SELECT RAISE(ABORT,'R4: nao apagar fisicamente registros historicos'); END;

-- R4/N11/A10: REPLACE contorna DELETE quando recursive_triggers=OFF.
CREATE TRIGGER trg_r4_cotacoes_precos_no_replace_insert
BEFORE INSERT ON cotacoes_precos
WHEN EXISTS(SELECT 1 FROM cotacoes_precos AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_recebimentos_no_replace_insert
BEFORE INSERT ON recebimentos
WHEN EXISTS(SELECT 1 FROM recebimentos AS p WHERE p.id=NEW.id OR (p.estorno_de_id=NEW.estorno_de_id AND (p.estorno_de_id IS NOT NULL) AND (NEW.estorno_de_id IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_titulo_baixas_no_replace_insert
BEFORE INSERT ON titulo_baixas
WHEN EXISTS(SELECT 1 FROM titulo_baixas AS p WHERE p.id=NEW.id OR (p.baixa_original_id=NEW.baixa_original_id AND (p.baixa_original_id IS NOT NULL) AND (NEW.baixa_original_id IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_recorrencia_revisoes_no_replace_insert
BEFORE INSERT ON recorrencia_revisoes
WHEN EXISTS(SELECT 1 FROM recorrencia_revisoes AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_eventos_auditoria_no_replace_insert
BEFORE INSERT ON eventos_auditoria
WHEN EXISTS(SELECT 1 FROM eventos_auditoria AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_documento_versoes_no_replace_insert
BEFORE INSERT ON documento_versoes
WHEN EXISTS(SELECT 1 FROM documento_versoes AS p WHERE p.id=NEW.id OR (p.documento_id=NEW.documento_id AND p.numero_versao=NEW.numero_versao))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_orgaos_no_replace_insert
BEFORE INSERT ON orgaos
WHEN EXISTS(SELECT 1 FROM orgaos AS p WHERE p.id=NEW.id OR (p.empresa_id=NEW.empresa_id AND p.nome_normalizado=NEW.nome_normalizado AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.nome_normalizado IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.nome_normalizado IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_orgaos_no_replace_update
BEFORE UPDATE ON orgaos
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM orgaos AS p WHERE p.id<>OLD.id AND ((p.empresa_id=NEW.empresa_id AND p.nome_normalizado=NEW.nome_normalizado AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.nome_normalizado IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.nome_normalizado IS NOT NULL))))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_fornecedores_no_replace_insert
BEFORE INSERT ON fornecedores
WHEN EXISTS(SELECT 1 FROM fornecedores AS p WHERE p.id=NEW.id OR (p.empresa_id=NEW.empresa_id AND p.nome_normalizado=NEW.nome_normalizado AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.nome_normalizado IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.nome_normalizado IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_fornecedores_no_replace_update
BEFORE UPDATE ON fornecedores
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM fornecedores AS p WHERE p.id<>OLD.id AND ((p.empresa_id=NEW.empresa_id AND p.nome_normalizado=NEW.nome_normalizado AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.nome_normalizado IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.nome_normalizado IS NOT NULL))))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_licitacoes_no_replace_insert
BEFORE INSERT ON licitacoes
WHEN EXISTS(SELECT 1 FROM licitacoes AS p WHERE p.id=NEW.id OR (p.empresa_id=NEW.empresa_id AND p.orgao_id=NEW.orgao_id AND p.numero_normalizado=NEW.numero_normalizado AND p.ano=NEW.ano AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.numero_normalizado IS NOT NULL AND p.ano IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.numero_normalizado IS NOT NULL AND NEW.ano IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_licitacoes_no_replace_update
BEFORE UPDATE ON licitacoes
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM licitacoes AS p WHERE p.id<>OLD.id AND ((p.empresa_id=NEW.empresa_id AND p.orgao_id=NEW.orgao_id AND p.numero_normalizado=NEW.numero_normalizado AND p.ano=NEW.ano AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.numero_normalizado IS NOT NULL AND p.ano IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.numero_normalizado IS NOT NULL AND NEW.ano IS NOT NULL))))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_licitacao_itens_no_replace_insert
BEFORE INSERT ON licitacao_itens
WHEN EXISTS(SELECT 1 FROM licitacao_itens AS p WHERE p.id=NEW.id OR (p.licitacao_id=NEW.licitacao_id AND coalesce(p.lote_normalizado,'')=coalesce(NEW.lote_normalizado,'') AND p.numero_item_normalizado=NEW.numero_item_normalizado AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.numero_item_normalizado IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.numero_item_normalizado IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_licitacao_itens_no_replace_update
BEFORE UPDATE ON licitacao_itens
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM licitacao_itens AS p WHERE p.id<>OLD.id AND ((p.licitacao_id=NEW.licitacao_id AND coalesce(p.lote_normalizado,'')=coalesce(NEW.lote_normalizado,'') AND p.numero_item_normalizado=NEW.numero_item_normalizado AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.numero_item_normalizado IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.numero_item_normalizado IS NOT NULL))))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_empenhos_no_replace_insert
BEFORE INSERT ON empenhos
WHEN EXISTS(SELECT 1 FROM empenhos AS p WHERE p.id=NEW.id OR (p.empresa_id=NEW.empresa_id AND p.orgao_id_escopo=NEW.orgao_id_escopo AND p.numero_normalizado=NEW.numero_normalizado AND p.ano=NEW.ano AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.numero_normalizado IS NOT NULL AND p.ano IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.numero_normalizado IS NOT NULL AND NEW.ano IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_empenhos_no_replace_update
BEFORE UPDATE ON empenhos
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM empenhos AS p WHERE p.id<>OLD.id AND ((p.empresa_id=NEW.empresa_id AND p.orgao_id_escopo=NEW.orgao_id_escopo AND p.numero_normalizado=NEW.numero_normalizado AND p.ano=NEW.ano AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.numero_normalizado IS NOT NULL AND p.ano IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.numero_normalizado IS NOT NULL AND NEW.ano IS NOT NULL))))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_empenho_itens_no_replace_insert
BEFORE INSERT ON empenho_itens
WHEN EXISTS(SELECT 1 FROM empenho_itens AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_empenho_itens_no_replace_update
BEFORE UPDATE ON empenho_itens
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_compras_no_replace_insert
BEFORE INSERT ON compras
WHEN EXISTS(SELECT 1 FROM compras AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_compras_no_replace_update
BEFORE UPDATE ON compras
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_compra_itens_no_replace_insert
BEFORE INSERT ON compra_itens
WHEN EXISTS(SELECT 1 FROM compra_itens AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_compra_itens_no_replace_update
BEFORE UPDATE ON compra_itens
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_envios_no_replace_insert
BEFORE INSERT ON envios
WHEN EXISTS(SELECT 1 FROM envios AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_envios_no_replace_update
BEFORE UPDATE ON envios
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_envio_itens_no_replace_insert
BEFORE INSERT ON envio_itens
WHEN EXISTS(SELECT 1 FROM envio_itens AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_envio_itens_no_replace_update
BEFORE UPDATE ON envio_itens
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_notas_fiscais_no_replace_insert
BEFORE INSERT ON notas_fiscais
WHEN EXISTS(SELECT 1 FROM notas_fiscais AS p WHERE p.id=NEW.id OR (p.empresa_id=NEW.empresa_id AND p.chave_acesso=NEW.chave_acesso AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.chave_acesso IS NOT NULL AND trim(p.chave_acesso) <> '') AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.chave_acesso IS NOT NULL AND trim(NEW.chave_acesso) <> '')) OR (p.empresa_id=NEW.empresa_id AND p.orgao_id_escopo=NEW.orgao_id_escopo AND p.numero_normalizado=NEW.numero_normalizado AND coalesce(p.serie,'')=coalesce(NEW.serie,'') AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.numero_normalizado IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.numero_normalizado IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_notas_fiscais_no_replace_update
BEFORE UPDATE ON notas_fiscais
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM notas_fiscais AS p WHERE p.id<>OLD.id AND ((p.empresa_id=NEW.empresa_id AND p.chave_acesso=NEW.chave_acesso AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.chave_acesso IS NOT NULL AND trim(p.chave_acesso) <> '') AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.chave_acesso IS NOT NULL AND trim(NEW.chave_acesso) <> '')) OR (p.empresa_id=NEW.empresa_id AND p.orgao_id_escopo=NEW.orgao_id_escopo AND p.numero_normalizado=NEW.numero_normalizado AND coalesce(p.serie,'')=coalesce(NEW.serie,'') AND ((p.origem_dado='NATIVO' OR p.conferencia='VALIDADO') AND p.numero_normalizado IS NOT NULL) AND ((NEW.origem_dado='NATIVO' OR NEW.conferencia='VALIDADO') AND NEW.numero_normalizado IS NOT NULL))))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_nota_fiscal_itens_no_replace_insert
BEFORE INSERT ON nota_fiscal_itens
WHEN EXISTS(SELECT 1 FROM nota_fiscal_itens AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_nota_fiscal_itens_no_replace_update
BEFORE UPDATE ON nota_fiscal_itens
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_recorrencias_no_replace_insert
BEFORE INSERT ON recorrencias
WHEN EXISTS(SELECT 1 FROM recorrencias AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_recorrencias_no_replace_update
BEFORE UPDATE ON recorrencias
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_titulos_pagar_no_replace_insert
BEFORE INSERT ON titulos_pagar
WHEN EXISTS(SELECT 1 FROM titulos_pagar AS p WHERE p.id=NEW.id OR (p.recorrencia_id=NEW.recorrencia_id AND p.competencia=NEW.competencia AND (p.recorrencia_id IS NOT NULL) AND (NEW.recorrencia_id IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_titulos_pagar_no_replace_update
BEFORE UPDATE ON titulos_pagar
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM titulos_pagar AS p WHERE p.id<>OLD.id AND ((p.recorrencia_id=NEW.recorrencia_id AND p.competencia=NEW.competencia AND (p.recorrencia_id IS NOT NULL) AND (NEW.recorrencia_id IS NOT NULL))))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_contas_receber_no_replace_insert
BEFORE INSERT ON contas_receber
WHEN EXISTS(SELECT 1 FROM contas_receber AS p WHERE p.id=NEW.id OR (p.nota_fiscal_id=NEW.nota_fiscal_id AND p.parcela=NEW.parcela AND (p.cancelada=0) AND (NEW.cancelada=0)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_contas_receber_no_replace_update
BEFORE UPDATE ON contas_receber
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM contas_receber AS p WHERE p.id<>OLD.id AND ((p.nota_fiscal_id=NEW.nota_fiscal_id AND p.parcela=NEW.parcela AND (p.cancelada=0) AND (NEW.cancelada=0))))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_documentos_no_replace_insert
BEFORE INSERT ON documentos
WHEN EXISTS(SELECT 1 FROM documentos AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_documentos_no_replace_update
BEFORE UPDATE ON documentos
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_documento_vinculos_no_replace_insert
BEFORE INSERT ON documento_vinculos
WHEN EXISTS(SELECT 1 FROM documento_vinculos AS p WHERE p.id=NEW.id OR (p.licitacao_id=NEW.licitacao_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.licitacao_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.licitacao_id IS NOT NULL)) OR (p.licitacao_item_id=NEW.licitacao_item_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.licitacao_item_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.licitacao_item_id IS NOT NULL)) OR (p.empenho_id=NEW.empenho_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.empenho_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.empenho_id IS NOT NULL)) OR (p.compra_id=NEW.compra_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.compra_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.compra_id IS NOT NULL)) OR (p.envio_id=NEW.envio_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.envio_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.envio_id IS NOT NULL)) OR (p.nota_fiscal_id=NEW.nota_fiscal_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.nota_fiscal_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.nota_fiscal_id IS NOT NULL)) OR (p.titulo_pagar_id=NEW.titulo_pagar_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.titulo_pagar_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.titulo_pagar_id IS NOT NULL)) OR (p.titulo_baixa_id=NEW.titulo_baixa_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.titulo_baixa_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.titulo_baixa_id IS NOT NULL)) OR (p.conta_receber_id=NEW.conta_receber_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.conta_receber_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.conta_receber_id IS NOT NULL)) OR (p.recebimento_id=NEW.recebimento_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.recebimento_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.recebimento_id IS NOT NULL)) OR (p.cotacao_id=NEW.cotacao_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.cotacao_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.cotacao_id IS NOT NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_documento_vinculos_no_replace_update
BEFORE UPDATE ON documento_vinculos
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM documento_vinculos AS p WHERE p.id<>OLD.id AND ((p.licitacao_id=NEW.licitacao_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.licitacao_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.licitacao_id IS NOT NULL)) OR (p.licitacao_item_id=NEW.licitacao_item_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.licitacao_item_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.licitacao_item_id IS NOT NULL)) OR (p.empenho_id=NEW.empenho_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.empenho_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.empenho_id IS NOT NULL)) OR (p.compra_id=NEW.compra_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.compra_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.compra_id IS NOT NULL)) OR (p.envio_id=NEW.envio_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.envio_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.envio_id IS NOT NULL)) OR (p.nota_fiscal_id=NEW.nota_fiscal_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.nota_fiscal_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.nota_fiscal_id IS NOT NULL)) OR (p.titulo_pagar_id=NEW.titulo_pagar_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.titulo_pagar_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.titulo_pagar_id IS NOT NULL)) OR (p.titulo_baixa_id=NEW.titulo_baixa_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.titulo_baixa_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.titulo_baixa_id IS NOT NULL)) OR (p.conta_receber_id=NEW.conta_receber_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.conta_receber_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.conta_receber_id IS NOT NULL)) OR (p.recebimento_id=NEW.recebimento_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.recebimento_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.recebimento_id IS NOT NULL)) OR (p.cotacao_id=NEW.cotacao_id AND p.papel=NEW.papel AND (p.ativo=1 AND p.cotacao_id IS NOT NULL) AND (NEW.ativo=1 AND NEW.cotacao_id IS NOT NULL))))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_operacoes_no_replace_insert
BEFORE INSERT ON operacoes
WHEN EXISTS(SELECT 1 FROM operacoes AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_operacoes_no_replace_update
BEFORE UPDATE ON operacoes
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_lotes_migracao_no_replace_insert
BEFORE INSERT ON lotes_migracao
WHEN EXISTS(SELECT 1 FROM lotes_migracao AS p WHERE p.id=NEW.id OR (p.empresa_id=NEW.empresa_id AND p.origem_snapshot=NEW.origem_snapshot AND p.hash_origem=NEW.hash_origem))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_lotes_migracao_no_replace_update
BEFORE UPDATE ON lotes_migracao
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM lotes_migracao AS p WHERE p.id<>OLD.id AND ((p.empresa_id=NEW.empresa_id AND p.origem_snapshot=NEW.origem_snapshot AND p.hash_origem=NEW.hash_origem)))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_migracao_referencias_no_replace_insert
BEFORE INSERT ON migracao_referencias
WHEN EXISTS(SELECT 1 FROM migracao_referencias AS p WHERE p.id=NEW.id OR (p.lote_id=NEW.lote_id AND p.tipo_origem=NEW.tipo_origem AND p.id_origem_estavel=NEW.id_origem_estavel))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_migracao_referencias_no_replace_update
BEFORE UPDATE ON migracao_referencias
WHEN NEW.id IS NOT OLD.id OR EXISTS(SELECT 1 FROM migracao_referencias AS p WHERE p.id<>OLD.id AND ((p.lote_id=NEW.lote_id AND p.tipo_origem=NEW.tipo_origem AND p.id_origem_estavel=NEW.id_origem_estavel)))
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_migracao_itens_no_replace_insert
BEFORE INSERT ON migracao_itens
WHEN EXISTS(SELECT 1 FROM migracao_itens AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode substituir historico'); END;

CREATE TRIGGER trg_r4_migracao_itens_no_replace_update
BEFORE UPDATE ON migracao_itens
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'R4: UPDATE OR REPLACE nao pode substituir historico'); END;

-- R4: protecoes complementares dos diarios/documentos ja append-only.
CREATE TRIGGER trg_r4_recebimento_conferencias_no_replace_insert BEFORE INSERT ON recebimento_conferencias
WHEN EXISTS(SELECT 1 FROM recebimento_conferencias AS p WHERE p.id=NEW.id OR (p.recebimento_id=NEW.recebimento_id AND p.empresa_id=NEW.empresa_id AND p.revisao=NEW.revisao))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode apagar historico'); END;

CREATE TRIGGER trg_r4_licitacao_encerramentos_no_replace_insert BEFORE INSERT ON licitacao_encerramentos
WHEN EXISTS(SELECT 1 FROM licitacao_encerramentos AS p WHERE p.id=NEW.id OR (p.licitacao_id=NEW.licitacao_id AND (p.reaberta_em IS NULL) AND (NEW.reaberta_em IS NULL)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode apagar historico'); END;

CREATE TRIGGER trg_r4_documento_transferencias_no_replace_insert BEFORE INSERT ON documento_transferencias
WHEN EXISTS(SELECT 1 FROM documento_transferencias AS p WHERE p.id=NEW.id OR (p.empresa_id=NEW.empresa_id AND p.idempotencia=NEW.idempotencia))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode apagar historico'); END;

CREATE TRIGGER trg_r4_documento_localizacoes_no_replace_insert BEFORE INSERT ON documento_localizacoes
WHEN EXISTS(SELECT 1 FROM documento_localizacoes AS p WHERE p.id=NEW.id OR (p.chave_r2=NEW.chave_r2 AND (p.provedor='R2' AND p.chave_r2 IS NOT NULL) AND (NEW.provedor='R2' AND NEW.chave_r2 IS NOT NULL)) OR (p.drive_file_id=NEW.drive_file_id AND (p.provedor='DRIVE' AND p.drive_file_id IS NOT NULL AND length(trim(p.drive_file_id))>0) AND (NEW.provedor='DRIVE' AND NEW.drive_file_id IS NOT NULL AND length(trim(NEW.drive_file_id))>0)))
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode apagar historico'); END;

CREATE TRIGGER trg_r4_documento_bloqueios_no_replace_insert BEFORE INSERT ON documento_bloqueios
WHEN EXISTS(SELECT 1 FROM documento_bloqueios AS p WHERE p.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'R4: REPLACE nao pode apagar historico'); END;
