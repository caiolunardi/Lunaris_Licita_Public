"""Ensaio LOCAL de primitivas relacionais para o modelo V1.
NÃO é o DDL final, não toca D1/Cloudflare e não demonstra os 58 casos do contrato.
Executar: python3 -m unittest tests/test_modelo_sqlite_v1.py
"""
import sqlite3
import unittest

DDL = """
CREATE TABLE licitacoes (
  id TEXT PRIMARY KEY,
  empresa_id TEXT NOT NULL,
  UNIQUE(id, empresa_id)
);
CREATE TABLE licitacao_itens (
  id TEXT PRIMARY KEY,
  licitacao_id TEXT NOT NULL,
  empresa_id TEXT NOT NULL,
  UNIQUE(id, licitacao_id, empresa_id),
  FOREIGN KEY (licitacao_id, empresa_id) REFERENCES licitacoes(id, empresa_id)
);
CREATE TABLE empenhos (
  id TEXT PRIMARY KEY,
  licitacao_id TEXT NOT NULL,
  empresa_id TEXT NOT NULL,
  UNIQUE(id, licitacao_id, empresa_id),
  FOREIGN KEY (licitacao_id, empresa_id) REFERENCES licitacoes(id, empresa_id)
);
CREATE TABLE empenho_itens (
  id TEXT PRIMARY KEY,
  empenho_id TEXT NOT NULL,
  licitacao_item_id TEXT NOT NULL,
  licitacao_id_escopo TEXT NOT NULL,
  empresa_id TEXT NOT NULL,
  FOREIGN KEY (empenho_id, licitacao_id_escopo, empresa_id)
    REFERENCES empenhos(id, licitacao_id, empresa_id),
  FOREIGN KEY (licitacao_item_id, licitacao_id_escopo, empresa_id)
    REFERENCES licitacao_itens(id, licitacao_id, empresa_id)
);
CREATE TABLE recorrencias (id TEXT PRIMARY KEY);
CREATE TABLE titulos_pagar (
  id TEXT PRIMARY KEY,
  recorrencia_id TEXT,
  competencia TEXT,
  FOREIGN KEY (recorrencia_id) REFERENCES recorrencias(id),
  CHECK ((recorrencia_id IS NULL AND competencia IS NULL) OR
         (recorrencia_id IS NOT NULL AND competencia IS NOT NULL))
);
CREATE UNIQUE INDEX uq_competencia
  ON titulos_pagar(recorrencia_id, competencia)
  WHERE recorrencia_id IS NOT NULL;
CREATE TABLE contas_receber (id TEXT PRIMARY KEY);
CREATE TABLE recebimentos (
 id TEXT PRIMARY KEY,
 conta_receber_id TEXT NOT NULL,
 tipo TEXT NOT NULL CHECK (tipo IN ('RECEBIMENTO','ESTORNO')),
 estorno_de_id TEXT,
 UNIQUE (id, conta_receber_id),
 FOREIGN KEY (conta_receber_id) REFERENCES contas_receber(id),
 FOREIGN KEY (estorno_de_id, conta_receber_id)
   REFERENCES recebimentos(id, conta_receber_id)
);
CREATE UNIQUE INDEX uq_estorno
  ON recebimentos(estorno_de_id) WHERE estorno_de_id IS NOT NULL;
CREATE TABLE documentos (id TEXT PRIMARY KEY);
CREATE TABLE documento_vinculos_exemplo (
 id TEXT PRIMARY KEY,
 documento_id TEXT NOT NULL REFERENCES documentos(id),
 licitacao_id TEXT REFERENCES licitacoes(id),
 titulo_pagar_id TEXT REFERENCES titulos_pagar(id),
 CHECK ((licitacao_id IS NOT NULL) + (titulo_pagar_id IS NOT NULL) = 1)
);
"""


class SqliteRelationalSpike(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(DDL)
        self.db.executemany("INSERT INTO licitacoes VALUES (?, ?)", [
            ("l1", "empresa-a"), ("l2", "empresa-a"), ("l3", "empresa-b")
        ])
        self.db.executemany("INSERT INTO licitacao_itens VALUES (?, ?, ?)", [
            ("i1", "l1", "empresa-a"), ("i2", "l2", "empresa-a"),
            ("i3", "l3", "empresa-b")
        ])
        self.db.execute("INSERT INTO empenhos VALUES ('e1','l1','empresa-a')")
        self.db.execute("INSERT INTO empenho_itens VALUES ('ei1','e1','i1','l1','empresa-a')")
        self.db.execute("INSERT INTO recorrencias VALUES ('r1')")
        self.db.execute("INSERT INTO titulos_pagar VALUES ('t1','r1','2026-11')")
        self.db.executemany("INSERT INTO contas_receber VALUES (?)", [("a1",), ("a2",)])
        self.db.execute("INSERT INTO recebimentos VALUES ('rcr1','a1','RECEBIMENTO',NULL)")
        self.db.execute("INSERT INTO recebimentos VALUES ('rcr2','a1','RECEBIMENTO',NULL)")
        self.db.execute("INSERT INTO recebimentos VALUES ('est1','a1','ESTORNO','rcr1')")
        self.db.execute("INSERT INTO documentos VALUES ('doc1')")
        self.db.execute("INSERT INTO documento_vinculos_exemplo VALUES ('v1','doc1','l1',NULL)")

    def tearDown(self):
        self.db.close()

    def rejects(self, sql):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(sql)

    def test_fk_mesma_licitacao(self):
        self.rejects("INSERT INTO empenho_itens VALUES ('x','e1','i2','l1','empresa-a')")

    def test_fk_escopo_empresa(self):
        self.rejects("INSERT INTO empenho_itens VALUES ('x','e1','i3','l3','empresa-b')")

    def test_competencia_recorrente_unica(self):
        self.rejects("INSERT INTO titulos_pagar VALUES ('t2','r1','2026-11')")

    def test_recorrencia_e_mes_indivisiveis(self):
        self.rejects("INSERT INTO titulos_pagar VALUES ('t2','r1',NULL)")

    def test_estorno_mesma_parcela(self):
        self.rejects("INSERT INTO recebimentos VALUES ('est2','a2','ESTORNO','rcr2')")

    def test_estorno_unico(self):
        self.rejects("INSERT INTO recebimentos VALUES ('est2','a1','ESTORNO','rcr1')")

    def test_documento_com_um_dono(self):
        self.rejects("INSERT INTO documento_vinculos_exemplo VALUES ('v2','doc1',NULL,NULL)")
        self.rejects("INSERT INTO documento_vinculos_exemplo VALUES ('v3','doc1','l1','t1')")

    def test_integridade_global(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(self.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")


if __name__ == "__main__":
    unittest.main()
