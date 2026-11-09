// R7 etapa 1 / Q08 — reconciliar NF, itens e parcelas em CENTAVOS exatos.
// Contrato monetario V1: quantidade_mil significa 1/1000 de unidade;
// arredondamento HALF_UP por linha, depois soma. NUNCA usar float para dinheiro.
// A conciliacao e um selo imutavel; precisa de todos os itens e parcelas
// ativos definidos ANTES de selar. Nota emitida antes de entrega e permitida.
// Sem API publicada; cliente nao fornece valores da nota nem dados privilegiados.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier,positiveInt,money,
        hashIntent,replayOrConflict,requireBatch} from "./domain.mjs";

const FIELDS=new Set(["intentId","notaFiscalId","expectedVersion"]);
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
const SQL_ITEMS="SELECT id,versao,quantidade_mil,valor_unit_cent,origem_dado,conferencia "+
  "FROM nota_fiscal_itens WHERE empresa_id=? AND nota_fiscal_id=? ORDER BY id";
const SQL_PARCELS="SELECT id,versao,parcela,valor_bruto_cent,cancelada,origem_dado,conferencia "+
  "FROM contas_receber WHERE empresa_id=? AND nota_fiscal_id=? ORDER BY id";
const ITEMS_SNAPSHOT_SQL="(SELECT COALESCE(json_group_array(json_array(id,versao,quantidade_mil,valor_unit_cent)),'[]') "+
  "FROM (SELECT id,versao,quantidade_mil,valor_unit_cent FROM nota_fiscal_itens "+
  "WHERE empresa_id=n.empresa_id AND nota_fiscal_id=n.id ORDER BY id))";
const PARCELS_SNAPSHOT_SQL="(SELECT COALESCE(json_group_array(json_array(id,versao,parcela,valor_bruto_cent,cancelada)),'[]') "+
  "FROM (SELECT id,versao,parcela,valor_bruto_cent,cancelada FROM contas_receber "+
  "WHERE empresa_id=n.empresa_id AND nota_fiscal_id=n.id ORDER BY id))";

function eligible(row) {
  return row && (row.origem_dado==="NATIVO" ||
    (row.origem_dado==="LEGADO" && row.conferencia==="VALIDADO"));
}
function exactTotal(items,parcels) {
  if(!Array.isArray(items)||items.length===0||
     !Array.isArray(parcels)||parcels.length===0) {
    throw new DomainError("missing_invoice_items_or_installments",409);
  }
  let goods=0n,installments=0n;
  const itemsSnapshot=[],parcelsSnapshot=[];
  for(const item of items){
    if(!eligible(item)||!positiveInt(item.quantidade_mil)||
       !money(item.valor_unit_cent)||!positiveInt(item.versao)){
      throw new DomainError("unverified_invoice_item",409);
    }
    goods+=(BigInt(item.quantidade_mil)*BigInt(item.valor_unit_cent)+500n)/1000n;
    if(goods>MAX)throw new DomainError("money_overflow",409);
    itemsSnapshot.push([item.id,item.versao,item.quantidade_mil,item.valor_unit_cent]);
  }
  for(const p of parcels){
    if(!eligible(p)||!positiveInt(p.versao)||!positiveInt(p.parcela)||
       ![0,1].includes(p.cancelada)||
       (p.cancelada===0&&!positiveInt(p.valor_bruto_cent))||
       (p.valor_bruto_cent!==null&&!money(p.valor_bruto_cent))){
      throw new DomainError("unverified_invoice_installment",409);
    }
    if(p.cancelada===0)installments+=BigInt(p.valor_bruto_cent);
    if(installments>MAX)throw new DomainError("money_overflow",409);
    parcelsSnapshot.push([p.id,p.versao,p.parcela,p.valor_bruto_cent,p.cancelada]);
  }
  return {itemCent:Number(goods),installmentCent:Number(installments),
          itemSnapshot:JSON.stringify(itemsSnapshot),
          parcelSnapshot:JSON.stringify(parcelsSnapshot)};
}
export async function confirmInvoiceAmounts(db,principal,companyId,body){
  requireBatch(db);
  const actor=await requireCompanyRole(db,principal,companyId,"write");
  strictlyObject(body,FIELDS);
  const intentId=identifier(body.intentId),invoiceId=identifier(body.notaFiscalId);
  if(!positiveInt(body.expectedVersion))throw new DomainError("invalid_invoice_version");
  const hash=await hashIntent("CONCILIAR_NF",[invoiceId,body.expectedVersion]);
  const replay=await replayOrConflict(db,companyId,intentId,hash,"CONCILIAR_NF");
  if(replay)return replay;
  const nf=await db.prepare(
    "SELECT id,versao,valor_documento_cent,situacao,origem_dado,conferencia "+
    "FROM notas_fiscais WHERE id=? AND empresa_id=?"
  ).bind(invoiceId,companyId).first();
  if(!nf||nf.versao!==body.expectedVersion||
     !["EMITIDA","APRESENTADA"].includes(nf.situacao)||
     !eligible(nf)||!positiveInt(nf.valor_documento_cent)){
    throw new DomainError("invoice_not_confirmable",409);
  }
  const items=await db.prepare(SQL_ITEMS).bind(companyId,invoiceId).all();
  const parcels=await db.prepare(SQL_PARCELS).bind(companyId,invoiceId).all();
  const total=exactTotal(items?.results,parcels?.results);
  if(total.itemCent!==nf.valor_documento_cent||
     total.installmentCent!==nf.valor_documento_cent){
    throw new DomainError("invoice_amount_mismatch",409);
  }
  const sealId=crypto.randomUUID();
  const insert=db.prepare(
    "INSERT INTO nf_conciliacoes (id,empresa_id,nota_fiscal_id,numero_versao_nf,"+
    "valor_documento_cent,valor_itens_cent,valor_parcelas_cent,itens_snapshot_json,"+
    "parcelas_snapshot_json,arredondamento,operacao_id,ator_id) "+
    "SELECT ?,n.empresa_id,n.id,n.versao,n.valor_documento_cent,?,?,?,?,"+
    "'MEIO_PARA_CIMA_POR_LINHA_V1',?,? FROM notas_fiscais n "+
    "WHERE n.id=? AND n.empresa_id=? AND n.versao=? "+
    "AND n.valor_documento_cent=? AND n.situacao IN ('EMITIDA','APRESENTADA') "+
    "AND "+ITEMS_SNAPSHOT_SQL+"=? "+
    "AND "+PARCELS_SNAPSHOT_SQL+"=? "+
    "AND NOT EXISTS(SELECT 1 FROM nf_conciliacoes c "+
    "WHERE c.nota_fiscal_id=n.id AND c.empresa_id=n.empresa_id)"
  ).bind(sealId,total.itemCent,total.installmentCent,
         total.itemSnapshot,total.parcelSnapshot,intentId,actor.userId,
         invoiceId,companyId,body.expectedVersion,nf.valor_documento_cent,
         total.itemSnapshot,total.parcelSnapshot);
  const journal=db.prepare(
    "INSERT INTO operacoes (id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
    "SELECT ?,?,'CONCILIAR_NF',?,?,'CONCLUIDA','NATIVO','VALIDADO' "+
    "FROM nf_conciliacoes c WHERE c.id=? AND c.empresa_id=? AND c.operacao_id=?"
  ).bind(intentId,companyId,hash,actor.userId,sealId,companyId,intentId);
  let results;
  try{results=await db.batch([insert,journal]);}
  catch{throw new DomainError("invoice_reconciliation_conflict",409);}
  if(results?.[0]?.meta?.changes===1&&results?.[1]?.meta?.changes===1)
    return {replayed:false,intentId,notaFiscalId:invoiceId,sealId,
            documentCent:nf.valor_documento_cent,
            itemsCent:total.itemCent,installmentsCent:total.installmentCent};
  const raced=await replayOrConflict(db,companyId,intentId,hash,"CONCILIAR_NF");
  if(raced)return raced;
  throw new DomainError("invoice_reconciliation_conflict",409);
}
