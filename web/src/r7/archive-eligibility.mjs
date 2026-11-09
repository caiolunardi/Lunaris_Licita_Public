// R7 E2 / DOC05-DOC07, OK08/OK15 — decisão DOCUMENTAL baseada no D1
// local. Não oferece DELETE no R2, não chama Drive e não confia no cliente
// para fornecer 24 meses, ausência de débitos, hash de backup nem data de
// início de sobreposição. O serviço só retorna elegibilidade para revisão.
import {requireCompanyRole} from "./security.mjs";
import {DomainError,strictlyObject,identifier} from "./domain.mjs";
import {assessArchiveEvidence} from "./retention.mjs";
const FIELDS=new Set(["documentoId","versaoId"]);
export async function reviewArchiveEligibility(db,principal,companyId,body,
 {now=new Date()}={}){
 await requireCompanyRole(db,principal,companyId,"approve");
 strictlyObject(body,FIELDS);
 const doc=identifier(body.documentoId),version=identifier(body.versaoId);
 const owner=await db.prepare(
  "SELECT l.id AS licitacao_id,l.encerrada_em,v.sha256,v.tamanho_bytes "+
  "FROM documentos d JOIN documento_versoes v ON "+
  "v.documento_id=d.id AND v.empresa_id=d.empresa_id "+
  "JOIN documento_vinculos dv ON dv.documento_id=d.id "+
  "AND dv.empresa_id=d.empresa_id AND dv.ativo=1 "+
  "JOIN licitacoes l ON l.id=dv.licitacao_id AND l.empresa_id=d.empresa_id "+
  "WHERE d.id=? AND v.id=? AND d.empresa_id=? "+
  "AND dv.licitacao_id IS NOT NULL AND v.estado_integridade='VERIFICADO' "+
  "AND v.sha256 IS NOT NULL AND v.tamanho_bytes IS NOT NULL"
 ).bind(doc,version,companyId).all();
 if(owner.results?.length!==1)
  throw new DomainError("archive_owner_or_version_unverified",409);
 const record=owner.results[0],lic=record.licitacao_id;
 const cycle=await db.prepare(
  "SELECT x.encerrada_em FROM licitacao_encerramentos x "+
  "JOIN licitacoes l ON l.id=x.licitacao_id AND l.empresa_id=x.empresa_id "+
  "WHERE x.licitacao_id=? AND x.empresa_id=? "+
  "AND x.reaberta_em IS NULL AND l.encerrada_em=x.encerrada_em "+
  "ORDER BY x.encerrada_em DESC LIMIT 1"
 ).bind(lic,companyId).first();
 const reopened=await db.prepare(
  "SELECT MAX(reaberta_em) AS ultimo_reabrir FROM licitacao_encerramentos "+
  "WHERE licitacao_id=? AND empresa_id=?"
 ).bind(lic,companyId).first();
 const titles=await db.prepare(
  "SELECT COUNT(*) AS n FROM titulos_pagar t "+
  "JOIN compras c ON c.id=t.compra_id AND c.empresa_id=t.empresa_id "+
  "JOIN empenhos e ON e.id=c.empenho_id AND e.empresa_id=c.empresa_id "+
  "JOIN v_titulos_situacao s ON s.id=t.id AND s.empresa_id=t.empresa_id "+
  "WHERE e.licitacao_id=? AND t.empresa_id=? AND t.cancelado=0 "+
  "AND t.tipo='FORNECEDOR' AND "+
  "(s.situacao<>'PAGO' OR t.conferencia<>'VALIDADO' "+
  "OR t.valor_nominal_cent IS NULL)"
 ).bind(lic,companyId).first();
 const open=await db.prepare(
  "SELECT COUNT(*) AS n FROM contas_receber c "+
  "JOIN notas_fiscais n ON n.id=c.nota_fiscal_id AND n.empresa_id=c.empresa_id "+
  "JOIN empenhos e ON e.id=n.empenho_id AND e.empresa_id=n.empresa_id "+
  "JOIN v_contas_receber_saldos s ON s.id=c.id AND s.empresa_id=c.empresa_id "+
  "WHERE e.licitacao_id=? AND c.empresa_id=? AND c.cancelada=0 "+
  "AND (s.estado_saldo<>'CONFERIDO' OR s.saldo_cent IS NULL OR s.saldo_cent>0)"
 ).bind(lic,companyId).first();
 const legal=await db.prepare(
  "SELECT COUNT(*) AS n FROM documento_bloqueios WHERE "+
  "empresa_id=? AND documento_id=? AND liberado_em IS NULL"
 ).bind(companyId,doc).first();
 const transfer=await db.prepare(
  "SELECT t.sobreposicao_iniciada_em,t.backup_independente_sha256,"+
  "t.backup_verificado_em,t.backup_independente_ref,"+
  "t.estado,l.verificado_em,l.hash_verificado,l.tamanho_verificado "+
  "FROM documento_transferencias t "+
  "JOIN documento_localizacoes l ON l.id=t.destino_localizacao_id "+
  "AND l.versao_id=t.versao_id AND l.empresa_id=t.empresa_id "+
  "WHERE t.versao_id=? AND t.empresa_id=? "+
  "AND t.estado='SOBREPOSICAO_30_DIAS' "+
  "AND l.provedor='DRIVE' AND l.status='VERIFICADO' "+
  "AND l.hash_verificado=? AND l.tamanho_verificado=? "+
  "AND t.backup_independente_sha256=? "+
  "AND t.backup_independente_ref IS NOT NULL "+
  "ORDER BY t.id LIMIT 1"
 ).bind(version,companyId,record.sha256,record.tamanho_bytes,record.sha256).first();
 const evidence={
  documentOwnerType:"LICITACAO",
  lastCommercialClosureAt:cycle?.encerrada_em??null,
  lastReopeningAt:reopened?.ultimo_reabrir??null,
  openSupplierTitles:titles.n,openReceivables:open.n,legalBlocks:legal.n,
  drive:transfer?{verified:true,verifiedAt:transfer.verificado_em,
    sha256:transfer.hash_verificado}:null,
  backup:transfer?{restoreTested:true,restoredAt:transfer.backup_verificado_em,
    sha256:transfer.backup_independente_sha256}:null,
  overlayStartedAt:transfer?.sobreposicao_iniciada_em??null
 };
 const gate=assessArchiveEvidence(evidence,{now});
 // Mesmo quando a infraestrutura local registra VERIFIED, isso não comprova
 // que o backup externo foi realmente restaurado: apenas candidato a revisão.
 return {documentoId:doc,versaoId:version,licitacaoId:lic,
  ...gate,deleteR2Authorized:false,externalEvidenceVerified:false};
}
