"""R7 etapa 3: provas fisicas locais de ACL negativa, sessao e CAS."""
from pathlib import Path
import sqlite3
from test_ddl_v1 import DdlBase

E3 = Path(__file__).resolve().parents[1] / "migrations" / "0012_ddl_v1r_r7_etapa3_iam.sql"


class TestR7IAMLocal(DdlBase):
    def setUp(self):
        super().setUp()
        self.db.executescript(E3.read_text(encoding="utf-8"))
        self.seed()
        for uid, role in (("admin_e3", "ADMIN"), ("op_e3", "OPERADOR")):
            self.insert("usuarios", id=uid,
                        access_issuer="https://e3.cloudflareaccess.com",
                        access_subject=uid, email_normalizado=uid+"@local.invalid")
            self.insert("usuarios_empresas", usuario_id=uid, empresa_id="e1",
                        papel=role)

    def operation(self, oid):
        self.insert("operacoes", id=oid, empresa_id="e1", tipo="E3_TESTE",
                    hash_pedido="h-"+oid, ator_id="admin_e3",
                    estado="CONCLUIDA")

    def test_versao_membership_e_revogacao_com_cas(self):
        row=self.db.execute("SELECT versao,ativo FROM usuarios_empresas "
                            "WHERE usuario_id='op_e3' AND empresa_id='e1'").fetchone()
        self.assertEqual(row,(1,1))
        self.db.execute("UPDATE usuarios_empresas SET ativo=0,versao=versao+1 "
                        "WHERE usuario_id='op_e3' AND empresa_id='e1' "
                        "AND ativo=1 AND versao=1")
        self.assertEqual(self.db.execute("SELECT versao,ativo FROM usuarios_empresas "
                         "WHERE usuario_id='op_e3'").fetchone(),(2,0))
        self.assertEqual(self.db.execute("UPDATE usuarios_empresas SET ativo=0 "
                         "WHERE usuario_id='op_e3' AND versao=1").rowcount,0)

    def test_sessao_revogada_e_imutavel_sem_token_bruto(self):
        self.operation("op_logout")
        self.insert("r7_sessoes_revogadas",token_sha256="a"*64,
                    access_issuer="https://e3.cloudflareaccess.com",
                    access_subject="op_e3",exp_epoch=1899999999,
                    empresa_id="e1",usuario_id="op_e3",operacao_id="op_logout")
        self.assertEqual(self.db.execute("SELECT length(token_sha256) "
                         "FROM r7_sessoes_revogadas").fetchone(),(64,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE r7_sessoes_revogadas SET exp_epoch=1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM r7_sessoes_revogadas")
        self.rejects("r7_sessoes_revogadas",token_sha256="a"*64,
                     access_issuer="x",access_subject="op_e3",exp_epoch=1899999999,
                     empresa_id="e1",usuario_id="op_e3",operacao_id="op_logout")

    def test_acl_admin_pode_negar_outra_entidade_no_mesmo_tenant(self):
        self.operation("op_acl")
        self.insert("r7_acl_bloqueios",id="acl1",empresa_id="e1",
                    usuario_id="op_e3",tipo_entidade="LICITACAO",
                    entidade_id="l1",acao="READ",motivo="Sigilo aprovado",
                    ator_id="admin_e3",operacao_id="op_acl")
        self.assertEqual(self.db.execute("SELECT acao FROM r7_acl_bloqueios "
                         "WHERE usuario_id='op_e3' AND entidade_id='l1'").fetchone(),
                         ("READ",))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE r7_acl_bloqueios SET acao='WRITE'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM r7_acl_bloqueios")

    def test_acl_sem_admin_auto_bloqueio_e_tenant_cruzado_negados(self):
        self.operation("op_acl_bad")
        for case in (
            dict(id="bad1",empresa_id="e1",usuario_id="admin_e3",
                 tipo_entidade="LICITACAO",entidade_id="l1",acao="ALL",
                 ator_id="admin_e3"),
            dict(id="bad2",empresa_id="e2",usuario_id="op_e3",
                 tipo_entidade="LICITACAO",entidade_id="l2",acao="ALL",
                 ator_id="admin_e3"),
            dict(id="bad3",empresa_id="e1",usuario_id="admin_e3",
                 tipo_entidade="LICITACAO",entidade_id="l1",acao="ALL",
                 ator_id="op_e3")
        ):
            self.rejects("r7_acl_bloqueios",**case,motivo="Bloqueio validado",
                         operacao_id="op_acl_bad")

    def test_acl_tipo_e_acao_nao_concedem_permissao(self):
        self.operation("op_acl_type")
        self.rejects("r7_acl_bloqueios",id="acl_role",empresa_id="e1",
                     usuario_id="op_e3",tipo_entidade="LICITACAO",
                     entidade_id="l1",acao="ALLOW",motivo="Nao permitir allow",
                     ator_id="admin_e3",operacao_id="op_acl_type")
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])
