// F7 — BFF financeiro de fácil leitura; apenas Workerd/D1 LOCAL.
// Nenhum cálculo de saldo bancário: banco informado só no browser (memória).
import {authenticateAccess,requireCompanyRole,SecurityError} from "../../src/r7/security.mjs";
import {assertSessionActive,assertAggregateAccess,requireEntityPermission,
  requireDocumentPermission} from "../../src/r7/iam.mjs";
import {DomainError,identifier,strictlyObject,money,positiveInt,dateCivil,hashIntent,
  replayOrConflict,requireBatch} from "../../src/r7/domain.mjs";
import {registerCredit} from "../../src/r7/domain.mjs";
import {reverseCredit} from "../../src/r7/payments.mjs";
import {attestRetention} from "../../src/r7/withholdings.mjs";
import {summarizeCashflow,validMonth} from "./f7-cashflow-math.mjs";

const ROUTE=/^\/api\/v1\/companies\/([A-Za-z0-9_-]{1,128})\/cash\/(overview|receivables)(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/(schedule|credits|retentions))?(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/(reverse))?$/;
const HOSTS=new Set(["licita.local.test","localhost","127.0.0.1"]);
const HEADERS={"content-type":"application/json; charset=utf-8",
 "cache-control":"private, no-store, max-age=0","vary":"cf-access-jwt-assertion",
 "x-frame-options":"DENY","x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; frame-ancestors 'none'"};
const CODES=new Set(["f7_not_enabled","access_token_required","invalid_token","invalid_session",
 "session_revoked","entity_unavailable","forbidden","aggregate_with_restricted_rows",
 "invalid_origin","app_origin_not_configured","invalid_json","invalid_fields","invalid_month",
 "invalid_id","invalid_list","invalid_cursor","json_content_type_required","payload_too_large",
 "invalid_schedule","schedule_conflict","invalid_credit_date","credit_conflict","credit_not_allowed_or_insufficient_balance",
 "invalid_credit","invalid_reference","retention_attestation_required","retention_attestation_conflict",
 "retention_attestation_not_allowed","reversal_conflict","reversal_not_allowed",
 "idempotency_conflict","reason_required","aggregate_too_large","unreconciled_amount",
 "money_overflow"]);
function json(x,status=200,method="GET"){
 return new Response(method==="HEAD"?null:JSON.stringify(x),{status,headers:HEADERS});
}
function guardOrigin(req,env){
 const expected=env?.APP_ORIGIN;
 if(typeof expected!=="string"||!/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]{2,5})?$/.test(expected))
  throw new SecurityError("app_origin_not_configured",503);
 if(new URL(req.url).origin!==expected||req.headers.get("origin")!==expected)
  throw new SecurityError("invalid_origin",403);
}
async function parseBody(req){
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get("content-type")||""))
  throw new DomainError("json_content_type_required",415);
 const length=Number(req.headers.get("content-length")||"0");
 if(!Number.isSafeInteger(length)||length>8192)throw new DomainError("payload_too_large",413);
 const data=await req.text();if(new TextEncoder().encode(data).byteLength>8192)
  throw new DomainError("payload_too_large",413);
 try{return JSON.parse(data);}catch{throw new DomainError("invalid_json");}
}
function queryMonth(url){
 if([...url.searchParams.keys()].some(k=>k!=="month"||url.searchParams.getAll(k).length!==1))
  throw new DomainError("invalid_month");
 const month=url.searchParams.get("month");
 if(!validMonth(month))throw new DomainError("invalid_month");
 return month;
}
const hidden=(alias,type)=>"NOT EXISTS(SELECT 1 FROM r7_acl_bloqueios b WHERE "+
 "b.empresa_id="+alias+".empresa_id AND b.usuario_id=? AND b.tipo_entidade='"+type+
 "' AND b.entidade_id="+alias+".id AND b.acao IN ('READ','ALL'))";
const LINKS=" FROM contas_receber c JOIN notas_fiscais n ON n.id=c.nota_fiscal_id "+
 "AND n.empresa_id=c.empresa_id JOIN empenhos e ON e.id=n.empenho_id "+
 "AND e.empresa_id=n.empresa_id JOIN licitacoes l ON l.id=e.licitacao_id "+
 "AND l.empresa_id=e.empresa_id LEFT JOIN v_contas_receber_saldos v ON v.id=c.id "+
 "AND v.empresa_id=c.empresa_id";
const ACCOUNT_COLUMNS="c.id,c.nota_fiscal_id,c.parcela,c.valor_bruto_cent,c.retencao_prevista_cent,"+
 "c.vencimento,c.cancelada,c.origem_dado,c.conferencia,c.versao,"+
 "v.saldo_cent,v.estado_saldo,v.creditado_cent,v.retido_cent,"+
 "n.numero AS nf_numero,n.serie AS nf_serie,n.situacao AS nf_situacao,n.versao AS nf_versao,"+
 "n.origem_dado AS nf_origem,n.conferencia AS nf_conferencia,"+
 "e.id AS empenho_id,e.numero AS empenho_numero,l.id AS licitacao_id";
const ACL_SQL=[
 hidden("c","CONTA_RECEBER"),hidden("n","NOTA_FISCAL"),
 hidden("e","EMPENHO"),hidden("l","LICITACAO"),
 "NOT EXISTS(SELECT 1 FROM recebimentos r JOIN r7_acl_bloqueios b "+
  "ON b.empresa_id=r.empresa_id AND b.entidade_id=r.id AND b.tipo_entidade='RECEBIMENTO' "+
  "AND b.usuario_id=? AND b.acao IN ('READ','ALL') "+
  "WHERE r.empresa_id=c.empresa_id AND r.conta_receber_id=c.id)"
].join(" AND ");
async function ancestors(db,p,company,id,action){
 await requireEntityPermission(db,p,company,"CONTA_RECEBER",id,action);
 const row=await db.prepare("SELECT "+ACCOUNT_COLUMNS+LINKS+
  " WHERE c.id=? AND c.empresa_id=?").bind(id,company).first();
 if(!row)throw new DomainError("entity_unavailable",404);
 for(const [type,key] of [["NOTA_FISCAL",row.nota_fiscal_id],["EMPENHO",row.empenho_id],
  ["LICITACAO",row.licitacao_id]])
  await requireEntityPermission(db,p,company,type,key,action);
 return row;
}
async function movements(db,p,company,id,action){
 const events=(await db.prepare("SELECT r.id,r.tipo_movimento,r.estorno_de_id,r.data_credito,"+
  "r.valor_recebido_cent,r.retencao_confirmada_cent,r.conta_destino,r.referencia_externa,"+
  "r.motivo,r.criado_em,r.origem_dado,r.conferencia,r.retencao_atestado_id "+
  "FROM recebimentos r WHERE r.empresa_id=? AND r.conta_receber_id=? "+
  "ORDER BY r.criado_em,r.id LIMIT 501").bind(company,id).all())?.results||[];
 if(events.length>500)throw new DomainError("aggregate_too_large",409);
 for(const x of events)await requireEntityPermission(db,p,company,"RECEBIMENTO",x.id,action);
 return events;
}
async function detail(db,p,company,id){
 const item=await ancestors(db,p,company,id,"READ");
 const events=await movements(db,p,company,id,"READ");
 return {item,events};
}
async function list(db,company,actor,url){
 const opts=new Set(["limit","after","q","state"]);
 for(const key of url.searchParams.keys())
  if(!opts.has(key)||url.searchParams.getAll(key).length!==1)throw new DomainError("invalid_list");
 const limit=url.searchParams.has("limit")?Number(url.searchParams.get("limit")):25;
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new DomainError("invalid_list");
 const after=url.searchParams.get("after");if(after!==null)identifier(after);
 const q=(url.searchParams.get("q")||"").trim();
 if(q.length>80||/[\u0000-\u001f\u007f]/.test(q))throw new DomainError("invalid_list");
 const state=url.searchParams.get("state")||"open";
 if(!["open","settled","all"].includes(state))throw new DomainError("invalid_list");
 const vals=[company,actor.userId,actor.userId,actor.userId,actor.userId,actor.userId];
 const where=["c.empresa_id=?",ACL_SQL];
 if(state==="open")where.push("c.cancelada=0 AND n.situacao IN ('EMITIDA','APRESENTADA') "+
  "AND (v.saldo_cent>0 OR v.saldo_cent IS NULL)");
 if(state==="settled")where.push("v.saldo_cent=0 AND c.cancelada=0");
 if(q){where.push("(lower(coalesce(n.numero,'')) LIKE ? ESCAPE '\\' OR "+
   "lower(coalesce(e.numero,'')) LIKE ? ESCAPE '\\')");
  const like="%"+q.toLowerCase().replace(/[\\%_]/g,c=>"\\"+c)+"%";
  vals.push(like,like);}
 if(after){
  const cur=await db.prepare("SELECT c.id "+LINKS+" WHERE "+where.join(" AND ")+
   " AND c.id=?").bind(...vals,after).first();
  if(!cur)throw new DomainError("invalid_cursor");
  where.push("c.id>?");vals.push(after);
 }
 const rows=(await db.prepare("SELECT "+ACCOUNT_COLUMNS+LINKS+
  " WHERE "+where.join(" AND ")+" ORDER BY c.id LIMIT ?").bind(...vals,limit+1).all())?.results||[];
 return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].id:null,limit};
}
async function aggregateGate(db,company,userId){
 // Nenhuma soma usa registros ocultos; ausência total de bloqueios é pré-requisito.
 const types=["TITULO_PAGAR","TITULO_BAIXA","RECORRENCIA","CONTA_RECEBER",
  "RECEBIMENTO","NOTA_FISCAL","EMPENHO","LICITACAO"];
 const row=await db.prepare("SELECT 1 AS blocked FROM r7_acl_bloqueios "+
  "WHERE empresa_id=? AND usuario_id=? AND tipo_entidade IN ("+
  types.map(()=>"?").join(",")+") AND acao IN ('READ','ALL') LIMIT 1")
  .bind(company,userId,...types).first();
 if(row)throw new SecurityError("aggregate_with_restricted_rows",403);
}
async function all(db,sql,args){
 const r=(await db.prepare(sql+" LIMIT 5001").bind(...args).all())?.results||[];
 if(r.length>5000)throw new DomainError("aggregate_too_large",409);
 return r;
}
function todaySP(){
 const f=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const get=k=>f.find(x=>x.type===k)?.value;
 return get("year")+"-"+get("month")+"-"+get("day");
}
async function overview(db,p,company,actor,url){
 const month=queryMonth(url);
 await assertAggregateAccess(db,p,company);
 await aggregateGate(db,company,actor.userId);
 const bills=await all(db,"SELECT t.id,t.beneficiario AS nome,t.valor_nominal_cent,"+
  "t.vencimento,t.cancelado,t.recorrencia_id,t.competencia,t.origem_dado,t.conferencia,"+
  "s.situacao FROM titulos_pagar t JOIN v_titulos_situacao s "+
  "ON s.id=t.id AND s.empresa_id=t.empresa_id WHERE t.empresa_id=? ORDER BY t.id",[company]);
 const rules=await all(db,"SELECT id,beneficiario,valor_atual_cent,dia_vencimento,"+
  "primeiro_vencimento,estado,origem_dado,conferencia FROM recorrencias "+
  "WHERE empresa_id=? ORDER BY id",[company]);
 const revisions=await all(db,"SELECT recorrencia_id,tipo,vigente_a_partir,fim_depois "+
  "FROM recorrencia_revisoes WHERE empresa_id=? ORDER BY id",[company]);
 const ends={};for(const x of revisions)if(x.tipo==="ENCERRAR"){
  if(!ends[x.recorrencia_id]||x.fim_depois<ends[x.recorrencia_id])ends[x.recorrencia_id]=x.fim_depois;
 }
 const receivables=await all(db,"SELECT "+ACCOUNT_COLUMNS+LINKS+
  " WHERE c.empresa_id=? ORDER BY c.id",[company]);
 const credits=await all(db,"SELECT * FROM v_recebimentos_ativos "+
  "WHERE empresa_id=? ORDER BY id",[company]);
 const payments=await all(db,"SELECT b.id,b.data_pagamento,b.valor_pago_cent,b.origem_dado,"+
  "b.conferencia,t.beneficiario AS nome FROM titulo_baixas b "+
  "JOIN titulos_pagar t ON t.id=b.titulo_id AND t.empresa_id=b.empresa_id "+
  "WHERE b.empresa_id=? AND b.tipo='QUITACAO' AND NOT EXISTS("+
  "SELECT 1 FROM titulo_baixas undo WHERE undo.empresa_id=b.empresa_id "+
  "AND undo.baixa_original_id=b.id AND undo.tipo='DESFAZIMENTO') "+
  "ORDER BY b.id",[company]);
 try{return summarizeCashflow({month,today:todaySP(),bills,rules,ruleEnds:ends,revisions,
   receivables,credits,payments});}
 catch(e){
  if(e.message==="money_overflow"||e.message==="aggregate_too_large")
   throw new DomainError(e.message,409);
  throw new DomainError("unreconciled_amount",409);
 }
}
async function scheduled(db,p,company,id,body){
 requireBatch(db);
 strictlyObject(body,new Set(["intentId","expectedVersion","vencimento","motivo"]));
 const intent=identifier(body.intentId),version=body.expectedVersion;
 if(!positiveInt(version)||!dateCivil(body.vencimento)||
  typeof body.motivo!=="string"||body.motivo.trim().length<6||body.motivo.length>1500)
  throw new DomainError("invalid_schedule");
 const record=await ancestors(db,p,company,id,"WRITE");
 if(record.origem_dado!=="NATIVO"||record.conferencia!=="VALIDADO"||
  !["EMITIDA","APRESENTADA"].includes(record.nf_situacao))throw new DomainError("schedule_conflict",409);
 const actor=await requireCompanyRole(db,p,company,"write");
 const hash=await hashIntent("F7_AJUSTAR_VENCIMENTO",[
  id,version,body.vencimento,body.motivo.trim()]);
 const prior=await replayOrConflict(db,company,intent,hash,"F7_AJUSTAR_VENCIMENTO");
 if(prior)return prior;
 const change=db.prepare("UPDATE contas_receber SET vencimento=?,motivo_ajuste_vencimento=?,"+
  "versao=versao+1,operacao_id=?,atualizado_em=? "+
  "WHERE id=? AND empresa_id=? AND versao=? AND cancelada=0 "+
  "AND origem_dado='NATIVO' AND conferencia='VALIDADO' "+
  "AND NOT EXISTS(SELECT 1 FROM recebimentos r WHERE r.empresa_id=contas_receber.empresa_id "+
  "AND r.conta_receber_id=contas_receber.id) "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes op WHERE op.id=?)")
  .bind(body.vencimento,body.motivo.trim(),intent,new Date().toISOString(),
    id,company,version,intent);
 const journal=db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,"+
  "estado,origem_dado,conferencia) SELECT ?,?,'F7_AJUSTAR_VENCIMENTO',"+
  "?,?,'CONCLUIDA','NATIVO','VALIDADO' FROM contas_receber "+
  "WHERE id=? AND empresa_id=? AND versao=? AND operacao_id=?")
  .bind(intent,company,hash,actor.userId,id,company,version+1,intent);
 const audit=db.prepare("INSERT INTO eventos_auditoria(id,empresa_id,tipo_entidade,entidade_id_texto,"+
  "acao,ator_id,resumo,operacao_id,origem_dado,conferencia) "+
  "SELECT ?,?,'CONTA_RECEBER',?,'AJUSTAR_VENCIMENTO',?,"+
  "? ,?,'NATIVO','VALIDADO' FROM operacoes WHERE id=? AND empresa_id=? AND estado='CONCLUIDA'")
  .bind(crypto.randomUUID(),company,id,actor.userId,"Prazo pactuado F7",intent,intent,company);
 let res;try{res=await db.batch([change,journal,audit]);}
 catch{throw new DomainError("schedule_conflict",409);}
 if(res?.length===3&&res.every(x=>x?.meta?.changes===1))
  return {replayed:false,intentId:intent,contaReceberId:id,newVersion:version+1};
 const raced=await replayOrConflict(db,company,intent,hash,"F7_AJUSTAR_VENCIMENTO");
 if(raced)return raced;
 throw new DomainError("schedule_conflict",409);
}
function path(parts,method){
 const [,company,resource,id,act,subId,subAct]=parts;
 if(resource==="overview"&&!id&&["GET","HEAD"].includes(method))
  return {kind:"overview",company};
 if(resource!=="receivables")return null;
 if(!id&&["GET","HEAD"].includes(method))return {kind:"list",company};
 if(id&&!act&&["GET","HEAD"].includes(method))return {kind:"detail",company,id};
 if(id&&act==="schedule"&&!subId&&method==="PATCH")return {kind:"schedule",company,id};
 if(id&&act==="credits"&&!subId&&method==="POST")return {kind:"credit",company,id};
 if(id&&act==="credits"&&subId&&subAct==="reverse"&&method==="POST")
  return {kind:"reverse",company,id,subId};
 if(id&&act==="retentions"&&!subId&&method==="POST")return {kind:"retention",company,id};
 return null;
}
export function createF7Handler({fetchKeys}={}){
 return async(request,env)=>{
  const url=new URL(request.url),parts=ROUTE.exec(url.pathname);
  if(!parts)return null;
  const method=request.method.toUpperCase(),r=path(parts,method);
  if(!r)return json({error:"method_not_allowed"},405,method);
  try{
   if(!HOSTS.has(url.hostname)||env?.F1_RUNTIME_ENABLED!=="test_local_only"||
    env?.F7_RUNTIME_ENABLED!=="test_local_only"||!env.DB?.prepare||!env.DB?.batch)
    throw new SecurityError("f7_not_enabled",503);
   if(!["overview","list"].includes(r.kind)&&url.search)throw new DomainError("invalid_list");
   if(["POST","PATCH"].includes(method))guardOrigin(request,env);
   const principal=await authenticateAccess(request,env,fetchKeys||fetch);
   await assertSessionActive(env.DB,principal);
   const actor=await requireCompanyRole(env.DB,principal,r.company,
     ["POST","PATCH"].includes(method)?"write":"read");
   let result;
   if(r.kind==="overview")result=await overview(env.DB,principal,r.company,actor,url);
   else if(r.kind==="list")result=await list(env.DB,r.company,actor,url);
   else if(r.kind==="detail")result=await detail(env.DB,principal,r.company,r.id);
   else{
    const body=await parseBody(request);
    if(r.kind==="schedule")result=await scheduled(env.DB,principal,r.company,r.id,body);
    else if(r.kind==="credit"){
     strictlyObject(body,new Set(["intentId","valorRecebidoCent","retencaoConfirmadaCent",
      "dataCredito","contaDestino","referenciaExterna","retencaoAtestadoId"]));
     await ancestors(env.DB,principal,r.company,r.id,"WRITE");
     if(!dateCivil(body.dataCredito)||body.dataCredito>todaySP())
      throw new DomainError("invalid_credit_date");
     result=await registerCredit(env.DB,principal,r.company,{...body,contaReceberId:r.id});
    }else if(r.kind==="reverse"){
     strictlyObject(body,new Set(["intentId","motivo"]));
     await ancestors(env.DB,principal,r.company,r.id,"WRITE");
     await requireEntityPermission(env.DB,principal,r.company,"RECEBIMENTO",r.subId,"WRITE");
     const record=await env.DB.prepare("SELECT 1 AS matched FROM recebimentos "+
      "WHERE id=? AND conta_receber_id=? AND empresa_id=?")
      .bind(r.subId,r.id,r.company).first();
     if(!record)throw new DomainError("entity_unavailable",404);
     result=await reverseCredit(env.DB,principal,r.company,
      {...body,recebimentoOriginalId:r.subId});
    }else{
     strictlyObject(body,new Set(["intentId","documentoVersaoId","valorConfirmadoCent"]));
     await requireCompanyRole(env.DB,principal,r.company,"approve");
     await ancestors(env.DB,principal,r.company,r.id,"WRITE");
     identifier(body.documentoVersaoId);
     const doc=await env.DB.prepare("SELECT documento_id FROM documento_versoes "+
      "WHERE id=? AND empresa_id=? AND estado_integridade='VERIFICADO'")
      .bind(body.documentoVersaoId,r.company).first();
     if(!doc)throw new DomainError("entity_unavailable",404);
     await requireDocumentPermission(env.DB,principal,r.company,doc.documento_id,"WRITE");
     await requireEntityPermission(env.DB,principal,r.company,"DOCUMENTO_VERSAO",
      body.documentoVersaoId,"WRITE");
     result=await attestRetention(env.DB,principal,r.company,
      {...body,contaReceberId:r.id});
    }
   }
   return json(result,["POST"].includes(method)&&!result.replayed?201:200,method);
  }catch(e){
   if(e instanceof DomainError||e instanceof SecurityError){
    const st=Number.isInteger(e.status)&&e.status>=400&&e.status<=503?e.status:400;
    return json({error:CODES.has(e.code)?e.code:"request_rejected"},st,method);
   }
   return json({error:"f7_unavailable"},503,method);
  }
 };
}
