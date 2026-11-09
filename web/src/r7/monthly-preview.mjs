// R7 E2 / REC05 OK07 OK14: visao mensal de compromissos em centavos.
// A regra recorrente so entra como PREVISAO quando titulo da competencia
// nao existe (inclusive cancelado). NUNCA somar titulo e regra juntos.
// Nenhum dado LEGADO inconferido vira valor zero silenciosamente.
// Leitura local, sem alterar nenhuma linha do banco.
import { requireCompanyRole } from "./security.mjs";
import { DomainError, strictlyObject, dueDateForCompetence, money } from "./domain.mjs";

const FIELDS=new Set(["competencia"]);
const MAX=BigInt(Number.MAX_SAFE_INTEGER);
export async function monthlyCommitmentPreview(db,principal,companyId,body) {
 await requireCompanyRole(db,principal,companyId,"read");
 strictlyObject(body,FIELDS);
 dueDateForCompetence(body.competencia,31);
 const month=body.competencia;
 const titled=await db.prepare(
  "SELECT t.id,t.recorrencia_id,t.valor_nominal_cent,t.cancelado,"+
  "t.origem_dado,t.conferencia,s.situacao "+
  "FROM titulos_pagar t JOIN v_titulos_situacao s ON s.id=t.id "+
  "AND s.empresa_id=t.empresa_id "+
  "WHERE t.empresa_id=? AND ((t.recorrencia_id IS NOT NULL AND t.competencia=?) "+
  "OR (t.recorrencia_id IS NULL AND substr(t.vencimento,1,7)=?)) "+
  "ORDER BY t.id LIMIT 5001"
 ).bind(companyId,month,month).all();
 const rows=titled?.results||[];
 if(rows.length>5000)throw new DomainError("too_many_financial_lines",409);
 const seenRules=new Set(),incomplete=[],lines=[];
 let sum=0n;
 for(const t of rows){
  if(t.recorrencia_id)seenRules.add(t.recorrencia_id);
  if(t.cancelado===1)continue;
  if(!money(t.valor_nominal_cent)||t.valor_nominal_cent===0||
    t.situacao==="PENDENTE_CONFERENCIA"||t.situacao==="INCONSISTENTE"||
    (t.origem_dado==="LEGADO"&&t.conferencia!=="VALIDADO")){
   incomplete.push(t.id);
   continue;
  }
  sum+=BigInt(t.valor_nominal_cent);
  lines.push({id:t.id,tipo:"TITULO",valorCent:t.valor_nominal_cent,
    situacao:t.situacao,recorrenciaId:t.recorrencia_id});
 }
 const recurring=await db.prepare(
  "SELECT r.id,r.valor_atual_cent,r.primeiro_vencimento,"+
  "r.ultima_competencia,r.origem_dado,r.conferencia,"+
  "(SELECT MIN(rv.fim_depois) FROM recorrencia_revisoes rv "+
  "WHERE rv.recorrencia_id=r.id AND rv.empresa_id=r.empresa_id "+
  "AND rv.tipo='ENCERRAR') AS fim_depois "+
  "FROM recorrencias r WHERE r.empresa_id=? AND r.estado='ATIVA' "+
  "ORDER BY r.id LIMIT 5001"
 ).bind(companyId).all();
 const rules=recurring?.results||[];
 if(rules.length>5000)throw new DomainError("too_many_recurring_rules",409);
 for(const r of rules){
  if(seenRules.has(r.id)||
   (r.primeiro_vencimento&&r.primeiro_vencimento.slice(0,7)>month)||
   (r.fim_depois&&r.fim_depois<month))continue;
  // Materializacao ja efetuada em mes anterior nao descarta previsao futura.
  if(!money(r.valor_atual_cent)||r.valor_atual_cent===0||
    (r.origem_dado==="LEGADO"&&r.conferencia!=="VALIDADO")){
    incomplete.push("RECORRENCIA:"+r.id);
    continue;
  }
  sum+=BigInt(r.valor_atual_cent);
  lines.push({id:r.id,tipo:"PREVISAO_RECORRENTE",
    valorCent:r.valor_atual_cent,situacao:"PREVISTO",recorrenciaId:r.id});
 }
 if(sum>MAX)throw new DomainError("monthly_amount_overflow",409);
 lines.sort((a,b)=>a.id.localeCompare(b.id)||a.tipo.localeCompare(b.tipo));
 return {competencia:month,totalConhecidoCent:Number(sum),
   completo:incomplete.length===0,incompletos:incomplete.sort(),linhas:lines,
   regraDuplicadaNoTotal:false};
}
