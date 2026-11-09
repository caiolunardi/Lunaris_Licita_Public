// Worker de laboratório F0-F8. Financeiro F3 fechado sem gate D1/JWT local.
import {createF1Handler} from "./f1-identity.mjs";
import {createF2Handler} from "./f2-cadastros.mjs";
import {createF3Handler} from "./f3-finance.mjs";
import {createF4Handler} from "./f4-tenders.mjs";
import {createF5Handler} from "./f5-commercial.mjs";
import {createF6Handler} from "./f6-fulfillment.mjs";
import {createF7Handler} from "./f7-cashflow.mjs";
import {createF8Handler} from "./f8-files.mjs";
import {createF9Handler} from "./f9-tools.mjs";
import {createF10Handler} from "./f10-gabi.mjs";
const f10=createF10Handler();
const f1=createF1Handler(),f2=createF2Handler(),f3=createF3Handler(),f4=createF4Handler(),f5=createF5Handler(),f6=createF6Handler(),f7=createF7Handler(),f8=createF8Handler(),f9=createF9Handler();
export default {
 async fetch(request,env){
  return (await f10(request,env)) ?? (await f9(request,env)) ?? (await f8(request,env)) ?? (await f7(request,env)) ?? (await f6(request,env)) ?? (await f5(request,env)) ?? (await f4(request,env)) ?? (await f3(request,env)) ?? (await f2(request,env)) ?? f1(request,env);
 }
};
