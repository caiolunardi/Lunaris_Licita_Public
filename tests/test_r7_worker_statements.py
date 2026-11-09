"""R7: executa instrucoes SQL emitidas pelo codigo JavaScript em SQLite real local.
Nao representa validacao completa dos 58 contratos nem D1 remoto/concorrrencia.
"""
import json
import os
import sqlite3
from test_ddl_v1 import DdlBase

FIXTURE = os.environ.get("R7_SQL_FIXTURE", "tests/_r7_statements.generated.json")

class TestR7WorkerStatements(DdlBase):
    @classmethod
    def setUpClass(cls):
        with open(FIXTURE, encoding="utf8") as f:
            cls.cases=json.load(f)

    def setUp(self):
        super().setUp()
        self.seed()
        self.insert("usuarios",id="user1",
                    access_issuer="https://licita-test.cloudflareaccess.com",
                    access_subject="sub-test",email_normalizado="validado@example.test")
        self.db.commit()

    def batch(self,name):
        changes=[]
        with self.db:
            for entry in self.cases[name]:
                result=self.db.execute(entry["sql"],entry["args"])
                changes.append(result.rowcount)
        return changes

    def test_w1_credito_sql_real_transacao_journal(self):
        self.assertEqual(self.batch("credit"),[1,1])
        got=self.db.execute(
          "SELECT operacao_id,valor_recebido_cent,retencao_confirmada_cent,"
          "origem_dado,conferencia FROM recebimentos WHERE conta_receber_id='cr1'"
        ).fetchone()
        self.assertEqual(got,("intentA",2000,0,"NATIVO","VALIDADO"))
        self.assertEqual(self.db.execute("SELECT estado FROM operacoes "
                         "WHERE id='intentA'").fetchone(),("CONCLUIDA",))

    def test_w1_mesma_conta_referencia_duplicada_gera_erro_e_rollback(self):
        self.batch("credit")
        with self.assertRaises(sqlite3.IntegrityError):
            self.batch("duplicate")
        self.assertEqual(self.db.execute("SELECT count(*) FROM recebimentos "
                "WHERE tipo_movimento='RECEBIMENTO'").fetchone(),(1,))
        self.assertEqual(self.db.execute("SELECT count(*) FROM operacoes "
                 "WHERE id='intentB'").fetchone(),(0,))

    def test_w5_credito_acima_do_saldo_nunca_jornaliza(self):
        self.batch("credit")
        self.assertEqual(self.batch("overspend"),[0,0])
        self.assertEqual(self.db.execute("SELECT count(*) FROM operacoes "
                              "WHERE id='intentC'").fetchone(),(0,))

    def test_w5_legado_pendente_bloqueia_credito_novo(self):
        self.insert("recebimentos",id="hist1",empresa_id="e1",conta_receber_id="cr1",
                    tipo_movimento="RECEBIMENTO",data_credito="2026-05-01",
                    valor_recebido_cent=100,retencao_confirmada_cent=0,
                    origem_dado="LEGADO",conferencia="PENDENTE")
        self.assertEqual(self.batch("legacyUnknown"),[0,0])
        self.assertEqual(self.db.execute("SELECT count(*) FROM recebimentos "
                         "WHERE operacao_id='intentD'").fetchone(),(0,))

    def test_w4_nota_cas_atualiza_uma_vez(self):
        self.assertEqual(self.batch("note"),[1,1])
        self.assertEqual(self.db.execute("SELECT observacoes,versao,operacao_id "
                         "FROM titulos_pagar WHERE id='t1'").fetchone(),
                         ("Nova nota",2,"noteA"))
        self.assertEqual(self.db.execute("SELECT ator_id,estado "
                         "FROM operacoes WHERE id='noteA'").fetchone(),
                         ("user1","CONCLUIDA"))

    def test_w4_versao_obsoleta_nao_muda_fato_ou_cria_operacao(self):
        self.batch("note")
        self.assertEqual(self.batch("staleNote"),[0,0])
        self.assertEqual(self.db.execute("SELECT count(*) FROM operacoes "
                         "WHERE id='noteB'").fetchone(),(0,))

    def test_w6_escopo_outra_empresa_nao_vaza_nota(self):
        self.assertEqual(self.batch("otherCompanyNote"),[0,0])
        self.assertEqual(self.db.execute("SELECT observacoes,versao FROM titulos_pagar "
                         "WHERE id='t1'").fetchone(),(None,1))

    def test_w4_lancamento_e_journal_rollback_na_falha_do_segundo_sql(self):
        # Forcar FK inexistente na segunda instrução, dentro da mesma transação.
        self.db.execute("SELECT 1")
        altered=[{"sql":x["sql"],"args":list(x["args"])} for x in self.cases["credit"]]
        altered[1]["args"][3]="usuario_inexistente"
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:
                for x in altered:
                    self.db.execute(x["sql"],x["args"])
        self.assertEqual(self.db.execute("SELECT count(*) FROM recebimentos "
                         "WHERE conta_receber_id='cr1'").fetchone(),(0,))

    def test_w1_w4_integridade_pos_operacoes(self):
        self.batch("credit")
        self.batch("note")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(),("ok",))
