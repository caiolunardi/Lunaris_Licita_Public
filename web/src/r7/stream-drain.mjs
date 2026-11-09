// F8: consome o corpo de uma tentativa JA autenticada e decidida (replay/409).
// Nao cria bytes em R2 e nao coloca o arquivo inteiro em memoria.
// Rejeicoes antes de autenticacao continuam fail-closed e nao sao drenadas.
import {DomainError} from "./domain.mjs";
const MAX=8*1024*1024;
export async function drainPreflightedUpload(request,expectedBytes,errorCode){
 if(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||expectedBytes>MAX||
    !request?.body||request.bodyUsed)throw new DomainError(errorCode,409);
 const reader=request.body.getReader();
 let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   const size=value?.byteLength;
   if(!Number.isSafeInteger(size)||size<0||size>expectedBytes-total){
    await reader.cancel().catch(()=>{});
    throw new DomainError(errorCode,409);
   }
   total+=size;
  }
 }catch(e){
  if(e instanceof DomainError)throw e;
  throw new DomainError(errorCode,409);
 }finally{
  reader.releaseLock();
 }
 if(total!==expectedBytes)throw new DomainError(errorCode,409);
}
