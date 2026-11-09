"""R7 W5 — quantidade segura sob a mesma instrução D1/SQLite.
Dados sintéticos apenas. Não provam concorrência HTTP Workerd de ponta a ponta.
"""
import sqlite3
from test_ddl_v1 import DdlBase

class TestR7Quantidades(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def empenho(self, id="ep3", situacao="RASCUNHO"):
        self.insert("empenhos",id=id,empresa_id="e1",licitacao_id="l1",
                    orgao_id_escopo="o1",numero=id,situacao=situacao)

    def empenho_item(self, id="ei3", empenho_id="ep3", item="li1", quantidade=1):
        self.insert("empenho_itens",id=id,empresa_id="e1",
                    empenho_id=empenho_id,licitacao_item_id=item,
                    licitacao_id_escopo="l1",quantidade_mil=quantidade)

    def compra(self,id="co3", situacao="RASCUNHO"):
        self.insert("compras",id=id,empresa_id="e1",
                    empenho_id="ep1",fornecedor_id="f1",situacao=situacao)

    def compra_item(self,id="ci3", compra_id="co3", quantidade=1):
        self.insert("compra_itens",id=id,empresa_id="e1",
                    compra_id=compra_id,empenho_item_id="ei1",
                    empenho_id_escopo="ep1",quantidade_mil=quantidade)

    def envio(self,id="en3",estado="PLANEJADO"):
        self.insert("envios",id=id,empresa_id="e1",empenho_id="ep1",situacao=estado)

    def envio_item(self,id="en_i3",envio_id="en3",quantidade=1):
        self.insert("envio_itens",id=id,empresa_id="e1",envio_id=envio_id,
                    compra_item_id="ci1",empenho_id_escopo="ep1",
                    quantidade_mil=quantidade,quantidade_aceita_mil=0,
                    quantidade_recusada_mil=0)

    def nf(self,id="nf3",estado="RASCUNHO"):
        self.insert("notas_fiscais",id=id,empresa_id="e1",empenho_id="ep1",
                    orgao_id_escopo="o1",situacao=estado)

    def nf_item(self,id="nf_i3",nf_id="nf3",quantidade=1):
        self.insert("nota_fiscal_itens",id=id,empresa_id="e1",
                    nota_fiscal_id=nf_id,empenho_item_id="ei1",
                    empenho_id_escopo="ep1",quantidade_mil=quantidade)

    def test_Q02_empenho_ja_confirmado_nao_recebe_quantidade_extra(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.empenho_item("dup","ep1",quantidade=1)

    def test_Q02_confirmar_empenho_novo_que_estoura_ganho_recusado(self):
        self.empenho()
        self.empenho_item()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE empenhos SET situacao='CONFIRMADO' WHERE id='ep3'")

    def test_Q02_outro_item_ganho_pode_ser_empenhado(self):
        self.insert("licitacao_itens",id="li3",empresa_id="e1",licitacao_id="l1",
                    numero_item="3",resultado="GANHO",quantidade_prevista_mil=4000,
                    quantidade_ganha_mil=2500,valor_final_unit_cent=10)
        self.empenho()
        self.empenho_item(item="li3",quantidade=2500)
        self.db.execute("UPDATE empenhos SET situacao='CONFIRMADO' WHERE id='ep3'")
        self.assertEqual(self.db.execute("SELECT situacao FROM empenhos "
                                        "WHERE id='ep3'").fetchone(),("CONFIRMADO",))

    def test_Q02_empenho_legado_pendente_preserva_quantidade_desconhecida(self):
        self.empenho("ep3","RASCUNHO")
        self.insert("empenho_itens",id="historico",empresa_id="e1",
                    empenho_id="ep3",licitacao_item_id="li1",
                    licitacao_id_escopo="l1",origem_dado="LEGADO",
                    conferencia="PENDENTE",quantidade_mil=9000)
        self.assertEqual(self.db.execute("SELECT quantidade_mil FROM empenho_itens "
                                       "WHERE id='historico'").fetchone(),(9000,))

    def test_Q03_compra_confirmada_nao_duplica_emp_item(self):
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        self.compra()
        self.compra_item()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co3'")

    def test_Q03_compra_confirmada_rejeita_insert_extra(self):
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.compra_item("ci_extra","co1",1)

    def test_Q03_duas_compras_parciais_legitimas(self):
        self.db.execute("UPDATE compra_itens SET quantidade_mil=1000 WHERE id='ci1'")
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        self.compra()
        self.compra_item(quantidade=2000)
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co3'")
        self.assertEqual(self.db.execute("SELECT count(*) FROM compras "
                 "WHERE situacao='CONFIRMADA' AND empenho_id='ep1'").fetchone(),(2,))

    def test_Q04_envio_de_compra_rascunho_rejeitado(self):
        self.envio()
        self.envio_item()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE envios SET situacao='DESPACHADO' WHERE id='en3'")

    def test_Q04_envio_confirmado_nao_excede_compra(self):
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        self.envio()
        self.envio_item(quantidade=3000)
        self.db.execute("UPDATE envios SET situacao='DESPACHADO' WHERE id='en3'")
        self.envio("en4")
        self.envio_item("ei4","en4",quantidade=1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE envios SET situacao='DESPACHADO' WHERE id='en4'")

    def test_Q04_envio_novo_item_apos_despacho_rejeitado(self):
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        self.envio()
        self.envio_item(quantidade=3000)
        self.db.execute("UPDATE envios SET situacao='DESPACHADO' WHERE id='en3'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.envio_item("excesso","en3",1)

    def test_Q04_duas_entregas_parciais_legitimas(self):
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        self.envio()
        self.envio_item(quantidade=1200)
        self.db.execute("UPDATE envios SET situacao='DESPACHADO' WHERE id='en3'")
        self.envio("en4")
        self.envio_item("restante","en4",1800)
        self.db.execute("UPDATE envios SET situacao='DESPACHADO' WHERE id='en4'")
        self.assertEqual(self.db.execute("SELECT SUM(quantidade_mil) FROM envio_itens "
                                      "WHERE empresa_id='e1'").fetchone(),(3000,))

    def test_Q05_recusa_precisa_motivo_e_respeita_total(self):
        self.rejects("envio_itens",id="recusa",empresa_id="e1",
                    envio_id="en1",compra_item_id="ci1",empenho_id_escopo="ep1",
                    quantidade_mil=100,quantidade_aceita_mil=20,
                    quantidade_recusada_mil=81,motivo_recusa="Motivo")
        self.rejects("envio_itens",id="sem_motivo",empresa_id="e1",
                    envio_id="en1",compra_item_id="ci1",empenho_id_escopo="ep1",
                    quantidade_mil=100,quantidade_aceita_mil=20,
                    quantidade_recusada_mil=80)

    def test_Q06_nf_emitida_nao_fatura_mais_que_empenho(self):
        self.nf_item("nf_a","nf1",3000)
        self.nf("nf3","EMITIDA")
        with self.assertRaises(sqlite3.IntegrityError):
            self.nf_item("nf_b","nf3",1)

    def test_Q06_nf_em_rascunho_nao_confirma_acima_do_limite(self):
        self.nf_item("nf_a","nf1",3000)
        self.nf()
        self.nf_item()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE notas_fiscais SET situacao='EMITIDA' WHERE id='nf3'")

    def test_Q06_nf_antes_da_entrega_e_aceita(self):
        self.nf_item("nf_a","nf1",1000)
        self.assertEqual(self.db.execute("SELECT count(*) FROM envio_itens").fetchone(),(0,))
        self.assertEqual(self.db.execute("SELECT quantidade_mil FROM nota_fiscal_itens "
                                         "WHERE id='nf_a'").fetchone(),(1000,))

    def test_Q07_empenho_comprometido_nao_reescreve_quantidade(self):
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE empenho_itens SET quantidade_mil=1000 WHERE id='ei1'")

    def test_Q07_item_pai_sem_compra_confirmada_pode_ser_revisado(self):
        self.db.execute("UPDATE empenho_itens SET quantidade_mil=2900 WHERE id='ei1'")
        self.assertEqual(self.db.execute("SELECT quantidade_mil FROM empenho_itens "
                                        "WHERE id='ei1'").fetchone(),(2900,))

    def test_integridade_apos_tentativas_invalidas(self):
        self.test_Q02_empenho_ja_confirmado_nao_recebe_quantidade_extra()
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(),("ok",))
