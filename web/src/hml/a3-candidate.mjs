// A3.1: candidato local, NÃO publicado. O HML ativo mantém 503.
import {createA2HmlHandler} from "./a2-candidate.mjs";
import {createF8Handler} from "../../ui/worker/f8-files.mjs";
import {a3F8RuntimeMode,a3FinancialEnvironment,a3CompanyIsSynthetic,
 a3ValidateSyntheticDocumentRequest} from "../../ui/worker/a3-runtime-gate.mjs";
import {authenticateAccess,requireCompanyRole,SecurityError} from "../r7/security.mjs";
import {assertSessionActive} from "../r7/iam.mjs";
const FILES=/^\/api\/v1\/companies\/([A-Za-z0-9_-]{1,128})\/files(?:\/|$)/;
const HEADERS={"cache-control":"private, no-store, max-age=0",
 "content-type":"application/json; charset=utf-8","x-content-type-options":"nosniff",
 "x-frame-options":"DENY","referrer-policy":"no-referrer",
 "x-robots-tag":"noindex, nofollow, noarchive",
 "content-security-policy":"default-src 'none'; frame-ancestors 'none'"};
const deny=(req,code="hml_not_ready",status=503)=>new Response(
 req.method==="HEAD"?null:JSON.stringify({error:code}),{status,headers:HEADERS});
export function createA3HmlHandler({fetchKeys}={}){
 const a2=createA2HmlHandler({fetchKeys});
 const f8=createF8Handler({fetchKeys}); // Sem adaptadores Drive/backup.
 return async function handle(request,env){
  let url;try{url=new URL(request.url);}catch{return deny(request);}
  if(a3F8RuntimeMode(request,env)!=="hml")return deny(request);
  const match=FILES.exec(url.pathname);
  if(!match)return a2(request,a3FinancialEnvironment(env));
  const method=request.method.toUpperCase();
  if(!["GET","HEAD","POST"].includes(method))return deny(request,"method_not_allowed",405);
  if(/\/archive-copy$|\/archive-attempts(?:\/|$)/.test(url.pathname))return deny(request);
  try{
   const principal=await authenticateAccess(request,env,fetchKeys||fetch);
   await assertSessionActive(env.DB,principal);
   await requireCompanyRole(env.DB,principal,match[1],method==="POST"?"write":"read");
   if(!await a3CompanyIsSynthetic(env.DB,match[1]))
    return deny(request,"hml_synthetic_only",503);
   if(method==="POST"&&!a3ValidateSyntheticDocumentRequest(request))
    return deny(request,"hml_synthetic_only",403);
   return await f8(request,env)??deny(request);
  }catch(e){
   if(e instanceof SecurityError){
    const safe=new Set(["access_token_required","invalid_token","invalid_session",
     "session_revoked","forbidden"]);
    return deny(request,safe.has(e.code)?e.code:"request_rejected",
     Number.isInteger(e.status)?e.status:403);
   }
   return deny(request);
  }
 };
}
export default {fetch:createA3HmlHandler()};
