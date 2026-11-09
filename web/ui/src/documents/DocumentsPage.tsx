import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {Archive,ArrowLeft,Download,FileArchive,FileCheck2,
 FilePlus2,FolderOpen,Info,LockKeyhole,RefreshCcw,ShieldCheck,UploadCloud} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {demoDocuments,demoOwners,demoPreview} from "./fixtures";
import {explainReason,fileError,mimeName,ownerInfo,
 safeFilename,shaHex,sizeText,validDetail,validList,validOwners,validPreview,
 type Props,type OwnerType,type FileRecord,type DocumentDetail,type Preview,
 type Owner, type Version} from "./types";

const ownerTypes=Object.keys(ownerInfo) as OwnerType[];
const docRole=(role:string)=>Object.values(ownerInfo).flatMap(x=>x.roles).find(x=>x[0]===role)?.[1]||role;
const status=(row:FileRecord)=>row.estado_integridade==="VERIFICADO"&&row.conferencia==="VALIDADO"?"Verificado":"Precisa de conferência";
function readableError(code:number){
 if(code===401)return "Sua sessão não está ativa. Entre novamente pela identidade.";
 if(code===403)return "Você não tem autorização para consultar ou alterar este documento.";
 if(code===404)return "O documento não foi encontrado ou não pode ser acessado.";
 if(code===409)return "Esta operação conflitou com outra versão, documento ou regra de guarda. Atualize e confira antes de tentar novamente.";
 if(code===413)return "Arquivo grande demais. O limite local é 8 MB.";
 if(code===503)return "A biblioteca local está indisponível. Nenhum arquivo foi enviado em segundo plano.";
 return "Não foi possível concluir. Confira as informações e tente novamente.";
}
function dateLabel(value:string|null){
 if(!value)return "Data não informada";
 const day=value.slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return "Data não conferida";
 return new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC",day:"2-digit",month:"short",year:"numeric"})
 .format(new Date(day+"T12:00:00Z"));
}
const allowedMime=(file:File)=>file.type==="text/xml"?"application/xml":file.type;
export default function DocumentsPage({identity,onIdentity}:Props){
 const company=identity.active;
 const preview=!!company&&identity.source==="fixture"&&identity.stage==="preview";
 const verified=!!company&&identity.source==="server"&&identity.stage==="verified";
 const canWrite=!!company?.permissions.canWrite,admin=!!company?.permissions.canApprove;
 const root="/api/v1/companies/"+encodeURIComponent(company?.id||"none")+"/files";
 const [tab,setTab]=useState<"library"|"add">("library");
 const [list,setList]=useState<FileRecord[]>([]);
 const [demo,setDemo]=useState<DocumentDetail[]>(()=>demoDocuments(company?.id||""));
 const [detail,setDetail]=useState<DocumentDetail|null>(null);
 const [selected,setSelected]=useState<string|null>(null);
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("");
 const [cursor,setCursor]=useState<string|null>(null);
 const [kind,setKind]=useState<OwnerType>("licitacao");
 const [owner,setOwner]=useState(""),[owners,setOwners]=useState<Owner[]>([]);
 const [role,setRole]=useState("EDITAL");
 const [isRetention,setRetention]=useState(false);
 const [file,setFile]=useState<File|null>(null),[replacement,setReplacement]=useState<File|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [error,setError]=useState<string|null>(null),[success,setSuccess]=useState<string|null>(null);
 const [archive,setArchive]=useState<Preview|null>(null);
 const [refresh,setRefresh]=useState(0),intent=useRef<string|null>(null),serial=useRef(0);
 const currentIntent=()=>{if(!intent.current)intent.current=crypto.randomUUID();return intent.current;};
 const clearIntent=()=>{intent.current=null;};
 const clearResult=()=>{setError(null);setSuccess(null);setArchive(null);};
 const fetchJSON=useCallback(async<T,>(url:string):Promise<T>=>{
  const res=await fetch(url,{credentials:"same-origin",cache:"no-store",
   headers:{accept:"application/json"}});
  if(!res.ok)throw Object.assign(new Error("server_error"),{status:res.status});
  return res.json() as Promise<T>;
 },[]);
 const loadLibrary=useCallback(async(after:string|null=null)=>{
  if(!verified)return;
  const seq=++serial.current;setLoading(true);setError(null);
  if(!after){setList([]);setCursor(null);}
  const p=new URLSearchParams({limit:"25"});if(filter)p.set("q",filter);
  if(after)p.set("after",after);
  try{
   const r=await fetchJSON<unknown>(root+"?"+p);
   if(!validList(r))throw Error("invalid_files_contract");
   if(seq===serial.current){setList(old=>after?[...old,...r.items]:r.items);setCursor(r.nextCursor);}
  }catch(e){if(seq===serial.current)setError(readableError((e as {status?:number}).status||503));}
  finally{if(seq===serial.current)setLoading(false);}
 },[verified,filter,fetchJSON,root]);
 const loadOwners=useCallback(async()=>{
  if(!verified)return;
  const seq=++serial.current;setLoading(true);setError(null);
  try{
   const r=await fetchJSON<unknown>(root+"/owners?type="+encodeURIComponent(kind));
   if(!validOwners(r))throw Error("invalid_owner_contract");
   if(seq===serial.current){setOwners(r.items);setOwner(old=>r.items.some(x=>x.id===old)?old:r.items[0]?.id||"");}
  }catch(e){if(seq===serial.current){setOwners([]);setOwner("");
   setError(readableError((e as {status?:number}).status||503));}}
  finally{if(seq===serial.current)setLoading(false);}
 },[verified,root,kind,fetchJSON]);
 const loadDetail=useCallback(async(id:string)=>{
  if(!verified)return;
  const seq=++serial.current;setLoading(true);setError(null);
  try{
   const r=await fetchJSON<unknown>(root+"/"+encodeURIComponent(id));
   if(!validDetail(r))throw Error("invalid_document_detail");
   if(seq===serial.current)setDetail(r);
  }catch(e){if(seq===serial.current)setError(readableError((e as {status?:number}).status||503));}
  finally{if(seq===serial.current)setLoading(false);}
 },[verified,root,fetchJSON]);
 useEffect(()=>{const timer=setTimeout(()=>setFilter(query.trim().slice(0,100)),230);
  return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{if(verified&&tab==="library"&&!selected)void loadLibrary();
  return()=>{serial.current++;};},[verified,tab,selected,refresh,loadLibrary]);
 useEffect(()=>{if(verified&&tab==="add")void loadOwners();
  return()=>{serial.current++;};},[verified,tab,kind,loadOwners]);
 useEffect(()=>{if(verified&&selected)void loadDetail(selected);
  return()=>{serial.current++;};},[verified,selected,refresh,loadDetail]);
 const shown=preview?demo.map(d=>d.item).filter(x=>
  (x.titulo||"").toLocaleLowerCase("pt-BR").includes(filter.toLocaleLowerCase("pt-BR"))):list;
 const ownerChoices=preview?demoOwners(kind,company!.id):owners;
 const chosenOwner=ownerChoices.some(x=>x.id===owner)?owner:ownerChoices[0]?.id||"";
 const roleChoices=ownerInfo[kind].roles;
 function chooseType(value:OwnerType){
  setKind(value);setRole(ownerInfo[value].roles[0][0]);setRetention(false);
  setOwner("");setFile(null);clearIntent();clearResult();
 }
 function openDocument(id:string){
  clearResult();clearIntent();setReplacement(null);setSelected(id);
  if(preview)setDetail(demo.find(d=>d.item.id===id)||null);
 }
 function back(){setSelected(null);setDetail(null);setReplacement(null);clearResult();clearIntent();}
 async function putFile(data:File,opts:{intent:string;role?:string;ownerId?:string;docId?:string;version?:number}){
  const problem=fileError(data);
  if(problem)throw Error(problem);
  const buffer=await data.arrayBuffer(),digest=await shaHex(buffer);
  const headers:Record<string,string>={"accept":"application/json","content-type":allowedMime(data),
   "x-content-sha256":digest,"x-doc-intent":opts.intent,
   "x-doc-name":safeFilename(data.name)};
  let endpoint=root+"/upload";
  if(opts.docId){
   endpoint=root+"/"+encodeURIComponent(opts.docId)+"/versions/stream";
   headers["x-doc-expected-version"]=String(opts.version);
  }else{
   headers["x-doc-owner-type"]=kind;headers["x-doc-owner-id"]=opts.ownerId||"";
   headers["x-doc-role"]=opts.role||role;
   headers["x-doc-type"]=isRetention&&kind==="conta_receber"?
    "COMPROVANTE_RETENCAO":role;
  }
  // Request uses File/Blob: browser supplies a known Content-Length.
  // Never set forbidden Content-Length manually or cache any document bytes.
  const res=await fetch(endpoint,{method:"POST",credentials:"same-origin",
   cache:"no-store",headers,body:data});
  if(!res.ok)throw Object.assign(new Error("upload_rejected"),{status:res.status});
  const result=await res.json() as {intentId?:string;documentoId?:string;
   versaoId?:string;replayed?:boolean};
  if(result.intentId!==opts.intent||!result.documentoId||!result.versaoId)
   throw Error("unconfirmed_document_journal");
  return result;
 }
 async function upload(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||!canWrite)return;
  const problem=fileError(file);if(problem){setError(problem);return;}
  if(!chosenOwner){setError("Primeiro escolha o registro ao qual o documento pertence.");return;}
  setBusy(true);clearResult();
  if(preview){
   const safe=safeFilename(file!.name),id="f8-demo-"+crypto.randomUUID();
   const item:FileRecord={id,tipo:isRetention?"COMPROVANTE_RETENCAO":role,titulo:safe,
    versao:2,versao_corrente_id:id+"-v1",origem_dado:"NATIVO",conferencia:"VALIDADO",
    numero_versao:1,mime_type:allowedMime(file!),tamanho_bytes:file!.size,
    sha256:null,estado_integridade:"VERIFICADO",versao_criada_em:null};
   setDemo(old=>[{item,versions:[{id:id+"-v1",numero_versao:1,nome_original:safe,
    mime_type:allowedMime(file!),tamanho_bytes:file!.size,sha256:null,
    estado_integridade:"VERIFICADO",origem_dado:"NATIVO",conferencia:"VALIDADO",
    criado_em:null,enviado_por:"Pessoa fictícia",locations:[{provedor:"R2",
     status:"VERIFICADO",verificado_em:null,hash_verificado:null,tamanho_verificado:null}]}],
    owners:[{id:chosenOwner,papel:role}],archiveCopyAvailable:false,
    r2DeletionAuthorized:false},...old]);
   clearIntent();setFile(null);setSuccess("Documento adicionado somente à demonstração fictícia. Nenhum arquivo foi salvo.");
   setTab("library");setBusy(false);return;
  }
  try{await putFile(file!,{intent:currentIntent(),role,ownerId:chosenOwner});
   clearIntent();setFile(null);setSuccess("Arquivo guardado e conferido no R2 local.");
   setRefresh(x=>x+1);setTab("library");
  }catch(e){setError((e as {status?:number}).status?
   readableError((e as {status?:number}).status!):
   e instanceof Error?e.message:"Falha ao anexar. Confirme o registro antes de tentar de novo.");}
  finally{setBusy(false);}
 }
 async function newVersion(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!detail||busy||!canWrite)return;
  const problem=fileError(replacement);if(problem){setError(problem);return;}
  setBusy(true);clearResult();
  if(preview){
   const old=detail,number=old.versions[0].numero_versao+1,v=old.item.id+"-v"+number;
   const newer:Version={...old.versions[0],id:v,numero_versao:number,
    nome_original:safeFilename(replacement!.name),tamanho_bytes:replacement!.size,
    mime_type:allowedMime(replacement!),sha256:null};
   const updated={...old,item:{...old.item,titulo:newer.nome_original,versao:old.item.versao+1,
    versao_corrente_id:v,numero_versao:number,tamanho_bytes:newer.tamanho_bytes},
    versions:[newer,...old.versions]};
   setDemo(all=>all.map(d=>d.item.id===old.item.id?updated:d));setDetail(updated);
   clearIntent();setReplacement(null);
   setSuccess("Nova versão apenas fictícia. Nenhum byte foi armazenado.");
   setBusy(false);return;
  }
  try{await putFile(replacement!,{intent:currentIntent(),
   docId:detail.item.id,version:detail.item.versao});
   clearIntent();setReplacement(null);setRefresh(x=>x+1);
   setSuccess("Nova versão verificada no R2 local; a anterior continua no histórico.");
  }catch(e){setError((e as {status?:number}).status?
   readableError((e as {status?:number}).status!):
   e instanceof Error?e.message:"Falha ao atualizar. Confira antes de repetir.");}
  finally{setBusy(false);}
 }
 async function download(v:Version){
  if(!detail||busy)return;
  if(preview){setError("A demonstração não contém arquivos reais para baixar.");return;}
  setBusy(true);clearResult();
  try{
   const res=await fetch(root+"/"+encodeURIComponent(detail.item.id)+
    "/versions/"+encodeURIComponent(v.id)+"/content",{
    cache:"no-store",credentials:"same-origin"});
   if(!res.ok)throw Object.assign(new Error("document_unavailable"),{status:res.status});
   const bytes=await res.arrayBuffer(),remoteHash=res.headers.get("x-content-sha256");
   const actual=await shaHex(bytes);
   if(!remoteHash||actual!==remoteHash||actual!==v.sha256)
    throw Error("Os bytes baixados não conferem com o histórico; download bloqueado.");
   const blob=new Blob([bytes],{type:v.mime_type||"application/octet-stream"});
   const url=URL.createObjectURL(blob),link=document.createElement("a");
   link.href=url;link.download=safeFilename(v.nome_original||"documento");
   document.body.appendChild(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),0);
   setSuccess("Arquivo conferido e preparado para baixar.");
  }catch(e){setError((e as {status?:number}).status?
   readableError((e as {status?:number}).status!):
   e instanceof Error?e.message:"Não foi possível conferir o arquivo.");}
  finally{setBusy(false);}
 }
 async function archiveReview(v:Version){
  if(!detail||!admin)return;
  setBusy(true);clearResult();
  if(preview){setArchive(demoPreview(detail.item.id,v.id));setBusy(false);return;}
  try{
   const r=await fetchJSON<unknown>(root+"/"+encodeURIComponent(detail.item.id)+
    "/versions/"+encodeURIComponent(v.id)+"/archive-preview");
   if(!validPreview(r))throw Error("Resposta incompleta da política de guarda.");
   setArchive(r);
  }catch(e){setError((e as {status?:number}).status?
   readableError((e as {status?:number}).status!):
   "Não foi possível avaliar a guarda; documento não liberado.");}
  finally{setBusy(false);}
 }
 if(!company||(!preview&&!verified))return <Card><SectionHeading title="Escolha a empresa para ver os arquivos"/>
  <p>Os documentos são privados e separados por empresa. Selecione sua empresa autorizada.</p>
  <Button onClick={onIdentity}>Escolher empresa</Button></Card>;
 return <div className="f8-page">
  <div className="page-intro"><div><p className="eyebrow">F8 · Seus documentos</p>
   <h1>Arquivos em ordem, sem complicação.</h1>
   <p>Encontre o documento certo, confira a versão e guarde comprovantes junto ao assunto correto.</p>
  </div><FolderOpen size={36} aria-hidden="true"/></div>
  <Notice title={preview?"Demonstração fictícia":"Acervo protegido em laboratório local"}>
   {preview?"Todos os arquivos, vínculos e históricos desta tela são exemplos. Nenhum arquivo foi enviado a um serviço.":
    "Os arquivos desta fase usam D1 e R2 locais. Google Drive, backup real e migração de arquivos continuam desativados."}
  </Notice>
  <div className="f4-company"><span><LockKeyhole size={21}/></span>
   <div><small>Arquivos da empresa</small><strong>{company.name} · {company.role}</strong></div>
   <Button variant="secondary" onClick={onIdentity}>Trocar empresa</Button>
  </div>
  {error&&<div className="f4-error" role="alert">{error}</div>}
  {success&&<div className="f4-success" role="status">{success}</div>}
  {!selected&&<nav className="f8-tabs" aria-label="Organização de documentos">
   <Button variant={tab==="library"?"primary":"secondary"} onClick={()=>{setTab("library");clearResult();}}>
    <FolderOpen size={16}/>Ver meus arquivos</Button>
   <Button variant={tab==="add"?"primary":"secondary"} onClick={()=>{setTab("add");clearResult();}}
    disabled={!canWrite}><FilePlus2 size={16}/>Anexar documento</Button>
   <Button variant="secondary" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>
    <RefreshCcw size={16}/>Atualizar</Button>
  </nav>}
  {loading&&<Card><Skeleton lines={3}/></Card>}
  {!selected&&tab==="library"&&<Card className="f8-section">
   <SectionHeading eyebrow="Biblioteca da empresa" title="Encontre o que precisa"/>
   <p className="f8-help">O documento acompanha a licitação, empenho, compra, conta ou recebimento.
    As versões antigas continuam disponíveis para conferência.</p>
   <label className="f8-search"><span>Buscar pelo nome do documento</span>
    <input type="search" aria-label="Buscar arquivos pelo nome" maxLength={100}
     placeholder="Ex.: edital, boleto, comprovante…" value={query}
     onChange={e=>setQuery(e.target.value)}/></label>
   {!loading&&shown.length===0?<EmptyState title="Nenhum arquivo encontrado"
    message="Confira a busca ou anexe um documento ao registro correspondente."/>:
    <div className="f8-file-grid">{shown.map(x=><button key={x.id}
     type="button" className="f8-file" onClick={()=>openDocument(x.id)}>
      <span className="f8-file-icon"><FileArchive size={25} aria-hidden="true"/></span>
      <span className="f8-file-info"><strong>{x.titulo||"Documento sem nome"}</strong>
       <small>{docRole(x.tipo)} · {mimeName(x.mime_type)} · {sizeText(x.tamanho_bytes)}</small>
       <small>Versão {x.numero_versao||"?"} · {status(x)}</small></span>
     </button>)}</div>}
   {cursor&&!preview&&<Button variant="secondary" disabled={loading}
    onClick={()=>void loadLibrary(cursor)}>Carregar mais arquivos</Button>}
  </Card>}
  {!selected&&tab==="add"&&<Card className="f8-section">
   <SectionHeading eyebrow="Três passos" title="Adicionar um arquivo"/>
   <p className="f8-help">Em vez de jogar arquivos numa pasta solta, ligamos cada documento
    ao processo correto. Assim fica fácil encontrá-lo depois.</p>
   <form className="f8-form" onSubmit={e=>void upload(e)}>
    <div className="f8-step"><h3><span>1</span> Sobre o que é o documento?</h3>
     <div className="f8-form-grid">
      <label><span>Área do sistema</span><select aria-label="Área do documento" value={kind}
       onChange={e=>chooseType(e.target.value as OwnerType)}>
       {ownerTypes.map(type=><option value={type} key={type}>{ownerInfo[type].name}</option>)}
      </select></label>
      <label><span>Selecione o registro</span><select aria-label="Registro associado ao documento"
       value={chosenOwner} onChange={e=>setOwner(e.target.value)} disabled={!ownerChoices.length}>
       {!ownerChoices.length&&<option value="">Nenhum registro encontrado</option>}
       {ownerChoices.map(o=><option value={o.id} key={o.id}>{o.label}</option>)}
      </select></label>
     </div>
     {!ownerChoices.length&&<p className="f8-tip">Cadastre primeiro o processo ou a conta
      correspondente. Não podemos anexar um documento sem dono.</p>}
    </div>
    <div className="f8-step"><h3><span>2</span> Que tipo de documento é?</h3>
     <label><span>Classificação</span><select aria-label="Classificação do documento" value={role}
      onChange={e=>{setRole(e.target.value);setRetention(false);}}>
      {roleChoices.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
     {kind==="conta_receber"&&<label className="f8-check">
      <input type="checkbox" checked={isRetention} onChange={e=>setRetention(e.target.checked)}/>
      <span>Este é um <strong>comprovante de imposto retido</strong>, não um depósito em conta.</span>
     </label>}
    </div>
    <div className="f8-step"><h3><span>3</span> Escolha o arquivo</h3>
     <label><span>Arquivo (PDF, XML, JPG, PNG ou TXT; até 8 MB)</span>
      <input type="file" aria-label="Arquivo para anexar" accept=".pdf,.xml,.jpg,.jpeg,.png,.txt"
       onChange={e=>{setFile(e.target.files?.[0]||null);clearIntent();clearResult();}}/>
     </label>
     {file&&<div className="f8-chosen">
      <FileCheck2 size={20}/><div><strong>{file.name}</strong>
       <small>{sizeText(file.size)} · será salvo como {safeFilename(file.name)}</small>
       {fileError(file)&&<small className="f8-error">{fileError(file)}</small>}</div></div>}
     <p className="f8-tip">Antes de confirmar, confira se escolheu o registro e o tipo corretos.
      O arquivo será validado por tamanho e SHA-256. Não é possível substituí-lo silenciosamente.</p>
    </div>
    <Button type="submit" disabled={!canWrite||!chosenOwner||!file||!!fileError(file)||busy}>
     <UploadCloud size={17}/>{busy?"Conferindo arquivo…":"Guardar documento"}</Button>
   </form>
  </Card>}
  {selected&&<><Button variant="secondary" onClick={back}>
   <ArrowLeft size={16}/>Voltar à biblioteca</Button>
   {detail&&<><Card className="f8-section">
    <SectionHeading eyebrow="Ficha do documento" title={detail.item.titulo||"Documento sem nome"}>
     <Badge tone={detail.item.estado_integridade==="VERIFICADO"?"success":"warning"}>
      {status(detail.item)}</Badge></SectionHeading>
    <div className="f8-facts">
     <span><strong>Categoria:</strong> {docRole(detail.item.tipo)}</span>
     <span><strong>Versão mais nova:</strong> {detail.item.numero_versao||"não informada"}</span>
     <span><strong>Proteção:</strong> {detail.item.conferencia==="VALIDADO"?"Conferido":"Precisa de revisão"}</span>
    </div>
    <Notice title="Arquivo protegido">
     O arquivo não tem link público. Cada download é autorizado para esta empresa
     e os bytes são conferidos pelo hash de integridade antes da entrega.</Notice>
   </Card>
   <Card className="f8-section">
    <SectionHeading eyebrow="Histórico preservado" title="Versões do arquivo"/>
    <div className="f8-version-list">{detail.versions.map(v=><article key={v.id} className="f8-version">
     <div><strong>Versão {v.numero_versao} {v.id===detail.item.versao_corrente_id&&
       <Badge tone="success">Atual</Badge>}</strong>
      <p>{v.nome_original||"Arquivo sem título"}</p>
      <small>{mimeName(v.mime_type)} · {sizeText(v.tamanho_bytes)} · {dateLabel(v.criado_em)}</small>
      <small><ShieldCheck size={14}/> Integridade: {v.estado_integridade} ·
       {v.locations.some(l=>l.provedor==="R2"&&l.status==="VERIFICADO")?
        " Cópia local verificada":" Cópia local pendente"}</small></div>
     <div className="f8-version-actions">
      <Button variant="secondary" disabled={busy||v.estado_integridade!=="VERIFICADO"}
       onClick={()=>void download(v)}><Download size={15}/>Baixar versão</Button>
      {admin&&<Button variant="secondary" disabled={busy} onClick={()=>void archiveReview(v)}>
       <Archive size={15}/>Conferir guarda</Button>}</div>
    </article>)}</div>
   </Card>
   {archive&&<Card className="f8-section"><SectionHeading eyebrow="Política de guarda"
    title="Quando este documento poderá ir para arquivo?"/>
    <Notice title="Conferência administrativa, não autorização de exclusão">
     O processo deve estar encerrado há pelo menos 24 meses, sem dívida ou restrição,
     com cópia Drive verificada, backup independente restaurado e 30 dias de sobreposição.
     O arquivo original do R2 não será excluído automaticamente.</Notice>
    {archive.reasons.length>0?<ul className="f8-archive-reasons">{archive.reasons.map(code=>
     <li key={code}><Info size={17}/>{explainReason(code)}</li>)}</ul>:
     <p>Dados locais suficientes para análise humana. Ainda não há autorização
      para apagar o arquivo no R2 ou alegar que o backup externo foi testado.</p>}
    <Badge tone="warning">Exclusão do R2 desativada</Badge>
   </Card>}
   {canWrite&&<Card className="f8-section">
    <SectionHeading eyebrow="Substituição sem apagar o passado" title="Enviar versão atualizada"/>
    <p className="f8-help">Se o documento mudou, anexe uma nova versão.
     Todas as versões anteriores continuam no histórico e cada uma tem seu próprio hash.</p>
    <form className="f8-form" onSubmit={e=>void newVersion(e)}>
     <label><span>Novo arquivo (até 8 MB)</span><input type="file" aria-label="Nova versão do documento"
      accept=".pdf,.xml,.jpg,.jpeg,.png,.txt"
      onChange={e=>{setReplacement(e.target.files?.[0]||null);clearIntent();clearResult();}}/></label>
     {replacement&&<p className="f8-tip">{replacement.name} · {sizeText(replacement.size)}.
      {fileError(replacement)||" O histórico anterior será preservado."}</p>}
     <Button type="submit" disabled={!replacement||!!fileError(replacement)||busy}>
      <FilePlus2 size={16}/>{busy?"Conferindo…":"Salvar nova versão"}</Button>
    </form>
   </Card>}
   </>}
  </>}
  <Card className="f8-section f8-explain"><SectionHeading eyebrow="O que você precisa saber"
   title="Arquivos seguros sem linguagem técnica"/>
   <details><summary>Posso apagar um arquivo antigo para liberar espaço?</summary>
    <p>Não nesta fase. A segurança vem primeiro: a política exige 24 meses após o
     encerramento, nenhum compromisso pendente, cópia verificada, backup independente
     restaurado e mais 30 dias de sobreposição. Não há exclusão R2 disponível.</p></details>
   <details><summary>O arquivo já foi para o Google Drive?</summary>
    <p>Não confunda o planejamento com uma transferência. A F8 tem contrato de
     integração local e painel de conferência, mas não houve ligação ao Drive real.</p></details>
   <details><summary>Como uso um comprovante de retenção?</summary>
    <p>Na área de parcelas a receber, anexe um comprovante de imposto retido.
     Com versão e integridade verificadas, um ADMIN poderá atestar a retenção
     no financeiro. Ela não vira dinheiro depositado no banco.</p></details>
   <details><summary>Por que guardar versões?</summary>
    <p>Uma alteração não deve apagar o documento que foi utilizado antes.
     O sistema guarda histórico, data, tamanho e conferência de integridade.</p></details>
  </Card>
 </div>;
}
