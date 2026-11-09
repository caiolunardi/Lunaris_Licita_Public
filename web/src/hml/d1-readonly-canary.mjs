// E5: prova TEMPORARIA somente-leitura do D1 HML; nunca habilita API R7.
// Destino EXCLUSIVO: Worker lunaris-licita-hml com Access All traffic ativo.
// Ao terminar a comprovacao, restaurar web/src/hml/index.mjs (503 em tudo).
const AUDIT_PATH = "/__hml/d1-auditoria";
const HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, private",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
});
const TABLE_COUNT =
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' " +
  "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';";
const E4_TABLE =
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' " +
  "AND name='r7_e4_tentativas_copia';";
const E4_TRIGGER =
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' " +
  "AND name='trg_r7_e4_sem_delete';";
const BUSINESS_COUNTS =
  "SELECT (SELECT COUNT(*) FROM empresas) AS empresas, " +
  "(SELECT COUNT(*) FROM usuarios) AS usuarios, " +
  "(SELECT COUNT(*) FROM operacoes) AS operacoes;";

function reply(status, body, head = false) {
  return new Response(head ? null : JSON.stringify(body), {
    status, headers: HEADERS
  });
}
async function exactlyOne(db, sql) {
  const row = await db.prepare(sql).first();
  if (!row || !Number.isInteger(row.n)) throw Error("unexpected_count");
  return row.n;
}
async function checkReadOnly(db) {
  if (!db || typeof db.prepare !== "function") throw Error("no_db_binding");
  if (await exactlyOne(db, TABLE_COUNT) !== 49) throw Error("wrong_table_count");
  if (await exactlyOne(db, E4_TABLE) !== 1) throw Error("missing_migration_0013");
  if (await exactlyOne(db, E4_TRIGGER) !== 1) throw Error("missing_e4_guard");

  const fk = await db.prepare("PRAGMA foreign_key_check;").all();
  if (fk?.success === false || !Array.isArray(fk?.results) || fk.results.length !== 0) {
    throw Error("foreign_key_check_failed");
  }
  const quick = await db.prepare("PRAGMA quick_check;").all();
  if (quick?.success === false || !Array.isArray(quick?.results) ||
      quick.results.length !== 1 || quick.results[0]?.quick_check !== "ok") {
    throw Error("quick_check_failed");
  }
  const business = await db.prepare(BUSINESS_COUNTS).first();
  if (!business || !["empresas", "usuarios", "operacoes"].every(
    key => Number.isInteger(business[key]) && business[key] === 0
  )) throw Error("nonempty_or_invalid_business_count");

  return Object.freeze({
    database: "lunaris-licita-hml",
    schema: "0013",
    tables: 49,
    fk: "ok",
    quick_check: "ok",
    business_data: "empty",
    mode: "read_only"
  });
}
export default {
  async fetch(request, env, ctx) {
    let path;
    try { path = new URL(request.url).pathname; }
    catch { return reply(503, { error: "hml_not_ready" }); }
    if (path !== AUDIT_PATH) {
      return reply(503, { error: "hml_not_ready" }, request.method === "HEAD");
    }
    if (request.method !== "GET") {
      return reply(405, { error: "method_not_allowed" });
    }

    // ctx.access e verificado pelo proprio Cloudflare Access. Nunca confiar
    // em email, cookies ou headers enviados diretamente pelo cliente.
    if (!ctx?.access || typeof ctx.access.getIdentity !== "function") {
      return reply(403, { error: "access_required" });
    }
    let identity;
    try { identity = await ctx.access.getIdentity(); }
    catch { return reply(403, { error: "access_required" }); }
    if (typeof identity?.email !== "string" || !identity.email.includes("@")) {
      return reply(403, { error: "access_required" });
    }

    // Sem SQL dinamico, INSERT, UPDATE, DELETE, R2, Drive, rede ou dados reais.
    try {
      return reply(200, await checkReadOnly(env?.DB));
    } catch {
      // Nao expor nomes internos, resultados parciais ou detalhes do banco.
      return reply(503, { error: "d1_hml_auditoria_bloqueada" });
    }
  }
};
