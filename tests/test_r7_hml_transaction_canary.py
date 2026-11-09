"""Prova local integral das duas transacoes sintéticas de rollback.
Nao acessa nenhum Cloudflare remoto.
"""
import sqlite3
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MIGRATIONS=sorted((ROOT/"migrations").glob("[0-9][0-9][0-9][0-9]_*.sql"))
COMPANY="hml_a_test"
COMPANY_B="hml_b_test"
USER="hml_u_test"
TITLE="hml_t_test"
PAYMENT="hml_p_test"
COMPANY_SQL="INSERT INTO empresas (id,nome) VALUES (?,?)"
USER_SQL=("INSERT INTO usuarios (id,access_issuer,access_subject,email_normalizado) "
          "VALUES (?,?,?,?)")
MEMBERSHIP_SQL="INSERT INTO usuarios_empresas (usuario_id,empresa_id,papel) VALUES (?,?,?)"
TITLE_SQL=("INSERT INTO titulos_pagar "
          "(id,empresa_id,tipo,beneficiario,categoria_despesa,"
          "valor_nominal_cent,vencimento,origem_dado,conferencia) "
          "VALUES (?,?,?,?,?,?,?,?,?)")
PAYMENT_SQL=("INSERT INTO titulo_baixas "
             "(id,empresa_id,titulo_id,tipo,data_pagamento,valor_pago_cent,origem_dado,conferencia) "
             "VALUES (?,?,?,?,?,?,?,?)")
class R7RemoteTransactionSyntax(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:")
  self.db.execute("PRAGMA foreign_keys=ON")
  for migration in MIGRATIONS:
   self.db.executescript(migration.read_text(encoding="utf8"))
  self.assertEqual(len(MIGRATIONS),13)
  self.assertEqual(self.db.execute(
   "SELECT count(*) FROM sqlite_master WHERE type='table' "
   "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").fetchone()[0],49)

 def tearDown(self): self.db.close()

 def seed_uncommitted(self):
  db=self.db
  db.execute(COMPANY_SQL,(COMPANY,"HML FICTICIA A"))
  db.execute(COMPANY_SQL,(COMPANY_B,"HML FICTICIA B"))
  db.execute(USER_SQL,(USER,"https://prova-hml.cloudflareaccess.com",
                       "ficticio-"+USER,"ficticio@invalid.example"))
  db.execute(MEMBERSHIP_SQL,(USER,COMPANY,"OPERADOR"))
  db.execute(TITLE_SQL,(TITLE,COMPANY,"DIVERSO","TESTE NAO REAL","HML",123,
                        "2026-12-01","NATIVO","VALIDADO"))
  self.assertEqual(db.execute("SELECT count(*) FROM titulos_pagar WHERE id=?",
                               (TITLE,)).fetchone()[0],1)

 def assert_empty(self):
  for table in ("empresas","usuarios","usuarios_empresas","titulos_pagar",
                "titulo_baixas","operacoes","eventos_auditoria"):
   self.assertEqual(self.db.execute("SELECT COUNT(*) FROM "+table).fetchone()[0],0,
                    f"{table} persisted after rollback")
  self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])

 def test_tenant_fk_cross_company_payment_aborts_full_transaction(self):
  with self.assertRaisesRegex(sqlite3.IntegrityError,"FOREIGN KEY"):
   with self.db:
    self.seed_uncommitted()
    self.db.execute(PAYMENT_SQL,(PAYMENT,COMPANY_B,TITLE,"QUITACAO",
                                  "2026-12-01",123,"NATIVO","VALIDADO"))
  self.assert_empty()

 def test_duplicate_title_aborts_full_transaction(self):
  with self.assertRaisesRegex(sqlite3.IntegrityError, "REPLACE nao pode substituir historico|UNIQUE"):
   with self.db:
    self.seed_uncommitted()
    self.db.execute(TITLE_SQL,(TITLE,COMPANY,"DIVERSO","TESTE NAO REAL","HML",123,
                               "2026-12-01","NATIVO","VALIDADO"))
  self.assert_empty()
if __name__=="__main__": unittest.main()
