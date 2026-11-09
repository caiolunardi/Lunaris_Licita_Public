-- LICITA-ROD-20261107-020 / R7 etapa 1/6
-- Q08 / FIN05: fatos imutaveis e verificacao no limite transacional.
-- Apenas 0007 apos 0001..0006, somente SQLite e Wrangler D1 --local.
-- Nao recalcular importacao LEGADO; este gate aplica-se a fluxos novos de Worker.

CREATE TABLE nf_conciliacoes (
 id TEXT NOT NULL PRIMARY KEY,
 empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
 nota_fiscal_id TEXT NOT NULL,
 numero_versao_nf INTEGER NOT NULL CHECK(numero_versao_nf>=1),
 valor_documento_cent INTEGER NOT NULL CHECK(valor_documento_cent>=1 AND valor_documento_cent<=9007199254740991),
 valor_itens_cent INTEGER NOT NULL CHECK(valor_itens_cent>=0 AND valor_itens_cent<=9007199254740991),
 valor_parcelas_cent INTEGER NOT NULL CHECK(valor_parcelas_cent>=0 AND valor_parcelas_cent<=9007199254740991),
 itens_snapshot_json TEXT NOT NULL CHECK(json_valid(itens_snapshot_json) AND json_type(itens_snapshot_json)='array'),
 parcelas_snapshot_json TEXT NOT NULL CHECK(json_valid(parcelas_snapshot_json) AND json_type(parcelas_snapshot_json)='array'),
 arredondamento TEXT NOT NULL CHECK(arredondamento='MEIO_PARA_CIMA_POR_LINHA_V1'),
 operacao_id TEXT NOT NULL,
 ator_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
 criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(nota_fiscal_id,empresa_id),
 UNIQUE(id,empresa_id),
 FOREIGN KEY(nota_fiscal_id,empresa_id) REFERENCES notas_fiscais(id,empresa_id) ON DELETE RESTRICT,
 FOREIGN KEY(operacao_id,empresa_id) REFERENCES operacoes(id,empresa_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 CHECK(valor_documento_cent=valor_itens_cent AND valor_documento_cent=valor_parcelas_cent)
) STRICT;

-- Selar a nota é evento append-only: não pode sobrescrever itens/parcelas ou
-- valor/situacao depois de gerar reconciliacao financeira.
CREATE TRIGGER trg_r7_nf_conciliacao_no_update
BEFORE UPDATE ON nf_conciliacoes
BEGIN SELECT RAISE(ABORT,'R7 Q08: conciliacao financeira imutavel'); END;
CREATE TRIGGER trg_r7_nf_conciliacao_no_delete
BEFORE DELETE ON nf_conciliacoes
BEGIN SELECT RAISE(ABORT,'R7 Q08: conciliacao financeira historica'); END;
CREATE TRIGGER trg_r7_nf_conciliacao_no_replace
BEFORE INSERT ON nf_conciliacoes
WHEN EXISTS (SELECT 1 FROM nf_conciliacoes c WHERE c.id=NEW.id OR
  (c.nota_fiscal_id=NEW.nota_fiscal_id AND c.empresa_id=NEW.empresa_id))
BEGIN SELECT RAISE(ABORT,'R7 Q08: reconciliacao existente nao pode ser substituida'); END;
CREATE TRIGGER trg_r4_nf_conciliacoes_escopo_proveniencia
BEFORE UPDATE OF empresa_id ON nf_conciliacoes
WHEN NEW.empresa_id IS NOT OLD.empresa_id
BEGIN SELECT RAISE(ABORT,'R7: empresa da conciliacao imutavel'); END;

CREATE TRIGGER trg_r7_nf_selada_header
BEFORE UPDATE OF valor_documento_cent,situacao,empresa_id ON notas_fiscais
WHEN EXISTS (SELECT 1 FROM nf_conciliacoes c
 WHERE c.empresa_id=OLD.empresa_id AND c.nota_fiscal_id=OLD.id)
 AND (NEW.valor_documento_cent IS NOT OLD.valor_documento_cent
   OR NEW.situacao IS NOT OLD.situacao OR NEW.empresa_id IS NOT OLD.empresa_id)
BEGIN SELECT RAISE(ABORT,'R7 Q08: nota conciliada imutavel'); END;
CREATE TRIGGER trg_r7_nf_selada_item_insert
BEFORE INSERT ON nota_fiscal_itens
WHEN EXISTS (SELECT 1 FROM nf_conciliacoes c
 WHERE c.empresa_id=NEW.empresa_id AND c.nota_fiscal_id=NEW.nota_fiscal_id)
BEGIN SELECT RAISE(ABORT,'R7 Q08: itens de nota conciliada bloqueados'); END;
CREATE TRIGGER trg_r7_nf_selada_item_update
BEFORE UPDATE ON nota_fiscal_itens
WHEN EXISTS (SELECT 1 FROM nf_conciliacoes c
 WHERE c.empresa_id=OLD.empresa_id AND c.nota_fiscal_id=OLD.nota_fiscal_id)
BEGIN SELECT RAISE(ABORT,'R7 Q08: itens de nota conciliada bloqueados'); END;
CREATE TRIGGER trg_r7_nf_selada_item_delete
BEFORE DELETE ON nota_fiscal_itens
WHEN EXISTS (SELECT 1 FROM nf_conciliacoes c
 WHERE c.empresa_id=OLD.empresa_id AND c.nota_fiscal_id=OLD.nota_fiscal_id)
BEGIN SELECT RAISE(ABORT,'R7 Q08: itens de nota conciliada protegidos'); END;
CREATE TRIGGER trg_r7_nf_selada_parcela_insert
BEFORE INSERT ON contas_receber
WHEN EXISTS (SELECT 1 FROM nf_conciliacoes c
 WHERE c.empresa_id=NEW.empresa_id AND c.nota_fiscal_id=NEW.nota_fiscal_id)
BEGIN SELECT RAISE(ABORT,'R7 Q08: parcelas de nota conciliada bloqueadas'); END;
CREATE TRIGGER trg_r7_nf_selada_parcela_update
BEFORE UPDATE OF valor_bruto_cent,nota_fiscal_id,empresa_id,cancelada ON contas_receber
WHEN EXISTS (SELECT 1 FROM nf_conciliacoes c
 WHERE c.empresa_id=OLD.empresa_id AND c.nota_fiscal_id=OLD.nota_fiscal_id)
 AND (NEW.valor_bruto_cent IS NOT OLD.valor_bruto_cent OR NEW.nota_fiscal_id IS NOT OLD.nota_fiscal_id
  OR NEW.empresa_id IS NOT OLD.empresa_id OR NEW.cancelada IS NOT OLD.cancelada)
BEGIN SELECT RAISE(ABORT,'R7 Q08: valor de parcela conciliada imutavel'); END;
CREATE TRIGGER trg_r7_nf_selada_parcela_delete
BEFORE DELETE ON contas_receber
WHEN EXISTS (SELECT 1 FROM nf_conciliacoes c
 WHERE c.empresa_id=OLD.empresa_id AND c.nota_fiscal_id=OLD.nota_fiscal_id)
BEGIN SELECT RAISE(ABORT,'R7 Q08: parcelas de nota conciliada protegidas'); END;

-- Evidência documental material (hash/tamanho/versão) não significa por si
-- validação bancária. ATESTADO exige autoria humana e documento verificado.
CREATE TABLE retencao_atestados (
 id TEXT NOT NULL PRIMARY KEY,
 empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
 conta_receber_id TEXT NOT NULL,
 documento_versao_id TEXT NOT NULL,
 valor_confirmado_cent INTEGER NOT NULL CHECK(valor_confirmado_cent>0 AND valor_confirmado_cent<=9007199254740991),
 atestado_por_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
 operacao_id TEXT NOT NULL,
 criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(id,empresa_id),
 UNIQUE(empresa_id,conta_receber_id,documento_versao_id),
 FOREIGN KEY(conta_receber_id,empresa_id) REFERENCES contas_receber(id,empresa_id) ON DELETE RESTRICT,
 FOREIGN KEY(documento_versao_id,empresa_id) REFERENCES documento_versoes(id,empresa_id) ON DELETE RESTRICT,
 FOREIGN KEY(operacao_id,empresa_id) REFERENCES operacoes(id,empresa_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TRIGGER trg_r7_retencao_atestado_gate
BEFORE INSERT ON retencao_atestados
WHEN NOT EXISTS(SELECT 1 FROM contas_receber cr
 WHERE cr.id=NEW.conta_receber_id AND cr.empresa_id=NEW.empresa_id
   AND cr.cancelada=0)
 OR NOT EXISTS (
 SELECT 1 FROM documento_versoes v
 JOIN documentos d ON d.id=v.documento_id AND d.empresa_id=v.empresa_id
 WHERE v.id=NEW.documento_versao_id AND v.empresa_id=NEW.empresa_id
 AND d.tipo='COMPROVANTE_RETENCAO' AND v.estado_integridade='VERIFICADO'
 AND v.sha256 IS NOT NULL AND v.tamanho_bytes IS NOT NULL
 AND EXISTS (
  SELECT 1 FROM documento_localizacoes l
  WHERE l.versao_id=v.id AND l.empresa_id=v.empresa_id
   AND l.status='VERIFICADO' AND l.provedor IN ('R2','DRIVE')
   AND l.hash_verificado=v.sha256 AND l.tamanho_verificado=v.tamanho_bytes
 )
)
OR NOT EXISTS(SELECT 1 FROM usuarios u WHERE u.id=NEW.atestado_por_id AND u.ativo=1)
BEGIN SELECT RAISE(ABORT,'R7 FIN05: atestado exige autor ativo e comprovante verificado'); END;
CREATE TRIGGER trg_r7_retencao_atestado_no_update
BEFORE UPDATE ON retencao_atestados
BEGIN SELECT RAISE(ABORT,'R7 FIN05: atestado imutavel'); END;
CREATE TRIGGER trg_r7_retencao_atestado_no_delete
BEFORE DELETE ON retencao_atestados
BEGIN SELECT RAISE(ABORT,'R7 FIN05: atestado historico'); END;
CREATE TRIGGER trg_r7_retencao_atestado_no_replace
BEFORE INSERT ON retencao_atestados
WHEN EXISTS(SELECT 1 FROM retencao_atestados a WHERE a.id=NEW.id OR
 (a.empresa_id=NEW.empresa_id AND a.conta_receber_id=NEW.conta_receber_id
  AND a.documento_versao_id=NEW.documento_versao_id))
BEGIN SELECT RAISE(ABORT,'R7 FIN05: atestado nao pode ser substituido'); END;
CREATE TRIGGER trg_r4_retencao_atestados_escopo_proveniencia
BEFORE UPDATE OF empresa_id ON retencao_atestados
WHEN NEW.empresa_id IS NOT OLD.empresa_id
BEGIN SELECT RAISE(ABORT,'R7: empresa do atestado imutavel'); END;

-- ALTER aditivo preserva receipts existentes. As novas rotas FIN05
-- usam atestado_id, nunca copiam retencao_prevista_cent diretamente.
ALTER TABLE recebimentos ADD COLUMN retencao_atestado_id TEXT REFERENCES retencao_atestados(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_r7_recebimento_atestado_utilizado
 ON recebimentos(retencao_atestado_id)
 WHERE retencao_atestado_id IS NOT NULL AND tipo_movimento='RECEBIMENTO';

-- Integridade no fluxo Worker (operacao_id obrigatoria), com legado
-- original deixado inalterado. SQL direto NAO é API — endurecimento global
-- sem exceções depende de sanear fixtures e migracao historica na etapa 2.
CREATE TRIGGER trg_r7_retencao_recebimento_journal
BEFORE INSERT ON recebimentos
WHEN NEW.tipo_movimento='RECEBIMENTO' AND NEW.origem_dado='NATIVO'
 AND NEW.operacao_id IS NOT NULL
 AND (
   (NEW.retencao_confirmada_cent>0 AND (
     NEW.retencao_atestado_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM retencao_atestados a
       WHERE a.id=NEW.retencao_atestado_id AND a.empresa_id=NEW.empresa_id
         AND a.conta_receber_id=NEW.conta_receber_id
         AND a.valor_confirmado_cent=NEW.retencao_confirmada_cent
     )
   ))
   OR (NEW.retencao_confirmada_cent=0 AND NEW.retencao_atestado_id IS NOT NULL)
 )
BEGIN SELECT RAISE(ABORT,'R7 FIN05: retencao confirmada exige atestado individual'); END;
