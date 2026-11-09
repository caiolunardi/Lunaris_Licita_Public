import {useCallback,useEffect,useState,type FormEvent} from "react";
import {Bell,CalendarClock,Mail,RefreshCcw} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {apiGet,apiSend,baseUrl,newIntent,localDateLabel} from "./api";
import {formatMoney,validatedNotifications,type Notifications,type ToolsProps} from "./types";
const weekdays=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
type Overview={today:string;items:Array<{id:string;vencimento:string;valor_nominal_cent:number}>;
 count:number;totalCent:number;message:string;sent:false;sendAuthorized:false};
export default function NotificationsTool({identity}:ToolsProps){
 const id=identity.active?.id||"",admin=!!identity.active?.permissions.canApprove;
 const verified=identity.stage==="verified"&&identity.source==="server";
 const root=baseUrl(id)+"/notifications";
 const [data,setData]=useState<Notifications|null>(null),[loading,setLoading]=useState(false),
  [working,setWorking]=useState(false),[error,setError]=useState<string|null>(null),
  [message,setMessage]=useState<string|null>(null),[preview,setPreview]=useState<Overview|null>(null);
 const [days,setDays]=useState<number[]>([1,2,3,4,5]),[times,setTimes]=useState(["08:00"]),
  [quantity,setQuantity]=useState(5),[email,setEmail]=useState("");
 const [disableId,setDisableId]=useState(""),[disableReason,setDisableReason]=useState("");
 const load=useCallback(async()=>{
  if(!admin||!verified)return;
  setLoading(true);setError(null);
  try{const r=await apiGet<unknown>(root);
   if(!validatedNotifications(r))throw Error("A configuração de avisos não passou na conferência.");
   setData(r);
   const p=r.preference;
   if(p){
    const d=JSON.parse(p.dias_semana_json||"[]") as unknown,
     t=JSON.parse(p.horarios_json||"[]") as unknown;
    if(Array.isArray(d)&&d.every(x=>Number.isSafeInteger(x)&&x>=0&&x<=6))
     setDays(d as number[]);
    if(Array.isArray(t)&&t.every(x=>typeof x==="string"))setTimes(t as string[]);
    setQuantity(p.quantidade_proximos);
   }
  }catch(e){setError(e instanceof Error?e.message:"Avisos indisponíveis.");}
  finally{setLoading(false);}
 },[admin,verified,root]);
 useEffect(()=>{void load();},[load]);
 async function saveSchedule(e:FormEvent){
  e.preventDefault();if(working||!admin||!verified)return;
  setWorking(true);setError(null);setMessage(null);
  try{
   if(days.length===0||times.length===0||times.length>3||
    new Set(times).size!==times.length||!/^[1-9]\d?$/.test(String(quantity))||
    quantity>50)throw Error("Escolha ao menos um dia e horário (no máximo 3 horários).");
   const r=await apiSend<{dispatchEnabled:false}>(root+"/schedule","PATCH",{
    intentId:newIntent(),expectedVersion:data?.preference?.versao||0,
    days,times,quantityProximos:quantity});
   if(r.dispatchEnabled!==false)throw Error("O servidor não garantiu bloqueio de envio.");
   setMessage("Preferências guardadas. E-mails e agendamentos automáticos CONTINUAM DESLIGADOS.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível gravar os horários.");}
  finally{setWorking(false);}
 }
 async function addRecipient(e:FormEvent){
  e.preventDefault();if(working||!admin||!verified)return;
  setWorking(true);setError(null);setMessage(null);
  try{if(!data?.preference)throw Error("Salve primeiro a programação.");
   const r=await apiSend<{dispatchEnabled:false}>(root+"/recipients","POST",{
    intentId:newIntent(),email:email.trim().toLowerCase()});
   if(r.dispatchEnabled!==false)throw Error("Envio não confirmado como desativado.");
   setEmail("");setMessage("Destinatário cadastrado localmente; nenhum e-mail foi enviado.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível cadastrar destinatário.");}
  finally{setWorking(false);}
 }
 async function disable(){
  const target=data?.recipients.find(x=>x.id===disableId);
  if(!target||disableReason.trim().length<8||working)return;
  setWorking(true);setError(null);setMessage(null);
  try{await apiSend(root+"/recipients/"+encodeURIComponent(target.id),"POST",{
   intentId:newIntent(),expectedVersion:target.versao,motivo:disableReason.trim()});
   setDisableId("");setDisableReason("");setMessage("Destinatário desativado e auditado no D1 local.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível desativar.");}
  finally{setWorking(false);}
 }
 async function showPreview(){
  setWorking(true);setError(null);setPreview(null);
  try{
   const r=await apiGet<Overview>(root+"/preview");
   if(r.sent!==false||r.sendAuthorized!==false)
    throw Error("Prévia rejeitada: o serviço não confirmou bloqueio de envio.");
   setPreview(r);
  }catch(e){setError(e instanceof Error?e.message:"Prévia indisponível.");}
  finally{setWorking(false);}
 }
 return <div className="f9-page"><div className="page-intro"><div>
  <p className="eyebrow">F9 · Comunicação segura</p><h1>Avisos sem surpresas.</h1>
  <p>Escolha quando quer receber um resumo das contas e confira o que seria informado.</p>
  </div><Bell size={35} aria-hidden="true"/></div>
  <Notice title="E-mails e avisos automáticos ainda NÃO são enviados">
   A F9 salva preferências apenas no D1 local. Não existe provedor conectado,
   cron de disparo ou envio real. Agendamento salvo não equivale a e-mail entregue.
   Nunca reenviamos automaticamente um envio com estado incerto.</Notice>
  {!admin||!verified?<Card><SectionHeading title="Administração necessária"/>
   <p>Somente um administrador autorizado pode editar horários,
    destinatários e consultar registros de comunicação desta empresa.</p></Card>:
  <>
   {error&&<div className="f4-error" role="alert">{error}</div>}
   {message&&<div className="f4-success" role="status">{message}</div>}
   {loading&&<Card><Skeleton lines={3}/></Card>}
   <Card className="f9-card"><SectionHeading eyebrow="1. Preferências" title="Quando gostaria de receber avisos?">
    <Badge tone="warning">Envio desligado</Badge></SectionHeading>
    <form className="f9-form" onSubmit={e=>void saveSchedule(e)}>
     <fieldset className="f9-days"><legend>Dias da semana</legend>
      {weekdays.map((day,index)=><label key={day} className="f9-day">
       <input aria-label={day} type="checkbox" checked={days.includes(index)}
        onChange={e=>setDays(old=>e.target.checked?[...old,index].sort():
         old.filter(x=>x!==index))}/><span>{day}</span></label>)}</fieldset>
     <div className="f9-fields"><label className="f9-field"><span>Horário 1</span>
      <input aria-label="Primeiro horário" type="time" value={times[0]||"08:00"}
       onChange={e=>setTimes(old=>[e.target.value,...old.slice(1)])}/></label>
      <label className="f9-field"><span>Horário 2 (opcional)</span>
       <input aria-label="Segundo horário" type="time" value={times[1]||""}
        onChange={e=>setTimes(old=>[old[0]||"08:00",e.target.value,...old.slice(2)]
         .filter(Boolean))}/></label>
      <label className="f9-field"><span>Horário 3 (opcional)</span>
       <input aria-label="Terceiro horário" type="time" value={times[2]||""}
        onChange={e=>setTimes(old=>[old[0]||"08:00",old[1]||"",e.target.value].filter(Boolean))}/></label>
      <label className="f9-field"><span>Próximas contas que entram no resumo</span>
       <input aria-label="Quantidade de contas no aviso" type="number" min={1} max={50}
        value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label></div>
     <Button type="submit" disabled={working||loading||days.length===0}>
      <CalendarClock size={16}/>Guardar preferências sem enviar</Button>
    </form>
   </Card>
   <Card className="f9-card"><SectionHeading eyebrow="2. Destinatários" title="Quem receberia esse resumo?"/>
    <form className="f9-inline-form" onSubmit={e=>void addRecipient(e)}>
     <label className="f9-field"><span>E-mail da pessoa</span>
      <input type="email" aria-label="E-mail de novo destinatário"
       maxLength={320} placeholder="exemplo@empresa.com.br" value={email}
       onChange={e=>setEmail(e.target.value)}/></label>
     <Button type="submit" disabled={working||!email.includes("@")||!data?.preference}>
      <Mail size={16}/>Cadastrar sem enviar</Button>
    </form>
    <div className="f9-list">{data?.recipients.map(r=><div className="f9-list-line" key={r.id}>
     <div><strong>{r.email_normalizado}</strong><small>
      {r.ativo===1?"Cadastro ativo, envio desativado":"Destinatário desativado"}</small></div>
     <div><Badge tone={r.ativo===1?"neutral":"warning"}>{r.ativo===1?"Cadastrado":"Desativado"}</Badge>
     {r.ativo===1&&<Button variant="secondary" disabled={working}
      onClick={()=>{setDisableId(r.id);setDisableReason("");}}>Desativar</Button>}</div>
    </div>)}</div>
    {data?.recipients.length===0&&<p className="f9-muted">Nenhum destinatário cadastrado.</p>}
    {disableId&&<div className="f9-danger-panel">
     <h3>Desativar este destinatário</h3>
     <p>O registro e histórico permanecem. Escreva o motivo antes de confirmar.</p>
     <label className="f9-field"><span>Motivo da desativação (mínimo 8 caracteres)</span>
      <input aria-label="Motivo para desativar destinatário" value={disableReason}
       onChange={e=>setDisableReason(e.target.value)} maxLength={200}/></label>
     <Button variant="secondary" onClick={()=>setDisableId("")}>Cancelar</Button>
     <Button disabled={working||disableReason.trim().length<8} onClick={()=>void disable()}>
      Confirmar desativação</Button>
    </div>}
   </Card>
   <Card className="f9-card"><SectionHeading eyebrow="3. Conferência" title="Veja o resumo antes de mandar"/>
    <p className="f9-muted">O sistema mostra apenas contas realmente registradas, verificadas
     e que ainda estão abertas. Sem contas elegíveis, nenhum aviso vazio deve ser enviado.</p>
    <Button variant="secondary" disabled={working} onClick={()=>void showPreview()}>
     <RefreshCcw size={16}/>Ver prévia sem enviar</Button>
    {preview&&<div className="f9-preview">
     <p><strong>{preview.count} conta(s)</strong> · {formatMoney(preview.totalCent)}</p>
     <p className="f9-muted">{preview.message}</p>
     {preview.items.map(x=><div className="f9-list-line" key={x.id}>
      <span>Vence {localDateLabel(x.vencimento)}</span><strong>
       {formatMoney(x.valor_nominal_cent)}</strong></div>)}
     <Badge tone="warning">Nada enviado</Badge>
    </div>}
   </Card>
   <Card className="f9-card"><SectionHeading eyebrow="Registro de comunicações" title="Histórico de tentativas"/>
    <Notice title="Nunca repetir às cegas">
     RESERVADO significa somente preparado; INCERTO exige conciliação humana;
     ENVIADO somente após aceitação explícita de provedor externo autorizado.</Notice>
    {!data?.history.length?<EmptyState title="Sem envios registrados"
     message="A configuração dos avisos não gera envios."/>:
     <div className="f9-list">{data.history.map(x=><div key={x.id} className="f9-list-line">
      <div><strong>{localDateLabel(x.data_referencia)} · {x.horario}</strong>
       <small>{x.quantidade_boletos||0} conta(s) · {formatMoney(x.total_centavos)}</small></div>
      <Badge tone={x.estado==="ENVIADO"?"success":"warning"}>{x.estado}</Badge>
     </div>)}</div>}
   </Card>
  </>}
 </div>;
}
