// E5 SOMENTE COMPILACAO de todos os modulos R7 em um Worker isolado.
// Nao referenciado por wrangler.jsonc, sem handlers/DB/credenciais reais.
import {createR7Handler} from "./http.mjs";
import {inspectE5Readiness,createE5DocumentAdapters} from "./runtime-e5.mjs";
export default {
 async fetch(){
  // Referencias estaticas para incluir codigo no bundle do dry-run.
  void [createR7Handler,inspectE5Readiness,createE5DocumentAdapters];
  return new Response('{"error":"e5_dry_run_only"}',{
   status:503,headers:{"cache-control":"no-store","content-type":"application/json"}
  });
 }
};
