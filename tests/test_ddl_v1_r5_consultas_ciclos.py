"""R5: regressões de consultas financeiras, ciclos, higiene e autoria (D1 local).
Dados sinteticos, nao provam Worker JWT, evidencia R2/Drive ou arquivo real.
"""
import sqlite3
from test_ddl_v1 import DdlBase


class TestR5ConsultasCiclosHigiene(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def estado_titulo(self, id):
        return self.db.execute("SELECT situacao FROM v_titulos_situacao WHERE id=?", (id,)).fetchone()[0]

    def abrir_ciclo(self, id, data, **extras):
        self.insert("licitacao_encerramentos",id=id,empresa_id="e1",licitacao_id="l1",
                    encerrada_em=data,motivo="Finalizado",**extras)

    def operacao(self, id="op_r5", autor="Responsavel verificado"):
        self.insert("operacoes",id=id,empresa_id="e1",tipo="VALIDAR_DOCUMENTO",
                    hash_pedido="hash-"+id,estado="REGISTRADA",ator_original=autor)

    def documento(self, tag, operacao_id=None, sha=True):
        self.insert("documentos",id=tag+"_d",empresa_id="e1",tipo="EDITAL")
        self.insert("documento_versoes",id=tag+"_v",empresa_id="e1",
                    documento_id=tag+"_d",numero_versao=1,estado_integridade="PENDENTE",
                    sha256="a"*64 if sha else None,tamanho_bytes=10,
                    operacao_id=operacao_id)
        self.insert("documento_localizacoes",id=tag+"_loc",empresa_id="e1",
                    versao_id=tag+"_v",provedor="R2",chave_r2="e1/"+tag,
                    status="VERIFICADO",tamanho_verificado=10,
                    hash_verificado="a"*64,verificado_em="2026-11-07T08:00:00Z")

    def test_n12_legado_desconhecido_nao_e_aberto_confiavel(self):
        self.insert("titulos_pagar",id="hist",empresa_id="e1",tipo="DIVERSO",
                    origem_dado="LEGADO",conferencia="PENDENTE",
                    pago_legado_status="DESCONHECIDO")
        self.assertEqual(self.estado_titulo("hist"),"PENDENTE_CONFERENCIA")
        self.assertEqual(self.db.execute("SELECT origem_dado,conferencia,pago_legado_status "
                             "FROM v_titulos_situacao WHERE id='hist'").fetchone(),
                         ("LEGADO","PENDENTE","DESCONHECIDO"))

    def test_n12_legado_inconsistente_nao_e_aberto(self):
        self.insert("titulos_pagar",id="hist",empresa_id="e1",tipo="DIVERSO",
                    origem_dado="LEGADO",conferencia="INCONSISTENTE")
        self.assertEqual(self.estado_titulo("hist"),"INCONSISTENTE")

    def test_n12_alegacao_pago_legado_sem_baixa_preservada(self):
        self.insert("titulos_pagar",id="hist",empresa_id="e1",tipo="DIVERSO",
                    origem_dado="LEGADO",conferencia="PENDENTE",pago_legado_status="SIM")
        self.assertEqual(self.estado_titulo("hist"),"PAGO_LEGADO_SEM_BAIXA")

    def test_n12_pago_legado_desfeito_nao_vira_aberto(self):
        self.insert("titulos_pagar",id="hist",empresa_id="e1",tipo="DIVERSO",
                    origem_dado="LEGADO",conferencia="PENDENTE",pago_legado_status="SIM")
        self.insert("titulo_baixas",id="leg_b",empresa_id="e1",titulo_id="hist",
                    tipo="QUITACAO",origem_dado="LEGADO")
        self.assertEqual(self.estado_titulo("hist"),"PENDENTE_CONFERENCIA")
        self.insert("titulo_baixas",id="leg_d",empresa_id="e1",titulo_id="hist",
                    tipo="DESFAZIMENTO",baixa_original_id="leg_b",
                    origem_dado="LEGADO",motivo="Revisao historica")
        self.assertEqual(self.estado_titulo("hist"),"PAGO_LEGADO_SEM_BAIXA")

    def test_n12_quitacao_legado_pendente_nao_aparece_como_pago(self):
        self.insert("titulo_baixas",id="hist_q",empresa_id="e1",titulo_id="t1",
                    tipo="QUITACAO",origem_dado="LEGADO",conferencia="PENDENTE")
        self.assertEqual(self.estado_titulo("t1"),"PENDENTE_CONFERENCIA")

    def test_n12_quitacao_nativa_e_aberto_positivo(self):
        self.assertEqual(self.estado_titulo("t1"),"ABERTO")
        self.insert("titulo_baixas",id="nat_q",empresa_id="e1",titulo_id="t1",
                    tipo="QUITACAO",data_pagamento="2026-01-31",valor_pago_cent=100)
        self.assertEqual(self.estado_titulo("t1"),"PAGO")

    def test_n13_parcela_cancelada_nao_possui_saldo_confiavel(self):
        self.insert("contas_receber",id="cancel_hist",empresa_id="e1",nota_fiscal_id="nf1",
                    parcela=1,valor_bruto_cent=10000,cancelada=1,
                    origem_dado="LEGADO",conferencia="PENDENTE")
        self.assertEqual(self.db.execute("SELECT cancelada,estado_saldo,saldo_cent "
                     "FROM v_contas_receber_saldos WHERE id='cancel_hist'").fetchone(),
                     (1,"CANCELADA",None))

    def test_n13_parcela_ativa_mantem_saldo(self):
        self.assertEqual(self.db.execute("SELECT cancelada,estado_saldo,saldo_cent "
                 "FROM v_contas_receber_saldos WHERE id='cr1'").fetchone(),
                 (0,"CONFERIDO",5000))

    def test_n16_ciclo_anterior_a_reabertura_rejeitado(self):
        self.abrir_ciclo("ce1","2025-01-01T00:00:00Z")
        self.db.execute("UPDATE licitacao_encerramentos SET "
                 "reaberta_em='2026-10-01T00:00:00Z',"
                 "reaberta_por='responsavel',motivo_reabertura='Reabrir' WHERE id='ce1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.abrir_ciclo("ce2","2023-01-01T00:00:00Z")
        self.assertEqual(self.db.execute("SELECT encerrada_em FROM licitacoes "
                                "WHERE id='l1'").fetchone(),(None,))

    def test_n16_ciclo_valido_apos_reabertura(self):
        self.abrir_ciclo("ce1","2025-01-01T00:00:00Z")
        self.db.execute("UPDATE licitacao_encerramentos SET "
                        "reaberta_em='2026-10-01T00:00:00Z',"
                        "reaberta_por='responsavel',motivo_reabertura='Corrigir' WHERE id='ce1'")
        self.abrir_ciclo("ce2","2026-10-03T12:00:00Z")
        self.assertEqual(self.db.execute("SELECT encerrada_em FROM licitacoes "
                                "WHERE id='l1'").fetchone(),("2026-10-03T12:00:00Z",))

    def test_n16_instante_invalido_ou_fantasia_rejeitado(self):
        for raw in ("ontem à tarde","2026-02-31T12:00:00Z","2026-11-07T25:00:00Z",
                    "2026-01-01","2026-11-07T12:61:00Z","2026-11-07T12:00:60Z"):
            with self.subTest(instante=raw), self.assertRaises(sqlite3.IntegrityError):
                self.abrir_ciclo("cyc","2026-11-07T12:00:00Z" if raw=="" else raw)

    def test_n16_utc_milisegundos_validos_e_ordenacao_correta(self):
        self.abrir_ciclo("ce1","2026-01-01T10:00:00Z")
        self.db.execute("UPDATE licitacao_encerramentos SET "
                        "reaberta_em='2026-01-01T10:00:00.500Z',"
                        "reaberta_por='operador',motivo_reabertura='Retrabalho' WHERE id='ce1'")
        # Mesmo segundo sem milissegundos representa instante ANTERIOR à reabertura.
        with self.assertRaises(sqlite3.IntegrityError):
            self.abrir_ciclo("ce2","2026-01-01T10:00:00Z")
        self.abrir_ciclo("ce2","2026-01-01T10:00:00.501Z")
        self.assertEqual(self.db.execute("SELECT encerrada_em FROM licitacoes "
                              "WHERE id='l1'").fetchone(),("2026-01-01T10:00:00.501Z",))

    def test_n16_reabrir_no_mesmo_instante_rejeitado(self):
        self.abrir_ciclo("ce1","2026-01-01T10:00:00Z")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE licitacao_encerramentos SET "
                "reaberta_em='2026-01-01T10:00:00Z',"
                "reaberta_por='operador',motivo_reabertura='Revisar' WHERE id='ce1'")

    def test_n16_reabertura_sem_motivo_e_autor_rejeitada(self):
        self.abrir_ciclo("ce1","2026-01-01T10:00:00Z")
        for por,motivo in (("","Revisar"),("operador","   ")):
            with self.subTest(por=por,motivo=motivo), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("UPDATE licitacao_encerramentos SET "
                                "reaberta_em='2026-02-01T00:00:00Z',"
                                "reaberta_por=?,motivo_reabertura=? WHERE id='ce1'",(por,motivo))

    def test_n17_duas_quitacoes_ativas_legado_rejeitadas(self):
        self.insert("titulo_baixas",id="l1",empresa_id="e1",titulo_id="t1",
                    tipo="QUITACAO",origem_dado="LEGADO")
        self.rejects("titulo_baixas",id="l2",empresa_id="e1",titulo_id="t1",
                     tipo="QUITACAO",origem_dado="LEGADO")

    def test_n17_legado_depois_de_nativa_ativa_rejeitado(self):
        self.insert("titulo_baixas",id="n1",empresa_id="e1",titulo_id="t1",
                    tipo="QUITACAO",data_pagamento="2026-01-31",valor_pago_cent=18000)
        self.rejects("titulo_baixas",id="l1",empresa_id="e1",titulo_id="t1",
                     tipo="QUITACAO",origem_dado="LEGADO")

    def test_n17_desfazimento_permite_nova_quitacao_legitima(self):
        self.insert("titulo_baixas",id="q1",empresa_id="e1",titulo_id="t1",
                    tipo="QUITACAO",data_pagamento="2026-01-31",valor_pago_cent=18000)
        self.insert("titulo_baixas",id="d1",empresa_id="e1",titulo_id="t1",
                    tipo="DESFAZIMENTO",baixa_original_id="q1",motivo="Duplicidade")
        self.insert("titulo_baixas",id="q2",empresa_id="e1",titulo_id="t1",
                    tipo="QUITACAO",data_pagamento="2026-01-31",valor_pago_cent=18000)
        self.assertEqual(self.estado_titulo("t1"),"PAGO")

    def test_n17_desfazimento_nativo_sem_motivo_rejeitado(self):
        self.insert("titulo_baixas",id="q1",empresa_id="e1",titulo_id="t1",
                    tipo="QUITACAO",data_pagamento="2026-01-31",valor_pago_cent=100)
        self.rejects("titulo_baixas",id="d1",empresa_id="e1",titulo_id="t1",
                     tipo="DESFAZIMENTO",baixa_original_id="q1",motivo=" ")

    def test_n18_fornecedor_nativo_nao_aceita_beneficiario_ou_categoria(self):
        self.rejects("titulos_pagar",id="err",empresa_id="e1",tipo="FORNECEDOR",
                     fornecedor_id="f1",beneficiario="Fornecedor",categoria_despesa="INTERNET")
        self.insert("titulos_pagar",id="ok",empresa_id="e1",tipo="FORNECEDOR",fornecedor_id="f1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE titulos_pagar SET beneficiario='Alguem' WHERE id='ok'")

    def test_n18_fornecedor_historico_incompleto_preservado_pendente(self):
        self.insert("titulos_pagar",id="hist",empresa_id="e1",tipo="FORNECEDOR",
                    origem_dado="LEGADO",conferencia="PENDENTE",
                    beneficiario="Valor antigo",categoria_despesa="DESPESA")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE titulos_pagar SET conferencia='VALIDADO' WHERE id='hist'")

    def test_n18_cancelamento_titulo_nativo_exige_motivo(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE titulos_pagar SET cancelado=1 WHERE id='t1'")
        self.db.execute("UPDATE titulos_pagar SET cancelado=1,"
                        "motivo_cancelamento='Solicitacao cancelada' WHERE id='t1'")
        self.assertEqual(self.estado_titulo("t1"),"CANCELADO")

    def test_n18_cancelamento_legado_pendente_sem_motivo_quarentena(self):
        self.insert("titulos_pagar",id="hist",empresa_id="e1",tipo="DIVERSO",
                    origem_dado="LEGADO",conferencia="PENDENTE",cancelado=1)
        self.assertEqual(self.estado_titulo("hist"),"CANCELADO")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE titulos_pagar SET conferencia='VALIDADO' WHERE id='hist'")

    def test_n18_titulo_cancelado_nao_reativa_silenciosamente(self):
        self.db.execute("UPDATE titulos_pagar SET cancelado=1,"
                        "motivo_cancelamento='Duplicado' WHERE id='t1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE titulos_pagar SET cancelado=0 WHERE id='t1'")

    def test_n18_parcela_cancelada_nativa_exige_motivo(self):
        self.rejects("contas_receber",id="bad",empresa_id="e1",
                     nota_fiscal_id="nf1",parcela=2,valor_bruto_cent=100,cancelada=1)
        self.insert("contas_receber",id="ok",empresa_id="e1",nota_fiscal_id="nf1",
                    parcela=2,valor_bruto_cent=100,cancelada=1,motivo_cancelamento="Revisao")
        self.assertEqual(self.db.execute("SELECT cancelada FROM contas_receber "
                                         "WHERE id='ok'").fetchone(),(1,))

    def test_n18_parcela_cancelada_nao_reativa_silenciosamente(self):
        self.insert("contas_receber",id="sub",empresa_id="e1",
                    nota_fiscal_id="nf1",parcela=1,valor_bruto_cent=200,
                    cancelada=1,motivo_cancelamento="Substituida")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE contas_receber SET cancelada=0 WHERE id='sub'")

    def test_n19_verificacao_sem_operacao_atribui_falha(self):
        self.documento("missing")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_versoes SET "
                            "estado_integridade='VERIFICADO' WHERE id='missing_v'")

    def test_n19_verificacao_com_ator_registra_evidencia(self):
        self.operacao()
        self.documento("ok",operacao_id="op_r5")
        self.db.execute("UPDATE documento_versoes SET "
                        "estado_integridade='VERIFICADO', versao=versao+1 WHERE id='ok_v'")
        got=self.db.execute("SELECT ator_original,operacao_id,acao FROM eventos_auditoria "
                    "WHERE entidade_id_texto='ok_v'").fetchone()
        self.assertEqual(got,("Responsavel verificado","op_r5","VERIFICAR_ESTADO"))

    def test_n19_perda_de_ultima_copia_degrada_versao_com_autoria_automatica(self):
        self.operacao()
        self.documento("perde",operacao_id="op_r5")
        self.db.execute("UPDATE documento_versoes SET "
                        "estado_integridade='VERIFICADO', versao=versao+1 WHERE id='perde_v'")
        self.db.execute("UPDATE documento_localizacoes SET status='AUSENTE' WHERE id='perde_loc'")
        self.assertEqual(self.db.execute("SELECT estado_integridade FROM documento_versoes "
                             "WHERE id='perde_v'").fetchone(),("INCONSISTENTE",))
        self.assertEqual(self.db.execute("SELECT count(*) FROM eventos_auditoria "
                             "WHERE entidade_id_texto='perde_v'").fetchone(),(2,))
        self.assertEqual(self.db.execute(
           "SELECT ator_id,ator_original,operacao_id FROM eventos_auditoria "
           "WHERE entidade_id_texto='perde_v' AND resumo='VERIFICADO->INCONSISTENTE'"
        ).fetchone(),(None,"SISTEMA_D1_PERDA_DE_COPIA",None))

    def test_n19_versao_sem_hash_nao_pode_ser_verificada(self):
        self.operacao()
        self.documento("semhash",operacao_id="op_r5",sha=False)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_versoes SET "
                            "estado_integridade='VERIFICADO' WHERE id='semhash_v'")

    def test_r5_integridade_final(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(),("ok",))
