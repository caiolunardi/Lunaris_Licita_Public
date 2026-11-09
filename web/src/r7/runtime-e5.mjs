// R7 E5 - validacao estrutural das bindings/segredos para hml.
// PROVA ESTRUTURAL NAO SUBSTITUI HOMOLOGACAO DE CONTAS/DRIVE/ACCESS.
import { DomainError } from "./domain.mjs";
import { inspectDriveRefreshSecrets,refreshDriveAccessToken } from "./drive-oauth-e5.mjs";
import {createGoogleDriveAdapter,createIndependentHttpsBackupAdapter}
 from "./external-document-adapters.mjs";

const ORIGIN=/^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/;
const TEAM=/^https:\/\/[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/;
const TOKEN=value=>typeof value==="string"&&value.length>=16&&
 value.length<=4096&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const FOLDER=/^[A-Za-z0-9_-]{1,256}$/;
const ISSUES=Object.freeze({
 db:"d1_binding_missing",r2:"r2_binding_missing",
 team:"access_team_missing",aud:"access_audience_missing",
 origin:"app_origin_untrusted",folder:"drive_folder_missing",
 backupOrigin:"backup_origin_untrusted",backupSecret:"backup_secret_missing",
 independent:"backup_independence_not_proved"
});
export function inspectE5Readiness(env){
 const issues=[];
 if(!env?.DB?.prepare||!env.DB.batch)issues.push(ISSUES.db);
 if(!env?.R2?.get||!env.R2.put)issues.push(ISSUES.r2);
 if(!TEAM.test(env?.ACCESS_TEAM_DOMAIN||""))issues.push(ISSUES.team);
 if(typeof env?.ACCESS_AUD!=="string"||env.ACCESS_AUD.length<8||
    env.ACCESS_AUD.length>256)issues.push(ISSUES.aud);
 if(!ORIGIN.test(env?.APP_ORIGIN||""))issues.push(ISSUES.origin);
 if(!FOLDER.test(env?.DRIVE_ARCHIVE_FOLDER_ID||""))issues.push(ISSUES.folder);
 if(typeof env?.BACKUP_ARCHIVE_ORIGIN!=="string"||
    !ORIGIN.test(env.BACKUP_ARCHIVE_ORIGIN)||
    !/^https:\/\//.test(env.BACKUP_ARCHIVE_ORIGIN)||
    /(?:cloudflare|googleapis|lunaris\.dev\.br|localhost|127\.0\.0\.1)/.test(env.BACKUP_ARCHIVE_ORIGIN))
  issues.push(ISSUES.backupOrigin);
 if(!TOKEN(env?.BACKUP_ARCHIVE_TOKEN))issues.push(ISSUES.backupSecret);
 if(typeof env?.BACKUP_FAILURE_DOMAIN!=="string"||
    !/^[a-z0-9_-]{3,40}$/.test(env.BACKUP_FAILURE_DOMAIN)||
    ["cloudflare","google-drive"].includes(env.BACKUP_FAILURE_DOMAIN))
  issues.push(ISSUES.independent);
 issues.push(...inspectDriveRefreshSecrets(env));
 if(issues.length===0&&new Set([
   env.BACKUP_ARCHIVE_TOKEN,env.DRIVE_OAUTH_REFRESH_TOKEN,
   env.DRIVE_OAUTH_CLIENT_SECRET
 ]).size!==3)issues.push("external_credentials_reused");
 return Object.freeze({
  structurallyConfigured:issues.length===0,
  // Sempre falso ate prova E2E documentada/humana de backup e Access:
  externalEvidenceVerified:false,
  readyForRemoteD1:false,
  issues:Object.freeze(issues)
 });
}
export async function createE5DocumentAdapters(env,{fetchFn=fetch}={}){
 const readiness=inspectE5Readiness(env);
 if(!readiness.structurallyConfigured||typeof fetchFn!=="function")
  throw new DomainError("e5_external_bindings_not_ready",503);
 const {accessToken}=await refreshDriveAccessToken(env,{fetchFn});
 const drive=createGoogleDriveAdapter({
  folderId:env.DRIVE_ARCHIVE_FOLDER_ID,accessToken,fetchFn
 });
 const backup=createIndependentHttpsBackupAdapter({
  origin:env.BACKUP_ARCHIVE_ORIGIN,
  accessToken:env.BACKUP_ARCHIVE_TOKEN,
  failureDomain:env.BACKUP_FAILURE_DOMAIN,fetchFn
 });
 return Object.freeze({r2:env.R2,drive,backup});
}
