// Gera fixtures SQL do codigo real para prova SQLite LOCAL, sem rede/banco remoto.
import { writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { registerCredit, updateTitleObservation } from "../web/src/r7/domain.mjs";

const principal={issuer:"https://licita-test.cloudflareaccess.com",subject:"sub-test"};
function harness() {
  const captures=[];
  return {
    captures,
    prepare(sql) {
      return {bind(...args) {
        if(sql.includes("INSERT INTO recebimentos")||
           sql.includes("INSERT INTO operacoes")||
           sql.includes("UPDATE titulos_pagar")) captures.push({sql,args});
        return {first:async()=>{
          if(sql.includes("JOIN usuarios_empresas"))return {usuario_id:"user1",papel:"OPERADOR"};
          return null;
        }};
      }};
    },
    async batch() {return [{meta:{changes:0}},{meta:{changes:0}}];}
  };
}
async function capture(action,companyId,body){
  const db=harness();
  try{
    if(action==="credit")await registerCredit(db,principal,companyId,body);
    else await updateTitleObservation(db,principal,companyId,body);
  }catch(error){
    // O mock retorna 0 mudancas propositalmente; qualquer outro erro e defeito.
    if(!["version_conflict","credit_not_allowed_or_insufficient_balance"].includes(error?.code)) throw error;
  }
  if(db.captures.length!==2)throw Error("R7 SQL fixture missing statements");
  return db.captures;
}
const base={contaReceberId:"cr1",valorRecebidoCent:2000,
  retencaoConfirmadaCent:0,dataCredito:"2026-11-07",
  contaDestino:"BB-001",referenciaExterna:"PIX-9"};
const result={
  credit:await capture("credit","e1",{...base,intentId:"intentA"}),
  duplicate:await capture("credit","e1",{...base,intentId:"intentB"}),
  overspend:await capture("credit","e1",{...base,intentId:"intentC",
                         valorRecebidoCent:5000,referenciaExterna:"PIX-10"}),
  legacyUnknown:await capture("credit","e1",{...base,intentId:"intentD",
                         referenciaExterna:"PIX-11"}),
  note:await capture("note","e1",{intentId:"noteA",tituloId:"t1",
                     expectedVersion:1,observacoes:"Nova nota"}),
  staleNote:await capture("note","e1",{intentId:"noteB",tituloId:"t1",
                     expectedVersion:1,observacoes:"Nota obsoleta"}),
  otherCompanyNote:await capture("note","e2",{intentId:"noteC",tituloId:"t1",
                     expectedVersion:1,observacoes:"Tentativa cross-company"})
};
const dest=process.argv[2]||"tests/_r7_statements.generated.json";
writeFileSync(dest,JSON.stringify(result,null,2)+"\n","utf8");
process.stdout.write("R7 SQL fixtures emitted: "+Object.keys(result).join(", ")+"\n");
