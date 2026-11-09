// R7 E5 A2: guard de homologação financeira sintética. Nunca para produção.
import {a1IsHmlReady,A1_HML_ORIGIN} from "./a1-runtime-gate.mjs";
const LOCAL=new Set(["licita.local.test","localhost","127.0.0.1"]);
export const A2_HML_ENABLED="f3_f7_synthetic_only";
export const A2_HML_STAGE="a2_synthetic_financial";
export const A2_HML_SCOPE="isolated_hml_d1_only";
const PHASES=new Set(["F3","F4","F5","F6","F7"]);
export function a2RuntimeMode(request,env,phase){
 if(!PHASES.has(phase)||!env?.DB?.prepare||!env.DB.batch)return null;
 let url;try{url=new URL(request.url);}catch{return null;}
 if(url.username||url.password||url.hash)return null;
 if(LOCAL.has(url.hostname))return env.F1_RUNTIME_ENABLED==="test_local_only"&&
  env[phase+"_RUNTIME_ENABLED"]==="test_local_only"?"local":null;
 if(url.origin!==A1_HML_ORIGIN||!a1IsHmlReady(request,env)||
   env.A2_HML_ENABLED!==A2_HML_ENABLED||env.A2_HML_STAGE!==A2_HML_STAGE||
   env.A2_HML_SCOPE!==A2_HML_SCOPE||
   env.GEMINI_API_KEY!==undefined||env.R2!==undefined)return null;
 return "hml";
}
export function a2HmlReady(request,env){
 return [...PHASES].every(p=>a2RuntimeMode(request,env,p)==="hml");
}
export async function a2CompanyIsSynthetic(db,companyId){
 const c=await db.prepare("SELECT nome,documento_identificacao FROM empresas WHERE id=? AND ativo=1 LIMIT 1").bind(companyId).first();
 if(!c||!/^TESTE - [^\s]/i.test(c.nome||"")||c.documento_identificacao)return false;
 const checks=[["orgaos","nome"],["fornecedores","nome"],["licitacoes","numero"],
  ["empenhos","numero"],["compras","numero_pedido"],["titulos_pagar","beneficiario"],
  ["recorrencias","beneficiario"],["notas_fiscais","numero"]];
 for(const [table,col] of checks){
  if(await db.prepare("SELECT 1 AS bad FROM "+table+" WHERE empresa_id=? AND "+
   col+" IS NOT NULL AND "+col+" NOT LIKE 'TESTE - %' LIMIT 1").bind(companyId).first())return false;
 }
 // Zero PII/URLs no catálogo fictício: não basta começar o nome com TESTE.
 for(const [table,columns] of [
  ["orgaos",["cnpj","contato","email","telefone","endereco_entrega_padrao"]],
  ["fornecedores",["cnpj","contato","email","telefone","nome_original_legado"]],
  ["licitacoes",["url_processo"]],
  ["notas_fiscais",["chave_acesso"]],
  ["envios",["url_rastreio"]]
 ]){
  const clause=columns.map(col=>col+" IS NOT NULL AND "+col+"<>''").join(" OR ");
  if(await db.prepare("SELECT 1 AS bad FROM "+table+
   " WHERE empresa_id=? AND ("+clause+") LIMIT 1").bind(companyId).first())return false;
 }
 for(const table of ["orgaos","fornecedores","licitacoes","titulos_pagar","recorrencias"]){
  if(await db.prepare("SELECT 1 AS bad FROM "+table+
   " WHERE empresa_id=? AND origem_dado='LEGADO' LIMIT 1").bind(companyId).first())return false;
 }
 return true;
}
const LABELS=new Set(["nome","beneficiario","descricao","descricaoExigida","categoriaDespesa",
 "objeto","numero","numeroPedido","observacoes","motivo",
 "motivoCancelamento","motivoDecisao","motivoReabertura","contaDestino",
 "referenciaExterna","portal","transportadora","codigoRastreio","responsavelTexto",
 "condicaoPagamento","produtoOfertado","marcaOfertada","modeloOfertado"]);
const SHORT_CODES=new Set(["numeroItem","lote","unidade"]);
const BLOCKED=new Set(["cnpj","cpf","email","telefone","contato","endereco","chaveAcesso",
 "url","urlProcesso","urlRastreio","urlEdital","urlProposta","arquivo",
 "comprovanteDocumentoId","documentoVersaoId","retencaoAtestadoId","pix",
 "dadosBancarios","agencia","numeroConta","cpfCnpj"]);
const UNSAFE=/https?:\/\/|www\.|@|[0-9]{11,}|<script|<iframe|data:|javascript:/i;
export async function a2ValidateSyntheticMutation(request){
 const ct=request.headers.get("content-type")||"";
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(ct)||
  request.headers.get("origin")!==A1_HML_ORIGIN||
  request.headers.get("x-lunaris-synthetic-only")!=="confirmed")return false;
 const length=Number(request.headers.get("content-length")||0);
 if(!Number.isSafeInteger(length)||length>8192)return false;
 const raw=await request.clone().text();
 if(new TextEncoder().encode(raw).byteLength>8192)return false;
 let body;try{body=JSON.parse(raw);}catch{return false;}
 if(!body||typeof body!=="object"||Array.isArray(body)||
  !/^a2-test-[a-zA-Z0-9_-]{3,100}$/.test(body.intentId||""))return false;
 let nodes=0;
 const verify=(obj,depth=0)=>{
  if(depth>8||++nodes>120)return false;
  if(Array.isArray(obj))return obj.length<=25&&obj.every(x=>verify(x,depth+1));
  if(obj&&typeof obj==="object")return Object.entries(obj).every(([key,value])=>{
   if(BLOCKED.has(key)&&value!=null&&value!=="")return false;
   if(SHORT_CODES.has(key)&&typeof value==="string"&&value.length>0&&
      !/^[A-Za-z0-9._/-]{1,30}$/.test(value))return false;
   if(LABELS.has(key)&&typeof value==="string"&&value.length>0&&
     !/^TESTE - [^\s]/i.test(value))return false;
   if((/Cent$|_cent$/.test(key))&&typeof value==="number"&&
     (!Number.isSafeInteger(value)||Math.abs(value)>10000000))return false;
   return verify(value,depth+1);
  });
  if(typeof obj==="string")return obj.length<=500&&!UNSAFE.test(obj);
  return obj===null||typeof obj==="boolean"||
   (typeof obj==="number"&&Number.isSafeInteger(obj));
 };
 return verify(body);
}
