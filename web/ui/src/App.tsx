import { lazy, Suspense, useDeferredValue, useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import {
  ArrowRight, BarChart3, Bell, BookOpen, BriefcaseBusiness, Building2, CalendarDays, Check, ChevronDown,
  ClipboardList, FileText, Gauge, LayoutDashboard, Layers3, Menu, PanelLeft, Calculator, UsersRound, History,
  Search, Settings2, ShieldCheck, Sparkles, TrendingUp, Truck, UserRound, WalletCards, X
} from "lucide-react";
import { Badge, Button, Card, EmptyState, IconButton, Notice, ProgressPill, SearchInput, SectionHeading, Skeleton, StatCard } from "./components/UI";
import { exampleBars, exampleProcesses, phases } from "./fixtures";
import { useIdentity } from "./identity/session";

const GabiPanel = lazy(() => import("./components/GabiPanel"));
const IdentityPage = lazy(() => import("./identity/IdentityPage"));
const CatalogPage = lazy(() => import("./catalog/CatalogPage"));
const FinancePage = lazy(() => import("./finance/FinancePage"));
const TenderPage = lazy(() => import("./tenders/TenderPage"));
const CommercialPage = lazy(() => import("./commercial/CommercialPage"));
const FulfillmentPage = lazy(() => import("./fulfillment/FulfillmentPage"));
const CashPage = lazy(() => import("./cash/CashPage"));
const DocumentsPage = lazy(() => import("./documents/DocumentsPage"));
const ToolsPage = lazy(() => import("./tools/ToolsPage"));
type Page = "overview" | "identity" | "orgaos" | "fornecedores" | "tenders" | "commitments" | "purchases" | "shipments" | "invoices" | "receivables" | "documents" | "pricing" | "notifications" | "settings" | "team" | "audit" | "help" | "finance" | "titles" | "recurrences" | "components" | "performance";
type Theme = "system" | "light" | "dark";

const nav = [
  { page: "overview" as const, label: "Visão geral", icon: LayoutDashboard },
  { page: "identity" as const, label: "Identidade e acesso", icon: UserRound },
  { page: "orgaos" as const, label: "Órgãos", icon: Building2 },
  { page: "fornecedores" as const, label: "Fornecedores", icon: Truck },
  { page: "tenders" as const, label: "Licitações", icon: BriefcaseBusiness },
  { page: "commitments" as const, label: "Empenhos", icon: ClipboardList },
  { page: "purchases" as const, label: "Compras", icon: Truck },
  { page: "shipments" as const, label: "Envios", icon: Truck },
  { page: "invoices" as const, label: "Notas fiscais", icon: FileText },
  { page: "receivables" as const, label: "A receber", icon: WalletCards },
  { page: "documents" as const, label: "Documentos", icon: FileText },
  { page: "pricing" as const, label: "Calculadora e cotações", icon: Calculator },
  { page: "notifications" as const, label: "Avisos", icon: Bell },
  { page: "settings" as const, label: "Configurações", icon: Settings2 },
  { page: "team" as const, label: "Equipe e acessos", icon: UsersRound },
  { page: "audit" as const, label: "Auditoria", icon: History },
  { page: "help" as const, label: "Central de ajuda", icon: BookOpen },
  { page: "finance" as const, label: "Fluxo mensal", icon: BarChart3 },
  { page: "titles" as const, label: "Contas a pagar", icon: WalletCards },
  { page: "recurrences" as const, label: "Recorrências", icon: CalendarDays },
  { page: "components" as const, label: "Componentes", icon: Layers3 },
  { page: "performance" as const, label: "Desempenho", icon: Gauge }
];
const future = [
  { label: "Gabi: consulta em preparação", icon: Sparkles }
];
const links: Record<Page, string> = { overview: "/", identity: "/identidade", orgaos: "/orgaos", fornecedores: "/fornecedores", tenders: "/licitacoes", commitments: "/empenhos", purchases: "/compras", shipments: "/envios", invoices: "/notas-fiscais", receivables: "/contas-receber", documents: "/documentos", pricing: "/cotacoes", notifications: "/notificacoes", settings: "/configuracoes", team: "/equipe", audit: "/auditoria", help: "/ajuda", finance: "/financeiro", titles: "/contas-pagar", recurrences: "/recorrencias", components: "/componentes", performance: "/desempenho" };
function getPage(path: string): Page {
  if (path === "/identidade" || path === "/identidade/") return "identity";
  if (path === "/orgaos" || path === "/orgaos/") return "orgaos";
  if (path === "/fornecedores" || path === "/fornecedores/") return "fornecedores";
  if (path === "/licitacoes" || path === "/licitacoes/") return "tenders";
  if (path === "/empenhos" || path === "/empenhos/") return "commitments";
  if (path === "/compras" || path === "/compras/") return "purchases";
  if (path === "/envios" || path === "/envios/") return "shipments";
  if (path === "/notas-fiscais" || path === "/notas-fiscais/") return "invoices";
  if (path === "/contas-receber" || path === "/contas-receber/") return "receivables";
  if (path === "/documentos" || path === "/documentos/") return "documents";
  if (path === "/cotacoes" || path === "/cotacoes/") return "pricing";
  if (path === "/notificacoes" || path === "/notificacoes/") return "notifications";
  if (path === "/configuracoes" || path === "/configuracoes/") return "settings";
  if (path === "/equipe" || path === "/equipe/") return "team";
  if (path === "/auditoria" || path === "/auditoria/") return "audit";
  if (path === "/ajuda" || path === "/ajuda/") return "help";
  if (path === "/financeiro" || path === "/financeiro/") return "finance";
  if (path === "/contas-pagar" || path === "/contas-pagar/") return "titles";
  if (path === "/recorrencias" || path === "/recorrencias/") return "recurrences";
  if (path === "/componentes" || path === "/componentes/") return "components";
  if (path === "/desempenho" || path === "/desempenho/") return "performance";
  return "overview";
}
function getTheme(): Theme {
  try {
    const value = localStorage.getItem("licita-f0-theme");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function Dashboard() {
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLocaleLowerCase("pt-BR"));
  const filtered = exampleProcesses.filter((p) => [p.id, p.description, p.entity, p.status].some((value) => value.toLocaleLowerCase("pt-BR").includes(query)));
  return <>
    <div className="page-intro">
      <div><p className="eyebrow">Sua operação em perspectiva</p><h1>Uma visão mais clara de tudo.</h1><p>Organize processos, acompanhe prazos e tome decisões com confiança.</p></div>
      <span className="intro-decoration" aria-hidden="true"><BarChart3 size={36}/></span>
    </div>
    <Notice title="Ambiente de demonstração">Todos os números e processos abaixo são fictícios. Nenhuma API financeira, D1 ou R2 está conectada.</Notice>
    <div className="stats-grid" aria-label="Indicadores fictícios">
      <StatCard label="Licitações em andamento" value="14" detail="Exemplo de indicador operacional" icon={<BriefcaseBusiness size={20}/>}/>
      <StatCard label="Compromissos próximos" value="08" detail="Exemplo de vencimentos" icon={<WalletCards size={20}/>}/>
      <StatCard label="Documentos para conferir" value="05" detail="Exemplo de pendências" icon={<ClipboardList size={20}/>}/>
    </div>
    <div className="dashboard-grid">
      <Card className="chart-card">
        <SectionHeading eyebrow="Atividade" title="Evolução dos processos"><Badge>Exemplo</Badge></SectionHeading>
        <div className="chart-subtitle"><strong>+18,6%</strong><span>comparação ilustrativa com o período anterior</span></div>
        <div className="bar-chart" role="img" aria-label="Gráfico fictício de atividade: junho 42, julho 58, agosto 52, setembro 78, outubro 63 e novembro 89.">
          {exampleBars.map((bar, i) => <div className="bar-column" key={bar.label}>
            <span className={`bar ${i === exampleBars.length - 1 ? "bar--active" : ""}`} style={{ "--height": `${bar.value}%` } as CSSProperties} aria-hidden="true"/>
            <span className="bar-label">{bar.label}</span>
          </div>)}
        </div>
      </Card>
      <Card className="flow-card">
        <SectionHeading eyebrow="Fluxo comercial" title="Sete etapas"><Badge tone="info">Visão visual</Badge></SectionHeading>
        <p className="support-copy">Uma trilha única para entender o andamento sem perder o contexto.</p>
        <ol className="phase-list">{phases.map((phase, index) => <li key={phase}><span className="phase-index">{String(index + 1).padStart(2, "0")}</span><span>{phase}</span>{index < 3 && <Check size={15} className="phase-check" aria-label="Exemplo concluído"/>}</li>)}</ol>
      </Card>
    </div>
    <Card className="table-card">
      <SectionHeading eyebrow="Acompanhamento" title="Processos recentes"><Badge>Dados fictícios</Badge></SectionHeading>
      <div className="table-toolbar"><SearchInput label="Buscar processos fictícios" placeholder="Buscar por número, órgão ou descrição" value={search} onChange={e => setSearch(e.target.value)}/><span className="table-count">{filtered.length} resultados</span></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>Número</th><th>Processo</th><th>Órgão</th><th>Situação</th><th>Prazo</th></tr></thead><tbody>{filtered.map(p => <tr key={p.id}><td className="mono">{p.id}</td><td className="strong-cell">{p.description}</td><td>{p.entity}</td><td><Badge tone={p.tone}>{p.status}</Badge></td><td>{p.date}</td></tr>)}</tbody></table></div> : <EmptyState title="Nenhum processo encontrado" message="Tente outro termo. Esta pesquisa atua somente sobre os exemplos locais."/>}
    </Card>
  </>;
}

function ComponentGallery() {
  return <><div className="page-intro"><div><p className="eyebrow">Sistema visual</p><h1>Consistência em cada detalhe.</h1><p>Componentes reutilizáveis, acessíveis e sem dependências visuais pesadas.</p></div></div>
    <Notice title="Laboratório F0">Estes elementos são protótipos locais, não formulários conectados ao servidor.</Notice>
    <div className="gallery-grid">
      <Card><SectionHeading eyebrow="Interação" title="Botões e ações"/><div className="showcase-row"><Button onClick={() => {}}>Ação primária <ArrowRight size={16}/></Button><Button variant="secondary">Secundária</Button><Button variant="ghost">Discreta</Button><Button disabled>Indisponível</Button></div></Card>
      <Card><SectionHeading eyebrow="Feedback" title="Estados e sinalizações"/><div className="showcase-row"><Badge tone="success">Concluído</Badge><Badge tone="warning">Atenção</Badge><Badge tone="info">Em andamento</Badge><Badge tone="danger">Bloqueado</Badge></div><ProgressPill label="Etapas concluídas (simulação)" value={57}/></Card>
      <Card><SectionHeading eyebrow="Formulários" title="Campos acessíveis"/><label className="form-field">Identificação de exemplo<input autoComplete="off" placeholder="Digite um identificador fictício"/></label><label className="form-field">Categoria de exemplo<select defaultValue="lic"><option value="lic">Licitação</option><option value="doc">Documento</option></select></label></Card>
      <Card><SectionHeading eyebrow="Resiliência" title="Estados de carregamento"/><Skeleton/><div className="gallery-gap"><EmptyState title="Sem informações" message="Mostramos estados vazios sem inventar dados ou ocultar erros."/></div></Card>
    </div>
  </>;
}
function Performance() {
  return <><div className="page-intro"><div><p className="eyebrow">Qualidade desde a origem</p><h1>Rápida por arquitetura.</h1><p>A interface tem limites mensuráveis de recursos e espaço para crescer sem travar.</p></div><span className="intro-decoration" aria-hidden="true"><Gauge size={36}/></span></div>
    <Notice title="Metas, não resultados de campo">As métricas de build são verificadas na CI. LCP, INP e experiência real precisam de medição em navegador e produção.</Notice>
    <div className="performance-grid">
      <Card><div className="perf-icon"><TrendingUp size={23}/></div><p className="eyebrow">Orçamento inicial</p><h2>120 KiB</h2><p>Limite gzip do JavaScript necessário na abertura, medido pelos assets gerados.</p><Badge tone="success">Guardado por CI</Badge></Card>
      <Card><div className="perf-icon"><PanelLeft size={23}/></div><p className="eyebrow">CSS</p><h2>32 KiB</h2><p>Orçamento gzip do estilo gerado, com tokens e media queries compartilhados.</p><Badge tone="success">Guardado por CI</Badge></Card>
      <Card><div className="perf-icon"><ShieldCheck size={23}/></div><p className="eyebrow">Conexões</p><h2>0</h2><p>Chamadas de dados comerciais durante a demonstração F0; apenas fixtures explícitas.</p><Badge tone="info">Sem backend comercial</Badge></Card>
    </div>
    <Card className="principles-card"><SectionHeading eyebrow="Decisões técnicas" title="Sem atalhos que custam caro depois"/><div className="principles-grid">
      <div><strong>Carregamento sob demanda</strong><p>Painéis secundários, como o da Gabi, não entram no bundle inicial.</p></div>
      <div><strong>Gráficos sem biblioteca</strong><p>Gráficos simples com CSS, sem motor de visualização pesado.</p></div>
      <div><strong>Estados explícitos</strong><p>Carregando, vazio, erro e acesso negado serão diferenciados.</p></div>
      <div><strong>Acessibilidade e movimento</strong><p>Foco visível, navegação por teclado e preferência por movimento reduzido.</p></div>
    </div></Card>
  </>;
}

export default function App() {
  const [page, setPage] = useState<Page>(() => getPage(window.location.pathname));
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [gabiOpen, setGabiOpen] = useState(false);
  const identity = useIdentity();
  useEffect(() => {
    if (["orgaos","fornecedores","tenders","commitments","purchases","shipments","invoices","receivables","documents","pricing","notifications","settings","team","audit","finance","titles","recurrences"].includes(page) && identity.state.stage === "idle") void identity.load();
  }, [page, identity.state.stage, identity.load]);
  useEffect(() => { const callback = () => setPage(getPage(window.location.pathname)); window.addEventListener("popstate", callback); return () => window.removeEventListener("popstate", callback); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("licita-f0-theme", theme); } catch { /* preferência opcional */ }
  }, [theme]);
  useEffect(() => { document.title = `${page === "overview" ? "Visão geral" : page === "identity" ? "Identidade" : page === "orgaos" ? "Órgãos" : page === "fornecedores" ? "Fornecedores" : page === "tenders" ? "Licitações" : page === "commitments" ? "Empenhos" : page === "purchases" ? "Compras" : page === "shipments" ? "Envios" : page === "invoices" ? "Notas fiscais" : page === "receivables" ? "A receber" : page === "documents" ? "Documentos" : page === "pricing" ? "Calculadora e cotações" :
    page === "notifications" ? "Avisos" : page === "settings" ? "Configurações" :
    page === "team" ? "Equipe" : page === "audit" ? "Auditoria" : page === "help" ? "Central de ajuda" : page === "finance" ? "Fluxo mensal" : page === "titles" ? "Contas a pagar" : page === "recurrences" ? "Recorrências" : page === "components" ? "Componentes" : "Desempenho"} · Lunaris Licita`; }, [page]);
  function goTo(destination: Page) {
    if (window.location.pathname !== links[destination]) window.history.pushState(null, "", links[destination]);
    setPage(destination); setMenuOpen(false);
    window.scrollTo(0, 0);
  }
  function navigate(event: MouseEvent<HTMLAnchorElement>, destination: Page) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    goTo(destination);
  }
  return <div className="app-frame">
    {isMenuOpen && <button className="mobile-scrim" aria-label="Fechar navegação" onClick={() => setMenuOpen(false)}/>}
    <aside className={`sidebar ${isMenuOpen ? "sidebar--open" : ""}`} aria-label="Navegação principal">
      <div className="brand-line"><div className="brand-mark" aria-hidden="true"><span/></div><div><span className="brand-overline">LUNARIS</span><strong>Licita<span className="brand-dot">.</span></strong></div><IconButton label="Fechar menu" className="sidebar-close" onClick={() => setMenuOpen(false)}><X size={18}/></IconButton></div>
      <div className="workspace-select"><span className="workspace-symbol">L</span><div><small>Espaço de trabalho</small><strong>{identity.state.active?.name ?? "Laboratório F0–F9"}</strong></div><ChevronDown size={16} aria-hidden="true"/></div>
      <div className="sidebar-scroll">
        <p className="nav-heading">EXPERIÊNCIA</p>
        <nav aria-label="Laboratório">{nav.map(item => <a key={item.page} href={links[item.page]} onClick={e => navigate(e, item.page)} aria-current={page === item.page ? "page" : undefined} className={`nav-link ${page === item.page ? "nav-link--active" : ""}`}><item.icon size={19} aria-hidden="true"/>{item.label}{page === item.page && <span className="nav-marker"/>}</a>)}</nav>
        <p className="nav-heading nav-heading--later">PRÓXIMAS ETAPAS</p>
        <div aria-label="Módulos ainda indisponíveis">{future.map(item => <span key={item.label} className="nav-link nav-link--disabled" aria-disabled="true"><item.icon size={18} aria-hidden="true"/>{item.label}<span className="soon-dot" aria-hidden="true"/></span>)}</div>
      </div>
      <div className="sidebar-bottom"><button type="button" className="side-help" onClick={()=>goTo("help")}><BookOpen size={18} aria-hidden="true"/><div><strong>Precisa de ajuda?</strong><span>Veja orientações simples</span></div></button><div className="sidebar-version"><span className="alive-dot"/> F10 • Gabi somente leitura</div></div>
    </aside>
    <div className="main-column">
      <header className="topbar">
        <div className="topbar-start"><IconButton label="Abrir navegação" className="mobile-menu" onClick={() => setMenuOpen(true)}><Menu size={21}/></IconButton><span className="topbar-breadcrumb">Espaço de trabalho <span>/</span> <strong>{page === "overview" ? "Visão geral" : page === "identity" ? "Identidade e acesso" : page === "orgaos" ? "Órgãos" : page === "fornecedores" ? "Fornecedores" : page === "finance" ? "Fluxo mensal" : page === "titles" ? "Contas a pagar" : page === "recurrences" ? "Recorrências" : page === "commitments" ? "Empenhos" : page === "purchases" ? "Compras" : page === "shipments" ? "Envios" : page === "invoices" ? "Notas fiscais" : page === "receivables" ? "A receber" : page === "documents" ? "Documentos" : page === "pricing" ? "Cotações" :
    page === "notifications" ? "Avisos" : page === "settings" ? "Configurações" :
    page === "team" ? "Equipe" : page === "audit" ? "Auditoria" : page === "help" ? "Central de ajuda" : page === "tenders" ? "Licitações" : page === "components" ? "Componentes" : "Desempenho"}</strong></span></div>
        <div className="topbar-actions">
          <span className="topbar-status"><span className="alive-dot"/> {identity.state.stage === "verified" ? "Sessão local verificada" : "Laboratório F0–F9"}</span>
          <label className="theme-control"><span className="sr-only">Aparência</span><select aria-label="Aparência" value={theme} onChange={e => setTheme(e.target.value as Theme)}><option value="system">Sistema</option><option value="light">Claro</option><option value="dark">Escuro</option></select></label>
          <IconButton label="Buscar (disponível nas próximas fases)" disabled><Search size={19}/></IconButton>
          <IconButton label="Notificações (disponíveis nas próximas fases)" disabled><Bell size={19}/></IconButton>
          <span className="user-avatar" aria-label={identity.state.stage === "verified" ? "Usuário autenticado no ambiente local" : "Perfil demonstrativo"}>{identity.state.profile?.name?.trim().slice(0,1).toUpperCase() || "L"}</span>
        </div>
      </header>
      <main className="main-content" id="conteudo"><div className="main-inner">
        {page === "overview" ? (identity.state.active?
  <Suspense fallback={<Skeleton lines={3}/>}>
    <CashPage key={"dashboard:" + identity.state.active.id + ":" + identity.state.source}
      mode="dashboard" identity={identity.state} onIdentity={()=>goTo("identity")}
      onNavigate={goTo}/>
  </Suspense> : <Dashboard/>) : page === "identity" ?
          <Suspense fallback={<Skeleton lines={3}/>}><IdentityPage state={identity.state} onLoad={identity.load} onPreview={identity.preview} onSelect={identity.selectCompany} onLogout={identity.logout}/></Suspense> :
          page === "orgaos" || page === "fornecedores" ?
            <Suspense fallback={<Skeleton lines={3}/>}><CatalogPage key={page + ":" + (identity.state.active?.id ?? "none") + ":" + identity.state.source}
              kind={page} identity={identity.state} onIdentity={()=>goTo("identity")}/></Suspense> :
          page === "tenders" ?
            <Suspense fallback={<Skeleton lines={3}/>}>
              <TenderPage key={page + ":" + (identity.state.active?.id ?? "none") + ":" + identity.state.source}
                identity={identity.state} onIdentity={()=>goTo("identity")}/>
            </Suspense> :
          page === "commitments" || page === "purchases" ?
            <Suspense fallback={<Skeleton lines={3}/>}>
              <CommercialPage key={page + ":" + (identity.state.active?.id ?? "none") + ":" + identity.state.source}
                kind={page} identity={identity.state} onIdentity={()=>goTo("identity")}
                onNavigate={goTo}/>
            </Suspense> :
          ["pricing","notifications","settings","team","audit","help"].includes(page) ?
            <Suspense fallback={<Skeleton lines={3}/>}>
              <ToolsPage key={"tools:"+page+":"+(identity.state.active?.id??"none")+":"+identity.state.source}
                mode={page as "pricing"|"notifications"|"settings"|"team"|"audit"|"help"}
                identity={identity.state} onIdentity={()=>goTo("identity")}/>
            </Suspense> :
          page === "documents" ?
            <Suspense fallback={<Skeleton lines={3}/>}>
              <DocumentsPage key={"documents:" + (identity.state.active?.id ?? "none") + ":" + identity.state.source}
                identity={identity.state} onIdentity={()=>goTo("identity")}/>
            </Suspense> :
          page === "receivables" ?
            <Suspense fallback={<Skeleton lines={3}/>}>
              <CashPage key={"receivables:" + (identity.state.active?.id ?? "none") + ":" + identity.state.source}
                mode="receivables" identity={identity.state} onIdentity={()=>goTo("identity")}
                onNavigate={goTo}/>
            </Suspense> :
          page === "shipments" || page === "invoices" ?
            <Suspense fallback={<Skeleton lines={3}/>}>
              <FulfillmentPage key={page + ":" + (identity.state.active?.id ?? "none") + ":" + identity.state.source}
                kind={page} identity={identity.state} onIdentity={()=>goTo("identity")}/>
            </Suspense> :
          page === "finance" || page === "titles" || page === "recurrences" ?
            <Suspense fallback={<Skeleton lines={3}/>}>
              <FinancePage key={page + ":" + (identity.state.active?.id ?? "none") + ":" + identity.state.source}
                mode={page === "finance" ? "overview" : page}
                identity={identity.state} onIdentity={()=>goTo("identity")}
                onNavigate={mode=>goTo(mode === "overview" ? "finance" : mode)}/>
            </Suspense> :
          page === "components" ? <ComponentGallery/> : <Performance/>}
        <footer className="page-footer"><span>Lunaris Licita · Fundação F0/F1/F2/F3/F4/F5/F6/F7/F8/F9/F10</span><span>Sem conexão com dados reais <span className="footer-divider">·</span> <span>Identidade inspirada no Órbita</span></span></footer>
      </div></main>
    </div>
    <button className="gabi-launcher" type="button" aria-label={gabiOpen ? "Ocultar painel da Gabi" : "Abrir apresentação da Gabi"} aria-expanded={gabiOpen} onClick={() => setGabiOpen(o => !o)}><Sparkles size={20} aria-hidden="true"/><span>Gabi</span></button>
    {gabiOpen && <Suspense fallback={<div className="gabi-panel gabi-loading" role="status">Preparando apresentação…</div>}><GabiPanel key={(identity.state.active?.id||"none")+":"+identity.state.stage} onClose={() => setGabiOpen(false)} identity={identity.state} onIdentity={()=>goTo("identity")}/></Suspense>}
  </div>;
}
