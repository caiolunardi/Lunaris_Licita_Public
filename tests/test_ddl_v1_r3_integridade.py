"""R3: N03 (NATIVO sem escape PENDENTE), N15 e A08 (pais nao invalidam filhos).
Somente SQLite + Wrangler local. Sem producao ou D1 remoto.
"""
import sqlite3
import unittest
from test_ddl_v1 import DdlBase


class TestR3IntegridadeNativa(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def native_credit(self):
        self.insert("recebimentos",id="credito_nativo_r3",empresa_id="e1",
                    conta_receber_id="cr1",tipo_movimento="RECEBIMENTO",
                    data_credito="2026-11-07",valor_recebido_cent=1000,
                    retencao_confirmada_cent=0,origem_dado="NATIVO",
                    conferencia="PENDENTE")

    def test_n03_item_ganho_nativo_pendente_exige_quantidade_e_preco(self):
        for qty,price in ((0,100),(1000,0),(None,100),(1000,None)):
            self.rejects("licitacao_itens",id=f"ganho_{qty}_{price}",
                         empresa_id="e1",licitacao_id="l1",
                         numero_item="9",resultado="GANHO",
                         quantidade_ganha_mil=qty,valor_final_unit_cent=price,
                         origem_dado="NATIVO",conferencia="PENDENTE")
        self.insert("licitacao_itens",id="ganho_ok",empresa_id="e1",
                    licitacao_id="l1",numero_item="10",resultado="GANHO",
                    quantidade_ganha_mil=1000,valor_final_unit_cent=200,
                    conferencia="PENDENTE")

    def test_n03_item_ganho_legado_pendente_incompleto_preservado(self):
        self.insert("licitacao_itens",id="ganho_legado",empresa_id="e1",
                    licitacao_id="l1",numero_item="11",resultado="GANHO",
                    quantidade_ganha_mil=0,valor_final_unit_cent=None,
                    origem_dado="LEGADO",conferencia="PENDENTE")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE licitacao_itens SET conferencia='VALIDADO' "
                            "WHERE id='ganho_legado'")

    def test_n03_envio_nativo_entregue_requer_data_independente_de_conferencia(self):
        self.rejects("envios",id="entregue_sem_data",empresa_id="e1",
                     empenho_id="ep1",situacao="ENTREGUE",conferencia="PENDENTE")
        self.insert("envios",id="entregue_com_data",empresa_id="e1",
                    empenho_id="ep1",situacao="ENTREGUE",
                    data_entrega="2026-11-07",conferencia="PENDENTE")

    def test_n03_envio_legado_entregue_sem_data_e_pendente(self):
        self.insert("envios",id="entrega_legacy",empresa_id="e1",
                    empenho_id="ep1",situacao="ENTREGUE",
                    origem_dado="LEGADO",conferencia="PENDENTE")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE envios SET conferencia='VALIDADO' "
                            "WHERE id='entrega_legacy'")

    def test_n03_recusa_nativa_pendente_exige_motivo(self):
        self.rejects("envio_itens",id="recusa_sem_motivo",empresa_id="e1",
                     envio_id="en1",compra_item_id="ci1",
                     empenho_id_escopo="ep1",quantidade_recusada_mil=100,
                     quantidade_mil=200,quantidade_aceita_mil=100,
                     motivo_recusa="",origem_dado="NATIVO",conferencia="PENDENTE")
        self.insert("envio_itens",id="recusa_com_motivo",empresa_id="e1",
                    envio_id="en1",compra_item_id="ci1",empenho_id_escopo="ep1",
                    quantidade_mil=200,quantidade_aceita_mil=100,
                    quantidade_recusada_mil=100,
                    motivo_recusa="Material danificado",conferencia="PENDENTE")

    def test_n03_diverso_nativo_nao_pode_omitir_beneficiario_categoria(self):
        for ben,cat in ((None,"SERVICOS"),(" ","SERVICOS"),("Internet",None),("Internet"," ")):
            self.rejects("titulos_pagar",id="diverso_ruim",empresa_id="e1",
                         tipo="DIVERSO",beneficiario=ben,categoria_despesa=cat,
                         valor_nominal_cent=8500,conferencia="PENDENTE")
        self.insert("titulos_pagar",id="diverso_correto",empresa_id="e1",
                    tipo="DIVERSO",beneficiario="Internet",
                    categoria_despesa="SERVICOS",valor_nominal_cent=8500,
                    conferencia="PENDENTE")

    def test_n03_diverso_legado_incompleto_mantido_em_conferencia(self):
        self.insert("titulos_pagar",id="legado_diverso",empresa_id="e1",
                    tipo="DIVERSO",origem_dado="LEGADO",
                    beneficiario=None,categoria_despesa=None,
                    conferencia="PENDENTE")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE titulos_pagar SET conferencia='VALIDADO' "
                            "WHERE id='legado_diverso'")

    def test_n03_orgao_nativo_pendente_nao_pode_repetir_nome_normalizado(self):
        self.insert("orgaos",id="o_norm1",empresa_id="e1",nome="Orgao Externo",
                    nome_normalizado="orgao externo",conferencia="PENDENTE")
        self.rejects("orgaos",id="o_norm2",empresa_id="e1",nome="Orgao Externo 2",
                     nome_normalizado="orgao externo",conferencia="PENDENTE")

    def test_n03_fornecedor_nativo_pendente_nao_pode_repetir_nome_normalizado(self):
        self.insert("fornecedores",id="f_norm1",empresa_id="e1",nome="Servicos X",
                    nome_normalizado="servicos x",conferencia="PENDENTE")
        self.rejects("fornecedores",id="f_norm2",empresa_id="e1",nome="Servicos Y",
                     nome_normalizado="servicos x",conferencia="PENDENTE")

    def test_n03_licitacao_nativa_pendente_nao_aceita_chave_natural_repetida(self):
        self.insert("licitacoes",id="l_norm1",empresa_id="e1",orgao_id="o1",
                    numero="12",numero_normalizado="12",ano=2026,
                    conferencia="PENDENTE")
        self.rejects("licitacoes",id="l_norm2",empresa_id="e1",orgao_id="o1",
                     numero="12/2026",numero_normalizado="12",ano=2026,
                     conferencia="PENDENTE")

    def test_n03_item_licitacao_nativo_pendente_nao_duplica_numero_lote(self):
        self.insert("licitacao_itens",id="li_norm1",empresa_id="e1",
                    licitacao_id="l1",numero_item="15",
                    numero_item_normalizado="15",conferencia="PENDENTE")
        self.rejects("licitacao_itens",id="li_norm2",empresa_id="e1",
                     licitacao_id="l1",numero_item="15b",
                     numero_item_normalizado="15",conferencia="PENDENTE")

    def test_n03_empenho_nativo_pendente_nao_duplica_numero(self):
        self.insert("empenhos",id="ep_norm1",empresa_id="e1",
                    licitacao_id="l1",orgao_id_escopo="o1",
                    numero="E77",numero_normalizado="E77",ano=2026)
        self.rejects("empenhos",id="ep_norm2",empresa_id="e1",
                     licitacao_id="l1",orgao_id_escopo="o1",
                     numero="E77",numero_normalizado="E77",ano=2026)

    def test_n03_nf_nativa_pendente_nao_duplica_chave(self):
        self.insert("notas_fiscais",id="nf_chave1",empresa_id="e1",
                    empenho_id="ep1",orgao_id_escopo="o1",situacao="RASCUNHO",
                    chave_acesso="1"*44,conferencia="PENDENTE")
        self.rejects("notas_fiscais",id="nf_chave2",empresa_id="e1",
                     empenho_id="ep1",orgao_id_escopo="o1",situacao="RASCUNHO",
                     chave_acesso="1"*44,conferencia="PENDENTE")

    def test_n03_nf_nativa_pendente_nao_duplica_numero_natural(self):
        self.insert("notas_fiscais",id="nf_num1",empresa_id="e1",
                    empenho_id="ep1",orgao_id_escopo="o1",
                    numero="N89",numero_normalizado="89",serie="1",
                    situacao="RASCUNHO",conferencia="PENDENTE")
        self.rejects("notas_fiscais",id="nf_num2",empresa_id="e1",
                     empenho_id="ep1",orgao_id_escopo="o1",
                     numero="N89",numero_normalizado="89",serie="1",
                     situacao="RASCUNHO",conferencia="PENDENTE")

    def test_n03_legado_pendente_pode_duplicar_chave_para_conferencia(self):
        self.insert("notas_fiscais",id="nf_legacy_1",empresa_id="e1",
                    empenho_id="ep1",orgao_id_escopo="o1",
                    chave_acesso="9"*44,origem_dado="LEGADO",
                    conferencia="PENDENTE")
        self.insert("notas_fiscais",id="nf_legacy_2",empresa_id="e1",
                    empenho_id="ep1",orgao_id_escopo="o1",
                    chave_acesso="9"*44,origem_dado="LEGADO",
                    conferencia="PENDENTE")
        self.db.execute("UPDATE notas_fiscais SET conferencia='VALIDADO' "
                        "WHERE id='nf_legacy_1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE notas_fiscais SET conferencia='VALIDADO' "
                            "WHERE id='nf_legacy_2'")

    def test_n03_validar_legado_com_chave_nativo_conflitante_rejeita(self):
        self.insert("notas_fiscais",id="nf_nativo_r3",empresa_id="e1",
                    empenho_id="ep1",orgao_id_escopo="o1",
                    chave_acesso="8"*44,origem_dado="NATIVO",
                    conferencia="PENDENTE")
        self.insert("notas_fiscais",id="nf_legacy_r3",empresa_id="e1",
                    empenho_id="ep1",orgao_id_escopo="o1",
                    chave_acesso="8"*44,origem_dado="LEGADO",
                    conferencia="PENDENTE")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE notas_fiscais SET conferencia='VALIDADO' "
                            "WHERE id='nf_legacy_r3'")

    def test_n15_compra_nativo_com_boleto_ativo_nao_retrocede(self):
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        self.insert("titulos_pagar",id="t_compra_ativa",empresa_id="e1",
                    tipo="FORNECEDOR",compra_id="co1",fornecedor_id="f1",
                    origem_dado="NATIVO",conferencia="PENDENTE",
                    cancelado=0,valor_nominal_cent=5000)
        for novo in ("RASCUNHO","CANCELADA",None):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("UPDATE compras SET situacao=? WHERE id='co1'",(novo,))
        self.assertEqual(self.db.execute(
            "SELECT situacao FROM compras WHERE id='co1'").fetchone(),
            ("CONFIRMADA",))

    def test_n15_compra_depois_cancelar_boleto_pode_cancelar(self):
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        self.insert("titulos_pagar",id="t_compra_depois_cancelado",empresa_id="e1",
                    tipo="FORNECEDOR",compra_id="co1",fornecedor_id="f1",
                    origem_dado="NATIVO",cancelado=0,valor_nominal_cent=5000)
        self.db.execute("UPDATE titulos_pagar SET cancelado=1, motivo_cancelamento='Boleto cancelado' WHERE id='t_compra_depois_cancelado'")
        self.db.execute("UPDATE compras SET situacao='CANCELADA' WHERE id='co1'")
        self.assertEqual(self.db.execute(
            "SELECT situacao FROM compras WHERE id='co1'").fetchone(),
            ("CANCELADA",))

    def test_n15_legado_cancelado_em_compra_cancelada_continua_valido(self):
        self.db.execute("UPDATE compras SET situacao='CANCELADA' WHERE id='co1'")
        self.insert("titulos_pagar",id="t_legado_cancelado",empresa_id="e1",
                    tipo="FORNECEDOR",compra_id="co1",fornecedor_id="f1",
                    origem_dado="LEGADO",cancelado=1,conferencia="PENDENTE")

    def test_a08_nf_com_credito_nativo_nao_retrocede_ou_cancela(self):
        self.native_credit()
        for estado in ("RASCUNHO","CANCELADA",None):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("UPDATE notas_fiscais SET situacao=? WHERE id='nf1'",(estado,))
        self.db.execute("UPDATE notas_fiscais SET situacao='APRESENTADA' WHERE id='nf1'")
        self.assertEqual(self.db.execute(
            "SELECT situacao FROM notas_fiscais WHERE id='nf1'").fetchone(),
            ("APRESENTADA",))

    def test_a08_empenho_com_credito_nativo_nao_retrocede(self):
        self.native_credit()
        for estado in ("RASCUNHO","CANCELADO",None):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("UPDATE empenhos SET situacao=? WHERE id='ep1'",(estado,))
        self.assertEqual(self.db.execute(
            "SELECT situacao FROM empenhos WHERE id='ep1'").fetchone(),
            ("CONFIRMADO",))

    def test_a08_licitacao_com_credito_nativo_nao_cancela(self):
        self.native_credit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE licitacoes SET situacao_participacao='CANCELADA' "
                            "WHERE id='l1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE licitacoes SET orgao_id='o2' WHERE id='l1'")
        self.assertEqual(self.db.execute(
            "SELECT situacao_participacao FROM licitacoes WHERE id='l1'"
        ).fetchone(),(None,))

    def test_a08_encerramento_com_credito_nativo_e_permitido(self):
        self.native_credit()
        self.insert("licitacao_encerramentos",id="encerramento_normal",
                    empresa_id="e1",licitacao_id="l1",
                    encerrada_em="2026-11-07T11:00:00Z",motivo="Entrega concluida")
        self.assertEqual(self.db.execute(
            "SELECT encerrada_em FROM licitacoes WHERE id='l1'"
        ).fetchone(),("2026-11-07T11:00:00Z",))

    def test_a08_sem_credito_nativo_mantem_fluxo_legado_pendente(self):
        self.insert("recebimentos",id="credito_legacy_pending",empresa_id="e1",
                    conta_receber_id="cr1",tipo_movimento="RECEBIMENTO",
                    data_credito="2024-05-10",valor_recebido_cent=500,
                    retencao_confirmada_cent=0,origem_dado="LEGADO",conferencia="PENDENTE")
        self.db.execute("UPDATE notas_fiscais SET situacao='RASCUNHO' WHERE id='nf1'")
        self.db.execute("UPDATE empenhos SET situacao='CANCELADO' WHERE id='ep1'")
        self.db.execute("UPDATE licitacoes SET situacao_participacao='CANCELADA' WHERE id='l1'")
        self.assertEqual(self.db.execute(
            "SELECT situacao FROM notas_fiscais WHERE id='nf1'").fetchone(),
            ("RASCUNHO",))

    def test_a08_nativo_sem_credito_mantem_edicao_de_rascunho(self):
        self.db.execute("UPDATE notas_fiscais SET situacao='RASCUNHO' WHERE id='nf1'")
        self.db.execute("UPDATE empenhos SET situacao='RASCUNHO' WHERE id='ep1'")
        self.db.execute("UPDATE licitacoes SET situacao_participacao='CANCELADA' WHERE id='l1'")

    def test_r3_fk_e_integridade_apos_tentativas_invalidas(self):
        self.native_credit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE empenhos SET situacao='CANCELADO' WHERE id='ep1'")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(),("ok",))


if __name__=="__main__":
    unittest.main()
