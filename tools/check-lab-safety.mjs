import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const checks = [
  { path: "wrangler.jsonc", name: "lunaris-licita-lab" },
  { path: "web/ui/wrangler.jsonc", name: "lunaris-licita-f0-laboratorio" },
];

for (const { path, name } of checks) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(config.name, name, `${path}: worker name must remain isolated`);
  assert.equal(config.workers_dev, false, `${path}: workers.dev must remain disabled`);
  assert.equal(config.preview_urls, false, `${path}: preview URLs must remain disabled`);
  assert.equal(config.d1_databases, undefined, `${path}: D1 bindings are forbidden in the public lab`);
  assert.equal(config.r2_buckets, undefined, `${path}: R2 bindings are forbidden in the public lab`);
  assert.equal(config.routes, undefined, `${path}: production routes are forbidden in the public lab`);
  assert.equal(config.route, undefined, `${path}: production route is forbidden in the public lab`);
  assert.equal(config.custom_domains, undefined, `${path}: custom domains are forbidden in the public lab`);
  assert.equal(config.account_id, undefined, `${path}: account IDs are not allowed in tracked lab config`);
  assert.equal(config.zone_id, undefined, `${path}: zone IDs are not allowed in tracked lab config`);
  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, /GEMINI_API_KEY|CLOUDFLARE_API_TOKEN|GOOGLE_CLIENT_SECRET/i,
    `${path}: secret-like values must never be committed`);
}

console.log("PUBLIC_LAB_ISOLATION_OK: no production worker name, route, D1/R2 binding, account binding or secret");
