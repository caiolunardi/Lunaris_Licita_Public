export function serviceMessage(status:number):string{
 if(status===401)return "Sua sessão expirou; escolha sua empresa novamente.";
 if(status===403)return "Você não tem permissão para esta informação ou ação.";
 if(status===404)return "Registro indisponível ou fora desta empresa.";
 if(status===409)return "Alguém alterou o registro, há uma restrição ou os dados ainda não podem ser confirmados. Atualize antes de tentar outra vez.";
 if(status===503)return "Este serviço local está desabilitado ou indisponível. Nada foi enviado para fora.";
 return "Não foi possível confirmar a operação. Confira os campos e tente novamente.";
}
export const baseUrl=(company:string)=>"/api/v1/companies/"+encodeURIComponent(company)+"/tools";
export async function apiGet<T>(url:string):Promise<T>{
 const result=await fetch(url,{credentials:"same-origin",cache:"no-store",
  headers:{accept:"application/json"}});
 if(!result.ok)throw new Error(serviceMessage(result.status));
 return result.json() as Promise<T>;
}
export async function apiSend<T>(url:string,method:"POST"|"PATCH",data:unknown):Promise<T>{
 const result=await fetch(url,{method,credentials:"same-origin",cache:"no-store",
  headers:{"content-type":"application/json",accept:"application/json"},
  body:JSON.stringify(data)});
 if(!result.ok)throw new Error(serviceMessage(result.status));
 return result.json() as Promise<T>;
}
export function newIntent(){return crypto.randomUUID();}
export function localDateLabel(date:string|null){
 if(!date)return "Data não informada";
 const x=date.slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(x))return "Data não conferida";
 return new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"})
  .format(new Date(x+"T12:00:00Z"));
}
