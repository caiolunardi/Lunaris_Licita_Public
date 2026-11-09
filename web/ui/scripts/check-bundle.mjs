// F0/F7 performance budget: measure what a real visitor downloads on first load,
// plus guardrails on on-demand screens and the complete app. No exception for F7.
import {readdirSync,readFileSync,statSync,existsSync} from "node:fs";
import {join,resolve,relative,basename,dirname} from "node:path";
import {gzipSync} from "node:zlib";
const dist=resolve(process.cwd(),"dist");
const client=existsSync(join(dist,"client","index.html"))?join(dist,"client"):dist;
if(!existsSync(join(client,"index.html")))throw Error("F0_BUDGET_FAIL: missing client entry");
function walk(dir){return readdirSync(dir).flatMap(name=>{
 const path=join(dir,name);return statSync(path).isDirectory()?walk(path):[path];});}
const assets=walk(client),js=assets.filter(f=>f.endsWith(".js")),css=assets.filter(f=>f.endsWith(".css"));
if(!js.length||!css.length)throw Error("F0_BUDGET_FAIL: JS/CSS missing");
const bytes=f=>gzipSync(readFileSync(f),{level:9}).length;
const sizes=new Map(js.map(f=>[resolve(f),bytes(f)]));
const entries=js.filter(f=>/^index(?:-[A-Za-z0-9_-]+)?\.js$/.test(basename(f)));
if(entries.length!==1)throw Error("F0_BUDGET_FAIL: ambiguous entry module");
const required=new Set(),pending=[entries[0]];
const staticImports=/\b(?:import|export)\s*(?:[^"'()]*?\bfrom\s*)?["']([^"']+\.js)["']/g;
while(pending.length){
 const p=resolve(pending.pop());if(required.has(p))continue;
 if(!sizes.has(p))throw Error("F0_BUDGET_FAIL: imported dependency missing");
 required.add(p);
 for(const match of readFileSync(p,"utf8").matchAll(staticImports)){
  const relativePath=match[1];
  const target=relativePath.startsWith("/")?resolve(client,"."+relativePath):
   resolve(dirname(p),relativePath);
  if(!target.startsWith(client+"/"))throw Error("F0_BUDGET_FAIL: import outside client");
  pending.push(target);
 }
}
const first=[...required].reduce((s,f)=>s+sizes.get(f),0);
const total=[...sizes.values()].reduce((a,b)=>a+b,0);
const lazy=[...sizes].filter(([path])=>!required.has(path));
const maxLazyChunk=Math.max(0,...lazy.map(([,size])=>size));
const totalCss=css.reduce((sum,p)=>sum+bytes(p),0);
const firstBudget=120*1024,cssBudget=32*1024;
const chunkBudget=40*1024,totalBudget=240*1024;
for(const p of assets.filter(p=>/\.(js|css)$/.test(p)))
 console.log("F0_ASSET "+relative(client,p)+" gzip="+bytes(p)+" bytes");
console.log("F0_BUDGET first_js_gzip="+first+"/"+firstBudget+
 " total_js_gzip="+total+"/"+totalBudget+" largest_lazy_js_chunk_gzip="+
 maxLazyChunk+"/"+chunkBudget+" total_css_gzip="+totalCss+"/"+cssBudget);
if(first>firstBudget||total>totalBudget||maxLazyChunk>chunkBudget||totalCss>cssBudget)
 throw Error("F0_BUDGET_FAIL: initial or lazy or total transfer exceeds budget");
console.log("F0_BUDGET_PASS: initial path and lazy chunks measured separately");
