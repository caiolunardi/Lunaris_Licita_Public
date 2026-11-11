// A2 UI + F1/F2 + F3-F7 API candidate. HML only; never publish via tracked lab config.
import {createA2HmlHandler} from "./a2-candidate.mjs";
import {a2HmlReady} from "../../ui/worker/a2-runtime-gate.mjs";
import {A1_HML_ORIGIN} from "../../ui/worker/a1-runtime-gate.mjs";

const PAGES=new Set(["/identidade","/orgaos","/fornecedores",
 "/financeiro","/contas-pagar","/recorrencias","/licitacoes",
 "/empenhos","/compras","/envios","/notas-fiscais","/contas-receber"]);
const ASSET=/^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,250}$/;
const BLOCK_HEADERS={"cache-control":"private, no-store, max-age=0",
 "content-type":"application/json; charset=utf-8","x-content-type-options":"nosniff",
 "x-frame-options":"DENY","x-robots-tag":"noindex, nofollow, noarchive",
 "referrer-policy":"no-referrer",
 "content-security-policy":"default-src 'none'; frame-ancestors 'none'"};
const deny=(req)=>new Response(req.method==="HEAD"?null:'{"error":"hml_not_ready"}',
 {status:503,headers:BLOCK_HEADERS});

export function createA2UiHandler({fetchKeys}={}){
 const API=createA2HmlHandler({fetchKeys});
 return async function fetchA2Ui(request,env){
  let url;try{url=new URL(request.url);}catch{return deny(request);}
  if(url.origin!==A1_HML_ORIGIN||!a2HmlReady(request,env))return deny(request);
  if(url.pathname.startsWith("/api/"))return API(request,env);
  if(!["GET","HEAD"].includes(request.method))return deny(request);
  if(url.pathname==="/"&&!url.search)
   return Response.redirect(A1_HML_ORIGIN+"/financeiro",302);
  const path=url.pathname.replace(/\/$/,"");
  const isPage=PAGES.has(path),isAsset=ASSET.test(url.pathname);
  if(!isPage&&!isAsset)return deny(request);
  if(!env.ASSETS||typeof env.ASSETS.fetch!=="function")return deny(request);
  try{
   const response=await env.ASSETS.fetch(request);
   if(!response?.ok)return deny(request);
   if(isAsset&&(response.headers.get("content-type")||"").toLowerCase().includes("text/html"))
    return deny(request);
   const headers=new Headers(response.headers);
   headers.set("x-content-type-options","nosniff");
   headers.set("x-robots-tag","noindex, nofollow, noarchive");
   if(isPage)headers.set("cache-control","private, no-store, max-age=0");
   return new Response(request.method==="HEAD"?null:response.body,
    {status:response.status,headers});
  }catch{return deny(request);}
 };
}
export default {fetch:createA2UiHandler()};
