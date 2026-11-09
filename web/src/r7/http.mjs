// R7: router local privado. Nao importado pelo Worker bootstrap.
import { authenticateAccess, requireCompanyRole, SecurityError } from "./security.mjs";
import { registerCredit, updateTitleObservation, DomainError } from "./domain.mjs";
import { recordPayment, undoPayment, reverseCredit } from "./payments.mjs";
import { materializeRecurrence } from "./recurrence.mjs";
import { confirmInvoiceAmounts } from "./invoices.mjs";
import { attestRetention } from "./withholdings.mjs";
import { recordPartialAwardCycle } from "./commercial.mjs";
import { decideAwardItem, registerDeliveryAcceptance } from "./business-commands.mjs";
import { reviseRecurringAmount, setRecurringLastMonth } from "./recurrence-revisions.mjs";
import { createDocumentAttachment, readDocumentAttachment,
  appendDocumentVersion, readDocumentHistoricVersion } from "./document-service.mjs";
import { createCommitment, createPurchase, createShipment, createSalesInvoice } from "./commercial-steps.mjs";
import { rectifySealedInvoice } from "./invoice-rectifications.mjs";
import { reserveNotification } from "./notification-outbox.mjs";
import { monthlyCommitmentPreview } from "./monthly-preview.mjs";
import { reviseTitle, cancelTitle } from "./title-commands.mjs";
import { prepareSyntheticLegacyDryRun } from "./migration-dry-run.mjs";
import { closeCommercialCycle, reopenCommercialCycle } from "./commercial-cycles.mjs";
import { reviewArchiveEligibility } from "./archive-eligibility.mjs";
import { beginArchiveCopy,inspectArchiveAttempt,reconcileArchiveAttempt } from "./archive-e4.mjs";
import { uploadStreamToR2 } from "./document-stream-e4.mjs";
import { assertSessionActive, requireDocumentPermission, requireEntityPermission, assertEntityNotBlocked,
  assertAggregateAccess, revokeCurrentSession, revokeCompanyMembership,
  blockEntityForUser } from "./iam.mjs";

const SECURITY_HEADERS={
  "cache-control":"no-store, private",
  "x-content-type-options":"nosniff",
  "referrer-policy":"no-referrer",
  "x-frame-options":"DENY",
  "content-security-policy":"default-src 'none'; frame-ancestors 'none'",
  "vary":"cf-access-jwt-assertion"
};
const LIMIT_BYTES=16384;
// Ligacao negativa de ACL a cada rota com ID do cliente, antes de efeito.
// Registro no mesmo tenant continua validado pelo dominio e pelas FKs.
const SCOPES=Object.freeze({
 credit:[["CONTA_RECEBER","contaReceberId"]],
 note:[["TITULO_PAGAR","tituloId"]],
 payment:[["TITULO_PAGAR","tituloId"],["DOCUMENTO","comprovanteDocumentoId"]],
 undo_payment:[["TITULO_PAGAR","tituloId"],["TITULO_BAIXA","baixaOriginalId"]],
 reverse_credit:[["RECEBIMENTO","recebimentoOriginalId"]],
 recurrence:[["RECORRENCIA","recorrenciaId"]],
 invoice_confirm:[["NOTA_FISCAL","notaFiscalId"]],
 retention_attest:[["CONTA_RECEBER","contaReceberId"],["DOCUMENTO_VERSAO","documentoVersaoId"]],
 partial_award:[["LICITACAO","licitacaoId"],["LICITACAO_ITEM","licitacaoItemId"]],
 award_item:[["LICITACAO","licitacaoId"],["LICITACAO_ITEM","licitacaoItemId"]],
 accept_delivery:[["ENVIO","envioId"],["ENVIO_ITEM","envioItemId"]],
 revise_recurrence:[["RECORRENCIA","recorrenciaId"]],
 end_recurrence:[["RECORRENCIA","recorrenciaId"]],
 commitment:[["LICITACAO","parentId"]],
 purchase:[["EMPENHO","parentId"]],
 shipment:[["COMPRA","parentId"]],
 invoice:[["EMPENHO","parentId"]],
 new_document_version:[["DOCUMENTO","documentoId"]],
 rectify_invoice:[["NOTA_FISCAL","notaFiscalOriginalId"]],
 reserve_notification:[["PREFERENCIA_NOTIFICACAO","preferenciaId"],
   ["DESTINATARIO_NOTIFICACAO","destinatarioId"]],
 revise_title:[["TITULO_PAGAR","tituloId"]],
 cancel_title:[["TITULO_PAGAR","tituloId"]],
 commercial_close:[["LICITACAO","licitacaoId"]],
 commercial_reopen:[["LICITACAO","licitacaoId"]],
 archive_preview:[["DOCUMENTO","documentoId"],["DOCUMENTO_VERSAO","versaoId"]],
 archive_copy:[["DOCUMENTO","documentoId"],["DOCUMENTO_VERSAO","documentoVersaoId"]]
});
// Itens aninhados sao referencias controladas, nao novos dados confiaveis.
const NESTED_ITEM_TYPES=Object.freeze({
 commitment:"LICITACAO_ITEM",purchase:"EMPENHO_ITEM",
 shipment:"COMPRA_ITEM",invoice:"EMPENHO_ITEM",
 rectify_invoice:"EMPENHO_ITEM"
});
const DOCUMENT_OWNER_TYPES=Object.freeze({
 licitacao:"LICITACAO",empenho:"EMPENHO",compra:"COMPRA",
 envio:"ENVIO",nota_fiscal:"NOTA_FISCAL",titulo_pagar:"TITULO_PAGAR",
 titulo_baixa:"TITULO_BAIXA",conta_receber:"CONTA_RECEBER",
 recebimento:"RECEBIMENTO"
});
async function enforceRouteAcl(db,principal,companyId,route,body) {
  if(route==="monthly_preview"||route==="reserve_notification"){
    await assertAggregateAccess(db,principal,companyId);
  }
  for(const [type,field] of SCOPES[route]||[]){
    if(body?.[field]!=null){
      await assertEntityNotBlocked(db,principal,companyId,type,body[field],"WRITE");
    }
  }
  const nestedType=NESTED_ITEM_TYPES[route];
  if(nestedType&&Array.isArray(body?.items)){
    for(const line of body.items){
      const key=route==="rectify_invoice"?"empenhoItemId":"parentItemId";
      if(line?.[key]!=null){
        await assertEntityNotBlocked(db,principal,companyId,nestedType,line[key],"WRITE");
      }
    }
  }
  if(route==="payment"&&body?.comprovanteDocumentoId!=null){
    await assertEntityNotBlocked(db,principal,companyId,
      "DOCUMENTO",body.comprovanteDocumentoId,"WRITE");
  }
  if(route==="attach_document"){
    const type=DOCUMENT_OWNER_TYPES[body?.ownerType];
    if(type&&body?.ownerId!=null){
      await assertEntityNotBlocked(db,principal,companyId,type,body.ownerId,"WRITE");
    }
  }
}
function json(data,status=200) {
  return new Response(JSON.stringify(data),{status,headers:{
    ...SECURITY_HEADERS,"content-type":"application/json; charset=utf-8"
  }});
}
async function parsePost(request) {
  const type=request.headers.get("content-type")?.toLowerCase()||"";
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(type)) {
    throw new DomainError("json_content_type_required",415);
  }
  const declared=Number(request.headers.get("content-length")||0);
  if(!Number.isFinite(declared)||declared>LIMIT_BYTES) {
    throw new DomainError("payload_too_large",413);
  }
  const raw=await request.text();
  if(new TextEncoder().encode(raw).byteLength>LIMIT_BYTES) {
    throw new DomainError("payload_too_large",413);
  }
  try{return JSON.parse(raw);} catch{throw new DomainError("invalid_json");}
}
function sameSiteOrigin(request,env) {
  const expected=env?.APP_ORIGIN;
  if(typeof expected!=="string"||!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(expected)) {
    throw new SecurityError("app_origin_not_configured",503);
  }
  if(request.headers.get("origin")!==expected) {
    throw new SecurityError("invalid_origin");
  }
}
export function createR7Handler({ fetchKeys, archiveAdapters }={}) {
  return async function handle(request,env) {
    try {
      // Strict enablement test-only, and never use the production bootstrap entrypoint.
      if(env?.R7_RUNTIME_ENABLED!=="test_local_only"||!env?.DB?.prepare) {
        throw new SecurityError("r7_not_enabled",503);
      }
      const parsed=new URL(request.url);
      const parts=parsed.pathname.split("/").filter(Boolean);
      if(parsed.search||parts[0]!=="r7"||parts[1]!=="companies"||
          parts.length<4||parts.length>7) {
        return json({error:"not_found"},404);
      }
      const companyId=parts[2];
      if(!/^[a-zA-Z0-9_-]{1,128}$/.test(companyId))return json({error:"not_found"},404);
      const suffix=parts.slice(3).join("/");
      const route=(
        suffix==="titles" && request.method==="GET" ? "read_titles" :
        suffix==="credits" && request.method==="POST" ? "credit" :
        suffix==="titles/observations" && request.method==="POST" ? "note" :
        suffix==="payments" && request.method==="POST" ? "payment" :
        suffix==="payments/undo" && request.method==="POST" ? "undo_payment" :
        suffix==="credits/reversal" && request.method==="POST" ? "reverse_credit" :
        suffix==="recurrences/materialize" && request.method==="POST" ? "recurrence" :
        suffix==="invoices/confirm" && request.method==="POST" ? "invoice_confirm" :
        suffix==="retentions/attest" && request.method==="POST" ? "retention_attest" :
        suffix==="commercial/partial-award" && request.method==="POST" ? "partial_award" :
        suffix==="commercial/award-item" && request.method==="POST" ? "award_item" :
        suffix==="commercial/delivery-acceptance" && request.method==="POST" ? "accept_delivery" :
        suffix==="recurrences/revise-value" && request.method==="POST" ? "revise_recurrence" :
        suffix==="recurrences/end-after" && request.method==="POST" ? "end_recurrence" :
        suffix==="documents" && request.method==="POST" ? "attach_document" :
        suffix==="documents/stream" && request.method==="POST" ? "stream_document" :
        /^documents\/[a-zA-Z0-9_-]{1,128}$/.test(suffix) && request.method==="GET" ? "read_document" :
        suffix==="commercial/commitment" && request.method==="POST" ? "commitment" :
        suffix==="commercial/purchase" && request.method==="POST" ? "purchase" :
        suffix==="commercial/shipment" && request.method==="POST" ? "shipment" :
        suffix==="commercial/invoice" && request.method==="POST" ? "invoice" :
        /^documents\/[a-zA-Z0-9_-]{1,128}\/versions\/[a-zA-Z0-9_-]{1,128}$/.test(suffix) && request.method==="GET" ? "read_history" :
        suffix==="documents/versions" && request.method==="POST" ? "new_document_version" :
        suffix==="invoices/rectify" && request.method==="POST" ? "rectify_invoice" :
        suffix==="notifications/reserve" && request.method==="POST" ? "reserve_notification" :
        suffix==="finance/monthly-preview" && request.method==="POST" ? "monthly_preview" :
        suffix==="titles/revise" && request.method==="POST" ? "revise_title" :
        suffix==="titles/cancel" && request.method==="POST" ? "cancel_title" :
        suffix==="migration/synthetic-prepare" && request.method==="POST" ? "migration_dry_run" :
        suffix==="commercial/close" && request.method==="POST" ? "commercial_close" :
        suffix==="commercial/reopen" && request.method==="POST" ? "commercial_reopen" :
        suffix==="documents/archive-preview" && request.method==="POST" ? "archive_preview" :
        suffix==="documents/archive-copy" && request.method==="POST" ? "archive_copy" :
        suffix==="documents/archive-reconcile" && request.method==="POST" ? "archive_reconcile" :
        suffix==="documents/archive-status" && request.method==="POST" ? "archive_status" :
        suffix==="access/logout" && request.method==="POST" ? "self_logout" :
        suffix==="access/revoke-member" && request.method==="POST" ? "revoke_member" :
        suffix==="access/block-entity" && request.method==="POST" ? "block_entity" : null
      );
      if(!route)return json({error:"not_found"},404);
      if(!["read_titles","read_document","read_history"].includes(route))sameSiteOrigin(request,env);
      const principal=await authenticateAccess(request,env,
        fetchKeys||fetch);
      await assertSessionActive(env.DB,principal);
      if(route==="read_titles"){
        const actor=await requireCompanyRole(env.DB,principal,companyId,"read");
        const res=await env.DB.prepare(
          "SELECT id,situacao,valor_nominal_cent,vencimento FROM v_titulos_situacao v "+
          "WHERE empresa_id=? AND NOT EXISTS (SELECT 1 FROM r7_acl_bloqueios b "+
          "WHERE b.empresa_id=v.empresa_id AND b.usuario_id=? "+
          "AND b.tipo_entidade=\'TITULO_PAGAR\' AND b.entidade_id=v.id "+
          "AND b.acao IN (\'READ\',\'ALL\')) ORDER BY vencimento,id LIMIT 100"
        ).bind(companyId,actor.userId).all();
        return json({titulos:res?.results||[]});
      }
      if(route==="read_document"){
        const documentId=suffix.split("/")[1];
        await requireDocumentPermission(env.DB,principal,companyId,documentId,"READ");
        const current=await env.DB.prepare(
          "SELECT versao_corrente_id FROM documentos WHERE id=? AND empresa_id=?"
        ).bind(documentId,companyId).first();
        if(current?.versao_corrente_id){
          await requireEntityPermission(env.DB,principal,companyId,
            "DOCUMENTO_VERSAO",current.versao_corrente_id,"READ");
        }
        const data=await readDocumentAttachment(env.DB,env.R2,principal,
          companyId,suffix.split("/")[1]);
        return new Response(data.bytes,{status:200,headers:{
          ...SECURITY_HEADERS,"content-type":data.mime,
          "x-content-sha256":data.sha256
        }});
      }
      if(route==="read_history"){
        const [,docId,,versionId]=suffix.split("/");
        await requireDocumentPermission(env.DB,principal,companyId,docId,"READ");
        await requireEntityPermission(env.DB,principal,companyId,"DOCUMENTO_VERSAO",versionId,"READ");
        const data=await readDocumentHistoricVersion(env.DB,env.R2,principal,
          companyId,docId,versionId);
        return new Response(data.bytes,{status:200,headers:{
          ...SECURITY_HEADERS,"content-type":data.mime,
          "x-content-sha256":data.sha256
        }});
      }
      if(route==="stream_document"){
        const m={ownerType:request.headers.get("x-doc-owner-type"),
          ownerId:request.headers.get("x-doc-owner-id")};
        await enforceRouteAcl(env.DB,principal,companyId,"attach_document",m);
        return json(await uploadStreamToR2(env.DB,env.R2,principal,companyId,request),201);
      }
      const body=await parsePost(request);
      if(route==="self_logout")return json(await revokeCurrentSession(env.DB,principal,companyId,body),201);
      if(route==="revoke_member")return json(await revokeCompanyMembership(env.DB,principal,companyId,body),201);
      if(route==="block_entity")return json(await blockEntityForUser(env.DB,principal,companyId,body),201);
      if(route==="archive_status"){
        if(!body||Object.keys(body).length!==1||typeof body.intentId!=="string")
          throw new DomainError("invalid_archive_status_request",400);
        return json(await inspectArchiveAttempt(env.DB,principal,companyId,body.intentId));
      }
      if(route==="archive_reconcile"){
        return json(await reconcileArchiveAttempt(env.DB,principal,companyId,body,
          {...archiveAdapters,r2:env.R2}),201);
      }
      await enforceRouteAcl(env.DB,principal,companyId,route,body);
      if(route==="archive_copy"){
        return json(await beginArchiveCopy(env.DB,principal,companyId,body,
          {...archiveAdapters,r2:env.R2}),201);
      }
      const result=route==="credit"
        ? await registerCredit(env.DB,principal,companyId,body)
        : route==="note"
        ? await updateTitleObservation(env.DB,principal,companyId,body)
        : route==="payment"
        ? await recordPayment(env.DB,principal,companyId,body)
        : route==="undo_payment"
        ? await undoPayment(env.DB,principal,companyId,body)
        : route==="reverse_credit"
        ? await reverseCredit(env.DB,principal,companyId,body)
        : route==="recurrence"
        ? await materializeRecurrence(env.DB,principal,companyId,body)
        : route==="invoice_confirm"
        ? await confirmInvoiceAmounts(env.DB,principal,companyId,body)
        : route==="retention_attest"
        ? await attestRetention(env.DB,principal,companyId,body)
        : route==="partial_award"
        ? await recordPartialAwardCycle(env.DB,principal,companyId,body)
        : route==="award_item"
        ? await decideAwardItem(env.DB,principal,companyId,body)
        : route==="accept_delivery"
        ? await registerDeliveryAcceptance(env.DB,principal,companyId,body)
        : route==="revise_recurrence"
        ? await reviseRecurringAmount(env.DB,principal,companyId,body)
        : route==="end_recurrence"
        ? await setRecurringLastMonth(env.DB,principal,companyId,body)
        : route==="attach_document"
        ? await createDocumentAttachment(env.DB,env.R2,principal,companyId,body)
        : route==="commitment" ? await createCommitment(env.DB,principal,companyId,body)
        : route==="purchase" ? await createPurchase(env.DB,principal,companyId,body)
        : route==="shipment" ? await createShipment(env.DB,principal,companyId,body)
        : route==="invoice"
        ? await createSalesInvoice(env.DB,principal,companyId,body)
        : route==="new_document_version"
        ? await appendDocumentVersion(env.DB,env.R2,principal,companyId,body)
        : route==="rectify_invoice"
        ? await rectifySealedInvoice(env.DB,principal,companyId,body)
        : route==="reserve_notification"
        ? await reserveNotification(env.DB,principal,companyId,body)
        : route==="monthly_preview"
        ? await monthlyCommitmentPreview(env.DB,principal,companyId,body)
        : route==="revise_title"
        ? await reviseTitle(env.DB,principal,companyId,body)
        : route==="cancel_title"
        ? await cancelTitle(env.DB,principal,companyId,body)
        : route==="migration_dry_run"
        ? await prepareSyntheticLegacyDryRun(env.DB,principal,companyId,body)
        : route==="commercial_close"
        ? await closeCommercialCycle(env.DB,principal,companyId,body)
        : route==="commercial_reopen"
        ? await reopenCommercialCycle(env.DB,principal,companyId,body)
        : await reviewArchiveEligibility(env.DB,principal,companyId,body);
      return json(result,result.replayed?200:201);
    } catch(err) {
      const safe=err instanceof SecurityError||err instanceof DomainError;
      return json({error:safe?err.code:"internal_error"},
        safe?err.status:500);
    }
  };
}
