"""Regressões dos 12 achados da auditoria. Aqui o teste PASSA quando
invariantes são preservadas e entradas inválidas são REJEITADAS.
Sem D1 remoto; fixtures simuladas do app legado e documentos.
"""
import sqlite3
import unittest
from test_ddl_v1 import DdlBase


class TestRemediacaoRelacional(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def test_A01_boleto_avulso_fornecedor_sem_compra_e_legitimo(self):
        self.insert("titulos_pagar", id="avulso", empresa_id="e1",
                    tipo="FORNECEDOR", compra_id=None, fornecedor_id="f1",
                    valor_nominal_cent=12500, vencimento="2026-11-07")
        self.insert("titulos_pagar", id="avulso_texto", empresa_id="e1",
                    tipo="FORNECEDOR", fornecedor_nome_original="Fornecedor antigo",
                    compra_id=None, valor_nominal_cent=1000)
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM titulos_pagar WHERE id LIKE 'avulso%'"
        ).fetchone(), (2,))

    def test_A01_compra_inexistente_com_fornecedor_null_e_rejeitada(self):
        self.rejects("titulos_pagar", id="inexistente", empresa_id="e1",
                     tipo="FORNECEDOR", compra_id="compra-fantasma",
                     fornecedor_id=None, valor_nominal_cent=1000)
        self.rejects("titulos_pagar", id="inexistente_2", empresa_id="e1",
                     tipo="FORNECEDOR", compra_id="compra-fantasma",
                     fornecedor_id="f1", valor_nominal_cent=1000)

    def test_A01_compra_so_se_confirmada_e_com_mesmo_fornecedor(self):
        self.rejects("titulos_pagar", id="rascunho", empresa_id="e1",
                     tipo="FORNECEDOR", compra_id="co1", fornecedor_id="f1")
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        self.insert("titulos_pagar", id="ligado", empresa_id="e1",
                    tipo="FORNECEDOR", compra_id="co1", fornecedor_id="f1",
                    valor_nominal_cent=1300)
        self.rejects("titulos_pagar", id="fornecedor_outro", empresa_id="e1",
                     tipo="FORNECEDOR", compra_id="co1", fornecedor_id="f2")

    def test_A01_diverso_sem_boleto_valido_e_recorrencia_opcional(self):
        self.insert("titulos_pagar", id="conta_sem_boleto", empresa_id="e1",
                    tipo="DIVERSO", beneficiario="Condominio", categoria_despesa="CASA",
                    valor_nominal_cent=18500, conferencia="VALIDADO")
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM documento_vinculos WHERE titulo_pagar_id='conta_sem_boleto'"
        ).fetchone(), (0,))

    def test_A02_cotacao_que_aponta_para_item_de_outra_licitacao_rejeitada(self):
        self.insert("licitacoes", id="l1_b", empresa_id="e1", orgao_id="o1", numero="2")
        self.insert("licitacao_itens", id="li1_b", empresa_id="e1",
                    licitacao_id="l1_b", numero_item="B")
        self.rejects("cotacoes_precos", id="c_bad", empresa_id="e1",
                     licitacao_id="l1", item_licitacao_id="li1_b")
        self.insert("cotacoes_precos", id="c_ok", empresa_id="e1",
                    licitacao_id="l1_b", item_licitacao_id="li1_b",
                    entrada_json='{}')

    def test_A03_versao_pendente_pode_ser_verificada_sem_alterar_identidade(self):
        self.insert("documentos", id="doc_novo", empresa_id="e1", tipo="BOLETO")
        self.insert("operacoes", id="op_ver_nova", empresa_id="e1", tipo="VALIDAR_DOCUMENTO",
                    hash_pedido="h_doc_nova", estado="REGISTRADA", ator_original="revisor A03")
        self.insert("documento_versoes", id="ver_nova", empresa_id="e1",
                    documento_id="doc_novo", numero_versao=1,
                    nome_original="boleto.pdf", mime_type="application/pdf",
                    sha256="a"*64, tamanho_bytes=40, estado_integridade="PENDENTE",
                    operacao_id="op_ver_nova")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_versoes SET estado_integridade='VERIFICADO', versao=2 WHERE id='ver_nova'")
        self.insert("documento_localizacoes", id="r2_nova", empresa_id="e1",
                    versao_id="ver_nova", provedor="R2", chave_r2="e1/opaca",
                    status="VERIFICADO", hash_verificado="a"*64,
                    tamanho_verificado=40, verificado_em="2026-11-06T20:00:00Z")
        self.db.execute("UPDATE documento_versoes SET estado_integridade='VERIFICADO', versao=2 WHERE id='ver_nova'")
        self.assertEqual(self.db.execute(
            "SELECT estado_integridade FROM documento_versoes WHERE id='ver_nova'"
        ).fetchone(), ("VERIFICADO",))
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM eventos_auditoria WHERE entidade_id_texto='ver_nova' AND acao='VERIFICAR_ESTADO'"
        ).fetchone(), (1,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_versoes SET sha256=?, versao=3 WHERE id='ver_nova'", ("b"*64,))

    def test_A04_titulo_quitado_nao_pode_ser_cancelado(self):
        self.insert("titulo_baixas", id="b1", empresa_id="e1",
                    titulo_id="t1", tipo="QUITACAO", data_pagamento="2026-01-31",
                    valor_pago_cent=18000)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE titulos_pagar SET cancelado=1 WHERE id='t1'")
        self.insert("titulo_baixas", id="b2", empresa_id="e1", titulo_id="t1",
                    tipo="DESFAZIMENTO", baixa_original_id="b1", motivo="Pagamento desfeito")
        self.db.execute("UPDATE titulos_pagar SET cancelado=1, motivo_cancelamento='Quitacao desfeita' WHERE id='t1'")

    def test_A04_boleto_legado_pago_sem_baixa_nao_pode_ser_cancelado(self):
        self.insert("titulos_pagar", id="pago_legado", empresa_id="e1",
                    tipo="FORNECEDOR", origem_dado="LEGADO", pago_legado_status="SIM")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE titulos_pagar SET cancelado=1 WHERE id='pago_legado'")

    def test_A05_titulo_cancelado_nao_pode_ser_quitado(self):
        self.db.execute("UPDATE titulos_pagar SET cancelado=1, motivo_cancelamento='Titulo invalido' WHERE id='t1'")
        self.rejects("titulo_baixas", id="bad", empresa_id="e1",
                     titulo_id="t1", tipo="QUITACAO",
                     data_pagamento="2026-01-31", valor_pago_cent=100)

    def test_A06_nao_arquivar_destino_drive_pendente(self):
        self.insert("documento_localizacoes", id="drive_pendente",
                    empresa_id="e1", versao_id="v1", provedor="DRIVE",
                    drive_file_id="file-id", status="PENDENTE")
        self.rejects("documento_transferencias", id="t_bad", empresa_id="e1",
                     versao_id="v1", destino_localizacao_id="drive_pendente",
                     destino_provedor="DRIVE", estado="ARQUIVADO",
                     verificado_em="2024-01-01T00:00:00Z", idempotencia="bad")

    def test_A06_ciclo_r2_drive_verificado_com_30_dias(self):
        self.insert("documentos", id="d3", empresa_id="e1", tipo="EDITAL")
        self.insert("operacoes", id="op_v3", empresa_id="e1", tipo="VALIDAR_DOCUMENTO",
                    hash_pedido="h_doc_v3", estado="REGISTRADA", ator_original="revisor A06")
        self.insert("documento_versoes", id="v3", empresa_id="e1",
                    documento_id="d3", numero_versao=1, estado_integridade="PENDENTE", operacao_id="op_v3",
                    sha256="a"*64, tamanho_bytes=500)
        self.insert("documento_localizacoes", id="r2", empresa_id="e1",
                    versao_id="v3", provedor="R2", chave_r2="e1/arq_r2",
                    status="VERIFICADO", hash_verificado="a"*64,
                    tamanho_verificado=500, verificado_em="2024-01-01T00:00:00Z")
        self.db.execute("UPDATE documento_versoes SET estado_integridade='VERIFICADO', versao=2 WHERE id='v3'")
        self.insert("documento_localizacoes", id="drive", empresa_id="e1",
                    versao_id="v3", provedor="DRIVE", drive_file_id="arq_drive",
                    status="VERIFICADO", hash_verificado="a"*64,
                    tamanho_verificado=500, verificado_em="2024-01-02T00:00:00Z")
        self.insert("documento_transferencias", id="trans", empresa_id="e1",
                    versao_id="v3", origem_localizacao_id="r2", destino_provedor="DRIVE",
                    idempotencia="trans_001", estado="PENDENTE")
        for state in ("COPIANDO", "VALIDANDO"):
            self.db.execute("UPDATE documento_transferencias SET estado=? WHERE id='trans'", (state,))
        # Datas antigas fornecidas pelo cliente NÃO podem criar 30 dias fictícios.
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE documento_transferencias SET estado='SOBREPOSICAO_30_DIAS', "
                "destino_localizacao_id='drive', verificado_em='2024-01-02T00:00:00Z', "
                "prazo_sobreposicao_em='2024-02-01' WHERE id='trans'"
            )
        self.db.execute(
            "UPDATE documento_transferencias SET estado='SOBREPOSICAO_30_DIAS', "
            "destino_localizacao_id='drive' WHERE id='trans'"
        )
        t = self.db.execute(
            "SELECT sobreposicao_iniciada_em, prazo_sobreposicao_em FROM documento_transferencias "
            "WHERE id='trans'"
        ).fetchone()
        self.assertIsNotNone(t[0])
        self.assertIsNotNone(t[1])
        # O prazo é imutável e a tentativa de excluir R2 imediatamente falha.
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE documento_transferencias SET prazo_sobreposicao_em='2000-01-31' WHERE id='trans'"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_localizacoes SET status='EXCLUIDO' WHERE id='r2'")
        # Atestado sintético: NÃO é prova de backup real.
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        self.db.execute(
            "UPDATE documento_transferencias SET backup_independente_ref='backup-teste', "
            "backup_independente_sha256=?, backup_verificado_em=? WHERE id='trans'",
            ("a"*64, now.strftime("%Y-%m-%dT%H:%M:%SZ"))
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_transferencias SET estado='ARQUIVADO' WHERE id='trans'")
        # Bloqueio impede arquivamento mesmo com relógio de teste avançado.
        self.insert("documento_bloqueios", id="bloqueio_d3", empresa_id="e1",
                    documento_id="d3", motivo="fiscalizacao")
        def unixepoch_local(value):
            if value == "now":
                return int((now + timedelta(days=31)).timestamp())
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
        self.db.create_function("unixepoch", 1, unixepoch_local)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_transferencias SET estado='ARQUIVADO' WHERE id='trans'")
        self.db.execute(
            "UPDATE documento_bloqueios SET liberado_em=?, liberado_por='auditor_teste' "
            "WHERE id='bloqueio_d3'",
            (now.strftime("%Y-%m-%dT%H:%M:%SZ"),)
        )
        diagnostico = self.db.execute(
            "SELECT estado, sobreposicao_iniciada_em, "
            "unixepoch('now')-unixepoch(sobreposicao_iniciada_em), "
            "backup_independente_ref, backup_independente_sha256, backup_verificado_em "
            "FROM documento_transferencias WHERE id='trans'"
        ).fetchone()
        self.assertEqual(diagnostico[0], "SOBREPOSICAO_30_DIAS", diagnostico)
        self.assertGreaterEqual(diagnostico[2], 2592000, diagnostico)
        self.assertEqual(diagnostico[4], "a"*64, diagnostico)
        self.db.execute("UPDATE documento_transferencias SET estado='ARQUIVADO' WHERE id='trans' -- reprepare apos relogio simulado")
        self.db.execute("UPDATE documento_localizacoes SET status='EXCLUIDO' WHERE id='r2' -- reprepare apos relogio simulado")
        self.assertEqual(self.db.execute(
            "SELECT estado FROM documento_transferencias WHERE id='trans'"
        ).fetchone(), ("ARQUIVADO",))

    def test_A07_legado_pendente_nao_mostra_saldo_negativo_confiavel(self):
        self.insert("recebimentos", id="leg", empresa_id="e1",
                    conta_receber_id="cr1", origem_dado="LEGADO", conferencia="PENDENTE",
                    tipo_movimento="RECEBIMENTO", data_credito="2026-11-06",
                    valor_recebido_cent=6000, retencao_confirmada_cent=0)
        self.assertEqual(self.db.execute(
            "SELECT estado_saldo, saldo_cent FROM v_contas_receber_saldos WHERE id='cr1'"
        ).fetchone(), ("PENDENTE_CONFERENCIA", None))

    def test_A08_credito_nativo_em_nf_rascunho_e_barrado(self):
        self.db.execute("UPDATE notas_fiscais SET situacao='RASCUNHO' WHERE id='nf1'")
        self.rejects("recebimentos", id="bad", empresa_id="e1",
                     conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                     data_credito="2026-11-06", valor_recebido_cent=200,
                     retencao_confirmada_cent=0)
        self.db.execute("UPDATE notas_fiscais SET situacao='EMITIDA' WHERE id='nf1'")
        self.insert("recebimentos", id="okay", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=200,
                    retencao_confirmada_cent=0)

    def test_A09_data_invalida_rejeitada_e_bissexto_aceito(self):
        self.rejects("titulos_pagar", id="invalid", empresa_id="e1",
                     tipo="DIVERSO", vencimento="2026-02-31", beneficiario="Teste",
                     categoria_despesa="X", valor_nominal_cent=100)
        self.rejects("titulos_pagar", id="invalid2", empresa_id="e1",
                     tipo="DIVERSO", vencimento="2026-02-29", beneficiario="Teste",
                     categoria_despesa="X", valor_nominal_cent=100)
        self.insert("titulos_pagar", id="valid", empresa_id="e1",
                    tipo="DIVERSO", vencimento="2024-02-29", beneficiario="Teste",
                    categoria_despesa="X", valor_nominal_cent=100)

    def test_A10_operacao_nao_pode_trocar_hash_ou_ator(self):
        self.insert("operacoes", id="op", empresa_id="e1", tipo="PAGAR_BOLETO",
                    estado="CONCLUIDA", hash_pedido="hash-original")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE operacoes SET hash_pedido='novo' WHERE id='op'")
        self.assertEqual(self.db.execute(
            "SELECT hash_pedido FROM operacoes WHERE id='op'"
        ).fetchone(), ("hash-original",))

    def test_A11_papel_de_documento_incompativel_rejeitado(self):
        self.rejects("documento_vinculos", id="papel_incorreto",
                     empresa_id="e1", documento_id="d1",
                     papel="NF_VENDA_PDF", compra_id="co1")
        self.insert("documento_vinculos", id="papel_correto",
                    empresa_id="e1", documento_id="d1",
                    papel="NF_VENDA_PDF", nota_fiscal_id="nf1")

    def test_A12_reabertura_limpa_projecao_e_reinicia_relogio(self):
        self.insert("licitacao_encerramentos", id="ce1", empresa_id="e1",
                    licitacao_id="l1", encerrada_em="2024-01-01T00:00:00Z",
                    motivo="concluida")
        self.assertEqual(self.db.execute(
            "SELECT encerrada_em FROM licitacoes WHERE id='l1'"
        ).fetchone(), ("2024-01-01T00:00:00Z",))
        self.db.execute("UPDATE licitacao_encerramentos SET reaberta_em='2026-01-01T00:00:00Z',"
                        "motivo_reabertura='nova pendencia', reaberta_por='operador de teste' WHERE id='ce1'")
        self.assertIsNone(self.db.execute(
            "SELECT encerrada_em FROM licitacoes WHERE id='l1'"
        ).fetchone()[0])
        self.insert("licitacao_encerramentos", id="ce2", empresa_id="e1",
                    licitacao_id="l1", encerrada_em="2026-10-06T00:00:00Z",
                    motivo="novo encerramento")
        self.assertEqual(self.db.execute(
            "SELECT encerrada_em FROM licitacoes WHERE id='l1'"
        ).fetchone(), ("2026-10-06T00:00:00Z",))


if __name__ == "__main__":
    unittest.main()
