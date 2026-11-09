// R7 E5 A1 - ambiente exclusivo de homologação: sem produção e sem dados reais.
const LAB_HOSTS=new Set(["licita.local.test","localhost","127.0.0.1"]);
export const A1_HML_ORIGIN="https://licita-hml.invalid"; // candidato, DNS/Access não atestados
export const A1_HML_STAGE="a1_hml_synthetic_only";
export const A1_HML_ENABLE="f1_f2_only";
const NEVER_IN_A1=["F3_RUNTIME_ENABLED","F4_RUNTIME_ENABLED","F5_RUNTIME_ENABLED",
 "F6_RUNTIME_ENABLED","F7_RUNTIME_ENABLED","F8_RUNTIME_ENABLED","F9_RUNTIME_ENABLED",
 "F10_RUNTIME_ENABLED","F10_GEMINI_ENABLED","R7_RUNTIME_ENABLED"];
export function a1RuntimeMode(request,env,phase){
 if(!["F1","F2"].includes(phase)||!env?.DB?.prepare||!env.DB.batch)return null;
 let url;try{url=new URL(request.url);}catch{return null;}
 if(url.username||url.password||url.hash)return null;
 if(LAB_HOSTS.has(url.hostname)){
  if(env.F1_RUNTIME_ENABLED==="test_local_only"&&
    (phase==="F1"||env.F2_RUNTIME_ENABLED==="test_local_only"))return "local";
  return null;
 }
 if(url.origin!==A1_HML_ORIGIN||url.protocol!=="https:"||
    env.A1_HML_ORIGIN!==A1_HML_ORIGIN||env.APP_ORIGIN!==A1_HML_ORIGIN||
    env.A1_HML_STAGE!==A1_HML_STAGE||env.A1_HML_ENABLED!==A1_HML_ENABLE||
    env.F1_RUNTIME_ENABLED!==undefined||env.F2_RUNTIME_ENABLED!==undefined||
    NEVER_IN_A1.some(k=>env[k]!==undefined))return null;
 return "hml";
}
export function a1IsHmlReady(request,env){
 return a1RuntimeMode(request,env,"F1")==="hml"&&a1RuntimeMode(request,env,"F2")==="hml";
}
