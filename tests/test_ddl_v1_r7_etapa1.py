"""R7 etapa 1: provas adversariais Q08 e FIN05 SQLite, sem banco remoto."""
import json
import sqlite3
from test_ddl_v1 import DdlBase

class TestR7Etapa1(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()
        self.insert("usuarios", id="u_e1", access_issuer="https://r7.cloudflareaccess.com",
                    access_subject="e1-sub", email_normalizado="e1@local.invalid", ativo=1)
        self.insert("usuarios", id="u_e2", access_issuer="https://r7.cloudflareaccess.com",
                    access_subject="e2-sub", email_normalizado="e2@local.invalid", ativo=1)
        self.insert("operacoes", id="op_q08", empresa_id="e1", tipo="CONCILIAR_NF",
                    hash_pedido="q08", ator_id="u_e1", estado="CONCLUIDA")
        self.insert("operacoes", id="op_ret", empresa_id="e1", tipo="ATESTAR_RETENCAO",
                    hash_pedido="ret", ator_id="u_e1", estado="CONCLUIDA")

    def invoice(self, value=200):
        self.insert("notas_fiscais", id="nf_r7", empresa_id="e1",
                    empenho_id="ep1", orgao_id_escopo="o1",
                    situacao="EMITIDA", valor_documento_cent=value)
        self.insert("nota_fiscal_itens", id="line_r7", empresa_id="e1",
                    nota_fiscal_id="nf_r7", empenho_item_id="ei1",
                    empenho_id_escopo="ep1", quantidade_mil=2000, valor_unit_cent=100)
        self.insert("contas_receber", id="parcel_r7", empresa_id="e1",
                    nota_fiscal_id="nf_r7", parcela=1, valor_bruto_cent=200)

    def seal(self, sum_items=200, sum_parcels=200):
        self.insert("nf_conciliacoes",
                    id="seal_r7", empresa_id="e1", nota_fiscal_id="nf_r7",
                    numero_versao_nf=1, valor_documento_cent=200,
                    valor_itens_cent=sum_items, valor_parcelas_cent=sum_parcels,
                    itens_snapshot_json=json.dumps([["line_r7",1,2000,100]]),
                    parcelas_snapshot_json=json.dumps([["parcel_r7",1,1,200,0]]),
                    arredondamento="MEIO_PARA_CIMA_POR_LINHA_V1",
                    operacao_id="op_q08", ator_id="u_e1")

    def evidence(self, valid=True, id="v_ret", company="e1"):
        self.insert("documentos", id="d_ret", empresa_id="e1", tipo="COMPROVANTE_RETENCAO")
        self.insert("documento_versoes", id="v_ret", empresa_id="e1",
                    documento_id="d_ret", numero_versao=1,
                    estado_integridade="PENDENTE",
                    tamanho_bytes=3, sha256="a"*64)
        self.insert("documento_vinculos", id="vinc_ret", empresa_id="e1",
                    documento_id="d_ret",papel="COMPROVANTE_CREDITO",
                    conta_receber_id="cr1")
        self.insert("documento_localizacoes", id="loc_ret", empresa_id="e1",
                    versao_id="v_ret", provedor="R2", chave_r2="e1/prova-retencao",
                    status="PENDENTE")
        if valid:
            self.db.execute("UPDATE documento_localizacoes SET status='VERIFICADO', "
                            "hash_verificado=?,tamanho_verificado=3,verificado_em=? "
                            "WHERE id='loc_ret'", ("a"*64,"2026-11-07T10:00:00.000Z"))
            self.db.execute("UPDATE documento_versoes SET estado_integridade='VERIFICADO',"
                            "versao=versao+1,operacao_id='op_ret' WHERE id='v_ret'")

    def attest(self, versao="v_ret", empresa="e1", account="cr1", amount=100, id="atest1"):
        self.insert("retencao_atestados", id=id, empresa_id=empresa,
                    conta_receber_id=account, documento_versao_id=versao,
                    valor_confirmado_cent=amount, atestado_por_id="u_e1",
                    operacao_id="op_ret")

    def credit(self, atestado=None, amount=100, conta="cr1", empresa="e1", id="credito"):
        self.insert("recebimentos",id=id,empresa_id=empresa,conta_receber_id=conta,
                    tipo_movimento="RECEBIMENTO",data_credito="2026-11-07",
                    valor_recebido_cent=500,retencao_confirmada_cent=amount,
                    retencao_atestado_id=atestado,operacao_id="credit_"+id,
                    origem_dado="NATIVO",conferencia="VALIDADO")

    def test_q08_selo_de_nf_exata_aceito(self):
        self.invoice()
        self.seal()
        self.assertEqual(self.db.execute("SELECT valor_itens_cent,valor_parcelas_cent "
                   "FROM nf_conciliacoes WHERE id='seal_r7'").fetchone(),(200,200))

    def test_q08_total_item_diferente_rejeitado(self):
        self.invoice()
        with self.assertRaises(sqlite3.IntegrityError):
            self.seal(sum_items=199)

    def test_q08_total_parcela_diferente_rejeitado(self):
        self.invoice()
        with self.assertRaises(sqlite3.IntegrityError):
            self.seal(sum_parcels=199)

    def test_q08_selo_nao_apaga_nem_reativa_item_ou_parcela(self):
        self.invoice()
        self.seal()
        for cmd in [
          "UPDATE nota_fiscal_itens SET quantidade_mil=1000 WHERE id='line_r7'",
          "DELETE FROM nota_fiscal_itens WHERE id='line_r7'",
          "UPDATE contas_receber SET valor_bruto_cent=300 WHERE id='parcel_r7'",
          "DELETE FROM contas_receber WHERE id='parcel_r7'",
          "UPDATE notas_fiscais SET valor_documento_cent=300 WHERE id='nf_r7'",
          "DELETE FROM nf_conciliacoes WHERE id='seal_r7'",
          "UPDATE nf_conciliacoes SET valor_itens_cent=1 WHERE id='seal_r7'",
        ]:
            with self.subTest(cmd=cmd),self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(cmd)
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])

    def test_q08_nota_cruzando_empresa_rejeitada(self):
        self.invoice()
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("nf_conciliacoes", id="seal_bad", empresa_id="e2",
                nota_fiscal_id="nf_r7",numero_versao_nf=1,valor_documento_cent=200,
                valor_itens_cent=200,valor_parcelas_cent=200,
                itens_snapshot_json="[]",parcelas_snapshot_json="[]",
                arredondamento="MEIO_PARA_CIMA_POR_LINHA_V1",
                operacao_id="op_q08",ator_id="u_e1")

    def test_fin05_prevista_nao_confirma_sem_atestado(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.credit()
        self.assertEqual(self.db.execute("SELECT count(*) FROM recebimentos").fetchone(),(0,))

    def test_fin05_evidencia_pendente_nao_pode_ser_atestada(self):
        self.evidence(valid=False)
        with self.assertRaises(sqlite3.IntegrityError):
            self.attest()

    def test_fin05_versao_verificada_pode_ser_atestada(self):
        self.evidence()
        self.attest()
        self.credit(atestado="atest1")
        self.assertEqual(self.db.execute("SELECT retencao_atestado_id FROM recebimentos "
                             "WHERE id='credito'").fetchone(),("atest1",))

    def test_fin05_valor_retencao_nao_pode_ser_diferente_do_atestado(self):
        self.evidence()
        self.attest(amount=100)
        with self.assertRaises(sqlite3.IntegrityError):
            self.credit(atestado="atest1",amount=200)

    def test_fin05_mesmo_atestado_nao_pode_confirmar_duas_vezes(self):
        self.evidence()
        self.attest()
        self.credit(atestado="atest1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.credit(atestado="atest1",id="credito2")

    def test_fin05_cross_company_nunca_usa_atestado_de_e1(self):
        self.evidence()
        self.attest()
        with self.assertRaises(sqlite3.IntegrityError):
            self.credit(atestado="atest1",conta="cr2",empresa="e2")

    def test_fin05_legado_desconhecido_continua_preservavel(self):
        self.insert("recebimentos",id="legacy",empresa_id="e1",
                    conta_receber_id="cr1",tipo_movimento="RECEBIMENTO",
                    data_credito="2025-02-01",valor_recebido_cent=100,
                    retencao_confirmada_cent=50,origem_dado="LEGADO",
                    conferencia="PENDENTE")
        self.assertEqual(self.db.execute("SELECT retencao_confirmada_cent FROM "
                     "recebimentos WHERE id='legacy'").fetchone(),(50,))
