import test from "node:test";
import assert from "node:assert/strict";
import {drainPreflightedUpload} from "../src/r7/stream-drain.mjs";
import {DomainError} from "../src/r7/domain.mjs";
const req=bytes=>new Request("https://licita.local.test/test",{
 method:"POST",body:bytes,headers:{"content-type":"application/pdf"}
});
test("F8 early response: replay drena 115 KiB sem gravar segundo documento",async()=>{
 const bytes=new Uint8Array(115000).fill(120),request=req(bytes);
 await drainPreflightedUpload(request,bytes.byteLength,"stream_size_mismatch_or_orphan");
 assert.equal(request.bodyUsed,true);
});
test("F8 early response: versao revisada drena 74 KiB",async()=>{
 const bytes=new Uint8Array(74000).fill(121),request=req(bytes);
 await drainPreflightedUpload(request,bytes.byteLength,"version_stream_size_mismatch");
 assert.equal(request.bodyUsed,true);
});
test("F8 early response: truncamento de bytes e recusado",async()=>{
 const request=req(new Uint8Array(20));
 await assert.rejects(drainPreflightedUpload(request,21,"version_stream_size_mismatch"),
  e=>e instanceof DomainError&&e.code==="version_stream_size_mismatch"&&e.status===409);
});
test("F8 early response: exceder tamanho declarado e recusado",async()=>{
 const request=req(new Uint8Array(128));
 await assert.rejects(drainPreflightedUpload(request,64,"stream_size_mismatch_or_orphan"),
  e=>e instanceof DomainError&&e.code==="stream_size_mismatch_or_orphan"&&e.status===409);
});
test("F8 early response: tamanho acima de 8 MiB nunca e lido",async()=>{
 const request=req(new Uint8Array(4));
 await assert.rejects(drainPreflightedUpload(request,8*1024*1024+1,"version_stream_size_mismatch"),
  e=>e instanceof DomainError&&e.code==="version_stream_size_mismatch"&&e.status===409);
 assert.equal(request.bodyUsed,false);
});
