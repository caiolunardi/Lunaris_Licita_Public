import test from "node:test";
import assert from "node:assert/strict";
import {HML_OBSERVED_ID,prepareFirstHmlStage,localStage}
 from "../../tools/d1-hml-first-stage.mjs";
const fixture=()=>localStage();
test("E5 D1 HML primeiro estágio é plano puro e banco explicitamente pinado",()=>{
 const s=fixture();
 assert.equal(s.database,"lunaris-licita-hml");
 assert.equal(s.observedDatabaseId,HML_OBSERVED_ID);
 assert.equal(s.firstMigration,"0001_ddl_v1.sql");
 assert.equal(s.expectedFirstMigrationTables,40);
 assert.equal(s.expectedFinalTables,49);
 assert.equal(s.executedRemoteSql,false);
 assert.equal(s.remoteDatabaseInspectedByThisTool,false);
 assert.equal(s.readyForRemoteD1,false);
 assert.match(s.powerShell.integrity,/PRAGMA quick_check/);
 assert.equal(s.status,"PREPARED_MANUAL_EXECUTION_ONLY");
 assert.match(s.powerShell.applyFirst,/^npx\.cmd wrangler d1 execute lunaris-licita-hml --remote --file/);
 assert.ok(!s.powerShell.applyFirst.includes("--yes"));
 assert.ok(!s.powerShell.applyFirst.includes("migrations apply"));
});
test("E5 D1 HML plano não aceita banco ou UUID de outra conta",()=>{
 const s=fixture(),firstSql="CREATE TABLE empresas(id TEXT);"+
   Array(39).fill(0).map((_,i)=>"\nCREATE TABLE a"+i+"(id TEXT);").join("");
 const manifest={database:s.database,migrationCount:13,
  migrations:Array.from({length:13},(_,i)=>({
   name:["0001_ddl_v1.sql","0002_ddl_v1r_r4.sql",
   "0003_ddl_v1r_r5.sql","0004_ddl_v1r_r6.sql","0005_ddl_v1r_r7_w1.sql",
   "0006_ddl_v1r_r7_quantidades.sql","0007_ddl_v1r_r7_etapa1.sql",
   "0008_ddl_v1r_r7_etapa2_guardas.sql",
   "0009_ddl_v1r_r7_etapa2_retificacoes.sql",
   "0010_ddl_v1r_r7_etapa2_retencao_strict.sql",
   "0011_ddl_v1r_r7_etapa2_ciclos_workerd.sql",
   "0012_ddl_v1r_r7_etapa3_iam.sql",
   "0013_ddl_v1r_r7_etapa4_backup_ledger.sql"][i],
   sha256:"a".repeat(64)})),
  manifestSha256:"a".repeat(64)
 };
 for(const x of [
  {databaseName:"lunaris-licita-prod",databaseId:HML_OBSERVED_ID},
  {databaseName:"lunaris-licita-hml",databaseId:"00000000-0000-4000-8000-000000000000"}
 ]){
  assert.throws(()=>prepareFirstHmlStage({...x,manifest,firstSql}),
   /unexpected_database/);
 }
});
test("E5 D1 HML bloqueia sequência de migration adulterada ou arquivo inicial errado",()=>{
 const a=fixture();
 assert.match(a.firstMigrationSha256,/^[a-f0-9]{64}$/);
 assert.match(a.manifestSha256,/^[a-f0-9]{64}$/);
 const invalid={
  database:a.database,migrationCount:13,
  migrations:[{name:"0002_ddl_v1r_r4.sql",sha256:a.firstMigrationSha256}],
  manifestSha256:a.manifestSha256
 };
 assert.throws(()=>prepareFirstHmlStage({
  databaseName:a.database,databaseId:HML_OBSERVED_ID,
  manifest:invalid,firstSql:"CREATE TABLE empresas(id TEXT);"
 }),/migration_manifest_invalid/);
});
