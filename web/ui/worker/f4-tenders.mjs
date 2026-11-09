// F4 licitações: BFF local-only com contratos R7 já auditados.
// Sem D1 local, hostname de laboratório e flag explícita, retorna 503.
import {authenticateAccess,requireCompanyRole,SecurityError} from "../../src/r7/security.mjs";
import {assertSessionActive,requireEntityPermission,requireDocumentPermission} from "../../src/r7/iam.mjs";
import {DomainError,strictlyObject,identifier,positiveInt,money,hashIntent,replayOrConflict,requireBatch} from "../../src/r7/domain.mjs";
import {decideAwardItem} from "../../src/r7/business-commands.mjs";
import {closeCommercialCycle,reopenCommercialCycle} from "../../src/r7/commercial-cycles.mjs";

const LOCAL=new Set(["licita.local.test","localhost","127.0.0.1"]);
const PATH=/^\/api\/v1\/companies\/([A-Za-z0-9_-]{1,128})\/licitacoes(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/([a-z-]+))?(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/([a-z-]+))?$/;
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0",
 "vary":"cf-access-jwt-assertion","x-content-type-options":"nosniff",
 "x-frame-options":"DENY","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; frame-ancestors 'none'"};
const ERROR_CODES=new Set(["f4_not_enabled","app_origin_not_configured","invalid_origin","invalid_json",
 "json_content_type_required","payload_too_large","invalid_fields","invalid_id","invalid_list",
 "invalid_cursor","invalid_tender","invalid_item","invalid_year","invalid_url","invalid_time",
 "invalid_award_decision","invalid_award_quantity_or_price","award_state_conflict",
 "invalid_licitation_cycle","commercial_closure_conflict","commercial_reopen_conflict",
 "entity_unavailable","document_owner_unavailable","access_token_required","invalid_token",
 "invalid_session","session_revoked","forbidden","idempotency_conflict","version_conflict",
 "create_conflict","tender_conflict","item_conflict","document_link_conflict","too_many_links",
 "access_not_configured","access_keys_unavailable","access_keys_invalid"]);
const json=(data,status=200,method="GET")=>new Response(method==="HEAD"?null:JSON.stringify(data),{status,headers:HEADERS});
const normalize=s=>s.normalize("NFKD").replace(/\p{M}/gu,"").replace(/\s+/g," ").toLocaleLowerCase("pt-BR").trim();
const escapeLike=s=>s.replace(/[\\%_]/g,v=>"\\"+v);
const memberSql="EXISTS (SELECT 1 FROM usuarios u JOIN usuarios_empresas ue ON ue.usuario_id=u.id "+
 "JOIN empresas e ON e.id=ue.empresa_id WHERE u.id=? AND u.access_issuer=? "+
 "AND u.access_subject=? AND u.ativo=1 AND ue.empresa_id=? "+
 "AND ue.ativo=1 AND ue.papel IN ('ADMIN','OPERADOR') AND e.ativo=1)";
function originCheck(req,env){
 const expected=env?.APP_ORIGIN;
 if(typeof expected!=="string"||!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{2,5})?$/.test(expected))
  throw new SecurityError("app_origin_not_configured",503);
 if(req.headers.get("origin")!==expected||new URL(req.url).origin!==expected)
  throw new SecurityError("invalid_origin",403);
}
async function bodyJSON(req){
 const mime=req.headers.get("content-type")||"";
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(mime))
  throw new DomainError("json_content_type_required",415);
 const len=Number(req.headers.get("content-length")||0);
 if(!Number.isFinite(len)||len>8192)throw new DomainError("payload_too_large",413);
 const txt=await req.text();
 if(new TextEncoder().encode(txt).byteLength>8192)throw new DomainError("payload_too_large",413);
 try{return JSON.parse(txt);}catch{throw new DomainError("invalid_json");}
}
const exact=(obj,fields)=>{strictlyObject(obj,new Set(fields));return obj;};
function phrase(v,n=220,required=false){
 if(v===undefined||v===null||v===""){
  if(required)throw new DomainError("invalid_fields");return null;
 }
 if(typeof v!=="string"||v.trim().length>n||(!v.trim()&&required)||
   /[\u0000-\u001f\u007f]/.test(v))throw new DomainError("invalid_fields");
 return v.trim()||null;
}
function year(v){if(!Number.isSafeInteger(v)||v<1900||v>9999)throw new DomainError("invalid_year");return v;}
function version(v){if(!positiveInt(v))throw new DomainError("version_conflict",409);return v;}
function cents(v){if(!positiveInt(v)||!money(v))throw new DomainError("invalid_item");return v;}
function qty(v){if(!positiveInt(v))throw new DomainError("invalid_item");return v;}
function optionalCents(v){if(v==null||v==="")return null;if(!money(v))throw new DomainError("invalid_item");return v;}
function isoTime(v){
 if(v==null||v==="")return null;
 if(typeof v!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)||
   !Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)
  throw new DomainError("invalid_time");
 return v;
}
function https(v){
 const s=phrase(v,1000);
 if(s===null)return null;
 try{
  const u=new URL(s);
  if(u.protocol!=="https:"||u.username||u.password||u.hostname.length>253||!u.hostname.includes("."))
   throw new Error();
  return u.toString();
 }catch{throw new DomainError("invalid_url");}
}
function tenderForm(body,editing=false){
 const fields=["modalidade","objeto","portal","urlProcesso","limitePropostaEm","inicioDisputaEm",
  "decisaoParticipacao","situacaoParticipacao","responsavelTexto","observacoes"];
 exact(body,["intentId",...fields,...(editing?["expectedVersion"]:["orgaoId","numero","ano"])]);
 const intentId=identifier(body.intentId);
 if(editing)version(body.expectedVersion);
 const decisions=["PENDENTE","PARTICIPAR","NAO_PARTICIPAR"];
 const statuses=["EM_ANALISE","EM_PREPARACAO","AGUARDANDO_DISPUTA","RESULTADO_PENDENTE","CANCELADA"];
 const decision=body.decisaoParticipacao??"PENDENTE";
 const status=body.situacaoParticipacao??"EM_ANALISE";
 if(!decisions.includes(decision)||!statuses.includes(status))throw new DomainError("invalid_tender");
 const x={modalidade:phrase(body.modalidade,120),objeto:phrase(body.objeto,2000),
  portal:phrase(body.portal,255),url_processo:https(body.urlProcesso),
  limite_proposta_em:isoTime(body.limitePropostaEm),inicio_disputa_em:isoTime(body.inicioDisputaEm),
  decisao_participacao:decision,situacao_participacao:status,
  responsavel_texto:phrase(body.responsavelTexto,180),observacoes:phrase(body.observacoes,3000)};
 if(editing)return {intentId,expectedVersion:body.expectedVersion,fields:x};
 const numero=phrase(body.numero,100,true),orgaoId=identifier(body.orgaoId),ano=year(body.ano);
 return {intentId,orgaoId,numero,ano,normalized:normalize(numero),fields:x};
}
function itemForm(body,editing=false){
 const fields=["numeroItem","lote","descricaoExigida","unidade",
  "quantidadePrevistaMil","valorPropostaUnitCent","produtoOfertado","marcaOfertada",
  "modeloOfertado","observacoes"];
 exact(body,["intentId",...fields,...(editing?["expectedVersion"]:[])]);
 const intentId=identifier(body.intentId);
 if(editing)version(body.expectedVersion);
 const numeroItem=phrase(body.numeroItem,80,true),lote=phrase(body.lote,100);
 const x={numero_item:numeroItem,numero_item_normalizado:normalize(numeroItem),
  lote,lote_normalizado:lote?normalize(lote):null,
  descricao_exigida:phrase(body.descricaoExigida,2000,true),
  unidade:phrase(body.unidade,45,true),
  quantidade_prevista_mil:qty(body.quantidadePrevistaMil),
  valor_proposta_unit_cent:optionalCents(body.valorPropostaUnitCent),
  produto_ofertado:phrase(body.produtoOfertado,400),
  marca_ofertada:phrase(body.marcaOfertada,180),
  modelo_ofertado:phrase(body.modeloOfertado,180),
  observacoes:phrase(body.observacoes,2000)};
 return {intentId,expectedVersion:body.expectedVersion??null,fields:x};
}
function filters(url){
 for(const k of url.searchParams.keys())
  if(!["limit","after","q","year","state"].includes(k)||url.searchParams.getAll(k).length!==1)
   throw new DomainError("invalid_list");
 const limitStr=url.searchParams.get("limit"),limit=limitStr===null?25:Number(limitStr);
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new DomainError("invalid_list");
 const after=url.searchParams.get("after");
 if(after!==null)identifier(after);
 const q=url.searchParams.get("q")||"";
 if(q.length>80||/[\u0000-\u001f\u007f]/.test(q))throw new DomainError("invalid_list");
 const yr=url.searchParams.get("year");
 const state=url.searchParams.get("state")||"active";
 if(!["active","cancelled","all"].includes(state))throw new DomainError("invalid_list");
 return {limit,after,q:normalize(q),year:yr===null?null:year(Number(yr)),state};
}
const TENDER_COLUMNS="l.id,l.orgao_id,o.nome AS orgao_nome,l.numero,l.ano,l.modalidade,l.objeto,"+
 "l.portal,l.url_processo,l.limite_proposta_em,l.inicio_disputa_em,l.decisao_participacao,"+
 "l.situacao_participacao,l.responsavel_texto,l.observacoes,l.encerrada_em,"+
 "l.motivo_encerramento,l.origem_dado,l.conferencia,l.versao";
const ITEM_COLUMNS="i.id,i.licitacao_id,i.numero_item,i.lote,i.descricao_exigida,i.unidade,"+
 "i.quantidade_prevista_mil,i.valor_proposta_unit_cent,i.produto_ofertado,i.marca_ofertada,"+
 "i.modelo_ofertado,i.resultado,i.quantidade_ganha_mil,i.valor_final_unit_cent,"+
 "i.observacoes,i.origem_dado,i.conferencia,i.versao";
function baseWhere(company,actor,p){
 const where=["l.empresa_id=?",
  "NOT EXISTS(SELECT 1 FROM r7_acl_bloqueios b WHERE b.empresa_id=l.empresa_id "+
  "AND b.usuario_id=? AND b.tipo_entidade='LICITACAO' AND b.entidade_id=l.id "+
  "AND b.acao IN ('READ','ALL'))"];
 const binds=[company,actor.userId];
 if(p.year!==null){where.push("l.ano=?");binds.push(p.year);}
 if(p.state==="active")where.push("coalesce(l.situacao_participacao,'')<>'CANCELADA'");
 if(p.state==="cancelled")where.push("l.situacao_participacao='CANCELADA'");
 if(p.q){where.push("(coalesce(l.numero_normalizado,lower(l.numero)) LIKE ? ESCAPE '\\' "+
   "OR lower(coalesce(l.objeto,'')) LIKE ? ESCAPE '\\')");
  binds.push(escapeLike(p.q)+"%", "%"+escapeLike(p.q)+"%");}
 return {where,binds};
}
async function listTenders(db,company,actor,url){
 const p=filters(url),{where,binds}=baseWhere(company,actor,p);
 const sort="coalesce(l.numero_normalizado,lower(l.numero))";
 const from=" FROM licitacoes l JOIN orgaos o ON o.id=l.orgao_id AND o.empresa_id=l.empresa_id";
 if(p.after){
  const cur=await db.prepare("SELECT "+sort+" AS sort FROM licitacoes l "+
    "WHERE "+where.join(" AND ")+" AND l.id=?").bind(...binds,p.after).first();
  if(!cur)throw new DomainError("invalid_cursor",400);
  where.push("("+sort+">? OR ("+sort+"=? AND l.id>?))");
  binds.push(cur.sort,cur.sort,p.after);
 }
 const rows=(await db.prepare("SELECT "+TENDER_COLUMNS+from+" WHERE "+where.join(" AND ")+
   " ORDER BY "+sort+",l.id LIMIT ?").bind(...binds,p.limit+1).all())?.results||[];
 return {items:rows.slice(0,p.limit),nextCursor:rows.length>p.limit?rows[p.limit-1].id:null,
   limit:p.limit};
}
async function detail(db,principal,company,id){
 await requireEntityPermission(db,principal,company,"LICITACAO",id,"READ");
 const item=await db.prepare("SELECT "+TENDER_COLUMNS+
  " FROM licitacoes l JOIN orgaos o ON o.id=l.orgao_id AND o.empresa_id=l.empresa_id "+
  "WHERE l.id=? AND l.empresa_id=?").bind(id,company).first();
 if(!item)throw new DomainError("entity_unavailable",404);
 const items=(await db.prepare("SELECT "+ITEM_COLUMNS+" FROM licitacao_itens i "+
  "WHERE i.empresa_id=? AND i.licitacao_id=? ORDER BY "+
  "coalesce(i.lote_normalizado,''),coalesce(i.numero_item_normalizado,lower(i.numero_item)),i.id LIMIT 501")
   .bind(company,id).all())?.results||[];
 const cycles=(await db.prepare("SELECT id,encerrada_em,reaberta_em,motivo,motivo_reabertura,versao "+
  "FROM licitacao_encerramentos WHERE empresa_id=? AND licitacao_id=? "+
  "ORDER BY encerrada_em,id LIMIT 101").bind(company,id).all())?.results||[];
 const doc=(await db.prepare("SELECT v.id AS vinculo_id,v.papel,d.id AS documento_id,d.titulo,"+
  "dv.numero_versao,dv.estado_integridade,dv.nome_original,d.origem_dado "+
  "FROM documento_vinculos v JOIN documentos d ON d.id=v.documento_id "+
  "AND d.empresa_id=v.empresa_id LEFT JOIN documento_versoes dv "+
  "ON dv.id=d.versao_corrente_id AND dv.empresa_id=d.empresa_id "+
  "WHERE v.empresa_id=? AND v.licitacao_id=? AND v.ativo=1 "+
  "ORDER BY v.papel,v.id LIMIT 101").bind(company,id).all())?.results||[];
 const commitments=(await db.prepare("SELECT id,numero,situacao,versao FROM empenhos "+
  "WHERE empresa_id=? AND licitacao_id=? ORDER BY id LIMIT 101")
   .bind(company,id).all())?.results||[];
 if(items.length>500||cycles.length>100||doc.length>100||commitments.length>100)
  throw new DomainError("too_many_links",409);
 // NUNCA renderizar uma ficha parcialmente: o usuário deve ter acesso a
 // todos os itens, documentos tipados e empenhos relacionados.
 for(const row of items)await requireEntityPermission(db,principal,company,"LICITACAO_ITEM",row.id,"READ");
 for(const row of doc)await requireDocumentPermission(db,principal,company,row.documento_id,"READ");
 for(const row of commitments)await requireEntityPermission(db,principal,company,"EMPENHO",row.id,"READ");
 return {item,items,cycles,documents:doc,commitments};
}
function journal(db,op,company,type,hash,actor,id,table,nextVersion){
 return db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
  "SELECT ?,?,?,?,?,'CONCLUIDA','NATIVO','VALIDADO' FROM "+table+
  " WHERE id=? AND empresa_id=? AND versao=? AND operacao_id=?")
  .bind(op,company,type,hash,actor.userId,id,company,nextVersion,op);
}
function audit(db,op,company,type,id,actor,action,licId){
 return db.prepare("INSERT INTO eventos_auditoria("+
  "id,empresa_id,tipo_entidade,entidade_id_texto,licitacao_id,acao,ator_id,resumo,operacao_id,origem_dado,conferencia) "+
  "SELECT ?,?,?,?,?,?,?,?,?,'NATIVO','VALIDADO' FROM operacoes "+
  "WHERE id=? AND empresa_id=? AND estado='CONCLUIDA'")
  .bind(crypto.randomUUID(),company,type,id,licId,action,actor.userId,
    "Comando F4 "+action,op,op,company);
}
async function commit3(db,statements,ctx){
 let result;
 try{result=await db.batch(statements);}catch{throw new DomainError(ctx,409);}
 if(result?.length===3&&result.every(x=>x?.meta?.changes===1))return;
 throw new DomainError(ctx,409);
}
async function newTender(db,principal,company,actor,body){
 requireBatch(db);
 const cmd=tenderForm(body);
 const type="F4_CRIAR_LICITACAO";
 const hash=await hashIntent(type,[cmd.orgaoId,cmd.numero,cmd.ano,cmd.fields]);
 const replay=await replayOrConflict(db,company,cmd.intentId,hash,type);
 if(replay)return replay;
 const agency=await db.prepare("SELECT id FROM orgaos WHERE empresa_id=? AND id=? AND ativo=1")
   .bind(company,cmd.orgaoId).first();
 if(!agency)throw new DomainError("invalid_tender",409);
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const keys=Object.keys(cmd.fields);
 const cols=["id","empresa_id","orgao_id","numero","numero_normalizado","ano",...keys,
  "criado_em","atualizado_em","operacao_id","origem_dado","conferencia"];
 const values=[id,company,cmd.orgaoId,cmd.numero,cmd.normalized,cmd.ano,
  ...keys.map(k=>cmd.fields[k]),now,now,cmd.intentId,"NATIVO","VALIDADO"];
 const insert=db.prepare("INSERT INTO licitacoes("+cols.join(",")+") "+
  "SELECT "+cols.map(()=>"?").join(",")+" WHERE "+memberSql+
  " AND EXISTS(SELECT 1 FROM orgaos WHERE id=? AND empresa_id=? AND ativo=1) "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)")
  .bind(...values,actor.userId,principal.issuer,principal.subject,company,
   cmd.orgaoId,company,cmd.intentId);
 await commit3(db,[insert,journal(db,cmd.intentId,company,type,hash,actor,id,"licitacoes",1),
   audit(db,cmd.intentId,company,"LICITACAO",id,actor,"CRIAR",id)],"create_conflict");
 return {id,newVersion:1,intentId:cmd.intentId,replayed:false};
}
async function editTender(db,principal,company,actor,id,body){
 requireBatch(db);
 const cmd=tenderForm(body,true),type="F4_ATUALIZAR_LICITACAO";
 const hash=await hashIntent(type,[id,cmd.expectedVersion,cmd.fields]);
 const prior=await replayOrConflict(db,company,cmd.intentId,hash,type);
 if(prior)return prior;
 const cols=Object.keys(cmd.fields),now=new Date().toISOString();
 const update=db.prepare("UPDATE licitacoes SET "+
  cols.map(k=>k+"=?").join(",")+
  ",versao=versao+1,atualizado_em=?,operacao_id=? WHERE id=? AND empresa_id=? "+
  "AND versao=? AND origem_dado='NATIVO' AND encerrada_em IS NULL "+
  "AND "+memberSql+" "+
  "AND (?<>'CANCELADA' OR NOT EXISTS(SELECT 1 FROM licitacao_itens i "+
  "WHERE i.empresa_id=licitacoes.empresa_id AND i.licitacao_id=licitacoes.id "+
  "AND i.resultado='GANHO')) "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)")
   .bind(...cols.map(k=>cmd.fields[k]),now,cmd.intentId,id,company,
    cmd.expectedVersion,actor.userId,principal.issuer,principal.subject,company,
    cmd.fields.situacao_participacao,cmd.intentId);
 await commit3(db,[update,journal(db,cmd.intentId,company,type,hash,actor,id,"licitacoes",cmd.expectedVersion+1),
  audit(db,cmd.intentId,company,"LICITACAO",id,actor,"ATUALIZAR",id)],"tender_conflict");
 return {id,newVersion:cmd.expectedVersion+1,intentId:cmd.intentId,replayed:false};
}
async function newItem(db,principal,company,actor,id,body){
 requireBatch(db);
 const cmd=itemForm(body),type="F4_CRIAR_ITEM";
 const hash=await hashIntent(type,[id,cmd.fields]);
 const prior=await replayOrConflict(db,company,cmd.intentId,hash,type);
 if(prior)return prior;
 const now=new Date().toISOString(),childId=crypto.randomUUID();
 const keys=Object.keys(cmd.fields),cols=["id","empresa_id","licitacao_id",...keys,
   "resultado","criado_em","atualizado_em","operacao_id","origem_dado","conferencia"];
 const values=[childId,company,id,...keys.map(x=>cmd.fields[x]),"PENDENTE",
  now,now,cmd.intentId,"NATIVO","VALIDADO"];
 const insert=db.prepare("INSERT INTO licitacao_itens ("+cols.join(",")+") "+
  "SELECT "+cols.map(()=>"?").join(",")+" WHERE "+memberSql+" "+
  "AND EXISTS(SELECT 1 FROM licitacoes l WHERE l.id=? AND l.empresa_id=? "+
  "AND l.origem_dado='NATIVO' AND l.encerrada_em IS NULL "+
  "AND coalesce(l.situacao_participacao,'')<>'CANCELADA') "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)")
  .bind(...values,actor.userId,principal.issuer,principal.subject,company,id,company,cmd.intentId);
 await commit3(db,[insert,journal(db,cmd.intentId,company,type,hash,actor,childId,"licitacao_itens",1),
  audit(db,cmd.intentId,company,"LICITACAO_ITEM",childId,actor,"CRIAR_ITEM",id)],"item_conflict");
 return {id:childId,newVersion:1,intentId:cmd.intentId,replayed:false};
}
async function editItem(db,principal,company,actor,id,itemId,body){
 requireBatch(db);
 const cmd=itemForm(body,true),type="F4_ATUALIZAR_ITEM";
 const hash=await hashIntent(type,[id,itemId,cmd.expectedVersion,cmd.fields]);
 const prior=await replayOrConflict(db,company,cmd.intentId,hash,type);
 if(prior)return prior;
 const cols=Object.keys(cmd.fields),now=new Date().toISOString();
 const update=db.prepare("UPDATE licitacao_itens SET "+cols.map(k=>k+"=?").join(",")+
 ",versao=versao+1,atualizado_em=?,operacao_id=? "+
 "WHERE id=? AND licitacao_id=? AND empresa_id=? AND versao=? "+
 "AND origem_dado='NATIVO' AND coalesce(resultado,'PENDENTE')='PENDENTE' "+
 "AND "+memberSql+" "+
 "AND EXISTS(SELECT 1 FROM licitacoes l WHERE l.id=licitacao_itens.licitacao_id "+
 "AND l.empresa_id=licitacao_itens.empresa_id AND l.encerrada_em IS NULL "+
 "AND coalesce(l.situacao_participacao,'')<>'CANCELADA') "+
 "AND NOT EXISTS(SELECT 1 FROM empenho_itens ei WHERE ei.licitacao_item_id=licitacao_itens.id "+
 "AND ei.empresa_id=licitacao_itens.empresa_id) "+
 "AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)")
 .bind(...cols.map(k=>cmd.fields[k]),now,cmd.intentId,itemId,id,company,cmd.expectedVersion,
   actor.userId,principal.issuer,principal.subject,company,cmd.intentId);
 await commit3(db,[update,journal(db,cmd.intentId,company,type,hash,actor,itemId,"licitacao_itens",cmd.expectedVersion+1),
  audit(db,cmd.intentId,company,"LICITACAO_ITEM",itemId,actor,"ATUALIZAR_ITEM",id)],"item_conflict");
 return {id:itemId,newVersion:cmd.expectedVersion+1,intentId:cmd.intentId,replayed:false};
}
async function linkDocument(db,principal,company,actor,id,body){
 requireBatch(db);
 exact(body,["intentId","documentoId","papel"]);
 const intent=identifier(body.intentId),docId=identifier(body.documentoId),papel=body.papel;
 if(!["EDITAL","PROPOSTA"].includes(papel))throw new DomainError("invalid_fields");
 // Só documentos existentes, já associados a um dono autorizado, com ACL
 // de todos os donos conferida pelo serviço R7; sem receber bytes pelo F4.
 await requireDocumentPermission(db,principal,company,docId,"WRITE");
 const type="F4_VINCULAR_DOCUMENTO",hash=await hashIntent(type,[id,docId,papel]);
 const prior=await replayOrConflict(db,company,intent,hash,type);
 if(prior)return prior;
 const linkId=crypto.randomUUID();
 const insert=db.prepare("INSERT INTO documento_vinculos("+
 "id,empresa_id,documento_id,papel,licitacao_id,ativo,operacao_id,origem_dado,conferencia) "+
 "SELECT ?,?,?,?,?,1,?,'NATIVO','VALIDADO' WHERE "+memberSql+" "+
 "AND EXISTS(SELECT 1 FROM licitacoes l WHERE l.id=? AND l.empresa_id=? "+
 "AND l.origem_dado='NATIVO' AND l.encerrada_em IS NULL) "+
 "AND EXISTS(SELECT 1 FROM documentos d WHERE d.id=? AND d.empresa_id=?) "+
 "AND NOT EXISTS(SELECT 1 FROM operacoes o WHERE o.id=?)")
 .bind(linkId,company,docId,papel,id,intent,
    actor.userId,principal.issuer,principal.subject,company,id,company,docId,company,intent);
 await commit3(db,[insert,journal(db,intent,company,type,hash,actor,linkId,"documento_vinculos",1),
  audit(db,intent,company,"DOCUMENTO_VINCULO",linkId,actor,"VINCULAR_DOCUMENTO",id)],"document_link_conflict");
 return {id:linkId,intentId:intent,replayed:false,newVersion:1};
}
function route(parts,method){
 const [,company,id,kind,child,action]=parts;
 if(!id)return ["GET","HEAD"].includes(method)?{kind:"list",company}:method==="POST"?{kind:"new",company}:null;
 if(!kind)return ["GET","HEAD"].includes(method)?{kind:"detail",company,id}:method==="PATCH"?{kind:"edit",company,id}:null;
 if(kind==="items"){
  if(!child)return method==="POST"?{kind:"newItem",company,id}:null;
  if(!action)return method==="PATCH"?{kind:"editItem",company,id,child}:null;
  if(action==="award")return method==="POST"?{kind:"award",company,id,child}:null;
 }
 if(kind==="documents"&&!child)return method==="POST"?{kind:"linkDocument",company,id}:null;
 if(kind==="cycle"){
  if(child==="close"&&!action&&method==="POST")return {kind:"close",company,id};
  if(child&&action==="reopen"&&method==="POST")return {kind:"reopen",company,id,child};
 }
 return null;
}
function awardPayload(body,id,itemId){
 exact(body,["intentId","expectedVersion","resultado","quantidadeGanhaMil","valorFinalUnitCent"]);
 return {...body,licitacaoId:id,licitacaoItemId:itemId};
}
function cyclePayload(body,id,cycleId){
 exact(body,cycleId?["intentId","expectedVersion","motivo"]:["intentId","expectedVersion","motivo"]);
 return {...body,licitacaoId:id,...(cycleId?{cicloId:cycleId}:{})};
}
export function createF4Handler({fetchKeys}={}){
 return async function handler(request,env){
  const url=new URL(request.url),parts=PATH.exec(url.pathname);
  if(!parts)return null;
  const method=request.method.toUpperCase(),r=route(parts,method);
  if(!r)return json({error:"method_not_allowed"},405,method);
  try{
   if(!LOCAL.has(url.hostname)||env?.F1_RUNTIME_ENABLED!=="test_local_only"||
     env?.F4_RUNTIME_ENABLED!=="test_local_only"||!env?.DB?.prepare||!env.DB.batch)
    throw new SecurityError("f4_not_enabled",503);
   if(["POST","PATCH"].includes(method))originCheck(request,env);
   if(r.kind!=="list"&&url.search)throw new DomainError("invalid_list");
   const principal=await authenticateAccess(request,env,fetchKeys||fetch);
   await assertSessionActive(env.DB,principal);
   const read=method==="GET"||method==="HEAD";
   const actor=await requireCompanyRole(env.DB,principal,r.company,read?"read":
    r.kind==="reopen"?"approve":"write");
   if(r.kind==="list")return json(await listTenders(env.DB,r.company,actor,url),200,method);
   if(r.kind==="detail")return json(await detail(env.DB,principal,r.company,r.id),200,method);
   if(r.id){
    await requireEntityPermission(env.DB,principal,r.company,"LICITACAO",r.id,"WRITE");
    if(r.child&&["award","editItem"].includes(r.kind))
     await requireEntityPermission(env.DB,principal,r.company,"LICITACAO_ITEM",r.child,"WRITE");
   }
   const body=await bodyJSON(request);
   let data;
   if(r.kind==="new")data=await newTender(env.DB,principal,r.company,actor,body);
   else if(r.kind==="edit")data=await editTender(env.DB,principal,r.company,actor,r.id,body);
   else if(r.kind==="newItem")data=await newItem(env.DB,principal,r.company,actor,r.id,body);
   else if(r.kind==="editItem")data=await editItem(env.DB,principal,r.company,actor,r.id,r.child,body);
   else if(r.kind==="linkDocument")data=await linkDocument(env.DB,principal,r.company,actor,r.id,body);
   else if(r.kind==="award")data=await decideAwardItem(env.DB,principal,r.company,awardPayload(body,r.id,r.child));
   else if(r.kind==="close")data=await closeCommercialCycle(env.DB,principal,r.company,cyclePayload(body,r.id));
   else if(r.kind==="reopen")data=await reopenCommercialCycle(env.DB,principal,r.company,cyclePayload(body,r.id,r.child));
   else throw new DomainError("invalid_fields");
   return json(data,data?.replayed?200:r.kind==="edit"||r.kind==="editItem"?200:201,method);
  }catch(error){
   if(error instanceof SecurityError||error instanceof DomainError)
    return json({error:ERROR_CODES.has(error.code)?error.code:"request_rejected"},
     error.status>=400&&error.status<=503?error.status:400,method);
   return json({error:"tenders_unavailable"},503,method);
  }
 };
}
