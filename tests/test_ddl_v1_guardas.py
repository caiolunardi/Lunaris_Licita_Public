"""Complemento: auditoria física de 350 campos e invariantes financeiros no SQLite.
Escopo estritamente LOCAL. Não prova as validações de negócio no Worker.
"""
import sqlite3
import unittest
from test_ddl_v1 import DdlBase, MIGRATION, TABLES


# A matriz é um artefato interno de auditoria mantido no repositório privado.
# Quando ela acompanha o código (desenvolvimento privado), a prova roda normalmente.
# Na exportação pública reduzida, o teste fica explicitamente ignorado.
LEGACY_MATRIX = (MIGRATION.parent.parent / "docs" / "architecture" /
                 "MATRIZ_COBERTURA_LEGADO_V1.md")


class TestDicionarioFisico(DdlBase):
    @unittest.skipUnless(
        LEGACY_MATRIX.is_file(),
        "matriz interna de auditoria nao incluida no snapshot publico",
    )
    def test_350_campos_legados_apontam_para_colunas_existentes(self):
        matrix = LEGACY_MATRIX.read_text(encoding="utf-8")
        bt = chr(96)
        rows = []
        for line in matrix.splitlines():
            if line.startswith("| " + bt):
                fields = line.split(bt)
                if len(fields) == 5:
                    rows.append((fields[1], fields[3]))
        self.assertEqual(len(rows), 350)
        for source, target in rows:
            with self.subTest(source=source):
                first = target.split(" ", 1)[0].split("(", 1)[0].split("/", 1)[0]
                if "." in first:
                    table, column = first.split(".", 1)
                    physical = {r[1] for r in self.db.execute("PRAGMA table_info(" + table + ")")}
                    self.assertIn(column, physical, target)
                else:
                    self.assertIn("documento_", target)

    def test_limite_d1_de_100_colunas_por_tabela(self):
        for table in TABLES:
            with self.subTest(table=table):
                count = len(self.db.execute("PRAGMA table_info(" + table + ")").fetchall())
                self.assertLessEqual(count, 100)

    def test_reaplicacao_da_migration_nao_finge_sucesso(self):
        with self.assertRaises(sqlite3.OperationalError):
            self.db.executescript(MIGRATION.read_text(encoding="utf-8"))


class TestGuardasFinanceiras(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def test_duas_baixas_ativas_rejeitadas(self):
        self.insert("titulo_baixas", id="b1", empresa_id="e1", titulo_id="t1",
                    tipo="QUITACAO", valor_pago_cent=18000, data_pagamento="2026-01-31")
        self.rejects("titulo_baixas", id="b2", empresa_id="e1", titulo_id="t1",
                     tipo="QUITACAO", valor_pago_cent=18000, data_pagamento="2026-01-31")

    def test_desfazimento_nao_pode_apontar_para_outro_desfazimento(self):
        self.insert("titulo_baixas", id="b1", empresa_id="e1", titulo_id="t1",
                    tipo="QUITACAO", valor_pago_cent=18000, data_pagamento="2026-01-31")
        self.insert("titulo_baixas", id="z1", empresa_id="e1", titulo_id="t1",
                    tipo="DESFAZIMENTO", baixa_original_id="b1", motivo="Correção da baixa")
        self.rejects("titulo_baixas", id="z2", empresa_id="e1", titulo_id="t1",
                     tipo="DESFAZIMENTO", baixa_original_id="z1")

    def test_excesso_de_credito_e_retencao(self):
        self.insert("recebimentos", id="r1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=4200,
                    retencao_confirmada_cent=300,
                    retencao_atestado_id=self.verified_retention(300))
        self.rejects("recebimentos", id="r2", empresa_id="e1",
                     conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                     data_credito="2026-11-06", valor_recebido_cent=600,
                     retencao_confirmada_cent=0)
        self.insert("recebimentos", id="r2", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=500,
                    retencao_confirmada_cent=0)
        self.assertEqual(self.db.execute(
            "SELECT saldo_cent FROM v_contas_receber_saldos WHERE id='cr1'"
        ).fetchone(), (0,))

    def test_estorno_com_valores_divergentes(self):
        self.insert("recebimentos", id="r1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=400,
                    retencao_confirmada_cent=50,
                    retencao_atestado_id=self.verified_retention(50))
        self.rejects("recebimentos", id="z1", empresa_id="e1",
                     conta_receber_id="cr1", tipo_movimento="ESTORNO",
                     estorno_de_id="r1", data_credito="2026-11-06",
                     valor_recebido_cent=399, retencao_confirmada_cent=50,
                     motivo="erro")

    def test_estorno_com_data_diferente(self):
        self.insert("recebimentos", id="r1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=400,
                    retencao_confirmada_cent=50,
                    retencao_atestado_id=self.verified_retention(50))
        self.rejects("recebimentos", id="z1", empresa_id="e1",
                     conta_receber_id="cr1", tipo_movimento="ESTORNO",
                     estorno_de_id="r1", data_credito="2026-11-05",
                     valor_recebido_cent=400, retencao_confirmada_cent=50,
                     motivo="erro")

    def test_estorno_integral_restabelece_saldo(self):
        self.insert("recebimentos", id="r1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=5000,
                    retencao_confirmada_cent=0)
        self.insert("recebimentos", id="z1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="ESTORNO",
                    estorno_de_id="r1", data_credito="2026-11-06",
                    valor_recebido_cent=5000, retencao_confirmada_cent=0,
                    motivo="corrigir")
        self.insert("recebimentos", id="r2", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=5000,
                    retencao_confirmada_cent=0)
        self.assertEqual(self.db.execute(
            "SELECT saldo_cent FROM v_contas_receber_saldos WHERE id='cr1'"
        ).fetchone(), (0,))

    def test_parcela_com_credito_nao_muda_base(self):
        self.insert("recebimentos", id="r1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=100,
                    retencao_confirmada_cent=0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE contas_receber SET valor_bruto_cent=4900 WHERE id='cr1'")
        self.db.execute("UPDATE contas_receber SET observacoes='cobranca' WHERE id='cr1'")

    def test_competencia_cancelada_nao_pode_renascer(self):
        self.db.execute("UPDATE titulos_pagar SET cancelado=1, motivo_cancelamento='Regra cancelada' WHERE id='t1'")
        self.rejects("titulos_pagar", id="new", empresa_id="e1",
                     tipo="DIVERSO", recorrencia_id="rec1", competencia="2026-01")

    def test_transacao_atomica_reverte_parte_valida(self):
        self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                self.insert("titulos_pagar", id="antes", empresa_id="e1",
                            tipo="DIVERSO", beneficiario="Teste",
                            categoria_despesa="DIVERSOS")
                self.insert("titulos_pagar", id="dup", empresa_id="e1",
                            tipo="DIVERSO", recorrencia_id="rec1",
                            competencia="2026-01")
        self.assertIsNone(self.db.execute(
            "SELECT id FROM titulos_pagar WHERE id='antes'"
        ).fetchone())


class TestGuardasAnexos(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def test_chave_privada_r2_nao_reutilizavel(self):
        self.insert("documento_localizacoes", id="obj1", empresa_id="e1",
                    versao_id="v1", provedor="R2", chave_r2="e1/uma-chave",
                    status="PENDENTE")
        self.rejects("documento_localizacoes", id="obj2", empresa_id="e1",
                     versao_id="v1", provedor="R2", chave_r2="e1/uma-chave",
                     status="PENDENTE")

    def test_nao_arquivar_sem_destino_verificado(self):
        self.rejects("documento_transferencias", id="trans1", empresa_id="e1",
                     versao_id="v1", destino_provedor="DRIVE",
                     estado="ARQUIVADO", idempotencia="tr1")

    def test_nao_sobrepor_30_dias_sem_marcadores(self):
        self.rejects("documento_transferencias", id="trans1", empresa_id="e1",
                     versao_id="v1", destino_provedor="DRIVE",
                     estado="SOBREPOSICAO_30_DIAS", idempotencia="tr1")


if __name__ == "__main__":
    unittest.main()
