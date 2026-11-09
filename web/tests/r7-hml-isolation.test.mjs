// E5: somente testes locais/offline. Nenhuma credencial, chamada externa ou deploy.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/hml/index.mjs";
import { inspectHmlIsolation, HML_DUMMY_D1_ID, HML_DUMMY_R2_NAME }
  from "../../tools/check-hml-isolation.mjs";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
function fixture() {
  return {
    productionConfig: read("wrangler.jsonc"),
    hmlConfig: read("wrangler.hml.jsonc"),
    hmlCode: read("web/src/hml/index.mjs"),
    ci: read(".github/workflows/quality.yml"),
    gitignore: read(".gitignore")
  };
}
test("HML possui Worker separado da main e recursos estritamente ficticios", () => {
  const x = fixture();
  assert.deepEqual(inspectHmlIsolation(x), { ok: true, issues: [] });
  const prod = JSON.parse(x.productionConfig);
  const hml = JSON.parse(x.hmlConfig);
  assert.equal(prod.name, "lunaris-licita");
  assert.equal(hml.name, "lunaris-licita-hml");
  assert.notEqual(prod.main, hml.main);
  assert.equal(hml.d1_databases[0].database_id, HML_DUMMY_D1_ID);
  assert.equal(hml.r2_buckets[0].bucket_name, HML_DUMMY_R2_NAME);
  assert.equal("routes" in hml, false);
  assert.equal("assets" in hml, false);
  assert.equal("previews" in hml, false);
});
test("HML responde somente 503; nao consulta D1, R2, OAuth ou redes", async () => {
  const forbiddenEnv = new Proxy({}, {
    get() { throw Error("HML nao pode ler bindings"); }
  });
  for (const method of ["GET","HEAD","POST","PUT","DELETE","PATCH"]) {
    const response = await worker.fetch(
      new Request("https://hml.invalid/api/creditos", { method }), forbiddenEnv
    );
    assert.equal(response.status, 503);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    const body = await response.text();
    if (method === "HEAD") assert.equal(body, "");
    else assert.deepEqual(JSON.parse(body), { error: "hml_not_ready" });
  }
});
test("HML bloqueia acidentalmente dados reais, rota publica e habilitacao da API", () => {
  const x = fixture();
  const mutate = fn => {
    const config = JSON.parse(x.hmlConfig);
    fn(config);
    return inspectHmlIsolation({...x, hmlConfig: JSON.stringify(config)});
  };
  for (const change of [
    c => c.name = "lunaris-licita",
    c => c.main = "./web/src/index.js",
    c => c.workers_dev = true,
    c => c.preview_urls = true,
    c => c.routes = [{pattern:"*.example.com/*",zone_name:"example.com"}],
    c => c.d1_databases[0].database_id = "11111111-2222-4333-8444-555555555555",
    c => c.r2_buckets[0].bucket_name = "real-bucket",
    c => c.vars = {R7_RUNTIME_ENABLED:"true"},
    c => c.assets = {directory:"./web/public"}
  ]) assert.equal(mutate(change).ok, false);
  assert.equal(inspectHmlIsolation({...x,
    hmlCode: x.hmlCode + '\nimport {createR7Handler} from "../r7/http.mjs";'
  }).ok, false);
  const p = JSON.parse(x.productionConfig);
  p.d1_databases = [{binding:"DB", database_id:HML_DUMMY_D1_ID}];
  assert.equal(inspectHmlIsolation({...x,
    productionConfig:JSON.stringify(p)
  }).ok,false);
});
