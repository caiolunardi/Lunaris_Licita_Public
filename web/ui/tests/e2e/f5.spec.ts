import {test,expect} from "@playwright/test";
for(const width of [390,768,1280]){
 test("F5: empenho parcial, compra fracionada, multiempresa, sem dados persistentes "+width+"px",async({page})=>{
  await page.setViewportSize({width,height:850});
  await page.goto("/identidade");
  await page.getByRole("button",{name:"Duas empresas fictícias"}).click();
  await page.getByRole("button",{name:/Empresa Aurora \(fictícia\)/}).click();
  const nav=async(name:string)=>{
   if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
   await page.getByRole("link",{name,exact:true}).click();
  };
  await nav("Empenhos");
  await expect(page.getByRole("heading",{name:"Empenhos",exact:true})).toBeVisible();
  await expect(page.getByText(/Demonstração sintética; sem persistência/)).toBeVisible();
  await expect(page.getByRole("row",{name:/NE 042\/2027/})).toBeVisible();
  await page.getByRole("row",{name:/NE 042\/2027/}).getByRole("button",{name:"Abrir ficha"}).click();
  await expect(page.getByText("Computadores fictícios")).toBeVisible();
  await page.getByRole("button",{name:"Voltar à lista"}).click();
  await page.getByRole("button",{name:"Registrar empenho"}).click();
  await page.getByRole("combobox",{name:"Licitação de origem *"}).selectOption("f4-demo-a-licitacao-1");
  await expect(page.getByText("1",{exact:true}).first()).toBeVisible();
  await page.getByRole("textbox",{name:"Número do empenho *"}).fill("NE Nova F5 "+width);
  await page.getByRole("textbox",{name:"Nova quantidade item 1"}).fill("1");
  await page.getByRole("button",{name:"Registrar empenho"}).click();
  await expect(page.getByRole("heading",{name:"NE Nova F5 "+width})).toBeVisible();
  await expect(page.getByText(/Registro criado apenas na demonstração/)).toBeVisible();
  await page.getByRole("button",{name:"Voltar à lista"}).click();
  await nav("Compras");
  await expect(page.getByRole("heading",{name:"Compras",exact:true})).toBeVisible();
  await expect(page.getByRole("row",{name:/PED 010\/2027/})).toBeVisible();
  await page.getByRole("button",{name:"Registrar compra"}).click();
  await page.getByRole("combobox",{name:"Empenho de origem *"}).selectOption("f5-demo-a-empenho-1");
  await page.getByRole("combobox",{name:"Fornecedor ativo *"}).selectOption("f5-demo-a-s2");
  await page.getByRole("textbox",{name:"Número da compra *"}).fill("PED Novo F5 "+width);
  await page.getByRole("textbox",{name:"Nova quantidade item 1"}).fill("1");
  await page.getByRole("button",{name:"Registrar compra"}).click();
  await expect(page.getByRole("heading",{name:"PED Novo F5 "+width})).toBeVisible();
  await expect(page.getByText("Distribuidora Norte (fictícia)")).toBeVisible();
  await expect(page.getByText(/não emite boletos, notas fiscais nem recebíveis/)).toBeVisible();
  await page.getByRole("button",{name:"Editar custos e prazos"}).click();
  await page.getByRole("textbox",{name:"Frete R$ *"}).fill("150,00");
  await page.getByRole("textbox",{name:"Outros custos R$ *"}).fill("35,50");
  await page.getByRole("textbox",{name:"Condição de pagamento"}).fill("Pagamento em 30 dias");
  await page.getByLabel("Previsão de entrega").fill("2027-02-20");
  await page.getByRole("button",{name:"Salvar custos e prazos"}).click();
  await expect(page.getByText(/Custos alterados apenas na demonstração/)).toBeVisible();
  await expect(page.getByText(/150,00/)).toBeVisible();
  await expect(page.getByText("2027-02-20")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(x=>/empenho|compra|fornecedor|empresa|company|tenant|jwt|session/i.test(x)))).toEqual([]);
  await page.screenshot({path:"test-results/f5-"+width+"px.png",fullPage:true});
  await nav("Identidade e acesso");
  await page.getByRole("button",{name:/Empresa Horizonte \(fictícia\)/}).click();
  await nav("Empenhos");
  await expect(page.getByText("NE Nova F5 "+width)).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Registrar empenho"})).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("heading",{name:"Selecione uma empresa autorizada",exact:true})).toBeVisible();
 });
}
test("F5 Worker remoto sem flags não abre APIs de empenho, compra ou saldo",async({request})=>{
 for(const path of [
  "/api/v1/companies/e1/commercial/commitments",
  "/api/v1/companies/e1/commercial/purchases",
  "/api/v1/companies/e1/commercial/tenders/l1/available",
  "/api/v1/companies/e1/commercial/commitments/e1/available"
 ]){
  const response=await request.get(path);
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({error:"f5_not_enabled"});
 }
});
