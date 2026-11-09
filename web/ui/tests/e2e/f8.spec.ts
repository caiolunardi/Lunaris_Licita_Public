import {test,expect} from "@playwright/test";
for(const width of [390,768,1280]){
 test("F8 anexo guiado, versões imutáveis, guarda e isolamento "+width+"px",async({page})=>{
  await page.setViewportSize({width,height:850});
  await page.goto("/identidade");
  await page.getByRole("button",{name:"Duas empresas fictícias"}).click();
  await page.getByRole("button",{name:/Empresa Aurora \(fictícia\)/}).click();
  if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
  await page.getByRole("link",{name:"Documentos",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Arquivos em ordem, sem complicação."})).toBeVisible();
  await expect(page.getByText(/Nenhum arquivo foi enviado a um serviço/)).toBeVisible();
  await page.getByRole("button",{name:/Edital de demonstração.pdf/}).click();
  await expect(page.getByRole("heading",{name:"Versões do arquivo"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Baixar versão"})).toBeVisible();
  await page.getByRole("button",{name:"Baixar versão"}).click();
  await expect(page.getByText(/não contém arquivos reais para baixar/)).toBeVisible();
  await page.getByRole("button",{name:"Voltar à biblioteca"}).click();
  await page.getByRole("button",{name:"Anexar documento"}).click();
  await page.getByLabel("Área do documento").selectOption("conta_receber");
  await page.getByRole("checkbox").check();
  await page.getByLabel("Arquivo para anexar").setInputFiles({
   name:"Retenção de exemplo.pdf",mimeType:"application/pdf",
   buffer:Buffer.from("%PDF-1.7\nprova ficticia")
  });
  await expect(page.getByText(/Retencao de exemplo.pdf/)).toBeVisible();
  await page.getByRole("button",{name:"Guardar documento"}).click();
  await expect(page.getByText(/Nenhum arquivo foi salvo/)).toBeVisible();
  await page.getByRole("button",{name:/Retencao de exemplo.pdf/}).click();
  await page.getByLabel("Nova versão do documento").setInputFiles({
   name:"Retenção atualizada.pdf",mimeType:"application/pdf",
   buffer:Buffer.from("%PDF-1.7\nversao ficticia")
  });
  await page.getByRole("button",{name:"Salvar nova versão"}).click();
  await expect(page.getByText("Versão 2")).toBeVisible();
  await expect(page.getByText("Versão 1")).toBeVisible();
  await page.screenshot({path:"test-results/f8-"+width+"px.png",fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.getByRole("button",{name:"Voltar à biblioteca"}).click();
  if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
  await page.getByRole("link",{name:"Identidade e acesso"}).click();
  await page.getByRole("button",{name:/Empresa Horizonte \(fictícia\)/}).click();
  if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
  await page.getByRole("link",{name:"Documentos"}).click();
  await expect(page.getByRole("button",{name:/Retencao de exemplo.pdf/})).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading",{name:"Escolha a empresa para ver os arquivos"})).toBeVisible();
 });
}
test("F8 production-like paths remain closed without D1/R2/flags",async({request})=>{
 for(const path of ["/api/v1/companies/e1/files","/api/v1/companies/e1/files/owners?type=licitacao",
  "/api/v1/companies/e1/files/abc/content"]){
  const r=await request.get(path);
  expect(r.status()).toBe(503);expect(await r.json()).toEqual({error:"f8_not_enabled"});
 }
});
