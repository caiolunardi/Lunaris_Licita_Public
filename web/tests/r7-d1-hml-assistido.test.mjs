import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {snapshotAfter,inventoryFromRows,detectStage,parseJsonRows,
 validateRemoteInfo,validateHealth,buildWindowsWranglerCommand,windowsWranglerInvocation} from "../../tools/d1-hml-assistido.mjs";

const read=name=>readFileSync(resolve("migrations",name),"utf8");
function synthetic(stage,{newTemporal}={}) {
 const expected=snapshotAfter(read,stage),rows=[];
 const rewrite=newTemporal??stage>=11;
 for(const [type,names] of expected)
  for(const name of names){
   let sql="CREATE "+type.toUpperCase()+" "+name;
   if(name==="trg_r5_encerramento_insercao_temporal" && rewrite)
     sql+=" AND substr(NEW.encerrada_em,1,4) GLOB";
   if(name==="trg_r5_reabertura_temporal" && rewrite)
     sql+=" AND substr(NEW.reaberta_em,1,4) GLOB";
   rows.push({type,name,sql});
  }
 return rows;
}
test("D1 HML: todas as fases 0005-0013 detectaveis a partir do sqlite_master",()=>{
 const counts={5:43,6:43,7:45,8:45,9:46,10:46,11:46,12:48,13:49};
 for(const [s,count] of Object.entries(counts)){
  const state=detectStage(inventoryFromRows(synthetic(Number(s))),read);
  assert.equal(state.stage,Number(s));
  assert.equal(state.tables,count);
 }
});
test("D1 HML: schema parcial e tabela extra bloqueiam",()=>{
 let rows=synthetic(6).filter(x=>x.name!=="trg_r7_empenho_limite_insert");
 assert.throws(()=>detectStage(inventoryFromRows(rows),read),/BLOQUEADO/);
 rows=synthetic(5); rows.push({type:"table",name:"usuarios_surpresa",sql:"CREATE TABLE usuarios_surpresa"});
 assert.throws(()=>detectStage(inventoryFromRows(rows),read),/BLOQUEADO/);
});
test("D1 HML: troca de apenas um dos gatilhos da 0011 bloqueia",()=>{
 const rows=synthetic(11);
 const idx=rows.findIndex(x=>x.name==="trg_r5_reabertura_temporal");
 rows[idx].sql="CREATE TRIGGER trg_r5_reabertura_temporal";
 assert.throws(()=>detectStage(inventoryFromRows(rows),read),/0011_parcial/);
});
test("D1 HML: UUID diferente e dados no HML causam bloqueio",()=>{
 assert.deepEqual(validateRemoteInfo(JSON.stringify({
  name:"lunaris-licita-hml",uuid:"27baeb94-1561-4737-85b0-96c86c92e4bd"
 })),{name:"lunaris-licita-hml",uuid:"27baeb94-1561-4737-85b0-96c86c92e4bd"});
 assert.throws(()=>validateRemoteInfo(JSON.stringify({name:"lunaris-licita",uuid:"x"})),/BANCO\/UUID/);
 assert.throws(()=>validateHealth([],[{quick_check:"ok"}],[{empresas:1,usuarios:0,operacoes:0}]),/dados_de_negocio/);
 assert.throws(()=>validateHealth([{table:"x"}],[{quick_check:"ok"}],[{empresas:0,usuarios:0,operacoes:0}]),/foreign_key/);
 assert.throws(()=>validateHealth([],[{quick_check:"error"}],[{empresas:0,usuarios:0,operacoes:0}]),/quick_check/);
});
test("D1 HML: JSON da API é verificado e erros falham fechados",()=>{
 assert.deepEqual(parseJsonRows(JSON.stringify([{success:true,results:[{x:1}]}])),[{x:1}]);
 assert.throws(()=>parseJsonRows("nao-JSON"),/json_invalido/);
 assert.throws(()=>parseJsonRows(JSON.stringify([{success:false,results:[]}])),/sem_sucesso/);
 assert.throws(()=>inventoryFromRows([{type:"table",name:"a"},{type:"table",name:"a"}]),/duplicado/);
});
test("D1 HML: schema de origem 0005 inclui 43 tabelas e 2 triggers bancarios",()=>{
 const state=snapshotAfter(read,5);
 assert.equal(state.get("table").size,43);
 assert.ok(state.get("trigger").has("trg_r7_recebimento_referencia_nativa_valida"));
 assert.ok(state.get("trigger").has("trg_r7_recebimento_referencia_ativa_unica"));
 assert.equal(snapshotAfter(read,13).get("table").size,49);
});

test("D1 HML Windows: npx.cmd recebe wrangler sem aspas, SQL como um argumento",()=>{
 const args=["wrangler","d1","execute","lunaris-licita-hml","--remote",
  "--command","SELECT COUNT(*) AS tabelas FROM sqlite_master;","--json"];
 const command=buildWindowsWranglerCommand(args);
 assert.match(command,/^npx\.cmd wrangler d1 execute lunaris-licita-hml --remote --command /);
 assert.match(command,/--command "SELECT COUNT\(\*\) AS tabelas FROM sqlite_master;" --json$/);
 assert.ok(!command.includes('"wrangler"'));
 const native=windowsWranglerInvocation(args,{nodeExe:"C:\\Program Files\\nodejs\\node.exe",
  exists:()=>true});
 assert.equal(native.command,"C:\\Program Files\\nodejs\\node.exe");
 assert.equal(native.via,"node-npx");
 assert.deepEqual(native.args.slice(1),args);
 const fallback=windowsWranglerInvocation(args,{nodeExe:"C:\\Node\\node.exe",
  exists:()=>false});
 assert.equal(fallback.command,"cmd.exe");
 assert.deepEqual(fallback.args.slice(0,3),["/d","/s","/c"]);
 assert.equal(fallback.args[3],command);
});
test("D1 HML Windows: rejeita argumentos com metacaracteres e comandos fora do D1",()=>{
 assert.throws(()=>buildWindowsWranglerCommand(["wrangler","d1","execute",
  "lunaris-licita-hml","--command","SELECT 1 & echo PWN"]),/argumento_windows_inesperado/);
 assert.throws(()=>windowsWranglerInvocation(["wrangler","deploy"]),/comando_nao_permitido/);
});
