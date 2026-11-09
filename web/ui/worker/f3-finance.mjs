// F3: compromissos, contas avulsas, regras mensais e baixas, SOMENTE em D1 sintético local.
// Sem flag F3 e hostname local, todos os endpoints retornam HTTP 503.
// Contratos de pagamento e recorrência já auditados na R7 são reutilizados, não copiados.
import {authenticateAccess,requireCompanyRole,SecurityError} from "../../src/r7/security.mjs";
import {assertSessionActive,assertEntityNotBlocked,requireEntityPermission,
  requireDocumentPermission,assertAggregateAccess} from "../../src/r7/iam.mjs";
import {DomainError,strictlyObject,identifier,money,positiveInt,dateCivil,
  dueDateForCompetence,hashIntent,replayOrConflict,requireBatch,
  updateTitleObservation} from "../../src/r7/domain.mjs";
import {recordPayment,undoPayment} from "../../src/r7/payments.mjs";
import {materializeRecurrence} from "../../src/r7/recurrence.mjs";
import {reviseRecurringAmount,setRecurringLastMonth} from "../../src/r7/recurrence-revisions.mjs";
import {reviseTitle,cancelTitle} from "../../src/r7/title-commands.mjs";
import {monthlyCommitmentPreview} from "../../src/r7/monthly-preview.mjs";

const BASE=/^\/api\/v1\/companies\/([A-Za-z0-9_-]{1,128})\/finance\/([a-z-]+)(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/([a-z-]+))?(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/([a-z-]+))?$/;
const HOSTS=new Set(["licita.local.test","localhost","127.0.0.1"]);
const UUID=/^[A-Za-z0-9_-]{1,128}$/;
const HEADERS={"content-type":"application/json; charset=utf-8",
 "cache-control":"private, no-store, max-age=0","x-content-type-options":"nosniff",
 "x-frame-options":"DENY","referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'; frame-ancestors 'none'",
 "vary":"cf-access-jwt-assertion"};
const ERRORS=new Set(["f3_not_enabled","invalid_origin","app_origin_not_configured",
 "access_token_required","invalid_token","access_not_configured","access_keys_unavailable",
 "access_keys_invalid","invalid_session","session_revoked","forbidden",
 "entity_unavailable","document_owner_unavailable","aggregate_with_restricted_rows",
 "invalid_json","invalid_fields","invalid_id","invalid_page","invalid_cursor",
 "invalid_month","invalid_amount","invalid_name","invalid_date","invalid_title",
 "invalid_recurrence","json_content_type_required","payload_too_large",
 "idempotency_conflict","create_conflict","version_conflict","recurrence_not_active_or_stale",
 "recurrence_conflict","recurrence_revision_conflict","recurrence_end_conflict",
 "payment_conflict","payment_not_allowed","undo_conflict","undo_not_allowed",
 "title_revision_conflict","title_cancel_conflict","title_revision_not_allowed",
 "title_reason_required","too_many_financial_lines","monthly_amount_overflow",
 "past_competence_disabled","recurrence_revisions_require_reconciliation",
 "monthly_revision_requires_historical_reconciliation"]);
function json(value,status=200,method="GET"){
 return new Response(method==="HEAD"?null:JSON.stringify(value),{status,headers:HEADERS});
}
function originGuard(request,env){
 const expected=env?.APP_ORIGIN;
 if(typeof expected!=="string"||!/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]{2,5})?$/.test(expected))
  throw new SecurityError("app_origin_not_configured",503);
 if(request.headers.get("origin")!==expected||new URL(request.url).origin!==expected)
  throw new SecurityError("invalid_origin",403);
}
async function inputJSON(request){
 const type=request.headers.get("content-type")||"";
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type))
   throw new DomainError("json_content_type_required",415);
 const len=Number(request.headers.get("content-length")||0);
 if(!Number.isFinite(len)||len>8192)throw new DomainError("payload_too_large",413);
 const raw=await request.text();
 if(new TextEncoder().encode(raw).byteLength>8192)throw new DomainError("payload_too_large",413);
 try{return JSON.parse(raw);}catch{throw new DomainError("invalid_json",400);}
}
function month(v){if(typeof v!=="string"||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(v))throw new DomainError("invalid_month");dueDateForCompetence(v,1);return v;}
function textVal(v,max,code="invalid_name"){
 if(typeof v!=="string"||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))
  throw new DomainError(code);
 return v.trim();
}
function optionalText(v,max){
 if(v===null||v===undefined||v==="")return null;
 return textVal(v,max,"invalid_fields");
}
const exact=(obj,keys)=>{strictlyObject(obj,new Set(keys));return obj;};
function positiveMoney(v){
 if(!positiveInt(v)||!money(v))throw new DomainError("invalid_amount");
 return v;
}
function page(url,kind){
 const allowed=kind==="titles"?new Set(["limit","after","month","state","q"]):
  new Set(["limit","after","state","q"]);
 for(const k of url.searchParams.keys())
  if(!allowed.has(k)||url.searchParams.getAll(k).length!==1)throw new DomainError("invalid_page");
 const n=url.searchParams.get("limit");
 const limit=n===null?25:Number(n);
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new DomainError("invalid_page");
 const after=url.searchParams.get("after");
 if(after!==null&&!UUID.test(after))throw new DomainError("invalid_cursor");
 const q=url.searchParams.get("q")||"";
 if(q.length>80||/[\u0000-\u001f\u007f]/.test(q))throw new DomainError("invalid_page");
 const state=url.searchParams.get("state")||"active";
 const available=kind==="titles"?["active","paid","all","cancelled"]:["active","all","ended"];
 if(!available.includes(state))throw new DomainError("invalid_page");
 const date=url.searchParams.get("month");
 return {limit,after,q:q.trim(),state,month:kind==="titles"&&date?month(date):null};
}
const escapeLike=s=>s.replace(/[\\%_]/g,c=>"\\"+c);
function conditionsTitle(filter,actor){
 const where=["t.empresa_id=?",
  "NOT EXISTS(SELECT 1 FROM r7_acl_bloqueios b WHERE b.empresa_id=t.empresa_id "+
   "AND b.usuario_id=? AND b.tipo_entidade='TITULO_PAGAR' "+
   "AND b.entidade_id=t.id AND b.acao IN ('READ','ALL'))"];
 const vals=[actor.companyId,actor.userId];
 if(filter.state==="active")where.push("s.situacao='ABERTO'");
 if(filter.state==="paid")where.push("s.situacao IN ('PAGO','PAGO_LEGADO_SEM_BAIXA')");
 if(filter.state==="cancelled")where.push("s.situacao='CANCELADO'");
 if(filter.month){where.push("substr(t.vencimento,1,7)=?");vals.push(filter.month);}
 if(filter.q){
  where.push("(lower(coalesce(t.beneficiario,t.fornecedor_nome_original,f.nome,'')) LIKE ? ESCAPE '\\' OR "+
   "lower(coalesce(t.categoria_despesa,'')) LIKE ? ESCAPE '\\')");
  vals.push("%"+escapeLike(filter.q.toLocaleLowerCase("pt-BR"))+"%",
            "%"+escapeLike(filter.q.toLocaleLowerCase("pt-BR"))+"%");
 }
 return {where,vals};
}
const TITLE_COLUMNS="t.id,t.tipo,t.beneficiario,t.categoria_despesa,t.fornecedor_id,"+
 "coalesce(t.fornecedor_nome_original,f.nome) AS fornecedor_nome,t.descricao_boleto,"+
 "t.valor_nominal_cent,t.vencimento,t.recorrencia_id,t.competencia,t.observacoes,"+
 "t.cancelado,t.pago_legado_status,t.origem_dado,t.conferencia,t.versao,s.situacao";
async function listTitles(db,actor,url){
 const p=page(url,"titles"),{where,vals}=conditionsTitle(p,actor);
 const join=" FROM titulos_pagar t JOIN v_titulos_situacao s ON s.id=t.id "+
   "AND s.empresa_id=t.empresa_id LEFT JOIN fornecedores f ON f.id=t.fornecedor_id AND f.empresa_id=t.empresa_id";
 const sort="coalesce(t.vencimento,'9999-12-31')";
 if(p.after){
  const cur=await db.prepare("SELECT "+sort+" AS sort_date "+join+
    " WHERE "+where.join(" AND ")+" AND t.id=?").bind(...vals,p.after).first();
  if(!cur)throw new DomainError("invalid_cursor",400);
  where.push("("+sort+">? OR ("+sort+"=? AND t.id>?))");
  vals.push(cur.sort_date,cur.sort_date,p.after);
 }
 const result=await db.prepare("SELECT "+TITLE_COLUMNS+join+" WHERE "+where.join(" AND ")+
   " ORDER BY "+sort+",t.id LIMIT ?").bind(...vals,p.limit+1).all();
 const rows=result?.results||[];
 return {items:rows.slice(0,p.limit),nextCursor:rows.length>p.limit?rows[p.limit-1].id:null,limit:p.limit};
}
const REC_COLUMNS="id,beneficiario,categoria_despesa,descricao_boleto,valor_atual_cent,"+
 "dia_vencimento,primeiro_vencimento,ultima_competencia,estado,origem_dado,conferencia,versao";
async function listRecurrences(db,actor,url){
 const p=page(url,"recurrences");
 const where=["r.empresa_id=?",
  "NOT EXISTS(SELECT 1 FROM r7_acl_bloqueios b WHERE b.empresa_id=r.empresa_id "+
  "AND b.usuario_id=? AND b.tipo_entidade='RECORRENCIA' AND b.entidade_id=r.id "+
  "AND b.acao IN ('READ','ALL'))"];
 const vals=[actor.companyId,actor.userId];
 if(p.state==="active")where.push("r.estado='ATIVA'");
 if(p.state==="ended")where.push("r.estado<>'ATIVA'");
 if(p.q){where.push("lower(r.beneficiario) LIKE ? ESCAPE '\\'");
  vals.push("%"+escapeLike(p.q.toLocaleLowerCase("pt-BR"))+"%");}
 if(p.after){
  const cur=await db.prepare("SELECT r.beneficiario FROM recorrencias r "+
    "WHERE "+where.join(" AND ")+" AND r.id=?").bind(...vals,p.after).first();
  if(!cur)throw new DomainError("invalid_cursor");
  where.push("(r.beneficiario>? OR (r.beneficiario=? AND r.id>?))");
  vals.push(cur.beneficiario,cur.beneficiario,p.after);
 }
 const result=await db.prepare("SELECT "+REC_COLUMNS+" FROM recorrencias r "+
  "WHERE "+where.join(" AND ")+" ORDER BY r.beneficiario,r.id LIMIT ?")
  .bind(...vals,p.limit+1).all();
 const rows=result?.results||[];
 return {items:rows.slice(0,p.limit),nextCursor:rows.length>p.limit?rows[p.limit-1].id:null,limit:p.limit};
}
async function titleDetail(db,principal,company,id){
 await requireEntityPermission(db,principal,company,"TITULO_PAGAR",id,"READ");
 const row=await db.prepare("SELECT "+TITLE_COLUMNS+
   " FROM titulos_pagar t JOIN v_titulos_situacao s ON s.id=t.id AND s.empresa_id=t.empresa_id "+
   " LEFT JOIN fornecedores f ON f.id=t.fornecedor_id AND f.empresa_id=t.empresa_id "+
   " WHERE t.id=? AND t.empresa_id=?").bind(id,company).first();
 if(!row)throw new DomainError("entity_unavailable",404);
 const ba=await db.prepare(
  "SELECT id,tipo,baixa_original_id,data_pagamento,valor_pago_cent,comprovante_documento_id,"+
  "motivo,origem_dado,conferencia,criado_em FROM titulo_baixas "+
  "WHERE titulo_id=? AND empresa_id=? ORDER BY criado_em,id LIMIT 501"
 ).bind(id,company).all();
 if(!Array.isArray(ba?.results)||ba.results.length>500)
  throw new DomainError("too_many_financial_lines",409);
 // Histórico nunca parcial: se uma baixa está bloqueada, a ficha inteira é negada.
 for(const event of ba.results)await assertEntityNotBlocked(db,principal,company,"TITULO_BAIXA",event.id,"READ");
 return {item:row,payments:ba.results};
}
async function recurrenceDetail(db,principal,company,id){
 await requireEntityPermission(db,principal,company,"RECORRENCIA",id,"READ");
 const row=await db.prepare("SELECT "+REC_COLUMNS+
  " FROM recorrencias WHERE id=? AND empresa_id=?").bind(id,company).first();
 if(!row)throw new DomainError("entity_unavailable",404);
 const revisions=await db.prepare(
  "SELECT tipo,valor_antes_cent,valor_depois_cent,fim_depois,vigente_a_partir,criado_em "+
  "FROM recorrencia_revisoes WHERE empresa_id=? AND recorrencia_id=? "+
  "ORDER BY criado_em,id LIMIT 501"
 ).bind(company,id).all();
 if(!Array.isArray(revisions?.results)||revisions.results.length>500)
  throw new DomainError("too_many_financial_lines",409);
 return {item:row,revisions:revisions.results};
}
function memberCondition(){
 return "EXISTS(SELECT 1 FROM usuarios u JOIN usuarios_empresas ue ON ue.usuario_id=u.id "+
 "JOIN empresas e ON e.id=ue.empresa_id WHERE u.id=? "+
 "AND u.access_issuer=? AND u.access_subject=? AND u.ativo=1 "+
 "AND ue.empresa_id=? AND ue.ativo=1 AND ue.papel IN ('ADMIN','OPERADOR') AND e.ativo=1)";
}
async function createOneOff(db,principal,actor,company,body){
 requireBatch(db);
 exact(body,["intentId","tipo","beneficiario","categoriaDespesa","descricao","fornecedorId",
  "fornecedorNome","valorCent","vencimento","observacoes"]);
 const intent=identifier(body.intentId),type=body.tipo;
 if(type!=="DIVERSO"&&type!=="FORNECEDOR")throw new DomainError("invalid_title");
 const val=positiveMoney(body.valorCent);
 if(!dateCivil(body.vencimento))throw new DomainError("invalid_date");
 const desc=optionalText(body.descricao,1000),note=optionalText(body.observacoes,4000);
 const benef=type==="DIVERSO"?textVal(body.beneficiario,180):null;
 const category=type==="DIVERSO"?textVal(body.categoriaDespesa,140):null;
 const supplierId=type==="FORNECEDOR"&&body.fornecedorId?identifier(body.fornecedorId):null;
 const supplierName=type==="FORNECEDOR"?optionalText(body.fornecedorNome,180):null;
 if(type==="FORNECEDOR"&&!supplierId&&!supplierName)throw new DomainError("invalid_title");
 if(type==="DIVERSO"&&(body.fornecedorId||body.fornecedorNome))throw new DomainError("invalid_fields");
 if(type==="FORNECEDOR"&&(body.beneficiario||body.categoriaDespesa))throw new DomainError("invalid_fields");
 if(supplierId){
  const supplier=await db.prepare("SELECT 1 AS exists_record FROM fornecedores "+
   "WHERE id=? AND empresa_id=? AND ativo=1").bind(supplierId,company).first();
  if(!supplier)throw new DomainError("invalid_title",409);
 }
 const hash=await hashIntent("F3_CRIAR_TITULO",[
  type,benef,category,desc,supplierId,supplierName,val,body.vencimento,note]);
 const prior=await replayOrConflict(db,company,intent,hash,"F3_CRIAR_TITULO");
 if(prior)return prior;
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const bindAuth=[actor.userId,principal.issuer,principal.subject,company];
 const insert=db.prepare("INSERT INTO titulos_pagar("+
  "id,empresa_id,tipo,beneficiario,categoria_despesa,descricao_boleto,"+
  "fornecedor_id,fornecedor_nome_original,valor_nominal_cent,vencimento,"+
  "observacoes,criado_em,atualizado_em,operacao_id,origem_dado,conferencia) "+
  "SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,'NATIVO','VALIDADO' WHERE "+
   memberCondition()+" AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)")
 .bind(id,company,type,benef,category,desc,supplierId,supplierName,val,
   body.vencimento,note,now,now,intent,...bindAuth,intent);
 const journal=db.prepare(
 "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
 "SELECT ?,?,'F3_CRIAR_TITULO',?,?,'CONCLUIDA','NATIVO','VALIDADO' FROM titulos_pagar "+
 "WHERE id=? AND empresa_id=? AND operacao_id=?"
 ).bind(intent,company,hash,actor.userId,id,company,intent);
 const audit=db.prepare("INSERT INTO eventos_auditoria("+
   "id,empresa_id,tipo_entidade,entidade_id_texto,acao,ator_id,resumo,operacao_id,origem_dado,conferencia) "+
   "SELECT ?,?,'TITULO_PAGAR',?,'CRIAR',?,'Criação de compromisso F3',?,'NATIVO','VALIDADO' "+
   "FROM operacoes WHERE id=? AND empresa_id=? AND tipo='F3_CRIAR_TITULO'")
   .bind(crypto.randomUUID(),company,id,actor.userId,intent,intent,company);
 let result;
 try{result=await db.batch([insert,journal,audit]);}
 catch{throw new DomainError("create_conflict",409);}
 if(result?.length===3&&result.every(x=>x?.meta?.changes===1))
   return {intentId:intent,replayed:false,id,newVersion:1};
 const raced=await replayOrConflict(db,company,intent,hash,"F3_CRIAR_TITULO");
 if(raced)return raced;
 throw new DomainError("create_conflict",409);
}
async function createRecurrence(db,principal,actor,company,body){
 requireBatch(db);
 exact(body,["intentId","beneficiario","categoriaDespesa","descricao","valorCent",
  "diaVencimento","primeiroVencimento"]);
 const intent=identifier(body.intentId),benef=textVal(body.beneficiario,180);
 const category=textVal(body.categoriaDespesa,140),desc=optionalText(body.descricao,1000);
 const val=positiveMoney(body.valorCent),day=body.diaVencimento,first=body.primeiroVencimento;
 if(!Number.isInteger(day)||day<1||day>31||!dateCivil(first))
  throw new DomainError("invalid_recurrence");
 const expected=dueDateForCompetence(first.slice(0,7),day);
 if(expected!==first)throw new DomainError("invalid_recurrence");
 const hash=await hashIntent("F3_CRIAR_RECORRENCIA",[benef,category,desc,val,day,first]);
 const prior=await replayOrConflict(db,company,intent,hash,"F3_CRIAR_RECORRENCIA");
 if(prior)return prior;
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const insert=db.prepare("INSERT INTO recorrencias("+
 "id,empresa_id,beneficiario,categoria_despesa,descricao_boleto,"+
 "valor_atual_cent,dia_vencimento,primeiro_vencimento,estado,"+
 "criado_em,atualizado_em,operacao_id,origem_dado,conferencia) "+
 "SELECT ?,?,?,?,?,?, ?,?,'ATIVA',?,?,?,'NATIVO','VALIDADO' WHERE "+
  memberCondition()+" AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)")
 .bind(id,company,benef,category,desc,val,day,first,now,now,intent,
  actor.userId,principal.issuer,principal.subject,company,intent);
 const journal=db.prepare(
  "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
  "SELECT ?,?,'F3_CRIAR_RECORRENCIA',?,?,'CONCLUIDA','NATIVO','VALIDADO' FROM recorrencias "+
  "WHERE id=? AND empresa_id=? AND operacao_id=?"
 ).bind(intent,company,hash,actor.userId,id,company,intent);
 const audit=db.prepare("INSERT INTO eventos_auditoria("+
  "id,empresa_id,tipo_entidade,entidade_id_texto,acao,ator_id,resumo,operacao_id,origem_dado,conferencia) "+
  "SELECT ?,?,'RECORRENCIA',?,'CRIAR',?,'Criação de regra mensal F3',?,'NATIVO','VALIDADO' "+
  "FROM operacoes WHERE id=? AND empresa_id=? AND tipo='F3_CRIAR_RECORRENCIA'")
  .bind(crypto.randomUUID(),company,id,actor.userId,intent,intent,company);
 let result;
 try{result=await db.batch([insert,journal,audit]);}
 catch{throw new DomainError("create_conflict",409);}
 if(result?.length===3&&result.every(x=>x?.meta?.changes===1))
  return {intentId:intent,replayed:false,id,newVersion:1};
 const raced=await replayOrConflict(db,company,intent,hash,"F3_CRIAR_RECORRENCIA");
 if(raced)return raced;
 throw new DomainError("create_conflict",409);
}
function routeOf(parts,method){
 const [,company,resource,id,action,subId,subAction]=parts;
 if(resource==="monthly"&&!id&&method==="GET")return {kind:"monthly",company};
 if(resource==="titles"){
  if(!id&&(method==="GET"||method==="HEAD"))return {kind:"listTitles",company};
  if(!id&&method==="POST")return {kind:"createTitle",company};
  if(id&&!action&&(method==="GET"||method==="HEAD"))return {kind:"titleDetail",company,id};
  if(id&&action==="payments"&&!subId&&method==="POST")return {kind:"payment",company,id};
  if(id&&action==="payments"&&subId&&subAction==="undo"&&method==="POST")
   return {kind:"undo",company,id,subId};
  if(id&&action==="revise"&&!subId&&method==="POST")return {kind:"revise",company,id};
  if(id&&action==="cancel"&&!subId&&method==="POST")return {kind:"cancel",company,id};
  if(id&&action==="notes"&&!subId&&method==="POST")return {kind:"notes",company,id};
 }
 if(resource==="recurrences"){
  if(!id&&(method==="GET"||method==="HEAD"))return {kind:"listRecurrences",company};
  if(!id&&method==="POST")return {kind:"createRecurrence",company};
  if(id&&!action&&(method==="GET"||method==="HEAD"))return {kind:"recurrenceDetail",company,id};
  if(id&&action==="materialize"&&!subId&&method==="POST")return {kind:"materialize",company,id};
  if(id&&action==="revise-value"&&!subId&&method==="POST")return {kind:"reviseValue",company,id};
  if(id&&action==="end-after"&&!subId&&method==="POST")return {kind:"endAfter",company,id};
 }
 return null;
}
function bodyWithServerId(route,body){
 if(!body||typeof body!=="object"||Array.isArray(body))throw new DomainError("invalid_fields");
 const id=route.id;
 const companyKeys=new Set(["tituloId","recorrenciaId","baixaOriginalId","empresa_id",
  "ator_id","origem_dado","conferencia"]);
 for(const field of companyKeys)if(Object.hasOwn(body,field))throw new DomainError("invalid_fields");
 switch(route.kind){
  case "payment":
    exact(body,["intentId","expectedVersion","dataPagamento","valorPagoCent","comprovanteDocumentoId"]);
    return {...body,tituloId:id};
  case "undo":
    exact(body,["intentId","expectedVersion","motivo"]);
    return {...body,tituloId:id,baixaOriginalId:route.subId};
  case "revise":
    exact(body,["intentId","expectedVersion","novoValorCent","novoVencimento","motivo"]);
    return {...body,tituloId:id};
  case "cancel":
    exact(body,["intentId","expectedVersion","motivo"]);
    return {...body,tituloId:id};
  case "notes":
    exact(body,["intentId","expectedVersion","observacoes"]);
    return {...body,tituloId:id};
  case "materialize":
    exact(body,["intentId","expectedVersion","competencia"]);
    return {...body,recorrenciaId:id};
  case "reviseValue":
    exact(body,["intentId","expectedVersion","vigenteAPartir","valorNovoCent","motivo"]);
    return {...body,recorrenciaId:id};
  case "endAfter":
    exact(body,["intentId","expectedVersion","fimDepois","motivo"]);
    return {...body,recorrenciaId:id};
  default:throw new DomainError("invalid_fields");
 }
}
export function createF3Handler({fetchKeys}={}){
 return async function handle(request,env){
  const url=new URL(request.url),parts=BASE.exec(url.pathname);
  if(!parts)return null;
  const method=request.method.toUpperCase();
  const route=routeOf(parts,method);
  if(!route)return json({error:"method_not_allowed"},405,method);
  try{
   if(!HOSTS.has(url.hostname)||env?.F1_RUNTIME_ENABLED!=="test_local_only"||
     env?.F3_RUNTIME_ENABLED!=="test_local_only"||!env?.DB?.prepare||!env?.DB?.batch)
     throw new SecurityError("f3_not_enabled",503);
   if(method==="POST")originGuard(request,env);
   if(route.kind!=="monthly"&&route.kind!=="listTitles"&&
      route.kind!=="listRecurrences"&&url.search)
      throw new DomainError("invalid_page");
   if(route.kind==="monthly"&&(
     [...url.searchParams.keys()].some(k=>k!=="month"||url.searchParams.getAll(k).length!==1)||
     !url.searchParams.get("month")))throw new DomainError("invalid_month");
   const principal=await authenticateAccess(request,env,fetchKeys||fetch);
   await assertSessionActive(env.DB,principal);
   const read=method==="GET"||method==="HEAD";
   const actor=await requireCompanyRole(env.DB,principal,route.company,read?"read":"write");
   if(route.kind==="listTitles")return json(await listTitles(env.DB,{...actor,companyId:route.company},url),200,method);
   if(route.kind==="listRecurrences")return json(await listRecurrences(env.DB,{...actor,companyId:route.company},url),200,method);
   if(route.kind==="titleDetail")return json(await titleDetail(env.DB,principal,route.company,route.id),200,method);
   if(route.kind==="recurrenceDetail")return json(await recurrenceDetail(env.DB,principal,route.company,route.id),200,method);
   if(route.kind==="monthly"){
    const m=month(url.searchParams.get("month"));
    await assertAggregateAccess(env.DB,principal,route.company);
    // R7 usa valor atual da regra. Reajuste futuro sem título anterior faria
    // a prévia de mês antigo aparentar um valor falso: bloquear, não inventar.
    const pending=await env.DB.prepare(
      "SELECT 1 AS inconsistent FROM recorrencias r JOIN recorrencia_revisoes v "+
      "ON v.recorrencia_id=r.id AND v.empresa_id=r.empresa_id "+
      "WHERE r.empresa_id=? AND r.estado='ATIVA' AND v.tipo='VALOR' "+
      "AND v.vigente_a_partir>? AND substr(r.primeiro_vencimento,1,7)<=? "+
      "AND NOT EXISTS (SELECT 1 FROM titulos_pagar t WHERE t.empresa_id=r.empresa_id "+
      "AND t.recorrencia_id=r.id AND t.competencia=?) LIMIT 1"
    ).bind(route.company,m,m,m).first();
    if(pending)throw new DomainError("monthly_revision_requires_historical_reconciliation",409);
    return json(await monthlyCommitmentPreview(env.DB,principal,route.company,{competencia:m}));
   }
   const body=await inputJSON(request);
   if(route.kind==="createTitle")
    return json(await createOneOff(env.DB,principal,actor,route.company,body),201);
   if(route.kind==="createRecurrence")
    return json(await createRecurrence(env.DB,principal,actor,route.company,body),201);
   const isTitle=["payment","undo","revise","cancel","notes"].includes(route.kind);
   const type=isTitle?"TITULO_PAGAR":"RECORRENCIA";
   await requireEntityPermission(env.DB,principal,route.company,type,route.id,"WRITE");
   const payload=bodyWithServerId(route,body);
   if(route.kind==="undo")
    await requireEntityPermission(env.DB,principal,route.company,"TITULO_BAIXA",route.subId,"WRITE");
   if(route.kind==="payment"&&payload.comprovanteDocumentoId)
    await requireDocumentPermission(env.DB,principal,route.company,payload.comprovanteDocumentoId,"WRITE");
   const command={
    payment:recordPayment,undo:undoPayment,revise:reviseTitle,cancel:cancelTitle,
    notes:updateTitleObservation,materialize:materializeRecurrence,
    reviseValue:reviseRecurringAmount,endAfter:setRecurringLastMonth
   }[route.kind];
   if(!command)throw new DomainError("invalid_fields");
   const result=await command(env.DB,principal,route.company,payload);
   return json(result,result.replayed?200:201);
  }catch(e){
   if(e instanceof DomainError||e instanceof SecurityError){
    const status=Number.isInteger(e.status)&&e.status>=400&&e.status<=503?e.status:400;
    return json({error:ERRORS.has(e.code)?e.code:"request_rejected"},status,method);
   }
   return json({error:"finance_unavailable"},503,method);
  }
 };
}
