// Canario de D1 HML somente-leitura, offline; sem Cloudflare remoto.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/hml/d1-readonly-canary.mjs";

const origin = "https://hml.invalid";
const url = origin + "/__hml/d1-auditoria";
const auth = { access: { async getIdentity() { return { email: "tester@example.invalid" }; } } };

function makeFixture(overrides = {}) {
  const used = [];
  const counts = {
    tableCount: 49, e4Table: 1, e4Trigger: 1, fk: [],
    quick: [{ quick_check: "ok" }],
    business: { empresas: 0, usuarios: 0, operacoes: 0 },
    ...overrides
  };
  const DB = {
    prepare(sql) {
      used.push(sql);
      if (!/^(SELECT |PRAGMA (foreign_key_check|quick_check);)/.test(sql)) {
        throw Error("mutation_or_unexpected_statement");
      }
      if (sql.includes("AS n FROM sqlite_master")) {
        const n = sql.includes("r7_e4_tentativas_copia")
          ? counts.e4Table
          : sql.includes("trg_r7_e4_sem_delete")
            ? counts.e4Trigger : counts.tableCount;
        return { async first() { return { n }; } };
      }
      if (sql === "PRAGMA foreign_key_check;") {
        return { async all() { return { success: true, results: counts.fk }; } };
      }
      if (sql === "PRAGMA quick_check;") {
        return { async all() { return { success: true, results: counts.quick }; } };
      }
      if (sql.includes("FROM empresas")) {
        return { async first() { return counts.business; } };
      }
      throw Error("unexpected_sql");
    }
  };
  const env = new Proxy({ DB }, {
    get(target, prop) {
      if (prop !== "DB") throw Error("forbidden_binding_read_" + String(prop));
      return target[prop];
    }
  });
  return { used, env };
}
test("canario D1 HML: so 1 rota GET, Access obrigatorio e defaults 503", async () => {
  const f = makeFixture();
  const r1 = await worker.fetch(new Request(origin + "/api/boletos"), f.env, auth);
  assert.equal(r1.status, 503);
  assert.deepEqual(await r1.json(), { error: "hml_not_ready" });
  const head = await worker.fetch(new Request(origin + "/", { method: "HEAD" }), f.env, auth);
  assert.equal(head.status, 503);
  assert.equal(await head.text(), "");
  const post = await worker.fetch(new Request(url, { method: "POST" }), f.env, auth);
  assert.equal(post.status, 405);
  const spoof = await worker.fetch(new Request(url, {
    headers: { "cf-access-jwt-assertion": "arbitrary", "x-user-email": "tester@example.invalid" }
  }), f.env, {});
  assert.equal(spoof.status, 403);
  const noEmail = await worker.fetch(new Request(url), f.env, {
    access: { async getIdentity() { return {}; } }
  });
  assert.equal(noEmail.status, 403);
  assert.equal(f.used.length, 0);
});
test("canario D1 HML: consulta apenas SELECT/PRAGMA e atesta 0013 sem dados", async () => {
  const f = makeFixture();
  const r = await worker.fetch(new Request(url), f.env, auth);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await r.json(), {
    database: "lunaris-licita-hml", schema: "0013", tables: 49,
    fk: "ok", quick_check: "ok", business_data: "empty", mode: "read_only"
  });
  assert.equal(f.used.length, 6);
  assert.ok(f.used.every(q => /^(SELECT |PRAGMA (foreign_key_check|quick_check);)/.test(q)));
});
test("canario D1 HML: recusa deriva, FK, corrupcao, dados e falta de binding", async () => {
  for (const input of [
    { tableCount: 48 }, { e4Table: 0 }, { e4Trigger: 0 },
    { fk: [{ table: "x", rowid: 1 }] },
    { quick: [{ quick_check: "error" }] },
    { business: { empresas: 1, usuarios: 0, operacoes: 0 } }
  ]) {
    const f = makeFixture(input);
    const r = await worker.fetch(new Request(url), f.env, auth);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: "d1_hml_auditoria_bloqueada" });
  }
  const absent = await worker.fetch(new Request(url), {}, auth);
  assert.equal(absent.status, 503);
});
test("canario HML: configuracao offline nunca recebe ID D1 real nem altera produto", () => {
  const read = x => readFileSync(new URL("../../" + x, import.meta.url), "utf8");
  const canary = JSON.parse(read("tests/wrangler-hml-d1-canary.jsonc"));
  const prod = JSON.parse(read("wrangler.jsonc"));
  assert.equal(canary.name, "lunaris-licita-hml-d1-canary-offline");
  assert.equal(canary.main, "../web/src/hml/d1-readonly-canary.mjs");
  assert.equal(canary.d1_databases[0].database_id, "00000000-0000-4000-8000-000000000000");
  assert.equal(canary.d1_databases[0].database_name, "lunaris-licita-hml");
  assert.equal(canary.workers_dev, false);
  assert.equal(canary.preview_urls, false);
  assert.equal(canary.r2_buckets, undefined);
  assert.equal(prod.name, "lunaris-licita-lab");
  assert.equal(prod.main, "./web/ui/worker/index.mjs");
  assert.equal(prod.assets.directory, "./web/ui/dist/client");
  assert.deepEqual(prod.assets.run_worker_first, ["/api","/api/*","/health"]);
  assert.equal(prod.vars,undefined);
  assert.deepEqual(prod.d1_databases ?? [], []);
});
