import {useDeferredValue,useState} from "react";
import {BookOpen,Search} from "lucide-react";
import {Button,Card,EmptyState,Notice} from "../components/UI";
import {helpTopics} from "./help";
export default function HelpTool(){
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("Tudo");
 const deferred=useDeferredValue(query.trim().toLocaleLowerCase("pt-BR"));
 const areas=["Tudo",...new Set(helpTopics.map(t=>t.area))];
 const topics=helpTopics.filter(x=>(filter==="Tudo"||x.area===filter)&&
  [x.title,x.intro,x.area,...x.steps].some(v=>
    v.toLocaleLowerCase("pt-BR").includes(deferred)));
 return <div className="f9-page">
  <div className="page-intro"><div><p className="eyebrow">F9 · Orientações</p>
   <h1>Central de ajuda.</h1><p>Encontre respostas claras, sem precisar conhecer termos técnicos.</p></div>
   <BookOpen size={35} aria-hidden="true"/></div>
  <Notice title="Ajuda do sistema, sem IA ligada">
   Este conteúdo foi escrito e versionado para orientar a navegação.
   Ele não envia informações a terceiros, não executa operações e não altera dados.</Notice>
  <Card className="f9-card"><label className="f9-search">
   <span>O que você precisa fazer?</span><div><Search size={18} aria-hidden="true"/>
   <input type="search" aria-label="Buscar na ajuda" maxLength={120}
    placeholder="Ex.: recebi um pagamento, boleto, edital…" value={query}
    onChange={e=>setQuery(e.target.value)}/></div></label>
   <div className="f9-filters" aria-label="Temas de ajuda">{areas.map(area=>
    <Button key={area} variant={area===filter?"primary":"secondary"} type="button"
     onClick={()=>setFilter(area)}>{area}</Button>)}</div>
  </Card>
  <div className="f9-help-list">{topics.length===0?
   <Card><EmptyState title="Nenhum tópico encontrado"
    message="Tente buscar por conta, documento, recebimento ou permissão."/></Card>:
   topics.map(t=><Card key={t.id} className="f9-card">
    <p className="eyebrow">{t.area}</p>
    <details className="f9-help-detail">
     <summary>{t.title}</summary>
     <p>{t.intro}</p><ol>{t.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>
     <a className="f9-link" href={t.url}>{t.button}</a>
    </details></Card>)}</div>
 </div>;
}
