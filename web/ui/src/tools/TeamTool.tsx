import {useCallback,useEffect,useState,type FormEvent} from "react";
import {LockKeyhole,RefreshCcw,ShieldAlert,UserRoundX,UsersRound} from "lucide-react";
import {Badge,Button,Card,EmptyState,Notice,SectionHeading,Skeleton} from "../components/UI";
import {apiGet,apiSend,baseUrl,newIntent} from "./api";
import type {Member,Restriction,ToolsProps} from "./types";
type Target={id:string;label:string};
type RestrictType="LICITACAO"|"TITULO_PAGAR";
export default function TeamTool({identity}:ToolsProps){
 const admin=!!identity.active?.permissions.canApprove,
  verified=identity.stage==="verified"&&identity.source==="server",
  root=baseUrl(identity.active?.id||"");
 const [members,setMembers]=useState<Member[]>([]),[restrictions,setRestrictions]=useState<Restriction[]>([]),
  [targets,setTargets]=useState<Target[]>([]),[targetType,setTargetType]=useState<RestrictType>("LICITACAO"),
  [targetId,setTargetId]=useState(""),[memberId,setMemberId]=useState(""),
  [action,setAction]=useState<"READ"|"WRITE"|"ALL">("READ"),
  [motivo,setMotivo]=useState(""),[revokeId,setRevokeId]=useState(""),
  [revokeReason,setRevokeReason]=useState(""),[confirm,setConfirm]=useState(""),
  [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),
  [success,setSuccess]=useState<string|null>(null);
 const load=useCallback(async()=>{
  if(!admin||!verified)return;
  setBusy(true);setError(null);
  try{
   const [people,denials]=await Promise.all([
    apiGet<{items:Member[]}>(root+"/members"),
    apiGet<{items:Restriction[]}>(root+"/restrictions?limit=50")]);
   if(!Array.isArray(people.items)||people.items.length>200||
    !Array.isArray(denials.items)||denials.items.length>50)
     throw Error("A lista da equipe não foi confirmada.");
   setMembers(people.items);setRestrictions(denials.items);
  }catch(e){setError(e instanceof Error?e.message:"Equipe indisponível.");}
  finally{setBusy(false);}
 },[admin,verified,root]);
 const loadTargets=useCallback(async()=>{
  if(!admin||!verified)return;
  try{const r=await apiGet<{items:Target[];type:RestrictType}>(
    root+"/restrictions/targets?type="+targetType);
   if(r.type!==targetType||!Array.isArray(r.items)||r.items.length>200)
     throw Error("Registros não conferidos.");
   setTargets(r.items);setTargetId(r.items[0]?.id||"");
  }catch(e){setTargets([]);setTargetId("");
   setError(e instanceof Error?e.message:"Não foi possível listar registros.");}
 },[admin,verified,root,targetType]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{void loadTargets();},[loadTargets]);
 const selected=members.find(x=>x.id===revokeId),
  active=members.filter(x=>x.ativo===1);
 async function revoke(){
  if(!selected||confirm!=="REVOGAR"||revokeReason.trim().length<8||busy)return;
  setBusy(true);setError(null);setSuccess(null);
  try{
   const result=await apiSend<{revokedUserId:string}>(root+"/members/"+selected.id+"/revoke","POST",{
    intentId:newIntent(),expectedVersion:selected.versao,motivo:revokeReason.trim(),
    confirmUserId:selected.id});
   if(result.revokedUserId!==selected.id)throw Error("Revogação não confirmada.");
   setRevokeId("");setConfirm("");setRevokeReason("");
   setSuccess("Acesso à empresa revogado e registrado na auditoria local.");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Revogação indisponível.");}
  finally{setBusy(false);}
 }
 async function restrict(e:FormEvent){
  e.preventDefault();
  if(!memberId||!targetId||motivo.trim().length<8||busy)return;
  setBusy(true);setError(null);setSuccess(null);
  try{const r=await apiSend<{restrictionId:string}>(root+"/restrictions","POST",{
   intentId:newIntent(),targetUserId:memberId,tipoEntidade:targetType,
   entidadeId:targetId,acao:action,motivo:motivo.trim()});
   if(!r.restrictionId)throw Error("Restrição não confirmada.");
   setMotivo("");setSuccess("Restrição registrada. Não foram concedidos novos direitos.");
   await load();
  }catch(err){setError(err instanceof Error?err.message:"Não foi possível restringir.");}
  finally{setBusy(false);}
 }
 return <div className="f9-page"><div className="page-intro"><div>
  <p className="eyebrow">F9 · Pessoas e segurança</p><h1>Equipe e permissões.</h1>
  <p>Confira quem pode acessar esta empresa e controle situações que precisam de proteção.</p>
 </div><UsersRound size={35} aria-hidden="true"/></div>
 <Notice title="Cada empresa tem seu próprio acesso">
  Somente administradores podem revogar vínculos ou aplicar restrições.
  Estas ferramentas não criam usuários, não convidam ninguém e não elevam permissões.
  A revogação mantém o histórico do que foi feito.</Notice>
 {!admin||!verified?<Card><SectionHeading title="Equipe disponível apenas a administradores"/>
  <p>Entre numa empresa com autorização ADMIN para conferir seus membros.</p></Card>:<>
  {error&&<div className="f4-error" role="alert">{error}</div>}
  {success&&<div className="f4-success" role="status">{success}</div>}
  {busy&&<Card><Skeleton lines={2}/></Card>}
  <Card className="f9-card">
   <SectionHeading eyebrow="Quem tem acesso" title="Pessoas desta empresa">
    <Button variant="secondary" disabled={busy} onClick={()=>void load()}>
     <RefreshCcw size={16}/>Atualizar</Button></SectionHeading>
   {members.length===0?<EmptyState title="Nenhuma pessoa encontrada"
    message="As pessoas devem existir na identidade institucional antes de receber permissões."/>:
   <div className="f9-list">{members.map(m=><div key={m.id} className="f9-list-line">
    <div><strong>{m.nome||"Pessoa sem nome informado"}</strong>
     <small>{m.email_normalizado}</small><small>Perfil: {m.papel}</small></div>
    <div><Badge tone={m.ativo===1?"success":"warning"}>
     {m.ativo===1?"Acesso ativo":"Revogado"}</Badge>
     {m.ativo===1&&m.id!==identity.profile?.id&&
      m.papel!=="ADMIN"&&
      <Button variant="secondary" disabled={busy}
       onClick={()=>{setRevokeId(m.id);setConfirm("");setRevokeReason("");}}>
       <UserRoundX size={16}/>Revogar acesso</Button>}
    </div>
   </div>)}</div>}
   {selected&&<div className="f9-danger-panel"><h3>Revogar acesso de {selected.nome||selected.email_normalizado}?</h3>
    <p>Esta pessoa perderá o acesso a esta empresa. As ações passadas não são apagadas.
     Informe um motivo e digite <strong>REVOGAR</strong> para confirmar.</p>
    <label className="f9-field"><span>Motivo (mínimo 8 caracteres)</span>
     <input aria-label="Motivo da revogação" maxLength={500} value={revokeReason}
      onChange={e=>setRevokeReason(e.target.value)}/></label>
    <label className="f9-field"><span>Digite REVOGAR</span><input aria-label="Confirmação de revogação"
     autoComplete="off" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
    <div className="f9-actions"><Button variant="secondary"
      onClick={()=>setRevokeId("")}>Cancelar</Button>
     <Button disabled={busy||confirm!=="REVOGAR"||revokeReason.trim().length<8}
      onClick={()=>void revoke()}><LockKeyhole size={16}/>Confirmar revogação</Button></div>
   </div>}
  </Card>
  <Card className="f9-card"><SectionHeading eyebrow="Exceções de acesso"
   title="Restringir um registro específico"/>
   <p className="f9-muted">Uma pessoa pode ter acesso geral à empresa, mas não a um processo
    ou conta específica. A restrição somente retira o acesso; nunca o amplia.</p>
   <form className="f9-form" onSubmit={e=>void restrict(e)}>
    <div className="f9-fields">
     <label className="f9-field"><span>Qual pessoa?</span>
      <select aria-label="Pessoa a restringir" value={memberId}
       onChange={e=>setMemberId(e.target.value)}>
       <option value="">Escolha uma pessoa</option>
       {active.filter(x=>x.id!==identity.profile?.id).map(m=>
        <option key={m.id} value={m.id}>{m.nome||m.email_normalizado} ({m.papel})</option>)}
      </select></label>
     <label className="f9-field"><span>Área do registro</span>
      <select aria-label="Área da restrição" value={targetType}
       onChange={e=>setTargetType(e.target.value as RestrictType)}>
       <option value="LICITACAO">Licitação</option>
       <option value="TITULO_PAGAR">Conta a pagar</option></select></label>
     <label className="f9-field"><span>Qual registro?</span>
      <select aria-label="Registro a restringir" value={targetId}
       disabled={!targets.length} onChange={e=>setTargetId(e.target.value)}>
       {!targets.length&&<option value="">Nenhum registro autorizado encontrado</option>}
       {targets.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
      </select></label>
     <label className="f9-field"><span>Que acesso será retirado?</span>
      <select aria-label="Acesso a retirar" value={action}
       onChange={e=>setAction(e.target.value as "READ"|"WRITE"|"ALL")}>
       <option value="READ">Visualizar</option><option value="WRITE">Alterar</option>
       <option value="ALL">Visualizar e alterar</option></select></label>
    </div>
    <label className="f9-field"><span>Motivo documentado (mínimo 8 caracteres)</span>
     <input aria-label="Motivo da restrição" maxLength={500} value={motivo}
      onChange={e=>setMotivo(e.target.value)} placeholder="Ex.: informação sob análise"/></label>
    <Button type="submit" disabled={busy||!memberId||!targetId||motivo.trim().length<8}>
     <ShieldAlert size={17}/>Registrar restrição</Button>
   </form>
  </Card>
  <Card className="f9-card"><SectionHeading eyebrow="Registros imutáveis"
   title="Restrições já registradas"/>
   <Notice title="Restrições não são apagadas">
    Um bloqueio é um evento de segurança. Não há botão para apagar ou conceder um
    acesso que não existia. A política de liberação futura exige contrato próprio.</Notice>
   {restrictions.length===0?<EmptyState title="Sem restrições registradas"
    message="Somente bloqueios administrativos efetivos aparecerão aqui."/>:
    <div className="f9-list">{restrictions.map(r=><div key={r.id} className="f9-list-line">
     <div><strong>{r.tipo_entidade} · {r.acao}</strong>
      <small>{r.motivo}</small></div><Badge tone="warning">Restrito</Badge>
    </div>)}</div>}
  </Card>
 </>}
 </div>;
}
