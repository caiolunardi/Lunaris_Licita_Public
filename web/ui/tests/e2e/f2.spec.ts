import {test,expect} from "@playwright/test";
for(const width of [390,768,1280]){
 test(`F2: cadastro e desativação fictícios, navegação e zero persistência ${width}px`,async({page})=>{
   await page.setViewportSize({width,height:850});
   await page.goto("/identidade");
   await expect(page.getByText("Serviço de identidade indisponível")).toBeVisible();
   await page.getByRole("button",{name:"Duas empresas fictícias"}).click();
   await page.getByRole("button",{name:/Empresa Aurora \(fictícia\)/}).click();
   const navigate=async(name:string)=>{
     if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
     await page.getByRole("link",{name}).click();
   };
   await navigate("Órgãos");
   await expect(page.getByRole("heading",{name:"Órgãos",exact:true})).toBeVisible();
   await expect(page.getByText("Instituto Aurora — fictício")).toBeVisible();
   await page.getByRole("button",{name:"Novo órgão"}).click();
   await page.getByRole("textbox",{name:"Nome *"}).fill("Órgão Demonstrativo Novo");
   await page.getByRole("button",{name:/Salvar cadastro/}).click();
   const row=page.getByRole("row",{name:/Órgão Demonstrativo Novo/});
   await expect(row).toBeVisible();
   await row.getByRole("button",{name:"Editar"}).click();
   await page.getByRole("textbox",{name:"Nome *"}).fill("Órgão Demonstrativo Editado");
   await page.getByRole("button",{name:/Salvar cadastro/}).click();
   const edited=page.getByRole("row",{name:/Órgão Demonstrativo Editado/});
   await edited.getByRole("button",{name:"Desativar"}).click();
   await expect(page.getByRole("alertdialog")).toBeVisible();
   await page.getByRole("button",{name:/Confirmar desativação/}).click();
   await expect(edited).toHaveCount(0);
   await navigate("Fornecedores");
   await expect(page.getByRole("heading",{name:"Fornecedores",exact:true})).toBeVisible();
   await expect(page.getByText("Fornecedor Atlântico — fictício")).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
   expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/tenant|company|orgao|fornecedor|cadastro|jwt/i.test(k)))).toEqual([]);
   await page.reload();
   await expect(page.getByText("Nenhuma empresa autorizada ativa")).toBeVisible();
   await page.screenshot({path:`test-results/f2-${width}px.png`,fullPage:true});
 });
}
test("F2: API não habilitada no Worker do laboratório padrão",async({request})=>{
 for(const route of [
   "/api/v1/companies/e1/orgaos","/api/v1/companies/e1/fornecedores",
   "/api/v1/companies/e1/orgaos/item1"
 ]){
   const response=await request.get(route);
   expect(response.status()).toBe(503);
   expect(await response.json()).toEqual({error:"f2_not_enabled"});
 }
});
