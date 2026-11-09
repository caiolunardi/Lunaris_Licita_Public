// F8: D1/R2 local ou candidato A3 HML estritamente sintético.
// NENHUMA API externa, R2.delete, URL pública, Drive real, nem backup presumido.
import {authenticateAccess,requireCompanyRole,SecurityError} from "../../src/r7/security.mjs";
import {assertSessionActive,requireEntityPermission,requireDocumentPermission} from "../../src/r7/iam.mjs";
import {DomainError,identifier,strictlyObject} from "../../src/r7/domain.mjs";
import {OWNER_ROLES,readDocumentHistoricVersion} from "../../src/r7/document-service.mjs";
import {uploadStreamToR2} from "../../src/r7/document-stream-e4.mjs";
import {reviewArchiveEligibility} from "../../src/r7/archive-eligibility.mjs";
import {beginArchiveCopy,inspectArchiveAttempt} from "../../src/r7/archive-e4.mjs";
import {uploadDocumentVersionStream} from "./f8-version-stream.mjs";
import {a3F8RuntimeMode} from "./a3-runtime-gate.mjs";
import {drainPreflightedUpload} from "../../src/r7/stream-drain.mjs";

const ROUTE=/^\/api\/v1\/companies\/([A-Za-z0-9_-]{1,128})\/files(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/([A-Za-z0-9_-]{1,128}))?$/;
const FIXED={"cache-control":"private, no-store, max-age=0","vary":"cf-access-jwt-assertion",
 "x-frame-options":"DENY","x-content-type-options":"nosniff","referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'; frame-ancestors 'none'"};
const TYPES=Object.freeze({licitacao:"LICITACAO",empenho:"EMPENHO",compra:"COMPRA",
 envio:"ENVIO",nota_fiscal:"NOTA_FISCAL",titulo_pagar:"TITULO_PAGAR",
 titulo_baixa:"TITULO_BAIXA",conta_receber:"CONTA_RECEBER",recebimento:"RECEBIMENTO"});
const FIELDS="d.id,d.tipo,d.titulo,d.versao,d.versao_corrente_id,d.origem_dado,d.conferencia,"+
 "v.numero_versao,v.mime_type,v.tamanho_bytes,v.sha256,v.estado_integridade,"+
 "v.criado_em AS versao_criada_em";
const JOIN=" FROM documentos d LEFT JOIN documento_versoes v ON "+
 "v.id=d.versao_corrente_id AND v.empresa_id=d.empresa_id AND v.documento_id=d.id";
function json(data,status=200,method="GET"){
 return new Response(method==="HEAD"?null:JSON.stringify(data),{status,headers:{
  ...FIXED,"content-type":"application/json; charset=utf-8"}});
}
function origin(req,env){
 const expected=env?.APP_ORIGIN;
 if(typeof expected!=="string"||!/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]{2,5})?$/.test(expected))
  throw new SecurityError("app_origin_not_configured",503);
 if(new URL(req.url).origin!==expected||req.headers.get("origin")!==expected)
  throw new SecurityError("invalid_origin",403);
}
function noSearch(url){if(url.search)throw new DomainError("invalid_list",400);}
async function bodyJSON(req){
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get("content-type")||""))
  throw new DomainError("json_content_type_required",415);
 const n=Number(req.headers.get("content-length")||"0");
 if(!Number.isSafeInteger(n)||n>8192)throw new DomainError("payload_too_large",413);
 const raw=await req.text();
 if(new TextEncoder().encode(raw).byteLength>8192)throw new DomainError("payload_too_large",413);
 try{return JSON.parse(raw);}catch{throw new DomainError("invalid_json",400);}
}
function schema(p,method){
 const [,company,a,b,c,d]=p;
 if(!a&&["GET","HEAD"].includes(method))return {kind:"list",company};
 if(a==="upload"&&!b&&method==="POST")return {kind:"upload",company};
 if(a==="owners"&&!b&&["GET","HEAD"].includes(method))return {kind:"owners",company};
 if(a&&a!=="upload"&&!b&&["GET","HEAD"].includes(method))return {kind:"detail",company,doc:a};
 if(a&&b==="content"&&!c&&method==="GET")return {kind:"content",company,doc:a};
 if(a&&b==="versions"&&c==="stream"&&!d&&method==="POST")
  return {kind:"version_stream",company,doc:a};
 if(a&&b==="versions"&&c&&!d&&method==="GET")return {kind:"version_detail",company,doc:a,version:c};
 if(a&&b==="versions"&&c&&d==="content"&&method==="GET")
  return {kind:"version_content",company,doc:a,version:c};
 if(a&&b==="versions"&&c&&d==="archive-preview"&&method==="GET")
  return {kind:"archive_preview",company,doc:a,version:c};
 if(a&&b==="versions"&&c&&d==="archive-copy"&&method==="POST")
  return {kind:"archive_copy",company,doc:a,version:c};
 if(a==="archive-attempts"&&b&& !c&&["GET","HEAD"].includes(method))
  return {kind:"archive_attempt",company,intent:b};
 return null;
}
function noDomainLeak(error){
 if(error instanceof SecurityError||error instanceof DomainError){
  const st=Number.isInteger(error.status)&&error.status>=400&&error.status<=503?error.status:400;
  const supported=new Set(["f8_not_enabled","invalid_origin","app_origin_not_configured",
   "invalid_list","invalid_document_reference","invalid_fields","invalid_id",
   "invalid_json","json_content_type_required","payload_too_large","document_too_large",
   "stream_content_length_or_hash_required","invalid_stream_document_metadata",
   "stream_r2_unavailable","stream_r2_copy_uncertain","stream_size_mismatch_or_orphan",
   "stream_digest_mismatch_or_orphan","stream_db_conflict_or_orphan_requires_review",
   "stream_db_incomplete_requires_review","document_role_already_active",
   "document_owner_not_found","document_not_available","document_bytes_unavailable",
   "document_integrity_mismatch","document_version_conflict","invalid_document_version_request",
   "document_version_db_conflict_requires_reconciliation","version_stream_hash_mismatch",
   "version_stream_size_mismatch","version_stream_write_uncertain","version_stream_invalid",
   "idempotency_conflict","archive_not_due_or_financial_hold","archive_owner_or_version_unverified",
   "archive_independent_adapters_unavailable","archive_attempt_already_reserved",
   "archive_copy_uncertain_manual_reconciliation_required","archive_attempt_not_found",
   "entity_unavailable","forbidden","invalid_token","invalid_session","session_revoked",
   "access_token_required"]);
  return {status:st,error:supported.has(error.code)?error.code:"request_rejected"};
 }
 return {status:503,error:"f8_unavailable"};
}
async function docGate(db,p,company,doc,action){
 await requireDocumentPermission(db,p,company,identifier(doc),action);
 await documentParents(db,p,company,doc,action);
 const row=await db.prepare("SELECT "+FIELDS+JOIN+" WHERE d.empresa_id=? AND d.id=?")
  .bind(company,doc).first();
 if(!row)throw new DomainError("entity_unavailable",404);
 return row;
}
async function versionGate(db,p,company,doc,version,action){
 const row=await docGate(db,p,company,doc,action);
 await requireEntityPermission(db,p,company,"DOCUMENTO_VERSAO",identifier(version),action);
 const v=await db.prepare("SELECT id FROM documento_versoes "+
  "WHERE id=? AND empresa_id=? AND documento_id=?").bind(version,company,doc).first();
 if(!v)throw new DomainError("entity_unavailable",404);
 return row;
}
// ACL do documento inclui TODOS os seus vínculos e ancestrais comerciais.
// Sem isso, uma negativa em LICITACAO poderia vazar documento de seu EMPENHO.
async function documentParents(db,p,company,doc,action){
 const links=(await db.prepare("SELECT licitacao_id,empenho_id,compra_id,envio_id,"+
  "nota_fiscal_id,titulo_pagar_id,titulo_baixa_id,conta_receber_id,recebimento_id "+
  "FROM documento_vinculos WHERE empresa_id=? AND documento_id=? AND ativo=1 "+
  "ORDER BY id LIMIT 101").bind(company,doc).all())?.results||[];
 if(links.length===0||links.length>100)throw new DomainError("entity_unavailable",404);
 for(const link of links){
  let count=0;
  for(const [type,spec] of Object.entries(ownerSpecs)){
   const id=link[spec.field];
   if(id!==null&&id!==undefined){count++;await parentGate(db,p,company,type,id,action);}
  }
  if(count!==1)throw new DomainError("entity_unavailable",404);
 }
}

const ownerSpecs={
 licitacao:{table:"licitacoes",field:"licitacao_id",parents:[]},
 empenho:{table:"empenhos",field:"empenho_id",parents:[["LICITACAO","licitacao_id"]]},
 compra:{table:"compras",field:"compra_id",parents:[["EMPENHO","empenho_id"]]},
 envio:{table:"envios",field:"envio_id",parents:[["EMPENHO","empenho_id"]]},
 nota_fiscal:{table:"notas_fiscais",field:"nota_fiscal_id",parents:[["EMPENHO","empenho_id"]]},
 titulo_pagar:{table:"titulos_pagar",field:"titulo_pagar_id",parents:[["COMPRA","compra_id"]]},
 titulo_baixa:{table:"titulo_baixas",field:"titulo_baixa_id",parents:[["TITULO_PAGAR","titulo_id"]]},
 conta_receber:{table:"contas_receber",field:"conta_receber_id",parents:[["NOTA_FISCAL","nota_fiscal_id"]]},
 recebimento:{table:"recebimentos",field:"recebimento_id",parents:[["CONTA_RECEBER","conta_receber_id"]]}
};
async function parentGate(db,p,company,type,id,action,depth=0){
 if(depth>7)throw new DomainError("invalid_document_reference",400);
 const spec=ownerSpecs[type];
 if(!spec)throw new DomainError("invalid_document_reference",400);
 await requireEntityPermission(db,p,company,TYPES[type],identifier(id),action);
 const row=await db.prepare("SELECT * FROM "+spec.table+" WHERE id=? AND empresa_id=?")
  .bind(id,company).first();
 if(!row)throw new DomainError("entity_unavailable",404);
 for(const [t,col] of spec.parents){
  const parent=row[col];
  if(parent)await parentGate(db,p,company,
   Object.keys(TYPES).find(key=>TYPES[key]===t),parent,action,depth+1);
 }
}
async function uploadGate(db,p,company,req){
 const type=req.headers.get("x-doc-owner-type"),id=identifier(req.headers.get("x-doc-owner-id"));
 const role=req.headers.get("x-doc-role");
 if(!Object.hasOwn(OWNER_ROLES,type)||!OWNER_ROLES[type].roles.includes(role))
  throw new DomainError("invalid_stream_document_metadata",400);
 await parentGate(db,p,company,type,id,"WRITE");
}
// F8 owner picker: somente IDs já autorizados; nenhuma busca cruzada ou valor inventado.
const LABELS=Object.freeze({licitacao:"numero",empenho:"numero",compra:"numero_pedido",
 envio:"codigo_rastreio",nota_fiscal:"numero",titulo_pagar:"beneficiario",
 titulo_baixa:"id",conta_receber:"parcela",recebimento:"data_credito"});
async function owners(db,p,company,url){
 if([...url.searchParams.keys()].some(k=>k!=="type"||url.searchParams.getAll(k).length!==1))
  throw new DomainError("invalid_list",400);
 const type=url.searchParams.get("type");
 if(!Object.hasOwn(ownerSpecs,type))throw new DomainError("invalid_list",400);
 const label=LABELS[type],table=ownerSpecs[type].table;
 const records=(await db.prepare("SELECT id,coalesce(nullif(trim(CAST("+label+
  " AS TEXT)),''),id) AS label FROM "+table+" WHERE empresa_id=? ORDER BY id LIMIT 501")
  .bind(company).all())?.results||[];
 if(records.length>500)throw new DomainError("invalid_list",409);
 const items=[];
 for(const item of records){
  try{await parentGate(db,p,company,type,item.id,"READ");items.push(item);}
  catch(e){
   if(!(e instanceof SecurityError||e instanceof DomainError))throw e;
   if(e.status===401)throw e;
  }
 }
 return {items};
}

async function list(db,p,company,url){
 const allow=new Set(["q","limit","after","type"]);
 for(const key of url.searchParams.keys())
  if(!allow.has(key)||url.searchParams.getAll(key).length!==1)throw new DomainError("invalid_list",400);
 const limit=url.searchParams.has("limit")?Number(url.searchParams.get("limit")):25;
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new DomainError("invalid_list",400);
 const q=(url.searchParams.get("q")||"").trim();
 if(q.length>100||/[\u0000-\u001f\u007f]/.test(q))throw new DomainError("invalid_list",400);
 const type=url.searchParams.get("type");
 if(type!==null&&!/^[A-Z][A-Z_]{2,63}$/.test(type))throw new DomainError("invalid_list",400);
 const after=url.searchParams.get("after");if(after!==null)identifier(after);
 const values=[company],where=["d.empresa_id=?"];
 if(q){const escaped="%"+q.toLocaleLowerCase("pt-BR").replace(/[\\%_]/g,s=>"\\"+s)+"%";
   where.push("lower(coalesce(d.titulo,'')) LIKE ? ESCAPE '\\'");values.push(escaped);}
 if(type){where.push("d.tipo=?");values.push(type);}
 if(after){where.push("d.id>?");values.push(after);}
 const raw=(await db.prepare("SELECT "+FIELDS+JOIN+" WHERE "+where.join(" AND ")+
  " ORDER BY d.id LIMIT 5001").bind(...values).all())?.results||[];
 if(raw.length>5000)throw new DomainError("invalid_list",409);
 const items=[];
 for(const record of raw){
  try{
   await docGate(db,p,company,record.id,"READ");
   await requireEntityPermission(db,p,company,"DOCUMENTO_VERSAO",
    record.versao_corrente_id,"READ");
   items.push(record);
  }catch(e){
   if(!(e instanceof SecurityError||e instanceof DomainError))throw e;
   if(e.status===401)throw e; // sessão revogada: não devolver resultado parcial
  }
  if(items.length>limit)break;
 }
 return {items:items.slice(0,limit),nextCursor:items.length>limit?items[limit-1].id:null,limit,
  countVisible:items.slice(0,limit).length};
}
async function detail(db,p,company,id){
 const doc=await docGate(db,p,company,id,"READ");
 const raw=(await db.prepare("SELECT v.id,v.numero_versao,v.nome_original,v.mime_type,"+
  "v.tamanho_bytes,v.sha256,v.estado_integridade,v.origem_dado,v.conferencia,"+
  "v.criado_em,v.enviado_por FROM documento_versoes v WHERE v.empresa_id=? "+
  "AND v.documento_id=? ORDER BY v.numero_versao DESC LIMIT 501")
  .bind(company,id).all())?.results||[];
 if(raw.length>500)throw new DomainError("invalid_list",409);
 const versions=[];
 for(const v of raw){
  await requireEntityPermission(db,p,company,"DOCUMENTO_VERSAO",v.id,"READ");
  const loc=(await db.prepare("SELECT provedor,status,verificado_em,hash_verificado,"+
   "tamanho_verificado FROM documento_localizacoes WHERE empresa_id=? AND versao_id=? "+
   "ORDER BY id LIMIT 101").bind(company,v.id).all())?.results||[];
  if(loc.length>100)throw new DomainError("invalid_list",409);
  versions.push({...v,locations:loc});
 }
 const links=(await db.prepare("SELECT id,papel,licitacao_id,empenho_id,compra_id,envio_id,"+
  "nota_fiscal_id,titulo_pagar_id,titulo_baixa_id,conta_receber_id,recebimento_id "+
  "FROM documento_vinculos WHERE empresa_id=? AND documento_id=? AND ativo=1 ORDER BY id")
  .bind(company,id).all())?.results||[];
 return {item:doc,versions,owners:links,archiveCopyAvailable:false,
  r2DeletionAuthorized:false};
}
async function download(db,r2,p,company,doc,version){
 await versionGate(db,p,company,doc,version,"READ");
 const result=await readDocumentHistoricVersion(db,r2,p,company,doc,version);
 const ext={"application/pdf":".pdf","application/xml":".xml","image/png":".png",
  "image/jpeg":".jpg","text/plain":".txt"}[result.mime]||".bin";
 const headers={...FIXED,"content-type":"application/octet-stream",
  "content-disposition":'attachment; filename="documento-verificado-'+version.slice(0,8)+ext+'"',
  "x-content-sha256":result.sha256,"content-length":String(result.bytes.byteLength)};
 return new Response(result.bytes,{status:200,headers});
}
function routed(parts,method){
 const p=schema(parts,method);
 if(!p)return null;
 if(p.kind==="detail"&&["upload","archive-attempts"].includes(p.doc))return null;
 return p;
}
export function createF8Handler({fetchKeys,archiveAdapters}={}){
 return async(request,env)=>{
  const url=new URL(request.url),parts=ROUTE.exec(url.pathname);
  if(!parts)return null;
  const method=request.method.toUpperCase(),route=routed(parts,method);
  if(!route)return json({error:"method_not_allowed"},405,method);
  try{
   if(!a3F8RuntimeMode(request,env))throw new SecurityError("f8_not_enabled",503);
   if(route.kind!=="list"&&route.kind!=="owners")noSearch(url);
   if(method==="POST")origin(request,env);
   const principal=await authenticateAccess(request,env,fetchKeys||fetch);
   await assertSessionActive(env.DB,principal);
   await requireCompanyRole(env.DB,principal,route.company,method==="POST"?"write":"read");
   const db=env.DB,company=route.company;
   let result;
   if(route.kind==="list")result=await list(db,principal,company,url);
   else if(route.kind==="owners")result=await owners(db,principal,company,url);
   else if(route.kind==="detail")result=await detail(db,principal,company,route.doc);
   else if(route.kind==="version_detail"){
    await versionGate(db,principal,company,route.doc,route.version,"READ");
    result=(await detail(db,principal,company,route.doc)).versions.find(v=>v.id===route.version);
    if(!result)throw new DomainError("entity_unavailable",404);
   }else if(route.kind==="content"||route.kind==="version_content"){
    const detailRow=route.kind==="content"?await docGate(db,principal,company,route.doc,"READ"):null;
    const id=route.kind==="content"?detailRow?.versao_corrente_id:route.version;
    if(!id)throw new DomainError("entity_unavailable",404);
    return await download(db,env.R2,principal,company,route.doc,id);
   }else if(route.kind==="upload"){
    await uploadGate(db,principal,company,request);
    result=await uploadStreamToR2(db,env.R2,principal,company,request);
   }else if(route.kind==="version_stream"){
    await docGate(db,principal,company,route.doc,"WRITE");
    result=await uploadDocumentVersionStream(db,env.R2,principal,company,route.doc,request);
   }else if(route.kind==="archive_preview"){
    await requireCompanyRole(db,principal,company,"approve");
    await versionGate(db,principal,company,route.doc,route.version,"READ");
    result=await reviewArchiveEligibility(db,principal,company,
     {documentoId:route.doc,versaoId:route.version});
   }else if(route.kind==="archive_copy"){
    await requireCompanyRole(db,principal,company,"approve");
    await versionGate(db,principal,company,route.doc,route.version,"WRITE");
    const body=await bodyJSON(request);
    strictlyObject(body,new Set(["intentId"]));
    if(!archiveAdapters)throw new DomainError("archive_independent_adapters_unavailable",503);
    result=await beginArchiveCopy(db,principal,company,{
     intentId:body.intentId,documentoId:route.doc,documentoVersaoId:route.version},
     {...archiveAdapters,r2:env.R2});
   }else if(route.kind==="archive_attempt"){
    await requireCompanyRole(db,principal,company,"approve");
    result=await inspectArchiveAttempt(db,principal,company,route.intent);
   }
   return json(result,method==="POST"&&!result.replayed?201:200,method);
  }catch(e){
   // Apenas metadados recusados apos host, Origin, JWT e vinculo na empresa.
   // Workerd/Miniflare pode resetar POST com bytes não consumidos.
   if((route.kind==="upload"&&e instanceof DomainError&&
       e.code==="invalid_stream_document_metadata")||
      (route.kind==="version_stream"&&e instanceof DomainError&&
       e.code==="version_stream_invalid")){
    const n=Number(request.headers.get("content-length"));
    if(Number.isSafeInteger(n)&&n>=1&&n<=8*1024*1024&&
       request.body&&!request.bodyUsed){
     try{await drainPreflightedUpload(request,n,"stream_size_mismatch_or_orphan");}
     catch{ /* segue negado com o erro original; nenhum dado persistido */ }
    }
   }
   const failure=noDomainLeak(e);
   return json({error:failure.error},failure.status,method);
  }
 };
}
