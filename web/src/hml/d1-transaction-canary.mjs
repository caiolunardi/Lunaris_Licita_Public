// Prova temporaria: transacoes D1 HML que DEVEM fazer rollback.
// Nao e API R7 financeira; nao cria fatos finais ou substitui testes E2E.
// Publicar somente no Worker lunaris-licita-hml, com Access All traffic.
// Restaurar imediatamente web/src/hml/index.mjs apos a prova.
const PATH="/__hml/d1-transacoes";
const HEADERS=Object.freeze({
  "cache-control":"no-store, private",
  "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options":"nosniff",
  "x-frame-options":"DENY",
  "referrer-policy":"same-origin",
  "x-robots-tag":"noindex, nofollow, noarchive"
});
const TABLES="SELECT (SELECT COUNT(*) FROM empresas) AS empresas, " +
 "(SELECT COUNT(*) FROM usuarios) AS usuarios, " +
 "(SELECT COUNT(*) FROM titulos_pagar) AS titulos, " +
 "(SELECT COUNT(*) FROM titulo_baixas) AS baixas, " +
 "(SELECT COUNT(*) FROM operacoes) AS operacoes;";
const ZERO_KEYS=["empresas","usuarios","titulos","baixas","operacoes"];
const REMAINS="SELECT " +
 "(SELECT COUNT(*) FROM empresas WHERE id IN (?,?)) AS empresas, " +
 "(SELECT COUNT(*) FROM usuarios WHERE id=?) AS usuarios, " +
 "(SELECT COUNT(*) FROM titulos_pagar WHERE id=?) AS titulos, " +
 "(SELECT COUNT(*) FROM titulo_baixas WHERE id=?) AS baixas;";
function reply(status,body,head=false){
 return new Response(head?null:JSON.stringify(body),{
  status,headers:{...HEADERS,"content-type":"application/json; charset=utf-8"}
 });
}
function html(){
 return new Response([
  '<!doctype html><html lang="pt-BR"><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>Prova transacional do D1 HML</title>',
  '<style>body{font:16px system-ui,sans-serif;max-width:42rem;margin:5vh auto;padding:1.5rem;line-height:1.5}',
  'button{padding:.8rem 1.2rem;font:inherit;cursor:pointer}</style>',
  '<h1>Transações e isolamento D1 HML</h1>',
  '<p>Cria somente dados fictícios DENTRO de duas transações que devem falhar e ser',
  ' integralmente revertidas. Verifica FKs entre empresas, duplicação e nenhuma linha residual.',
  ' Não executa operações financeiras finais nem altera o aplicativo.</p>',
  '<form method="post" action="',PATH,'"><button type="submit">',
  'Executar prova transacional controlada</button></form>',
  '<p>Após o teste, restaurar o código do Worker que responde HTTP 503.</p></html>'
 ].join(""),{status:200,headers:{...HEADERS,"content-type":"text/html; charset=utf-8"}});
}
function ids(){
 const id=crypto.randomUUID().replaceAll("-","");
 return {a:"hml_a_"+id,b:"hml_b_"+id,u:"hml_u_"+id,
         t:"hml_t_"+id,p:"hml_p_"+id};
}
function statements(db,i,caseName){
 const insert=(sql,...args)=>db.prepare(sql).bind(...args);
 const basic=[
  insert("INSERT INTO empresas (id,nome) VALUES (?,?)",i.a,"HML FICTICIA A"),
  insert("INSERT INTO empresas (id,nome) VALUES (?,?)",i.b,"HML FICTICIA B"),
  insert("INSERT INTO usuarios (id,access_issuer,access_subject,email_normalizado) "+
   "VALUES (?,?,?,?)",i.u,"https://prova-hml.cloudflareaccess.com",
    "ficticio-"+i.u,"ficticio@invalid.example"),
  insert("INSERT INTO usuarios_empresas (usuario_id,empresa_id,papel) VALUES (?,?,?)",
   i.u,i.a,"OPERADOR"),
  insert("INSERT INTO titulos_pagar (id,empresa_id,tipo,beneficiario,categoria_despesa, "+
   "valor_nominal_cent,vencimento,origem_dado,conferencia) VALUES (?,?,?,?,?,?,?,?,?)",
    i.t,i.a,"DIVERSO","TESTE NAO REAL","HML",123,"2026-12-01","NATIVO","VALIDADO")
 ];
 const invalid=caseName==="tenant"
  ?insert("INSERT INTO titulo_baixas (id,empresa_id,titulo_id,tipo, "+
   "data_pagamento,valor_pago_cent,origem_dado,conferencia) VALUES (?,?,?,?,?,?,?,?)",
    i.p,i.b,i.t,"QUITACAO","2026-12-01",123,"NATIVO","VALIDADO")
  :insert("INSERT INTO titulos_pagar (id,empresa_id,tipo,beneficiario,categoria_despesa, "+
   "valor_nominal_cent,vencimento,origem_dado,conferencia) VALUES (?,?,?,?,?,?,?,?,?)",
    i.t,i.a,"DIVERSO","TESTE NAO REAL","HML",123,"2026-12-01","NATIVO","VALIDADO");
 return [...basic,invalid];
}
const clean=row=>row&&ZERO_KEYS.slice(0,4).every(k=>Number.isInteger(row[k])&&row[k]===0);
async function probe(db,kind){
 const key=ids();
 let expectedFailure=false;
 try { await db.batch(statements(db,key,kind)); }
 catch(error) {
  // Apenas a violacao esperada pode contar como prova. Nao reportar
  // "FK/duplicidade OK" quando houve timeout, indisponibilidade ou drift.
  const message=String(error?.message||"");
  expectedFailure=kind==="tenant"
   ? /FOREIGN KEY/i.test(message)
   : /R4: REPLACE nao pode substituir historico|UNIQUE constraint/i.test(message);
 }
 // A prova exige rollback atomico, sem nenhum DELETE ou UPDATE manual.
 let remains;
 try {
  remains=await db.prepare(REMAINS).bind(key.a,key.b,key.u,key.t,key.p).first();
 } catch { return {ok:false,error:"verification_unavailable"}; }
 return {ok:expectedFailure&&clean(remains),error:expectedFailure?"rollback_unverified":"unexpected_or_missing_constraint"};
}
async function run(db){
 if(!db||typeof db.prepare!=="function"||typeof db.batch!=="function")
  return {status:503,body:{error:"d1_binding_missing"}};
 try{
  const before=await db.prepare(TABLES).first();
  if(!before||!ZERO_KEYS.every(k=>Number.isInteger(before[k])&&before[k]===0))
    return {status:503,body:{error:"hml_database_not_empty"}};
  const fk=await db.prepare("PRAGMA foreign_key_check;").all();
  if(fk?.success===false||!Array.isArray(fk?.results)||fk.results.length)
    return {status:503,body:{error:"integrity_precheck_failed"}};
  const a=await probe(db,"tenant");
  if(!a.ok) return {status:503,body:{error:"tenant_rollback_failed"}};
  const b=await probe(db,"unique");
  if(!b.ok) return {status:503,body:{error:"uniqueness_rollback_failed"}};
  const after=await db.prepare(TABLES).first();
  if(!after||!ZERO_KEYS.every(k=>Number.isInteger(after[k])&&after[k]===0))
    return {status:503,body:{error:"hml_database_not_clean"}};
  return {status:200,body:{
   database:"lunaris-licita-hml",
   mode:"synthetic_rollback_only",
   tenant_fk:"rejected",
   duplicate_key:"rejected",
   atomic_rollback:"verified",
   business_data:"empty"
  }};
 }catch{return {status:503,body:{error:"hml_transaction_probe_failed"}};}
}
export default {
 async fetch(request,env,ctx){
  let u;try{u=new URL(request.url)}catch{return reply(503,{error:"hml_not_ready"})}
  if(u.pathname!==PATH)return reply(503,{error:"hml_not_ready"},request.method==="HEAD");
  if(!["GET","POST"].includes(request.method))return reply(405,{error:"method_not_allowed"});
  if(!ctx?.access||typeof ctx.access.getIdentity!=="function")
   return reply(403,{error:"access_required"});
  let identity;
  try{identity=await ctx.access.getIdentity()}catch{return reply(403,{error:"access_required"})}
  if(typeof identity?.email!=="string"||!identity.email.includes("@"))
   return reply(403,{error:"access_required"});
  if(request.method==="GET")return html();
  if(request.headers.get("origin")!==u.origin)
   return reply(403,{error:"same_origin_required"});
  const outcome=await run(env?.DB);
  return reply(outcome.status,outcome.body);
 }
};
