import {act,renderHook} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {useIdentity} from "./session";

const fakeUser={user:{id:"u1",name:"Pessoa da sessão",email:"person@invalid.test"}};
const companies={companies:[{id:"company-one",name:"Empresa Um",role:"OPERADOR"},{id:"company-two",name:"Empresa Dois",role:"CONSULTA"}]};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
afterEach(()=>vi.unstubAllGlobals());
describe("F1 cliente sem dados persistidos",()=>{
  it("não tenta buscar dados na abertura F0 e carrega empresas somente quando solicitado",async()=>{
    const request=vi.fn(async(url:string)=>{
      if(url==="/api/v1/me")return json(fakeUser);
      if(url==="/api/v1/companies")return json(companies);
      return json({error:"not_found"},404);
    });
    vi.stubGlobal("fetch",request);
    const {result}=renderHook(()=>useIdentity());
    expect(request).not.toHaveBeenCalled();
    await act(async()=>{await result.current.load();});
    expect(result.current.state.stage).toBe("verified");
    expect(result.current.state.companies).toHaveLength(2);
    expect(result.current.state.active).toBeNull();
  });
  it("limpa contexto anterior ANTES de receber a nova empresa",async()=>{
    let finish:(value:Response)=>void=()=>{};
    const request=vi.fn(async(url:string)=>{
      if(url==="/api/v1/me")return json(fakeUser);
      if(url==="/api/v1/companies")return json(companies);
      if(url.includes("company-one"))return json({company:companies.companies[0],permissions:{canRead:true,canWrite:true,canApprove:false}});
      if(url.includes("company-two"))return new Promise<Response>(resolve=>{finish=resolve;});
      return json({error:"not_found"},404);
    });
    vi.stubGlobal("fetch",request);
    const {result}=renderHook(()=>useIdentity());
    await act(async()=>{await result.current.load();});
    await act(async()=>{await result.current.selectCompany("company-one");});
    expect(result.current.state.active?.name).toBe("Empresa Um");
    let promise:Promise<void>=Promise.resolve();
    act(()=>{promise=result.current.selectCompany("company-two");});
    expect(result.current.state.active).toBeNull();
    expect(result.current.state.pending).toBe(true);
    await act(async()=>{
      finish(json({company:companies.companies[1],permissions:{canRead:true,canWrite:false,canApprove:false}}));
      await promise;
    });
    expect(result.current.state.active?.name).toBe("Empresa Dois");
    expect(result.current.state.active?.permissions.canWrite).toBe(false);
  });
  it("não promove fixture a sessão validada nem salva empresa no navegador",async()=>{
    const request=vi.fn();
    vi.stubGlobal("fetch",request);
    const {result}=renderHook(()=>useIdentity());
    act(()=>result.current.preview("multi"));
    expect(result.current.state.stage).toBe("preview");
    await act(async()=>{await result.current.selectCompany("f1-demo-horizonte");});
    expect(result.current.state.active?.role).toBe("CONSULTA");
    expect(result.current.state.source).toBe("fixture");
    expect(request).not.toHaveBeenCalled();
    expect(localStorage.getItem("companyId")).toBeNull();
    await act(async()=>{await result.current.logout();});
    expect(result.current.state.active).toBeNull();
  });
  it("403 ou 401 não revela perfil e empresa",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>json({error:"invalid_token"},401)));
    const {result}=renderHook(()=>useIdentity());
    await act(async()=>{await result.current.load();});
    expect(result.current.state.stage).toBe("denied");
    expect(result.current.state.profile).toBeNull();
    expect(result.current.state.active).toBeNull();
  });
  it("falha na troca da empresa não restaura dados do tenant anterior",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
      if(url==="/api/v1/me")return json(fakeUser);
      if(url==="/api/v1/companies")return json(companies);
      if(url.includes("company-one"))return json({company:companies.companies[0],permissions:{canRead:true,canWrite:true,canApprove:false}});
      return json({error:"forbidden"},403);
    }));
    const {result}=renderHook(()=>useIdentity());
    await act(async()=>{await result.current.load();});
    await act(async()=>{await result.current.selectCompany("company-one");});
    await act(async()=>{await result.current.selectCompany("company-two");});
    expect(result.current.state.active).toBeNull();
    expect(result.current.state.message).toMatch(/Acesso à empresa negado/);
  });
});
