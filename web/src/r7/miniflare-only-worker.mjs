// EXCLUSIVO TESTE LOCAL workerd/Miniflare, NAO reutilizar como entrypoint PROD.
// Este adaptador injeta JWKS publico efemero do teste; a API operacional deve
// obter JWKS somente do Cloudflare Access real via security.authenticateAccess.
import { createR7Handler } from "./http.mjs";

export default {
  async fetch(request, env) {
    if (env?.R7_RUNTIME_ENABLED !== "test_local_only" ||
        env?.R7_TEST_ADAPTER !== "strictly_local") {
      return new Response('{"error":"test_adapter_disabled"}', {
        status:503,headers:{"cache-control":"no-store","content-type":"application/json"}
      });
    }
    let jwks;
    try { jwks=JSON.parse(env.R7_TEST_JWKS_PUBLIC); }
    catch { return new Response("local_key_missing",{status:503}); }
    return createR7Handler({
      fetchKeys:async()=>new Response(JSON.stringify(jwks),{
        headers:{"content-type":"application/json"}
      })
    })(request,env);
  }
};
