import type {DocumentDetail,FileRecord,Owner,OwnerType,Version,Preview} from "./types";
const doc=(id:string,title:string,type:string,version=1):DocumentDetail=>{
 const versionId=id+"-v"+version,stamp="2026-11-08T15:00:00.000Z";
 const item:FileRecord={id,tipo:type,titulo:title,versao:version+1,
  versao_corrente_id:versionId,origem_dado:"NATIVO",conferencia:"VALIDADO",
  numero_versao:version,mime_type:"application/pdf",tamanho_bytes:86045,
  sha256:"a".repeat(64),estado_integridade:"VERIFICADO",versao_criada_em:stamp};
 const v:Version={id:versionId,numero_versao:version,nome_original:title,
  mime_type:"application/pdf",tamanho_bytes:86045,sha256:"a".repeat(64),
  estado_integridade:"VERIFICADO",origem_dado:"NATIVO",conferencia:"VALIDADO",
  criado_em:stamp,enviado_por:"pessoa-ficticia",locations:[{provedor:"R2",
   status:"VERIFICADO",verificado_em:stamp,hash_verificado:"a".repeat(64),
   tamanho_verificado:86045}]};
 return {item,versions:[v],owners:[{id:"f8-demo-link",papel:type,licitacao_id:"f8-demo-licitacao"}],
  archiveCopyAvailable:false,r2DeletionAuthorized:false};
};
export function demoDocuments(company:string):DocumentDetail[]{
 return company.includes("horizonte")?[
  doc("f8-demo-h-01","Comprovante de compra fictício.pdf","PEDIDO_COMPRA")
 ]:[
  doc("f8-demo-a-01","Edital de demonstração.pdf","EDITAL",2),
  doc("f8-demo-a-02","Nota fiscal ilustrativa.pdf","NF_VENDA_PDF"),
  doc("f8-demo-a-03","Comprovante de crédito (exemplo).pdf","COMPROVANTE_CREDITO")];
}
export function demoOwners(type:OwnerType,company:string):Owner[]{
 const h=company.includes("horizonte");
 if(type==="licitacao")return [{id:h?"f8-demo-lic-h":"f8-demo-lic-a",
  label:h?"Pregão fictício Horizonte":"Pregão fictício Aurora"}];
 if(type==="conta_receber")return [{id:h?"f8-demo-cr-h":"f8-demo-cr-a",
  label:h?"Parcela fictícia H":"Parcela fictícia Aurora"}];
 return [{id:"f8-demo-owner-"+type,label:"Registro fictício de "+type.replace(/_/g," ")}];
}
export function demoPreview(id:string,versionId:string):Preview{
 return {documentoId:id,versaoId:versionId,licitacaoId:"f8-demo-lic-a",
  eligibleForHumanReview:false,deleteR2Authorized:false,
  externalEvidenceVerified:false,reasons:["closure_unverified",
   "retention_24_months_not_elapsed","drive_bytes_not_verified",
   "independent_backup_not_restored","overlay_30_days_not_elapsed"]};
}
