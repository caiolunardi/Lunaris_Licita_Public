// R7 E2: guarda contra matrizes que afirmem cobertura sem testes executáveis.
// Rastreabilidade NÃO substitui a execução Workerd/SQLite da CI.
// Fonte normativa: 43 negativos + 15 positivos em CONTRATOS_TESTES_RELACIONAIS_V1.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {LEGACY_FIELD_KEYS} from "../src/r7/legacy-field-keys.mjs";

const text=path=>readFileSync(path,"utf8");
const spec=text("docs/architecture/CONTRATOS_TESTES_RELACIONAIS_V1.md");
const matrix=text("docs/architecture/MATRIZ_R7_58_CONTRATOS.md");
const integration=text("web/integration/r7-miniflare.test.mjs");
const legacy=text("docs/architecture/MATRIZ_COBERTURA_LEGADO_V1.md");
const extractRows=(source,re)=>source.split("\n")
  .map(row=>row.match(re)).filter(Boolean).map(x=>x[1]);
const sourceIds=extractRows(spec,/^\| (FK\d\d|Q\d\d|FIN\d\d|REC\d\d|DOC\d\d|ACC\d\d|OPR\d\d|MIG\d\d|OK\d\d) \|/);
const matrixIds=extractRows(matrix,/^\| ([A-Z]+\d\d) \|/);
const tests=[...integration.matchAll(/test\("([^"]+)"/g)].map(x=>x[1]);
const supports=(id,title)=>new RegExp("(^|[^A-Z0-9])"+id+"($|[^0-9])").test(title);

test("R7 E2 contrato normativo contém 43 rejeições e 15 positivos distintos",()=>{
 assert.equal(sourceIds.length,58);
 assert.equal(new Set(sourceIds).size,58);
 assert.equal(sourceIds.filter(x=>x.startsWith("OK")).length,15);
 assert.equal(sourceIds.filter(x=>!x.startsWith("OK")).length,43);
});
test("R7 E2 matriz possui exatamente os 58 IDs normativos, sem inclusões fictícias",()=>{
 assert.equal(matrixIds.length,58);
 assert.equal(new Set(matrixIds).size,58);
 assert.deepEqual([...matrixIds].sort(),[...sourceIds].sort());
});
test("R7 E2 cada ID normativo aponta para pelo menos um teste HTTP Workerd real",()=>{
 assert.ok(tests.length>=58);
 assert.equal(new Set(tests).size,tests.length,"nomes de teste devem ser únicos");
 const missing=sourceIds.filter(id=>!tests.some(title=>supports(id,title)));
 assert.deepEqual(missing,[],"ID sem prova Workerd nominativa: "+missing.join(", "));
});
test("MIG04 dicionário imutável corresponde aos 350 campos documentados",()=>{
 let section="";
 const discovered=[];
 for(const line of legacy.split("\n")){
  const h=line.match(/^## \d+\.\s+([^→]+?)\s*→/);
  if(h){section=h[1].trim();continue;}
  const m=line.match(/^\|\s*`([^`]+)`\s*\|/);
  if(m&&section)discovered.push(section+"."+m[1]);
 }
 assert.equal(discovered.length,350);
 assert.equal(new Set(discovered).size,350);
 assert.deepEqual([...discovered].sort(),LEGACY_FIELD_KEYS);
});
