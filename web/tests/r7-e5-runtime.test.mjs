// R7 E5: contratos de configuracao e OAuth, exclusivamente fake fetch.
// Nunca usam conta Google/Cloudflare real, refresh token real ou banco remoto.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectDriveRefreshSecrets,refreshDriveAccessToken}
 from "../src/r7/drive-oauth-e5.mjs";
import {inspectE5Readiness,createE5DocumentAdapters}
 from "../src/r7/runtime-e5.mjs";
import {inspectE5StaticFiles} from "../../tools/check-e5-static.mjs";

function env(overrides={}){
 return {
  DB:{prepare(){},batch(){}},R2:{get(){},put(){}},
  ACCESS_TEAM_DOMAIN:"https://licita-e5.cloudflareaccess.com",
  ACCESS_AUD:"audience-r7-hml-test-only",
  APP_ORIGIN:"https://licita.lunaris.dev.br",
  DRIVE_OAUTH_CLIENT_ID:"1234567890-localexample.apps.googleusercontent.com",
  DRIVE_OAUTH_CLIENT_SECRET:"synthetic-client-secret-0000001",
  DRIVE_OAUTH_REFRESH_TOKEN:"synthetic-refresh-token-0000001",
  DRIVE_ARCHIVE_FOLDER_ID:"fixture-folder-e5",
  BACKUP_ARCHIVE_ORIGIN:"https://backup-independent.example",
  BACKUP_ARCHIVE_TOKEN:"synthetic-backup-token-0000001",
  BACKUP_FAILURE_DOMAIN:"other-provider",
  ...overrides
 };
}
function tokenFixture(options={}){
 let requests=0;
 return {get count(){return requests;},
  async fetchFn(url,init){
   requests++;
   assert.equal(url,"https://oauth2.googleapis.com/token");
   assert.equal(init.redirect,"error");
   assert.equal(init.method,"POST");
   assert.equal(init.credentials,"omit");
   assert.equal(init.headers["content-type"],"application/x-www-form-urlencoded");
   const body=new URLSearchParams(init.body);
   assert.equal(body.get("grant_type"),"refresh_token");
   assert.equal(body.get("client_id"),"1234567890-localexample.apps.googleusercontent.com");
   assert.equal(body.get("client_secret"),"synthetic-client-secret-0000001");
   assert.equal(body.get("refresh_token"),"synthetic-refresh-token-0000001");
   return new Response(JSON.stringify({
    access_token:"synthetic-access-token-valid-0000001",token_type:"Bearer",
    expires_in:3600,scope:"https://www.googleapis.com/auth/drive.file",
    ...options
   }),{status:200,headers:{"content-type":"application/json"}});
  }};
}
test("E5 token Drive obtem grant refresh_token no endpoint fixo",async()=>{
 const x=tokenFixture();
 const refreshed=await refreshDriveAccessToken(env(),{fetchFn:x.fetchFn});
 assert.equal(x.count,1);
 assert.equal(refreshed.expiresInSeconds,3600);
 assert.equal(refreshed.accessToken,"synthetic-access-token-valid-0000001");
 assert.equal(Object.isFrozen(refreshed),true);
 assert.ok(!JSON.stringify(refreshed).includes("synthetic-refresh-token"));
});
test("E5 exige Drive OAuth offline separado do IdP Cloudflare Access",()=>{
 assert.deepEqual(inspectDriveRefreshSecrets(env()),[]);
 assert.ok(inspectDriveRefreshSecrets(env({
  DRIVE_OAUTH_CLIENT_ID:"",
  DRIVE_OAUTH_CLIENT_SECRET:"",
  DRIVE_OAUTH_REFRESH_TOKEN:""
 })).length===3);
 assert.ok(inspectDriveRefreshSecrets(env({
  DRIVE_OAUTH_REFRESH_TOKEN:"synthetic-client-secret-0000001"
 })).includes("drive_oauth_secrets_not_distinct"));
});
test("E5 rejeita token com scope inadequado, expires e tipo nao-Bearer",async()=>{
 for(const override of [
  {scope:"https://www.googleapis.com/auth/drive.metadata.readonly"},
  {scope:""},
  {token_type:"Basic"},
  {access_token:"tiny"},
  {expires_in:0},
  {expires_in:"3600"},
  {expires_in:100000}
 ]){
  await assert.rejects(
   ()=>refreshDriveAccessToken(env(),{fetchFn:tokenFixture(override).fetchFn}),
   e=>e.code==="drive_oauth_scope_or_token_invalid");
 }
});
test("E5 nao revela client secret/refresh token em falha HTTP ou rede",async()=>{
 const secrets=env();
 for(const fetchFn of [
  async()=>new Response(JSON.stringify({error:"invalid_grant",access_token:secrets.DRIVE_OAUTH_REFRESH_TOKEN}),{status:400}),
  async()=>{throw Error("network contains "+secrets.DRIVE_OAUTH_CLIENT_SECRET);}
 ]){
  await assert.rejects(()=>refreshDriveAccessToken(secrets,{fetchFn}),e=>{
   assert.equal(e.status,503);
   assert.ok(!String(e).includes(secrets.DRIVE_OAUTH_REFRESH_TOKEN));
   assert.ok(!String(e).includes(secrets.DRIVE_OAUTH_CLIENT_SECRET));
   return true;
  });
 }
});
test("E5 fatura pronta para HML nunca marca evidencias externas nem D1 remoto",()=>{
 const ready=inspectE5Readiness(env());
 assert.equal(ready.structurallyConfigured,true);
 assert.equal(ready.externalEvidenceVerified,false);
 assert.equal(ready.readyForRemoteD1,false);
 assert.deepEqual(ready.issues,[]);
 assert.equal(Object.isFrozen(ready),true);
});
test("E5 fail closed sem D1/R2, Access, OAuth, backup ou pasta",()=>{
 const notReady=inspectE5Readiness(env({
  DB:null,R2:null,ACCESS_TEAM_DOMAIN:"https://evil.example",
  ACCESS_AUD:"",APP_ORIGIN:"http://licita.lunaris.dev.br",
  DRIVE_OAUTH_CLIENT_ID:"missing",DRIVE_ARCHIVE_FOLDER_ID:"",
  BACKUP_ARCHIVE_ORIGIN:"https://storage.cloudflare.com",
  BACKUP_ARCHIVE_TOKEN:"",
  BACKUP_FAILURE_DOMAIN:"cloudflare"
 }));
 assert.equal(notReady.structurallyConfigured,false);
 assert.equal(notReady.readyForRemoteD1,false);
 for(const item of ["d1_binding_missing","r2_binding_missing",
  "access_team_missing","access_audience_missing","app_origin_untrusted",
  "drive_folder_missing","backup_origin_untrusted","backup_secret_missing",
  "backup_independence_not_proved","drive_oauth_client_id_missing"]){
  assert.ok(notReady.issues.includes(item),item);
 }
});
test("E5 rejeita segredos reutilizados entre backup e Drive",()=>{
 const x=inspectE5Readiness(env({
  BACKUP_ARCHIVE_TOKEN:"synthetic-refresh-token-0000001"
 }));
 assert.ok(x.issues.includes("external_credentials_reused"));
 assert.equal(x.structurallyConfigured,false);
});
test("E5 nao busca OAuth antes de validar bindings externos",async()=>{
 let calls=0;
 await assert.rejects(
  ()=>createE5DocumentAdapters(env({DB:null}),{fetchFn:async()=>{
   calls++;throw Error("must not request credentials");}}),
  e=>e.code==="e5_external_bindings_not_ready");
 assert.equal(calls,0);
});
test("E5 injeta tokens Drive e backup em adaptadores independentes",async()=>{
 const x=tokenFixture();
 const adapters=await createE5DocumentAdapters(env(),{fetchFn:x.fetchFn});
 assert.equal(x.count,1);
 assert.equal(adapters.drive.providerId,"google-drive");
 assert.equal(adapters.drive.failureDomain,"google-drive");
 assert.equal(adapters.backup.providerId,"independent-https");
 assert.equal(adapters.backup.failureDomain,"other-provider");
 assert.equal(typeof adapters.drive.put,"function");
 assert.equal(typeof adapters.backup.restore,"function");
 assert.ok(!JSON.stringify(adapters).includes("synthetic-refresh-token"));
});
test("E5 static gate protege bootstrap e candidato synthetic",()=>{
 const rd=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
 const snapshot={
  productionConfig:rd("wrangler.jsonc"),
  productionCode:rd("web/src/index.js"),
  candidateConfig:rd("tests/wrangler-e5-dryrun.jsonc"),
  gitignore:rd(".gitignore"),
  ci:rd(".github/workflows/quality.yml")
 };
 assert.deepEqual(inspectE5StaticFiles(snapshot),{ok:true,issues:[]});
 assert.equal(inspectE5StaticFiles({...snapshot,
  productionCode:snapshot.productionCode+'import "./r7/http.mjs";'}).ok,false);
 const config=JSON.parse(snapshot.candidateConfig);
 config.d1_databases[0].database_id="11111111-2222-4333-8444-555555555555";
 assert.equal(inspectE5StaticFiles({...snapshot,
  candidateConfig:JSON.stringify(config)}).ok,false);
 const wrong=JSON.parse(snapshot.productionConfig);
 wrong.main="./web/src/r7/e5-bundle-probe.mjs";
 assert.equal(inspectE5StaticFiles({...snapshot,
  productionConfig:JSON.stringify(wrong)}).ok,false);
});
