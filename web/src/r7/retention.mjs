// R7 / DOC05-DOC07: gate documental puro fail-closed.
// Não executa Drive, backup ou delete; produz decisão de revisão auditável.
import { DomainError } from "./domain.mjs";
const DAY=86400000;
function civilMonthPlus(date,months){
 const y=date.getUTCFullYear(),m=date.getUTCMonth(),day=date.getUTCDate();
 const start=new Date(Date.UTC(y,m+months,1,
  date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),
  date.getUTCMilliseconds()));
 const end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0));
 start.setUTCDate(Math.min(day,end.getUTCDate()));
 return start;
}
function validIso(s){
 if(typeof s!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)){
  return null;
 }
 const d=new Date(s);
 if(!Number.isFinite(d.getTime()))return null;
 const canonical=d.toISOString();
 const expected=s.length===20?s.slice(0,-1)+".000Z":s;
 return canonical===expected?d:null;
}
export function assessArchiveEvidence(input,{now=new Date()}={}){
 if(!input||typeof input!=="object"||Array.isArray(input)){
  throw new DomainError("invalid_archive_evidence");
 }
 if(!(now instanceof Date)||!Number.isFinite(now.getTime())){
  throw new DomainError("invalid_archive_clock");
 }
 const reasons=[];
 const closed=validIso(input.lastCommercialClosureAt);
 const reopened=input.lastReopeningAt==null?null:validIso(input.lastReopeningAt);
 if(!closed)reasons.push("closure_unverified");
 if(input.lastReopeningAt!=null&&!reopened)reasons.push("reopening_invalid");
 if(reopened && closed && reopened>=closed)reasons.push("commercial_period_reopened");
 if(input.documentOwnerType==="DIVERSO")reasons.push("diverse_bill_not_licitacao_archivable");
 if(input.documentOwnerType!=="LICITACAO")reasons.push("owner_not_supported");
 const quantities=["openSupplierTitles","openReceivables","legalBlocks"];
 for(const field of quantities){
  const v=input[field];
  if(!Number.isSafeInteger(v)||v<0)reasons.push(field+"_unknown");
  else if(v>0)reasons.push(field+"_active");
 }
 if(closed){
  const cutoff=civilMonthPlus(closed,24);
  if(now<cutoff)reasons.push("retention_24_months_not_elapsed");
 }
 const drive=input.drive;
 const backup=input.backup;
 if(!drive||drive.verified!==true||!validIso(drive.verifiedAt)||
    validIso(drive.verifiedAt)>now||
    !/^[a-f0-9]{64}$/.test(drive.sha256||"")){
  reasons.push("drive_bytes_not_verified");
 }
 if(!backup||backup.restoreTested!==true||!validIso(backup.restoredAt)||
    validIso(backup.restoredAt)>now||
    !/^[a-f0-9]{64}$/.test(backup.sha256||"")||
    (drive?.sha256 && backup?.sha256!==drive.sha256)){
  reasons.push("independent_backup_not_restored");
 }
 const overlay=validIso(input.overlayStartedAt);
 if(!overlay||now.getTime()<overlay.getTime()+30*DAY){
  reasons.push("overlay_30_days_not_elapsed");
 }
 // "Eligible for review" nunca significa permitido apagar R2.
 return Object.freeze({
  eligibleForHumanReview:reasons.length===0,
  deleteR2Authorized:false,
  reasons:Object.freeze(reasons)
 });
}
