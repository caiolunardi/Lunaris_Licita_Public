"""Provas adversariais R4 (N07-N11, A04/A10 parcial) — SQLite/D1 somente local.
Nao validam JWT, acesso real a R2/Drive, concorrencia nem autorizacao de migracao.
"""
import sqlite3
import unittest
from test_ddl_v1 import DdlBase


class TestR4PropriedadeEProveniencia(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def local(self, id, empresa, versao, provedor, chave, **extras):
        dados = dict(id=id, empresa_id=empresa, versao_id=versao,
                     provedor=provedor, status="PENDENTE", **extras)
        dados["chave_r2" if provedor == "R2" else "drive_file_id"] = chave
        self.insert("documento_localizacoes", **dados)

    def quitacao(self):
        self.insert("titulo_baixas", id="b_r4", empresa_id="e1", titulo_id="t1",
                    tipo="QUITACAO", data_pagamento="2026-01-31", valor_pago_cent=18000)

    def test_n07_r2_namespace_valido_por_empresa(self):
        self.local("loc_a", "e1", "v1", "R2", "e1/opaco/a")
        self.local("loc_b", "e2", "v2", "R2", "e2/opaco/b")
        self.assertEqual(self.db.execute("SELECT count(*) FROM documento_localizacoes").fetchone(), (2,))

    def test_n07_r2_fora_do_namespace_ou_com_travessia_rejeitado(self):
        chaves = ("opaca", "e2/arquivo", "e1/", " e1/arquivo", "e1//arquivo",
                  "e1/../e2/arquivo", "e1/a/./b", "e1/a/..", r"e1/a\b")
        for chave in chaves:
            with self.subTest(chave=chave), self.assertRaises(sqlite3.IntegrityError):
                self.local("invalida", "e1", "v1", "R2", chave)

    def test_n07_r2_chave_nao_pode_ser_reutilizada(self):
        self.local("loc_a", "e1", "v1", "R2", "e1/objeto")
        with self.assertRaises(sqlite3.IntegrityError):
            self.local("loc_b", "e1", "v1", "R2", "e1/objeto")

    def test_n07_r2_nao_pode_ser_reapontado_para_outra_empresa(self):
        self.local("loc_a", "e1", "v1", "R2", "e1/objeto")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_localizacoes SET chave_r2='e2/objeto' WHERE id='loc_a'")

    def test_n07_drive_id_global_unico_entre_empresas(self):
        self.local("loc_a", "e1", "v1", "DRIVE", "id-real-unico")
        with self.assertRaises(sqlite3.IntegrityError):
            self.local("loc_b", "e2", "v2", "DRIVE", "id-real-unico")

    def test_n07_drive_distintos_em_duas_empresas(self):
        self.local("loc_a", "e1", "v1", "DRIVE", "file-um")
        self.local("loc_b", "e2", "v2", "DRIVE", "file-dois")

    def test_n07_drive_nativo_sem_id_rejeitado(self):
        for chave in ("", "  "):
            with self.subTest(chave=repr(chave)), self.assertRaises(sqlite3.IntegrityError):
                self.local("loc_a", "e1", "v1", "DRIVE", chave)

    def test_n07_drive_legado_sem_id_importa_mas_nao_verifica(self):
        self.local("loc_a", "e1", "v1", "DRIVE", "", origem_dado="LEGADO")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_localizacoes SET status='VERIFICADO', "
                            "hash_verificado=?, tamanho_verificado=10, "
                            "verificado_em='2026-11-07T10:00:00Z' WHERE id='loc_a'", ("a"*64,))
        self.assertEqual(self.db.execute("SELECT status FROM documento_localizacoes "
                                         "WHERE id='loc_a'").fetchone(), ("PENDENTE",))

    def test_n08_boleto_diverso_avulso_sem_filha_nao_muda_empresa(self):
        self.insert("titulos_pagar", id="avulso", empresa_id="e1", tipo="DIVERSO",
                    beneficiario="Aluguel", categoria_despesa="FIXA")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE titulos_pagar SET empresa_id='e2' WHERE id='avulso'")

    def test_n08_fornecedor_sem_dependencias_nao_muda_empresa(self):
        self.insert("fornecedores", id="f_solto", empresa_id="e1", nome="Nao utilizado")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE fornecedores SET empresa_id='e2' WHERE id='f_solto'")

    def test_n08_documento_sem_vinculo_nao_muda_empresa(self):
        self.insert("documentos", id="d_solto", empresa_id="e1", tipo="BOLETO")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documentos SET empresa_id='e2' WHERE id='d_solto'")

    def test_n08_todas_tabelas_com_empresa_possuem_guarda(self):
        for (tabela,) in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'"):
            if tabela.startswith("sqlite_"):
                continue
            colunas = {r[1] for r in self.db.execute(f"PRAGMA table_info({tabela})")}
            if "empresa_id" in colunas:
                with self.subTest(tabela=tabela):
                    trig = self.db.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",
                                           ("trg_r4_" + tabela + "_escopo_proveniencia",)).fetchone()
                    self.assertIsNotNone(trig)
                    self.assertIn("NEW.empresa_id IS NOT OLD.empresa_id", trig[0])

    def test_n10_origem_nativa_nao_pode_virar_legado(self):
        for tabela, id in (("fornecedores", "f1"), ("recorrencias", "rec1"),
                           ("documentos", "d1"), ("titulos_pagar", "t1")):
            with self.subTest(tabela=tabela), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"UPDATE {tabela} SET origem_dado='LEGADO' WHERE id=?", (id,))

    def test_n10_legado_nao_pode_virar_nativo(self):
        self.insert("fornecedores", id="f_antigo", empresa_id="e1", nome="Historico",
                    origem_dado="LEGADO", conferencia="PENDENTE")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE fornecedores SET origem_dado='NATIVO' WHERE id='f_antigo'")

    def test_n10_todas_tabelas_com_origem_possuem_guarda(self):
        for (tabela,) in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'"):
            if tabela.startswith("sqlite_"):
                continue
            colunas = {r[1] for r in self.db.execute(f"PRAGMA table_info({tabela})")}
            if "origem_dado" in colunas:
                with self.subTest(tabela=tabela):
                    trig = self.db.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",
                                           ("trg_r4_" + tabela + "_escopo_proveniencia",)).fetchone()
                    self.assertIsNotNone(trig)
                    self.assertIn("NEW.origem_dado IS NOT OLD.origem_dado", trig[0])

    def test_n09_quitacao_congela_valor_vencimento_competencia_identificacao(self):
        self.quitacao()
        for campo, valor in (("valor_nominal_cent", 19000), ("vencimento", "2026-02-28"),
                             ("competencia", "2026-02"), ("beneficiario", "Outro"),
                             ("categoria_despesa", "OUTRA"), ("descricao_boleto", "Reescrito")):
            with self.subTest(campo=campo), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"UPDATE titulos_pagar SET {campo}=? WHERE id='t1'", (valor,))

    def test_n09_desfazimento_nao_apaga_fato_de_quitacao_anterior(self):
        self.quitacao()
        self.insert("titulo_baixas", id="d_r4", empresa_id="e1", titulo_id="t1",
                    tipo="DESFAZIMENTO", baixa_original_id="b_r4", motivo="Pagamento incorreto")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE titulos_pagar SET competencia='2026-02' WHERE id='t1'")

    def test_n09_legado_pago_nao_pode_virar_nao_pago_ou_alterar_base(self):
        self.insert("titulos_pagar", id="leg_pago", empresa_id="e1", tipo="DIVERSO",
                    beneficiario="Plano", categoria_despesa="SERVICO",
                    origem_dado="LEGADO", pago_legado_status="SIM", conferencia="PENDENTE")
        for statement in ("UPDATE titulos_pagar SET pago_legado_status='NAO' WHERE id='leg_pago'",
                          "UPDATE titulos_pagar SET cancelado=1 WHERE id='leg_pago'",
                          "UPDATE titulos_pagar SET valor_nominal_cent=10000 WHERE id='leg_pago'"):
            with self.subTest(sql=statement), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(statement)

    def test_n09_nao_fabricar_data_ou_valor_pago_legado_desconhecido(self):
        self.insert("titulos_pagar", id="leg_sem", empresa_id="e1", tipo="DIVERSO",
                    origem_dado="LEGADO", conferencia="PENDENTE")
        for campo, val in (("pago_legado_status", "SIM"), ("data_pagamento_legado", "2025-01-01"),
                           ("valor_pago_legado_cent", 200)):
            with self.subTest(campo=campo), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"UPDATE titulos_pagar SET {campo}=? WHERE id='leg_sem'", (val,))

    def test_n09_sem_pagamento_pode_editar_valor_e_observacoes(self):
        self.db.execute("UPDATE titulos_pagar SET valor_nominal_cent=19000, "
                        "vencimento='2026-02-28', observacoes='ajuste' WHERE id='t1'")
        self.assertEqual(self.db.execute("SELECT valor_nominal_cent FROM titulos_pagar "
                                         "WHERE id='t1'").fetchone(), (19000,))

    def test_n09_pago_pode_anotar_sem_reescrever_dados_economicos(self):
        self.quitacao()
        self.db.execute("UPDATE titulos_pagar SET observacoes='conferido' WHERE id='t1'")
        self.assertEqual(self.db.execute("SELECT observacoes FROM titulos_pagar "
                                         "WHERE id='t1'").fetchone(), ("conferido",))

    def test_n11_delete_fisico_de_registros_soltos_bloqueado(self):
        self.insert("fornecedores", id="f_solto", empresa_id="e1", nome="Nao usado")
        self.insert("recorrencias", id="rec_sol", empresa_id="e1", beneficiario="Plano",
                    categoria_despesa="SERV", dia_vencimento=10,
                    primeiro_vencimento="2026-01-10")
        self.insert("titulos_pagar", id="t_solto", empresa_id="e1", tipo="DIVERSO",
                    beneficiario="Plano", categoria_despesa="SERV")
        self.insert("compras", id="co_solto", empresa_id="e1", empenho_id="ep1",
                    fornecedor_id="f1")
        self.insert("documentos", id="d_solto", empresa_id="e1", tipo="BOLETO")
        exemplos = (("fornecedores", "f_solto"), ("recorrencias", "rec_sol"),
                    ("titulos_pagar", "t_solto"), ("compras", "co_solto"),
                    ("documentos", "d_solto"))
        for tabela, id in exemplos:
            with self.subTest(tabela=tabela), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"DELETE FROM {tabela} WHERE id=?", (id,))

    def test_n11_operacao_id_nao_pode_ser_reutilizado_com_outro_hash(self):
        self.insert("operacoes", id="op_r4", empresa_id="e1", tipo="PAGAMENTO",
                    hash_pedido="hash_um", estado="CONCLUIDA")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM operacoes WHERE id='op_r4'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert("operacoes", id="op_r4", empresa_id="e1", tipo="PAGAMENTO",
                        hash_pedido="hash_outro", estado="CONCLUIDA")
        self.assertEqual(self.db.execute("SELECT hash_pedido FROM operacoes WHERE id='op_r4'")
                         .fetchone(), ("hash_um",))

    def test_n11_cancelamento_logico_de_titulo_nao_pago_continua(self):
        self.db.execute("UPDATE titulos_pagar SET cancelado=1, "
                        "motivo_cancelamento='Cancelamento correto' WHERE id='t2'")
        self.assertEqual(self.db.execute("SELECT cancelado FROM titulos_pagar WHERE id='t2'")
                         .fetchone(), (1,))

    def test_n11_insert_or_replace_operacao_concluida_nao_troca_hash(self):
        self.insert("operacoes", id="op_repl", empresa_id="e1",
                    tipo="QUITACAO", hash_pedido="hash_original", estado="CONCLUIDA")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT OR REPLACE INTO operacoes "
                            "(id,empresa_id,tipo,hash_pedido,estado) VALUES "
                            "('op_repl','e1','QUITACAO','hash_falso','CONCLUIDA')")
        self.assertEqual(self.db.execute("SELECT hash_pedido FROM operacoes "
                                         "WHERE id='op_repl'").fetchone(), ("hash_original",))

    def test_n11_insert_or_replace_titulo_pago_nao_muda_origem_ou_competencia(self):
        self.quitacao()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT OR REPLACE INTO titulos_pagar "
                            "(id,empresa_id,tipo,beneficiario,categoria_despesa,"
                            "recorrencia_id,competencia,valor_nominal_cent,origem_dado)"
                            " VALUES ('t1','e1','DIVERSO','Internet','INTERNET',"
                            "'rec1','2026-02',25000,'LEGADO')")
        self.assertEqual(self.db.execute("SELECT origem_dado,competencia FROM "
                                         "titulos_pagar WHERE id='t1'").fetchone(),
                         ("NATIVO","2026-01"))

    def test_n11_insert_or_replace_competencia_com_outro_id_nao_apaga_titulo(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT OR REPLACE INTO titulos_pagar "
                            "(id,empresa_id,tipo,beneficiario,categoria_despesa,"
                            "recorrencia_id,competencia,valor_nominal_cent)"
                            " VALUES ('t_sub','e1','DIVERSO','Internet','INTERNET',"
                            "'rec1','2026-01',20000)")
        self.assertEqual(self.db.execute("SELECT id FROM titulos_pagar "
                                         "WHERE recorrencia_id='rec1' AND competencia='2026-01'")
                         .fetchone(), ("t1",))

    def test_n11_insert_or_replace_parcela_ativa_nao_apaga_parcela_original(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT OR REPLACE INTO contas_receber "
                            "(id,empresa_id,nota_fiscal_id,parcela,valor_bruto_cent) "
                            "VALUES ('cr_sub','e1','nf1',1,9000)")
        self.assertEqual(self.db.execute("SELECT id,valor_bruto_cent FROM contas_receber "
                                         "WHERE nota_fiscal_id='nf1' AND parcela=1")
                         .fetchone(), ("cr1",5000))

    def test_n11_insert_or_replace_drive_nao_apaga_localizacao_antiga(self):
        self.local("loc_keep","e1","v1","DRIVE","arquivo-drive-original")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT OR REPLACE INTO documento_localizacoes "
                            "(id,empresa_id,versao_id,provedor,drive_file_id,status)"
                            " VALUES ('loc_new','e2','v2','DRIVE','arquivo-drive-original','PENDENTE')")
        self.assertEqual(self.db.execute("SELECT id FROM documento_localizacoes "
                                         "WHERE drive_file_id='arquivo-drive-original'").fetchone(),
                         ("loc_keep",))

    def test_n11_insert_or_replace_recebimento_nao_apaga_credito_bancario(self):
        self.insert("recebimentos",id="credito",empresa_id="e1",conta_receber_id="cr1",
                    tipo_movimento="RECEBIMENTO",data_credito="2026-01-15",
                    valor_recebido_cent=1000,retencao_confirmada_cent=0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT OR REPLACE INTO recebimentos "
                            "(id,empresa_id,conta_receber_id,tipo_movimento,data_credito,"
                            "valor_recebido_cent,retencao_confirmada_cent)"
                            " VALUES ('credito','e1','cr1','RECEBIMENTO',"
                            "'2026-01-15',2000,0)")
        self.assertEqual(self.db.execute("SELECT valor_recebido_cent FROM recebimentos "
                                         "WHERE id='credito'").fetchone(), (1000,))

    def test_n11_update_or_replace_natural_nao_apaga_fornecedor(self):
        self.insert("fornecedores",id="f_azul",empresa_id="e1",
                    nome="Azul",nome_normalizado="azul")
        self.insert("fornecedores",id="f_verde",empresa_id="e1",
                    nome="Verde",nome_normalizado="verde")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE OR REPLACE fornecedores SET nome_normalizado='azul' "
                            "WHERE id='f_verde'")
        self.assertEqual(self.db.execute("SELECT count(*) FROM fornecedores "
                                         "WHERE id IN ('f_azul','f_verde')").fetchone(), (2,))

    def test_n11_update_id_de_registro_solto_nao_reatribui_identidade(self):
        self.insert("fornecedores",id="f_tmp",empresa_id="e1",nome="Temporario")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE fornecedores SET id='f_falso' WHERE id='f_tmp'")
        self.assertEqual(self.db.execute("SELECT id FROM fornecedores "
                                         "WHERE id='f_tmp'").fetchone(), ("f_tmp",))

    def test_r4_fk_e_integridade_permanecem_validas(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(), ("ok",))
