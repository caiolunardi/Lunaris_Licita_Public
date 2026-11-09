"""R7 E4: ledger documental local fail-closed, sem provedores reais."""
from pathlib import Path
import sqlite3
from test_ddl_v1 import DdlBase

E3=Path(__file__).resolve().parents[1]/"migrations"/"0012_ddl_v1r_r7_etapa3_iam.sql"
E4=Path(__file__).resolve().parents[1]/"migrations"/"0013_ddl_v1r_r7_etapa4_backup_ledger.sql"

class TestE4Ledger(DdlBase):
    def setUp(self):
        super().setUp()
        self.db.executescript(E3.read_text(encoding="utf-8"))
        self.db.executescript(E4.read_text(encoding="utf-8"))
        self.seed()
        self.insert("usuarios",id="audE4",access_issuer="https://local.example",
                    access_subject="aud-e4",email_normalizado="aud@local.invalid")
        self.insert("r7_e4_tentativas_copia",id="E4-1",empresa_id="e1",
                    documento_id="d1",versao_id="v1",ator_id="audE4",estado="RESERVADA")

    def test_reserva_gera_evento_sem_arquivo_externo(self):
        row=self.db.execute("SELECT estado,destino_id FROM r7_e4_tentativas_copia "
                            "WHERE id='E4-1'").fetchone()
        self.assertEqual(row,("RESERVADA",None))
        audit=self.db.execute("SELECT acao FROM eventos_auditoria "
                              "WHERE entidade_id_texto='v1' AND acao='RESERVAR_COPIA'").fetchone()
        self.assertEqual(audit,("RESERVAR_COPIA",))

    def test_falso_sucesso_sem_transferencia_e_bloqueado(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE r7_e4_tentativas_copia SET estado='VERIFICADA',"
                            "destino_id='fake',confirmado_em='2030-01-01T00:00:00.000Z' "
                            "WHERE id='E4-1'")
        self.assertEqual(self.db.execute("SELECT estado FROM r7_e4_tentativas_copia "
                         "WHERE id='E4-1'").fetchone(),("RESERVADA",))

    def test_incerteza_auditada_nao_regride_automaticamente(self):
        self.db.execute("UPDATE r7_e4_tentativas_copia SET estado='INCERTA',"
                        "motivo='timeout' WHERE id='E4-1'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE r7_e4_tentativas_copia SET estado='RESERVADA' "
                            "WHERE id='E4-1'")
        self.assertEqual(self.db.execute("SELECT estado FROM r7_e4_tentativas_copia "
                         "WHERE id='E4-1'").fetchone(),("INCERTA",))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM eventos_auditoria "
                         "WHERE entidade_id_texto='v1' AND acao='COPIA_INCERTA'").fetchone(),(1,))

    def test_um_solicitante_por_versao_e_sem_delete(self):
        self.rejects("r7_e4_tentativas_copia",id="E4-2",empresa_id="e1",
                     documento_id="d1",versao_id="v1",ator_id="audE4",estado="RESERVADA")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM r7_e4_tentativas_copia WHERE id='E4-1'")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
