import {test,expect} from "@playwright/test";

for(const width of [390,768,1280]){
  test(`F1: identidade e contexto fictício sem refresh ou vazamento ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:850});
    await page.goto("/identidade");
    await expect(page.getByRole("heading",{name:"Seu acesso, sob controle."})).toBeVisible();
    await expect(page.getByText("Serviço de identidade indisponível")).toBeVisible();
    await page.getByRole("button",{name:"Duas empresas fictícias"}).click();
    await expect(page.getByText("Empresa Aurora (fictícia)")).toBeVisible();
    await page.getByRole("button",{name:/Empresa Aurora \(fictícia\)/}).click();
    await expect(page.getByText("Alterações: permitidas")).toBeVisible();
    await page.getByRole("button",{name:/Empresa Horizonte \(fictícia\)/}).click();
    await expect(page.getByText("Alterações: negadas")).toBeVisible();
    const before=await page.evaluate(()=>performance.getEntriesByType("navigation").length);
    if(width<=850)await page.getByRole("button",{name:"Abrir navegação"}).click();
    await page.getByRole("link",{name:"Visão geral"}).click();
    expect(await page.evaluate(()=>performance.getEntriesByType("navigation").length)).toBe(before);
    await expect(page.locator(".f4-company strong")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading",{name:"Uma visão mais clara de tudo."})).toBeVisible();
    await expect(page.locator(".workspace-select strong")).toHaveText("Laboratório F0–F9");
    expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/empresa|company|tenant|session|jwt/i.test(k)))).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  });
}
test("F1: APIs somente locais não são habilitadas pelo preview",async({request})=>{
  for(const path of ["/api/v1/me","/api/v1/companies","/api/v1/companies/e1/context"]){
    const r=await request.get(path);
    expect(r.status()).toBe(503);
    expect(await r.json()).toEqual({error:"f1_not_enabled"});
  }
});
