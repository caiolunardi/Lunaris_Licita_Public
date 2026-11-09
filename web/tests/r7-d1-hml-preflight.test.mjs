// R7 E5 D1: sem rede, credencial nem execucao SQL remota.
import test from "node:test";
import assert from "node:assert/strict";
import {HML_NAME,MIGRATIONS,EXPECTED_TABLES,INVENTORY_SQL,
 buildMigrationManifest,assessReadOnlyInventory} from "../../tools/d1-hml-preflight.mjs";

const sql="-- local\nCREATE TABLE teste (id TEXT PRIMARY KEY);";
const mock=()=>buildMigrationManifest({list:()=>[...MIGRATIONS],
 read:name=>sql+" -- "+name+" \n"});
test("D1 HML 13 migrations sequenciais geram manifest deterministico",()=>{
 const a=mock(),b=mock();
 assert.equal(a.database,"lunaris-licita-hml");
 assert.equal(a.migrationCount,13);
 assert.equal(a.manifestSha256,b.manifestSha256);
 assert.equal(EXPECTED_TABLES,49);
 assert.equal(a.readyForRemoteApply,false);
 assert.match(INVENTORY_SQL,/sqlite_master/);
});
test("D1 HML arquivo ausente ou migration extra exige revisao",()=>{
 assert.throws(()=>buildMigrationManifest({list:()=>MIGRATIONS.slice(0,12),
 read:()=>sql}),/migration_list_changed/);
 assert.throws(()=>buildMigrationManifest({list:()=>[...MIGRATIONS,"0014_unknown.sql"],
 read:()=>sql}),/migration_list_changed/);
});
test("D1 HML mudanca de conteudo altera impressao digital",()=>{
 const a=mock(),b=buildMigrationManifest({list:()=>[...MIGRATIONS],
 read:name=>sql+" -- "+name+" \n"+(name==="0013_ddl_v1r_r7_etapa4_backup_ledger.sql"?"-- changed":"")});
 assert.notEqual(a.manifestSha256,b.manifestSha256);
});
test("D1 HML inventario zerado representa candidato, nao autorizacao",()=>{
 const empty=assessReadOnlyInventory([{results:[],success:true}]);
 assert.equal(empty.status,"EMPTY_SCHEMA_CANDIDATE");
 assert.equal(empty.readyForRemoteApply,false);
 assert.equal(empty.liveEvidenceVerified,false);
 assert.equal(empty.backupVerified,false);
});
test("D1 HML qualquer tabela existente bloqueia aplicacao automatica",()=>{
 for(const rows of [[{type:"table",name:"usuarios"}],
   [{type:"table",name:"d1_migrations"}],
   [{type:"trigger",name:"trg_suspicious"}]]){
  const result=assessReadOnlyInventory(JSON.stringify([{results:rows,success:true}]));
  assert.equal(result.status,"BLOCKED_EXISTING_SCHEMA");
  assert.equal(result.readyForRemoteApply,false);
 }
});
test("D1 HML recusa alvo que nao seja HML, formatos e duplicatas",()=>{
 assert.throws(()=>assessReadOnlyInventory([],{database:"lunaris-licita-prod"}),/wrong_target/);
 assert.throws(()=>assessReadOnlyInventory([{results:[{type:"table",name:"usuarios"},{type:"table",name:"usuarios"}]}]),/duplicate/);
 assert.throws(()=>assessReadOnlyInventory([{results:[{type:"table",name:"a'; DROP TABLE users;--"}]}]),/format/);
 assert.throws(()=>assessReadOnlyInventory([{results:[{type:"table",name:"_cf_KV"}]}]),/format/);
 assert.throws(()=>assessReadOnlyInventory([{results:[],success:false}]),/query_failed/);
});
test("D1 HML nao aceita SQL com ATTACH ou VACUUM INTO no manifest",()=>{
 for(const malicious of ["ATTACH DATABASE 'x' AS other","VACUUM INTO 'x'"]){
  assert.throws(()=>buildMigrationManifest({list:()=>[...MIGRATIONS],
   read:()=>sql+"; "+malicious}),/migration_sql_unexpected/);
 }
});
