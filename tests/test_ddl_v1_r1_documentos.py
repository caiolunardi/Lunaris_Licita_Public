"""Regressoes R1 de seguranca documental. D1/SQLite SOMENTE local.
O atestado de backup neste teste e sintetico: bytes reais so serao comprovados pelo Worker.
"""
import sqlite3
import unittest
from datetime import datetime, timezone, timedelta
from test_ddl_v1 import DdlBase


class TestR1Anexos(DdlBase):
    def setUp(self):
        super().setUp()
        self.seed()

    def bundle(self, tag="x", origem="NATIVO", verified=True, with_drive=True):
        doc, version, r2, drive = (tag+"_doc",tag+"_v",tag+"_r2",tag+"_drive")
        digest = "a"*64
        self.insert("operacoes", id="r5verif_"+tag, empresa_id="e1",
                    tipo="CONFERENCIA_DOCUMENTO", hash_pedido="verificar-"+tag,
                    estado="REGISTRADA", ator_original="revisor sintético R1")
        self.insert("documentos", id=doc, empresa_id="e1", tipo="BOLETO")
        self.insert("documento_versoes", id=version, empresa_id="e1",
                    documento_id=doc, numero_versao=1, sha256=digest,
                    tamanho_bytes=10, estado_integridade="PENDENTE",
                    operacao_id="r5verif_"+tag, origem_dado=origem)
        if verified:
            self.insert("documento_localizacoes", id=r2, empresa_id="e1",
                        versao_id=version, provedor="R2", chave_r2="e1/"+tag+"_object",
                        status="VERIFICADO", tamanho_verificado=10,
                        hash_verificado=digest, verificado_em="2026-11-07T01:00:00Z",
                        origem_dado=origem)
            self.db.execute(
                "UPDATE documento_versoes SET estado_integridade='VERIFICADO', "
                "versao=versao+1 WHERE id=?", (version,))
        else:
            self.insert("documento_localizacoes", id=r2, empresa_id="e1",
                        versao_id=version, provedor="R2", chave_r2="e1/"+tag+"_object",
                        status="PENDENTE", origem_dado=origem)
        if with_drive:
            self.insert("documento_localizacoes", id=drive, empresa_id="e1",
                        versao_id=version, provedor="DRIVE", drive_file_id=tag+"_file",
                        status="VERIFICADO" if verified else "PENDENTE",
                        tamanho_verificado=10 if verified else None,
                        hash_verificado=digest if verified else None,
                        verificado_em="2026-11-07T01:00:00Z" if verified else None,
                        origem_dado=origem)
        return doc,version,r2,drive

    def transfer(self, tag, version, r2, drive, origem="NATIVO"):
        tid=tag+"_t"
        self.insert("documento_transferencias", id=tid, empresa_id="e1",
                    versao_id=version, origem_localizacao_id=r2,
                    destino_provedor="DRIVE", estado="PENDENTE",
                    origem_dado=origem, idempotencia=tag+"_idempotency")
        for step in ("COPIANDO","VALIDANDO"):
            self.db.execute("UPDATE documento_transferencias SET estado=? WHERE id=?", (step,tid))
        return tid

    def overlap(self, tid, drive):
        self.db.execute(
            "UPDATE documento_transferencias SET estado='SOBREPOSICAO_30_DIAS', "
            "destino_localizacao_id=? WHERE id=?", (drive,tid))

    def test_r1_legado_versao_nao_nasce_verificada(self):
        self.insert("documentos",id="hist_doc",empresa_id="e1",tipo="EDITAL")
        self.rejects("documento_versoes",id="hist_v",empresa_id="e1",
                     documento_id="hist_doc",numero_versao=1,origem_dado="LEGADO",
                     estado_integridade="VERIFICADO")
        self.insert("documento_versoes",id="hist_v",empresa_id="e1",
                    documento_id="hist_doc",numero_versao=1,origem_dado="LEGADO",
                    estado_integridade="PENDENTE",estado_legado_original="VERIFICADO")
        self.assertEqual(self.db.execute(
            "SELECT estado_integridade,estado_legado_original FROM documento_versoes WHERE id='hist_v'"
        ).fetchone(), ("PENDENTE","VERIFICADO"))

    def test_r1_localizacao_legada_precisa_conferencia_real(self):
        self.insert("documentos",id="hist",empresa_id="e1",tipo="EDITAL")
        self.insert("documento_versoes",id="histver",empresa_id="e1",
                    documento_id="hist",numero_versao=1,origem_dado="LEGADO",
                    estado_integridade="PENDENTE",sha256="a"*64,tamanho_bytes=10)
        self.rejects("documento_localizacoes",id="histloc",empresa_id="e1",
                     versao_id="histver",provedor="DRIVE",drive_file_id="original",
                     origem_dado="LEGADO",status="VERIFICADO",hash_verificado="a"*64,
                     tamanho_verificado=10,verificado_em="2020-01-01T00:00:00Z")
        self.insert("documento_localizacoes",id="histloc",empresa_id="e1",
                    versao_id="histver",provedor="DRIVE",drive_file_id="original",
                    origem_dado="LEGADO",status="PENDENTE",
                    status_legado_original="VERIFICADO")
        self.assertEqual(self.db.execute(
            "SELECT status,status_legado_original FROM documento_localizacoes WHERE id='histloc'"
        ).fetchone(),("PENDENTE","VERIFICADO"))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE documento_localizacoes SET status_legado_original='AUSENTE' "
                "WHERE id='histloc'"
            )

    def test_r1_legado_transferencia_arquivada_rejeitada_e_original_preservado(self):
        _, v, r2, drive = self.bundle("legacy",origem="LEGADO",verified=False)
        self.rejects("documento_transferencias",id="imp",
                     empresa_id="e1",versao_id=v,
                     origem_localizacao_id=r2,destino_localizacao_id=drive,
                     destino_provedor="DRIVE",idempotencia="imp",
                     origem_dado="LEGADO",estado="ARQUIVADO",
                     verificado_em="2000-01-01T00:00:00Z")
        self.insert("documento_transferencias",id="imp",empresa_id="e1",versao_id=v,
                    origem_localizacao_id=r2,destino_provedor="DRIVE",
                    origem_dado="LEGADO",estado="PENDENTE",idempotencia="imp",
                    estado_legado_original="ARQUIVADO",
                    verificado_legado_original_em="2000-01-01T00:00:00Z")
        self.assertEqual(self.db.execute(
            "SELECT estado,estado_legado_original FROM documento_transferencias WHERE id='imp'"
        ).fetchone(), ("PENDENTE","ARQUIVADO"))

    def test_r1_arquivo_legado_nao_pode_iniciar_direto_na_sobreposicao(self):
        _,v,r2,drive=self.bundle("historical",origem="LEGADO",verified=False)
        self.rejects("documento_transferencias",id="bad",empresa_id="e1",versao_id=v,
                     origem_localizacao_id=r2,destino_localizacao_id=drive,
                     destino_provedor="DRIVE",estado="SOBREPOSICAO_30_DIAS",
                     idempotencia="bad",origem_dado="LEGADO")

    def test_r1_destino_pendente_nao_inicia_sobreposicao(self):
        _,v,r2,drive=self.bundle("pendrive",with_drive=False)
        self.insert("documento_localizacoes",id=drive,empresa_id="e1",
                    versao_id=v,provedor="DRIVE",drive_file_id="penddrive",
                    status="PENDENTE")
        t=self.transfer("pendrive",v,r2,drive)
        with self.assertRaises(sqlite3.IntegrityError):
            self.overlap(t,drive)

    def test_r1_r2_pendente_nao_inicia_sobreposicao(self):
        _,v,r2,drive=self.bundle("pendr2",verified=False)
        t=self.transfer("pendr2",v,r2,drive)
        with self.assertRaises(sqlite3.IntegrityError):
            self.overlap(t,drive)

    def test_r1_relogio_comeca_no_banco_e_nao_em_data_do_cliente(self):
        _,v,r2,drive=self.bundle("clock")
        t=self.transfer("clock",v,r2,drive)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE documento_transferencias SET estado='SOBREPOSICAO_30_DIAS', "
                "destino_localizacao_id=?,verificado_em='2000-01-01T00:00:00Z', "
                "prazo_sobreposicao_em='2000-01-31' WHERE id=?", (drive,t))
        self.overlap(t,drive)
        start,deadline=self.db.execute(
            "SELECT sobreposicao_iniciada_em,prazo_sobreposicao_em "
            "FROM documento_transferencias WHERE id=?", (t,)).fetchone()
        elapsed=abs((datetime.now(timezone.utc)-
                     datetime.fromisoformat(start.replace("Z","+00:00"))).total_seconds())
        self.assertLess(elapsed,10)
        self.assertEqual(
            (datetime.fromisoformat(deadline).date()-
             datetime.fromisoformat(start.replace("Z","+00:00")).date()).days,30)

    def test_r1_prazo_nao_pode_ser_retroativo(self):
        _,v,r2,drive=self.bundle("tamper")
        t=self.transfer("tamper",v,r2,drive)
        self.overlap(t,drive)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_transferencias "
                            "SET sobreposicao_iniciada_em='2000-01-01T00:00:00Z' WHERE id=?",(t,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_transferencias "
                            "SET prazo_sobreposicao_em='2000-01-31' WHERE id=?",(t,))

    def test_r1_arquivamento_imediato_com_backup_sintetico_e_negado(self):
        _,v,r2,drive=self.bundle("early")
        t=self.transfer("early",v,r2,drive);self.overlap(t,drive)
        now=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.db.execute(
            "UPDATE documento_transferencias SET backup_independente_ref='TEST_ONLY', "
            "backup_independente_sha256=?, backup_verificado_em=? WHERE id=?",
            ("a"*64,now,t))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_transferencias SET estado='ARQUIVADO' WHERE id=?",(t,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_localizacoes SET status='EXCLUIDO' WHERE id=?",(r2,))

    def test_r1_backup_atestado_nao_pode_ser_trocado(self):
        _,v,r2,drive=self.bundle("backup")
        t=self.transfer("backup",v,r2,drive);self.overlap(t,drive)
        now=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        # Backup com digest divergente nao e evidencia para a versao.
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE documento_transferencias SET backup_independente_ref='falso', "
                "backup_independente_sha256=?,backup_verificado_em=? WHERE id=?",
                ("b"*64,now,t))
        self.db.execute(
            "UPDATE documento_transferencias SET backup_independente_ref='backup-1', "
            "backup_independente_sha256=?,backup_verificado_em=? WHERE id=?",
            ("a"*64,now,t))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_transferencias "
                            "SET backup_independente_ref='backup-2' WHERE id=?",(t,))

    def test_r1_nao_deletar_qualquer_localizacao(self):
        _,v,r2,drive=self.bundle("nodelete")
        for loc in (r2,drive):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("DELETE FROM documento_localizacoes WHERE id=?",(loc,))
        self.insert("documento_localizacoes",id="pending_file",empresa_id="e1",
                    versao_id=v,provedor="DRIVE",drive_file_id="pending-file",
                    status="PENDENTE")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM documento_localizacoes WHERE id='pending_file'")

    def test_r1_localizacao_verificada_tem_identidade_congelada(self):
        _,v,r2,drive=self.bundle("frozen")
        for statement in (
            "UPDATE documento_localizacoes SET chave_r2='evil' WHERE id=?",
            "UPDATE documento_localizacoes SET provedor='URL_EXTERNA', chave_r2=NULL, url_externa='https://x' WHERE id=?",
            "UPDATE documento_localizacoes SET hash_verificado=? WHERE id=?",
            "UPDATE documento_localizacoes SET empresa_id='e2' WHERE id=?"
        ):
            with self.assertRaises(sqlite3.IntegrityError):
                if statement.count("?")==2:
                    self.db.execute(statement,("b"*64,r2))
                else:
                    self.db.execute(statement,(r2,))
        self.assertEqual(self.db.execute("SELECT status FROM documento_localizacoes WHERE id=?",(r2,)).fetchone(),("VERIFICADO",))

    def test_r1_drive_nao_pode_ser_logicamente_excluido(self):
        _,v,r2,drive=self.bundle("drivekeep")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_localizacoes SET status='EXCLUIDO' WHERE id=?",(drive,))

    def test_r1_nao_excluir_r2_com_destino_drive_valido_sem_transferencia(self):
        _,v,r2,drive=self.bundle("noarchive")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_localizacoes SET status='EXCLUIDO' WHERE id=?",(r2,))

    def test_r1_bloqueio_nao_e_deletavel_nem_reapontavel(self):
        doc,v,r2,drive=self.bundle("legal")
        self.insert("documento_bloqueios",id="block",empresa_id="e1",
                    documento_id=doc,motivo="judicial")
        for query in (
            "DELETE FROM documento_bloqueios WHERE id='block'",
            "UPDATE documento_bloqueios SET motivo='removido' WHERE id='block'",
            "UPDATE documento_bloqueios SET documento_id='d1' WHERE id='block'"
        ):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(query)

    def test_r1_bloqueio_requer_responsavel_na_liberacao(self):
        doc,v,r2,drive=self.bundle("release")
        self.rejects("documento_bloqueios",id="ja_liberado",empresa_id="e1",
                     documento_id=doc,motivo="judicial",
                     liberado_em="2020-01-01T00:00:00Z",liberado_por="falso")
        self.insert("documento_bloqueios",id="legado_liberado_original",
                    empresa_id="e1",documento_id=doc,motivo="judicial",
                    origem_dado="LEGADO",
                    liberado_legado_original_em="2020-01-01T00:00:00Z",
                    liberado_por_original_legado="analista-antigo")
        self.assertIsNone(self.db.execute(
            "SELECT liberado_em FROM documento_bloqueios WHERE id='legado_liberado_original'"
        ).fetchone()[0])
        self.insert("documento_bloqueios",id="block",empresa_id="e1",
                    documento_id=doc,motivo="judicial")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_bloqueios "
                            "SET liberado_em='2026-11-07T00:00:00Z' WHERE id='block'")
        self.db.execute("UPDATE documento_bloqueios "
                        "SET liberado_em='2026-11-07T00:00:00Z', liberado_por='auditor' WHERE id='block'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_bloqueios SET liberado_em=NULL WHERE id='block'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM documento_bloqueios WHERE id='block'")

    def test_r1_bloqueio_ativo_impede_iniciar_janela(self):
        doc,v,r2,drive=self.bundle("blocked")
        t=self.transfer("blocked",v,r2,drive)
        self.insert("documento_bloqueios",id="block",empresa_id="e1",
                    documento_id=doc,motivo="judicial")
        with self.assertRaises(sqlite3.IntegrityError):
            self.overlap(t,drive)

    def test_r1_transferencia_nao_e_deletavel(self):
        _,v,r2,drive=self.bundle("journal")
        t=self.transfer("journal",v,r2,drive)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM documento_transferencias WHERE id=?",(t,))
        for query in (
            "UPDATE documento_transferencias SET empresa_id='e2' WHERE id=?",
            "UPDATE documento_transferencias SET destino_provedor='R2' WHERE id=?",
            "UPDATE documento_transferencias SET origem_dado='LEGADO' WHERE id=?",
            "UPDATE documento_transferencias SET idempotencia='outra' WHERE id=?"
        ):
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(query,(t,))

    def test_r1_perda_da_ultima_copia_marca_versao_inconsistente(self):
        doc,v,r2,drive=self.bundle("lost",with_drive=False)
        self.db.execute("UPDATE documento_localizacoes SET status='AUSENTE' WHERE id=?",(r2,))
        self.assertEqual(self.db.execute(
            "SELECT estado_integridade FROM documento_versoes WHERE id=?",(v,)
        ).fetchone(),("INCONSISTENTE",))
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM eventos_auditoria WHERE entidade_id_texto=? "
            "AND acao='VERIFICAR_ESTADO'",(v,)
        ).fetchone(),(2,))

    def test_r1_localizacao_excluida_nao_reabre_por_update(self):
        _,v,r2,drive=self.bundle("noresurrect")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE documento_localizacoes SET status='EXCLUIDO' WHERE id=?",(r2,))
        # Documento continua íntegro, sem "ressuscitar" uma exclusão não ocorrida.
        self.assertEqual(self.db.execute(
            "SELECT status FROM documento_localizacoes WHERE id=?",(r2,)
        ).fetchone(),("VERIFICADO",))

    def test_r1_mantem_fks_e_integridade_apos_rejeicoes(self):
        _,v,r2,drive=self.bundle("fk")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone(),("ok",))


if __name__=="__main__":
    unittest.main()
