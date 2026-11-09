// R7 etapa 2 / Q08: substituir uma NF selada por fato fiscal novo,
// sem modificar selo/itens/documentos históricos. Papel ADMIN obrigatório.
// A transação D1 é integral: diário -> CANCELAR original (trigger cancela
// parcelas sem créditos) -> nova NF/itens/parcelas -> novo selo -> vínculo
// imutável de retificação. Divergência ou corrida reverte TUDO.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier,positiveInt,money,
  hashIntent,replayOrConflict,requireBatch} from "./domain.mjs";
const FIELDS=new Set(["intentId","notaFiscalOriginalId","expectedVersion",
  "motivo","items","parcelasCent"]);
const ITEM=new Set(["empenhoItemId","quantidadeMil","valorUnitCent"]);
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
export async function rectifySealedInvoice(db,principal,companyId,body){
 requireBatch(db);
 const actor=await requireCompanyRole(db,principal,companyId,"approve");
 strictlyObject(body,FIELDS);
 const intent=identifier(body.intentId),original=identifier(body.notaFiscalOriginalId);
 const version=body.expectedVersion;
 const reason=body.motivo;
 if(!positiveInt(version)||typeof reason!=="string"||
    reason.trim()!==reason||reason.length<5||reason.length>2000||
    !Array.isArray(body.items)||body.items.length<1||body.items.length>20||
    !Array.isArray(body.parcelasCent)||body.parcelasCent.length<1||
    body.parcelasCent.length>12||!body.parcelasCent.every(positiveInt)){
   throw new DomainError("invalid_invoice_rectification");
 }
 let sum=0n;
 const seen=new Set();
 const items=body.items.map(x=>{
  strictlyObject(x,ITEM);
  const line=identifier(x.empenhoItemId);
  if(seen.has(line)||!positiveInt(x.quantidadeMil)||
     !positiveInt(x.valorUnitCent)||!money(x.valorUnitCent)){
    throw new DomainError("invalid_invoice_rectification_item");
  }
  seen.add(line);
  const amount=(BigInt(x.quantidadeMil)*BigInt(x.valorUnitCent)+500n)/1000n;
  if(amount<=0n)throw new DomainError("invalid_invoice_rectification_item");
  sum+=amount;
  if(sum>MAX)throw new DomainError("invoice_rectification_overflow",409);
  return {id:line,q:x.quantidadeMil,price:x.valorUnitCent};
 });
 const parcelTotal=body.parcelasCent.reduce((a,p)=>a+BigInt(p),0n);
 if(parcelTotal!==sum||sum>MAX)throw new DomainError("invoice_rectification_amount_mismatch",409);
 const hash=await hashIntent("RETIFICAR_NF",
  [original,version,reason,items,body.parcelasCent]);
 const prior=await replayOrConflict(db,companyId,intent,hash,"RETIFICAR_NF");
 if(prior)return prior;
 const old=await db.prepare(
  "SELECT n.id,n.versao,n.empenho_id,n.orgao_id_escopo,n.situacao "+
  "FROM notas_fiscais n "+
  "JOIN nf_conciliacoes selo ON selo.nota_fiscal_id=n.id "+
  "AND selo.empresa_id=n.empresa_id "+
  "JOIN empenhos e ON e.id=n.empenho_id AND e.empresa_id=n.empresa_id "+
  "WHERE n.id=? AND n.empresa_id=? AND n.versao=? "+
  "AND n.origem_dado='NATIVO' AND n.conferencia='VALIDADO' "+
  "AND n.situacao IN ('EMITIDA','APRESENTADA') AND e.situacao='CONFIRMADO' "+
  "AND NOT EXISTS(SELECT 1 FROM nf_retificacoes r "+
  "WHERE r.nota_original_id=n.id AND r.empresa_id=n.empresa_id) "+
  "AND NOT EXISTS(SELECT 1 FROM contas_receber c "+
  "JOIN recebimentos rec ON rec.conta_receber_id=c.id AND rec.empresa_id=c.empresa_id "+
  "WHERE c.nota_fiscal_id=n.id AND c.empresa_id=n.empresa_id)"
 ).bind(original,companyId,version).first();
 if(!old)throw new DomainError("invoice_not_rectifiable",409);
 const newId=crypto.randomUUID(),sealId=crypto.randomUUID(),
       changeId=crypto.randomUUID(),total=Number(sum);
 const newLines=items.map(x=>({id:crypto.randomUUID(),parentItemId:x.id,q:x.q,price:x.price}));
 const newParts=body.parcelasCent.map((value,i)=>({
   id:crypto.randomUUID(),numero:i+1,amount:value
 }));
 const snapshotItems=JSON.stringify(newLines
   .map(x=>[x.id,1,x.q,x.price])
   .sort((a,b)=>a[0].localeCompare(b[0])));
 const snapshotParts=JSON.stringify(newParts
   .map(x=>[x.id,1,x.numero,x.amount,0])
   .sort((a,b)=>a[0].localeCompare(b[0])));
 const prepared=[];
 const add=(sql,...args)=>prepared.push(db.prepare(sql).bind(...args));
 const plan=JSON.stringify({notaOriginalId:original,notaSubstitutaId:newId,
   motivo:reason});
 add("INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,"+
     "plano_json,origem_dado,conferencia) "+
     "VALUES (?,?,'RETIFICAR_NF',?,?,'CONCLUIDA',?,'NATIVO','VALIDADO')",
     intent,companyId,hash,actor.userId,plan);
 add("UPDATE notas_fiscais SET situacao='CANCELADA',versao=versao+1,"+
     "operacao_id=? WHERE id=? AND empresa_id=? AND versao=? "+
     "AND situacao IN ('EMITIDA','APRESENTADA') "+
     "AND EXISTS(SELECT 1 FROM nf_conciliacoes s WHERE "+
     "s.empresa_id=notas_fiscais.empresa_id AND s.nota_fiscal_id=notas_fiscais.id) "+
     "AND NOT EXISTS(SELECT 1 FROM contas_receber c JOIN recebimentos r "+
     "ON r.conta_receber_id=c.id AND r.empresa_id=c.empresa_id "+
     "WHERE c.nota_fiscal_id=notas_fiscais.id AND c.empresa_id=notas_fiscais.empresa_id) "+
     "AND NOT EXISTS(SELECT 1 FROM nf_retificacoes r WHERE "+
     "r.nota_original_id=notas_fiscais.id AND r.empresa_id=notas_fiscais.empresa_id)",
     intent,original,companyId,version);
 add("INSERT INTO notas_fiscais(id,empresa_id,empenho_id,orgao_id_escopo,"+
     "situacao,valor_documento_cent,operacao_id,conferencia) "+
     "VALUES (?,?,?,?,'EMITIDA',?,?,'VALIDADO')",
     newId,companyId,old.empenho_id,old.orgao_id_escopo,total,intent);
 for(const x of newLines){
  add("INSERT INTO nota_fiscal_itens (id,empresa_id,nota_fiscal_id,"+
      "empenho_item_id,empenho_id_escopo,quantidade_mil,valor_unit_cent,"+
      "operacao_id,conferencia) VALUES (?,?,?,?,?,?,?,?,'VALIDADO')",
      x.id,companyId,newId,x.parentItemId,
      old.empenho_id,x.q,x.price,intent);
 }
 for(const p of newParts){
  add("INSERT INTO contas_receber (id,empresa_id,nota_fiscal_id,"+
      "parcela,valor_bruto_cent,operacao_id,conferencia) "+
      "VALUES (?,?,?,?,?,?,'VALIDADO')",
      p.id,companyId,newId,p.numero,p.amount,intent);
 }
 add("INSERT INTO nf_conciliacoes (id,empresa_id,nota_fiscal_id,numero_versao_nf,"+
     "valor_documento_cent,valor_itens_cent,valor_parcelas_cent,"+
     "itens_snapshot_json,parcelas_snapshot_json,arredondamento,operacao_id,ator_id) "+
     "VALUES (?,?,?,1,?,?,?,?,?,'MEIO_PARA_CIMA_POR_LINHA_V1',?,?)",
     sealId,companyId,newId,total,total,total,snapshotItems,snapshotParts,
     intent,actor.userId);
 add("INSERT INTO nf_retificacoes(id,empresa_id,nota_original_id,"+
     "nota_substituta_id,motivo,atestado_por_id,operacao_id) "+
     "VALUES (?,?,?,?,?,?,?)",
     changeId,companyId,original,newId,reason,actor.userId,intent);
 let result;
 try{result=await db.batch(prepared);}
 catch{throw new DomainError("invoice_rectification_conflict",409);}
 if(!Array.isArray(result)||result.length!==prepared.length||
   result.some(x=>!Number.isInteger(x?.meta?.changes)||x.meta.changes<1)){
  throw new DomainError("invoice_rectification_conflict",409);
 }
 return {replayed:false,intentId:intent,notaFiscalOriginalId:original,
   notaFiscalSubstitutaId:newId,retificacaoId:changeId,
   valorDocumentoCent:total,novasParcelas:newParts.map(x=>x.id)};
}
