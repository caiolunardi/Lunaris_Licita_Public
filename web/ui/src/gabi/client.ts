export type Source={kind:string;label:string;recordId:string|null;url:string};
export type GabiReply={reply:string;mode:"refused"|"deterministic"|"gemini_explanation"|"preview";
 topic:string;readOnly:true;sentExternally:boolean;sources:Source[];
 records?:unknown[];disclaimer?:string};
export type Message={id:string;person:"user"|"gabi";text:string;source:GabiReply|null};
export const safeLinks=new Set(["/ajuda","/documentos","/cotacoes","/contas-pagar","/licitacoes"]);
export const examples=[
 "Quais contas estão por vencer?",
 "Quero entender minhas licitações",
 "Como calcular a margem de lucro?",
 "Onde ficam os comprovantes?"
];
const forbidden=/\b(?:apague|exclua|delete|pague|envie|altere|edite|conceda|revogue|revele|ignore|system prompt|developer prompt|exfiltr)\b/i;
export function demoAnswer(question:string):GabiReply{
 const q=question.toLocaleLowerCase("pt-BR");
 if(forbidden.test(q))return {reply:"Posso ajudar a consultar ou entender os dados, mas não executar pagamentos, exclusões, envios ou alterações.",mode:"refused",topic:"help",readOnly:true,sentExternally:false,sources:[]};
 const type=/conta|boleto|venc|pagar|despesas/.test(q)?"bills":
 /licita|preg[aã]o|edital|processo/.test(q)?"tenders":
 /margem|markup|cota[cç]|pre[cç]o/.test(q)?"quotes":
 /documento|arquivo|anexo|comprovante/.test(q)?"documents":"help";
 const content={
  bills:["Em uma empresa real, eu mostraria apenas contas autorizadas e verificadas. Nesta demonstração, não tenho acesso a boletos nem a saldos reais.","/contas-pagar"],
  tenders:["Posso indicar licitações e ajudar a localizar processos permitidos. Aqui são apenas telas e dados fictícios.","/licitacoes"],
  quotes:["Margem considera o lucro dividido pelo preço de venda. Markup compara o lucro com o custo. Você pode testar valores na calculadora.","/cotacoes"],
  documents:["Os documentos preservam versões e precisam de autorização para leitura. A Gabi não abre nem transmite anexos nesta demonstração.","/documentos"],
  help:["Consigo orientar sobre contas, licitações, cotações e documentos. A Central de ajuda contém instruções passo a passo.","/ajuda"]
 } as const;
 return {reply:content[type][0],mode:"preview",topic:type,readOnly:true,
  sentExternally:false,sources:[{kind:type,label:"Abrir área relacionada",
   recordId:null,url:content[type][1]}],
  disclaimer:"Resposta demonstrativa: nenhum banco, Gemini ou documento real foi consultado."};
}
export function validateReply(v:unknown):v is GabiReply{
 if(!v||typeof v!=="object")return false;
 const x=v as Partial<GabiReply>;
 return typeof x.reply==="string"&&x.reply.length>0&&x.reply.length<=1200&&
  x.readOnly===true&&typeof x.sentExternally==="boolean"&&
  ["refused","deterministic","gemini_explanation"].includes(String(x.mode))&&
  Array.isArray(x.sources)&&x.sources.length<=5&&x.sources.every(s=>
   typeof s.label==="string"&&s.label.length<=120&&safeLinks.has(s.url));
}
