// A3.1: F8 somente em laboratório ou HML com D1/R2 sintéticos.
// A2 mantém a regra original: não aceitar env.R2 na rota financeira.
import {a2HmlReady,a2CompanyIsSynthetic} from "./a2-runtime-gate.mjs";
import {A1_HML_ORIGIN} from "./a1-runtime-gate.mjs";
export const A3_HML_STAGE="a3_synthetic_documents";
export const A3_HML_ENABLED="f8_r2_synthetic_only";
export const A3_HML_SCOPE="isolated_hml_d1_r2_only";
const LAB=new Set(["licita.local.test","localhost","127.0.0.1"]);
const MIME=new Set(["application/pdf","application/xml","image/png","image/jpeg","text/plain"]);
const OWNERS=new Set(["licitacao","empenho","compra","envio","nota_fiscal",
 "titulo_pagar","titulo_baixa","conta_receber","recebimento"]);
const UNSAFE=/https?:\/\/|www\.|@|[0-9]{11,}|[<>\u0000-\u001f]|data:|javascript:/i;
export function a3FinancialEnvironment(env){return {...env,R2:undefined};}
export function a3F8RuntimeMode(request,env){
 let url;
 try{url=new URL(request.url);}catch{return null;}
 if(url.username||url.password||url.hash||!env?.DB?.prepare||!env.DB.batch||
  !env?.R2?.get||!env.R2.put)return null;
 if(LAB.has(url.hostname))
  return env.F1_RUNTIME_ENABLED==="test_local_only"&&
   env.F8_RUNTIME_ENABLED==="test_local_only"?"local":null;
 if(url.origin!==A1_HML_ORIGIN||url.protocol!=="https:"||
  env.APP_ORIGIN!==A1_HML_ORIGIN||env.A3_HML_STAGE!==A3_HML_STAGE||
  env.A3_HML_ENABLED!==A3_HML_ENABLED||env.A3_HML_SCOPE!==A3_HML_SCOPE||
  env.F8_RUNTIME_ENABLED!==undefined||env.GEMINI_API_KEY!==undefined||
  env.F10_GEMINI_ENABLED!==undefined||env.R7_RUNTIME_ENABLED!==undefined||
  env.DRIVE_ACCESS_TOKEN!==undefined||env.BACKUP_API_TOKEN!==undefined||
  !a2HmlReady(request,a3FinancialEnvironment(env)))return null;
 return "hml";
}
export async function a3CompanyIsSynthetic(db,company){
 if(!await a2CompanyIsSynthetic(db,company))return false;
 const queries=[
  "SELECT 1 AS bad FROM documentos WHERE empresa_id=? AND (origem_dado<>'NATIVO' OR titulo NOT LIKE 'TESTE - %') LIMIT 1",
  "SELECT 1 AS bad FROM documento_versoes WHERE empresa_id=? AND (origem_dado<>'NATIVO' OR nome_original NOT LIKE 'TESTE - %') LIMIT 1",
  "SELECT 1 AS bad FROM documento_localizacoes WHERE empresa_id=? AND provedor<>'R2' LIMIT 1",
  "SELECT 1 AS bad FROM documento_transferencias WHERE empresa_id=? LIMIT 1"
 ];
 for(const sql of queries)if(await db.prepare(sql).bind(company).first())return false;
 return true;
}
// O cabeçalho de teste não demonstra ausência de PII nos bytes.
// Operador deve usar apenas arquivos fictícios em um bucket HML isolado.
export function a3ValidateSyntheticDocumentRequest(request){
 let path;try{path=new URL(request.url).pathname;}catch{return false;}
 const uploading=/\/files\/upload$/.test(path);
 const versioning=/\/files\/[A-Za-z0-9_-]{1,128}\/versions\/stream$/.test(path);
 if(request.method!=="POST"||(!uploading&&!versioning))return false;
 const h=request.headers,ct=(h.get("content-type")||"").toLowerCase();
 const bytes=Number(h.get("content-length")||"0");
 const file=h.get("x-doc-name")||"",intent=h.get("x-doc-intent")||"";
 if(h.get("origin")!==A1_HML_ORIGIN||
  h.get("x-lunaris-synthetic-only")!=="confirmed"||
  !/^a3-test-[A-Za-z0-9_-]{3,100}$/.test(intent)||
  !/^TESTE - [^\s]/.test(file)||file.length>255||UNSAFE.test(file)||
  file.includes("/")||file.includes("\\")||!MIME.has(ct)||
  !/^[1-9]\d{0,7}$/.test(h.get("content-length")||"")||
  !Number.isSafeInteger(bytes)||bytes>8*1024*1024||
  !/^[a-f0-9]{64}$/.test(h.get("x-content-sha256")||""))return false;
 if(uploading&&(!OWNERS.has(h.get("x-doc-owner-type"))||
  !/^[A-Za-z0-9_-]{1,128}$/.test(h.get("x-doc-owner-id")||"")||
  !/^[A-Z_]{3,64}$/.test(h.get("x-doc-role")||"")||
  !/^[A-Z_]{3,64}$/.test(h.get("x-doc-type")||"")))return false;
 if(versioning&&!/^[1-9]\d{0,9}$/.test(h.get("x-doc-expected-version")||""))return false;
 return true;
}
