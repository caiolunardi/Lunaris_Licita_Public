// F9 — calculadora/cotações, notificações PREPARADAS (nunca e-mail real),
// configurações, equipe IAM e auditoria. Somente Workerd/D1 LOCAIS sintéticos.
import {authenticateAccess,requireCompanyRole,SecurityError} from "../../src/r7/security.mjs";
import {assertSessionActive,assertAggregateAccess,requireEntityPermission,
  blockEntityForUser,revokeCompanyMembership} from "../../src/r7/iam.mjs";
import {DomainError,strictlyObject,identifier,hashIntent,
  replayOrConflict,requireBatch} from "../../src/r7/domain.mjs";
import {priceQuote} from "./f9-price-math.mjs";

const ROUTE=/^\/api\/v1\/companies\/([A-Za-z0-9_-]{1,128})\/tools(?:\/([a-z-]+))?(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/([A-Za-z0-9_-]{1,128}))?$/;
const HOSTS=new Set(["licita.local.test","localhost","127.0.0.1"]);
const H={"cache-control":"private, no-store, max-age=0","vary":"cf-access-jwt-assertion",
 "content-type":"application/json; charset=utf-8","x-content-type-options":"nosniff",
 "referrer-policy":"no-referrer","x-frame-options":"DENY",
 "content-security-policy":"default-src 'none'; frame-ancestors 'none'"};
const ERROR_CODES=new Set(["f9_not_enabled","access_token_required","invalid_token",
 "session_revoked","invalid_session","forbidden","entity_unavailable","invalid_origin",
 "app_origin_not_configured","invalid_list","invalid_fields","invalid_id",
 "invalid_json","payload_too_large","json_content_type_required","invalid_pricing",
 "margin_unachievable","price_overflow","quote_conflict","quote_not_found",
 "settings_conflict","invalid_setting","notification_configuration_conflict",
 "invalid_notification_schedule","recipient_conflict","invalid_recipient",
 "recipient_version_conflict","no_verifiable_upcoming_obligations",
 "aggregate_with_restricted_rows","membership_version_conflict",
 "membership_revocation_conflict","invalid_revocation","last_admin_protected",
 "entity_block_conflict","invalid_entity_block","target_unavailable",
 "idempotency_conflict","invalid_permission","invalid_cursor"]);
function json(body,status=200,method="GET"){return new Response(method==="HEAD"?null:JSON.stringify(body),{status,headers:H});}
function requireOrigin(request,env){
 const configured=env?.APP_ORIGIN;
 if(typeof configured!=="string"||!/^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$/.test(configured))
  throw new SecurityError("app_origin_not_configured",503);
 if(new URL(request.url).origin!==configured||
  request.headers.get("origin")!==configured)
  throw new SecurityError("invalid_origin",403);
}
async function body(request){
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type")||""))
  throw new DomainError("json_content_type_required",415);
 const length=Number(request.headers.get("content-length")||"0");
 if(!Number.isSafeInteger(length)||length>8192)
  throw new DomainError("payload_too_large",413);
 const raw=await request.text();
 if(new TextEncoder().encode(raw).byteLength>8192)throw new DomainError("payload_too_large",413);
 try{return JSON.parse(raw);}catch{throw new DomainError("invalid_json");}
}
function noQuery(url){if(url.search)throw new DomainError("invalid_list");}
function query(url,allowed){
 for(const k of url.searchParams.keys())
  if(!allowed.includes(k)||url.searchParams.getAll(k).length!==1)
   throw new DomainError("invalid_list");
}
function asLimit(url,def=25,max=50){
 const s=url.searchParams.get("limit");
 const n=s===null?def:Number(s);
 if(!Number.isSafeInteger(n)||n<1||n>max)throw new DomainError("invalid_list");
 return n;
}
function route(parts,method){
 const [,company,r,id,verb]=parts;
 const get=["GET","HEAD"].includes(method),post=method==="POST";
 if(!r)return null;
 if(r==="pricing"&&!id&&post)return {kind:"pricing",company};
 if(r==="quotes"&&!id&&get)return {kind:"quotes",company};
 if(r==="quotes"&&!id&&post)return {kind:"saveQuote",company};
 if(r==="quotes"&&id&&!verb&&get)return {kind:"quote",company,id};
 if(r==="settings"&&!id&&get)return {kind:"settings",company};
 if(r==="settings"&&!id&&method==="PATCH")return {kind:"settingSave",company};
 if(r==="notifications"&&!id&&get)return {kind:"notifications",company};
 if(r==="notifications"&&id==="preview"&&!verb&&get)return {kind:"notifPreview",company};
 if(r==="notifications"&&id==="schedule"&&!verb&&method==="PATCH")
  return {kind:"notifSchedule",company};
 if(r==="notifications"&&id==="recipients"&&!verb&&post)
  return {kind:"recipientAdd",company};
 if(r==="notifications"&&id==="recipients"&&verb&&post)return {kind:"recipientDisable",company,recipient:verb};
 if(r==="members"&&!id&&get)return {kind:"members",company};
 if(r==="members"&&id&&verb==="revoke"&&post)return {kind:"revoke",company,id};
 if(r==="restrictions"&&!id&&get)return {kind:"restrictions",company};
 if(r==="restrictions"&&id==="targets"&&!verb&&get)return {kind:"restrictionTargets",company};
 if(r==="restrictions"&&!id&&post)return {kind:"restrict",company};
 if(r==="audit"&&!id&&get)return {kind:"audit",company};
 return null;
}
const QUOTE_FIELDS=new Set(["intentId","descricao","fornecedorTexto","referenciaTexto",
 "quantityMil","costUnitCent","extraCostCent","saleFeeBps","targetMarginBps","saleUnitCent"]);
function cleanText(v,max=250,required=false){
 if(v==null&&!required)return null;
 if(typeof v!=="string"||v.length>max||v.trim().length< (required?3:1)||
  v.trim()!==v||/[\u0000-\u001f\u007f]/.test(v))
  throw new DomainError("invalid_fields");
 return v;
}
async function quoteAncestors(db,p,company,row,action){
 await requireEntityPermission(db,p,company,"COTACAO",row.id,action);
 if(row.licitacao_id)
  await requireEntityPermission(db,p,company,"LICITACAO",row.licitacao_id,action);
 if(row.item_licitacao_id)
  await requireEntityPermission(db,p,company,"LICITACAO_ITEM",row.item_licitacao_id,action);
}
const QUOTE_COLS="id,descricao,fornecedor_texto,referencia_texto,quantidade_mil,"+
 "custo_unit_cent,custo_efetivo_total_cent,preco_minimo_unit_cent,preco_venda_unit_cent,"+
 "receita_total_cent,custos_venda_total_cent,lucro_total_cent,margem_percentual_escala,"+
 "lucro_sobre_custo_escala,entrada_json,resultado_json,versao_calculo,origem_dado,"+
 "conferencia,criado_em,licitacao_id,item_licitacao_id";
async function listQuotes(db,p,company,url){
 query(url,["limit","after"]);
 const limit=asLimit(url),after=url.searchParams.get("after");
 if(after!==null)identifier(after);
 const arr=(await db.prepare("SELECT "+QUOTE_COLS+" FROM cotacoes_precos "+
  "WHERE empresa_id=?"+(after?" AND id>?":"")+" ORDER BY id LIMIT 5001")
  .bind(...(after?[company,after]:[company])).all())?.results||[];
 if(arr.length>5000)throw new DomainError("invalid_list",409);
 const visible=[];
 for(const q of arr){
  try{await quoteAncestors(db,p,company,q,"READ");visible.push(q);}
  catch(e){if(!(e instanceof SecurityError||e instanceof DomainError))throw e;
   if(e.status===401)throw e;}
  if(visible.length>limit)break;
 }
 return {items:visible.slice(0,limit),nextCursor:visible.length>limit?
  visible[limit-1].id:null,limit};
}
async function quoteDetail(db,p,company,id){
 const r=await db.prepare("SELECT "+QUOTE_COLS+" FROM cotacoes_precos WHERE id=? AND empresa_id=?")
  .bind(id,company).first();
 if(!r)throw new DomainError("quote_not_found",404);
 await quoteAncestors(db,p,company,r,"READ");
 return {item:r};
}
async function saveQuote(db,p,company,data){
 requireBatch(db);strictlyObject(data,QUOTE_FIELDS);
 const intent=identifier(data.intentId);
 const desc=cleanText(data.descricao,150,true),
  vendor=cleanText(data.fornecedorTexto,120),
  ref=cleanText(data.referenciaTexto,120);
 const entry={quantityMil:data.quantityMil,costUnitCent:data.costUnitCent,
  extraCostCent:data.extraCostCent,saleFeeBps:data.saleFeeBps,
  targetMarginBps:data.targetMarginBps,saleUnitCent:data.saleUnitCent??null};
 const result=priceQuote(entry);
 const actor=await requireCompanyRole(db,p,company,"write");
 const hash=await hashIntent("F9_SALVAR_COTACAO",[desc,vendor,ref,entry]);
 const replay=await replayOrConflict(db,company,intent,hash,"F9_SALVAR_COTACAO");
 if(replay)return replay;
 const id=crypto.randomUUID(),uuid=crypto.randomUUID();
 const op=db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,"+
  "estado,origem_dado,conferencia) VALUES (?,?,'F9_SALVAR_COTACAO',?,?,'CONCLUIDA','NATIVO','VALIDADO')")
  .bind(intent,company,hash,actor.userId);
 const insert=db.prepare("INSERT INTO cotacoes_precos"+
  "(id,empresa_id,descricao,fornecedor_texto,referencia_texto,quantidade_mil,custo_unit_cent,"+
  "custo_efetivo_total_cent,preco_minimo_unit_cent,preco_venda_unit_cent,receita_total_cent,"+
  "custos_venda_total_cent,lucro_total_cent,margem_percentual_escala,lucro_sobre_custo_escala,"+
  "objetivo,entrada_json,resultado_json,versao_calculo,operacao_id,conferencia)"+
  " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'VALIDADO')")
  .bind(id,company,desc,vendor,ref,result.quantityMil,result.costUnitCent,
    result.totalCostCent,result.minimumUnitCent,result.saleUnitCent,
    result.revenueCent,result.saleFeesCent,result.profitCent,
    result.actualMarginBps,result.markupOverCostBps,"MARGEM_LIQUIDA_SOBRE_RECEITA",
    JSON.stringify(entry),JSON.stringify(result),result.formulaVersion,intent);
 const audit=db.prepare("INSERT INTO eventos_auditoria"+
  "(id,empresa_id,tipo_entidade,entidade_id_texto,acao,ator_id,resumo,operacao_id,"+
  "origem_dado,conferencia) VALUES(?,?,'COTACAO',?,'SALVAR_COTACAO',?,"+
  "'Cotação F9 local, sem venda real',?,'NATIVO','VALIDADO')")
  .bind(uuid,company,id,actor.userId,intent);
 let res;try{res=await db.batch([op,insert,audit]);}
 catch{throw new DomainError("quote_conflict",409);}
 if(res?.length!==3||res.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1))
  throw new DomainError("quote_conflict",409);
 return {replayed:false,intentId:intent,cotacaoId:id,calculation:result,
  saleConfirmed:false};
}
const SET_KEYS=Object.freeze({
 exibir_dicas_iniciantes:{type:"BOOLEANO",validate:v=>v==="true"||v==="false"},
 alertas_dias_antecedencia:{type:"INTEIRO",validate:v=>/^(?:[1-9]|[1-5]\d|60)$/.test(v)}
});
async function readSettings(db,company){
 const data=(await db.prepare("SELECT chave,valor_texto,tipo,atualizado_em FROM configuracoes "+
  "WHERE empresa_id=? AND chave IN ('exibir_dicas_iniciantes','alertas_dias_antecedencia') "+
  "ORDER BY chave").bind(company).all())?.results||[];
 return {items:data,defaults:{exibir_dicas_iniciantes:"true",alertas_dias_antecedencia:"7"}};
}
async function patchSetting(db,p,company,data){
 strictlyObject(data,new Set(["intentId","key","value","expectedValue"]));
 const intent=identifier(data.intentId),key=data.key,value=data.value,expected=data.expectedValue;
 if(!Object.hasOwn(SET_KEYS,key)||typeof value!=="string"||
  !SET_KEYS[key].validate(value)||
  !(expected===null||(typeof expected==="string"&&SET_KEYS[key].validate(expected))))
  throw new DomainError("invalid_setting",400);
 const member=await requireCompanyRole(db,p,company,"approve");
 const hash=await hashIntent("F9_AJUSTE_CONFIG",[key,value,expected]);
 const replay=await replayOrConflict(db,company,intent,hash,"F9_AJUSTE_CONFIG");
 if(replay)return replay;
 const current=await db.prepare("SELECT valor_texto FROM configuracoes WHERE empresa_id=? AND chave=?")
  .bind(company,key).first();
 if((current?.valor_texto??null)!==expected)
  throw new DomainError("settings_conflict",409);
 const op=db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,"+
  "estado,origem_dado,conferencia) VALUES(?,?,'F9_AJUSTE_CONFIG',?,?,"+
  "'CONCLUIDA','NATIVO','VALIDADO')").bind(intent,company,hash,member.userId);
 // Guardas CAS em upsert: nunca substituir valor modificado por outro ADMIN.
 const save=db.prepare("INSERT INTO configuracoes(empresa_id,chave,valor_texto,tipo,descricao,"+
  "atualizado_em) SELECT ?,?,?,?,?,"+
  "strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
  "WHERE EXISTS(SELECT 1 FROM operacoes WHERE id=? AND empresa_id=?) "+
  "AND ? IS NULL "+
  "ON CONFLICT(empresa_id,chave) DO UPDATE SET valor_texto=excluded.valor_texto,"+
  "atualizado_em=excluded.atualizado_em WHERE configuracoes.valor_texto IS ?")
  .bind(company,key,value,SET_KEYS[key].type,
   key==="exibir_dicas_iniciantes"?"Dicas de apoio a usuários iniciantes":"Antecedência dos avisos em dias",
   intent,company,expected,expected);
 // Para atualização de registro existente, INSERT SELECT tem WHERE ? IS NULL;
 // usar ramo separado, senão o CAS falha silenciosamente.
 const update=db.prepare("UPDATE configuracoes SET valor_texto=?, "+
  "atualizado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
  "WHERE empresa_id=? AND chave=? AND valor_texto IS ? "+
  "AND EXISTS(SELECT 1 FROM operacoes WHERE id=? AND empresa_id=?)")
  .bind(value,company,key,expected,intent,company);
 const audit=db.prepare("INSERT INTO eventos_auditoria"+
  "(id,empresa_id,tipo_entidade,entidade_id_texto,acao,ator_id,resumo,operacao_id,"+
  "origem_dado,conferencia) SELECT ?,?,'CONFIGURACAO',?,'AJUSTAR_CONFIG',?,"+
  "'Preferência de empresa F9',?,'NATIVO','VALIDADO' FROM operacoes "+
  "WHERE id=? AND empresa_id=?")
  .bind(crypto.randomUUID(),company,key,member.userId,intent,intent,company);
 let res;try{res=await db.batch([op,current?update:save,audit]);}
 catch{throw new DomainError("settings_conflict",409);}
 if(res?.length!==3||res.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1))
  throw new DomainError("settings_conflict",409);
 return {replayed:false,intentId:intent,key,value};
}
const DAY=/^[0-6]$/,TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const EMAIL=/^[^\s@]{1,64}@[a-z0-9.-]{3,250}\.[a-z]{2,20}$/;
async function notificationAcl(db,p,company,pref){
 if(pref)await requireEntityPermission(db,p,company,"PREFERENCIA_NOTIFICACAO",pref,"READ");
}
async function readNotifications(db,p,company){
 const pref=await db.prepare("SELECT id,ativo,dias_semana_json,horarios_json,"+
  "quantidade_proximos,remetente,versao,origem_dado,conferencia "+
  "FROM notificacoes_preferencias WHERE empresa_id=?").bind(company).first();
 await notificationAcl(db,p,company,pref?.id);
 const raw=(await db.prepare("SELECT id,email_normalizado,ativo,versao,conferencia "+
  "FROM notificacoes_destinatarios WHERE empresa_id=? ORDER BY id LIMIT 101")
  .bind(company).all())?.results||[];
 if(raw.length>100)throw new DomainError("invalid_list",409);
 const destinations=[];
 for(const row of raw){
  await requireEntityPermission(db,p,company,"DESTINATARIO_NOTIFICACAO",row.id,"READ");
  destinations.push(row);
 }
 const history=(await db.prepare("SELECT id,data_referencia,horario,estado,quantidade_boletos,"+
  "total_centavos,criado_em,enviado_em FROM notificacoes_envios "+
  "WHERE empresa_id=? ORDER BY criado_em DESC,id DESC LIMIT 50")
  .bind(company).all())?.results||[];
 return {preference:pref,recipients:destinations,history,dispatchEnabled:false,
  providerConfigured:false,cronEnabled:false,
  deliveryStatus:"Nenhum e-mail pode ser enviado pelo Worker F9 local."};
}
async function saveSchedule(db,p,company,data){
 strictlyObject(data,new Set(["intentId","expectedVersion","days","times","quantityProximos"]));
 const intent=identifier(data.intentId),version=data.expectedVersion;
 if(!Number.isSafeInteger(version)||version<0||
  !Array.isArray(data.days)||data.days.length<1||data.days.length>7||
  data.days.some(x=>!Number.isInteger(x)||x<0||x>6)||
  new Set(data.days).size!==data.days.length||
  !Array.isArray(data.times)||data.times.length<1||data.times.length>3||
  data.times.some(x=>typeof x!=="string"||!TIME.test(x))||
  new Set(data.times).size!==data.times.length||
  !Number.isSafeInteger(data.quantityProximos)||data.quantityProximos<1||
  data.quantityProximos>50)throw new DomainError("invalid_notification_schedule",400);
 const days=[...data.days].sort((a,b)=>a-b),times=[...data.times].sort();
 const actor=await requireCompanyRole(db,p,company,"approve");
 const pref=await db.prepare("SELECT id,versao,origem_dado FROM notificacoes_preferencias WHERE empresa_id=?")
  .bind(company).first();
 if(pref)await requireEntityPermission(db,p,company,"PREFERENCIA_NOTIFICACAO",pref.id,"WRITE");
 const hash=await hashIntent("F9_PLANEJAR_NOTIFICACAO",[version,days,times,data.quantityProximos]);
 const prior=await replayOrConflict(db,company,intent,hash,"F9_PLANEJAR_NOTIFICACAO");
 if(prior)return prior;
 if((pref?.versao??0)!==version||pref?.origem_dado==="LEGADO")
  throw new DomainError("notification_configuration_conflict",409);
 const id=pref?.id||crypto.randomUUID();
 const op=db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "origem_dado,conferencia) VALUES(?,?,'F9_PLANEJAR_NOTIFICACAO',?,?,"+
  "'CONCLUIDA','NATIVO','VALIDADO')").bind(intent,company,hash,actor.userId);
 // Segurança: ativo = 0 SEMPRE. Agendamento salvo não aciona e-mail.
 const write=pref?
  db.prepare("UPDATE notificacoes_preferencias SET ativo=0,dias_semana_json=?,"+
   "horarios_json=?,quantidade_proximos=?,remetente=NULL,versao=versao+1,"+
   "conferencia='VALIDADO',operacao_id=? WHERE id=? AND empresa_id=? "+
   "AND versao=? AND origem_dado='NATIVO' AND EXISTS("+
   "SELECT 1 FROM operacoes WHERE id=? AND empresa_id=?)")
   .bind(JSON.stringify(days),JSON.stringify(times),data.quantityProximos,
    intent,id,company,version,intent,company):
  db.prepare("INSERT INTO notificacoes_preferencias"+
   "(id,empresa_id,ativo,dias_semana_json,horarios_json,quantidade_proximos,"+
   "remetente,operacao_id,conferencia) SELECT ?,?,0,?,?,?,NULL,?,'VALIDADO' "+
   "WHERE EXISTS(SELECT 1 FROM operacoes WHERE id=? AND empresa_id=?)")
   .bind(id,company,JSON.stringify(days),JSON.stringify(times),data.quantityProximos,
    intent,intent,company);
 const audit=db.prepare("INSERT INTO eventos_auditoria"+
  "(id,empresa_id,tipo_entidade,entidade_id_texto,acao,ator_id,resumo,operacao_id,"+
  "origem_dado,conferencia) SELECT ?,?,'PREFERENCIA_NOTIFICACAO',?,"+
  "'PLANEJAR_NOTIFICACAO',?,'Envio externo DESATIVADO',?,'NATIVO','VALIDADO' "+
  "FROM operacoes WHERE id=? AND empresa_id=?")
  .bind(crypto.randomUUID(),company,id,actor.userId,intent,intent,company);
 let result;try{result=await db.batch([op,write,audit]);}
 catch{throw new DomainError("notification_configuration_conflict",409);}
 if(result?.length!==3||result.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1))
  throw new DomainError("notification_configuration_conflict",409);
 return {replayed:false,intentId:intent,preferenceId:id,version:version+1,
  dispatchEnabled:false};
}
async function addRecipient(db,p,company,data){
 strictlyObject(data,new Set(["intentId","email"]));
 const intent=identifier(data.intentId);
 if(typeof data.email!=="string"||data.email.length>320||
  data.email!==data.email.trim())throw new DomainError("invalid_recipient",400);
 const email=data.email.toLowerCase();
 if(!EMAIL.test(email)||email.includes("..")||email.includes("@-"))
  throw new DomainError("invalid_recipient",400);
 const actor=await requireCompanyRole(db,p,company,"approve");
 const pref=await db.prepare("SELECT id,origem_dado FROM notificacoes_preferencias WHERE empresa_id=?")
  .bind(company).first();
 if(!pref||pref.origem_dado!=="NATIVO")throw new DomainError("invalid_recipient",409);
 await requireEntityPermission(db,p,company,"PREFERENCIA_NOTIFICACAO",pref.id,"WRITE");
 const hash=await hashIntent("F9_DESTINATARIO_AVISO",[pref.id,email]);
 const old=await replayOrConflict(db,company,intent,hash,"F9_DESTINATARIO_AVISO");
 if(old)return old;
 const id=crypto.randomUUID();
 const op=db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "origem_dado,conferencia) VALUES(?,?,'F9_DESTINATARIO_AVISO',?,?,'CONCLUIDA','NATIVO','VALIDADO')")
  .bind(intent,company,hash,actor.userId);
 const insert=db.prepare("INSERT INTO notificacoes_destinatarios"+
  "(id,empresa_id,preferencia_id,email_normalizado,ativo,operacao_id,conferencia) "+
  "SELECT ?,?,?,?,1,?,'VALIDADO' WHERE EXISTS(SELECT 1 FROM operacoes WHERE id=? AND empresa_id=?)")
  .bind(id,company,pref.id,email,intent,intent,company);
 const audit=db.prepare("INSERT INTO eventos_auditoria"+
  "(id,empresa_id,tipo_entidade,entidade_id_texto,acao,ator_id,resumo,operacao_id,"+
  "origem_dado,conferencia) VALUES(?,?,'DESTINATARIO_NOTIFICACAO',?,"+
  "'REGISTRAR_DESTINATARIO',?,'Destinatário cadastrado sem envio',?,"+
  "'NATIVO','VALIDADO')")
  .bind(crypto.randomUUID(),company,id,actor.userId,intent);
 let result;try{result=await db.batch([op,insert,audit]);}
 catch{throw new DomainError("recipient_conflict",409);}
 if(result?.length!==3||result.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1))
  throw new DomainError("recipient_conflict",409);
 return {replayed:false,intentId:intent,destinatarioId:id,dispatchEnabled:false};
}
async function disableRecipient(db,p,company,id,data){
 strictlyObject(data,new Set(["intentId","expectedVersion","motivo"]));
 const intent=identifier(data.intentId),r=identifier(id),expected=data.expectedVersion;
 const reason=cleanText(data.motivo,200,true);
 if(!Number.isSafeInteger(expected)||expected<1||reason.length<8)
  throw new DomainError("invalid_recipient",400);
 const actor=await requireCompanyRole(db,p,company,"approve");
 await requireEntityPermission(db,p,company,"DESTINATARIO_NOTIFICACAO",r,"WRITE");
 const hash=await hashIntent("F9_DESATIVAR_DESTINATARIO",[r,expected,reason]);
 const prior=await replayOrConflict(db,company,intent,hash,"F9_DESATIVAR_DESTINATARIO");
 if(prior)return prior;
 const row=await db.prepare("SELECT id,ativo,versao,origem_dado FROM notificacoes_destinatarios "+
  "WHERE id=? AND empresa_id=?").bind(r,company).first();
 if(!row||row.ativo!==1||row.versao!==expected||row.origem_dado!=="NATIVO")
  throw new DomainError("recipient_version_conflict",409);
 const op=db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "origem_dado,conferencia) VALUES(?,?,'F9_DESATIVAR_DESTINATARIO',?,?,"+
  "'CONCLUIDA','NATIVO','VALIDADO')").bind(intent,company,hash,actor.userId);
 const update=db.prepare("UPDATE notificacoes_destinatarios SET ativo=0,versao=versao+1,"+
  "atualizado_em=strftime('%Y-%m-%dT%H:%M:%fZ','now'),operacao_id=? "+
  "WHERE id=? AND empresa_id=? AND ativo=1 AND versao=? "+
  "AND EXISTS(SELECT 1 FROM operacoes WHERE id=? AND empresa_id=?)")
  .bind(intent,r,company,expected,intent,company);
 const audit=db.prepare("INSERT INTO eventos_auditoria"+
  "(id,empresa_id,tipo_entidade,entidade_id_texto,acao,ator_id,resumo,operacao_id,"+
  "origem_dado,conferencia) SELECT ?,?,'DESTINATARIO_NOTIFICACAO',?,"+
  "'DESATIVAR_DESTINATARIO',?,? ,?,'NATIVO','VALIDADO' "+
  "FROM operacoes WHERE id=? AND empresa_id=?")
  .bind(crypto.randomUUID(),company,r,actor.userId,reason,intent,intent,company);
 let res;try{res=await db.batch([op,update,audit]);}
 catch{throw new DomainError("recipient_version_conflict",409);}
 if(res?.length!==3||res.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1))
  throw new DomainError("recipient_version_conflict",409);
 return {replayed:false,intentId:intent,recipientId:r,disabled:true};
}
const ALLOWED_TARGETS=Object.freeze({
 LICITACAO:["licitacoes","numero"],
 TITULO_PAGAR:["titulos_pagar","beneficiario"]
});
async function restrictionTargets(db,p,company,url){
 query(url,["type"]);const type=url.searchParams.get("type");
 if(!Object.hasOwn(ALLOWED_TARGETS,type))throw new DomainError("invalid_list");
 const [table,label]=ALLOWED_TARGETS[type];
 const records=(await db.prepare("SELECT id,coalesce(nullif(trim("+label+"),''),id) AS label "+
  "FROM "+table+" WHERE empresa_id=? ORDER BY id LIMIT 201")
  .bind(company).all())?.results||[];
 if(records.length>200)throw new DomainError("invalid_list",409);
 const items=[];
 for(const r of records){
  try{await requireEntityPermission(db,p,company,type,r.id,"READ");
   items.push(r);}catch(e){
    if(!(e instanceof DomainError||e instanceof SecurityError))throw e;
    if(e.status===401)throw e;
   }
 }
 return {items,type};
}

async function previewNotifications(db,p,company,url){
 query(url,[]);
 await assertAggregateAccess(db,p,company);
 const pref=await db.prepare("SELECT id,quantidade_proximos FROM notificacoes_preferencias "+
  "WHERE empresa_id=?").bind(company).first();
 await notificationAcl(db,p,company,pref?.id);
 const amount=pref?.quantidade_proximos??5;
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const t=k=>parts.find(x=>x.type===k).value;
 const today=t("year")+"-"+t("month")+"-"+t("day");
 const raw=(await db.prepare("SELECT id,vencimento,valor_nominal_cent "+
  "FROM v_titulos_situacao WHERE empresa_id=? AND situacao='ABERTO' AND vencimento>=? "+
  "AND valor_nominal_cent IS NOT NULL ORDER BY vencimento,id LIMIT 5001")
  .bind(company,today).all())?.results||[];
 if(raw.length>5000)throw new DomainError("invalid_list",409);
 const values=[];
 for(const r of raw){
  // Rejeita snapshot inteiro se qualquer boleto for invisível, antigo ou incerto.
  await requireEntityPermission(db,p,company,"TITULO_PAGAR",r.id,"READ");
  const row=await db.prepare("SELECT origem_dado,conferencia FROM titulos_pagar "+
   "WHERE id=? AND empresa_id=?").bind(r.id,company).first();
  if(!row||row.origem_dado!=="NATIVO"||row.conferencia!=="VALIDADO"||
   !Number.isSafeInteger(r.valor_nominal_cent)||r.valor_nominal_cent<0)
   throw new DomainError("no_verifiable_upcoming_obligations",409);
  if(values.length<amount)values.push(r);
 }
 const sum=values.reduce((v,r)=>v+BigInt(r.valor_nominal_cent),0n);
 if(sum>BigInt(Number.MAX_SAFE_INTEGER))throw new DomainError("price_overflow",409);
 return {today,items:values,count:values.length,totalCent:Number(sum),
  message:values.length===0?"Sem vencimentos futuros verificados: não enviar avisos vazios.":
  "Prévia local, nenhuma mensagem foi enviada.",sent:false,sendAuthorized:false};
}
async function listMembers(db,company){
 const r=(await db.prepare("SELECT u.id,u.nome,u.email_normalizado,ue.papel,ue.ativo,"+
  "ue.versao FROM usuarios_empresas ue JOIN usuarios u ON u.id=ue.usuario_id "+
  "WHERE ue.empresa_id=? ORDER BY ue.ativo DESC,u.nome,u.id LIMIT 201")
  .bind(company).all())?.results||[];
 if(r.length>200)throw new DomainError("invalid_list",409);
 return {items:r};
}
async function revokeMember(db,p,company,id,data){
 strictlyObject(data,new Set(["intentId","expectedVersion","motivo","confirmUserId"]));
 if(data.confirmUserId!==id)throw new DomainError("invalid_revocation",400);
 const actor=await requireCompanyRole(db,p,company,"approve");
 if(id===actor.userId)throw new DomainError("last_admin_protected",409);
 const target=await db.prepare("SELECT papel,ativo FROM usuarios_empresas "+
  "WHERE usuario_id=? AND empresa_id=?").bind(id,company).first();
 if(!target||target.ativo!==1)throw new DomainError("entity_unavailable",404);
 // Revogar ADMIN sem prova de quorum transacional pode deixar zero admins
 // sob duas revogações concorrentes. F9 nunca faz isso; requer workflow
 // institucional separado, com quorum e auditoria independente.
 if(target.papel==="ADMIN")throw new DomainError("last_admin_protected",409);
 return revokeCompanyMembership(db,p,company,{
  intentId:data.intentId,targetUserId:id,expectedVersion:data.expectedVersion,
  motivo:data.motivo});
}
async function listRestrictions(db,p,company,url){
 query(url,["limit","after"]);const limit=asLimit(url);
 const after=url.searchParams.get("after");if(after!==null)identifier(after);
 const r=(await db.prepare("SELECT id,usuario_id,tipo_entidade,entidade_id,acao,motivo,criado_em "+
  "FROM r7_acl_bloqueios WHERE empresa_id=?"+(after?" AND id>?":"")+
  " ORDER BY id LIMIT ?").bind(...(after?[company,after,limit+1]:[company,limit+1])).all())?.results||[];
 const visible=[];
 for(const item of r.slice(0,limit)){
  try{
   await requireEntityPermission(db,p,company,item.tipo_entidade,item.entidade_id,"READ");
   visible.push(item);
  }catch(e){
   if(!(e instanceof DomainError||e instanceof SecurityError))throw e;
   if(e.status===401)throw e;
  }
 }
 return {items:visible,nextCursor:r.length>limit?r[limit-1].id:null};
}
async function readAudit(db,p,company,url){
 query(url,["limit","before","scope"]);
 const limit=asLimit(url),before=url.searchParams.get("before"),scope=url.searchParams.get("scope")||"events";
 if(!["events","operations"].includes(scope)||before!==null&&!/^[1-9]\d{0,14}$/.test(before))
  throw new DomainError("invalid_cursor",400);
 const actor=await requireCompanyRole(db,p,company,"approve");
 const blocked=await db.prepare("SELECT 1 AS blocked FROM r7_acl_bloqueios "+
  "WHERE empresa_id=? AND usuario_id=? AND acao IN ('READ','ALL') LIMIT 1")
  .bind(company,actor.userId).first();
 if(blocked)throw new SecurityError("aggregate_with_restricted_rows",403);
 const table=scope==="events"?"eventos_auditoria":"operacoes";
 const columns=scope==="events"?
  "rowid AS seq,id,tipo_entidade AS tipo,acao,ator_id,criado_em,data_hora":
  "rowid AS seq,id,tipo,estado AS acao,ator_id,criado_em,NULL AS data_hora";
 const r=(await db.prepare("SELECT "+columns+" FROM "+table+" WHERE empresa_id=?"+
  (before?" AND rowid<?":"")+" ORDER BY rowid DESC LIMIT ?")
  .bind(...(before?[company,Number(before),limit+1]:[company,limit+1])).all())?.results||[];
 return {items:r.slice(0,limit),nextCursor:r.length>limit?
  String(r[limit-1].seq):null,scope};
}
export function createF9Handler({fetchKeys}={}){
 return async(request,env)=>{
  const url=new URL(request.url),parts=ROUTE.exec(url.pathname);
  if(!parts)return null;
  const method=request.method.toUpperCase(),r=route(parts,method);
  if(!r)return json({error:"method_not_allowed"},405,method);
  try{
   if(!HOSTS.has(url.hostname)||env?.F1_RUNTIME_ENABLED!=="test_local_only"||
    env?.F9_RUNTIME_ENABLED!=="test_local_only"||!env.DB?.prepare||!env.DB?.batch)
    throw new SecurityError("f9_not_enabled",503);
   if(!["quotes","audit","restrictions","restrictionTargets"].includes(r.kind)&&
    r.kind!=="notifPreview")noQuery(url);
   if(["POST","PATCH"].includes(method))requireOrigin(request,env);
   const principal=await authenticateAccess(request,env,fetchKeys||fetch);
   await assertSessionActive(env.DB,principal);
   const action=r.kind==="saveQuote"?"write":
     ["settingSave","notifSchedule","recipientAdd","recipientDisable","revoke","restrict"].includes(r.kind)?
     "approve":"read";
   await requireCompanyRole(env.DB,principal,r.company,action);
   const db=env.DB,company=r.company;
   if(!["quotes","quote","saveQuote","pricing"].includes(r.kind))
    await requireCompanyRole(db,principal,company,"approve");
   let result;
   if(r.kind==="pricing"){
    const input=await body(request);
    result={calculation:priceQuote(input),saved:false,estimate:true};
   }else if(r.kind==="quotes")result=await listQuotes(db,principal,company,url);
   else if(r.kind==="quote")result=await quoteDetail(db,principal,company,r.id);
   else if(r.kind==="saveQuote")result=await saveQuote(db,principal,company,await body(request));
   else if(r.kind==="settings")result=await readSettings(db,company);
   else if(r.kind==="settingSave")result=await patchSetting(db,principal,company,await body(request));
   else if(r.kind==="notifications")result=await readNotifications(db,principal,company);
   else if(r.kind==="notifPreview")result=await previewNotifications(db,principal,company,url);
   else if(r.kind==="notifSchedule")result=await saveSchedule(db,principal,company,await body(request));
   else if(r.kind==="recipientAdd")result=await addRecipient(db,principal,company,await body(request));
   else if(r.kind==="recipientDisable")result=await disableRecipient(db,principal,company,r.recipient,await body(request));
   else if(r.kind==="members")result=await listMembers(db,company);
   else if(r.kind==="revoke")result=await revokeMember(db,principal,company,r.id,await body(request));
   else if(r.kind==="restrictions")result=await listRestrictions(db,principal,company,url);
   else if(r.kind==="restrictionTargets")result=await restrictionTargets(db,principal,company,url);
   else if(r.kind==="restrict"){
    const data=await body(request);
    result=await blockEntityForUser(db,principal,company,data);
   }else if(r.kind==="audit")result=await readAudit(db,principal,company,url);
   return json(result,method==="POST"&&r.kind!=="pricing"&&!result.replayed?201:200,method);
  }catch(e){
   if(e instanceof DomainError||e instanceof SecurityError){
    const status=Number.isInteger(e.status)&&e.status>=400&&e.status<=503?e.status:400;
    return json({error:ERROR_CODES.has(e.code)?e.code:"request_rejected"},status,method);
   }
   return json({error:"f9_unavailable"},503,method);
  }
 };
}
