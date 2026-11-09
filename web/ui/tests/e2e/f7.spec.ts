import {test,expect} from "@playwright/test";
for(const width of [390,768,1280]){
 test("F7 pessoa leiga: plano seguro, recebimento e isolamento "+width+"px",async({page})=>{
  await page.setViewportSize({width,height:850});
  await page.goto("/identidade");
  await page.getByRole("button",{name:"Duas empresas fictícias"}).click();
  await page.getByRole("button",{name:/Empresa Aurora \(fictícia\)/}).click();
  const nav=async(name:string)=>{
   if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
   await page.getByRole("link",{name,exact:true}).click();
  };
  await nav("Visão geral");
  await expect(page.getByRole("heading",{name:"Seu dinheiro, sem complicação"})).toBeVisible();
  await expect(page.getByText("Ainda não calculado")).toBeVisible();
  await expect(page.getByText(/Ainda pode entrar no mês/)).toBeVisible();
  await page.getByRole("button",{name:"Preencher saldo de exemplo"}).click();
  await page.getByRole("textbox",{name:"Reserva que não quero gastar"}).fill("1.000,00");
  await page.getByRole("checkbox").check();
  await expect(page.getByText("R$ 2.771,20",{exact:true})).toBeVisible();
  await nav("A receber");
  await expect(page.getByRole("heading",{name:"Dinheiro que falta receber"})).toBeVisible();
  await page.getByRole("button",{name:"Abrir parcela"}).first().click();
  await expect(page.getByRole("heading",{name:"Dinheiro que realmente entrou"})).toBeVisible();
  await page.getByRole("textbox",{name:"Valor recebido no banco"}).fill("500,00");
  await page.getByRole("checkbox").check();
  await page.getByRole("button",{name:"Confirmar dinheiro recebido"}).click();
  await expect(page.getByText(/Crédito marcado apenas na demonstração/)).toBeVisible();
  await expect(page.getByText("R$ 3.000,00",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Corrigir lançamento"}).click();
  await page.getByRole("textbox",{name:"Motivo do estorno"}).fill("Lançamento incorreto para demonstração");
  await page.getByRole("checkbox",{name:/Entendi: o estorno/}).check();
  await page.getByRole("button",{name:"Confirmar correção"}).click();
  await expect(page.getByText(/Registro estornado apenas na demonstração/)).toBeVisible();
  await page.getByRole("button",{name:"Voltar às parcelas"}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)).toBe(false);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>
   /saldo|bank|banco|caixa|receber|recebimento|finance|company|empresa|tenant|jwt/i.test(k)))).toEqual([]);
  await page.screenshot({path:"test-results/f7-"+width+"px.png",fullPage:true});
  await nav("Identidade e acesso");
  await page.getByRole("button",{name:/Empresa Horizonte \(fictícia\)/}).click();
  await nav("A receber");
  await expect(page.getByText("NF FICTÍCIA 001")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Corrigir lançamento"})).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading",{name:"Seu dinheiro começa com a empresa certa"})).toBeVisible();
 });
}
test("F7 routes never become remote available without local DB/flags",async({request})=>{
 for(const url of ["/api/v1/companies/e1/cash/overview?month=2026-11",
  "/api/v1/companies/e1/cash/receivables",
  "/api/v1/companies/e1/cash/receivables/c1"]){
  const r=await request.get(url);
  expect(r.status()).toBe(503);expect(await r.json()).toEqual({error:"f7_not_enabled"});
 }
});
