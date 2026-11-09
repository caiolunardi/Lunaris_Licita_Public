// Offline: prova que o Worker público permanece bootstrap e que
// nenhum binding/ID remoto entra acidentalmente na configuração candidate.
import {readFileSync} from "node:fs";
function read(p){return readFileSync(new URL("../"+p,import.meta.url),"utf8");}
export function inspectE5StaticFiles({productionConfig,productionCode,
  candidateConfig,gitignore,ci}){
 const issues=[];
 let pub,probe;
 try{pub=JSON.parse(productionConfig);probe=JSON.parse(candidateConfig);}
 catch{return {ok:false,issues:["wrangler_config_invalid"]};}
 if(pub?.name!=="lunaris-licita"||
    !["./web/src/index.js","./web/ui/worker/index.mjs"].includes(pub?.main)||
    pub?.workers_dev!==false||pub?.preview_urls!==false||
    pub?.d1_databases?.length||pub?.r2_buckets?.length||
    pub?.vars||pub?.env||pub?.routes||pub?.route||
    (pub?.main==="./web/ui/worker/index.mjs"&&
     (pub?.assets?.directory!=="./web/ui/dist/client"||
      !Array.isArray(pub?.assets?.run_worker_first))))
  issues.push("production_entrypoint_or_bindings_changed");
 if(/\b(?:import|export)\b[^\n;]*["'][^"']*r7(?:\/|["'])|import\s*\([^)]*r7/.test(productionCode)||
    productionCode.includes("R7_RUNTIME_ENABLED")||
    !productionCode.includes('phase: "bootstrap"'))
  issues.push("public_bootstrap_must_remain_isolated");
 if(probe?.main!=="../web/src/r7/e5-bundle-probe.mjs"||
    probe?.name===pub.name||!String(probe?.name).includes("never-deploy")||
    probe?.workers_dev!==false||probe?.preview_urls!==false||
    probe?.d1_databases?.length!==1||
    probe.d1_databases[0]?.database_id!=="00000000-0000-4000-8000-000000000000"||
    probe?.r2_buckets?.length!==1||
    probe.r2_buckets[0]?.bucket_name!=="synthetic-e5-never-create")
  issues.push("candidate_contains_real_bindings_or_routing");
 for(const pattern of [".env",".env.*",".dev.vars",".dev.vars.*"]){
  if(!gitignore.split(/\r?\n/).includes(pattern))
   issues.push("gitignore_missing_"+pattern);
 }
 if(!ci.includes("wrangler deploy --dry-run")||
    ci.includes("wrangler d1 execute DB --remote"))
  issues.push("ci_cannot_prove_offline_bundle");
 return {ok:issues.length===0,issues};
}
if(process.argv[1]&&new URL("file://"+process.argv[1]).href===import.meta.url){
 const result=inspectE5StaticFiles({
  productionConfig:read("wrangler.jsonc"),productionCode:read("web/src/index.js"),
  candidateConfig:read("tests/wrangler-e5-dryrun.jsonc"),
  gitignore:read(".gitignore"),ci:read(".github/workflows/ci.yml")
 });
 process.stdout.write(JSON.stringify(result)+"\n");
 if(!result.ok)process.exitCode=1;
}
