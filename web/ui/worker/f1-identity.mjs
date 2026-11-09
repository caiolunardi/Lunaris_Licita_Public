// F1: BFF de identidade SOMENTE para testes Workerd/D1 locais.
// Reutiliza autenticação e revogação R7, sem duplicar lógica de segurança.
// Não importar esta API no Worker produtivo ou HML; default fail-closed 503.
import { authenticateAccess, requireCompanyRole, SecurityError } from "../../src/r7/security.mjs";
import { assertSessionActive, revokeCurrentSession } from "../../src/r7/iam.mjs";
import { DomainError } from "../../src/r7/domain.mjs";

const SAFE_HEADERS = Object.freeze({
  "cache-control": "private, no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "vary": "cf-access-jwt-assertion"
});
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const ROUTE_COMPANY = /^\/api\/v1\/companies\/([a-zA-Z0-9_-]{1,128})\/context$/;
const ERRORS = new Set([
  "access_token_required", "invalid_token", "access_not_configured",
  "access_keys_unavailable", "access_keys_invalid", "invalid_session",
  "session_revoked", "forbidden", "invalid_origin", "app_origin_not_configured",
  "json_content_type_required", "invalid_json", "invalid_logout",
  "payload_too_large", "r7_not_enabled", "f1_not_enabled",
  "membership_version_conflict", "session_revocation_conflict",
  "session_revocation_incomplete", "invalid_session"
]);

function json(body, status=200, method="GET") {
  return new Response(method==="HEAD" ? null : JSON.stringify(body), {
    status, headers: SAFE_HEADERS
  });
}
function sameOrigin(request, env) {
  const expected = env?.APP_ORIGIN;
  if(typeof expected !== "string" || !/^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/.test(expected)) {
    throw new SecurityError("app_origin_not_configured",503);
  }
  if(new URL(request.url).origin!==expected || request.headers.get("origin")!==expected) {
    throw new SecurityError("invalid_origin",403);
  }
}
async function parseLogout(request) {
  const type=request.headers.get("content-type")||"";
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type))
    throw new SecurityError("json_content_type_required",415);
  const declared=Number(request.headers.get("content-length")||"0");
  if(!Number.isFinite(declared)||declared>2048) throw new SecurityError("payload_too_large",413);
  const raw=await request.text();
  if(new TextEncoder().encode(raw).byteLength>2048)throw new SecurityError("payload_too_large",413);
  let body;
  try{body=JSON.parse(raw);}catch{throw new SecurityError("invalid_json",400);}
  if(!body||typeof body!=="object"||Array.isArray(body)||
    Object.keys(body).length!==2||!Object.hasOwn(body,"companyId")||
    !Object.hasOwn(body,"intentId")||!ID.test(body.companyId)||!ID.test(body.intentId)) {
    throw new SecurityError("invalid_logout",400);
  }
  return body;
}

export function createF1Handler({fetchKeys}={}) {
  return async function handle(request,env) {
    const url=new URL(request.url), method=request.method.toUpperCase();
    if(url.pathname==="/health") {
      if(method!=="GET"&&method!=="HEAD") return json({error:"method_not_allowed"},405,method);
      return json({status:"ok",phase:"f0_visual_only",connected:false},200,method);
    }
    const contextMatch=ROUTE_COMPANY.exec(url.pathname);
    const isMe=url.pathname==="/api/v1/me";
    const isCompanies=url.pathname==="/api/v1/companies";
    const isLogout=url.pathname==="/api/v1/session/logout";
    if(url.search || !(isMe||isCompanies||contextMatch||isLogout))return json({error:"not_found"},404,method);
    if((isLogout&&method!=="POST")||(!isLogout&&method!=="GET"&&method!=="HEAD"))
      return json({error:"method_not_allowed"},405,method);
    try {
      // Sem F1_RUNTIME_ENABLED no manifest: bloqueio mesmo que alguém publique o código por engano.
      if(!["licita.local.test","localhost","127.0.0.1"].includes(url.hostname)||
        env?.F1_RUNTIME_ENABLED!=="test_local_only"||!env?.DB?.prepare||!env.DB.batch)
        throw new SecurityError("f1_not_enabled",503);
      if(isLogout) sameOrigin(request,env);
      const principal=await authenticateAccess(request,env,fetchKeys||fetch);
      await assertSessionActive(env.DB,principal);
      const user=await env.DB.prepare(
        "SELECT id,nome,email_normalizado FROM usuarios "+
        "WHERE access_issuer=? AND access_subject=? AND ativo=1 LIMIT 1"
      ).bind(principal.issuer,principal.subject).first();
      if(!user)throw new SecurityError("forbidden",403);
      if(isMe) return json({
        user:{id:user.id,name:user.nome||"Usuário",email:user.email_normalizado},
        session:{expiresAt:principal.expiresAt}
      },200,method);
      if(isCompanies){
        const result=await env.DB.prepare(
          "SELECT e.id AS id,e.nome AS name,ue.papel AS role "+
          "FROM empresas e JOIN usuarios_empresas ue ON ue.empresa_id=e.id "+
          "WHERE ue.usuario_id=? AND ue.ativo=1 AND e.ativo=1 "+
          "AND ue.papel IN ('ADMIN','OPERADOR','CONSULTA') "+
          "ORDER BY e.nome,e.id LIMIT 101"
        ).bind(user.id).all();
        if(!Array.isArray(result?.results)||result.results.length>100)
          throw new SecurityError("identity_unavailable",503);
        return json({companies:result.results},200,method);
      }
      if(contextMatch){
        const companyId=contextMatch[1];
        const actor=await requireCompanyRole(env.DB,principal,companyId,"read");
        const company=await env.DB.prepare(
          "SELECT id,nome FROM empresas WHERE id=? AND ativo=1 LIMIT 1"
        ).bind(companyId).first();
        if(!company) throw new SecurityError("forbidden",403);
        return json({company:{id:company.id,name:company.nome,role:actor.role},
          profile:{id:user.id,name:user.nome||"Usuário"},
          permissions:{canRead:true,canWrite:actor.role!=="CONSULTA",canApprove:actor.role==="ADMIN"}
        },200,method);
      }
      const body=await parseLogout(request);
      // A R7 exige membership para escrever journal e revogação do JWT *atual*.
      const result=await revokeCurrentSession(env.DB,principal,body.companyId,{intentId:body.intentId});
      return json({revoked:result.revoked===true},200,method);
    } catch(error) {
      if(error instanceof SecurityError||error instanceof DomainError) {
        const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=503?error.status:403;
        const code=ERRORS.has(error.code)?error.code:status===403?"forbidden":"request_rejected";
        return json({error:code},status,method);
      }
      // Erros de D1/rede/serviço externo não devem vazar SQL ou metadados.
      return json({error:"identity_unavailable"},503,method);
    }
  };
}
