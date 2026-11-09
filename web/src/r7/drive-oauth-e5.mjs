// R7 E5 - refresh de token para Drive, independente do Google IdP do Access.
// Apenas servidor; credenciais devem ser secrets (nunca vars/HTML/Git).
// Sem cache global, logs de token, refresh_token no retorno ou retry cego.
import { DomainError } from "./domain.mjs";

const TOKEN_ENDPOINT="https://oauth2.googleapis.com/token";
const DRIVE_SCOPES=new Set([
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive"
]);
function credential(value,min=16,max=4096){
 return typeof value==="string"&&value.length>=min&&value.length<=max&&
  value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
}
export function inspectDriveRefreshSecrets(env) {
 const issues=[];
 if(!credential(env?.DRIVE_OAUTH_CLIENT_ID,16,512) ||
    !/\.apps\.googleusercontent\.com$/.test(env.DRIVE_OAUTH_CLIENT_ID||""))
  issues.push("drive_oauth_client_id_missing");
 if(!credential(env?.DRIVE_OAUTH_CLIENT_SECRET))
  issues.push("drive_oauth_client_secret_missing");
 if(!credential(env?.DRIVE_OAUTH_REFRESH_TOKEN,16,2048))
  issues.push("drive_oauth_refresh_token_missing");
 if(issues.length===0 && (
    env.DRIVE_OAUTH_REFRESH_TOKEN===env.DRIVE_OAUTH_CLIENT_SECRET ||
    env.DRIVE_OAUTH_REFRESH_TOKEN===env.DRIVE_OAUTH_CLIENT_ID))
  issues.push("drive_oauth_secrets_not_distinct");
 return Object.freeze(issues);
}
export async function refreshDriveAccessToken(env,{fetchFn=fetch}={}) {
 if(inspectDriveRefreshSecrets(env).length||typeof fetchFn!=="function")
  throw new DomainError("drive_oauth_not_configured",503);
 let response;
 try{
  response=await fetchFn(TOKEN_ENDPOINT,{
   method:"POST",redirect:"error",credentials:"omit",
   headers:{"content-type":"application/x-www-form-urlencoded",
    "accept":"application/json"},
   body:new URLSearchParams({
    client_id:env.DRIVE_OAUTH_CLIENT_ID,
    client_secret:env.DRIVE_OAUTH_CLIENT_SECRET,
    refresh_token:env.DRIVE_OAUTH_REFRESH_TOKEN,
    grant_type:"refresh_token"
   })
  });
 }catch{
  throw new DomainError("drive_oauth_refresh_unavailable",503);
 }
 if(response?.status!==200)
  throw new DomainError("drive_oauth_refresh_rejected",503);
 let json;
 try{
  const raw=await response.text();
  if(raw.length>16384)throw Error("oversized");
  json=JSON.parse(raw);
 }catch{
  throw new DomainError("drive_oauth_refresh_invalid",503);
 }
 if(!json||Array.isArray(json)||typeof json!=="object"||
    !credential(json.access_token,16,4096)||
    json.token_type!=="Bearer"||
    !Number.isInteger(json.expires_in)||json.expires_in<60||
    json.expires_in>86400||
    typeof json.scope!=="string"||json.scope.length>2048||
    !json.scope.split(/\s+/).some(scope=>DRIVE_SCOPES.has(scope))) {
  throw new DomainError("drive_oauth_scope_or_token_invalid",503);
 }
 // Nunca serializar esta resposta em logs nem em operacoes/eventos do banco.
 return Object.freeze({accessToken:json.access_token,
  expiresInSeconds:json.expires_in});
}
