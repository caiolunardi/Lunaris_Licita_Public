import type {IdentityState} from "../identity/session";
export type TenderStatus="EM_ANALISE"|"EM_PREPARACAO"|"AGUARDANDO_DISPUTA"|"RESULTADO_PENDENTE"|"CANCELADA";
export type Decision="PENDENTE"|"PARTICIPAR"|"NAO_PARTICIPAR";
export type ItemResult="PENDENTE"|"GANHO"|"PERDIDO"|"CANCELADO";
export type Tender={
 id:string;orgao_id:string;orgao_nome:string;numero:string;ano:number;
 modalidade:string|null;objeto:string|null;portal:string|null;url_processo:string|null;
 limite_proposta_em:string|null;inicio_disputa_em:string|null;
 decisao_participacao:Decision;situacao_participacao:TenderStatus;
 responsavel_texto:string|null;observacoes:string|null;encerrada_em:string|null;
 motivo_encerramento:string|null;origem_dado:"NATIVO"|"LEGADO";
 conferencia:"PENDENTE"|"VALIDADO"|"INCONSISTENTE";versao:number;
};
export type TenderItem={
 id:string;licitacao_id:string;numero_item:string;lote:string|null;
 descricao_exigida:string;unidade:string;quantidade_prevista_mil:number;
 valor_proposta_unit_cent:number|null;produto_ofertado:string|null;
 marca_ofertada:string|null;modelo_ofertado:string|null;resultado:ItemResult;
 quantidade_ganha_mil:number|null;valor_final_unit_cent:number|null;
 observacoes:string|null;origem_dado:"NATIVO"|"LEGADO";
 conferencia:string;versao:number;
};
export type TenderCycle={id:string;encerrada_em:string;reaberta_em:string|null;
 motivo:string;motivo_reabertura:string|null;versao:number};
export type TenderDocument={vinculo_id:string;papel:"EDITAL"|"PROPOSTA";
 documento_id:string;titulo:string|null;nome_original:string|null;
 estado_integridade:string|null;numero_versao:number|null;origem_dado:string};
export type TenderCommitment={id:string;numero:string;situacao:string|null;versao:number};
export type TenderDetail={item:Tender;items:TenderItem[];cycles:TenderCycle[];
 documents:TenderDocument[];commitments:TenderCommitment[]};
export type Agency={id:string;nome:string};
export type TenderProps={identity:IdentityState;onIdentity:()=>void};
export type TenderForm={
 orgaoId:string;numero:string;ano:string;modalidade:string;objeto:string;
 portal:string;urlProcesso:string;limitePropostaEm:string;inicioDisputaEm:string;
 decisaoParticipacao:Decision;situacaoParticipacao:TenderStatus;
 responsavelTexto:string;observacoes:string
};
export type TenderItemForm={
 numeroItem:string;lote:string;descricaoExigida:string;unidade:string;
 quantidadePrevista:string;valorProposta:string;produtoOfertado:string;
 marcaOfertada:string;modeloOfertado:string;observacoes:string;
};
export const blankTender=():TenderForm=>({
 orgaoId:"",numero:"",ano:String(new Date().getFullYear()),modalidade:"Pregão eletrônico",
 objeto:"",portal:"",urlProcesso:"",limitePropostaEm:"",inicioDisputaEm:"",
 decisaoParticipacao:"PENDENTE",situacaoParticipacao:"EM_ANALISE",
 responsavelTexto:"",observacoes:""
});
export const blankItem=():TenderItemForm=>({
 numeroItem:"",lote:"",descricaoExigida:"",unidade:"UN",
 quantidadePrevista:"",valorProposta:"",produtoOfertado:"",
 marcaOfertada:"",modeloOfertado:"",observacoes:""
});
export function integerMil(raw:string):number|null{
 if(!/^(?:0|[1-9]\d{0,11})(?:,\d{1,3})?$/.test(raw.trim()))return null;
 const [n,part=""]=raw.trim().split(",");
 const val=BigInt(n)*1000n+BigInt(part.padEnd(3,"0"));
 if(val<=0n||val>BigInt(Number.MAX_SAFE_INTEGER))return null;
 return Number(val);
}
export function milToText(value:number|null):string{
 if(value===null||!Number.isSafeInteger(value)||value<0)return "—";
 return new Intl.NumberFormat("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:3}).format(value/1000);
}
export function toISO(value:string):string|null{
 if(!value)return null;
 const date=new Date(value);
 return Number.isFinite(date.getTime())?date.toISOString():null;
}
export function localTime(value:string|null):string{
 if(!value)return "";
 const v=new Date(value);
 if(!Number.isFinite(v.getTime()))return "";
 const pad=(x:number)=>String(x).padStart(2,"0");
 return v.getFullYear()+"-"+pad(v.getMonth()+1)+"-"+pad(v.getDate())+
  "T"+pad(v.getHours())+":"+pad(v.getMinutes());
}
export const tenderStatus=(s:string|null)=>({
 EM_ANALISE:"Em análise",EM_PREPARACAO:"Em preparação",
 AGUARDANDO_DISPUTA:"Aguardando disputa",RESULTADO_PENDENTE:"Resultado pendente",
 CANCELADA:"Cancelada"
}[s||""]||"Não informada");
export const itemResult=(s:string|null)=>({
 PENDENTE:"Pendente",GANHO:"Ganho",PERDIDO:"Perdido",CANCELADO:"Cancelado"
}[s||""]||"Não informado");
