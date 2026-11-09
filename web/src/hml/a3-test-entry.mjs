// Só Miniflare local: JWKS fictício, NUNCA para deploy.
import {createA3HmlHandler} from "./a3-candidate.mjs";
export default {async fetch(request,env){
 const fetchKeys=async()=>new Response(env.F1_TEST_JWKS_PUBLIC,{
  headers:{"content-type":"application/json"}});
 return createA3HmlHandler({fetchKeys})(request,env);
}};
