import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import app from "../src/index.js";

const env = { ASSETS: { fetch: async () => new Response("página", { headers: { "content-type": "text/plain" } }) } };
const call = (path, method = "GET", bindings = env) => app.fetch(new Request("https://licita.lunaris.dev.br" + path, { method }), bindings);
test("health não declara banco conectado", async () => {
  const r = await call("/health");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "ok", phase: "bootstrap", data: "not_connected" });
});
test("nenhuma API de negócio fica operacional", async () => {
  for (const p of ["/api", "/api/boletos", "/api/licitacoes"]) assert.equal((await call(p)).status, 404);
  assert.equal((await call("/", "POST")).status, 405);
});
test("assets recebem proteção e ausência de binding falha de modo fechado", async () => {
  const r = await call("/");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal((await call("/", "GET", {})).status, 503);
});
test("deploy mantém workers.dev e preview desativados, sem banco", () => {
  const cfg = JSON.parse(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(cfg.name, "lunaris-licita-lab");
  assert.equal(cfg.workers_dev, false);
  assert.equal(cfg.preview_urls, false);
  assert.deepEqual(cfg.assets.run_worker_first, ["/api","/api/*","/health"]);
  assert.equal(cfg.main,"./web/ui/worker/index.mjs");
  assert.equal(cfg.assets.directory,"./web/ui/dist/client");
  assert.equal(cfg.vars,undefined);
  assert.equal(cfg.d1_databases, undefined);
  assert.equal(cfg.r2_buckets, undefined);
});
