import {test,expect} from "@playwright/test";
for(const width of [390,768,1280]){
 test("F4 licitações: dois itens, ganho parcial, isolamento e responsabilidade "+width+"px",async({page})=>{
  await page.setViewportSize({width,height:850});
  await page.goto("/identidade");
  await page.getByRole("button",{name:"Duas empresas fictícias"}).click();
  await page.getByRole("button",{name:/Empresa Aurora \(fictícia\)/}).click();
  const nav=async(name:string)=>{
   if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
   await page.getByRole("link",{name,exact:true}).click();
  };
  await nav("Licitações");
  await expect(page.getByRole("heading",{name:"Licitações",exact:true})).toBeVisible();
  await expect(page.getByText(/Dados fictícios — somente nesta sessão/)).toBeVisible();
  const seedRow=page.getByRole("row",{name:/Pregão 042\/2027/});
  await seedRow.getByRole("button",{name:"Abrir ficha"}).click();
  await expect(page.getByText("Computadores fictícios")).toBeVisible();
  await expect(page.getByText("Monitores fictícios")).toBeVisible();
  await expect(page.getByText("Nenhum empenho gerado")).toBeVisible();
  await page.getByRole("button",{name:"Voltar à lista"}).click();
  await page.getByRole("button",{name:"Nova licitação"}).click();
  await page.getByRole("combobox",{name:"Órgão *"}).selectOption("f4-demo-a-org1");
  await page.getByRole("textbox",{name:"Número do processo *"}).fill("Pregão F4 "+width);
  await page.getByRole("spinbutton",{name:"Ano *"}).fill("2027");
  await page.getByRole("textbox",{name:"Objeto da licitação"}).fill("Equipamentos fictícios de teste");
  await page.getByRole("button",{name:"Salvar licitação"}).click();
  await expect(page.getByRole("heading",{name:"Pregão F4 "+width})).toBeVisible();
  await page.getByRole("button",{name:"Novo item"}).click();
  await page.getByRole("textbox",{name:"Número do item *"}).fill("1");
  await page.getByRole("textbox",{name:"Descrição exigida *"}).fill("Computador sintético");
  await page.getByRole("textbox",{name:"Quantidade prevista *"}).fill("5");
  await page.getByRole("textbox",{name:"Valor de proposta unitário R$"}).fill("120,00");
  await page.getByRole("button",{name:"Salvar item"}).click();
  let row=page.getByRole("row",{name:/Computador sintético/});
  await row.getByRole("button",{name:"Resultado"}).click();
  await page.getByRole("combobox",{name:"Resultado"}).selectOption("GANHO");
  await page.getByRole("textbox",{name:"Quantidade ganha *"}).fill("2");
  await page.getByRole("textbox",{name:"Preço final unitário R$ *"}).fill("110,00");
  await page.getByRole("button",{name:"Confirmar resultado"}).click();
  row=page.getByRole("row",{name:/Computador sintético/});
  await expect(row.getByText("Ganho",{exact:true})).toBeVisible();
  await expect(row.getByText("2",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Novo item"}).click();
  await page.getByRole("textbox",{name:"Número do item *"}).fill("2");
  await page.getByRole("textbox",{name:"Descrição exigida *"}).fill("Monitor sintético");
  await page.getByRole("textbox",{name:"Quantidade prevista *"}).fill("3");
  await page.getByRole("button",{name:"Salvar item"}).click();
  await page.getByRole("row",{name:/Monitor sintético/}).getByRole("button",{name:"Resultado"}).click();
  await page.getByRole("combobox",{name:"Resultado"}).selectOption("PERDIDO");
  await page.getByRole("button",{name:"Confirmar resultado"}).click();
  await expect(page.getByRole("row",{name:/Monitor sintético/}).getByText("Perdido")).toBeVisible();
  await expect(page.getByText("Nenhum empenho gerado")).toBeVisible();
  await page.getByRole("button",{name:"Encerrar",exact:true}).click();
  await page.getByRole("textbox",{name:"Motivo do ciclo *"}).fill("Resultado final homologado apenas para demonstração");
  await page.getByRole("button",{name:"Encerrar processo"}).click();
  await expect(page.getByText("Comercial encerrado")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/licitac|empresa|tenant|company|jwt|session|award/i.test(k)))).toEqual([]);
  await page.screenshot({path:"test-results/f4-"+width+"px.png",fullPage:true});
  await nav("Identidade e acesso");
  await page.getByRole("button",{name:/Empresa Horizonte \(fictícia\)/}).click();
  await nav("Licitações");
  await expect(page.getByText("Pregão F4 "+width)).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Nova licitação"})).toBeDisabled();
  await page.reload();
  await expect(page.getByText("Selecione uma empresa autorizada")).toBeVisible();
 });
}
test("F4 Worker do preview não libera licitações nem documentos",async({request})=>{
 for(const path of [
  "/api/v1/companies/e1/licitacoes",
  "/api/v1/companies/e1/licitacoes/example",
  "/api/v1/companies/e1/licitacoes/example/documents",
  "/api/v1/companies/e1/licitacoes/example/items"
 ]){
  const r=await request.get(path);
  if(path.endsWith("documents")||path.endsWith("items"))
   expect(r.status()).toBe(405);
  else{
   expect(r.status()).toBe(503);
   expect(await r.json()).toEqual({error:"f4_not_enabled"});
  }
 }
});
