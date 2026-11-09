// R7 E5 HML: fail-closed OFFLINE. O config HML versionado NUNCA e publicavel.
// Mantem UUID impossivel e bucket nao provisionado. Nenhum deploy em CI.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const HML_DUMMY_D1_ID = "00000000-0000-4000-8000-000000000000";
export const HML_DUMMY_R2_NAME = "lunaris-licita-hml-r2-not-provisioned";

export function inspectHmlIsolation({ productionConfig, hmlConfig, hmlCode, ci, gitignore }) {
  const issues = [];
  let prod, hml;
  try {
    prod = JSON.parse(productionConfig);
    hml = JSON.parse(hmlConfig);
  } catch {
    return { ok: false, issues: ["invalid_json_config"] };
  }
  if (prod?.name !== "lunaris-licita-lab" ||
      ![
        "./web/src/index.js",
        "./web/ui/worker/index.mjs"
      ].includes(prod?.main) ||
      prod?.workers_dev !== false || prod?.preview_urls !== false ||
      (prod?.d1_databases?.length ?? 0) !== 0 ||
      (prod?.r2_buckets?.length ?? 0) !== 0 ||
      prod?.assets?.binding !== "ASSETS" ||
      (prod?.main === "./web/ui/worker/index.mjs" &&
       (prod?.assets?.directory !== "./web/ui/dist/client" ||
        !Array.isArray(prod?.assets?.run_worker_first) ||
        prod.assets.run_worker_first.join(",") !== "/api,/api/*,/health" ||
        Object.hasOwn(prod,"vars")))) {
    issues.push("production_bootstrap_modified");
  }
  if (hml?.name !== "lunaris-licita-hml" ||
      hml?.name === prod?.name ||
      hml?.main !== "./web/src/hml/index.mjs" ||
      hml?.workers_dev !== false || hml?.preview_urls !== false ||
      hml?.compatibility_date !== prod?.compatibility_date) {
    issues.push("hml_identity_or_endpoint_invalid");
  }
  for (const field of ["routes","route","triggers","assets","services","queues",
                        "vars","env","secrets","unsafe","durable_objects"]) {
    if (Object.hasOwn(hml ?? {}, field)) issues.push("hml_forbidden_" + field);
  }
  if (hml?.d1_databases?.length !== 1 ||
      hml.d1_databases[0]?.binding !== "DB" ||
      hml.d1_databases[0]?.database_name !== "lunaris-licita-hml" ||
      hml.d1_databases[0]?.database_id !== HML_DUMMY_D1_ID) {
    issues.push("hml_d1_not_placeholder");
  }
  if (hml?.r2_buckets?.length !== 1 ||
      hml.r2_buckets[0]?.binding !== "R2" ||
      hml.r2_buckets[0]?.bucket_name !== HML_DUMMY_R2_NAME) {
    issues.push("hml_r2_not_placeholder");
  }
  if (typeof hmlCode !== "string" ||
      !hmlCode.includes('"hml_not_ready"') ||
      !/status:\s*503/.test(hmlCode) ||
      /createR7Handler|from\s*["'][^"']*\/r7\/|\.DB\b|\.R2\b|env\./.test(hmlCode)) {
    issues.push("hml_runtime_not_disabled");
  }
  if (!gitignore.split(/\r?\n/).includes(".wrangler/") ||
      !gitignore.split(/\r?\n/).includes(".env") ||
      !gitignore.split(/\r?\n/).includes(".dev.vars")) {
    issues.push("hml_local_secrets_not_ignored");
  }
  if (!ci.includes("node tools/check-hml-isolation.mjs") ||
      !ci.includes("wrangler deploy --dry-run --config wrangler.hml.jsonc") ||
      /wrangler deploy --config wrangler\.hml\.jsonc/.test(ci)) {
    issues.push("hml_ci_guard_missing_or_unsafe");
  }
  return { ok: issues.length === 0, issues };
}

const mainPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (mainPath && process.argv[1] === mainPath) {
  const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
  const result = inspectHmlIsolation({
    productionConfig: read("wrangler.jsonc"),
    hmlConfig: read("wrangler.hml.jsonc"),
    hmlCode: read("web/src/hml/index.mjs"),
    ci: read(".github/workflows/ci.yml"),
    gitignore: read(".gitignore")
  });
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.ok) process.exitCode = 1;
}
