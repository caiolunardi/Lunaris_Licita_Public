// R7 E5: canario R2 EXCLUSIVAMENTE em HML, temporario, sintetico.
// Exige Worker Access All traffic; restaurar web/src/hml/index.mjs apos teste.
// Nao importar nem publicar no Worker produtivo.
const PATH="/__hml/r2-prova";
const PREFIX="__licita_hml_prova_r2_v1/";
const HEADERS=Object.freeze({
  "cache-control":"no-store, private",
  "x-content-type-options":"nosniff",
  "x-frame-options":"DENY",
  // Em form POST tradicional, no-referrer pode produzir Origin: null.
  // same-origin preserva Origin legitimo sem transmitir Referer entre origens.
  "referrer-policy":"same-origin",
  "x-robots-tag":"noindex, nofollow, noarchive",
  "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"
});
const FIXTURE="Lunaris Licita: teste sintetico de R2 HML v1";
function json(status,body,head=false) {
  return new Response(head?null:JSON.stringify(body),{
    status,headers:{...HEADERS,"content-type":"application/json; charset=utf-8"}
  });
}
function page() {
  const html=[
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Prova R2 HML - Lunaris Licita</title>',
    '<style>body{font:16px system-ui,sans-serif;max-width:42rem;margin:5vh auto;padding:1.5rem;line-height:1.5}',
    'button{padding:.8rem 1.2rem;font:inherit;cursor:pointer}small{color:#666}</style>',
    '<h1>Prova sintetica do R2 HML</h1>',
    '<p>O botao abaixo grava um unico objeto ficticio com chave aleatoria, confere bytes e SHA-256, ',
    'e o exclui. Nao acessa D1, documentos reais nem Google Drive.</p>',
    '<form action="'+PATH+'" method="post">',
    '<button type="submit">Executar prova controlada de R2</button></form>',
    '<p><small>Depois do resultado, restaurar o Worker original HTTP 503.</small></p></html>'
  ].join("");
  return new Response(html,{status:200,headers:{...HEADERS,"content-type":"text/html; charset=utf-8"}});
}
async function sha(bytes){
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
async function runProbe(bucket) {
  if(!bucket||["put","get","delete"].some(k=>typeof bucket[k]!=="function"))
    return {status:503,body:{error:"r2_binding_unavailable"}};
  const key=PREFIX+crypto.randomUUID();
  const expected=new TextEncoder().encode(FIXTURE);
  let verified=false,cleaned=false;
  try{
    const put=await bucket.put(key,expected,{httpMetadata:{contentType:"application/octet-stream"}});
    if(!put)throw Error("write_unconfirmed");
    const got=await bucket.get(key);
    if(!got||typeof got.arrayBuffer!=="function")throw Error("read_unconfirmed");
    const bytes=new Uint8Array(await got.arrayBuffer());
    verified=bytes.byteLength===expected.byteLength && await sha(bytes)===await sha(expected);
  }catch{ /* fail closed, no provider details */ }
  try{
    await bucket.delete(key); // Exclusivamente objeto sintético criado nesta chamada
    cleaned=await bucket.get(key)===null;
  }catch{ cleaned=false; }
  if(!cleaned) return {status:503,body:{error:"r2_cleanup_unverified",cleanup_key:key}};
  if(!verified) return {status:503,body:{error:"r2_verification_failed",cleanup:"confirmed"}};
  return {status:200,body:{
    storage:"lunaris-licita-hml-anexos",
    mode:"synthetic_ephemeral_write_read_delete",
    bytes_verified:true,sha256_verified:true,cleanup:"confirmed"
  }};
}
export default {
  async fetch(request,env,ctx) {
    let url;
    try{url=new URL(request.url);}catch{return json(503,{error:"hml_not_ready"});}
    if(url.pathname!==PATH)return json(503,{error:"hml_not_ready"},request.method==="HEAD");
    if(!["GET","POST"].includes(request.method))return json(405,{error:"method_not_allowed"});
    if(!ctx?.access||typeof ctx.access.getIdentity!=="function")
      return json(403,{error:"access_required"});
    let identity;
    try{identity=await ctx.access.getIdentity();}catch{return json(403,{error:"access_required"});}
    if(typeof identity?.email!=="string"||!identity.email.includes("@"))
      return json(403,{error:"access_required"});
    if(request.method==="GET")return page();
    if(request.headers.get("origin")!==url.origin)
      return json(403,{error:"same_origin_required"});
    const result=await runProbe(env?.R2);
    return json(result.status,result.body);
  }
};
