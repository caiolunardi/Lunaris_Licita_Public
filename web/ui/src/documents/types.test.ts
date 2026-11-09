import {describe,it,expect} from "vitest";
import {fileError,maxFileSize,safeFilename,sizeText,explainReason,
 validDetail,validPreview,ownerInfo} from "./types";
describe("F8 classificação, segurança e palavras compreensíveis",()=>{
 it("recusa arquivo vazio, tipo ativo e arquivo superior a 8 MiB",()=>{
  expect(fileError(null)).toBeTruthy();
  expect(fileError(new File([""],"vazio.html",{type:"text/html"}))).toBeTruthy();
  expect(fileError(new File(["%PDF"],"ok.pdf",{type:"application/pdf"}))).toBeNull();
  expect(fileError(new File([new Uint8Array(maxFileSize+1)],"enorme.pdf",{type:"application/pdf"}))).toMatch(/8 MB/);
 });
 it("normaliza nome para header seguro sem diretório ou caracteres de controle",()=>{
  expect(safeFilename("Relatório de Crédito.pdf")).toBe("Relatorio de Credito.pdf");
  expect(safeFilename("../secreto/arquivo.txt")).toBe("_secreto_arquivo.txt");
 });
 it("explica riscos de guarda em linguagem clara",()=>{
  expect(explainReason("retention_24_months_not_elapsed")).toMatch(/24 meses/);
  expect(explainReason("independent_backup_not_restored")).toMatch(/backup independente/);
  expect(sizeText(1024)).toContain("KB");
 });
 it("rejeita flag de delete e versão ilegível no contrato",()=>{
  expect(validDetail({item:{id:"d"},versions:[],owners:[],r2DeletionAuthorized:true})).toBe(false);
  expect(validPreview({eligibleForHumanReview:true,deleteR2Authorized:true,
   externalEvidenceVerified:false,reasons:[]})).toBe(false);
 });
 it("o comprovante de retenção só se associa à parcela a receber",()=>{
  expect(ownerInfo.conta_receber.roles.some(x=>x[0]==="COMPROVANTE_CREDITO")).toBe(true);
  expect(ownerInfo.licitacao.roles.some(x=>x[0]==="COMPROVANTE_CREDITO")).toBe(false);
 });
});
