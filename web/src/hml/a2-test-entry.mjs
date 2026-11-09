// Injeção de JWKS de teste APENAS em Miniflare, nunca publicar.
import {createA2HmlHandler} from "./a2-candidate.mjs";
export default {async fetch(request,env){
 const keys=async()=>new Response(env.F1_TEST_JWKS_PUBLIC,
  {headers:{"content-type":"application/json"}});
 return createA2HmlHandler({fetchKeys:keys})(request,env);
}};
