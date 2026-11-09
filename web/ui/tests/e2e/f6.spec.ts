import {test,expect} from "@playwright/test";
for(const width of [390,768,1280]){
 test("F6 fluxo visual isolado: remessas, aceite, notas e parcelas "+width+"px",async({page})=>{
  await page.setViewportSize({width,height:850});
  await page.goto("/identidade");
  await page.getByRole("button",{name:"Duas empresas fictícias"}).click();
  await page.getByRole("button",{name:/Empresa Aurora \(fictícia\)/}).click();
  const nav=async(label:string)=>{
   if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
   await page.getByRole("link",{name:label,exact:true}).click();
  };
  await nav("Envios");
  await expect(page.getByRole("heading",{name:"Envios",level:1})).toBeVisible();
  await expect(page.getByText(/Demonstração sintética; sem persistência/)).toBeVisible();
  await page.getByRole("button",{name:"Abrir ficha"}).first().click();
  await expect(page.getByText(/Transportadora fictícia/)).toBeVisible();
  await page.getByRole("textbox",{name:"Aceita item 1"}).fill("0,5");
  await page.getByRole("textbox",{name:"Recusada item 1"}).fill("0");
  await page.getByRole("button",{name:"Salvar aceite"}).click();
  await expect(page.getByText(/Aceite salvo somente na demonstração/)).toBeVisible();
  await page.getByRole("button",{name:"Voltar à lista"}).click();
  await page.getByRole("button",{name:"Registrar remessa"}).click();
  await page.getByRole("combobox",{name:"Empenho de origem"}).selectOption("f5-demo-a-empenho-1");
  await page.getByRole("textbox",{name:"Nova quantidade item 1"}).fill("0,5");
  await page.getByRole("button",{name:"Registrar remessa"}).click();
  await expect(page.getByText(/Registro criado apenas na demonstração sintética/)).toBeVisible();
  await page.getByRole("button",{name:"Voltar à lista"}).click();
  await nav("Notas fiscais");
  await expect(page.getByRole("heading",{name:"Notas fiscais",level:1})).toBeVisible();
  await page.getByRole("button",{name:"Abrir ficha"}).first().click();
  await expect(page.getByText(/NF DEMO 001/)).toBeVisible();
  await expect(page.getByRole("cell",{name:"A receber"})).toBeVisible();
  await page.getByRole("button",{name:"Conciliar nota"}).click();
  await expect(page.getByText(/Conciliação demonstrativa/)).toBeVisible();
  await page.getByRole("button",{name:"Voltar à lista"}).click();
  await page.getByRole("button",{name:"Registrar nota fiscal"}).click();
  await page.getByRole("combobox",{name:"Empenho de origem"}).selectOption("f5-demo-a-empenho-1");
  await page.getByRole("textbox",{name:"Nova quantidade item 1"}).fill("1");
  await page.getByRole("button",{name:"Registrar nota fiscal"}).click();
  await expect(page.getByText(/Registro criado apenas na demonstração sintética/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(x=>/remessa|envio|invoice|nota|company|empresa|tenant|jwt/i.test(x)))).toEqual([]);
  await page.screenshot({path:"test-results/f6-"+width+"px.png",fullPage:true});
  await nav("Identidade e acesso");
  await page.getByRole("button",{name:/Empresa Horizonte \(fictícia\)/}).click();
  await nav("Notas fiscais");
  await expect(page.getByText(/NF DEMO 001/)).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Registrar nota fiscal"})).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("heading",{name:"Selecione uma empresa autorizada"})).toBeVisible();
 });
}
test("F6 endpoints sempre fechados no Worker sem flag local",async({request})=>{
 for(const url of ["/api/v1/companies/e1/fulfillment/shipments",
  "/api/v1/companies/e1/fulfillment/invoices",
  "/api/v1/companies/e1/fulfillment/commitments/ep1/available-to-ship",
  "/api/v1/companies/e1/fulfillment/commitments/ep1/available-to-invoice"]){
  const r=await request.get(url);expect(r.status()).toBe(503);
  expect(await r.json()).toEqual({error:"f6_not_enabled"});
 }
});
