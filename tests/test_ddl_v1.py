"""DDL V1: contrato físico local. NÃO executa Cloudflare D1 remoto.
Executar: python3 -m unittest discover -s tests -p 'test_ddl_v1.py' -v
O serviço Worker ainda não existe para operações de domínio: este teste prova
PRAGMA/DDL/FKs/CHECK/UNIQUE/triggers/views; NÃO prova cálculos transacionais.
"""
from pathlib import Path
import sqlite3
import unittest

MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "0001_ddl_v1.sql"
MIGRATION_R4 = Path(__file__).resolve().parents[1] / "migrations" / "0002_ddl_v1r_r4.sql"
MIGRATION_R5 = Path(__file__).resolve().parents[1] / "migrations" / "0003_ddl_v1r_r5.sql"
MIGRATION_R6 = Path(__file__).resolve().parents[1] / "migrations" / "0004_ddl_v1r_r6.sql"
MIGRATION_R7 = Path(__file__).resolve().parents[1] / "migrations" / "0005_ddl_v1r_r7_w1.sql"
MIGRATION_R7_Q = Path(__file__).resolve().parents[1] / "migrations" / "0006_ddl_v1r_r7_quantidades.sql"
MIGRATION_R7_E1 = Path(__file__).resolve().parents[1] / "migrations" / "0007_ddl_v1r_r7_etapa1.sql"
MIGRATION_R7_E2 = Path(__file__).resolve().parents[1] / "migrations" / "0008_ddl_v1r_r7_etapa2_guardas.sql"
MIGRATION_R7_E2_NF = Path(__file__).resolve().parents[1] / "migrations" / "0009_ddl_v1r_r7_etapa2_retificacoes.sql"
MIGRATION_R7_E2_FIN05 = Path(__file__).resolve().parents[1] / "migrations" / "0010_ddl_v1r_r7_etapa2_retencao_strict.sql"
MIGRATION_R7_E2_CYCLES = Path(__file__).resolve().parents[1] / "migrations" / "0011_ddl_v1r_r7_etapa2_ciclos_workerd.sql"
TABLES = {
    "empresas", "usuarios", "usuarios_empresas", "orgaos", "fornecedores",
    "licitacoes", "licitacao_itens", "empenhos", "empenho_itens",
    "compras", "compra_itens", "envios", "envio_itens", "notas_fiscais",
    "nota_fiscal_itens", "recorrencias", "titulos_pagar", "titulo_baixas",
    "recorrencia_revisoes", "contas_receber", "recebimentos", "cotacoes_precos",
    "recebimento_conferencias", "documentos", "documento_versoes", "documento_vinculos",
    "documento_localizacoes", "documento_transferencias", "documento_bloqueios",
    "licitacao_encerramentos", "operacoes", "eventos_auditoria",
    "tarefas_assincronas", "configuracoes", "notificacoes_preferencias",
    "notificacoes_destinatarios", "notificacoes_envios", "lotes_migracao",
    "migracao_referencias", "migracao_itens",
    "licitacao_referencias_externas", "licitacao_capturas_externas",
    "documento_vinculos_extensao", "nf_conciliacoes", "retencao_atestados", "nf_retificacoes"
}
OWNERS = [
    "licitacao_id", "licitacao_item_id", "empenho_id", "compra_id",
    "envio_id", "nota_fiscal_id", "titulo_pagar_id", "titulo_baixa_id",
    "conta_receber_id", "recebimento_id", "cotacao_id"
]


class DdlBase(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(MIGRATION.read_text(encoding="utf-8"))
        self.db.executescript(MIGRATION_R4.read_text(encoding="utf-8"))
        self.db.executescript(MIGRATION_R5.read_text(encoding="utf-8"))
        self.db.executescript(MIGRATION_R6.read_text(encoding="utf-8"))
        self.db.executescript(MIGRATION_R7.read_text(encoding="utf-8"))
        self.db.executescript(MIGRATION_R7_Q.read_text(encoding="utf-8"))
        self.db.executescript(MIGRATION_R7_E1.read_text(encoding="utf-8"))
        self.db.executescript(MIGRATION_R7_E2.read_text(encoding="utf-8"))
        self.db.executescript(MIGRATION_R7_E2_NF.read_text(encoding="utf-8"))
        self.db.executescript(MIGRATION_R7_E2_FIN05.read_text(encoding="utf-8"))
        self.db.executescript(MIGRATION_R7_E2_CYCLES.read_text(encoding="utf-8"))

    def tearDown(self):
        self.db.close()

    def insert(self, table, **data):
        cols = ", ".join(data)
        placeholders = ", ".join("?" for _ in data)
        self.db.execute(
            f"INSERT INTO {table} ({cols}) VALUES ({placeholders})", tuple(data.values())
        )

    def rejects(self, table, **data):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert(table, **data)

    def seed(self):
        self.insert("empresas", id="e1", nome="Pessoa juridica A")
        self.insert("empresas", id="e2", nome="Pessoa juridica B")
        self.insert("orgaos", id="o1", empresa_id="e1", nome="Orgao um")
        self.insert("orgaos", id="o2", empresa_id="e2", nome="Orgao dois")
        self.insert("fornecedores", id="f1", empresa_id="e1", nome="Fornecedor A")
        self.insert("fornecedores", id="f2", empresa_id="e2", nome="Fornecedor B")
        self.insert("licitacoes", id="l1", empresa_id="e1", orgao_id="o1", numero="1")
        self.insert("licitacoes", id="l2", empresa_id="e2", orgao_id="o2", numero="2")
        self.insert("licitacao_itens", id="li1", empresa_id="e1", licitacao_id="l1",
                    numero_item="1", quantidade_prevista_mil=3000,
                    resultado="GANHO", quantidade_ganha_mil=3000,
                    valor_final_unit_cent=1200, conferencia="VALIDADO")
        self.insert("licitacao_itens", id="li2", empresa_id="e2", licitacao_id="l2",
                    numero_item="1")
        self.insert("empenhos", id="ep1", empresa_id="e1", licitacao_id="l1",
                    orgao_id_escopo="o1", numero="E1", situacao="CONFIRMADO")
        self.insert("empenhos", id="ep2", empresa_id="e2", licitacao_id="l2",
                    orgao_id_escopo="o2", numero="E2", situacao="CONFIRMADO")
        self.insert("empenho_itens", id="ei1", empresa_id="e1",
                    empenho_id="ep1", licitacao_item_id="li1",
                    licitacao_id_escopo="l1", quantidade_mil=3000)
        self.insert("empenho_itens", id="ei2", empresa_id="e2",
                    empenho_id="ep2", licitacao_item_id="li2",
                    licitacao_id_escopo="l2", quantidade_mil=1000)
        self.insert("compras", id="co1", empresa_id="e1", empenho_id="ep1",
                    fornecedor_id="f1")
        self.insert("compras", id="co2", empresa_id="e2", empenho_id="ep2",
                    fornecedor_id="f2")
        self.insert("compra_itens", id="ci1", empresa_id="e1", compra_id="co1",
                    empenho_item_id="ei1", empenho_id_escopo="ep1",
                    quantidade_mil=3000)
        self.insert("compra_itens", id="ci2", empresa_id="e2", compra_id="co2",
                    empenho_item_id="ei2", empenho_id_escopo="ep2",
                    quantidade_mil=1000)
        self.insert("envios", id="en1", empresa_id="e1", empenho_id="ep1")
        self.insert("notas_fiscais", id="nf1", empresa_id="e1", empenho_id="ep1",
                    orgao_id_escopo="o1", situacao="EMITIDA")
        self.insert("notas_fiscais", id="nf2", empresa_id="e2", empenho_id="ep2",
                    orgao_id_escopo="o2", situacao="EMITIDA")
        self.insert("contas_receber", id="cr1", empresa_id="e1",
                    nota_fiscal_id="nf1", parcela=1, valor_bruto_cent=5000)
        self.insert("contas_receber", id="cr2", empresa_id="e2",
                    nota_fiscal_id="nf2", parcela=1, valor_bruto_cent=6000)
        self.insert("recorrencias", id="rec1", empresa_id="e1",
                    beneficiario="Internet", categoria_despesa="INTERNET",
                    dia_vencimento=31, primeiro_vencimento="2026-01-31",
                    valor_atual_cent=18000)
        self.insert("titulos_pagar", id="t1", empresa_id="e1",
                    tipo="DIVERSO", beneficiario="Internet",
                    categoria_despesa="INTERNET", recorrencia_id="rec1",
                    competencia="2026-01", valor_nominal_cent=18000,
                    vencimento="2026-01-31", conferencia="VALIDADO")
        self.insert("titulos_pagar", id="t2", empresa_id="e2",
                    tipo="FORNECEDOR", fornecedor_id="f2")
        self.insert("documentos", id="d1", empresa_id="e1", tipo="COMPROVANTE")
        self.insert("documentos", id="d2", empresa_id="e2", tipo="EDITAL")
        self.insert("documento_versoes", id="v1", documento_id="d1",
                    empresa_id="e1", numero_versao=1, estado_integridade="PENDENTE")
        self.insert("documento_versoes", id="v2", documento_id="d2",
                    empresa_id="e2", numero_versao=1, estado_integridade="PENDENTE")


    def verified_retention(self, amount, account_id="cr1", tag="fixture"):
        """Prova sintética legítima: conta + documento + versão + bytes atestados.
        Permite manter as regressões financeiras anteriores sem criar retenção
        NATIVO sem comprovação ou falsear a origem LEGADO.
        """
        uid="ret_actor_"+tag
        oid="ret_op_"+tag
        doc="ret_doc_"+tag
        ver="ret_ver_"+tag
        loc="ret_loc_"+tag
        proof="ret_proof_"+tag
        self.insert("usuarios", id=uid, ativo=1,
                    access_issuer="https://fixture.cloudflareaccess.com",
                    access_subject=uid, email_normalizado=uid+"@local.invalid")
        self.insert("operacoes", id=oid, empresa_id="e1", tipo="VERIFICAR_VERSAO",
                    hash_pedido="fixture-"+tag, ator_id=uid, estado="CONCLUIDA")
        self.insert("documentos", id=doc, empresa_id="e1",
                    tipo="COMPROVANTE_RETENCAO")
        self.insert("documento_versoes", id=ver, empresa_id="e1",
                    documento_id=doc, numero_versao=1,
                    estado_integridade="PENDENTE",
                    tamanho_bytes=3, sha256="a"*64)
        self.insert("documento_vinculos", id="ret_link_"+tag,
                    empresa_id="e1", documento_id=doc,
                    conta_receber_id=account_id, papel="COMPROVANTE_CREDITO")
        self.insert("documento_localizacoes", id=loc, empresa_id="e1",
                    versao_id=ver, provedor="R2",
                    chave_r2="e1/"+ver, status="PENDENTE")
        self.db.execute("UPDATE documento_localizacoes SET status='VERIFICADO',"
                        "hash_verificado=?,tamanho_verificado=3,"
                        "verificado_em='2026-11-07T10:00:00.000Z' "
                        "WHERE id=?", ("a"*64,loc))
        self.db.execute("UPDATE documento_versoes SET "
                        "estado_integridade='VERIFICADO',versao=versao+1,"
                        "operacao_id=? WHERE id=?", (oid,ver))
        self.insert("retencao_atestados", id=proof, empresa_id="e1",
                    conta_receber_id=account_id, documento_versao_id=ver,
                    valor_confirmado_cent=amount, atestado_por_id=uid,
                    operacao_id=oid)
        return proof


class TestSchema(DdlBase):
    def test_46_tables_and_strict(self):
        rows = self.db.execute("PRAGMA table_list").fetchall()
        real = {row[1] for row in rows if row[0] == "main" and row[2] == "table"
                and not row[1].startswith("sqlite_")}
        self.assertEqual(real, TABLES)
        self.assertTrue(all(row[5] == 1 for row in rows if row[1] in TABLES))

    def test_fk_integrity(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_keys").fetchone(), (1,))
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(), ("ok",))

    def test_55_indexes_and_244_integrity_triggers(self):
        names = {r[0] for r in self.db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
        )}
        self.assertEqual(len(names), 55)
        triggers = self.db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger'").fetchone()[0]
        self.assertEqual(triggers, 244)

    def test_four_derived_views(self):
        got = {r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='view'")}
        self.assertEqual(got, {"v_recebimentos_ativos", "v_contas_receber_saldos",
                              "v_titulos_situacao", "v_documento_vinculos_tipados"})

    def test_every_table_has_declared_foreign_keys_when_expected(self):
        for table in TABLES - {"empresas", "usuarios"}:
            with self.subTest(table=table):
                refs = self.db.execute(f"PRAGMA foreign_key_list({table})").fetchall()
                self.assertTrue(refs)

    def test_all_eleven_document_owners_have_foreign_keys(self):
        refs = self.db.execute("PRAGMA foreign_key_list(documento_vinculos)").fetchall()
        from_fields = {r[3] for r in refs}
        self.assertTrue(set(OWNERS).issubset(from_fields))


class TestRelations(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def test_cross_company_orgao(self):
        self.rejects("licitacoes", id="invalid", empresa_id="e1",
                     orgao_id="o2", numero="99")

    def test_cross_company_fornecedor(self):
        self.rejects("compras", id="invalid", empresa_id="e1",
                     empenho_id="ep1", fornecedor_id="f2")

    def test_emp_item_other_licitacao(self):
        self.rejects("empenho_itens", id="invalid", empresa_id="e1",
                     empenho_id="ep1", licitacao_item_id="li2",
                     licitacao_id_escopo="l1")

    def test_emp_item_forged_parent_scope(self):
        self.rejects("empenho_itens", id="invalid", empresa_id="e1",
                     empenho_id="ep1", licitacao_item_id="li1",
                     licitacao_id_escopo="l2")

    def test_purchase_item_wrong_empenho(self):
        self.rejects("compra_itens", id="invalid", empresa_id="e1",
                     compra_id="co1", empenho_item_id="ei2",
                     empenho_id_escopo="ep1")

    def test_envio_item_wrong_empenho(self):
        self.rejects("envio_itens", id="invalid", empresa_id="e1",
                     envio_id="en1", compra_item_id="ci2",
                     empenho_id_escopo="ep1", quantidade_mil=1)

    def test_nf_item_wrong_empenho(self):
        self.rejects("nota_fiscal_itens", id="invalid", empresa_id="e1",
                     nota_fiscal_id="nf1", empenho_item_id="ei2",
                     empenho_id_escopo="ep1", quantidade_mil=1)

    def test_parent_deletion_restricted(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM licitacoes WHERE id='l1'")

    def test_accepted_and_refused_cannot_exceed_sent(self):
        self.rejects("envio_itens", id="bad", empresa_id="e1", envio_id="en1",
                     compra_item_id="ci1", empenho_id_escopo="ep1",
                     quantidade_mil=1000, quantidade_aceita_mil=700,
                     quantidade_recusada_mil=400)

    def test_positive_envio_accepted_and_refused(self):
        self.insert("envio_itens", id="valid", empresa_id="e1",
                    envio_id="en1", compra_item_id="ci1",
                    empenho_id_escopo="ep1", quantidade_mil=1000,
                    quantidade_aceita_mil=500, quantidade_recusada_mil=500,
                    motivo_recusa="Avria", conferencia="VALIDADO")

    def test_gained_qty_above_planned(self):
        self.rejects("licitacao_itens", id="bad", empresa_id="e1",
                     licitacao_id="l1", numero_item="10",
                     quantidade_prevista_mil=1000, quantidade_ganha_mil=1001)

    def test_check_validated_gained_item(self):
        self.rejects("licitacao_itens", id="bad", empresa_id="e1",
                     licitacao_id="l1", numero_item="10", resultado="GANHO",
                     quantidade_prevista_mil=3000, quantidade_ganha_mil=1,
                     valor_final_unit_cent=0, conferencia="VALIDADO")

    def test_strict_amount_not_text(self):
        self.rejects("titulos_pagar", id="bad", empresa_id="e1",
                     tipo="DIVERSO", valor_nominal_cent="cem reais")

    def test_negative_amount(self):
        self.rejects("titulos_pagar", id="bad", empresa_id="e1",
                     tipo="DIVERSO", valor_nominal_cent=-1)

    def test_bad_boolean(self):
        self.rejects("titulos_pagar", id="bad", empresa_id="e1",
                     tipo="DIVERSO", cancelado=5)

    def test_invalid_state(self):
        self.rejects("envios", id="bad", empresa_id="e1",
                     empenho_id="ep1", situacao="ABERTO")


class TestFinance(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def test_duplicate_recurring_month(self):
        self.rejects("titulos_pagar", id="duplicate", empresa_id="e1",
                     tipo="DIVERSO", recorrencia_id="rec1", competencia="2026-01")

    def test_recurring_pair_atomic(self):
        self.rejects("titulos_pagar", id="bad", empresa_id="e1",
                     tipo="DIVERSO", recorrencia_id="rec1", competencia=None)

    def test_bad_month(self):
        self.rejects("titulos_pagar", id="bad", empresa_id="e1",
                     tipo="DIVERSO", competencia="2026-13", recorrencia_id="rec1")

    def test_diverso_no_supplier(self):
        self.rejects("titulos_pagar", id="bad", empresa_id="e1",
                     tipo="DIVERSO", fornecedor_id="f1",
                     beneficiario="Internet", categoria_despesa="INTERNET",
                     conferencia="VALIDADO")

    def test_supplier_purchase_same_supplier(self):
        self.rejects("titulos_pagar", id="bad", empresa_id="e1",
                     tipo="FORNECEDOR", compra_id="co1", fornecedor_id="f2")

    def test_invoice_parcela_unique(self):
        self.rejects("contas_receber", id="bad", empresa_id="e1",
                     nota_fiscal_id="nf1", parcela=1, valor_bruto_cent=10)

    def test_retencao_prevista_menor_bruto(self):
        self.rejects("contas_receber", id="bad", empresa_id="e1",
                     nota_fiscal_id="nf1", parcela=2, valor_bruto_cent=2000,
                     retencao_prevista_cent=2001)

    def test_receipt_requires_value_or_retencao(self):
        self.rejects("recebimentos", id="bad", empresa_id="e1",
                     conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                     data_credito="2026-11-06", valor_recebido_cent=0,
                     retencao_confirmada_cent=0)

    def test_receipt_zero_bank_credit_valid_with_retencao(self):
        self.insert("recebimentos", id="r1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=0,
                    retencao_confirmada_cent=200,
                    retencao_atestado_id=self.verified_retention(200))
        saldo = self.db.execute(
            "SELECT saldo_cent,creditado_cent,retido_cent FROM v_contas_receber_saldos WHERE id='cr1'"
        ).fetchone()
        self.assertEqual(saldo, (4800, 0, 200))

    def test_cross_company_receipt(self):
        self.rejects("recebimentos", id="bad", empresa_id="e1",
                     conta_receber_id="cr2", tipo_movimento="RECEBIMENTO",
                     data_credito="2026-11-06", valor_recebido_cent=100,
                     retencao_confirmada_cent=0)

    def test_duplicate_estorno(self):
        self.insert("recebimentos", id="r1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=800,
                    retencao_confirmada_cent=200,
                    retencao_atestado_id=self.verified_retention(200))
        self.insert("recebimentos", id="z1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="ESTORNO",
                    estorno_de_id="r1", data_credito="2026-11-06",
                    valor_recebido_cent=800, retencao_confirmada_cent=200,
                    motivo="correcao")
        self.rejects("recebimentos", id="z2", empresa_id="e1",
                     conta_receber_id="cr1", tipo_movimento="ESTORNO",
                     estorno_de_id="r1", data_credito="2026-11-06",
                     valor_recebido_cent=800, retencao_confirmada_cent=200,
                     motivo="correcao")
        self.assertEqual(self.db.execute(
            "SELECT saldo_cent FROM v_contas_receber_saldos WHERE id='cr1'"
        ).fetchone(), (5000,))

    def test_estorno_wrong_parcela(self):
        self.insert("recebimentos", id="r1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=100,
                    retencao_confirmada_cent=0)
        self.rejects("recebimentos", id="z", empresa_id="e2",
                     conta_receber_id="cr2", tipo_movimento="ESTORNO",
                     estorno_de_id="r1", data_credito="2026-11-06",
                     valor_recebido_cent=100, retencao_confirmada_cent=0,
                     motivo="correcao")

    def test_legacy_paid_unknown_amount(self):
        self.insert("titulos_pagar", id="hist1", empresa_id="e1",
                    tipo="FORNECEDOR", origem_dado="LEGADO",
                    pago_legado_status="SIM")
        self.assertEqual(self.db.execute(
            "SELECT situacao FROM v_titulos_situacao WHERE id='hist1'"
        ).fetchone(), ("PAGO_LEGADO_SEM_BAIXA",))

    def test_low_level_baixa_and_desfazimento(self):
        self.insert("titulo_baixas", id="b1", empresa_id="e1", titulo_id="t1",
                    tipo="QUITACAO", data_pagamento="2026-01-31",
                    valor_pago_cent=17900)
        self.assertEqual(self.db.execute(
            "SELECT situacao FROM v_titulos_situacao WHERE id='t1'"
        ).fetchone(), ("PAGO",))
        self.insert("titulo_baixas", id="b2", empresa_id="e1", titulo_id="t1",
                    tipo="DESFAZIMENTO", baixa_original_id="b1", motivo="Correção de pagamento")
        self.assertEqual(self.db.execute(
            "SELECT situacao FROM v_titulos_situacao WHERE id='t1'"
        ).fetchone(), ("ABERTO",))
        self.rejects("titulo_baixas", id="b3", empresa_id="e1", titulo_id="t1",
                     tipo="DESFAZIMENTO", baixa_original_id="b1")

    def test_financial_events_append_only(self):
        self.insert("recebimentos", id="r1", empresa_id="e1",
                    conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-06", valor_recebido_cent=1,
                    retencao_confirmada_cent=0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE recebimentos SET valor_recebido_cent=2 WHERE id='r1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM recebimentos WHERE id='r1'")

    def test_cotacao_snapshot_immutable(self):
        self.insert("cotacoes_precos", id="cot1", empresa_id="e1",
                    entrada_json='{}', resultado_json='{}')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE cotacoes_precos SET descricao='nova' WHERE id='cot1'")

    def test_invalid_json_snapshot(self):
        self.rejects("cotacoes_precos", id="bad", empresa_id="e1",
                     entrada_json="isso nao e json")


class TestDocuments(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def test_document_one_owner(self):
        self.rejects("documento_vinculos", id="bad", empresa_id="e1",
                     documento_id="d1", papel="EDITAL")
        self.rejects("documento_vinculos", id="bad2", empresa_id="e1",
                     documento_id="d1", papel="EDITAL",
                     licitacao_id="l1", titulo_pagar_id="t1")

    def test_document_wrong_company(self):
        self.rejects("documento_vinculos", id="bad", empresa_id="e1",
                     documento_id="d1", papel="EDITAL", licitacao_id="l2")

    def test_document_wrong_document_company(self):
        self.rejects("documento_vinculos", id="bad", empresa_id="e1",
                     documento_id="d2", papel="EDITAL", licitacao_id="l1")

    def test_one_active_document_per_role_and_owner(self):
        self.insert("documento_vinculos", id="link1", empresa_id="e1",
                    documento_id="d1", papel="EDITAL", licitacao_id="l1")
        self.rejects("documento_vinculos", id="link2", empresa_id="e1",
                     documento_id="d1", papel="EDITAL", licitacao_id="l1")
        self.insert("documento_vinculos", id="link3", empresa_id="e1",
                    documento_id="d1", papel="EDITAL", licitacao_id="l1", ativo=0)

    def test_no_cross_document_current_version(self):
        self.rejects("documentos", id="bad_doc", empresa_id="e1",
                     tipo="EDITAL", versao_corrente_id="v2")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documentos SET versao_corrente_id='v2' WHERE id='d1'")
        self.db.execute("UPDATE documentos SET versao_corrente_id='v1' WHERE id='d1'")

    def test_version_immutable(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_versoes SET numero_versao=2 WHERE id='v1'")

    def test_version_number_unique(self):
        self.rejects("documento_versoes", id="v3", documento_id="d1",
                     empresa_id="e1", numero_versao=1,
                     estado_integridade="PENDENTE")

    def test_storage_provider_requires_correct_locator(self):
        self.rejects("documento_localizacoes", id="wrong", empresa_id="e1",
                     versao_id="v1", provedor="R2",
                     url_externa="https://example.org/a", status="PENDENTE")

    def test_verified_location_requires_checksum_and_size(self):
        self.rejects("documento_localizacoes", id="wrong", empresa_id="e1",
                     versao_id="v1", provedor="R2",
                     chave_r2="e1/foo", status="VERIFICADO")

    def test_drive_location(self):
        self.insert("documento_localizacoes", id="drive", empresa_id="e1",
                    versao_id="v1", provedor="DRIVE", drive_file_id="file-id",
                    status="PENDENTE")

    def test_r2_location_checksum(self):
        self.insert("documento_localizacoes", id="r2", empresa_id="e1",
                    versao_id="v1", provedor="R2", chave_r2="e1/opaque-key",
                    status="VERIFICADO", tamanho_verificado=42,
                    hash_verificado="a"*64, verificado_em="2026-11-06T20:00:00Z")

    def test_external_url_not_a_verified_file_by_default(self):
        self.insert("documento_localizacoes", id="url", empresa_id="e1",
                    versao_id="v1", provedor="URL_EXTERNA",
                    url_externa="https://example.org/file", status="PENDENTE")
        self.assertEqual(self.db.execute(
            "SELECT status FROM documento_localizacoes WHERE id='url'"
        ).fetchone(), ("PENDENTE",))

    def test_archiving_closure_unique(self):
        self.insert("licitacao_encerramentos", id="cl1", empresa_id="e1",
                    licitacao_id="l1", encerrada_em="2026-01-01T10:00:00Z",
                    motivo="fechamento")
        self.rejects("licitacao_encerramentos", id="cl2", empresa_id="e1",
                     licitacao_id="l1", encerrada_em="2026-04-01T10:00:00Z",
                     motivo="outro")
        self.db.execute(
            "UPDATE licitacao_encerramentos SET reaberta_em=?, motivo_reabertura=?, reaberta_por='operador de teste' WHERE id='cl1'",
            ("2026-03-01T10:00:00Z", "novo ajuste")
        )
        self.insert("licitacao_encerramentos", id="cl3", empresa_id="e1",
                    licitacao_id="l1", encerrada_em="2026-04-01T10:00:00Z",
                    motivo="novo fechamento")


class TestGovernance(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def test_role_limited(self):
        self.insert("usuarios", id="u1", access_issuer="cf", access_subject="abc",
                    email_normalizado="u@example.com")
        self.rejects("usuarios_empresas", usuario_id="u1",
                     empresa_id="e1", papel="DONO_ABSOLUTO")

    def test_unique_auth_subject(self):
        self.insert("usuarios", id="u1", access_issuer="cf",
                    access_subject="abc", email_normalizado="u@example.com")
        self.rejects("usuarios", id="u2", access_issuer="cf",
                     access_subject="abc", email_normalizado="other@example.com")

    def test_config_json_validated(self):
        self.rejects("configuracoes", empresa_id="e1",
                     chave="qualquer", tipo="JSON", valor_texto="{INVALID")

    def test_job_idempotency_unique(self):
        self.insert("tarefas_assincronas", id="job1", empresa_id="e1",
                    tipo="EXPORTAR", chave_idempotencia="k", estado="PENDENTE")
        self.rejects("tarefas_assincronas", id="job2", empresa_id="e1",
                     tipo="EXPORTAR", chave_idempotencia="k", estado="PENDENTE")

    def test_migration_snapshot_unique(self):
        self.insert("lotes_migracao", id="batch1", empresa_id="e1",
                    origem_snapshot="x", hash_origem="sha", versao_mapeamento="v1",
                    estado="PREPARADO")
        self.rejects("lotes_migracao", id="batch2", empresa_id="e1",
                     origem_snapshot="x", hash_origem="sha",
                     versao_mapeamento="v1", estado="PREPARADO")

    def test_migration_reexecution_unique_mapping(self):
        self.insert("lotes_migracao", id="batch1", empresa_id="e1",
                    origem_snapshot="x", hash_origem="sha", versao_mapeamento="v1",
                    estado="PREPARADO")
        self.insert("migracao_referencias", id="map1", empresa_id="e1",
                    lote_id="batch1", tipo_origem="Boletos",
                    id_origem_estavel="old1", id_destino="t1", hash_linha="hash",
                    estado="MIGRADO")
        self.rejects("migracao_referencias", id="map2", empresa_id="e1",
                     lote_id="batch1", tipo_origem="Boletos",
                     id_origem_estavel="old1", id_destino="t1", hash_linha="hash",
                     estado="MIGRADO")

    def test_notification_same_slot_unique(self):
        self.insert("notificacoes_preferencias", id="np1", empresa_id="e1")
        self.insert("notificacoes_envios", id="n1", empresa_id="e1",
                    preferencia_id="np1", data_referencia="2026-11-06",
                    horario="09:00", destinatario_hash="hash1", estado="RESERVADO")
        self.rejects("notificacoes_envios", id="n2", empresa_id="e1",
                     preferencia_id="np1", data_referencia="2026-11-06",
                     horario="09:00", destinatario_hash="hash1", estado="ENVIADO")

    def test_notification_max_next_count(self):
        self.rejects("notificacoes_preferencias", id="np1",
                     empresa_id="e1", quantidade_proximos=51)

    def test_schema_integrity_after_fixtures(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(), ("ok",))


if __name__ == "__main__":
    unittest.main()
