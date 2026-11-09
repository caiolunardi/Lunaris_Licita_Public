// R7 etapa 2 / FK01-04 Q02-06: criacao composicional de registros
// com entidade e empresa servidor, CAS pai, entrada estrita e D1.batch.
// Todos os IDs novos são gerados pelo Worker. Nao aceita colunas SQL,
// empresa, origem, autor, estado ou operacao do cliente. Nenhuma rotina aqui
// ativa o Worker publico; somente adaptador test_local_only.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier,positiveInt,money,
  hashIntent,replayOrConflict,requireBatch} from "./domain.mjs";
const LIMIT=BigInt(Number.MAX_SAFE_INTEGER);
const BASE=new Set(["intentId","parentId","expectedParentVersion","numero","items"]);
const ITEM=new Set(["parentItemId","quantidadeMil","valorUnitCent"]);
const PURCHASE_FIELDS=new Set([...BASE,"fornecedorId"]);
const SHIP_FIELDS=new Set(["intentId","parentId","expectedParentVersion","items"]);
const SHIP_ITEM=new Set(["parentItemId","quantidadeMil"]);
const INVOICE_FIELDS=new Set(["intentId","parentId","expectedParentVersion","items","parcelasCent"]);
function positiveMoney(v){return positiveInt(v)&&money(v);}
function rounded(q,p){
 const total=(BigInt(q)*BigInt(p)+500n)/1000n;
 if(total>LIMIT||total<=0n)throw new DomainError("commercial_total_overflow",409);
 return Number(total);
}
function decodeLines(raw,ship=false){
 if(!Array.isArray(raw)||raw.length===0||raw.length>20)throw new DomainError("invalid_commercial_items");
 const seen=new Set();
 return raw.map(x=>{
  strictlyObject(x,ship?SHIP_ITEM:ITEM);
  const id=identifier(x.parentItemId);
  if(seen.has(id)||!positiveInt(x.quantidadeMil)||
     (!ship&&!positiveMoney(x.valorUnitCent)))throw new DomainError("invalid_commercial_item");
  seen.add(id);
  return {id,q:x.quantidadeMil,...(ship?{}:{price:x.valorUnitCent})};
 });
}
async function run(db,principal,companyId,body,kind,fields,prepare){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"write");
 strictlyObject(body,fields);
 const intent=identifier(body.intentId),parentId=identifier(body.parentId);
 const version=body.expectedParentVersion;
 if(!positiveInt(version))throw new DomainError("invalid_parent_version");
 const lines=decodeLines(body.items,kind==="SHIPMENT");
 const number=body.numero;
 if((kind==="COMMITMENT"||kind==="PURCHASE") &&
   (typeof number!=="string"||number.length<1||number.length>100||
    number.trim()!==number))throw new DomainError("invalid_commercial_number");
 const installments=kind==="INVOICE"?body.parcelasCent:null;
 let total=0n;
 if(kind==="INVOICE"){
  if(!Array.isArray(installments)||installments.length<1||installments.length>12||
     !installments.every(positiveMoney))throw new DomainError("invalid_installments");
  for(const {q,price} of lines)total+=BigInt(rounded(q,price));
  if(total>LIMIT||installments.reduce((a,x)=>a+BigInt(x),0n)!==total){
   throw new DomainError("invoice_amount_mismatch",409);
  }
 }
 // Inclui fornecedor no hash de PURCHASE: a identidade do fornecedor nao
 // pode ser omitida mesmo depois de uma revisao sobrescrever operacao_id.
 const hash=await hashIntent("CRIAR_"+kind,[
  parentId,version,number??null,lines,installments,
  ...(kind==="PURCHASE"?[body.fornecedorId??null]:[])
 ]);
 const prior=await replayOrConflict(db,companyId,intent,hash,"CRIAR_"+kind);
 if(prior)return prior;
 const statements=[], ids={};
 const add=(sql,...args)=>statements.push(db.prepare(sql).bind(...args));
 const context={db,body,companyId,intent,parentId,version,lines,number,
  installments,amount:Number(total),ids,add};
 await prepare(context);
 add("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
  "origem_dado,conferencia) VALUES(?,?,?, ?,?,'CONCLUIDA','NATIVO','VALIDADO')",
  intent,companyId,"CRIAR_"+kind,hash,actor.userId);
 let results;
 try{results=await db.batch(statements);}
 catch{throw new DomainError("commercial_"+kind.toLowerCase()+"_conflict",409);}
 if(!Array.isArray(results)||results.length!==statements.length||
   results.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1)){
  const raced=await replayOrConflict(db,companyId,intent,hash,"CRIAR_"+kind);
  if(raced)return raced;
  throw new DomainError("commercial_"+kind.toLowerCase()+"_conflict",409);
 }
 return {replayed:false,intentId:intent,...ids};
}
async function parent(db,table,id,companyId,version,condition="1=1"){
 const found=await db.prepare(
  "SELECT * FROM "+table+" WHERE id=? AND empresa_id=? AND versao=? AND "+condition
 ).bind(id,companyId,version).first();
 if(!found||found.origem_dado!=="NATIVO")throw new DomainError("invalid_commercial_parent",409);
 return found;
}
export async function createCommitment(db,principal,companyId,body){
 return run(db,principal,companyId,body,"COMMITMENT",BASE,async c=>{
  const l=await parent(db,"licitacoes",c.parentId,companyId,c.version,
   "encerrada_em IS NULL AND coalesce(situacao_participacao,'')<>'CANCELADA'");
  const id=crypto.randomUUID();c.ids.empenhoId=id;c.ids.itens=[];
  c.add("INSERT INTO empenhos (id,empresa_id,licitacao_id,orgao_id_escopo,"+
   "numero,situacao,operacao_id,conferencia) "+
   "SELECT ?,l.empresa_id,l.id,l.orgao_id,?,'CONFIRMADO',?,'VALIDADO' "+
   "FROM licitacoes l WHERE l.id=? AND l.empresa_id=? AND l.versao=? "+
   "AND l.encerrada_em IS NULL",
   id,c.number,c.intent,c.parentId,companyId,c.version);
  for(const x of c.lines){
   const line=crypto.randomUUID();c.ids.itens.push({id:line,parentItemId:x.id});
   c.add("INSERT INTO empenho_itens(id,empresa_id,empenho_id,licitacao_item_id,"+
    "licitacao_id_escopo,quantidade_mil,valor_unit_cent,operacao_id,conferencia) "+
    "VALUES (?,?,?,?,?,?,?,?,'VALIDADO')",
    line,companyId,id,x.id,c.parentId,x.q,x.price,c.intent);
  }
 });
}
export async function createPurchase(db,principal,companyId,body){
 return run(db,principal,companyId,body,"PURCHASE",PURCHASE_FIELDS,async c=>{
  await parent(db,"empenhos",c.parentId,companyId,c.version,"situacao='CONFIRMADO'");
  const supplier=identifier(c.body.fornecedorId);
  // O fornecedor nao vem do contexto de uma licitacao nem de outro tenant.
  const f=await db.prepare("SELECT id FROM fornecedores WHERE id=? AND empresa_id=?")
    .bind(supplier,companyId).first();
  if(!f)throw new DomainError("invalid_supplier",409);
  const id=crypto.randomUUID();c.ids.compraId=id;c.ids.itens=[];
  c.add("INSERT INTO compras(id,empresa_id,empenho_id,fornecedor_id,"+
   "numero_pedido,situacao,operacao_id,conferencia) "+
   "SELECT ?,e.empresa_id,e.id,? ,?,'CONFIRMADA',?,'VALIDADO' "+
   "FROM empenhos e WHERE e.id=? AND e.empresa_id=? "+
   "AND e.versao=? AND e.situacao='CONFIRMADO'",
   id,supplier,c.number,c.intent,c.parentId,companyId,c.version);
  for(const x of c.lines){
   const line=crypto.randomUUID();c.ids.itens.push({id:line,parentItemId:x.id});
   c.add("INSERT INTO compra_itens(id,empresa_id,compra_id,empenho_item_id,"+
    "empenho_id_escopo,quantidade_mil,valor_unit_cent,operacao_id,conferencia) "+
    "VALUES (?,?,?,?,?,?,?,?,'VALIDADO')",
    line,companyId,id,x.id,c.parentId,x.q,x.price,c.intent);
  }
 });
}
export async function createShipment(db,principal,companyId,body){
 return run(db,principal,companyId,body,"SHIPMENT",SHIP_FIELDS,async c=>{
  await parent(db,"empenhos",c.parentId,companyId,c.version,"situacao='CONFIRMADO'");
  const id=crypto.randomUUID();c.ids.envioId=id;c.ids.itens=[];
  c.add("INSERT INTO envios(id,empresa_id,empenho_id,situacao,operacao_id,conferencia) "+
   "SELECT ?,e.empresa_id,e.id,'DESPACHADO',?,'VALIDADO' FROM empenhos e "+
   "WHERE e.id=? AND e.empresa_id=? AND e.versao=? AND e.situacao='CONFIRMADO'",
   id,c.intent,c.parentId,companyId,c.version);
  for(const x of c.lines){
   const line=crypto.randomUUID();c.ids.itens.push({id:line,parentItemId:x.id});
   c.add("INSERT INTO envio_itens(id,empresa_id,envio_id,compra_item_id,"+
    "empenho_id_escopo,quantidade_mil,quantidade_aceita_mil,"+
    "quantidade_recusada_mil,operacao_id,conferencia) "+
    "VALUES (?,?,?,?,?,?,0,0,?,'VALIDADO')",
    line,companyId,id,x.id,c.parentId,x.q,c.intent);
  }
 });
}
export async function createSalesInvoice(db,principal,companyId,body){
 return run(db,principal,companyId,body,"INVOICE",INVOICE_FIELDS,async c=>{
  const e=await parent(db,"empenhos",c.parentId,companyId,c.version,"situacao='CONFIRMADO'");
  const id=crypto.randomUUID();c.ids.notaFiscalId=id;c.ids.itens=[];c.ids.parcelas=[];
  c.add("INSERT INTO notas_fiscais(id,empresa_id,empenho_id,orgao_id_escopo,"+
   "situacao,valor_documento_cent,operacao_id,conferencia) "+
   "SELECT ?,e.empresa_id,e.id,e.orgao_id_escopo,'EMITIDA',?,?,'VALIDADO' "+
   "FROM empenhos e WHERE e.id=? AND e.empresa_id=? AND e.versao=? "+
   "AND e.situacao='CONFIRMADO'",
   id,c.amount,c.intent,c.parentId,companyId,c.version);
  for(const x of c.lines){
   const line=crypto.randomUUID();c.ids.itens.push({id:line,parentItemId:x.id});
   c.add("INSERT INTO nota_fiscal_itens(id,empresa_id,nota_fiscal_id,empenho_item_id,"+
    "empenho_id_escopo,quantidade_mil,valor_unit_cent,operacao_id,conferencia) "+
    "VALUES (?,?,?,?,?,?,?,?,'VALIDADO')",
    line,companyId,id,x.id,c.parentId,x.q,x.price,c.intent);
  }
  for(const [index,value] of c.installments.entries()){
   const part=crypto.randomUUID();c.ids.parcelas.push({id:part,numero:index+1});
   c.add("INSERT INTO contas_receber(id,empresa_id,nota_fiscal_id,parcela,"+
    "valor_bruto_cent,operacao_id,conferencia) "+
    "VALUES (?,?,?,?,?,?,'VALIDADO')",
    part,companyId,id,index+1,value,c.intent);
  }
 });
}
