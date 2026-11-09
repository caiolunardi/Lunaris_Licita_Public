// R7 / W6: autenticacao Cloudflare Access sem confiar em headers de identidade.
// Futura API (NAO importada no bootstrap publicado). Apenas WebCrypto RS256.
// O JWT deve vir do header gerado pelo Access; nao aceitar x-user/email de cliente.
const utf8 = new TextDecoder();
const jwksCache = new Map();
const ALLOWED_TEAM = /^https:\/\/[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/;
const text = (value) => typeof value === "string" ? value : "";

export class SecurityError extends Error {
  constructor(code = "forbidden", status = 403) {
    super(code);
    this.name = "SecurityError";
    this.code = code;
    this.status = status;
  }
}
function decodeUrlBase64(input) {
  if (typeof input !== "string" || input.length > 14000 || !/^[A-Za-z0-9_-]+$/.test(input)) {
    throw new SecurityError("invalid_token", 401);
  }
  try {
    const pad = "=".repeat((4 - input.length % 4) % 4);
    const raw = atob(input.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    throw new SecurityError("invalid_token", 401);
  }
}
function parseSegment(value) {
  try {
    const v = JSON.parse(utf8.decode(decodeUrlBase64(value)));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("invalid JWT JSON");
    return v;
  } catch {
    throw new SecurityError("invalid_token", 401);
  }
}
function validConfiguration(env) {
  const team = text(env?.ACCESS_TEAM_DOMAIN).replace(/\/$/, "");
  const aud = text(env?.ACCESS_AUD);
  if (!ALLOWED_TEAM.test(team) || !aud || aud.length > 256) {
    throw new SecurityError("access_not_configured", 503);
  }
  return { issuer: team, audience: aud };
}
async function getRemoteKeys(issuer, fetchFn, nowMs = Date.now()) {
  const cached = jwksCache.get(issuer);
  if (cached && cached.expires > nowMs) return cached.keys;
  const response = await fetchFn(issuer + "/cdn-cgi/access/certs", {
    method: "GET", redirect: "error", headers: { accept: "application/json" }
  });
  if (!response?.ok) throw new SecurityError("access_keys_unavailable", 503);
  const contentLength = Number(response.headers?.get?.("content-length") || "0");
  if (contentLength > 65536) throw new SecurityError("access_keys_invalid", 503);
  const raw = await response.text();
  if (raw.length > 65536) throw new SecurityError("access_keys_invalid", 503);
  let set;
  try { set = JSON.parse(raw); } catch { throw new SecurityError("access_keys_invalid", 503); }
  if (!Array.isArray(set?.keys) || set.keys.length > 25) {
    throw new SecurityError("access_keys_invalid", 503);
  }
  jwksCache.set(issuer, { keys: set.keys, expires: nowMs + 300000 });
  return set.keys;
}
export async function verifyAccessToken(token, { issuer, audience, keys, nowMs = Date.now() }) {
  if (!ALLOWED_TEAM.test(issuer) || typeof audience !== "string" || !audience) {
    throw new SecurityError("access_not_configured", 503);
  }
  if (typeof token !== "string" || token.length > 16000) {
    throw new SecurityError("invalid_token", 401);
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new SecurityError("invalid_token", 401);
  const [header64, payload64, signature64] = parts;
  const header = parseSegment(header64), payload = parseSegment(payload64);
  if (header.alg !== "RS256" || !header.kid || typeof header.kid !== "string") {
    throw new SecurityError("invalid_token", 401);
  }
  const jwk = Array.isArray(keys) ? keys.find(k =>
    k?.kid === header.kid && k?.kty === "RSA" && k?.alg !== "HS256"
    && (!k?.use || k.use === "sig") && (!k?.key_ops || k.key_ops.includes("verify"))
  ) : null;
  if (!jwk) throw new SecurityError("invalid_token", 401);
  const input = new TextEncoder().encode(header64 + "." + payload64);
  const signature = decodeUrlBase64(signature64);
  let valid = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, input);
  } catch { /* fail closed */ }
  if (!valid) throw new SecurityError("invalid_token", 401);
  const now = Math.floor(nowMs / 1000);
  const aud = payload.aud;
  if (payload.iss !== issuer || !(aud === audience ||
        (Array.isArray(aud) && aud.length > 0 && aud.includes(audience))) ||
      typeof payload.sub !== "string" || !payload.sub.trim() || payload.sub.length > 512 ||
      !Number.isInteger(payload.exp) || payload.exp <= now ||
      (payload.nbf !== undefined && (!Number.isInteger(payload.nbf) || payload.nbf > now)) ||
      !Number.isInteger(payload.iat) || payload.iat>now+60 || payload.iat>payload.exp) {
    throw new SecurityError("invalid_token", 401);
  }
  const raw=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  const tokenSha256=Array.from(new Uint8Array(raw)).map(v=>
    v.toString(16).padStart(2,"0")).join("");
  return Object.freeze({ issuer: payload.iss, subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    issuedAt:payload.iat,expiresAt:payload.exp,tokenSha256 });
}
export async function authenticateAccess(request, env, fetchFn = fetch, nowMs = Date.now()) {
  const { issuer, audience } = validConfiguration(env);
  const token = request.headers?.get?.("cf-access-jwt-assertion");
  if (!token) throw new SecurityError("access_token_required", 401);
  const keys = await getRemoteKeys(issuer, fetchFn, nowMs);
  return verifyAccessToken(token, { issuer, audience, keys, nowMs });
}
const ROLES = Object.freeze({
  read: ["ADMIN", "OPERADOR", "CONSULTA"],
  write: ["ADMIN", "OPERADOR"],
  approve: ["ADMIN"]
});
export async function requireCompanyRole(db, principal, companyId, capability) {
  if (!db?.prepare || !principal?.issuer || !principal?.subject ||
      typeof companyId !== "string" || companyId.length < 1 || companyId.length > 128) {
    throw new SecurityError();
  }
  const roles = ROLES[capability];
  if (!roles) throw new SecurityError("capability_disabled");
  const member = await db.prepare(
    "SELECT u.id AS usuario_id, ue.papel AS papel FROM usuarios u " +
    "JOIN usuarios_empresas ue ON ue.usuario_id=u.id " +
    "JOIN empresas e ON e.id=ue.empresa_id AND e.ativo=1 " +
    "WHERE u.access_issuer=? AND u.access_subject=? AND u.ativo=1 " +
    "AND ue.empresa_id=? AND ue.ativo=1"
  ).bind(principal.issuer, principal.subject, companyId).first();
  if (!member || !roles.includes(member.papel)) throw new SecurityError();
  return Object.freeze({ companyId, userId: member.usuario_id, role: member.papel });
}
// Acesso de importador LEGADO, expurgo R2 e banco remoto deliberadamente negados;
// exigir implementação independente e autorização forte na rodada seguinte.
export function forbidPrivilegedOperation() {
  throw new SecurityError("privileged_operation_not_implemented");
}
