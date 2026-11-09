// Somente Miniflare local com JWKS sintético; proibido implantar publicamente.
import {createF1Handler} from "./f1-identity.mjs";
import {createF2Handler} from "./f2-cadastros.mjs";
import {createF3Handler} from "./f3-finance.mjs";
import {createF4Handler} from "./f4-tenders.mjs";
import {createF5Handler} from "./f5-commercial.mjs";
import {createF6Handler} from "./f6-fulfillment.mjs";
import {createF7Handler} from "./f7-cashflow.mjs";
import {createF8Handler} from "./f8-files.mjs";
import {createF9Handler} from "./f9-tools.mjs";
import {createF10Handler} from "./f10-gabi.mjs";
export default {
 async fetch(request,env){
  const keys=async()=>new Response(env.F1_TEST_JWKS_PUBLIC,{
   status:200,headers:{"content-type":"application/json"}
  });
  return (await createF10Handler({fetchKeys:keys})(request,env)) ??
   (await createF9Handler({fetchKeys:keys})(request,env)) ??
   (await createF8Handler({fetchKeys:keys})(request,env)) ??
   (await createF7Handler({fetchKeys:keys})(request,env)) ??
   (await createF6Handler({fetchKeys:keys})(request,env)) ??
   (await createF5Handler({fetchKeys:keys})(request,env)) ??
   (await createF4Handler({fetchKeys:keys})(request,env)) ??
   (await createF3Handler({fetchKeys:keys})(request,env)) ??
   (await createF2Handler({fetchKeys:keys})(request,env)) ??
   createF1Handler({fetchKeys:keys})(request,env);
 }
};
