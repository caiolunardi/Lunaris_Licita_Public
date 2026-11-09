import {useEffect,useRef,useState,type FormEvent} from "react";
import {ArrowUp,BookOpen,LockKeyhole,MessageCircle,ShieldCheck,Sparkles,X} from "lucide-react";
import {Badge,Button,IconButton} from "./UI";
import type {IdentityState} from "../identity/session";
import {demoAnswer,examples,safeLinks,validateReply,type GabiReply,type Message} from "../gabi/client";
export default function GabiPanel({onClose,identity,onIdentity}:{
 onClose:()=>void;identity:IdentityState;onIdentity:()=>void;
}){
 const active=identity.active,verified=identity.stage==="verified"&&identity.source==="server";
 const demo=identity.stage==="preview"&&identity.source==="fixture"&&!!active;
 const [messages,setMessages]=useState<Message[]>([]),[question,setQuestion]=useState(""),
  [sending,setSending]=useState(false),[notice,setNotice]=useState<string|null>(null);
 const controller=useRef<AbortController|null>(null),view=useRef<HTMLDivElement|null>(null);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return ()=>{
  mounted.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{view.current?.scrollTo?.({top:view.current.scrollHeight,behavior:"smooth"});},[messages]);
 const ask=async(value:string)=>{
  const q=value.trim();
  if(!q||q.length>400||sending||messages.length>=12)return;
  setNotice(null);setSending(true);setQuestion("");
  setMessages(prev=>[...prev,{id:crypto.randomUUID(),person:"user",text:q,source:null}]);
  try{
   let answer:GabiReply;
   if(demo)answer=demoAnswer(q);
   else if(verified&&active){
    const abort=new AbortController();controller.current=abort;
    const result=await fetch("/api/v1/companies/"+encodeURIComponent(active.id)+"/gabi/ask",{
     method:"POST",credentials:"same-origin",cache:"no-store",signal:abort.signal,
     headers:{"content-type":"application/json",accept:"application/json"},
     body:JSON.stringify({question:q})});
    if(!result.ok)throw new Error(result.status===503?
     "O assistente conectado ainda está desativado; utilize a demonstração na tela de identidade.":
     result.status===403?"Sua conta não pode consultar estes registros.":
     "Não foi possível completar a consulta autorizada.");
    const raw=await result.json();
    if(!validateReply(raw))throw new Error("Resposta incompleta do servidor. Nenhum dado foi apresentado.");
    answer=raw;
   }else throw new Error("Escolha uma empresa de demonstração antes de conversar.");
   if(!mounted.current)return;
   setMessages(prev=>[...prev,{id:crypto.randomUUID(),person:"gabi",text:answer.reply,source:answer}]);
  }catch(e){
   if(mounted.current)setNotice(e instanceof Error?e.message:"Não foi possível consultar.");
  }finally{if(mounted.current)setSending(false);}
 };
 const submit=(event:FormEvent)=>{event.preventDefault();void ask(question);};
 return <aside className="gabi-panel gabi-chat" role="dialog" aria-modal="false" aria-labelledby="gabi-title">
  <header className="gabi-panel__header"><div className="gabi-orb" aria-hidden="true">G</div>
   <div><strong id="gabi-title">Gabi</strong><p>Assistente Lunaris · somente leitura</p></div>
   <IconButton label="Fechar Gabi" onClick={onClose}><X size={19}/></IconButton></header>
  <div className="gabi-chat__state"><Badge tone={demo?"info":"warning"}>
   {demo?"Demonstração fictícia":verified&&active?"Consulta protegida":"Sem IA conectada"}</Badge>
   <span><ShieldCheck size={14} aria-hidden="true"/> Nunca executa pagamentos ou alterações</span></div>
  <div className="gabi-chat__messages" ref={view} aria-label="Conversa com a Gabi">
   {messages.length===0&&<div className="gabi-chat__intro">
    <Sparkles size={26} aria-hidden="true"/>
    <h2>Como posso ajudar?</h2>
    <p>Posso explicar funcionalidades e consultar apenas informações autorizadas.
     Escolha uma pergunta para começar.</p>
    {!demo&&!verified&&<div className="gabi-chat__blocked">
     <LockKeyhole size={16}/>Sem IA conectada. Acesse Identidade e acesso e
     selecione uma empresa de demonstração para experimentar.</div>}
    {verified&&active&&<div className="gabi-chat__blocked">
     <LockKeyhole size={16}/>Dados reais só serão consultados quando
     a integração auditada estiver disponível.</div>}
    {(demo||verified&&active)&&<div className="gabi-chat__prompts">
     {examples.map(x=><button type="button" key={x} disabled={sending}
      onClick={()=>void ask(x)}>{x}</button>)}</div>}
    {!demo&&!verified&&<Button variant="secondary" onClick={()=>{onClose();onIdentity();}}>
     Selecionar empresa</Button>}
   </div>}
   {messages.map(m=><div className={"gabi-chat__message gabi-chat__message--"+m.person} key={m.id}>
    <span>{m.person==="user"?"Você":"Gabi"}</span>
    <p>{m.text}</p>
    {m.source&&<div className="gabi-chat__evidence">
     {m.source.sources.length>0&&<div className="gabi-chat__links">
      {m.source.sources.filter(s=>safeLinks.has(s.url)).map((x,i)=>
       <a key={i} href={x.url}><BookOpen size={13} aria-hidden="true"/>
        {x.label.length>85?x.label.slice(0,85)+"…":x.label}</a>)}</div>}
     <small>{m.source.mode==="preview"?"Exemplos sem dados reais":
      m.source.mode==="gemini_explanation"?"Explicação Gemini · verifique as fontes":
      "Consulta determinística · sem IA externa"} · somente leitura</small>
    </div>}
   </div>)}
   {sending&&<p className="gabi-chat__typing" role="status"><MessageCircle size={16}/>
    Conferindo permissão e registros…</p>}
   {notice&&<div className="gabi-chat__error" role="alert">{notice}</div>}
  </div>
  <form className="gabi-chat__form" onSubmit={submit}>
   <label htmlFor="gabi-query">Sua pergunta</label>
   <div><textarea id="gabi-query" aria-label="Sua pergunta para a Gabi" rows={2}
    maxLength={400} placeholder={demo||verified?"Escreva uma pergunta sobre sua operação…":
     "Selecione uma empresa para habilitar a conversa"} disabled={!demo&&!verified||sending||
     messages.length>=12} value={question}
    onChange={e=>setQuestion(e.target.value)}
    onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();
     if(question.trim())void ask(question);}}}/>
    <button type="submit" aria-label="Enviar pergunta à Gabi"
     disabled={!question.trim()||sending||(!demo&&!verified)||messages.length>=12}>
     <ArrowUp size={20}/></button></div>
   <small>{messages.length>=12?"Limite de conversa atingido. Feche e reabra para continuar.":
    "Sem histórico salvo. Chave Gemini nunca fica no navegador."}</small>
  </form>
 </aside>;
}
