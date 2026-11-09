// F10 read-only: Gemini is never an authority for authorization or tools.
import {authenticateAccess,requireCompanyRole,SecurityError} from "../../src/r7/security.mjs";
import {assertSessionActive,requireEntityPermission,assertAggregateAccess} from "../../src/r7/iam.mjs";
import {DomainError} from "../../src/r7/domain.mjs";
import {explainWithGemini,canUseGemini} from "./f10-gemini.mjs";
const ROUTE=/^\/api\/v1\/companies\/([a-zA-Z0-9_-]{1,128})\/gabi\/(capabilities|ask)$/;
const HOSTS=new Set(["licita.local.test","localhost","127.0.0.1"]);
const HEAD={"cache-control":"private, no-store, max-age=0","content-type":"application/json; charset=utf-8",
 "x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer",
 "x-robots-tag":"noindex, nofollow, noarchive","vary":"cf-access-jwt-assertion"};
const WRITE=/\b(?:pague|pagar agora|quite|baixe|exclua|apague|delete|altere|edite|publique|envie|mande mensagem|transfira|conceda|revogue|libere acesso|revele|imprima segredo|ignore|ignora|jailbreak|instru[cç][õo]es do sistema|system prompt|developer prompt|exfiltr|roleplay)\b/i;
const PATTERNS=[["bills",/boleto|contas? a pagar|venciment|despesas?|compromiss|pagar/i],
 ["tenders",/licita|preg[aã]o|edital|certame|processo/i],
 ["quotes",/cota[cç][oõ]es|or[cç]amento|margem|markup|pre[cç]o|precifica/i],
 ["documents",/documento|comprovante|arquivo|vers[aã]o|anexo/i]];
const LINKS={bills:"/contas-pagar",tenders:"/licitacoes",quotes:"/cotacoes",
 documents:"/documentos",help:"/ajuda"};
const ALLOWED=new Set(["access_token_required","invalid_token","invalid_session",
 "session_revoked","forbidden","invalid_origin","app_origin_not_configured",
 "json_content_type_required","payload_too_large","invalid_json","invalid_prompt",
 "too_many_records","aggregate_with_restricted_rows","entity_unavailable","f10_not_enabled"]);
const reply=(body,status=200,method="GET")=>new Response(method==="HEAD"?null:JSON.stringify(body),
 {status,headers:HEAD});
async function parse(request){
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type")||""))
  throw new DomainError("json_content_type_required",415);
 const len=Number(request.headers.get("content-length")||0);
 if(!Number.isSafeInteger(len)||len>1200)throw new DomainError("payload_too_large",413);
 const raw=await request.text();
 if(new TextEncoder().encode(raw).byteLength>1200)throw new DomainError("payload_too_large",413);
 let o;try{o=JSON.parse(raw);}catch{throw new DomainError("invalid_json",400);}
 if(!o||Array.isArray(o)||typeof o!=="object"||Object.keys(o).length!==1||
  typeof o.question!=="string"||o.question.trim()!==o.question||
  o.question.length<3||o.question.length>400||/[\u0000-\u001f\u007f]/.test(o.question))
  throw new DomainError("invalid_prompt",400);
 return o.question;
}
const classify=q=>PATTERNS.find(([,regex])=>regex.test(q))?.[0]||"help";
function summary(topic,records){
 if(topic==="bills")return records.length?"Encontrei "+records.length+" conta(s) em aberto, nativas e verificadas. Consulte Contas a pagar antes de qualquer decisão.":"Nenhuma conta aberta e verificada foi encontrada. Isso não comprova ausência de outras obrigações.";
 if(topic==="tenders")return records.length?"Encontrei "+records.length+" licitação(ões) acessível(is). Confira os detalhes em Licitações.":"Não encontrei licitações acessíveis para apresentar agora.";
 if(topic==="quotes")return records.length?"Encontrei "+records.length+" cotação(ões) salva(s), que são estimativas e não vendas ou recebimentos.":"Não encontrei cotações verificadas. Abra a Calculadora para simular.";
 if(topic==="documents")return "Abra Documentos para consultar arquivos e versões. A Gabi não lê, transmite nem baixa o conteúdo dos anexos nesta fase.";
 return "Posso orientar sobre contas a pagar, licitações, cotações e documentos. Escolha um desses temas ou abra a Central de ajuda.";
}
async function query(db,principal,company,topic){
 if(topic==="bills"){
  await assertAggregateAccess(db,principal,company);
  const rows=(await db.prepare("SELECT v.id,v.vencimento,v.valor_nominal_cent,"+
   "t.origem_dado,t.conferencia FROM v_titulos_situacao v JOIN titulos_pagar t "+
   "ON t.id=v.id AND t.empresa_id=v.empresa_id "+
   "WHERE v.empresa_id=? AND v.situacao='ABERTO' AND v.vencimento IS NOT NULL "+
   "AND v.valor_nominal_cent IS NOT NULL ORDER BY v.vencimento,v.id LIMIT 201")
   .bind(company).all())?.results||[];
  if(rows.length>200)throw new DomainError("too_many_records",409);
  const list=[];
  for(const r of rows){
   await requireEntityPermission(db,principal,company,"TITULO_PAGAR",r.id,"READ");
   if(r.origem_dado!=="NATIVO"||r.conferencia!=="VALIDADO")continue;
   if(list.length<5)list.push({id:r.id,label:"Conta: "+r.vencimento,
    dueDate:r.vencimento,amountCent:r.valor_nominal_cent});
  }
  return list;
 }
 if(topic==="tenders"||topic==="quotes"){
  const tender=topic==="tenders";
  const rows=(await db.prepare(tender?
   "SELECT id,numero AS label,ano,situacao_participacao AS status FROM licitacoes "+
    "WHERE empresa_id=? ORDER BY id DESC LIMIT 201":
   "SELECT id,descricao AS label,preco_minimo_unit_cent,conferencia FROM cotacoes_precos "+
    "WHERE empresa_id=? ORDER BY id DESC LIMIT 201").bind(company).all())?.results||[];
  if(rows.length>200)throw new DomainError("too_many_records",409);
  const list=[];
  for(const r of rows){
   try{await requireEntityPermission(db,principal,company,tender?"LICITACAO":"COTACAO",r.id,"READ");}
   catch(e){if(e instanceof SecurityError&&e.status===404)continue;throw e;}
   if(!tender&&r.conferencia!=="VALIDADO")continue;
   if(list.length<5)list.push(tender?{id:r.id,label:String(r.label||"Licitação").slice(0,100),
    year:r.ano,status:r.status||"Não informado"}:
    {id:r.id,label:String(r.label||"Cotação").slice(0,100),
     minimumUnitCent:r.preco_minimo_unit_cent});
  }
  return list;
 }
 return [];
}
export function createF10Handler({fetchKeys,fetchGemini}={}){
 return async(request,env)=>{
  const url=new URL(request.url),parts=ROUTE.exec(url.pathname);
  if(!parts)return null;
  const method=request.method.toUpperCase(),cap=parts[2]==="capabilities";
  if((cap&&!["GET","HEAD"].includes(method))||(!cap&&method!=="POST"))
   return reply({error:"method_not_allowed"},405,method);
  try{
   // Even a real Gemini secret cannot enable production/remote data access.
   if(!HOSTS.has(url.hostname)||env?.F1_RUNTIME_ENABLED!=="test_local_only"||
    env?.F10_RUNTIME_ENABLED!=="test_local_only"||!env?.DB?.prepare||!env?.DB?.batch)
    throw new SecurityError("f10_not_enabled",503);
   if(url.search)throw new DomainError("invalid_prompt",400);
   if(!cap){
    const origin=env?.APP_ORIGIN;
    if(typeof origin!=="string"||!/^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$/.test(origin))
     throw new SecurityError("app_origin_not_configured",503);
    if(url.origin!==origin||request.headers.get("origin")!==origin)
     throw new SecurityError("invalid_origin",403);
   }
   const principal=await authenticateAccess(request,env,fetchKeys||fetch);
   await assertSessionActive(env.DB,principal);
   await requireCompanyRole(env.DB,principal,parts[1],"read");
   if(cap)return reply({mode:"local_read_only",readOnly:true,
    modelAvailable:canUseGemini(env),actionsAllowed:false,documentsContentAllowed:false,
    historyStored:false},200,method);
   const question=await parse(request);
   if(WRITE.test(question))return reply({reply:"Não posso pagar, alterar, "+
    "apagar, enviar mensagens, conceder acessos nem revelar segredos. "+
    "Posso apenas consultar registros autorizados.",mode:"refused",topic:"help",
    records:[],sources:[],readOnly:true,sentExternally:false});
   const topic=classify(question),records=await query(env.DB,principal,parts[1],topic);
   const deterministic=summary(topic,records);
   // Gemini receives no free-text source fields and never selects tools or permissions.
   const facts=records.map(({id,label,...other})=>({id,...other}));
   const model=await explainWithGemini({question,topic,facts,deterministic,env,fetchFn:fetchGemini});
   const sources=topic==="documents"?[{kind:topic,label:"Biblioteca de documentos",
    url:LINKS.documents,recordId:null}]:
    records.map(x=>({kind:topic,label:x.label,url:LINKS[topic],recordId:x.id}));
   return reply({reply:model.text,mode:model.used?"gemini_explanation":"deterministic",
    topic,records,sources,readOnly:true,sentExternally:model.used,
    disclaimer:"Consulta sem alterações. Confirme informações e valores na tela de origem."});
  }catch(e){
   if(e instanceof SecurityError||e instanceof DomainError){
    const status=Number.isInteger(e.status)&&e.status>=400&&e.status<=503?e.status:400;
    return reply({error:ALLOWED.has(e.code)?e.code:"request_rejected"},status,method);
   }
   return reply({error:"gabi_unavailable"},503,method);
  }
 };
}
