// SOMENTE CI sintética, jamais usar como main de Wrangler de produção ou HML.
import {createA1HmlHandler} from "./a1-candidate.mjs";
export default {
 async fetch(request,env){
  const keys=async()=>new Response(env.F1_TEST_JWKS_PUBLIC,{
   status:200,headers:{"content-type":"application/json"}});
  return createA1HmlHandler({fetchKeys:keys})(request,env);
 }
};
