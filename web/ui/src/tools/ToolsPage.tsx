import {lazy,Suspense} from "react";
import {Button,Card,SectionHeading,Skeleton} from "../components/UI";
import type {ToolsProps} from "./types";
const PricingTool=lazy(()=>import("./PricingTool"));
const NotificationsTool=lazy(()=>import("./NotificationsTool"));
const SettingsTool=lazy(()=>import("./SettingsTool"));
const TeamTool=lazy(()=>import("./TeamTool"));
const AuditTool=lazy(()=>import("./AuditTool"));
const HelpTool=lazy(()=>import("./HelpTool"));
export default function ToolsPage(props:ToolsProps){
 if(props.mode==="help")return <Suspense fallback={<Skeleton lines={4}/>}>
  <HelpTool/></Suspense>;
 const company=props.identity.active;
 if(!company)return <Card><SectionHeading title="Selecione sua empresa primeiro"/>
  <p>As cotações, preferências e registros administrativos pertencem à empresa escolhida.
   Nenhuma informação é misturada entre empresas.</p>
  <Button onClick={props.onIdentity}>Escolher empresa</Button></Card>;
 if(props.mode==="pricing")return <Suspense fallback={<Skeleton lines={4}/>}>
  <PricingTool {...props}/></Suspense>;
 const component=props.mode==="notifications"?<NotificationsTool {...props}/>:
  props.mode==="settings"?<SettingsTool {...props}/>:
  props.mode==="team"?<TeamTool {...props}/>:<AuditTool {...props}/>;
 return <Suspense fallback={<Skeleton lines={4}/>}>{component}</Suspense>;
}
