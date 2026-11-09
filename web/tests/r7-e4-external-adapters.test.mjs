// E4: testes de contrato HTTP dos adaptadores; rede exclusivamente simulada.
import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto,createHash} from "node:crypto";
import {createGoogleDriveAdapter,createIndependentHttpsBackupAdapter} from "../src/r7/external-document-adapters.mjs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const bytes=new TextEncoder().encode("DOCUMENTO-SINTETICO-E4");
const key="e1/versao-e4/"+sha(bytes);
function memory(){
 const files=new Map(),backup=new Map(),seen=[];
 const fetchFn=async(uri,opts={})=>{
  const url=new URL(uri),method=opts.method||"GET";
  seen.push({url:url.toString(),method,authorization:opts.headers?.authorization});
  if(url.hostname==="www.googleapis.com"){
   if(url.pathname==="/drive/v3/files"&&method==="GET"){
    const matches=[...files.values()].filter(f=>!f.deleted&&
     f.key===key&&url.searchParams.get("q")?.includes(f.folder));
    return Response.json({files:matches.map(f=>({id:f.id,appProperties:{
     lunarisArchiveKey:f.key},parents:[f.folder]}))});
   }
   if(url.pathname==="/upload/drive/v3/files"&&method==="POST"){
    const payload=new Uint8Array(await opts.body.arrayBuffer());
    const asText=new TextDecoder().decode(payload);
    assert.ok(asText.includes('"lunarisArchiveKey":"'+key+'"'));
    assert.ok(asText.includes('"parents":["folderE4"]'));
    // Para o contrato de transportes, armazenar bytes do fixture que aparecem
    // no multipart; mock independente da implementação do SDK externo.
    assert.ok(asText.includes("DOCUMENTO-SINTETICO-E4"));
    files.set("g-e4",{id:"g-e4",key,folder:"folderE4",bytes:bytes.slice()});
    return Response.json({id:"g-e4"}, {status:200});
   }
   if(url.pathname==="/drive/v3/files/g-e4"&&url.searchParams.get("alt")==="media")
    return new Response(files.get("g-e4")?.bytes||null,
     {status:files.has("g-e4")?200:404});
  }
  if(url.hostname==="backup-fixture.example"&&url.pathname==="/v1/objects/"+key){
   if(method==="PUT"){
    assert.equal(opts.headers["if-none-match"],"*");
    assert.equal(opts.headers["x-content-sha256"],sha(bytes));
    if(backup.has(key))return new Response(null,{status:412});
    backup.set(key,Uint8Array.from(opts.body));return new Response(null,{status:201});
   }
   if(method==="GET")
    return backup.has(key)?new Response(backup.get(key).slice()):
     new Response(null,{status:404});
  }
  throw Error("unexpected external call "+method+" "+url);
 };
 return {files,backup,seen,fetchFn};
}
function adapters(fetchFn){
 return {
  drive:createGoogleDriveAdapter({folderId:"folderE4",
   accessToken:"drive-local-token-00000001",fetchFn}),
  backup:createIndependentHttpsBackupAdapter({
   origin:"https://backup-fixture.example",failureDomain:"backup-fixture",
   accessToken:"backup-local-token-00000001",fetchFn})
 };
}
test("E4 Google Drive multipart com pasta fixa, ID, idempotencia e readback",async()=>{
 const x=memory(),{drive}=adapters(x.fetchFn);
 const id=await drive.put(key,bytes);
 assert.equal(id,"g-e4");
 assert.deepEqual(await drive.get(id),bytes);
 assert.equal(await drive.findByKey(key),id);
 assert.equal(await drive.put(key,bytes),id);
 assert.equal(x.seen.filter(x=>x.url.includes("/upload/")).length,1);
 assert.ok(x.seen.every(x=>x.authorization==="Bearer drive-local-token-00000001"));
});
test("E4 backup HTTPS independente com hash, readback e sem sobrescrita",async()=>{
 const x=memory(),{backup}=adapters(x.fetchFn);
 assert.equal(await backup.put(key,bytes),key);
 assert.equal(await backup.findByKey(key),key);
 assert.deepEqual(await backup.restore(key),bytes);
 assert.equal(await backup.put(key,bytes),key);
 assert.equal(x.seen.filter(x=>x.method==="PUT").length,1);
});
test("E4 rejeita URI de backup insegura, chave errada, bytes alterados e token curto",async()=>{
 assert.throws(()=>createIndependentHttpsBackupAdapter({
  origin:"http://backup-fixture.example",failureDomain:"separate",
  accessToken:"backup-local-token-00000001"}));
 assert.throws(()=>createIndependentHttpsBackupAdapter({
  origin:"https://app.cloudflare.com",failureDomain:"separate",
  accessToken:"backup-local-token-00000001"}));
 assert.throws(()=>createGoogleDriveAdapter({
  folderId:"x",accessToken:"abc"}));
 const x=memory(),{drive,backup}=adapters(x.fetchFn);
 const changed=new TextEncoder().encode("DOCUMENTO-ADULTERADO");
 await assert.rejects(()=>drive.put(key,changed),e=>e.code==="external_hash_mismatch");
 await assert.rejects(()=>backup.put(key,changed),e=>e.code==="external_hash_mismatch");
 assert.equal(x.seen.length,0);
});
test("E4 Drive chave duplicada e backup diferente falham fechados",async()=>{
 const x=memory(),{drive,backup}=adapters(x.fetchFn);
 x.files.set("g-e4",{id:"g-e4",key,folder:"folderE4",
  bytes:new TextEncoder().encode("corrupcao")});
 await assert.rejects(()=>drive.put(key,bytes),e=>e.code==="drive_existing_copy_diverged");
 x.backup.set(key,new TextEncoder().encode("invalido"));
 await assert.rejects(()=>backup.put(key,bytes),e=>e.code==="backup_existing_copy_diverged");
});


test("E4 Google Drive usa sessao resumable para arquivo maior que 5 MiB",async()=>{
 const data=new Uint8Array(6*1024*1024+1).fill(73);
 const k="e1/large-document/"+sha(data);
 const calls=[];
 const fetchFn=async(input,opts={})=>{
  const url=new URL(input),method=opts.method||"GET";
  calls.push({url:url.toString(),method});
  if(url.pathname==="/drive/v3/files"&&method==="GET")
   return Response.json({files:[]});
  if(url.pathname==="/upload/drive/v3/files"&&method==="POST"){
   assert.equal(url.searchParams.get("uploadType"),"resumable");
   const meta=JSON.parse(opts.body);
   assert.equal(meta.appProperties.lunarisArchiveKey,k);
   return new Response(null,{status:200,headers:{
    location:"https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=local-e4"
   }});
  }
  if(url.pathname==="/upload/drive/v3/files"&&method==="PUT"){
   assert.equal(url.searchParams.get("upload_id"),"local-e4");
   assert.deepEqual(opts.body,data);
   return Response.json({id:"large-file-id"});
  }
  throw Error("unexpected request");
 };
 const adapter=createGoogleDriveAdapter({folderId:"folderE4",
  accessToken:"drive-local-token-00000001",fetchFn});
 const id=await adapter.put(k,data);
 assert.equal(id,"large-file-id");
 assert.deepEqual(calls.map(x=>x.method),["GET","POST","PUT"]);
});
test("E4 rejeita Location externo em sessao resumable mesmo com status 200",async()=>{
 const data=new Uint8Array(6*1024*1024).fill(73);
 const k="e1/large-document/"+sha(data);
 let puts=0;
 const fetchFn=async(url,opts={})=>{
  if((opts.method||"GET")==="GET")return Response.json({files:[]});
  if(opts.method==="POST")return new Response(null,{status:200,
   headers:{location:"https://evil.example/upload/drive/v3/files?uploadType=resumable&upload_id=1"}});
  puts++;return Response.json({id:"bad"});
 };
 const adapter=createGoogleDriveAdapter({folderId:"folderE4",
  accessToken:"drive-local-token-00000001",fetchFn});
 await assert.rejects(()=>adapter.put(k,data),e=>e.code==="drive_resumable_location_invalid");
 assert.equal(puts,0);
});
