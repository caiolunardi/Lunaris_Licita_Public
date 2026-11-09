import type {IdentityState} from "../identity/session";
export type Props={identity:IdentityState;onIdentity:()=>void};
export type OwnerType="licitacao"|"empenho"|"compra"|"envio"|"nota_fiscal"|
 "titulo_pagar"|"titulo_baixa"|"conta_receber"|"recebimento";
export type FileRecord={id:string;tipo:string;titulo:string|null;versao:number;
 versao_corrente_id:string|null;origem_dado:string;conferencia:string;
 numero_versao:number|null;mime_type:string|null;tamanho_bytes:number|null;
 sha256:string|null;estado_integridade:string|null;versao_criada_em:string|null};
export type Location={provedor:"R2"|"DRIVE"|"URL_EXTERNA";status:string;
 verificado_em:string|null;hash_verificado:string|null;tamanho_verificado:number|null};
export type Version={id:string;numero_versao:number;nome_original:string|null;
 mime_type:string|null;tamanho_bytes:number|null;sha256:string|null;
 estado_integridade:string;origem_dado:string;conferencia:string;
 criado_em:string|null;enviado_por:string|null;locations:Location[]};
export type DocumentDetail={item:FileRecord;versions:Version[];
 owners:Array<{id:string;papel:string;[key:string]:string|null}>;
 archiveCopyAvailable:boolean;r2DeletionAuthorized:false};
export type Preview={documentoId:string;versaoId:string;licitacaoId:string;
 eligibleForHumanReview:boolean;deleteR2Authorized:false;
 externalEvidenceVerified:false;reasons:string[]};
export type DocumentList={items:FileRecord[];nextCursor:string|null;limit:number;
 countVisible:number};
export type Owner={id:string;label:string};
export const ownerInfo:Record<OwnerType,{name:string;roles:Array<[string,string]>}> ={
 licitacao:{name:"Licitação",roles:[["EDITAL","Edital"],["PROPOSTA","Proposta"]]},
 empenho:{name:"Empenho",roles:[["EMPENHO","Documento do empenho"]]},
 compra:{name:"Compra",roles:[["PEDIDO_COMPRA","Pedido de compra"],["NF_FORNECEDOR","Nota do fornecedor"]]},
 envio:{name:"Envio",roles:[["DESPACHO","Comprovante de despacho"],["ENTREGA","Comprovante de entrega"]]},
 nota_fiscal:{name:"Nota fiscal de venda",roles:[["NF_VENDA_PDF","PDF da nota"],["NF_VENDA_XML","XML da nota"]]},
 titulo_pagar:{name:"Conta a pagar",roles:[["BOLETO","Boleto"],["COMPROVANTE_PAGAMENTO","Comprovante de pagamento"]]},
 titulo_baixa:{name:"Pagamento realizado",roles:[["COMPROVANTE_PAGAMENTO","Comprovante de pagamento"]]},
 conta_receber:{name:"Parcela a receber",roles:[["COMPROVANTE_CREDITO","Comprovante de crédito"]]},
 recebimento:{name:"Recebimento realizado",roles:[["COMPROVANTE_CREDITO","Comprovante de crédito"]]}
};
export const reasonLabels:Record<string,string>={
 closure_unverified:"O encerramento comercial ainda não foi comprovado.",
 reopening_invalid:"A data de reabertura precisa de conferência.",
 commercial_period_reopened:"O processo foi reaberto. A guarda deve continuar.",
 owner_not_supported:"Esta categoria ainda não participa da política automática de arquivamento.",
 diverse_bill_not_licitacao_archivable:"Conta diversa não deve ser arquivada pela regra de licitações.",
 openSupplierTitles_active:"Ainda existem pagamentos pendentes.",
 openReceivables_active:"Ainda existem valores a receber.",
 legalBlocks_active:"O documento está sob bloqueio de guarda.",
 retention_24_months_not_elapsed:"Ainda não se passaram 24 meses do encerramento.",
 drive_bytes_not_verified:"Não há cópia no Google Drive com integridade comprovada.",
 independent_backup_not_restored:"Não há backup independente restaurado e conferido.",
 overlay_30_days_not_elapsed:"O período de segurança de 30 dias ainda não terminou."
};
export function explainReason(code:string):string{
 return reasonLabels[code]||"Existe uma pendência de conferência: "+code.replace(/_/g," ").slice(0,80);
}
const bytesLimit=8*1024*1024;
export const maxFileSize=bytesLimit;
export const acceptedMimes=new Set(["application/pdf","application/xml","image/png",
 "image/jpeg","text/plain"]);
export function fileError(f:File|null):string|null{
 if(!f)return "Escolha um arquivo.";
 if(f.size<1||f.size>bytesLimit)return "Aceitamos arquivos de até 8 MB, com conteúdo.";
 const mime=f.type==="text/xml"?"application/xml":f.type;
 if(!acceptedMimes.has(mime))return "Envie PDF, XML, PNG, JPG ou TXT.";
 if(!f.name.trim())return "O arquivo precisa ter um nome.";
 return null;
}
export function safeFilename(filename:string):string{
 const name=filename.normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[^\x20-\x7e]/g,"_").replace(/[\\/]/g,"_")
  .replace(/^\.+/g,"").slice(0,180).trim();
 return name||"documento";
}
export function shaHex(bytes:ArrayBuffer):Promise<string>{
 return crypto.subtle.digest("SHA-256",bytes).then(result=>
  Array.from(new Uint8Array(result)).map(x=>x.toString(16).padStart(2,"0")).join(""));
}
export function sizeText(bytes:number|null):string{
 if(bytes===null||!Number.isSafeInteger(bytes)||bytes<0)return "Tamanho não conferido";
 if(bytes<1024)return bytes+" B";
 return bytes<1024*1024?(bytes/1024).toFixed(1).replace(".",",")+" KB":
  (bytes/(1024*1024)).toFixed(1).replace(".",",")+" MB";
}
export function validList(x:unknown):x is DocumentList{
 const r=x as Partial<DocumentList>|null;
 return !!r&&Array.isArray(r.items)&&r.items.length<=50&&
  r.items.every(item=>item&&typeof item.id==="string"&&typeof item.tipo==="string")&&
  (r.nextCursor===null||typeof r.nextCursor==="string");
}
export function validDetail(x:unknown):x is DocumentDetail{
 const d=x as Partial<DocumentDetail>|null;
 return !!d&&!!d.item&&typeof d.item.id==="string"&&
  Array.isArray(d.versions)&&d.versions.length<=500&&
  d.versions.every(v=>typeof v.id==="string"&&Array.isArray(v.locations))&&
  Array.isArray(d.owners)&&d.r2DeletionAuthorized===false;
}
export function validOwners(x:unknown):x is {items:Owner[]}{
 const r=x as {items?:unknown}|null;
 return !!r&&Array.isArray(r.items)&&r.items.length<=500&&
  r.items.every(x=>x&&typeof x.id==="string"&&typeof x.label==="string");
}
export function validPreview(x:unknown):x is Preview{
 const r=x as Partial<Preview>|null;
 return !!r&&r.deleteR2Authorized===false&&r.externalEvidenceVerified===false&&
  typeof r.eligibleForHumanReview==="boolean"&&Array.isArray(r.reasons);
}
export function mimeName(mime:string|null):string{
 return ({"application/pdf":"PDF","application/xml":"XML","image/png":"Imagem PNG",
 "image/jpeg":"Imagem JPG","text/plain":"Texto TXT"} as Record<string,string>)[mime||""]||"Arquivo";
}
