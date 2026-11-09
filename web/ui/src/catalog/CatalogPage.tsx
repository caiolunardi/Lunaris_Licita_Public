import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {Archive,ArrowRight,Building2,ChevronRight,ClipboardList,Edit3,Plus,RefreshCcw,Search,ShieldAlert,Truck,Undo2} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {blankForm,demoCatalog,toForm,type CatalogForm,type CatalogItem,type CatalogProps} from "./types";

const labels={
  orgaos:{title:"Órgãos",singular:"órgão",description:"Organize as instituições participantes e os dados de contato.",icon:Building2},
  fornecedores:{title:"Fornecedores",singular:"fornecedor",description:"Centralize os parceiros de fornecimento e suas informações.",icon:Truck}
} as const;
const validItem=(o:unknown):o is CatalogItem=>{
  if(!o||typeof o!=="object")return false;
  const i=o as Partial<CatalogItem>;
  return typeof i.id==="string"&&typeof i.nome==="string"&&
    typeof i.versao==="number"&&(i.ativo===0||i.ativo===1)&&
    (i.origem_dado==="NATIVO"||i.origem_dado==="LEGADO");
};
const messageFor=(status:number)=>{
  if(status===401)return "Sua sessão expirou ou foi revogada. Valide a identidade novamente.";
  if(status===403)return "Seu perfil não tem autorização para esta empresa ou ação.";
  if(status===409)return "Registro alterado, duplicado ou em conflito. Recarregue antes de editar novamente.";
  if(status===400||status===415)return "Dados inválidos. Revise os campos e tente novamente.";
  return "Serviço não disponível. O resultado de eventual gravação é incerto; reconsulte antes de repetir.";
};
const sourceNotice="Dados demonstrativos: nada é enviado ao servidor, armazenado ou persistido.";
const onlyFields=(kind:CatalogProps["kind"],d:CatalogForm)=>{
  const common={nome:d.nome,cnpj:d.cnpj||null,contato:d.contato||null,
    email:d.email||null,telefone:d.telefone||null,observacoes:d.observacoes||null};
  return kind==="orgaos"?{...common,uasg:d.uasg||null,endereco_entrega_padrao:d.endereco_entrega_padrao||null}:common;
};
const validQuery=(value:string)=>value.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase("pt-BR").trim();
function Field({label,value,onChange,required=false,maxLength=180,wide=false,type="text"}:{
  label:string;value:string;onChange:(v:string)=>void;required?:boolean;maxLength?:number;wide?:boolean;type?:string;
}){
  return <label className={`form-field ${wide?"catalog-field-wide":""}`}>{label}
    <input value={value} onChange={e=>onChange(e.target.value)} type={type}
      autoComplete="off" required={required} maxLength={maxLength} placeholder={required?"Obrigatório":"Opcional"}/>
  </label>;
}
export default function CatalogPage({kind,identity,onIdentity}:CatalogProps){
  const info=labels[kind],company=identity.active;
  const demo=identity.source==="fixture"&&identity.stage==="preview"&&company!==null;
  const live=identity.source==="server"&&identity.stage==="verified"&&company!==null;
  const canWrite=Boolean(company?.permissions.canWrite);
  const [items,setItems]=useState<CatalogItem[]>(()=>demoCatalog(kind,company?.id||""));
  const [query,setQuery]=useState("");
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState<"active"|"inactive"|"all">("active");
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [moreLoading,setMoreLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [flash,setFlash]=useState<string|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [editor,setEditor]=useState<{id:string|null;versao:number}|null>(null);
  const [draft,setDraft]=useState<CatalogForm>(blankForm);
  const [saving,setSaving]=useState(false);
  const [confirm,setConfirm]=useState<CatalogItem|null>(null);
  const [details,setDetails]=useState<CatalogItem|null>(null);
  const [detailBusy,setDetailBusy]=useState(false);
  const abort=useRef<AbortController|null>(null);
  const saveIntent=useRef<string|null>(null);
  const listGeneration=useRef(0);
  const urlBase=company?`/api/v1/companies/${encodeURIComponent(company.id)}/${kind}`:"";
  useEffect(()=>{
    const t=setTimeout(()=>setSearch(query.trim().slice(0,80)),230);
    return ()=>clearTimeout(t);
  },[query]);
  const load=useCallback(async(after:string|null=null)=>{
    if(!live||!urlBase)return;
    const generation=++listGeneration.current;
    abort.current?.abort();
    const ctrl=new AbortController();abort.current=ctrl;
    if(after){setMoreLoading(true);}else{setLoading(true);setItems([]);setNextCursor(null);}
    setError(null);
    try{
      const params=new URLSearchParams({limit:"25",state:status});
      if(search)params.set("q",search);
      if(after)params.set("after",after);
      const res=await fetch(urlBase+"?"+params,{
        method:"GET",credentials:"same-origin",cache:"no-store",signal:ctrl.signal,
        headers:{accept:"application/json"}
      });
      if(!res.ok)throw Object.assign(new Error("list_request_failed"),{status:res.status});
      const body=await res.json() as {items:unknown;nextCursor:unknown;limit:number};
      if(!Array.isArray(body.items)||body.items.length>25||!body.items.every(validItem)||
        (body.nextCursor!==null&&typeof body.nextCursor!=="string"))
        throw new Error("invalid_list_contract");
      if(generation!==listGeneration.current)return;
      setItems(previous=>after?[...previous,...body.items as CatalogItem[]]:body.items as CatalogItem[]);
      setNextCursor(body.nextCursor);
    }catch(e){
      if(generation!==listGeneration.current||ctrl.signal.aborted)return;
      setError(messageFor(typeof (e as {status?:number})?.status==="number"?(e as {status:number}).status:503));
    }finally{
      if(generation===listGeneration.current){setLoading(false);setMoreLoading(false);}
    }
  },[live,urlBase,search,status]);
  useEffect(()=>{
    if(live){void load();}
    return ()=>{listGeneration.current++;abort.current?.abort();};
  },[live,load,refresh]);
  const demoVisible=demo?items.filter(row=>
    (status==="all"||(status==="active"?row.ativo===1:row.ativo===0))&&
    validQuery(row.nome).startsWith(validQuery(search))
  ).sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR")):[];
  const visible=demo?demoVisible:items;
  function startNew(){
    setEditor({id:null,versao:0});setDraft(blankForm());setConfirm(null);setDetails(null);
    saveIntent.current=null;setError(null);setFlash(null);
  }
  function startEdit(item:CatalogItem){
    if(item.origem_dado!=="NATIVO"||item.ativo!==1||!canWrite)return;
    setEditor({id:item.id,versao:item.versao});setDraft(toForm(item));
    setDetails(null);setConfirm(null);saveIntent.current=null;setError(null);setFlash(null);
  }
  function cancelEdit(){setEditor(null);saveIntent.current=null;setSaving(false);}
  async function view(item:CatalogItem){
    if(demo){setDetails(item);return;}
    if(!live||!urlBase)return;
    setDetailBusy(true);setDetails(null);setError(null);
    try{
      const r=await fetch(urlBase+"/"+encodeURIComponent(item.id),{credentials:"same-origin",cache:"no-store"});
      if(!r.ok)throw Object.assign(new Error("detail"),{status:r.status});
      const body=await r.json() as {item:unknown};
      if(!validItem(body.item))throw new Error("detail_contract");
      setDetails(body.item);
    }catch(e){setError(messageFor((e as {status?:number}).status||503));}
    finally{setDetailBusy(false);}
  }
  function editField(k:keyof CatalogForm,value:string){setDraft(old=>({...old,[k]:value}));}
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!company||!editor||!canWrite||saving)return;
    if(!draft.nome.trim()){setError("Informe o nome do cadastro.");return;}
    setSaving(true);setError(null);setFlash(null);
    const intentId=saveIntent.current??crypto.randomUUID();
    saveIntent.current=intentId;
    if(demo){
      const payload=onlyFields(kind,draft);
      if(editor.id===null){
        setItems(prev=>[...prev,{
          ...payload,id:"f2-demo-"+crypto.randomUUID(),versao:1,ativo:1,
          origem_dado:"NATIVO",conferencia:"VALIDADO",...(kind==="orgaos"?{}:{})
        } as CatalogItem]);
      }else{
        setItems(prev=>prev.map(row=>row.id===editor.id?{...row,...payload,versao:row.versao+1}:row));
      }
      setEditor(null);setFlash("Alteração simulada na memória. Nenhum registro foi gravado.");setSaving(false);saveIntent.current=null;
      return;
    }
    try{
      const method=editor.id?"PATCH":"POST";
      const path=urlBase+(editor.id?"/"+encodeURIComponent(editor.id):"");
      const payload={intentId,...onlyFields(kind,draft),...(editor.id?{expectedVersion:editor.versao}:{})};
      const res=await fetch(path,{
        method,credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json","accept":"application/json"},
        body:JSON.stringify(payload)
      });
      if(!res.ok)throw Object.assign(new Error("save_failed"),{status:res.status});
      const result=await res.json() as {replayed?:boolean;intentId?:string};
      if(result.intentId!==intentId)throw new Error("write_response_mismatch");
      setEditor(null);saveIntent.current=null;
      setFlash(result.replayed?"Operação já registrada; lista atualizada.":"Cadastro salvo com auditoria e versão.");
      setRefresh(n=>n+1);
    }catch(e){setError(messageFor((e as {status?:number}).status||503));}
    finally{setSaving(false);}
  }
  async function deactivate(){
    if(!confirm||!company||!canWrite||saving)return;
    const item=confirm;
    setConfirm(null);setError(null);setFlash(null);setSaving(true);
    if(demo){
      setItems(old=>old.map(row=>row.id===item.id?{...row,ativo:0,versao:row.versao+1}:row));
      setFlash("Desativação simulada. Dados só na memória.");setSaving(false);return;
    }
    try{
      const intentId=crypto.randomUUID();
      const res=await fetch(urlBase+"/"+encodeURIComponent(item.id),{
        method:"PATCH",credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json","accept":"application/json"},
        body:JSON.stringify({intentId,expectedVersion:item.versao,ativo:false})
      });
      if(!res.ok)throw Object.assign(new Error("deactivation_failed"),{status:res.status});
      const data=await res.json() as {intentId?:string};
      if(data.intentId!==intentId)throw new Error("deactivation_unknown");
      setFlash("Cadastro desativado, sem exclusão do histórico.");setRefresh(n=>n+1);
    }catch(e){setError(messageFor((e as {status?:number}).status||503));}
    finally{setSaving(false);}
  }

  return <div className="catalog-page">
    <div className="page-intro"><div><p className="eyebrow">F2 · Base de cadastros</p><h1>{info.title}</h1>
      <p>{info.description}</p></div><span className="intro-decoration"><info.icon size={34}/></span></div>
    <Notice title={demo?"Demonstração sem persistência":live?"Operação local de laboratório":"Acesso protegido"}>
      {demo?sourceNotice:live?"Identidade e empresa conferidas pelo Worker/D1 local. Produção e HML permanecem bloqueadas.":"Abra Identidade e acesso, valide sua sessão e selecione uma empresa autorizada antes de consultar cadastros."}
    </Notice>
    {!company||!(demo||live)?
      <Card className="catalog-locked"><ShieldAlert size={28} aria-hidden="true"/><h2>Nenhuma empresa autorizada ativa</h2><p>Os registros não são carregados fora de um contexto permitido. Você pode abrir uma simulação claramente fictícia na tela de identidade.</p>
        <Button onClick={onIdentity}>Ir para identidade e acesso <ArrowRight size={16}/></Button>
      </Card>:
      <>
      <div className="catalog-company-context"><span className="catalog-company-icon"><info.icon size={21}/></span>
        <div><span>Empresa selecionada</span><strong>{company.name}</strong><small>Perfil: {company.role==="CONSULTA"?"Consulta":company.role==="ADMIN"?"Administrador":"Operador"} · {demo?"simulação":"D1 local"}</small></div>
        <Badge tone={demo?"warning":"info"}>{demo?"Fictício":"Acesso conferido"}</Badge>
        <Button variant="ghost" onClick={onIdentity}>Trocar empresa <ChevronRight size={16}/></Button>
      </div>
      <Card className="catalog-list">
        <SectionHeading eyebrow="Registros por empresa" title={`Gerenciar ${info.title.toLocaleLowerCase("pt-BR")}`}>
          <Button disabled={!canWrite||saving} onClick={startNew}><Plus size={16}/> Novo {info.singular}</Button>
        </SectionHeading>
        <div className="catalog-toolbar">
          <label className="search-field"><Search size={17} aria-hidden="true"/><span className="sr-only">Buscar {info.title.toLocaleLowerCase("pt-BR")}</span>
            <input aria-label={`Buscar ${info.title.toLocaleLowerCase("pt-BR")}`} value={query} onChange={e=>setQuery(e.target.value)}
              maxLength={80} placeholder="Buscar pelo começo do nome"/></label>
          <label className="catalog-filter">Situação
            <select value={status} onChange={e=>setStatus(e.target.value as typeof status)}>
              <option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option>
            </select></label>
          <Button variant="ghost" disabled={loading} onClick={()=>demo?setFlash("Lista de demonstração conferida."):setRefresh(n=>n+1)}>
            <RefreshCcw size={16}/> Atualizar</Button>
        </div>
        {flash&&<p role="status" className="catalog-feedback catalog-feedback--good">{flash}</p>}
        {error&&<p role="alert" className="catalog-feedback">{error}</p>}
        {loading?<Skeleton lines={5}/>:
          visible.length===0?<EmptyState title="Nenhum cadastro encontrado" message="Altere o filtro ou registre um novo cadastro autorizado."/>:
          <div className="table-scroll"><table className="catalog-table"><thead><tr>
            <th>Nome</th><th>Documento</th><th>Estado</th><th>Versão</th><th>Ações</th></tr></thead>
            <tbody>{visible.map(item=><tr key={item.id}>
              <td className="strong-cell">{item.nome}<span className="catalog-subtext">{item.contato||"Sem contato informado"}</span></td>
              <td>{item.cnpj||"—"}</td>
              <td><Badge tone={item.ativo===1?"success":"neutral"}>{item.ativo===1?"Ativo":"Inativo"}</Badge>
                {item.origem_dado==="LEGADO"&&<span className="catalog-subtext">Histórico protegido</span>}</td>
              <td className="mono">{item.versao}</td>
              <td><div className="catalog-actions">
                <Button variant="ghost" onClick={()=>void view(item)}>Ficha</Button>
                <Button variant="secondary" disabled={!canWrite||item.ativo!==1||item.origem_dado!=="NATIVO"||saving} onClick={()=>startEdit(item)}><Edit3 size={14}/> Editar</Button>
                <Button variant="ghost" disabled={!canWrite||item.ativo!==1||item.origem_dado!=="NATIVO"||saving} onClick={()=>{setConfirm(item);setEditor(null);setDetails(null);}}>Desativar</Button>
              </div></td>
            </tr>)}</tbody></table></div>}
        {nextCursor&&!demo&&<div className="catalog-pager"><Button variant="secondary" disabled={moreLoading} onClick={()=>void load(nextCursor)}>{moreLoading?"Carregando…":"Carregar mais"}</Button></div>}
        <p className="catalog-caption">Exibindo {visible.length} registro(s) nesta consulta. Busca por prefixo; paginação limitada a 25 itens por chamada.</p>
      </Card>
      {detailBusy&&<Card role="status"><Skeleton lines={3}/></Card>}
      {details&&!editor&&<Card className="catalog-details">
        <SectionHeading eyebrow="Ficha cadastral" title={details.nome}>
          <Button variant="ghost" onClick={()=>setDetails(null)}>Fechar ficha</Button>
        </SectionHeading>
        <div className="catalog-detail-grid">
          <div><small>CNPJ</small><strong>{details.cnpj||"Não informado"}</strong></div>
          <div><small>E-mail</small><strong>{details.email||"Não informado"}</strong></div>
          <div><small>Contato</small><strong>{details.contato||"Não informado"}</strong></div>
          <div><small>Telefone</small><strong>{details.telefone||"Não informado"}</strong></div>
          {kind==="orgaos"&&<>
            <div><small>UASG</small><strong>{details.uasg||"Não informada"}</strong></div>
            <div><small>Endereço de entrega</small><strong>{details.endereco_entrega_padrao||"Não informado"}</strong></div>
          </>}
          <div><small>Origem e conferência</small><strong>{details.origem_dado} · {details.conferencia||"Pendente"}</strong></div>
          <div><small>Versão</small><strong>{details.versao}</strong></div>
        </div>
        <div className="catalog-detail-note"><ClipboardList size={16}/> {details.observacoes||"Sem observações adicionais."}</div>
      </Card>}
      {confirm&&<Card className="catalog-confirm" role="alertdialog" aria-modal="false" aria-labelledby="catalog-confirm-title">
        <SectionHeading eyebrow="Confirmação necessária" title="Desativar cadastro?"/>
        <p id="catalog-confirm-title"><strong>{confirm.nome}</strong> deixará de aparecer entre os cadastros ativos. O histórico será preservado; não haverá exclusão física.</p>
        <div className="catalog-action-row"><Button variant="secondary" onClick={()=>setConfirm(null)}><Undo2 size={16}/> Cancelar</Button>
          <Button disabled={saving} onClick={()=>void deactivate()}><Archive size={16}/> Confirmar desativação</Button></div>
      </Card>}
      {editor&&<Card className="catalog-form-panel">
        <SectionHeading eyebrow={editor.id?"Edição controlada por versão":"Novo cadastro"} title={editor.id?`Editar ${info.singular}`:`Cadastrar ${info.singular}`}>
          <Button variant="ghost" disabled={saving} onClick={cancelEdit}>Cancelar</Button>
        </SectionHeading>
        <p className="catalog-help">Campos com asterisco são obrigatórios. {demo?"Nesta simulação as alterações não são gravadas.":"Toda gravação real exige autorização do Worker e gera trilha de auditoria."}</p>
        <form onSubmit={e=>void save(e)} className="catalog-form">
          <Field label="Nome *" value={draft.nome} onChange={v=>editField("nome",v)} required/>
          <Field label="CNPJ" value={draft.cnpj} onChange={v=>editField("cnpj",v)} maxLength={25}/>
          {kind==="orgaos"&&<Field label="UASG" value={draft.uasg} onChange={v=>editField("uasg",v)} maxLength={40}/>}
          <Field label="Contato" value={draft.contato} onChange={v=>editField("contato",v)} maxLength={140}/>
          <Field label="E-mail" type="email" value={draft.email} onChange={v=>editField("email",v)} maxLength={254}/>
          <Field label="Telefone" value={draft.telefone} onChange={v=>editField("telefone",v)} maxLength={35}/>
          {kind==="orgaos"&&<Field label="Endereço de entrega padrão" value={draft.endereco_entrega_padrao} onChange={v=>editField("endereco_entrega_padrao",v)} maxLength={700} wide/>}
          <label className="form-field catalog-field-wide">Observações
            <textarea value={draft.observacoes} maxLength={2400} rows={3}
              onChange={e=>editField("observacoes",e.target.value)} placeholder="Opcional"/></label>
          <div className="catalog-submit">
            <span>{editor.id?`Versão esperada: ${editor.versao}`:"Identificação gerada no servidor"}</span>
            <Button disabled={saving||!canWrite} type="submit">{saving?"Salvando…":"Salvar cadastro"} <ArrowRight size={16}/></Button>
          </div>
        </form>
      </Card>}
      </>}
  </div>;
}
