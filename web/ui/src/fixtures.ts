// DADOS FICTÍCIOS. Nunca conectar esta fonte a operações financeiras ou produção.
export const exampleProcesses = [
  { id: "LIC-024", description: "Materiais para laboratório", entity: "Instituto de Pesquisa", status: "Em andamento", tone: "info" as const, date: "12 nov" },
  { id: "LIC-023", description: "Equipamentos de informática", entity: "Secretaria de Tecnologia", status: "Em análise", tone: "warning" as const, date: "14 nov" },
  { id: "LIC-022", description: "Material de escritório", entity: "Fundação Educacional", status: "Concluída", tone: "success" as const, date: "18 nov" },
  { id: "LIC-021", description: "Serviços de manutenção", entity: "Centro Administrativo", status: "Em andamento", tone: "info" as const, date: "21 nov" }
] as const;

export const exampleBars = [
  { label: "Jun", value: 42 }, { label: "Jul", value: 58 },
  { label: "Ago", value: 52 }, { label: "Set", value: 78 },
  { label: "Out", value: 63 }, { label: "Nov", value: 89 }
] as const;

export const phases = [
  "Licitação", "Resultado", "Empenho", "Compra", "Envio", "Nota fiscal", "Recebimento"
] as const;
