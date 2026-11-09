"""R7 W1 — regressões reais no SQLite (D1 local usa as mesmas migrations).
Sem tocar Worker remoto, R2 real, documentos ou banco HML.
"""
import sqlite3
from test_ddl_v1 import DdlBase

class TestR7ReferenciaBanco(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def receive(self, id="cred1", company="e1", account="cr1",
                reference="PIX-9", destination="BB-001", source="NATIVO",
                amount=200):
        self.insert("recebimentos",id=id,empresa_id=company,conta_receber_id=account,
                    tipo_movimento="RECEBIMENTO",data_credito="2026-11-07",
                    valor_recebido_cent=amount,retencao_confirmada_cent=0,
                    conta_destino=destination,referencia_externa=reference,
                    origem_dado=source,conferencia="PENDENTE" if source=="LEGADO" else "VALIDADO")

    def test_w1_primeiro_credito_referencia_validado(self):
        self.receive()
        self.assertEqual(self.db.execute(
            "SELECT conta_destino,referencia_externa FROM recebimentos "
            "WHERE id='cred1'").fetchone(),("BB-001","PIX-9"))

    def test_w1_duplicar_referencia_ativa_mesma_conta_rejeitado(self):
        self.receive()
        with self.assertRaises(sqlite3.IntegrityError):
            self.receive(id="cred2")
        self.assertEqual(self.db.execute("SELECT count(*) FROM recebimentos "
              "WHERE tipo_movimento='RECEBIMENTO'").fetchone(),(1,))

    def test_w1_referencia_mesma_conta_outro_identificador_valido(self):
        self.receive()
        self.receive(id="cred2",reference="PIX-10")
        self.assertEqual(self.db.execute("SELECT count(*) FROM recebimentos "
                        "WHERE tipo_movimento='RECEBIMENTO'").fetchone(),(2,))

    def test_w1_referencia_mesma_empresa_outra_conta_destino_valida(self):
        self.receive()
        self.receive(id="cred2",destination="BB-002")
        self.assertEqual(self.db.execute("SELECT count(*) FROM recebimentos "
                        "WHERE tipo_movimento='RECEBIMENTO'").fetchone(),(2,))

    def test_w1_referencia_igual_empresas_diferentes_nao_conflita(self):
        self.receive()
        self.receive(id="cred2",company="e2",account="cr2")
        self.assertEqual(self.db.execute("SELECT count(*) FROM recebimentos "
                        "WHERE tipo_movimento='RECEBIMENTO'").fetchone(),(2,))

    def test_w1_estorno_legitimo_libera_referencia(self):
        self.receive()
        self.insert("recebimentos",id="est",empresa_id="e1",conta_receber_id="cr1",
                    tipo_movimento="ESTORNO",estorno_de_id="cred1",
                    data_credito="2026-11-07",valor_recebido_cent=200,
                    retencao_confirmada_cent=0,motivo="Transacao duplicada")
        self.receive(id="cred2",reference="PIX-9")
        self.assertEqual(self.db.execute(
              "SELECT count(*) FROM v_recebimentos_ativos "
              "WHERE conta_receber_id='cr1'").fetchone(),(1,))

    def test_w1_sem_conta_ou_sem_referencia_rejeita(self):
        for ref,dest in [("PIX-9",None),(None,"BB-001"),
                         (" ", "BB-001"),("PIX-9"," ")]:
            with self.subTest(ref=ref,dest=dest):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.receive(id="bad",reference=ref,destination=dest)

    def test_w1_pares_nulos_nao_impedem_credito_legitimo(self):
        self.receive(reference=None,destination=None)
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM recebimentos").fetchone(),(1,))

    def test_w1_referencia_com_espacos_nao_e_canonica(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.receive(reference=" PIX-9 ")

    def test_w1_legado_duplicado_preserva_fatos_pendentes(self):
        self.receive(source="LEGADO")
        self.receive(id="cred2",source="LEGADO")
        self.assertEqual(self.db.execute("SELECT count(*) FROM recebimentos "
                      "WHERE origem_dado='LEGADO' AND conferencia='PENDENTE'").fetchone(),(2,))

    def test_w1_nativo_nao_ignora_pendencia_legada_com_referencia_igual(self):
        self.receive(source="LEGADO")
        with self.assertRaises(sqlite3.IntegrityError):
            self.receive(id="cred2",source="NATIVO")

    def test_w1_integridade_fk_sem_inconsistencias(self):
        self.receive()
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(),("ok",))
