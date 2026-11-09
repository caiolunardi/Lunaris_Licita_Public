"""R2: provas adversariais de fidelidade historica N01/N02/N14.

A validacao de um evento LEGADO e atestado aditivo, NAO altera o movimento
original nem cria estorno bancario. Todos os testes usam SQLite descartavel.
"""
import sqlite3
import unittest
from test_ddl_v1 import DdlBase


class TestR2Legado(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def fechar_venda(self):
        self.insert(
            "licitacao_encerramentos", id="enc_r2", empresa_id="e1",
            licitacao_id="l1", encerrada_em="2025-12-31T16:00:00Z",
            motivo="encerramento historico", origem_dado="LEGADO"
        )

    def credito_legado(self, id="cred_legado", valor=2000, retencao=0,
                      conferencia="PENDENTE"):
        self.insert(
            "recebimentos", id=id, empresa_id="e1",
            conta_receber_id="cr1", tipo_movimento="RECEBIMENTO",
            data_credito="2025-07-12", valor_recebido_cent=valor,
            retencao_confirmada_cent=retencao, origem_dado="LEGADO",
            conferencia=conferencia,
            conferencia_legado_original="VALIDADO"
        )

    def atestar(self, id="att_r2", recibo="cred_legado",
               resultado="VALIDADO", **extra):
        data=dict(
            id=id, empresa_id="e1", recebimento_id=recibo,
            resultado=resultado, justificativa="extrato e comprovante conferidos",
            evidencia_ref="inventario/snapshot/123", conferido_por="auditor-r2"
        )
        data.update(extra)
        self.insert("recebimento_conferencias", **data)

    def cancelar_compra(self):
        self.db.execute("UPDATE compras SET situacao='CANCELADA' WHERE id='co1'")

    def test_n01_parcela_substituida_e_ativa_mesmo_numero_coexistem(self):
        self.insert("contas_receber", id="substituida", empresa_id="e1",
                    nota_fiscal_id="nf1", parcela=1, cancelada=1,
                    motivo_cancelamento="Parcela substituída",
                    origem_dado="LEGADO", valor_bruto_cent=4200)
        self.assertEqual(self.db.execute(
            "SELECT id,cancelada FROM contas_receber "
            "WHERE nota_fiscal_id='nf1' AND parcela=1 ORDER BY id"
        ).fetchall(), [("cr1",0),("substituida",1)])

    def test_n01_duas_ativas_mesmo_numero_rejeitadas(self):
        self.rejects("contas_receber",id="ativa_duplicada",empresa_id="e1",
                     nota_fiscal_id="nf1",parcela=1,cancelada=0,
                     valor_bruto_cent=4000)

    def test_n01_duas_substituicoes_antigas_sao_preservadas(self):
        for i in (1,2):
            self.insert("contas_receber",id=f"historica_{i}",empresa_id="e1",
                        nota_fiscal_id="nf1",parcela=1,cancelada=1,
                        motivo_cancelamento="Parcela substituída",
                        valor_bruto_cent=3000+i,origem_dado="LEGADO")
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM contas_receber "
            "WHERE nota_fiscal_id='nf1' AND parcela=1"
        ).fetchone(),(3,))

    def test_n01_reativar_historica_com_outra_ativa_e_rejeitado(self):
        self.insert("contas_receber",id="historica",empresa_id="e1",
                    nota_fiscal_id="nf1",parcela=1,cancelada=1,
                    motivo_cancelamento="Parcela substituída")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE contas_receber SET cancelada=0 WHERE id='historica'"
            )

    def test_n01_cancelamento_de_parcela_com_evento_financeiro_rejeitado(self):
        self.insert("recebimentos",id="credito_nativo",empresa_id="e1",
                    conta_receber_id="cr1",tipo_movimento="RECEBIMENTO",
                    data_credito="2026-05-01",valor_recebido_cent=100,
                    retencao_confirmada_cent=0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE contas_receber SET cancelada=1 WHERE id='cr1'")

    def test_n02_boleto_legado_cancelado_com_compra_cancelada_e_legitimo(self):
        self.cancelar_compra()
        self.insert("titulos_pagar",id="boleto_antigo",empresa_id="e1",
                    tipo="FORNECEDOR",compra_id="co1",fornecedor_id="f1",
                    cancelado=1,motivo_cancelamento="Compra cancelada",
                    origem_dado="LEGADO",conferencia="PENDENTE",
                    valor_nominal_cent=3000)
        self.assertEqual(self.db.execute(
            "SELECT c.situacao,t.cancelado,t.conferencia FROM titulos_pagar t "
            "JOIN compras c ON c.id=t.compra_id WHERE t.id='boleto_antigo'"
        ).fetchone(),("CANCELADA",1,"PENDENTE"))
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])

    def test_n02_boleto_nativo_em_compra_cancelada_rejeitado(self):
        self.cancelar_compra()
        self.rejects("titulos_pagar",id="novo_boleto",empresa_id="e1",
                     tipo="FORNECEDOR",compra_id="co1",fornecedor_id="f1",
                     cancelado=1,origem_dado="NATIVO",conferencia="PENDENTE")

    def test_n02_boleto_legado_ativo_na_compra_cancelada_rejeitado(self):
        self.cancelar_compra()
        self.rejects("titulos_pagar",id="legado_ativo",empresa_id="e1",
                     tipo="FORNECEDOR",compra_id="co1",fornecedor_id="f1",
                     cancelado=0,origem_dado="LEGADO",conferencia="PENDENTE")

    def test_n02_boleto_legado_validado_sem_conferencia_antes_rejeitado(self):
        self.cancelar_compra()
        self.rejects("titulos_pagar",id="nao_conferido",empresa_id="e1",
                     tipo="FORNECEDOR",compra_id="co1",fornecedor_id="f1",
                     cancelado=1,origem_dado="LEGADO",conferencia="VALIDADO")

    def test_n02_boleto_legado_com_compra_inexistente_ou_outro_fornecedor_rejeitado(self):
        self.cancelar_compra()
        for compra,fornecedor in (("compra_fantasma","f1"),("co1","f2")):
            self.rejects("titulos_pagar",id=f"inv_{compra}_{fornecedor}",
                         empresa_id="e1",tipo="FORNECEDOR",compra_id=compra,
                         fornecedor_id=fornecedor,cancelado=1,
                         origem_dado="LEGADO",conferencia="PENDENTE")

    def test_n02_boleto_historico_pode_ser_marcado_inconsistente_sem_alterar_compra(self):
        self.cancelar_compra()
        self.insert("titulos_pagar",id="hist_inconsistente",empresa_id="e1",
                    tipo="FORNECEDOR",compra_id="co1",fornecedor_id="f1",
                    cancelado=1,origem_dado="LEGADO",conferencia="PENDENTE")
        self.db.execute(
            "UPDATE titulos_pagar SET conferencia='INCONSISTENTE' "
            "WHERE id='hist_inconsistente'"
        )
        self.assertEqual(self.db.execute(
            "SELECT t.conferencia,c.situacao FROM titulos_pagar t "
            "JOIN compras c ON c.id=t.compra_id "
            "WHERE t.id='hist_inconsistente'"
        ).fetchone(),("INCONSISTENTE","CANCELADA"))

    def test_n02_boleto_historico_nao_pode_renascer_ativo_ou_trocar_origem(self):
        self.cancelar_compra()
        self.insert("titulos_pagar",id="cancelado_antigo",empresa_id="e1",
                    tipo="FORNECEDOR",compra_id="co1",fornecedor_id="f1",
                    cancelado=1,origem_dado="LEGADO",conferencia="PENDENTE")
        for update in (
            "UPDATE titulos_pagar SET cancelado=0 WHERE id='cancelado_antigo'",
            "UPDATE titulos_pagar SET conferencia='VALIDADO' WHERE id='cancelado_antigo'",
            "UPDATE titulos_pagar SET origem_dado='NATIVO' WHERE id='cancelado_antigo'"
        ):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(update)

    def test_n02_fonte_nativa_nao_vira_legado_para_furar_regra(self):
        self.db.execute("UPDATE compras SET situacao='CONFIRMADA' WHERE id='co1'")
        self.insert("titulos_pagar",id="boleto_nativo",empresa_id="e1",
                    tipo="FORNECEDOR",compra_id="co1",fornecedor_id="f1",
                    valor_nominal_cent=1500)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE titulos_pagar SET origem_dado='LEGADO' WHERE id='boleto_nativo'"
            )

    def test_n02_boleto_avulso_sem_compra_permanece_valido(self):
        self.insert("titulos_pagar",id="avulso_r2",empresa_id="e1",
                    tipo="FORNECEDOR",fornecedor_id="f1",
                    valor_nominal_cent=1250)
        self.assertIsNone(self.db.execute(
            "SELECT compra_id FROM titulos_pagar WHERE id='avulso_r2'"
        ).fetchone()[0])

    def test_n14_credito_hist_em_venda_encerrada_importa_pendente_sem_fabricar_estorno(self):
        self.fechar_venda()
        self.credito_legado()
        self.assertEqual(self.db.execute(
            "SELECT conferencia,conferencia_legado_original,valor_recebido_cent "
            "FROM recebimentos WHERE id='cred_legado'"
        ).fetchone(),("PENDENTE","VALIDADO",2000))
        self.assertEqual(self.db.execute(
            "SELECT estado_saldo,saldo_cent FROM v_contas_receber_saldos "
            "WHERE id='cr1'"
        ).fetchone(),("PENDENTE_CONFERENCIA",None))
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM recebimentos WHERE conta_receber_id='cr1'"
        ).fetchone(),(1,))

    def test_n14_conferencia_do_legado_encerrado_habilita_saldo_sem_alterar_fato(self):
        self.fechar_venda()
        self.credito_legado()
        self.atestar()
        self.assertEqual(self.db.execute(
            "SELECT conferencia,valor_recebido_cent FROM recebimentos "
            "WHERE id='cred_legado'"
        ).fetchone(),("PENDENTE",2000))
        self.assertEqual(self.db.execute(
            "SELECT conferencia FROM v_recebimentos_ativos WHERE id='cred_legado'"
        ).fetchone(),("VALIDADO",))
        self.assertEqual(self.db.execute(
            "SELECT estado_saldo,saldo_cent FROM v_contas_receber_saldos "
            "WHERE id='cr1'"
        ).fetchone(),("CONFERIDO",3000))
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM recebimentos WHERE conta_receber_id='cr1'"
        ).fetchone(),(1,))
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM eventos_auditoria WHERE "
            "entidade_id_texto='cred_legado' AND acao='CONFERIR_LEGADO'"
        ).fetchone(),(1,))

    def test_n14_conferencia_validada_direta_no_importe_e_negada(self):
        self.fechar_venda()
        with self.assertRaises(sqlite3.IntegrityError):
            self.credito_legado(conferencia="VALIDADO")

    def test_n14_duas_conferencias_com_mesma_revisao_sao_rejeitadas(self):
        self.credito_legado();self.atestar()
        with self.assertRaises(sqlite3.IntegrityError):
            self.atestar(id="outro")

    def test_n14_revisao_posterior_muda_somente_projecao_com_trilha(self):
        self.credito_legado();self.atestar()
        self.atestar(id="att_corrigido",resultado="INCONSISTENTE",
                    revisao=2,substitui_conferencia_id="att_r2",
                    justificativa="conciliacao posterior encontrou divergencia")
        self.assertEqual(self.db.execute(
            "SELECT conferencia FROM v_recebimentos_ativos WHERE id='cred_legado'"
        ).fetchone(),("INCONSISTENTE",))
        self.assertEqual(self.db.execute(
            "SELECT estado_saldo,saldo_cent FROM v_contas_receber_saldos WHERE id='cr1'"
        ).fetchone(),("INCONSISTENTE",None))
        self.assertEqual(self.db.execute(
            "SELECT conferencia,valor_recebido_cent FROM recebimentos WHERE id='cred_legado'"
        ).fetchone(),("PENDENTE",2000))
        self.assertEqual(self.db.execute(
            "SELECT revisao,resultado FROM recebimento_conferencias "
            "WHERE recebimento_id='cred_legado' ORDER BY revisao"
        ).fetchall(),[(1,"VALIDADO"),(2,"INCONSISTENTE")])
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM eventos_auditoria "
            "WHERE entidade_id_texto='cred_legado' AND acao='CONFERIR_LEGADO'"
        ).fetchone(),(2,))

    def test_n14_revisao_nao_pode_fingir_elo_ou_saltar_numero(self):
        self.credito_legado();self.atestar()
        with self.assertRaises(sqlite3.IntegrityError):
            self.atestar(id="sem_elo",resultado="INCONSISTENTE",revisao=2)
        with self.assertRaises(sqlite3.IntegrityError):
            self.atestar(id="salto",resultado="INCONSISTENTE",revisao=4,
                        substitui_conferencia_id="att_r2")
        with self.assertRaises(sqlite3.IntegrityError):
            self.atestar(id="elo_fantasma",resultado="INCONSISTENTE",revisao=2,
                        substitui_conferencia_id="nao_existe")
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM recebimento_conferencias "
            "WHERE recebimento_id='cred_legado'"
        ).fetchone(),(1,))

    def test_n14_fato_bancario_e_atestado_sao_imutaveis(self):
        self.credito_legado();self.atestar()
        for table,stmt in (
            ("recebimentos","UPDATE recebimentos SET valor_recebido_cent=1999 WHERE id='cred_legado'"),
            ("recebimentos","DELETE FROM recebimentos WHERE id='cred_legado'"),
            ("recebimento_conferencias","UPDATE recebimento_conferencias SET resultado='INCONSISTENTE' WHERE id='att_r2'"),
            ("recebimento_conferencias","DELETE FROM recebimento_conferencias WHERE id='att_r2'")
        ):
            with self.subTest(table=table,stmt=stmt),self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(stmt)

    def test_n14_data_de_conferencia_retroativa_rejeitada(self):
        self.credito_legado()
        with self.assertRaises(sqlite3.IntegrityError):
            self.atestar(conferido_em="2010-01-01T00:00:00.000Z")

    def test_n14_saldo_historico_excessivo_sinaliza_inconsistencia(self):
        self.credito_legado(valor=6000)
        with self.assertRaises(sqlite3.IntegrityError):
            self.atestar()
        self.atestar(resultado="INCONSISTENTE")
        self.assertEqual(self.db.execute(
            "SELECT estado_saldo,saldo_cent FROM v_contas_receber_saldos WHERE id='cr1'"
        ).fetchone(),("INCONSISTENTE",None))
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM recebimentos WHERE id='cred_legado'"
        ).fetchone(),(1,))

    def test_n14_credito_em_nf_rascunho_nao_pode_ser_conferido_como_validado(self):
        self.credito_legado()
        self.db.execute("UPDATE notas_fiscais SET situacao='RASCUNHO' WHERE id='nf1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.atestar()
        self.atestar(resultado="INCONSISTENTE")

    def test_n14_conferencia_exige_legado_mas_nao_confere_evento_nativo(self):
        self.insert("recebimentos",id="nativo_r2",empresa_id="e1",
                    conta_receber_id="cr1",tipo_movimento="RECEBIMENTO",
                    data_credito="2026-05-01",valor_recebido_cent=100,
                    retencao_confirmada_cent=0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.atestar(recibo="nativo_r2")

    def test_n14_evidencia_e_responsavel_sao_obrigatorios(self):
        self.credito_legado()
        for field,value in (
            ("evidencia_ref",""),("justificativa",""),("conferido_por","")
        ):
            with self.subTest(field=field),self.assertRaises(sqlite3.IntegrityError):
                self.atestar(id="bad_"+field,**{field:value})

    def test_n14_conferencia_de_outra_empresa_e_rejeitada(self):
        self.credito_legado()
        self.rejects(
            "recebimento_conferencias",id="cross",empresa_id="e2",
            recebimento_id="cred_legado",resultado="VALIDADO",
            justificativa="texto",evidencia_ref="prova",
            conferido_por="ator"
        )

    def test_n14_integridade_referencial_sqlite_apos_importacao(self):
        self.fechar_venda();self.credito_legado();self.atestar()
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(),("ok",))


if __name__=="__main__":
    unittest.main()
