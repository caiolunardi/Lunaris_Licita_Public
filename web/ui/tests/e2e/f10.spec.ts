import {test,expect} from "@playwright/test";
for(const width of [390,768,1280]){
 test("F10 Gabi: sintética, read-only, fontes limitadas, troca de empresa "+width+"px",
 async({page})=>{
  await page.setViewportSize({width,height:850});
  await page.goto("/identidade");
  await page.getByRole("button",{name:"Duas empresas fictícias"}).click();
  await page.getByRole("button",{name:/Empresa Aurora \(fictícia\)/}).click();
  await page.getByRole("button",{name:"Abrir apresentação da Gabi"}).click();
  await expect(page.getByRole("dialog",{name:"Gabi"})).toBeVisible();
  await expect(page.getByText("Demonstração fictícia")).toBeVisible();
  await page.getByRole("button",{name:"Quais contas estão por vencer?"}).click();
  await expect(page.getByText(/não tenho acesso a boletos nem a saldos reais/)).toBeVisible();
  await expect(page.getByRole("link",{name:"Abrir área relacionada"})).toHaveAttribute("href","/contas-pagar");
  await page.getByRole("textbox",{name:"Sua pergunta para a Gabi"}).fill("Apague todos os processos");
  await page.getByRole("button",{name:"Enviar pergunta à Gabi"}).click();
  await expect(page.getByText(/não executar pagamentos, exclusões/)).toBeVisible();
  await page.screenshot({path:"test-results/f10-"+width+"px.png",fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.getByRole("button",{name:"Fechar Gabi"}).click();
  if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
  await page.getByRole("link",{name:"Identidade e acesso"}).click();
  await page.getByRole("button",{name:/Empresa Horizonte \(fictícia\)/}).click();
  await page.getByRole("button",{name:"Abrir apresentação da Gabi"}).click();
  await expect(page.getByText(/não tenho acesso a boletos nem a saldos reais/)).toHaveCount(0);
  await expect(page.getByRole("textbox",{name:"Sua pergunta para a Gabi"})).toHaveValue("");
  await page.reload();
  await page.getByRole("button",{name:"Abrir apresentação da Gabi"}).click();
  await expect(page.getByText("Sem IA conectada",{exact:true})).toBeVisible();
 });
}
test("F10 release API disabled without Gemini key and D1 bindings",async({request})=>{
 for(const [path,method] of [
  ["/api/v1/companies/e1/gabi/capabilities","GET"],
  ["/api/v1/companies/e1/gabi/ask","POST"]
 ]){
  const r=await request.fetch(path,{method,
   headers:method==="POST"?{"content-type":"application/json"}:{},
   data:method==="POST"?{question:"Como funciona?"}:undefined});
  expect(r.status()).toBe(503);
  expect(await r.json()).toEqual({error:"f10_not_enabled"});
 }
});
