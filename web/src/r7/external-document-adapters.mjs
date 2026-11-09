// R7 E4: transportes externos preparados, não ativados pelo bootstrap.
// Chamadas permitidas somente com origem fixa do servidor e token injetado
// fora de fontes públicas. Os testes usam fetch sintético sem rede real.
import {DomainError} from "./domain.mjs";
const KEY=/^[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9_-]{1,256}$/;
const MAX=8*1024*1024;
function insist(ok,code){if(!ok)throw new DomainError(code,503);}
function bodyBytes(bytes){
 const b=bytes instanceof ArrayBuffer?new Uint8Array(bytes):
  ArrayBuffer.isView(bytes)?new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength):null;
 if(!b||b.byteLength<1||b.byteLength>MAX)throw new DomainError("external_bytes_invalid",413);
 return b;
}
async function sha(bytes){
 return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
  .map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function request(fetchFn,url,opts){
 let res;
 try{res=await fetchFn(url,{redirect:"error",credentials:"omit",...opts});}
 catch{throw new DomainError("external_transfer_uncertain",503);}
 if(!res||!Number.isInteger(res.status))throw new DomainError("external_transfer_uncertain",503);
 return res;
}
function bearer(token){insist(typeof token==="string"&&token.length>=16&&!/\s/.test(token),"external_token_missing");return "Bearer "+token;}
function keyOf(key){insist(typeof key==="string"&&KEY.test(key),"external_key_invalid");return key;}
function parseRecord(x){if(!x||typeof x!=="object"||!ID.test(x.id||""))throw new DomainError("drive_response_unverified",409);return x.id;}
function driveListUrl(folderId,key) {
 const q="'"+folderId+"' in parents and trashed=false and "+
  "appProperties has { key='lunarisArchiveKey' and value='"+key+"' }";
 const u=new URL("https://www.googleapis.com/drive/v3/files");
 u.searchParams.set("q",q);u.searchParams.set("fields","nextPageToken,files(id,appProperties,parents)");
 u.searchParams.set("pageSize","2");u.searchParams.set("spaces","drive");
 return u.toString();
}
export function createGoogleDriveAdapter({folderId,accessToken,fetchFn=fetch}={}){
 insist(typeof folderId==="string"&&ID.test(folderId),"drive_folder_invalid");
 const authorization=bearer(accessToken);
 insist(typeof fetchFn==="function","external_fetch_unavailable");
 const head=()=>({authorization});
 async function findByKey(key){
  keyOf(key);
  const res=await request(fetchFn,driveListUrl(folderId,key),{method:"GET",headers:head()});
  if(!res.ok)throw new DomainError("drive_listing_failed",503);
  let doc;try{doc=await res.json();}catch{throw new DomainError("drive_listing_invalid",409);}
  const files=doc?.files;
  if(!Array.isArray(files)||files.length>1||doc.nextPageToken)
    throw new DomainError("drive_archive_key_ambiguous",409);
  if(!files.length)return null;
  const item=files[0],id=parseRecord(item);
  if(item.appProperties?.lunarisArchiveKey!==key||
    !Array.isArray(item.parents)||!item.parents.includes(folderId))
    throw new DomainError("drive_archive_key_ambiguous",409);
  return id;
 }
 async function get(id){
  insist(typeof id==="string"&&ID.test(id),"drive_id_invalid");
  const res=await request(fetchFn,"https://www.googleapis.com/drive/v3/files/"+
   encodeURIComponent(id)+"?alt=media",{method:"GET",headers:head()});
  if(!res.ok)throw new DomainError("drive_download_failed",503);
  const bytes=await res.arrayBuffer();
  if(bytes.byteLength>MAX)throw new DomainError("external_bytes_invalid",413);
  return new Uint8Array(bytes);
 }
 async function put(key,input){
  keyOf(key);const bytes=bodyBytes(input);
  if((await sha(bytes))!==key.split("/")[2])throw new DomainError("external_hash_mismatch",409);
  const existing=await findByKey(key);
  if(existing){
   const recovered=await get(existing);
   if((await sha(recovered))!==key.split("/")[2]||recovered.length!==bytes.length)
    throw new DomainError("drive_existing_copy_diverged",409);
   return existing;
  }
  const metadata={name:"archive-"+key.split("/")[2]+".bin",parents:[folderId],
   appProperties:{lunarisArchiveKey:key}};
  let res;
  if(bytes.byteLength<=5*1024*1024){
   // Drive v3: multipart somente para arquivos ate 5 MiB.
   const boundary="lunaris_archive_"+crypto.randomUUID().replaceAll("-","");
   const payload=new Blob([
    "--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata),"\r\n--"+boundary+
    "\r\nContent-Type: application/octet-stream\r\n\r\n",
    bytes,"\r\n--"+boundary+"--\r\n"
   ]);
   res=await request(fetchFn,"https://www.googleapis.com/upload/drive/v3/files?"+
    "uploadType=multipart&fields=id",{
     method:"POST",headers:{...head(),"content-type":"multipart/related; boundary="+boundary},
     body:payload
    });
  }else{
   // Drive v3: sessoes resumable para >5 MiB; nunca seguir Location
   // fornecido por provedor sem verificar scheme, host e path.
   const started=await request(fetchFn,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",{
     method:"POST",headers:{...head(),"content-type":"application/json; charset=UTF-8",
      "x-upload-content-type":"application/octet-stream",
      "x-upload-content-length":String(bytes.length)},
     body:JSON.stringify(metadata)
    });
   if(!started.ok)throw new DomainError("drive_resumable_setup_uncertain",503);
   const location=started.headers.get("location");
   let session;
   try{session=new URL(location);}
   catch{throw new DomainError("drive_resumable_location_invalid",409);}
   if(session.protocol!=="https:"||session.hostname!=="www.googleapis.com"||
      session.port||session.username||session.password||
      session.pathname!=="/upload/drive/v3/files"||
      session.searchParams.get("uploadType")!=="resumable"||
      !session.searchParams.has("upload_id")){
    throw new DomainError("drive_resumable_location_invalid",409);
   }
   res=await request(fetchFn,session.toString(),{
    method:"PUT",headers:{...head(),"content-type":"application/octet-stream"},
    body:bytes
   });
  }
  if(!res.ok)throw new DomainError("drive_upload_uncertain",503);
  let doc;try{doc=await res.json();}catch{throw new DomainError("drive_upload_uncertain",503);}
  return parseRecord(doc);
 }
 return Object.freeze({providerId:"google-drive",failureDomain:"google-drive",
   isIdempotent:true,put,get,findByKey});
}

// Adaptador para API HTTPS de backup autogerida em domínio e credenciais
// independentes. O provedor deve assegurar durabilidade e restaurar bytes
// sob /v1/objects/{empresa}/{versao}/{sha}. Prova operacional é gate E5/E6.
export function createIndependentHttpsBackupAdapter({
 origin,accessToken,failureDomain,fetchFn=fetch
}={}){
 insist(typeof origin==="string"&&/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(origin) &&
  !/googleapis\.com|cloudflare|lunaris\.dev\.br|localhost|127\.0\.0\.1/.test(origin),
  "backup_origin_invalid");
 insist(typeof failureDomain==="string"&&/^[a-z0-9_-]{3,40}$/.test(failureDomain)&&
  failureDomain!=="google-drive"&&failureDomain!=="cloudflare",
  "backup_independence_unverified");
 const authorization=bearer(accessToken);
 insist(typeof fetchFn==="function","external_fetch_unavailable");
 function url(key){keyOf(key);return origin+"/v1/objects/"+key;}
 async function restore(key){
  const res=await request(fetchFn,url(key),{method:"GET",headers:{authorization}});
  if(res.status===404)return null;
  if(!res.ok)throw new DomainError("backup_restore_uncertain",503);
  const bytes=new Uint8Array(await res.arrayBuffer());
  if(bytes.byteLength>MAX)throw new DomainError("external_bytes_invalid",413);
  return bytes;
 }
 async function findByKey(key){
  const b=await restore(key);
  if(!b)return null;
  if((await sha(b))!==key.split("/")[2])throw new DomainError("backup_existing_copy_diverged",409);
  return key;
 }
 async function put(key,input){
  keyOf(key);const bytes=bodyBytes(input);
  if((await sha(bytes))!==key.split("/")[2])throw new DomainError("external_hash_mismatch",409);
  const present=await findByKey(key);
  if(present){
   const old=await restore(key);
   if(old?.length!==bytes.length)throw new DomainError("backup_existing_copy_diverged",409);
   return key;
  }
  const res=await request(fetchFn,url(key),{method:"PUT",
   headers:{authorization,"content-type":"application/octet-stream",
    "x-content-sha256":key.split("/")[2],"if-none-match":"*"},body:bytes
  });
  if(res.status===409||res.status===412){
   const verified=await restore(key);
   if(verified?.length===bytes.length&&(await sha(verified))===key.split("/")[2])return key;
   throw new DomainError("backup_collision_unverified",409);
  }
  if(!res.ok)throw new DomainError("backup_upload_uncertain",503);
  return key;
 }
 return Object.freeze({providerId:"independent-https",failureDomain,
  isIdempotent:true,put,restore,findByKey});
}
