"""R6 — portas de extensao, identidade externa e anexos tipados.
SQLite/Wrangler LOCAL, entradas sinteticas. Nao autentica PNCP, JWT ou API Orbita.
"""
import sqlite3

from test_ddl_v1 import DdlBase


class TestR6Extensibilidade(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def ref(self, id="ref1", empresa_id="e1", provedor="PNCP",
            referencia_externa="12345678901234-1-000001/2026", modo_captura="API"):
        self.insert("licitacao_referencias_externas", id=id, empresa_id=empresa_id,
                    provedor=provedor, referencia_externa=referencia_externa,
                    modo_captura=modo_captura)

    def captura(self, id="cap1", empresa_id="e1", referencia_id="ref1", revisao=1,
                chave_idempotencia=None, payload_bruto_json='{"id":"PNCP-1"}',
                hash_bruto_sha256=None, normalizado_json=None, normalizador_versao=None):
        self.insert("licitacao_capturas_externas", id=id, empresa_id=empresa_id,
                    referencia_id=referencia_id, revisao=revisao,
                    chave_idempotencia=chave_idempotencia or id,
                    payload_bruto_json=payload_bruto_json,
                    hash_bruto_sha256=hash_bruto_sha256 or "a"*64,
                    normalizado_json=normalizado_json,
                    normalizador_versao=normalizador_versao)

    def op(self, id="op_r6", empresa_id="e1", tipo="VINCULAR_REFERENCIA_EXTERNA",
           ator_original="Revisor R6"):
        self.insert("operacoes", id=id, empresa_id=empresa_id, tipo=tipo,
                    estado="REGISTRADA", hash_pedido="pedido-"+id,
                    ator_original=ator_original)

    def link(self, id="ref1", licitacao_id="l1", op_id="op_r6"):
        self.db.execute(
            "UPDATE licitacao_referencias_externas "
            "SET licitacao_id=?,vinculada_por_operacao_id=? WHERE id=?",
            (licitacao_id,op_id,id)
        )

    def doc(self, id="docext", empresa_id="e1", documento_id="d1",
            papel="ESPECIFICACAO_ITEM", licitacao_item_id="li1", **extras):
        self.insert("documento_vinculos_extensao", id=id, empresa_id=empresa_id,
                    documento_id=documento_id, papel=papel,
                    licitacao_item_id=licitacao_item_id, **extras)

    def test_r6_baseline_licitacao_manual_nao_exige_pncp(self):
        self.assertEqual(self.db.execute("SELECT count(*) FROM licitacoes").fetchone(),(2,))
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM licitacao_referencias_externas").fetchone(),(0,))
        self.db.execute("UPDATE licitacoes SET observacoes='Manual' WHERE id='l1'")
        self.assertEqual(self.db.execute("SELECT observacoes FROM licitacoes "
                                         "WHERE id='l1'").fetchone(),("Manual",))

    def test_r6_externa_nao_forca_orbita_em_origem_dado(self):
        self.ref()
        self.assertEqual(self.db.execute("SELECT origem_dado FROM licitacoes "
                     "WHERE id='l1'").fetchone(),( "NATIVO", ))
        self.assertNotIn("origem_dado", {c[1] for c in self.db.execute(
            "PRAGMA table_info(licitacao_referencias_externas)")})

    def test_r6_provedor_diferente_pode_reusar_numero_de_fonte(self):
        self.ref()
        self.ref(id="ref2",provedor="ORBITA")
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM licitacao_referencias_externas").fetchone(),(2,))

    def test_r6_identidade_pncp_duplicada_mesma_empresa_rejeitada(self):
        self.ref()
        with self.assertRaises(sqlite3.IntegrityError):
            self.ref(id="duplicada")

    def test_r6_identidade_mesma_referencia_empresas_diferentes(self):
        self.ref()
        self.ref(id="ref2",empresa_id="e2")
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM licitacao_referencias_externas").fetchone(),(2,))

    def test_r6_provedor_normalizado_e_sem_caracteres_estranhos(self):
        for provedor in ("pncp","PNCP BAD","PNCP/EXTRA","", "P"):
            with self.subTest(provedor=provedor), self.assertRaises(sqlite3.IntegrityError):
                self.ref(provedor=provedor)

    def test_r6_id_externo_nao_aceita_espacos_externos(self):
        for chave in (" 123-1/2026","123-1/2026 ",""):
            with self.subTest(chave=chave), self.assertRaises(sqlite3.IntegrityError):
                self.ref(referencia_externa=chave)

    def test_r6_provedor_ou_referencia_nao_mudam_apos_captura(self):
        self.ref()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE licitacao_referencias_externas "
                            "SET provedor='ORBITA' WHERE id='ref1'")

    def test_r6_licitar_captura_direto_vinculada_rejeitado(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("licitacao_referencias_externas",id="r2",empresa_id="e1",
                        provedor="PNCP",referencia_externa="outra",modo_captura="MANUAL",
                        licitacao_id="l1",vinculada_por_operacao_id="op_ausente")

    def test_r6_referencia_sem_captura_nao_pode_vincular(self):
        self.ref()
        self.op()
        with self.assertRaises(sqlite3.IntegrityError):
            self.link()

    def test_r6_vinculo_requer_operacao_existente_e_ator(self):
        self.ref()
        self.captura()
        with self.assertRaises(sqlite3.IntegrityError):
            self.link()
        self.op(ator_original="")
        with self.assertRaises(sqlite3.IntegrityError):
            self.link()

    def test_r6_operacao_de_tipo_errado_nao_vincula(self):
        self.ref()
        self.captura()
        self.op(tipo="PAGAMENTO")
        with self.assertRaises(sqlite3.IntegrityError):
            self.link()

    def test_r6_operacao_de_outra_empresa_nao_vincula(self):
        self.ref()
        self.captura()
        self.op(id="op2",empresa_id="e2")
        with self.assertRaises(sqlite3.IntegrityError):
            self.link(op_id="op2")

    def test_r6_vinculo_cross_company_fk_rejeitado(self):
        self.ref()
        self.captura()
        self.op()
        with self.assertRaises(sqlite3.IntegrityError):
            self.link(licitacao_id="l2")

    def test_r6_vinculo_manual_revisado_preserva_licitação_interna(self):
        self.ref()
        self.captura()
        self.op()
        self.link()
        self.assertEqual(self.db.execute(
            "SELECT licitacao_id,vinculada_por_operacao_id FROM "
            "licitacao_referencias_externas WHERE id='ref1'").fetchone(),("l1","op_r6"))
        self.assertEqual(self.db.execute(
            "SELECT acao,ator_original,licitacao_id FROM eventos_auditoria "
            "WHERE tipo_entidade='REFERENCIA_EXTERNA'").fetchone(),
            ("VINCULAR_REFERENCIA_EXTERNA","Revisor R6","l1"))
        self.assertEqual(self.db.execute("SELECT id,numero FROM licitacoes "
                                         "WHERE id='l1'").fetchone(),("l1","1"))

    def test_r6_referencia_vinculada_nao_muda_dono(self):
        self.ref()
        self.captura()
        self.op()
        self.link()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE licitacao_referencias_externas "
                            "SET licitacao_id='l2' WHERE id='ref1'")

    def test_r6_referencia_nao_pode_ser_apagada(self):
        self.ref()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM licitacao_referencias_externas WHERE id='ref1'")

    def test_r6_referencia_nao_pode_substituir_por_insert_or_replace(self):
        self.ref()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT OR REPLACE INTO licitacao_referencias_externas "
                            "(id,empresa_id,provedor,referencia_externa,modo_captura) "
                            "VALUES ('outro','e1','PNCP','12345678901234-1-000001/2026','API')")
        self.assertEqual(self.db.execute("SELECT id FROM licitacao_referencias_externas "
                                         "WHERE provedor='PNCP'").fetchone(),("ref1",))

    def test_r6_capturas_tem_revisoes_independentes(self):
        self.ref()
        self.captura()
        self.captura(id="cap2",revisao=2,chave_idempotencia="evento-segundo",
                     payload_bruto_json='{"id":"PNCP-1","novo":true}',
                     normalizado_json='{"numero":"123"}',normalizador_versao="v2")
        self.assertEqual(self.db.execute("SELECT revisao FROM licitacao_capturas_externas "
                                         "ORDER BY revisao").fetchall(),[(1,),(2,)])

    def test_r6_captura_numero_de_revisao_duplicado_rejeitado(self):
        self.ref()
        self.captura()
        with self.assertRaises(sqlite3.IntegrityError):
            self.captura(id="cap2",revisao=1)

    def test_r6_captura_chave_idempotencia_global_por_empresa(self):
        self.ref()
        self.ref(id="ref2",referencia_externa="outra")
        self.captura()
        with self.assertRaises(sqlite3.IntegrityError):
            self.captura(id="cap2",referencia_id="ref2",
                         chave_idempotencia="cap1")

    def test_r6_captura_cross_company_rejeitada(self):
        self.ref()
        with self.assertRaises(sqlite3.IntegrityError):
            self.captura(empresa_id="e2")

    def test_r6_captura_json_invalido_e_hash_invalido_rejeitados(self):
        self.ref()
        with self.assertRaises(sqlite3.DatabaseError):
            self.captura(payload_bruto_json="{erro")
        with self.assertRaises(sqlite3.IntegrityError):
            self.captura(hash_bruto_sha256="xyz")

    def test_r6_normalizado_exige_normalizador_versionado(self):
        self.ref()
        with self.assertRaises(sqlite3.IntegrityError):
            self.captura(normalizado_json='{"item":"x"}')
        with self.assertRaises(sqlite3.IntegrityError):
            self.captura(normalizador_versao="v1")

    def test_r6_captura_imutavel_sem_delete_e_sem_update(self):
        self.ref()
        self.captura()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE licitacao_capturas_externas "
                            "SET payload_bruto_json='{}' WHERE id='cap1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM licitacao_capturas_externas WHERE id='cap1'")

    def test_r6_captura_insert_or_replace_preserva_linha_antiga(self):
        self.ref()
        self.captura()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT OR REPLACE INTO licitacao_capturas_externas "
                            "(id,empresa_id,referencia_id,revisao,chave_idempotencia,"
                            "payload_bruto_json,hash_bruto_sha256) "
                            "VALUES ('cap2','e1','ref1',2,'cap1','{}',?)",("b"*64,))
        self.assertEqual(self.db.execute("SELECT id FROM licitacao_capturas_externas "
                                         "WHERE chave_idempotencia='cap1'").fetchone(),("cap1",))

    def test_r6_extensao_documento_item_ativo_valido(self):
        self.doc()
        self.assertEqual(self.db.execute("SELECT tipo_dono,dono_id FROM "
                  "v_documento_vinculos_tipados WHERE id='docext'").fetchone(),
                  ("LICITACAO_ITEM","li1"))

    def test_r6_extensao_documento_cotacao_ativo_valido(self):
        self.insert("cotacoes_precos",id="cot1",empresa_id="e1",
                    entrada_json='{}',resultado_json='{}')
        self.doc(papel="MEMORIA_CALCULO",licitacao_item_id=None,cotacao_id="cot1")
        self.assertEqual(self.db.execute("SELECT tipo_dono,dono_id FROM "
                    "v_documento_vinculos_tipados WHERE id='docext'").fetchone(),
                    ("COTACAO","cot1"))

    def test_r6_recorrencia_doc_modelo_opcional_sem_titulo_extra(self):
        before=self.db.execute("SELECT count(*) FROM titulos_pagar").fetchone()
        self.doc(papel="CONTRATO_RECORRENCIA",licitacao_item_id=None,recorrencia_id="rec1")
        self.assertEqual(self.db.execute("SELECT count(*) FROM titulos_pagar").fetchone(),before)
        self.assertEqual(self.db.execute("SELECT tipo_dono FROM "
                 "v_documento_vinculos_tipados WHERE id='docext'").fetchone(),("RECORRENCIA",))

    def test_r6_recorrencia_sem_anexo_continua_valida(self):
        self.assertEqual(self.db.execute("SELECT count(*) FROM "
                       "documento_vinculos_extensao").fetchone(),(0,))
        self.assertEqual(self.db.execute("SELECT id FROM recorrencias "
                                         "WHERE id='rec1'").fetchone(),("rec1",))

    def test_r6_papel_pertence_ao_dono_correto(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.doc(papel="BOLETO_MODELO")
        with self.assertRaises(sqlite3.IntegrityError):
            self.doc(papel="EDITAL")
        with self.assertRaises(sqlite3.IntegrityError):
            self.doc(papel="MEMORIA_CALCULO")

    def test_r6_documento_de_outra_empresa_rejeitado(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.doc(documento_id="d2")

    def test_r6_documento_dono_de_outra_empresa_rejeitado(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.doc(licitacao_item_id="li2")

    def test_r6_documento_nao_pode_ter_dois_donos(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.doc(recorrencia_id="rec1")

    def test_r6_documento_papel_ativo_unico_por_dono(self):
        self.doc()
        with self.assertRaises(sqlite3.IntegrityError):
            self.doc(id="outro")
        self.doc(id="papel_distinto",papel="PROPOSTA_ITEM")

    def test_r6_documento_legado_papel_desconhecido_inativo_preservado(self):
        self.doc(papel="ANEXO_DESCONHECIDO",origem_dado="LEGADO",
                 conferencia="PENDENTE",ativo=0)
        self.assertEqual(self.db.execute("SELECT ativo FROM documento_vinculos_extensao "
                                         "WHERE id='docext'").fetchone(),(0,))

    def test_r6_documento_legado_papel_desconhecido_ativo_rejeitado(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.doc(papel="ANEXO_DESCONHECIDO",origem_dado="LEGADO",ativo=1)

    def test_r6_documento_nao_pode_trocar_dono_ou_origem(self):
        self.doc()
        for stmt in ("UPDATE documento_vinculos_extensao SET licitacao_item_id='li2' "
                     "WHERE id='docext'",
                     "UPDATE documento_vinculos_extensao SET origem_dado='LEGADO' "
                     "WHERE id='docext'"):
            with self.subTest(stmt=stmt), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(stmt)

    def test_r6_documento_ativo_sem_operacao_nao_pode_desativar(self):
        self.doc()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_vinculos_extensao SET ativo=0 "
                            "WHERE id='docext'")

    def test_r6_documento_desativar_operacao_auditada_permite_novo_ativo(self):
        self.doc()
        self.op(tipo="DESATIVAR_VINCULO_DOCUMENTO")
        self.db.execute("UPDATE documento_vinculos_extensao "
                        "SET ativo=0,desativada_por_operacao_id='op_r6' WHERE id='docext'")
        self.doc(id="substituto")
        self.assertEqual(self.db.execute("SELECT id,ativo FROM documento_vinculos_extensao "
                          "ORDER BY id").fetchall(),[("docext",0),("substituto",1)])
        self.assertEqual(self.db.execute("SELECT acao,ator_original FROM eventos_auditoria "
                            "WHERE entidade_id_texto='docext'").fetchone(),
                            ("DESATIVAR_VINCULO_DOCUMENTO","Revisor R6"))

    def test_r6_documento_inativo_nao_reativa(self):
        self.doc()
        self.op(tipo="DESATIVAR_VINCULO_DOCUMENTO")
        self.db.execute("UPDATE documento_vinculos_extensao "
                        "SET ativo=0,desativada_por_operacao_id='op_r6' WHERE id='docext'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_vinculos_extensao SET ativo=1 "
                            "WHERE id='docext'")

    def test_r6_documento_no_delete_e_no_replace(self):
        self.doc()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM documento_vinculos_extensao WHERE id='docext'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT OR REPLACE INTO documento_vinculos_extensao "
                            "(id,empresa_id,documento_id,papel,licitacao_item_id) "
                            "VALUES ('novo','e1','d1','ESPECIFICACAO_ITEM','li1')")

    def test_r6_view_unificada_preserva_dono_nucleo(self):
        self.insert("documento_vinculos",id="corelink",empresa_id="e1",
                    documento_id="d1",papel="EDITAL",licitacao_id="l1")
        self.doc()
        got=self.db.execute("SELECT camada,tipo_dono,dono_id FROM "
                            "v_documento_vinculos_tipados WHERE id IN ('corelink','docext') "
                            "ORDER BY id").fetchall()
        self.assertEqual(got,[("NUCLEO","LICITACAO","l1"),
                              ("EXTENSAO","LICITACAO_ITEM","li1")])

    def test_r6_fks_e_integridade_do_esquema(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(),("ok",))
