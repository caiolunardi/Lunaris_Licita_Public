import {test,expect} from "@playwright/test";
for(const width of [390,768,1280]){
 test(`F3: fluxo e pagamento/undo, duas empresas, sem persistência ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:850});
  await page.goto("/identidade");
  await expect(page.getByText("Serviço de identidade indisponível")).toBeVisible();
  await page.getByRole("button",{name:"Duas empresas fictícias"}).click();
  await page.getByRole("button",{name:/Empresa Aurora \(fictícia\)/}).click();
  const nav=async(name:string)=>{
   if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
   await page.getByRole("link",{name,exact:true}).click();
  };
  await nav("Fluxo mensal");
  await expect(page.getByRole("heading",{name:"Fluxo de compromissos"})).toBeVisible();
  await expect(page.getByText("Total conhecido de compromissos")).toBeVisible();
  await expect(page.getByText("Informação incompleta")).toBeVisible();
  await nav("Contas a pagar");
  await expect(page.getByRole("heading",{name:"Contas a pagar",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Nova conta"}).click();
  await page.getByRole("textbox",{name:"Beneficiário *"}).fill("Despesa exemplo F3 "+width);
  await page.getByRole("textbox",{name:"Categoria de despesa *"}).fill("Serviços");
  await page.getByRole("textbox",{name:"Valor R$ *"}).fill("150,00");
  await page.getByRole("button",{name:/Salvar com auditoria/}).click();
  const newRow=page.getByRole("row",{name:new RegExp("Despesa exemplo F3 "+width)});
  await expect(newRow).toBeVisible();
  await newRow.getByRole("button",{name:"Abrir ficha"}).click();
  await page.getByRole("button",{name:"Registrar pagamento"}).click();
  await page.getByRole("textbox",{name:"Valor efetivamente pago R$ *"}).fill("150,00");
  await page.getByRole("button",{name:"Confirmar ação"}).click();
  await page.getByRole("combobox",{name:"Situação"}).selectOption("paid");
  const paidRow=page.getByRole("row",{name:new RegExp("Despesa exemplo F3 "+width)});
  await expect(paidRow).toBeVisible();
  await paidRow.getByRole("button",{name:"Abrir ficha"}).click();
  await expect(page.getByText("Quitação",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Desfazer"}).click();
  await page.getByRole("textbox",{name:/Justificativa/}).fill("Pagamento lançado incorretamente");
  await page.getByRole("button",{name:"Confirmar ação"}).click();
  await page.getByRole("combobox",{name:"Situação"}).selectOption("active");
  await expect(page.getByRole("row",{name:new RegExp("Despesa exemplo F3 "+width)})).toBeVisible();
  await nav("Recorrências");
  await page.getByRole("button",{name:"Nova recorrência"}).click();
  await page.getByRole("textbox",{name:"Beneficiário *"}).fill("Contrato recorrente F3 "+width);
  await page.getByRole("textbox",{name:"Categoria *"}).fill("Infraestrutura");
  await page.getByRole("textbox",{name:"Valor mensal R$ *"}).fill("95,90");
  await page.getByRole("button",{name:/Salvar com auditoria/}).click();
  const ruleRow=page.getByRole("row",{name:new RegExp("Contrato recorrente F3 "+width)});
  await expect(ruleRow).toBeVisible();
  await ruleRow.getByRole("button",{name:"Abrir regra"}).click();
  await page.getByRole("button",{name:"Gerar mês"}).click();
  await page.getByRole("button",{name:"Confirmar ação"}).click();
  await nav("Fluxo mensal");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/tenant|company|titulo|finance|boleto|recorrencia|jwt/i.test(k)))).toEqual([]);
  await page.screenshot({path:`test-results/f3-${width}px.png`,fullPage:true});
  await nav("Identidade e acesso");
  await page.getByRole("button",{name:/Empresa Horizonte \(fictícia\)/}).click();
  await nav("Contas a pagar");
  await expect(page.getByText("Despesa exemplo F3 "+width)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Nenhuma empresa ativa")).toBeVisible();
 });
}
test("F3: preview remoto não liga APIs financeiras",async({request})=>{
 for(const path of [
  "/api/v1/companies/e1/finance/titles",
  "/api/v1/companies/e1/finance/recurrences",
  "/api/v1/companies/e1/finance/monthly?month=2026-11"
 ]){
  const r=await request.get(path);
  expect(r.status()).toBe(503);
  expect(await r.json()).toEqual({error:"f3_not_enabled"});
 }
});
