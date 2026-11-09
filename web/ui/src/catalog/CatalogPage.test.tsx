import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import CatalogPage from "./CatalogPage";
import type {IdentityState} from "../identity/session";
const preview=(role:"OPERADOR"|"CONSULTA"="OPERADOR"):IdentityState=>({
 stage:"preview",source:"fixture",pending:false,message:null,profile:null,companies:[],
 active:{id:"f1-demo-aurora",name:"Empresa Aurora (fictícia)",role,
 permissions:{canRead:true,canWrite:role!=="CONSULTA",canApprove:false}}
});
const locked:IdentityState={
 stage:"unavailable",source:"server",pending:false,message:null,
 profile:null,companies:[],active:null
};
it("F2 não busca órgãos sem empresa autorizada",()=>{
 const fetchSpy=vi.spyOn(globalThis,"fetch");
 render(<CatalogPage kind="orgaos" identity={locked} onIdentity={vi.fn()}/>);
 expect(screen.getByText("Nenhuma empresa autorizada ativa")).toBeTruthy();
 expect(fetchSpy).not.toHaveBeenCalled();
 fetchSpy.mockRestore();
});
it("F2 cria e desativa registro fictício sem persistir ou chamar API",async()=>{
 const fetchSpy=vi.spyOn(globalThis,"fetch");
 render(<CatalogPage kind="orgaos" identity={preview()} onIdentity={vi.fn()}/>);
 expect(screen.getByText("Instituto Aurora — fictício")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Novo órgão"}));
 fireEvent.change(screen.getByRole("textbox",{name:"Nome *"}),{target:{value:"Órgão Demonstrativo Novo"}});
 fireEvent.click(screen.getByRole("button",{name:/Salvar cadastro/}));
 expect(await screen.findByText("Órgão Demonstrativo Novo")).toBeTruthy();
 const row=screen.getByRole("row",{name:/Órgão Demonstrativo Novo/});
 fireEvent.click(row.querySelector("button:last-child") as HTMLButtonElement);
 expect(screen.getByRole("alertdialog")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:/Confirmar desativação/}));
 await waitFor(()=>expect(screen.queryByText("Órgão Demonstrativo Novo")).toBeNull());
 expect(fetchSpy).not.toHaveBeenCalled();
 fetchSpy.mockRestore();
});
it("F2 papel consulta vê cadastro, mas não pode criar/editar/desativar",()=>{
 render(<CatalogPage kind="fornecedores" identity={preview("CONSULTA")} onIdentity={vi.fn()}/>);
 expect(screen.getByRole("button",{name:"Novo fornecedor"}).hasAttribute("disabled")).toBe(true);
 const row=screen.getByRole("row",{name:/Fornecedor Atlântico/});
 expect(row.querySelectorAll("button:disabled").length).toBe(2);
});
it("F2 alternar status filtra inativos apenas na empresa selecionada",()=>{
 render(<CatalogPage kind="orgaos" identity={preview()} onIdentity={vi.fn()}/>);
 expect(screen.queryByText("Fundação Desativada — fictícia")).toBeNull();
 fireEvent.change(screen.getByRole("combobox",{name:"Situação"}),{target:{value:"inactive"}});
 expect(screen.getByText("Fundação Desativada — fictícia")).toBeTruthy();
 expect(screen.queryByText("Instituto Aurora — fictício")).toBeNull();
});
