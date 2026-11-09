// E5: HML OFFLINE E BLOQUEADA. Nao expor rotas R7 antes de Access e gates externos.
// O entrypoint nao usa env, banco, R2, arquivos ou OAuth e responde 503 a tudo.
const HEADERS = Object.freeze({
  "cache-control": "no-store, private",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
});
export default {
  async fetch(request) {
    const head = request.method.toUpperCase() === "HEAD";
    return new Response(head ? null : '{"error":"hml_not_ready"}', {
      status: 503, headers: HEADERS
    });
  }
};
