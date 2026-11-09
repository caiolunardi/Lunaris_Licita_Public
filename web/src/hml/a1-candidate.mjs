// HML E5 A1: candidato não publicado; o entrypoint HML ativo continua 503.
import {createF1Handler} from "../../ui/worker/f1-identity.mjs";
import {createF2Handler} from "../../ui/worker/f2-cadastros.mjs";
import {a1IsHmlReady} from "../../ui/worker/a1-runtime-gate.mjs";
const HEADERS=Object.freeze({"cache-control":"private, no-store, max-age=0",
 "content-type":"application/json; charset=utf-8","x-content-type-options":"nosniff",
 "x-frame-options":"DENY","referrer-policy":"no-referrer",
 "x-robots-tag":"noindex, nofollow, noarchive",
 "content-security-policy":"default-src 'none'; frame-ancestors 'none'"});
const ROUTES=[
 /^\/api\/v1\/me$/, /^\/api\/v1\/companies$/, /^\/api\/v1\/session\/logout$/,
 /^\/api\/v1\/companies\/[A-Za-z0-9_-]{1,128}\/context$/,
 /^\/api\/v1\/companies\/[A-Za-z0-9_-]{1,128}\/(?:orgaos|fornecedores)(?:\/[A-Za-z0-9_-]{1,128})?$/
];
const blocked=req=>new Response(req.method==="HEAD"?null:'{"error":"hml_not_ready"}',
 {status:503,headers:HEADERS});
export function createA1HmlHandler({fetchKeys}={}){
 const f1=createF1Handler({fetchKeys}),f2=createF2Handler({fetchKeys});
 return async function handle(request,env){
  let url;try{url=new URL(request.url);}catch{return blocked(request);}
  if(!ROUTES.some(re=>re.test(url.pathname))||!a1IsHmlReady(request,env))
   return blocked(request);
  return await f2(request,env)??await f1(request,env);
 };
}
export default {fetch:createA1HmlHandler()};
