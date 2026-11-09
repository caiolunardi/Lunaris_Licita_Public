// F5: BFF comercial para leitura autorizada e comandos R7 sobre Workerd/D1 local.
// Nenhum endpoint comercial é publicado remotamente por este Worker.
import {authenticateAccess,requireCompanyRole,SecurityError} from "../../src/r7/security.mjs";
import {assertSessionActive,requireEntityPermission,assertEntityNotBlocked} from "../../src/r7/iam.mjs";
import {DomainError,identifier,strictlyObject,positiveInt,money,dateCivil,hashIntent,replayOrConflict,requireBatch} from "../../src/r7/domain.mjs";
import {createCommitment,createPurchase} from "../../src/r7/commercial-steps.mjs";

const LOCAL=new Set(["licita.local.test","localhost","127.0.0.1"]);
const ROUTE=/^\/api\/v1\/companies\/([A-Za-z0-9_-]{1,128})\/commercial\/(commitments|purchases|tenders)(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/(available))?$/;
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0",
 "vary":"cf-access-jwt-assertion","x-content-type-options":"nosniff","x-frame-options":"DENY",
 "referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; frame-ancestors 'none'"};
const known=new Set(["f5_not_enabled","invalid_list","invalid_cursor","invalid_fields",
 "invalid_id","invalid_parent_version","invalid_commercial_number","invalid_commercial_items",
 "invalid_commercial_item","invalid_commercial_parent","commercial_commitment_conflict",
 "commercial_purchase_conflict","idempotency_conflict","invalid_supplier",
 "quantity_exceeded","commercial_total_overflow","entity_unavailable","access_token_required",
 "invalid_session","session_revoked","invalid_token","invalid_origin","app_origin_not_configured",
 "json_content_type_required","payload_too_large","invalid_json","record_not_found",
 "aggregate_too_large","supplier_mismatch","commercial_read_unavailable",
 "invalid_purchase_costs","purchase_cost_conflict"]);
const json=(data,status=200,method="GET")=>new Response(method==="HEAD"?null:JSON.stringify(data),
 {status,headers:HEADERS});
function sameSite(request,env){
 const expected=env?.APP_ORIGIN;
 if(typeof expected!=="string"||!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{2,5})?$/.test(expected))
  throw new SecurityError("app_origin_not_configured",503);
 if(new URL(request.url).origin!==expected||request.headers.get("origin")!==expected)
  throw new SecurityError("invalid_origin",403);
}
async function parseBody(req){
 const ct=req.headers.get("content-type")||"";
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(ct))
  throw new DomainError("json_content_type_required",415);
 const n=Number(req.headers.get("content-length")||0);
 if(!Number.isFinite(n)||n>8192)throw new DomainError("payload_too_large",413);
 const text=await req.text();
 if(new TextEncoder().encode(text).byteLength>8192)throw new DomainError("payload_too_large",413);
 try{return JSON.parse(text);}catch{throw new DomainError("invalid_json");}
}
function pageParams(url){
 for(const k of url.searchParams.keys())
  if(!["limit","after","q"].includes(k)||url.searchParams.getAll(k).length!==1)
   throw new DomainError("invalid_list");
 const n=url.searchParams.get("limit"),limit=n===null?25:Number(n);
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new DomainError("invalid_list");
 const cursor=url.searchParams.get("after");if(cursor!==null)identifier(cursor);
 const q=url.searchParams.get("q")||"";
 if(q.length>80||/[\u0000-\u001f\u007f]/.test(q))throw new DomainError("invalid_list");
 return {limit,after:cursor,q:q.trim().toLowerCase().replace(/[\\%_]/g,c=>"\\"+c)};
}
function denySQL(type,id,actor){
 return "NOT EXISTS(SELECT 1 FROM r7_acl_bloqueios b "+
  "WHERE b.empresa_id="+id+".empresa_id AND b.usuario_id=? "+
  "AND b.tipo_entidade='"+type+"' AND b.entidade_id="+id+".id "+
  "AND b.acao IN ('READ','ALL'))";
}
const columns={
 commitments:"e.id,e.numero,e.situacao,e.licitacao_id,e.versao,e.origem_dado,e.conferencia,l.numero AS licitacao_numero,o.nome AS orgao_nome",
 purchases:"c.id,c.numero_pedido AS numero,c.situacao,c.empenho_id,c.fornecedor_id,c.versao,c.origem_dado,c.conferencia,e.numero AS empenho_numero,f.nome AS fornecedor_nome"
};
function listSQL(kind,actorId){
 if(kind==="commitments")return {
  cols:columns.commitments,from:" FROM empenhos e JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id JOIN orgaos o ON o.id=l.orgao_id AND o.empresa_id=l.empresa_id",
  where:["e.empresa_id=?",denySQL("EMPENHO","e"),denySQL("LICITACAO","l")],
  name:"coalesce(e.numero,'')",args:[actorId,actorId]};
 return {cols:columns.purchases,
  from:" FROM compras c JOIN empenhos e ON e.id=c.empenho_id AND e.empresa_id=c.empresa_id JOIN fornecedores f ON f.id=c.fornecedor_id AND f.empresa_id=c.empresa_id JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id",
  where:["c.empresa_id=?",denySQL("COMPRA","c"),denySQL("EMPENHO","e"),denySQL("LICITACAO","l")],
  name:"coalesce(c.numero_pedido,'')",args:[actorId,actorId,actorId]};
}
async function list(db,company,actor,kind,url){
 const cfg=listSQL(kind,actor.userId),p=pageParams(url),alias=kind==="commitments"?"e":"c";
 const where=[...cfg.where],args=[company,...cfg.args];
 if(p.q){where.push("lower("+cfg.name+") LIKE ? ESCAPE '\\'");args.push("%"+p.q+"%");}
 if(p.after){
  const row=await db.prepare("SELECT "+cfg.name+" AS sort "+cfg.from+
    " WHERE "+where.join(" AND ")+" AND "+alias+".id=?")
   .bind(...args,p.after).first();
  if(!row)throw new DomainError("invalid_cursor");
  where.push("("+cfg.name+">? OR ("+cfg.name+"=? AND "+alias+".id>?))");
  args.push(row.sort,row.sort,p.after);
 }
 const rows=(await db.prepare("SELECT "+cfg.cols+cfg.from+" WHERE "+where.join(" AND ")+
  " ORDER BY "+cfg.name+","+alias+".id LIMIT ?").bind(...args,p.limit+1).all())?.results||[];
 return {items:rows.slice(0,p.limit),nextCursor:rows.length>p.limit?rows[p.limit-1].id:null,limit:p.limit};
}
async function access(db,principal,company,kind,id,action="READ"){
 await requireEntityPermission(db,principal,company,kind==="commitments"?"EMPENHO":"COMPRA",id,action);
 const row=kind==="commitments"?
   await db.prepare("SELECT e.*,l.numero AS licitacao_numero,o.nome AS orgao_nome "+
    "FROM empenhos e JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id "+
    "JOIN orgaos o ON o.id=l.orgao_id AND o.empresa_id=l.empresa_id "+
    "WHERE e.id=? AND e.empresa_id=?").bind(id,company).first():
   await db.prepare("SELECT c.*,e.numero AS empenho_numero,e.licitacao_id,f.nome AS fornecedor_nome "+
    "FROM compras c JOIN empenhos e ON e.id=c.empenho_id AND e.empresa_id=c.empresa_id "+
    "JOIN fornecedores f ON f.id=c.fornecedor_id AND f.empresa_id=c.empresa_id "+
    "WHERE c.id=? AND c.empresa_id=?").bind(id,company).first();
 if(!row)throw new DomainError("record_not_found",404);
 if(kind==="commitments"){
  await requireEntityPermission(db,principal,company,"LICITACAO",row.licitacao_id,action);
 }else{
  await requireEntityPermission(db,principal,company,"EMPENHO",row.empenho_id,action);
  await requireEntityPermission(db,principal,company,"LICITACAO",row.licitacao_id,action);
 }
 return row;
}
async function commitmentLines(db,company,id){
 const rows=(await db.prepare("SELECT ei.id,ei.empenho_id,ei.licitacao_item_id,ei.quantidade_mil,"+
  "ei.valor_unit_cent,ei.versao,ei.origem_dado,li.numero_item,li.descricao_exigida,li.unidade,"+
  "li.quantidade_ganha_mil,li.resultado FROM empenho_itens ei JOIN licitacao_itens li "+
  "ON li.id=ei.licitacao_item_id AND li.empresa_id=ei.empresa_id "+
  "WHERE ei.empresa_id=? AND ei.empenho_id=? ORDER BY li.numero_item,ei.id LIMIT 101")
  .bind(company,id).all())?.results||[];
 if(rows.length>100)throw new DomainError("aggregate_too_large",409);
 return rows;
}
async function purchaseLines(db,company,id){
 const rows=(await db.prepare("SELECT ci.id,ci.compra_id,ci.empenho_item_id,ci.quantidade_mil,"+
  "ci.valor_unit_cent,ci.versao,ci.origem_dado,ei.licitacao_item_id,li.numero_item,"+
  "li.descricao_exigida,li.unidade FROM compra_itens ci JOIN empenho_itens ei "+
  "ON ei.id=ci.empenho_item_id AND ei.empresa_id=ci.empresa_id "+
  "JOIN licitacao_itens li ON li.id=ei.licitacao_item_id AND li.empresa_id=ei.empresa_id "+
  "WHERE ci.empresa_id=? AND ci.compra_id=? ORDER BY li.numero_item,ci.id LIMIT 101")
  .bind(company,id).all())?.results||[];
 if(rows.length>100)throw new DomainError("aggregate_too_large",409);
 return rows;
}
async function detail(db,principal,company,kind,id){
 const item=await access(db,principal,company,kind,id);
 const lines=kind==="commitments"?await commitmentLines(db,company,id):
  await purchaseLines(db,company,id);
 for(const line of lines){
  await requireEntityPermission(db,principal,company,kind==="commitments"?"EMPENHO_ITEM":"COMPRA_ITEM",line.id,"READ");
  await requireEntityPermission(db,principal,company,"LICITACAO_ITEM",line.licitacao_item_id,"READ");
  if(kind==="purchases")await requireEntityPermission(db,principal,company,"EMPENHO_ITEM",line.empenho_item_id,"READ");
 }
 return {item,items:lines};
}
async function tenderAvailable(db,principal,company,id){
 const tender=await requireEntityPermission(db,principal,company,"LICITACAO",id,"READ");
 const rows=(await db.prepare("SELECT li.id,li.numero_item,li.descricao_exigida,li.unidade,"+
  "li.quantidade_ganha_mil,li.valor_final_unit_cent,li.resultado,"+
  "coalesce((SELECT SUM(ei.quantidade_mil) FROM empenho_itens ei "+
  "JOIN empenhos e ON e.id=ei.empenho_id AND e.empresa_id=ei.empresa_id "+
  "WHERE ei.empresa_id=li.empresa_id AND ei.licitacao_item_id=li.id "+
  "AND e.situacao='CONFIRMADO'),0) AS allocated_mil "+
  "FROM licitacao_itens li WHERE li.empresa_id=? AND li.licitacao_id=? "+
  "AND li.resultado='GANHO' ORDER BY li.numero_item,li.id LIMIT 101").bind(company,id).all())?.results||[];
 if(rows.length>100)throw new DomainError("aggregate_too_large",409);
 for(const line of rows){
  await requireEntityPermission(db,principal,company,"LICITACAO_ITEM",line.id,"READ");
  if(!Number.isSafeInteger(line.allocated_mil)||line.allocated_mil>line.quantidade_ganha_mil)
   throw new DomainError("quantity_exceeded",409);
 }
 const row=await db.prepare("SELECT id,numero,versao,encerrada_em,situacao_participacao,origem_dado "+
   "FROM licitacoes WHERE empresa_id=? AND id=?").bind(company,id).first();
 return {parent:row,items:rows.map(l=>({...l,remaining_mil:l.quantidade_ganha_mil-l.allocated_mil}))};
}
async function commitmentAvailable(db,principal,company,id){
 const parent=await access(db,principal,company,"commitments",id);
 const rows=(await db.prepare("SELECT ei.id,ei.licitacao_item_id,li.numero_item,li.descricao_exigida,"+
  "li.unidade,ei.quantidade_mil,ei.valor_unit_cent,"+
  "coalesce((SELECT SUM(ci.quantidade_mil) FROM compra_itens ci "+
  "JOIN compras c ON c.id=ci.compra_id AND c.empresa_id=ci.empresa_id "+
  "WHERE ci.empresa_id=ei.empresa_id AND ci.empenho_item_id=ei.id "+
  "AND c.situacao='CONFIRMADA'),0) AS allocated_mil "+
  "FROM empenho_itens ei JOIN licitacao_itens li "+
  "ON li.id=ei.licitacao_item_id AND li.empresa_id=ei.empresa_id "+
  "WHERE ei.empresa_id=? AND ei.empenho_id=? ORDER BY li.numero_item,ei.id LIMIT 101")
   .bind(company,id).all())?.results||[];
 if(rows.length>100)throw new DomainError("aggregate_too_large",409);
 for(const row of rows){
  await requireEntityPermission(db,principal,company,"EMPENHO_ITEM",row.id,"READ");
  await requireEntityPermission(db,principal,company,"LICITACAO_ITEM",row.licitacao_item_id,"READ");
  if(!Number.isSafeInteger(row.allocated_mil)||row.allocated_mil>row.quantidade_mil)
   throw new DomainError("quantity_exceeded",409);
 }
 return {parent,items:rows.map(l=>({...l,remaining_mil:l.quantidade_mil-l.allocated_mil}))};
}
async function updatePurchaseCosts(db,principal,company,id,body){
 requireBatch(db);
 strictlyObject(body,new Set(["intentId","expectedVersion","freteCent","outrosCustosCent",
   "condicaoPagamento","dataCompra","previsaoDespacho","previsaoEntrega"]));
 const intent=identifier(body.intentId);
 if(!positiveInt(body.expectedVersion)||!money(body.freteCent)||
    !money(body.outrosCustosCent))throw new DomainError("invalid_purchase_costs");
 if(BigInt(body.freteCent)+BigInt(body.outrosCustosCent)>BigInt(Number.MAX_SAFE_INTEGER))
  throw new DomainError("invalid_purchase_costs");
 const condition=body.condicaoPagamento??null;
 if(condition!==null&&(typeof condition!=="string"||condition.trim()!==condition||
  condition.length>300||/[\u0000-\u001f\u007f]/.test(condition)))
  throw new DomainError("invalid_purchase_costs");
 const dates=[body.dataCompra??null,body.previsaoDespacho??null,body.previsaoEntrega??null];
 if(!dates.every(v=>v===null||dateCivil(v)))throw new DomainError("invalid_purchase_costs");
 await access(db,principal,company,"purchases",id,"WRITE");
 const actor=await requireCompanyRole(db,principal,company,"write");
 const type="F5_REVISAR_CUSTOS_COMPRA";
 const hash=await hashIntent(type,[id,body.expectedVersion,body.freteCent,
  body.outrosCustosCent,condition,...dates]);
 const replay=await replayOrConflict(db,company,intent,hash,type);
 if(replay)return replay;
 const at=new Date().toISOString();
 const change=db.prepare("UPDATE compras SET frete_cent=?,outros_custos_cent=?,"+
  "condicao_pagamento=?,data_compra=?,previsao_despacho=?,previsao_entrega=?,"+
  "versao=versao+1,operacao_id=?,atualizado_em=? "+
  "WHERE id=? AND empresa_id=? AND versao=? AND origem_dado='NATIVO' "+
  "AND situacao='CONFIRMADA' "+
  "AND NOT EXISTS(SELECT 1 FROM compra_itens ci JOIN envio_itens ei "+
  "ON ei.compra_item_id=ci.id AND ei.empresa_id=ci.empresa_id "+
  "WHERE ci.empresa_id=compras.empresa_id AND ci.compra_id=compras.id) "+
  "AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)")
   .bind(body.freteCent,body.outrosCustosCent,condition,...dates,intent,at,
    id,company,body.expectedVersion,intent);
 const journal=db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,"+
  "estado,origem_dado,conferencia) SELECT ?,?,?,?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
  "FROM compras WHERE id=? AND empresa_id=? AND versao=? AND operacao_id=?")
  .bind(intent,company,type,hash,actor.userId,id,company,body.expectedVersion+1,intent);
 const audit=db.prepare("INSERT INTO eventos_auditoria(id,empresa_id,tipo_entidade,"+
  "entidade_id_texto,acao,ator_id,resumo,operacao_id,origem_dado,conferencia) "+
  "SELECT ?,?,'COMPRA',?,'REVISAR_CUSTOS',?,? ,?,'NATIVO','VALIDADO' "+
  "FROM operacoes WHERE id=? AND empresa_id=? AND estado='CONCLUIDA'")
  .bind(crypto.randomUUID(),company,id,actor.userId,"Custos F5",intent,intent,company);
 let result;
 try{result=await db.batch([change,journal,audit]);}
 catch{throw new DomainError("purchase_cost_conflict",409);}
 if(result?.length===3&&result.every(x=>x?.meta?.changes===1))
  return {id,intentId:intent,replayed:false,newVersion:body.expectedVersion+1};
 const raced=await replayOrConflict(db,company,intent,hash,type);
 if(raced)return raced;
 throw new DomainError("purchase_cost_conflict",409);
}
async function commit(db,principal,company,body){
 strictlyObject(body,new Set(["intentId","parentId","expectedParentVersion","numero","items"]));
 identifier(body.parentId);identifier(body.intentId);
 if(!Array.isArray(body.items)||body.items.length<1||body.items.length>20)
  throw new DomainError("invalid_commercial_items");
 await requireEntityPermission(db,principal,company,"LICITACAO",body.parentId,"WRITE");
 for(const line of body.items){
  strictlyObject(line,new Set(["parentItemId","quantidadeMil","valorUnitCent"]));
  await requireEntityPermission(db,principal,company,"LICITACAO_ITEM",identifier(line.parentItemId),"WRITE");
  const source=await db.prepare("SELECT id,resultado,licitacao_id FROM licitacao_itens "+
   "WHERE empresa_id=? AND id=?").bind(company,line.parentItemId).first();
  if(source?.licitacao_id!==body.parentId||source.resultado!=="GANHO")
   throw new DomainError("invalid_commercial_item",409);
 }
 return createCommitment(db,principal,company,body);
}
async function purchase(db,principal,company,body){
 strictlyObject(body,new Set(["intentId","parentId","expectedParentVersion","numero","fornecedorId","items"]));
 const parent=identifier(body.parentId),supplier=identifier(body.fornecedorId),intent=identifier(body.intentId);
 if(!Array.isArray(body.items)||body.items.length<1||body.items.length>20)
  throw new DomainError("invalid_commercial_items");
 await access(db,principal,company,"commitments",parent,"WRITE");
 const f=await db.prepare("SELECT ativo FROM fornecedores WHERE id=? AND empresa_id=?")
   .bind(supplier,company).first();
 if(f?.ativo!==1)throw new DomainError("invalid_supplier",409);
 for(const l of body.items){
  strictlyObject(l,new Set(["parentItemId","quantidadeMil","valorUnitCent"]));
  await requireEntityPermission(db,principal,company,"EMPENHO_ITEM",identifier(l.parentItemId),"WRITE");
  const row=await db.prepare("SELECT empenho_id,licitacao_item_id FROM empenho_itens "+
    "WHERE id=? AND empresa_id=?").bind(l.parentItemId,company).first();
  if(row?.empenho_id!==parent)throw new DomainError("invalid_commercial_item",409);
  await requireEntityPermission(db,principal,company,"LICITACAO_ITEM",row.licitacao_item_id,"WRITE");
 }
 // R7 CRIAR_PURCHASE has legacy replay hash without fornecedorId; fail-closed here
 // on both sides of command so the same intent cannot confirm a DIFFERENT supplier.
 const replaySupplier=async()=>{
  const prior=await db.prepare("SELECT fornecedor_id FROM compras "+
   "WHERE empresa_id=? AND operacao_id=? LIMIT 1").bind(company,intent).first();
  if(prior&&prior.fornecedor_id!==supplier)throw new DomainError("supplier_mismatch",409);
 };
 await replaySupplier();
 const result=await createPurchase(db,principal,company,body);
 await replaySupplier();
 return result;
}
function routing(parts,method){
 const [,company,resource,id,available]=parts;
 if(resource==="tenders")return id&&available==="available"&&["GET","HEAD"].includes(method)?
  {kind:"tenderAvailable",company,id}:null;
 if(resource==="commitments"||resource==="purchases"){
  if(!id)return ["GET","HEAD"].includes(method)?{kind:"list",company,resource}:
    method==="POST"?{kind:"create",company,resource}:null;
  if(available==="available"&&resource==="commitments"&&["GET","HEAD"].includes(method))
   return {kind:"commitmentAvailable",company,id};
  if(!available&&resource==="purchases"&&method==="PATCH")return {kind:"costs",company,id,resource};
  if(!available&&["GET","HEAD"].includes(method))return {kind:"detail",company,resource,id};
 }
 return null;
}
export function createF5Handler({fetchKeys}={}){
 return async function handler(request,env){
  const url=new URL(request.url),parts=ROUTE.exec(url.pathname);
  if(!parts)return null;
  const method=request.method.toUpperCase(),route=routing(parts,method);
  if(!route)return json({error:"method_not_allowed"},405,method);
  try{
   if(!LOCAL.has(url.hostname)||env?.F1_RUNTIME_ENABLED!=="test_local_only"||
    env?.F5_RUNTIME_ENABLED!=="test_local_only"||!env?.DB?.prepare||!env.DB.batch)
    throw new SecurityError("f5_not_enabled",503);
   if(route.kind!=="list"&&url.search)throw new DomainError("invalid_list");
   if(method==="POST"||method==="PATCH")sameSite(request,env);
   const principal=await authenticateAccess(request,env,fetchKeys||fetch);
   await assertSessionActive(env.DB,principal);
   const actor=await requireCompanyRole(env.DB,principal,route.company,
    method==="POST"||method==="PATCH"?"write":"read");
   let result;
   if(route.kind==="list")result=await list(env.DB,route.company,actor,route.resource,url);
   else if(route.kind==="detail")result=await detail(env.DB,principal,route.company,route.resource,route.id);
   else if(route.kind==="tenderAvailable")result=await tenderAvailable(env.DB,principal,route.company,route.id);
   else if(route.kind==="commitmentAvailable")result=await commitmentAvailable(env.DB,principal,route.company,route.id);
   else if(route.kind==="costs")result=await updatePurchaseCosts(env.DB,principal,route.company,route.id,await parseBody(request));
   else {
    const body=await parseBody(request);
    result=route.resource==="commitments"?
     await commit(env.DB,principal,route.company,body):
     await purchase(env.DB,principal,route.company,body);
   }
   return json(result,method==="POST"&&!result.replayed?201:200,method);
  }catch(e){
   if(e instanceof SecurityError||e instanceof DomainError)
    return json({error:known.has(e.code)?e.code:"request_rejected"},
     Number.isInteger(e.status)&&e.status>=400&&e.status<=503?e.status:400,method);
   return json({error:"commercial_read_unavailable"},503,method);
  }
 };
}
