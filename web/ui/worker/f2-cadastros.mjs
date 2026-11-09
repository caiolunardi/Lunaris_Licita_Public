// F2: cadastros por empresa Workerd/D1 local ou A1 HML somente sintética.
// HML exige host fixo, JWT Access e D1 isolado. Produção continua 503.
import {authenticateAccess,requireCompanyRole,SecurityError} from "../../src/r7/security.mjs";
import {assertSessionActive} from "../../src/r7/iam.mjs";
import {DomainError,hashIntent,identifier,replayOrConflict,requireBatch,strictlyObject} from "../../src/r7/domain.mjs";
import {a1RuntimeMode} from "./a1-runtime-gate.mjs";

const ROUTE=/^\/api\/v1\/companies\/([A-Za-z0-9_-]{1,128})\/(orgaos|fornecedores)(?:\/([A-Za-z0-9_-]{1,128}))?$/;
const COMMON={
  "cache-control":"private, no-store, max-age=0",
  "content-type":"application/json; charset=utf-8",
  "x-content-type-options":"nosniff",
  "x-frame-options":"DENY",
  "referrer-policy":"no-referrer",
  "content-security-policy":"default-src 'none'; frame-ancestors 'none'",
  "vary":"cf-access-jwt-assertion"
};
const KINDS=Object.freeze({
  orgaos:Object.freeze({
    table:"orgaos",audit:"ORGAO",
    columns:["nome","cnpj","uasg","contato","email","telefone","endereco_entrega_padrao","observacoes"],
    sizes:{nome:180,cnpj:14,uasg:40,contato:140,email:254,telefone:35,endereco_entrega_padrao:700,observacoes:2400}
  }),
  fornecedores:Object.freeze({
    table:"fornecedores",audit:"FORNECEDOR",
    columns:["nome","cnpj","contato","email","telefone","observacoes"],
    sizes:{nome:180,cnpj:14,contato:140,email:254,telefone:35,observacoes:2400}
  })
});
const PUBLIC_FIELDS=Object.freeze({
  orgaos:"id,nome,cnpj,uasg,contato,email,telefone,endereco_entrega_padrao,observacoes,ativo,versao,origem_dado,conferencia",
  fornecedores:"id,nome,cnpj,contato,email,telefone,observacoes,ativo,versao,origem_dado,conferencia"
});
const IDENTIFIER=/^[A-Za-z0-9_-]{1,128}$/;
const ALLOWED_ERRORS=new Set([
 "f2_not_enabled","access_token_required","invalid_token","access_not_configured",
 "access_keys_unavailable","access_keys_invalid","invalid_session","session_revoked",
 "forbidden","invalid_origin","app_origin_not_configured","invalid_fields",
 "invalid_id","invalid_page","invalid_search","invalid_cursor","invalid_record",
 "invalid_name","invalid_cnpj","invalid_email","invalid_status_change",
 "json_content_type_required","payload_too_large","invalid_json",
 "idempotency_conflict","record_conflict","record_not_found","version_conflict",
 "record_unavailable","request_rejected","hml_synthetic_only"
]);
function json(body,status=200,method="GET"){
 return new Response(method==="HEAD"?null:JSON.stringify(body),{status,headers:COMMON});
}
function sameSite(request,env){
 const app=env?.APP_ORIGIN;
 if(typeof app!=="string"||!/^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/.test(app))
   throw new SecurityError("app_origin_not_configured",503);
 if(new URL(request.url).origin!==app||request.headers.get("origin")!==app)
   throw new SecurityError("invalid_origin",403);
}
async function readBody(request){
 const mime=request.headers.get("content-type")||"";
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(mime))
   throw new DomainError("json_content_type_required",415);
 const n=Number(request.headers.get("content-length")||0);
 if(!Number.isFinite(n)||n>8192)throw new DomainError("payload_too_large",413);
 const text=await request.text();
 if(new TextEncoder().encode(text).byteLength>8192)throw new DomainError("payload_too_large",413);
 try{return JSON.parse(text);}catch{throw new DomainError("invalid_json");}
}
const normalizeName=value=>value.normalize("NFKD").replace(/\p{M}/gu,"").replace(/\s+/g," ").toLocaleLowerCase("pt-BR").trim();
function normalizedData(input,kind){
 const config=KINDS[kind];
 strictlyObject(input,new Set(["intentId",...config.columns,"expectedVersion","ativo"]));
 identifier(input.intentId);
 if(typeof input.nome!=="string"||!input.nome.trim()||input.nome.trim().length>config.sizes.nome||
    /[\u0000-\u001F\u007F]/.test(input.nome))throw new DomainError("invalid_name");
 const data={nome:input.nome.trim()};
 for(const field of config.columns.filter(c=>c!=="nome")){
   const value=input[field];
   if(value==null||value===""){data[field]=null;continue;}
   if(typeof value!=="string")throw new DomainError("invalid_record");
   let cleaned=value.trim();
   if(!cleaned){data[field]=null;continue;}
   if(field==="cnpj"){
     cleaned=cleaned.replace(/[.\-/\s]/g,"").toUpperCase();
     // CNPJ pode ter letras nas 12 posições iniciais desde julho/2026.
     if(!/^[0-9A-Z]{12}[0-9]{2}$/.test(cleaned))throw new DomainError("invalid_cnpj");
   } else if(field==="email"){
     if(cleaned.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned))
       throw new DomainError("invalid_email");
   }
   if(cleaned.length>config.sizes[field]||(/\x00/.test(cleaned))||
      (field!=="observacoes"&&/[\u0000-\u001F\u007F]/.test(cleaned)))
     throw new DomainError("invalid_record");
   data[field]=cleaned;
 }
 return Object.freeze({...data,nome_normalizado:normalizeName(data.nome)});
}
function commandParams(body,kind,isEdit){
 if(!body||typeof body!=="object"||Array.isArray(body))
   throw new DomainError("invalid_fields");
 const statusOnly=isEdit&&Object.hasOwn(body,"ativo");
 if(statusOnly){
   strictlyObject(body,new Set(["intentId","expectedVersion","ativo"]));
   if(body.ativo!==false)throw new DomainError("invalid_status_change");
   return {statusOnly:true,intentId:identifier(body.intentId),expectedVersion:version(body.expectedVersion)};
 }
 if(!isEdit&&(Object.hasOwn(body,"expectedVersion")||Object.hasOwn(body,"ativo")))
   throw new DomainError("invalid_fields");
 const payload=normalizedData(body,kind);
 if(isEdit)version(body.expectedVersion);
 return {statusOnly:false,intentId:identifier(body.intentId),
   expectedVersion:isEdit?body.expectedVersion:null,payload};
}
function version(v){
 if(!Number.isSafeInteger(v)||v<1)throw new DomainError("version_conflict",409);
 return v;
}
function listParameters(url){
 for(const key of url.searchParams.keys())
   if(!["limit","q","after","state"].includes(key)||url.searchParams.getAll(key).length!==1)
     throw new DomainError("invalid_page");
 const limitRaw=url.searchParams.get("limit");
 const limit=limitRaw===null?25:Number(limitRaw);
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw new DomainError("invalid_page");
 const q=url.searchParams.get("q")||"";
 if(q.length>80||/[\u0000-\u001F]/.test(q))throw new DomainError("invalid_search");
 const state=url.searchParams.get("state")||"active";
 if(!["active","inactive","all"].includes(state))throw new DomainError("invalid_page");
 const after=url.searchParams.get("after");
 if(after!==null&&!IDENTIFIER.test(after))throw new DomainError("invalid_cursor");
 return {limit,q:normalizeName(q),state,after};
}
const escapeLike=s=>s.replace(/[\\%_]/g,c=>"\\"+c);
async function getList(db,companyId,kind,url,mode){
 const cfg=KINDS[kind],p=listParameters(url),table=cfg.table;
 const statusSql=(p.state==="active"?" AND ativo=1":p.state==="inactive"?" AND ativo=0":"")+
   (mode==="hml"?" AND nome LIKE 'TESTE - %'":"");
 const filterSql=p.q?" AND COALESCE(nome_normalizado,lower(nome)) LIKE ? ESCAPE '\\'":"";
 const values=[companyId];
 if(p.q)values.push(escapeLike(p.q)+"%");
 let cursorSql="";
 if(p.after){
   const cursor=await db.prepare("SELECT id,COALESCE(nome_normalizado,lower(nome)) AS sort_name,ativo "+
     "FROM "+table+" WHERE id=? AND empresa_id=?"+statusSql).bind(p.after,companyId).first();
   if(!cursor || (p.q && !cursor.sort_name.startsWith(p.q)))
     throw new DomainError("invalid_cursor");
   cursorSql=" AND (COALESCE(nome_normalizado,lower(nome))>? OR "+
     "(COALESCE(nome_normalizado,lower(nome))=? AND id>?))";
   values.push(cursor.sort_name,cursor.sort_name,cursor.id);
 }
 values.push(p.limit+1);
 const query="SELECT "+PUBLIC_FIELDS[kind]+" FROM "+table+
   " WHERE empresa_id=?"+statusSql+filterSql+cursorSql+
   " ORDER BY COALESCE(nome_normalizado,lower(nome)),id LIMIT ?";
 const result=await db.prepare(query).bind(...values).all();
 const rows=result?.results||[];
 const hasMore=rows.length>p.limit;
 const items=rows.slice(0,p.limit);
 return {items,nextCursor:hasMore?items.at(-1).id:null,limit:p.limit};
}
async function getDetail(db,companyId,kind,recordId,mode){
 const found=await db.prepare("SELECT "+PUBLIC_FIELDS[kind]+" FROM "+KINDS[kind].table+
   " WHERE empresa_id=? AND id=?"+(mode==="hml"?" AND nome LIKE 'TESTE - %'":"")+
   " LIMIT 1").bind(companyId,recordId).first();
 if(!found)throw new DomainError("record_not_found",404);
 return {item:found};
}
async function writeRecord(db,principal,actor,companyId,kind,recordId,body){
 requireBatch(db);
 const isEdit=recordId!==null;
 const cmd=commandParams(body,kind,isEdit);
 const cfg=KINDS[kind],key=cfg.audit;
 const operation="F2_"+key+"_"+(isEdit?(cmd.statusOnly?"DEACTIVATE":"UPDATE"):"CREATE");
 const hash=await hashIntent(operation,[
   recordId,cmd.expectedVersion,cmd.statusOnly?false:cmd.payload
 ]);
 const prior=await replayOrConflict(db,companyId,cmd.intentId,hash,operation);
 if(prior)return {replayed:true,intentId:cmd.intentId};
 const id=recordId||crypto.randomUUID();
 const now=new Date().toISOString();
 const membership=" EXISTS(SELECT 1 FROM usuarios u "+
   "JOIN usuarios_empresas m ON m.usuario_id=u.id "+
   "JOIN empresas e ON e.id=m.empresa_id "+
   "WHERE u.id=? AND u.access_issuer=? AND u.access_subject=? AND u.ativo=1 "+
   "AND m.empresa_id=? AND m.ativo=1 AND m.papel IN ('ADMIN','OPERADOR') AND e.ativo=1)";
 const authBind=[actor.userId,principal.issuer,principal.subject,companyId];
 let record;
 if(!isEdit){
   const cols=["id","empresa_id","nome_normalizado",...cfg.columns,
     "ativo","versao","criado_em","atualizado_em","operacao_id","origem_dado","conferencia"];
   const params=[id,companyId,cmd.payload.nome_normalizado,...cfg.columns.map(x=>cmd.payload[x]),
     1,1,now,now,cmd.intentId,"NATIVO","VALIDADO"];
   record=db.prepare("INSERT INTO "+cfg.table+"("+cols.join(",")+") "+
     "SELECT "+cols.map(()=>"?").join(",")+" WHERE "+membership+
     " AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)")
     .bind(...params,...authBind,cmd.intentId);
 }else{
   const fields=cmd.statusOnly?["ativo"]:["nome_normalizado",...cfg.columns];
   const values=cmd.statusOnly?[0]:[cmd.payload.nome_normalizado,...cfg.columns.map(x=>cmd.payload[x])];
   record=db.prepare("UPDATE "+cfg.table+" SET "+fields.map(x=>x+"=?").join(",")+
     ",versao=versao+1,atualizado_em=?,operacao_id=? "+
     "WHERE id=? AND empresa_id=? AND versao=? AND ativo=1 AND origem_dado='NATIVO' "+
     "AND "+membership+" AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)")
     .bind(...values,now,cmd.intentId,id,companyId,cmd.expectedVersion,...authBind,cmd.intentId);
 }
 const expectedVersion=isEdit?cmd.expectedVersion+1:1;
 // Journal + auditoria só surgem se o registro da empresa foi efetivamente alterado.
 const journal=db.prepare(
   "INSERT INTO operacoes(id,empresa_id,tipo,hash_pedido,ator_id,estado,origem_dado,conferencia) "+
   "SELECT ?,? ,?, ?,?,'CONCLUIDA','NATIVO','VALIDADO' FROM "+cfg.table+
   " WHERE id=? AND empresa_id=? AND versao=? AND operacao_id=? "+
   "AND NOT EXISTS(SELECT 1 FROM operacoes WHERE id=?)"
 ).bind(cmd.intentId,companyId,operation,hash,actor.userId,id,companyId,expectedVersion,cmd.intentId,cmd.intentId);
 const audit=db.prepare(
   "INSERT INTO eventos_auditoria(id,empresa_id,tipo_entidade,entidade_id_texto,acao,ator_id,resumo,operacao_id,origem_dado,conferencia) "+
   "SELECT ?,?,?,?,?,?, ?,?,'NATIVO','VALIDADO' FROM operacoes o "+
   "WHERE o.id=? AND o.empresa_id=? AND o.tipo=? AND o.estado='CONCLUIDA'"
 ).bind(crypto.randomUUID(),companyId,key,id,isEdit?(cmd.statusOnly?"DESATIVAR":"ATUALIZAR"):"CRIAR",
   actor.userId,"Cadastro F2: "+operation,cmd.intentId,cmd.intentId,companyId,operation);
 let results;
 try {results=await db.batch([record,journal,audit]);}
 catch{throw new DomainError("record_conflict",409);}
 if(results?.length===3&&results.every(x=>x?.meta?.changes===1))
   return {replayed:false,intentId:cmd.intentId,id,newVersion:expectedVersion};
 const raced=await replayOrConflict(db,companyId,cmd.intentId,hash,operation);
 if(raced)return {replayed:true,intentId:cmd.intentId};
 throw new DomainError("version_conflict",409);
}
// Todos os cadastros A1 HML devem ser sintéticos; não aceitar contato/PII.
async function requireA1Synthetic(db,companyId,kind,recordId,body){
 if(!body||typeof body!=="object"||Array.isArray(body))
  throw new DomainError("hml_synthetic_only",403);
 if(recordId){
  const row=await db.prepare("SELECT nome,origem_dado FROM "+KINDS[kind].table+
   " WHERE id=? AND empresa_id=? LIMIT 1").bind(recordId,companyId).first();
  if(!row||row.origem_dado!=="NATIVO"||!/^TESTE - [^\s]/i.test(row.nome))
   throw new DomainError("hml_synthetic_only",403);
 }
 if(body.ativo===false){
  if(Object.keys(body).some(k=>!["intentId","expectedVersion","ativo"].includes(k)))
   throw new DomainError("hml_synthetic_only",403);
  return;
 }
 if(typeof body.nome!=="string"||!/^TESTE - [^\s]/i.test(body.nome))
  throw new DomainError("hml_synthetic_only",403);
 for(const [k,v] of Object.entries(body)){
  if(["nome","intentId","expectedVersion"].includes(k))continue;
  if(v!==null&&v!==undefined&&v!=="")throw new DomainError("hml_synthetic_only",403);
 }
}

export function createF2Handler({fetchKeys}={}){
 return async function handle(request,env){
   const url=new URL(request.url),parts=ROUTE.exec(url.pathname);
   if(!parts)return null;
   const method=request.method.toUpperCase();
   const [,companyId,kind,recordIdRaw]=parts;
   const recordId=recordIdRaw||null;
   if(!["GET","HEAD","POST","PATCH"].includes(method)||
     (recordId&&method==="POST")||(!recordId&&method==="PATCH"))
     return json({error:"method_not_allowed"},405,method);
   try{
     const mode=a1RuntimeMode(request,env,"F2");
     if(!mode)throw new SecurityError("f2_not_enabled",503);
     if((method==="POST"||method==="PATCH"))sameSite(request,env);
     if(recordId&&url.search)throw new DomainError("invalid_page");
     if((method==="POST"||method==="PATCH")&&url.search)throw new DomainError("invalid_page");
     const principal=await authenticateAccess(request,env,fetchKeys||fetch);
     await assertSessionActive(env.DB,principal);
     const actor=await requireCompanyRole(env.DB,principal,companyId,
       method==="GET"||method==="HEAD"?"read":"write");
     if(method==="GET"||method==="HEAD"){
       const data=recordId?await getDetail(env.DB,companyId,kind,recordId,mode):
         await getList(env.DB,companyId,kind,url,mode);
       return json(data,200,method);
     }
     const body=await readBody(request);
     if(mode==="hml")await requireA1Synthetic(env.DB,companyId,kind,recordId,body);
     const result=await writeRecord(env.DB,principal,actor,companyId,kind,recordId,body);
     return json(result,result.replayed?200:method==="POST"?201:200,method);
   }catch(error){
     if(error instanceof DomainError||error instanceof SecurityError){
       const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=503?error.status:400;
       return json({error:ALLOWED_ERRORS.has(error.code)?error.code:"request_rejected"},status,method);
     }
     return json({error:"record_unavailable"},503,method);
   }
 };
}
