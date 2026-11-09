import {useCallback,useEffect,useState} from "react";
import {CheckCircle2,Settings2,ShieldCheck} from "lucide-react";
import {Badge,Button,Card,Notice,SectionHeading,Skeleton} from "../components/UI";
import {apiGet,apiSend,baseUrl,newIntent} from "./api";
import type {Setting,ToolsProps} from "./types";
export default function SettingsTool({identity}:ToolsProps){
 const admin=!!identity.active?.permissions.canApprove,
  verified=identity.stage==="verified"&&identity.source==="server";
 const root=baseUrl(identity.active?.id||"")+"/settings";
 const [items,setItems]=useState<Setting[]>([]),[tips,setTips]=useState("true"),
  [days,setDays]=useState("7"),[busy,setBusy]=useState(false),
  [error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
 const load=useCallback(async()=>{
  if(!admin||!verified)return;
  setBusy(true);setError(null);
  try{const result=await apiGet<{items:Setting[];defaults:Record<string,string>}>(root);
   if(!Array.isArray(result.items)||result.items.length>2)throw Error("Preferências incompletas.");
   setItems(result.items);
   setTips(result.items.find(x=>x.chave==="exibir_dicas_iniciantes")?.valor_texto||"true");
   setDays(result.items.find(x=>x.chave==="alertas_dias_antecedencia")?.valor_texto||"7");
  }catch(e){setError(e instanceof Error?e.message:"Configurações indisponíveis.");}
  finally{setBusy(false);}
 },[admin,verified,root]);
 useEffect(()=>{void load();},[load]);
 async function save(key:string,value:string){
  if(busy||!admin||!verified)return;
  setBusy(true);setError(null);setMessage(null);
  try{const previous=items.find(x=>x.chave===key);
   const out=await apiSend<{key:string;value:string}>(root,"PATCH",{
    intentId:newIntent(),key,value,expectedValue:previous?.valor_texto??null});
   if(out.key!==key||out.value!==value)throw Error("Configuração não confirmada.");
   setMessage("Preferência da empresa registrada no D1 local e auditada.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Alteração não confirmada.");}
  finally{setBusy(false);}
 }
 return <div className="f9-page"><div className="page-intro"><div><p className="eyebrow">F9 · Preferências</p>
  <h1>Ajustes sem riscos.</h1><p>Defina como a empresa prefere visualizar lembretes e orientações.</p>
 </div><Settings2 size={35} aria-hidden="true"/></div>
 <Notice title="Essas opções não mudam dinheiro nem permissões">
  Alterar uma preferência nunca dá acesso extra a um usuário, não paga contas e não dispara e-mails.
  Todos os ajustes ficam associados à empresa selecionada e somente o administrador pode salvá-los.</Notice>
 {!admin||!verified?<Card><SectionHeading title="Configurações restritas"/>
  <p>Peça a um administrador autorizado da empresa para visualizar e alterar preferências.</p>
 </Card>:<>
  {error&&<div className="f4-error" role="alert">{error}</div>}
  {message&&<div className="f4-success" role="status">{message}</div>}
  {busy&&<Skeleton lines={2}/>}
  <Card className="f9-card"><SectionHeading eyebrow="Ajuda" title="Mostrar dicas para quem está começando"/>
   <p className="f9-muted">Preferência registrada para futuras telas e recursos de orientação.
    Não esconde avisos de segurança obrigatórios.</p>
   <div className="f9-inline-form"><label className="f9-field">
    <span>Exibir dicas explicativas</span><select aria-label="Exibir dicas explicativas"
      value={tips} onChange={e=>setTips(e.target.value)}>
      <option value="true">Sim, mostrar dicas</option><option value="false">Não, minimizar dicas</option>
    </select></label>
    <Button disabled={busy} onClick={()=>void save("exibir_dicas_iniciantes",tips)}>
      <CheckCircle2 size={16}/>Salvar opção de ajuda</Button>
   </div>
  </Card>
  <Card className="f9-card"><SectionHeading eyebrow="Planejamento" title="Antecedência dos próximos vencimentos"/>
   <p className="f9-muted">Quantidade de dias de antecedência preferida para avisos e
    relatórios futuros. Não modifica datas, valores ou o envio de notificações.</p>
   <div className="f9-inline-form"><label className="f9-field">
    <span>Dias de antecedência (1 a 60)</span>
    <input aria-label="Dias de antecedência" type="number" min={1} max={60}
     value={days} onChange={e=>setDays(e.target.value)}/></label>
    <Button disabled={busy||!(/^(?:[1-9]|[1-5]\d|60)$/.test(days))}
     onClick={()=>void save("alertas_dias_antecedencia",days)}>
     <CheckCircle2 size={16}/>Salvar antecedência</Button>
   </div>
  </Card>
  <Card className="f9-card"><SectionHeading eyebrow="Segurança" title="Configurações da operação"/>
   <div className="f9-list">
    <div className="f9-list-line"><div><strong>Envio de e-mails</strong><small>Não habilitado na F9</small></div>
     <Badge tone="warning">Desligado</Badge></div>
    <div className="f9-list-line"><div><strong>Transferência R2 → Google Drive</strong>
     <small>Depende de verificação, backup e homologação</small></div>
     <Badge tone="warning">Bloqueada</Badge></div>
    <div className="f9-list-line"><div><strong>Banco D1 em produção</strong>
     <small>Nenhuma alteração remota nesta fase</small></div>
     <Badge tone="neutral">Somente laboratório</Badge></div>
   </div>
   <p className="f9-muted"><ShieldCheck size={17} aria-hidden="true"/>
    Configurações sensíveis de infraestrutura não podem ser alteradas por este painel.</p>
  </Card>
 </>}
 </div>;
}
