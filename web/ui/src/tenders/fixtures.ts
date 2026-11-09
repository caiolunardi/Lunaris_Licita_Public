import {blankTender,type Tender,type TenderDetail,type TenderItem,type Agency} from "./types";
const ids=(c:string)=>c.includes("horizonte")?"h":"a";
export function demoAgencies(c:string):Agency[]{
 const x=ids(c);
 return x==="h"?[{id:"f4-demo-h-org1",nome:"Órgão Horizonte — fictício"}]:
 [{id:"f4-demo-a-org1",nome:"Secretaria Aurora — fictícia"},{id:"f4-demo-a-org2",nome:"Autarquia Azul — fictícia"}];
}
export function demoTenders(company:string):TenderDetail[]{
 const x=ids(company),agency=demoAgencies(company)[0],id="f4-demo-"+x+"-licitacao-1";
 const tender:Tender={id,orgao_id:agency.id,orgao_nome:agency.nome,
  numero:x==="h"?"Dispensa 001/2027":"Pregão 042/2027",ano:2027,
  modalidade:x==="h"?"Dispensa":"Pregão eletrônico",
  objeto:x==="h"?"Materiais administrativos fictícios":"Equipamentos de informática fictícios",
  portal:"Portal de demonstração",url_processo:null,limite_proposta_em:null,
  inicio_disputa_em:null,decisao_participacao:"PARTICIPAR",
  situacao_participacao:"RESULTADO_PENDENTE",responsavel_texto:null,observacoes:null,
  encerrada_em:null,motivo_encerramento:null,origem_dado:"NATIVO",
  conferencia:"VALIDADO",versao:1};
 const entry=(i:number,descricao:string,resultado:TenderItem["resultado"],qty:number,gained:number|null):TenderItem=>({
  id:id+"-item-"+i,licitacao_id:id,numero_item:String(i),lote:"L0"+i,descricao_exigida:descricao,
  unidade:"UN",quantidade_prevista_mil:qty,valor_proposta_unit_cent:82000,
  produto_ofertado:"Equipamento de demonstração",marca_ofertada:"Marca fictícia",
  modelo_ofertado:"Modelo X",resultado,quantidade_ganha_mil:gained,
  valor_final_unit_cent:gained?78000:null,observacoes:null,origem_dado:"NATIVO",
  conferencia:"VALIDADO",versao:1});
 return [{item:tender,items:x==="h"?[entry(1,"Materiais sintéticos","PENDENTE",5000,null)]:
  [entry(1,"Computadores fictícios","GANHO",10000,3000),entry(2,"Monitores fictícios","PERDIDO",8000,null)],
  cycles:[],documents:[],commitments:[]}];
}
export function demoNewTender(company:string,form:ReturnType<typeof blankTender>,agency:string):TenderDetail{
 const ag=demoAgencies(company).find(a=>a.id===form.orgaoId);
 return {item:{
  id:"f4-demo-"+ids(company)+"-new-"+crypto.randomUUID(),orgao_id:form.orgaoId,
  orgao_nome:ag?.nome||agency,numero:form.numero,ano:Number(form.ano),modalidade:form.modalidade||null,
  objeto:form.objeto||null,portal:form.portal||null,url_processo:form.urlProcesso||null,
  limite_proposta_em:null,inicio_disputa_em:null,decisao_participacao:form.decisaoParticipacao,
  situacao_participacao:form.situacaoParticipacao,responsavel_texto:form.responsavelTexto||null,
  observacoes:form.observacoes||null,encerrada_em:null,motivo_encerramento:null,
  origem_dado:"NATIVO",conferencia:"VALIDADO",versao:1
 },items:[],cycles:[],documents:[],commitments:[]};
}
