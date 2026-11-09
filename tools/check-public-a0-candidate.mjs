// Public laboratory guard for the A0 synthetic candidates. No network or credentials.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = path => readFileSync(path, "utf8");
const parse = path => JSON.parse(read(path));
const ZERO = "00000000-0000-4000-8000-000000000000";
const forbidden = ["routes","route","custom_domains","vars","env","r2_buckets",
  "durable_objects","services","queues","account_id","zone_id","secrets"];
const configs = [
  ["tests/wrangler-a1-hml-dryrun.jsonc","lunaris-licita-public-a1-dryrun-never-deploy",
    "../web/src/hml/a1-candidate.mjs"],
  ["tests/wrangler-a2-hml-dryrun.jsonc","lunaris-licita-public-a2-dryrun-never-deploy",
    "../web/src/hml/a2-candidate.mjs"]
];
for (const [path,name,main] of configs) {
  const config = parse(path);
  assert.equal(config.name,name,path+" worker name");
  assert.equal(config.main,main,path+" entrypoint");
  assert.equal(config.workers_dev,false,path+" workers.dev must remain disabled");
  assert.equal(config.preview_urls,false,path+" preview URLs must remain disabled");
  assert.deepEqual(config.d1_databases,[{
    binding:"DB",database_name:"public-lab-synthetic-only",database_id:ZERO
  }],path+" must use only the synthetic D1 placeholder");
  for (const key of forbidden)
    assert.equal(Object.hasOwn(config,key),false,path+" must not contain "+key);
}
const sources = [
  "web/ui/worker/a1-runtime-gate.mjs","web/ui/worker/a2-runtime-gate.mjs",
  "web/ui/worker/a3-runtime-gate.mjs","web/ui/worker/f1-identity.mjs",
  "web/ui/worker/f2-cadastros.mjs","web/ui/worker/f3-finance.mjs",
  "web/ui/worker/f4-tenders.mjs","web/ui/worker/f5-commercial.mjs",
  "web/ui/worker/f6-fulfillment.mjs","web/ui/worker/f7-cashflow.mjs",
  "web/ui/worker/f8-files.mjs","web/ui/worker/f8-version-stream.mjs",
  "web/src/hml/a1-candidate.mjs","web/src/hml/a1-test-entry.mjs",
  "web/src/hml/a2-candidate.mjs","web/src/hml/a2-test-entry.mjs",
  "web/src/hml/a3-candidate.mjs","web/src/hml/a3-test-entry.mjs",
  "web/src/r7/document-stream-e4.mjs","web/src/r7/stream-drain.mjs",
  "web/integration/e5-a1-hml-miniflare.test.mjs",
  "web/integration/e5-a2-hml-miniflare.test.mjs",
  "web/integration/e5-a3-hml-miniflare.test.mjs",
  "web/tests/r7-e5-a1-gate.test.mjs","web/tests/r7-e5-a2-gate.test.mjs",
  "web/tests/r7-e5-a3-gate.test.mjs","web/tests/r7-e5-a3-stream-drain.test.mjs"
];
const secretPattern = /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|CLOUDFLARE_API_TOKEN\s*[:=]\s*["'][^"']{8,}|GOOGLE_CLIENT_SECRET\s*[:=]\s*["'][^"']{8,})/i;
for (const path of sources) {
  const source = read(path);
  assert.doesNotMatch(source,/licita\.lunaris\.dev\.br|licita-hml\.lunaris\.dev\.br/i,
    path+" must not expose private production/HML hostnames");
  assert.doesNotMatch(source,secretPattern,path+" must not contain credential-like literals");
  assert.doesNotMatch(source,/caiolunardi\/Lunaris_Licita\/pull\/\d+/,
    path+" must not expose private PR references");
}
const hml = read("web/src/hml/index.mjs");
assert.match(hml,/"hml_not_ready"/);
assert.match(hml,/status:\s*503/);
assert.doesNotMatch(hml,/createR7Handler|from\s*["'][^"']*\/r7\/|\.DB\b|\.R2\b|env\./);
const ci = read(".github/workflows/ci.yml");
for (const path of configs.map(x=>x[0]))
  assert.ok(ci.includes("wrangler deploy --dry-run --config "+path),
    "CI must compile "+path+" in dry-run only");
assert.doesNotMatch(ci,/wrangler deploy --config tests\/wrangler-a[12]-hml-dryrun\.jsonc/,
  "CI must never deploy an A0 candidate");
console.log("PUBLIC_A0_CANDIDATE_ISOLATION_OK: synthetic-only, sanitized domains, no credentials, no deploy");
