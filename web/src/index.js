const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; style-src 'self'; img-src 'self'"
};
function secure(response) {
  const h = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) h.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}
function reply(payload, status, method) {
  return secure(new Response(method === "HEAD" ? null : JSON.stringify(payload), {
    status, headers: { "content-type": "application/json; charset=utf-8" }
  }));
}
export default {
  async fetch(request, env) {
    const method = request.method.toUpperCase();
    if (!["GET", "HEAD"].includes(method)) return reply({ error: "method_not_allowed" }, 405, method);
    const path = new URL(request.url).pathname;
    if (path === "/health") return reply({ status: "ok", phase: "bootstrap", data: "not_connected" }, 200, method);
    if (path === "/api" || path.startsWith("/api/")) return reply({ error: "not_found" }, 404, method);
    // O Cloudflare Access deve proteger o hostname externamente ANTES de publicar dados.
    // Este Worker inicial não contém autenticação própria, banco ou APIs financeiras.
    if (!env?.ASSETS?.fetch) return reply({ error: "assets_unavailable" }, 503, method);
    return secure(await env.ASSETS.fetch(request));
  }
};
