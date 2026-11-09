// F6 — Remessas, aceites e notas fiscais. Workerd/D1 sintetico, jamais remoto.
import {authenticateAccess,requireCompanyRole,SecurityError} from "../../src/r7/security.mjs";
import {assertSessionActive,requireEntityPermission} from "../../src/r7/iam.mjs";
import {DomainError,identifier,strictlyObject,positiveInt,money,dateCivil,
 hashIntent,replayOrConflict,requireBatch} from "../../src/r7/domain.mjs";
import {createShipment,createSalesInvoice} from "../../src/r7/commercial-steps.mjs";
import {registerDeliveryAcceptance} from "../../src/r7/business-commands.mjs";
import {confirmInvoiceAmounts} from "../../src/r7/invoices.mjs";
import {rectifySealedInvoice} from "../../src/r7/invoice-rectifications.mjs";

const LOCAL=new Set(["licita.local.test","localhost","127.0.0.1"]);
const ROUTE=/^\/api\/v1\/companies\/([A-Za-z0-9_-]{1,128})\/fulfillment\/(shipments|invoices|commitments)(?:\/([A-Za-z0-9_-]{1,128}))?(?:\/(available-to-ship|available-to-invoice|acceptances|delivery|metadata|confirm|rectify))?$/;
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0",
 "vary":"cf-access-jwt-assertion","x-content-type-options":"nosniff","x-frame-options":"DENY",
 "referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; frame-ancestors 'none'"};
const known=new Set(["f6_not_enabled","invalid_id","invalid_fields","invalid_list","invalid_cursor",
 "invalid_origin","app_origin_not_configured","json_content_type_required","payload_too_large",
 "invalid_json","entity_unavailable","record_not_found","invalid_commercial_parent",
 "invalid_commercial_item","invalid_commercial_items","invalid_delivery_acceptance",
 "invalid_invoice_version","invoice_not_confirmable","invoice_amount_mismatch",
 "invoice_not_rectifiable","invoice_rectification_conflict","invalid_invoice_rectification",
 "invalid_invoice_rectification_item","invalid_invoice_rectification_amount_mismatch",
 "commercial_shipment_conflict","commercial_invoice_conflict","delivery_acceptance_conflict",
 "invoice_reconciliation_conflict","idempotency_conflict","invalid_parent_version",
 "quantity_exceeded","aggregate_too_large","invalid_f6_metadata","f6_metadata_conflict",
 "access_token_required","invalid_session","session_revoked","invalid_token"]);
const json=(data,status=200,method="GET")=>new Response(method==="HEAD"?null:JSON.stringify(data),{status,headers:HEADERS});
function originGuard(req,env){
 const expected=env?.APP_ORIGIN;
 if(typeof expected!=="string"||!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{2,5})?$/.test(expected))
  throw new SecurityError("app_origin_not_configured",503);
 if(new URL(req.url).origin!==expected||req.headers.get("origin")!==expected)
  throw new SecurityError("invalid_origin",403);
}
async function bodyJSON(req){
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get("content-type")||""))
  throw new DomainError("json_content_type_required",415);
 const size=Number(req.headers.get("content-length")||"0");
 if(!Number.isSafeInteger(size)||size>8192)throw new DomainError("payload_too_large",413);
 const text=await req.text();
 if(new TextEncoder().encode(text).byteLength>8192)throw new DomainError("payload_too_large",413);
 try{return JSON.parse(text);}catch{throw new DomainError("invalid_json");}
}
function page(url){
 for(const k of url.searchParams.keys())
  if(!["q","limit","after"].includes(k)||url.searchParams.getAll(k).length!==1)
   throw new DomainError("invalid_list");
 const raw=url.searchParams.get("limit"),limit=raw===null?25:Number(raw);
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new DomainError("invalid_list");
 const after=url.searchParams.get("after");
 if(after!==null)identifier(after);
 const q=(url.searchParams.get("q")||"").trim();
 if(q.length>80||/[\u0000-\u001f\u007f]/.test(q))throw new DomainError("invalid_list");
 return {limit,after,q:q.toLowerCase().replace(/[\\%_]/g,c=>"\\"+c)};
}
const denied=(type,alias)=>"NOT EXISTS(SELECT 1 FROM r7_acl_bloqueios b WHERE b.empresa_id="+alias+
 ".empresa_id AND b.usuario_id=? AND b.tipo_entidade='"+type+"' AND b.entidade_id="+alias+
 ".id AND b.acao IN ('READ','ALL'))";
async function chain(db,p,company,empenhoId,action){
 await requireEntityPermission(db,p,company,"EMPENHO",empenhoId,action);
 const row=await db.prepare("SELECT e.*,l.id AS licitacao_id,l.numero AS licitacao_numero "+
  "FROM empenhos e JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id "+
  "WHERE e.empresa_id=? AND e.id=?").bind(company,empenhoId).first();
 if(!row)throw new DomainError("record_not_found",404);
 await requireEntityPermission(db,p,company,"LICITACAO",row.licitacao_id,action);
 return row;
}
async function shipmentRow(db,p,company,id,action){
 await requireEntityPermission(db,p,company,"ENVIO",id,action);
 const row=await db.prepare("SELECT s.*,e.numero AS empenho_numero,l.id AS licitacao_id "+
  "FROM envios s JOIN empenhos e ON e.id=s.empenho_id AND e.empresa_id=s.empresa_id "+
  "JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id "+
  "WHERE s.empresa_id=? AND s.id=?").bind(company,id).first();
 if(!row)throw new DomainError("record_not_found",404);
 await chain(db,p,company,row.empenho_id,action);
 return row;
}
async function invoiceRow(db,p,company,id,action){
 await requireEntityPermission(db,p,company,"NOTA_FISCAL",id,action);
 const row=await db.prepare("SELECT n.*,e.numero AS empenho_numero,l.id AS licitacao_id "+
  "FROM notas_fiscais n JOIN empenhos e ON e.id=n.empenho_id AND e.empresa_id=n.empresa_id "+
  "JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id "+
  "WHERE n.empresa_id=? AND n.id=?").bind(company,id).first();
 if(!row)throw new DomainError("record_not_found",404);
 await chain(db,p,company,row.empenho_id,action);
 return row;
}
async function shipmentLines(db,p,company,id,action){
 const rows=(await db.prepare("SELECT si.*,ci.compra_id,ci.empenho_item_id,ei.licitacao_item_id,"+
  "li.numero_item,li.descricao_exigida,li.unidade,c.numero_pedido "+
  "FROM envio_itens si JOIN compra_itens ci ON ci.id=si.compra_item_id AND ci.empresa_id=si.empresa_id "+
  "JOIN compras c ON c.id=ci.compra_id AND c.empresa_id=ci.empresa_id "+
  "JOIN empenho_itens ei ON ei.id=ci.empenho_item_id AND ei.empresa_id=ci.empresa_id "+
  "JOIN licitacao_itens li ON li.id=ei.licitacao_item_id AND li.empresa_id=ci.empresa_id "+
  "WHERE si.empresa_id=? AND si.envio_id=? ORDER BY li.numero_item,si.id LIMIT 101")
  .bind(company,id).all())?.results||[];
 if(rows.length>100)throw new DomainError("aggregate_too_large",409);
 for(const x of rows){
  for(const [type,itemId] of [["ENVIO_ITEM",x.id],["COMPRA",x.compra_id],
   ["COMPRA_ITEM",x.compra_item_id],["EMPENHO_ITEM",x.empenho_item_id],
   ["LICITACAO_ITEM",x.licitacao_item_id]])
   await requireEntityPermission(db,p,company,type,itemId,action);
 }
 return rows;
}
async function invoiceLines(db,p,company,id,action){
 const rows=(await db.prepare("SELECT ni.*,ei.licitacao_item_id,li.numero_item,li.descricao_exigida,li.unidade "+
  "FROM nota_fiscal_itens ni JOIN empenho_itens ei ON ei.id=ni.empenho_item_id AND ei.empresa_id=ni.empresa_id "+
  "JOIN licitacao_itens li ON li.id=ei.licitacao_item_id AND li.empresa_id=ni.empresa_id "+
  "WHERE ni.empresa_id=? AND ni.nota_fiscal_id=? ORDER BY li.numero_item,ni.id LIMIT 101")
   .bind(company,id).all())?.results||[];
 if(rows.length>100)throw new DomainError("aggregate_too_large",409);
 for(const x of rows){
  await requireEntityPermission(db,p,company,"EMPENHO_ITEM",x.empenho_item_id,action);
  await requireEntityPermission(db,p,company,"LICITACAO_ITEM",x.licitacao_item_id,action);
 }
 return rows;
}
async function invoiceParcels(db,p,company,id,action){
 const rows=(await db.prepare("SELECT c.* FROM contas_receber c WHERE c.empresa_id=? "+
  "AND c.nota_fiscal_id=? ORDER BY c.parcela,c.id LIMIT 101").bind(company,id).all())?.results||[];
 if(rows.length>100)throw new DomainError("aggregate_too_large",409);
 for(const row of rows)await requireEntityPermission(db,p,company,"CONTA_RECEBER",row.id,action);
 return rows;
}
async function list(db,p,company,actor,kind,url){
 const args=[company,actor.userId,actor.userId,actor.userId];
 const cfg=kind==="shipments"?
  {cols:"s.id,s.situacao,s.empenho_id,e.numero AS empenho_numero,s.transportadora,s.codigo_rastreio,s.data_despacho,s.previsao_entrega,s.data_entrega,s.versao,s.origem_dado,s.conferencia",
   from:" FROM envios s JOIN empenhos e ON e.id=s.empenho_id AND e.empresa_id=s.empresa_id JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id",
   alias:"s",acl:[denied("ENVIO","s"),denied("EMPENHO","e"),denied("LICITACAO","l")],
   name:"coalesce(s.codigo_rastreio,'')"}:
  {cols:"n.id,n.numero,n.serie,n.emissao,n.situacao,n.valor_documento_cent,n.empenho_id,e.numero AS empenho_numero,n.versao,n.origem_dado,n.conferencia",
   from:" FROM notas_fiscais n JOIN empenhos e ON e.id=n.empenho_id AND e.empresa_id=n.empresa_id JOIN licitacoes l ON l.id=e.licitacao_id AND l.empresa_id=e.empresa_id",
   alias:"n",acl:[denied("NOTA_FISCAL","n"),denied("EMPENHO","e"),denied("LICITACAO","l")],
   name:"coalesce(n.numero,'')"};
 const opts=page(url),where=[cfg.alias+".empresa_id=?",...cfg.acl];
 if(opts.q){where.push("(lower("+cfg.name+") LIKE ? ESCAPE '\\' OR lower("+cfg.alias+".id) LIKE ? ESCAPE '\\')");args.push("%"+opts.q+"%","%"+opts.q+"%");}
 if(opts.after){
  const cursor=await db.prepare("SELECT "+cfg.alias+".id "+cfg.from+" WHERE "+where.join(" AND ")+
   " AND "+cfg.alias+".id=?").bind(...args,opts.after).first();
  if(!cursor)throw new DomainError("invalid_cursor");
  where.push(cfg.alias+".id>?");args.push(opts.after);
 }
 const records=(await db.prepare("SELECT "+cfg.cols+cfg.from+" WHERE "+where.join(" AND ")+
  " ORDER BY "+cfg.alias+".id LIMIT ?").bind(...args,opts.limit+1).all())?.results||[];
 return {items:records.slice(0,opts.limit),
  nextCursor:records.length>opts.limit?records[opts.limit-1].id:null,limit:opts.limit};
}
async function detail(db,p,company,kind,id){
 if(kind==="shipments"){
  const item=await shipmentRow(db,p,company,id,"READ");
  const items=await shipmentLines(db,p,company,id,"READ");
  return {item,items};
 }
 const item=await invoiceRow(db,p,company,id,"READ");
 const items=await invoiceLines(db,p,company,id,"READ");
 const parcelas=await invoiceParcels(db,p,company,id,"READ");
 const selo=await db.prepare("SELECT id,numero_versao_nf,valor_documento_cent,arredondamento "+
  "FROM nf_conciliacoes WHERE empresa_id=? AND nota_fiscal_id=? LIMIT 1").bind(company,id).first();
 const retificacao=(await db.prepare("SELECT nota_original_id,nota_substituta_id,motivo "+
  "FROM nf_retificacoes WHERE empresa_id=? AND (nota_original_id=? OR nota_substituta_id=?) LIMIT 2")
  .bind(company,id,id).all())?.results||[];
 return {item,items,parcelas,selo:selo||null,retificacoes:retificacao};
}
async function priorVisibility(db,p,company,empenhoId,type){
 const sql=type==="ship"?
  "SELECT DISTINCT s.id FROM envios s WHERE s.empresa_id=? AND s.empenho_id=? AND s.situacao IN ('DESPACHADO','ENTREGUE')":
  "SELECT DISTINCT n.id FROM notas_fiscais n WHERE n.empresa_id=? AND n.empenho_id=? AND n.situacao IN ('EMITIDA','APRESENTADA')";
 const rows=(await db.prepare(sql+" LIMIT 101").bind(company,empenhoId).all())?.results||[];
 if(rows.length>100)throw new DomainError("aggregate_too_large",409);
 for(const row of rows)await requireEntityPermission(db,p,company,
  type==="ship"?"ENVIO":"NOTA_FISCAL",row.id,"READ");
}
async function available(db,p,company,id,type){
 const parent=await chain(db,p,company,id,"READ");
 await priorVisibility(db,p,company,id,type);
 let rows;
 if(type==="ship"){
  rows=(await db.prepare("SELECT ci.id,ci.compra_id,ci.empenho_item_id,ei.licitacao_item_id,"+
   "ci.quantidade_mil,ci.valor_unit_cent,li.numero_item,li.descricao_exigida,li.unidade,"+
   "c.numero_pedido,f.nome AS fornecedor_nome,"+
   "coalesce((SELECT SUM(si.quantidade_mil) FROM envio_itens si JOIN envios s "+
   "ON s.id=si.envio_id AND s.empresa_id=si.empresa_id "+
   "WHERE si.empresa_id=ci.empresa_id AND si.compra_item_id=ci.id "+
   "AND s.situacao IN ('DESPACHADO','ENTREGUE')),0) AS allocated_mil "+
   "FROM compra_itens ci JOIN compras c ON c.id=ci.compra_id AND c.empresa_id=ci.empresa_id "+
   "JOIN fornecedores f ON f.id=c.fornecedor_id AND f.empresa_id=c.empresa_id "+
   "JOIN empenho_itens ei ON ei.id=ci.empenho_item_id AND ei.empresa_id=ci.empresa_id "+
   "JOIN licitacao_itens li ON li.id=ei.licitacao_item_id AND li.empresa_id=ci.empresa_id "+
   "WHERE ci.empresa_id=? AND ci.empenho_id_escopo=? AND c.situacao='CONFIRMADA' "+
   "ORDER BY li.numero_item,ci.id LIMIT 101").bind(company,id).all())?.results||[];
 }else{
  rows=(await db.prepare("SELECT ei.id,ei.licitacao_item_id,ei.quantidade_mil,ei.valor_unit_cent,"+
   "li.numero_item,li.descricao_exigida,li.unidade,"+
   "coalesce((SELECT SUM(ni.quantidade_mil) FROM nota_fiscal_itens ni "+
   "JOIN notas_fiscais n ON n.id=ni.nota_fiscal_id AND n.empresa_id=ni.empresa_id "+
   "WHERE ni.empresa_id=ei.empresa_id AND ni.empenho_item_id=ei.id "+
   "AND n.situacao IN ('EMITIDA','APRESENTADA')),0) AS allocated_mil "+
   "FROM empenho_itens ei JOIN licitacao_itens li ON li.id=ei.licitacao_item_id AND li.empresa_id=ei.empresa_id "+
   "WHERE ei.empresa_id=? AND ei.empenho_id=? ORDER BY li.numero_item,ei.id LIMIT 101")
   .bind(company,id).all())?.results||[];
 }
 if(rows.length>100)throw new DomainError("aggregate_too_large",409);
 for(const x of rows){
  await requireEntityPermission(db,p,company,"EMPENHO_ITEM",type==="ship"?x.empenho_item_id:x.id,"READ");
  await requireEntityPermission(db,p,company,"LICITACAO_ITEM",x.licitacao_item_id,"READ");
  if(type==="ship"){
   await requireEntityPermission(db,p,company,"COMPRA",x.compra_id,"READ");
   await requireEntityPermission(db,p,company,"COMPRA_ITEM",x.id,"READ");
  }
  if(!Number.isSafeInteger(x.allocated_mil)||!Number.isSafeInteger(x.quantidade_mil)||
   x.allocated_mil<0||x.allocated_mil>x.quantidade_mil)
   throw new DomainError("quantity_exceeded",409);
 }
 return {parent,items:rows.map(x=>({...x,remaining_mil:x.quantidade_mil-x.allocated_mil}))};
}
async function create(db,p,company,kind,body){
 strictlyObject(body,kind==="shipments"?
  new Set(["intentId","parentId","expectedParentVersion","items"]):
  new Set(["intentId","parentId","expectedParentVersion","items","parcelasCent"]));
 const id=identifier(body.parentId);
 if(!Array.isArray(body.items)||body.items.length<1||body.items.length>20)
  throw new DomainError("invalid_commercial_items");
 await chain(db,p,company,id,"WRITE");
 for(const x of body.items){
  strictlyObject(x,kind==="shipments"?
   new Set(["parentItemId","quantidadeMil"]):
   new Set(["parentItemId","quantidadeMil","valorUnitCent"]));
  const itemId=identifier(x.parentItemId);
  if(kind==="shipments"){
   await requireEntityPermission(db,p,company,"COMPRA_ITEM",itemId,"WRITE");
   const row=await db.prepare("SELECT ci.empenho_id_escopo,ci.compra_id,ci.empenho_item_id,ei.licitacao_item_id "+
    "FROM compra_itens ci JOIN empenho_itens ei ON ei.id=ci.empenho_item_id "+
    "AND ei.empresa_id=ci.empresa_id WHERE ci.empresa_id=? AND ci.id=?")
    .bind(company,itemId).first();
   if(row?.empenho_id_escopo!==id)throw new DomainError("invalid_commercial_item",409);
   for(const [type,key] of [["COMPRA",row.compra_id],["EMPENHO_ITEM",row.empenho_item_id],
    ["LICITACAO_ITEM",row.licitacao_item_id]])
    await requireEntityPermission(db,p,company,type,key,"WRITE");
  }else{
   await requireEntityPermission(db,p,company,"EMPENHO_ITEM",itemId,"WRITE");
   const row=await db.prepare("SELECT empenho_id,licitacao_item_id FROM empenho_itens "+
    "WHERE empresa_id=? AND id=?").bind(company,itemId).first();
   if(row?.empenho_id!==id)throw new DomainError("invalid_commercial_item",409);
   await requireEntityPermission(db,p,company,"LICITACAO_ITEM",row.licitacao_item_id,"WRITE");
  }
 }
 return kind==="shipments"?createShipment(db,p,company,body):createSalesInvoice(db,p,company,body);
}
async function accept(db,p,company,id,body){
 strictlyObject(body,new Set(["intentId","envioId","envioItemId","expectedVersion",
  "quantidadeAceitaMil","quantidadeRecusadaMil","motivoRecusa"]));
 if(body.envioId!==id)throw new DomainError("invalid_delivery_acceptance");
 await shipmentRow(db,p,company,id,"WRITE");
 const lines=await shipmentLines(db,p,company,id,"WRITE");
 if(!lines.some(x=>x.id===body.envioItemId))throw new DomainError("record_not_found",404);
 return registerDeliveryAcceptance(db,p,company,body);
}
async function invoiceConfirm(db,p,company,id,body){
 strictlyObject(body,new Set(["intentId","notaFiscalId","expectedVersion"]));
 if(body.notaFiscalId!==id)throw new DomainError("invalid_invoice_version");
 await invoiceRow(db,p,company,id,"WRITE");
 await invoiceLines(db,p,company,id,"WRITE");
 await invoiceParcels(db,p,company,id,"WRITE");
 return confirmInvoiceAmounts(db,p,company,body);
}
async function rectify(db,p,company,id,body){
 strictlyObject(body,new Set(["intentId","notaFiscalOriginalId","expectedVersion","motivo","items","parcelasCent"]));
 if(body.notaFiscalOriginalId!==id)throw new DomainError("invalid_invoice_rectification");
 const old=await invoiceRow(db,p,company,id,"WRITE");
 await invoiceLines(db,p,company,id,"WRITE");
 await invoiceParcels(db,p,company,id,"WRITE");
 if(!Array.isArray(body.items)||body.items.length>20)
  throw new DomainError("invalid_invoice_rectification");
 for(const x of body.items){
  strictlyObject(x,new Set(["empenhoItemId","quantidadeMil","valorUnitCent"]));
  await requireEntityPermission(db,p,company,"EMPENHO_ITEM",identifier(x.empenhoItemId),"WRITE");
  const line=await db.prepare("SELECT empenho_id,licitacao_item_id FROM empenho_itens "+
   "WHERE empresa_id=? AND id=?").bind(company,x.empenhoItemId).first();
  if(line?.empenho_id!==old.empenho_id)throw new DomainError("invalid_commercial_item",409);
  await requireEntityPermission(db,p,company,"LICITACAO_ITEM",line.licitacao_item_id,"WRITE");
 }
 return rectifySealedInvoice(db,p,company,body);
}
function optionalText(value,max){
 if(value===null||value===undefined)return null;
 if(typeof value!=="string"||value.trim()!==value||value.length>max||
  /[\u0000-\u001f\u007f]/.test(value))throw new DomainError("invalid_f6_metadata");
 return value||null;
}
function optionalDate(value){
 if(value===null||value===undefined||value==="")return null;
 if(!dateCivil(value))throw new DomainError("invalid_f6_metadata");
 return value;
}
function optionalURL(value){
 const s=optionalText(value,500);
 if(!s)return null;
 try{const u=new URL(s);
  if(u.protocol!=="https:"||u.username||u.password||!u.hostname)
   throw new Error("invalid");
 }catch{throw new DomainError("invalid_f6_metadata");}
 return s;
}
async function updateMetadata(db,p,company,kind,id,body){
 requireBatch(db);
 const shipment=kind==="shipments";
 const keys=shipment?
  ["intentId","expectedVersion","situacao","transportadora","codigoRastreio","urlRastreio",
   "dataDespacho","previsaoEntrega","dataEntrega","recebedor","enderecoEntrega","observacoes"]:
  ["intentId","expectedVersion","numero","serie","chaveAcesso","emissao","protocolo",
   "apresentadaEm","observacoes"];
 strictlyObject(body,new Set(keys));
 const intent=identifier(body.intentId),version=body.expectedVersion;
 if(!positiveInt(version))throw new DomainError("invalid_f6_metadata");
 const row=shipment?await shipmentRow(db,p,company,id,"WRITE"):
  await invoiceRow(db,p,company,id,"WRITE");
 if(row.origem_dado!=="NATIVO"||row.conferencia!=="VALIDADO")
  throw new DomainError("f6_metadata_conflict",409);
 const actor=await requireCompanyRole(db,p,company,"write");
 let vals=[],sets=[],guard="";
 if(shipment){
  if(!["DESPACHADO","ENTREGUE"].includes(body.situacao))
   throw new DomainError("invalid_f6_metadata");
  const date=optionalDate(body.dataEntrega);
  if(body.situacao==="ENTREGUE"&&!date)throw new DomainError("invalid_f6_metadata");
  vals=[optionalText(body.transportadora,250),optionalText(body.codigoRastreio,200),
   optionalURL(body.urlRastreio),optionalDate(body.dataDespacho),
   optionalDate(body.previsaoEntrega),date,optionalText(body.recebedor,300),
   optionalText(body.enderecoEntrega,1000),optionalText(body.observacoes,5000),
   body.situacao];
  sets=["transportadora","codigo_rastreio","url_rastreio","data_despacho",
   "previsao_entrega","data_entrega","recebedor","endereco_entrega",
   "observacoes","situacao"];
  guard=" AND situacao='DESPACHADO' "+
   "AND (?<>'ENTREGUE' OR NOT EXISTS(SELECT 1 FROM envio_itens i "+
   "WHERE i.empresa_id=envios.empresa_id AND i.envio_id=envios.id "+
   "AND (i.quantidade_mil IS NULL OR i.quantidade_aceita_mil+i.quantidade_recusada_mil<>i.quantidade_mil)))";
  // O estado ENTREGUE exige a decisao completa de todos os itens, sem inventar aceite.
 }else{
  vals=[optionalText(body.numero,100),optionalText(body.serie,30),
   optionalText(body.chaveAcesso,100),optionalDate(body.emissao),
   optionalText(body.protocolo,200),optionalDate(body.apresentadaEm),
   optionalText(body.observacoes,5000)];
  sets=["numero","serie","chave_acesso","emissao","protocolo","apresentada_em","observacoes"];
  guard=" AND situacao IN ('EMITIDA','APRESENTADA') "+
   "AND NOT EXISTS(SELECT 1 FROM nf_conciliacoes s WHERE s.empresa_id=notas_fiscais.empresa_id AND s.nota_fiscal_id=notas_fiscais.id) "+
   "AND NOT EXISTS(SELECT 1 FROM contas_receber c JOIN recebimentos r "+
   "ON r.conta_receber_id=c.id AND r.empresa_id=c.empresa_id "+
   "WHERE c.empresa_id=notas_fiscais.empresa_id AND c.nota_fiscal_id=notas_fiscais.id)";
 }
 const type=shipment?"F6_ENTREGA_METADATA":"F6_NF_METADATA";
 const hash=await hashIntent(type,[id,version,vals]);
 const replay=await replayOrConflict(db,company,intent,hash,type);
 if(replay)return replay;
 const table=shipment?"envios":"notas_fiscais";
 const at=new Date().toISOString();
 const change=db.prepare("UPDATE "+table+" SET "+sets.map(x=>x+"=?").join(",")+
  ",versao=versao+1,operacao_id=?,atualizado_em=? "+
  "WHERE id=? AND empresa_id=? AND versao=? AND origem_dado='NATIVO' AND conferencia='VALIDADO'"+
  guard+" AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)")
  .bind(...vals,intent,at,id,company,version,...(shipment?[body.situacao]:[]),intent);
 const journal=db.prepare("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,"+
  "estado,origem_dado,conferencia) SELECT ?,?,?,?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
  "FROM "+table+" WHERE id=? AND empresa_id=? AND versao=? AND operacao_id=?")
  .bind(intent,company,type,hash,actor.userId,id,company,version+1,intent);
 const audit=db.prepare("INSERT INTO eventos_auditoria(id,empresa_id,tipo_entidade,entidade_id_texto,"+
  "acao,ator_id,resumo,operacao_id,origem_dado,conferencia) "+
  "SELECT ?,?,?,?,?,?,?,?,'NATIVO','VALIDADO' FROM operacoes "+
  "WHERE empresa_id=? AND id=? AND estado='CONCLUIDA'")
  .bind(crypto.randomUUID(),company,shipment?"ENVIO":"NOTA_FISCAL",id,
   "ATUALIZAR_METADADOS",actor.userId,"Revisao F6",intent,company,intent);
 let res;
 try{res=await db.batch([change,journal,audit]);}catch{throw new DomainError("f6_metadata_conflict",409);}
 if(res?.length===3&&res.every(x=>x?.meta?.changes===1))
  return {id,intentId:intent,newVersion:version+1,replayed:false};
 const prior=await replayOrConflict(db,company,intent,hash,type);
 if(prior)return prior;
 throw new DomainError("f6_metadata_conflict",409);
}
function route(parts,method){
 const [,company,resource,id,action]=parts;
 if(resource==="commitments"){
  if(id&&["GET","HEAD"].includes(method)&&
   ["available-to-ship","available-to-invoice"].includes(action))
   return {company,resource,kind:"available",id,action};
  return null;
 }
 if(!id)return ["GET","HEAD"].includes(method)?{company,resource,kind:"list"}:
   method==="POST"?{company,resource,kind:"create"}:null;
 if(!action&&["GET","HEAD"].includes(method))return {company,resource,kind:"detail",id};
 if(action==="metadata"&&method==="PATCH")return {company,resource,kind:"metadata",id};
 if(resource==="shipments"&&action==="acceptances"&&method==="POST")
  return {company,resource,kind:"accept",id};
 if(resource==="invoices"&&action==="confirm"&&method==="POST")
  return {company,resource,kind:"confirm",id};
 if(resource==="invoices"&&action==="rectify"&&method==="POST")
  return {company,resource,kind:"rectify",id};
 return null;
}
export function createF6Handler({fetchKeys}={}){
 return async function handler(request,env){
  const url=new URL(request.url),parts=ROUTE.exec(url.pathname);
  if(!parts)return null;
  const method=request.method.toUpperCase(),r=route(parts,method);
  if(!r)return json({error:"method_not_allowed"},405,method);
  try{
   if(!LOCAL.has(url.hostname)||env?.F1_RUNTIME_ENABLED!=="test_local_only"||
    env?.F6_RUNTIME_ENABLED!=="test_local_only"||!env?.DB?.prepare||!env.DB.batch)
    throw new SecurityError("f6_not_enabled",503);
   if(r.kind!=="list"&&url.search)throw new DomainError("invalid_list");
   if(["POST","PATCH"].includes(method))originGuard(request,env);
   const principal=await authenticateAccess(request,env,fetchKeys||fetch);
   await assertSessionActive(env.DB,principal);
   const actor=await requireCompanyRole(env.DB,principal,r.company,
    ["POST","PATCH"].includes(method)?"write":"read");
   let result;
   if(r.kind==="list")result=await list(env.DB,principal,r.company,actor,r.resource,url);
   else if(r.kind==="detail")result=await detail(env.DB,principal,r.company,r.resource,r.id);
   else if(r.kind==="available")result=await available(env.DB,principal,r.company,r.id,
    r.action==="available-to-ship"?"ship":"invoice");
   else{
    const body=await bodyJSON(request);
    if(r.kind==="create")result=await create(env.DB,principal,r.company,r.resource,body);
    else if(r.kind==="accept")result=await accept(env.DB,principal,r.company,r.id,body);
    else if(r.kind==="confirm")result=await invoiceConfirm(env.DB,principal,r.company,r.id,body);
    else if(r.kind==="rectify")result=await rectify(env.DB,principal,r.company,r.id,body);
    else result=await updateMetadata(env.DB,principal,r.company,r.resource,r.id,body);
   }
   return json(result,method==="POST"&&!result.replayed?201:200,method);
  }catch(e){
   if(e instanceof SecurityError||e instanceof DomainError)
    return json({error:known.has(e.code)?e.code:"request_rejected"},
     Number.isInteger(e.status)&&e.status>=400&&e.status<=503?e.status:400,method);
   return json({error:"f6_operation_unavailable"},503,method);
  }
 };
}
