import {test,expect} from "@playwright/test";
for(const width of [390,768,1280]){
 test("F9 orientação leiga, cálculo e cotações sintéticas "+width+"px",async({page})=>{
  await page.setViewportSize({width,height:850});
  await page.goto("/identidade");
  await page.getByRole("button",{name:"Duas empresas fictícias"}).click();
  await page.getByRole("button",{name:/Empresa Aurora \(fictícia\)/}).click();
  const nav=async(label:string)=>{
   if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
   await page.getByRole("link",{name:label,exact:true}).click();
  };
  await nav("Calculadora e cotações");
  await expect(page.getByRole("heading",{name:"Calcule preços com confiança."})).toBeVisible();
  await page.getByRole("textbox",{name:"Preço que pensa cobrar por unidade (opcional)"}).fill("100,00");
  await page.getByRole("button",{name:"Calcular meu preço"}).click();
  await expect(page.getByText("Lucro líquido estimado")).toBeVisible();
  await expect(page.getByText("20%",{exact:true}).first()).toBeVisible();
  await expect(page.getByText("25%",{exact:true}).first()).toBeVisible();
  await page.getByRole("textbox",{name:"Descrição da cotação"}).fill("Teste de equipamentos");
  await page.getByRole("button",{name:"Salvar cotação"}).click();
  await expect(page.getByText("Cotação registrada apenas nesta demonstração. Não há dados salvos.")).toBeVisible();
  await expect(page.getByText("Teste de equipamentos")).toBeVisible();
  await nav("Avisos");
  await expect(page.getByRole("heading",{name:"Avisos sem surpresas."})).toBeVisible();
  await expect(page.getByText(/E-mails e avisos automáticos ainda NÃO são enviados/)).toBeVisible();
  await expect(page.getByText(/Somente um administrador autorizado/)).toBeVisible();
  await nav("Central de ajuda");
  await expect(page.getByRole("heading",{name:"Central de ajuda."})).toBeVisible();
  await page.getByRole("searchbox",{name:"Buscar na ajuda"}).fill("recebimentos");
  await expect(page.getByText(/Recebimentos previstos são dinheiro disponível/)).toBeVisible();
  await page.screenshot({path:"test-results/f9-"+width+"px.png",fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await nav("Equipe e acessos");
  await expect(page.getByRole("heading",{name:"Equipe e permissões."})).toBeVisible();
  await expect(page.getByText(/Entre numa empresa com autorização ADMIN/)).toBeVisible();
  await nav("Identidade e acesso");
  await page.getByRole("button",{name:/Empresa Horizonte \(fictícia\)/}).click();
  await nav("Calculadora e cotações");
  await expect(page.getByText("Teste de equipamentos")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading",{name:"Selecione sua empresa primeiro"})).toBeVisible();
 });
}
test("F9 no backend exposed in published/no bindings",async({request})=>{
 for(const [path,method] of [
  ["/api/v1/companies/e1/tools/quotes","GET"],
  ["/api/v1/companies/e1/tools/settings","GET"],
  ["/api/v1/companies/e1/tools/notifications","GET"],
  ["/api/v1/companies/e1/tools/members","GET"],
  ["/api/v1/companies/e1/tools/audit","GET"]
 ]){
  const result=await request.fetch(path,{method});
  expect(result.status()).toBe(503);
  expect(await result.json()).toEqual({error:"f9_not_enabled"});
 }
});
