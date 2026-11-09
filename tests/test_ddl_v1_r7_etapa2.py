"""R7 E2: guardas físicas de vínculo do atestado e imutabilidade de ganho."""
from test_ddl_v1 import DdlBase
import sqlite3

class TestEtapa2DDL(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def test_q07_preco_ganho_com_empenho_confirmado_nao_reescreve(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE licitacao_itens SET valor_final_unit_cent=10 "
                            "WHERE id='li1'")
        row=self.db.execute("SELECT valor_final_unit_cent FROM licitacao_itens "
                            "WHERE id='li1'").fetchone()
        self.assertEqual(row,(1200,))

    def test_q07_ganho_sem_empenho_pode_ser_corrigido_na_mesma_versao_nativa(self):
        self.insert("licitacao_itens",id="li_free",empresa_id="e1",
                    licitacao_id="l1",numero_item="23",
                    resultado="GANHO",quantidade_prevista_mil=1000,
                    quantidade_ganha_mil=1000,valor_final_unit_cent=200,
                    conferencia="VALIDADO")
        self.db.execute("UPDATE licitacao_itens SET valor_final_unit_cent=225 "
                        "WHERE id='li_free'")
        self.assertEqual(self.db.execute("SELECT valor_final_unit_cent "
                         "FROM licitacao_itens WHERE id='li_free'").fetchone(),(225,))

    def test_fin05_comprovante_de_outra_conta_da_mesma_empresa_rejeitado(self):
        self.insert("usuarios",id="u_doc",email_normalizado="doc@local.invalid",
                    access_issuer="https://test.cloudflareaccess.com",
                    access_subject="doc",ativo=1)
        self.insert("operacoes",id="op_doc",empresa_id="e1",tipo="VERIFICAR",
                    hash_pedido="x",ator_id="u_doc",estado="CONCLUIDA")
        self.insert("contas_receber",id="cr_new",empresa_id="e1",
                    nota_fiscal_id="nf1",parcela=2,valor_bruto_cent=1000)
        self.insert("documentos",id="doc_ret",empresa_id="e1",
                    tipo="COMPROVANTE_RETENCAO")
        self.insert("documento_versoes",id="v_ret",empresa_id="e1",
                    documento_id="doc_ret",numero_versao=1,sha256="a"*64,
                    tamanho_bytes=12,estado_integridade="PENDENTE")
        self.insert("documento_vinculos",id="link_ret",empresa_id="e1",
                    documento_id="doc_ret",papel="COMPROVANTE_CREDITO",
                    conta_receber_id="cr1")
        self.insert("documento_localizacoes",id="loc_ret",empresa_id="e1",
                    versao_id="v_ret",provedor="R2",chave_r2="e1/doc_ret",
                    status="PENDENTE")
        self.db.execute("UPDATE documento_localizacoes SET status='VERIFICADO',"
                        "hash_verificado=?,tamanho_verificado=12,verificado_em=? "
                        "WHERE id='loc_ret'",("a"*64,"2026-11-07T12:00:00.000Z"))
        self.db.execute("UPDATE documento_versoes SET estado_integridade='VERIFICADO',"
                        "versao=versao+1,operacao_id='op_doc' WHERE id='v_ret'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("retencao_atestados",id="bad_at",empresa_id="e1",
                        conta_receber_id="cr_new",documento_versao_id="v_ret",
                        valor_confirmado_cent=100,atestado_por_id="u_doc",
                        operacao_id="op_doc")
        self.insert("retencao_atestados",id="ok_at",empresa_id="e1",
                    conta_receber_id="cr1",documento_versao_id="v_ret",
                    valor_confirmado_cent=100,atestado_por_id="u_doc",
                    operacao_id="op_doc")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
