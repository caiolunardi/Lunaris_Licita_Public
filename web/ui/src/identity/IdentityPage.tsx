import {useEffect} from "react";
import {Building2,CheckCircle2,LockKeyhole,LogOut,RefreshCcw,ShieldAlert,ShieldCheck,UserRound,WifiOff} from "lucide-react";
import {Badge,Button,Card,Notice,SectionHeading,Skeleton} from "../components/UI";
import type {Company,IdentityState,Role} from "./session";

type Props = {
  state:IdentityState;
  onLoad:()=>Promise<void>;
  onPreview:(mode:"multi"|"empty"|"denied")=>void;
  onSelect:(id:string)=>Promise<void>;
  onLogout:()=>Promise<void>;
};
const roleName=(role:Role)=>({ADMIN:"Administrador",OPERADOR:"Operador",CONSULTA:"Consulta"}[role]);
function PreviewControls({onPreview}:Pick<Props,"onPreview">){
  return <div className="preview-controls" aria-label="Cenários de identidade fictícios">
    <Button variant="secondary" onClick={()=>onPreview("multi")}>Duas empresas fictícias</Button>
    <Button variant="ghost" onClick={()=>onPreview("empty")}>Sem empresa</Button>
    <Button variant="ghost" onClick={()=>onPreview("denied")}>Acesso negado</Button>
  </div>;
}
export default function IdentityPage({state,onLoad,onPreview,onSelect,onLogout}:Props){
  useEffect(()=>{if(state.stage==="idle")void onLoad();},[state.stage,onLoad]);
  const verified=state.stage==="verified";
  const preview=state.stage==="preview"||state.source==="fixture";
  const canShow=verified||state.stage==="preview";
  return <div className="identity-page">
    <div className="page-intro">
      <div><p className="eyebrow">F1 · Identidade e empresas</p><h1>Seu acesso, sob controle.</h1>
      <p>As permissões são verificadas pelo Worker em cada empresa; a interface nunca determina direitos por conta própria.</p></div>
      <span className="intro-decoration"><LockKeyhole size={34} aria-hidden="true"/></span>
    </div>
    <Notice title={preview?"Simulação explícita":verified?"Identidade local validada":"Backend operacional indisponível"}>
      {preview?"Perfis e empresas nesta página são totalmente fictícios; nenhuma permissão simulada autoriza operações.":verified?"Perfil e permissões verificados no Worker/D1 local. Isso não libera homologação remota.":"A F1 só utiliza D1 e JWT em testes locais. HML e produção continuam bloqueados até os gates R7 E5/E6."}
    </Notice>
    <div className="identity-actions">
      <Badge tone={verified?"success":preview?"warning":"info"}>{verified?"Identidade validada no Worker local":preview?"Cenário fictício":"Aguardando identidade"}</Badge>
      <Button variant="secondary" onClick={()=>void onLoad()}><RefreshCcw size={16}/> Validar sessão novamente</Button>
    </div>
    {state.stage==="loading"&&<Card role="status"><SectionHeading title="Verificando sessão e empresas"/><Skeleton lines={3}/></Card>}
    {["unavailable","denied","signed-out"].includes(state.stage)&&
      <Card className="identity-state" role="status">
        {state.stage==="unavailable"?<WifiOff size={27} aria-hidden="true"/>:
          <ShieldAlert size={27} aria-hidden="true"/>}
        <h2>{state.stage==="unavailable"?"Serviço de identidade indisponível":
          state.stage==="signed-out"?"Sessão revogada":"Acesso não autorizado"}</h2>
        <p>{state.message||"Nenhuma informação de empresa foi disponibilizada."}</p>
        <p>O login Google é administrado pelo Cloudflare Access; esta interface não solicita senha nem recebe tokens diretamente.</p>
        <PreviewControls onPreview={onPreview}/>
      </Card>}
    {canShow&&state.profile&&<>
      <div className="identity-grid">
        <Card className="identity-profile">
          <SectionHeading eyebrow="Perfil" title="Identificação de usuário"><Badge tone={preview?"warning":"success"}>{preview?"Fictício":"Local verificado"}</Badge></SectionHeading>
          <div className="identity-user"><span className="identity-user__avatar"><UserRound size={24}/></span><div><strong>{state.profile.name}</strong><p>{state.profile.email}</p></div></div>
          <p className="identity-note"><ShieldCheck size={16}/> {preview?"Dados inventados para demonstração.":"Dados fornecidos pelo cadastro autorizado do D1 local."}</p>
          {state.active&&<div className="identity-active" role="status"><CheckCircle2 size={17}/><div><small>Empresa ativa em memória</small><strong>{state.active.name}</strong><span>{roleName(state.active.role)}</span></div></div>}
          {!state.active&&<p className="identity-warning">Nenhuma empresa ativa. Nenhuma consulta de negócio está autorizada nesta sessão.</p>}
        </Card>
        <Card className="identity-companies">
          <SectionHeading eyebrow="Segregação por empresa" title="Escolha o contexto"/>
          {state.companies.length===0?<div className="empty-state"><Building2 size={26} aria-hidden="true"/><strong>Nenhuma empresa autorizada</strong><p>Sem vínculo ativo, não há empresa para abrir.</p></div>:
          <div className="company-list">{state.companies.map((company:Company)=>
            <button type="button" key={company.id} onClick={()=>void onSelect(company.id)}
              disabled={state.pending} className={`company-choice ${state.active?.id===company.id?"company-choice--active":""}`}
              aria-pressed={state.active?.id===company.id}>
              <span className="company-choice__icon"><Building2 size={20}/></span>
              <span className="company-choice__text"><strong>{company.name}</strong><small>{roleName(company.role)} · contexto individual</small></span>
              {state.active?.id===company.id&&<CheckCircle2 size={19} color="currentColor" aria-label="Empresa ativa"/>}
            </button>)}</div>}
          {state.pending&&<p className="identity-note" role="status">Conferindo permissões: dados do contexto anterior ocultados.</p>}
          {state.message&&<p className="identity-warning" role="alert">{state.message}</p>}
        </Card>
      </div>
      {state.active&&<Card className="permissions-card"><SectionHeading eyebrow="Papel na empresa selecionada" title="Acesso efetivo"/>
        <div className="permission-list"><Badge tone={state.active.permissions.canRead?"success":"danger"}>Consulta: {state.active.permissions.canRead?"permitida":"negada"}</Badge>
        <Badge tone={state.active.permissions.canWrite?"success":"warning"}>Alterações: {state.active.permissions.canWrite?"permitidas":"negadas"}</Badge>
        <Badge tone={state.active.permissions.canApprove?"success":"warning"}>Aprovação: {state.active.permissions.canApprove?"permitida":"negada"}</Badge></div>
        <p>Estas permissões são informativas. O Worker revalida JWT, papel e ACL em cada operação, sem confiar nesta tela.</p>
        <Button variant="secondary" onClick={()=>void onLogout()}><LogOut size={16}/>{preview?"Sair da simulação":"Revogar minha sessão local"}</Button>
      </Card>}
      {preview&&<Card className="identity-previews"><SectionHeading title="Outros cenários de demonstração"/><PreviewControls onPreview={onPreview}/></Card>}
    </>}
  </div>;
}
