"""R7 E2 / FIN05: prova que retencao NATIVO exige atestado ate sem journal.
A prova no banco independe de legitimacao falsa via Apps Script/LEGADO.
"""
import sqlite3
from test_ddl_v1 import DdlBase

class TestR7Fin05Estrito(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def test_nativo_sem_journal_e_sem_atestado_e_rejeitado(self):
        self.rejects("recebimentos",id="nativoSemProva",empresa_id="e1",
                     conta_receber_id="cr1",tipo_movimento="RECEBIMENTO",
                     data_credito="2026-11-07",valor_recebido_cent=100,
                     retencao_confirmada_cent=200,origem_dado="NATIVO")
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM recebimentos WHERE id='nativoSemProva'"
        ).fetchone(),(0,))

    def test_nativo_atestado_exato_aceito_sem_efeito_bancario_ficticio(self):
        comprovante=self.verified_retention(200,tag="legit")
        self.insert("recebimentos",id="nativoComProva",empresa_id="e1",
                    conta_receber_id="cr1",tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-07",valor_recebido_cent=0,
                    retencao_confirmada_cent=200,
                    retencao_atestado_id=comprovante,origem_dado="NATIVO")
        self.assertEqual(self.db.execute(
            "SELECT retencao_confirmada_cent,retencao_atestado_id "
            "FROM recebimentos WHERE id='nativoComProva'"
        ).fetchone(),(200,comprovante))

    def test_nativo_valor_atestado_diferente_nao_confirma(self):
        comprovante=self.verified_retention(50,tag="diferente")
        self.rejects("recebimentos",id="retIncorreta",empresa_id="e1",
                     conta_receber_id="cr1",tipo_movimento="RECEBIMENTO",
                     data_credito="2026-11-07",valor_recebido_cent=100,
                     retencao_confirmada_cent=200,
                     retencao_atestado_id=comprovante,origem_dado="NATIVO")

    def test_nativo_nao_pode_mudar_retencao_apos_confirmacao(self):
        comprovante=self.verified_retention(200,tag="imutavel")
        self.insert("recebimentos",id="creditoRet",empresa_id="e1",
                    conta_receber_id="cr1",tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-07",valor_recebido_cent=100,
                    retencao_confirmada_cent=200,
                    retencao_atestado_id=comprovante)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE recebimentos SET retencao_confirmada_cent=201 "
                            "WHERE id='creditoRet'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE recebimentos SET retencao_atestado_id=NULL "
                            "WHERE id='creditoRet'")
        self.assertEqual(self.db.execute(
            "SELECT retencao_confirmada_cent FROM recebimentos "
            "WHERE id='creditoRet'").fetchone(),(200,))

    def test_legado_inconferido_preserva_fato_sem_inventar_documento(self):
        self.insert("recebimentos",id="retLegada",empresa_id="e1",
                    conta_receber_id="cr1",tipo_movimento="RECEBIMENTO",
                    data_credito="2020-01-01",valor_recebido_cent=0,
                    retencao_confirmada_cent=200,origem_dado="LEGADO",
                    conferencia="PENDENTE")
        self.assertEqual(self.db.execute(
            "SELECT retencao_confirmada_cent,retencao_atestado_id "
            "FROM recebimentos WHERE id='retLegada'").fetchone(),(200,None))
