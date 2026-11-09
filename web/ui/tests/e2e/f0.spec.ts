import { test, expect } from "@playwright/test";

const widths = [390, 768, 1280] as const;

for (const width of widths) {
  test(`F0: navegação SPA, responsividade e Gabi em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Uma visão mais clara de tudo." })).toBeVisible();
    await expect(page.getByText(/Todos os números e processos abaixo são fictícios/)).toBeVisible();

    const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflowing).toBe(false);

    if (width <= 850) await page.getByRole("button", { name: "Abrir navegação" }).click();
    await page.getByRole("link", { name: "Componentes" }).click();
    await expect(page.getByRole("heading", { name: "Consistência em cada detalhe." })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/componentes");
    const navCount = await page.evaluate(() => performance.getEntriesByType("navigation").length);
    expect(navCount).toBe(1);

    if (width <= 850) await page.getByRole("button", { name: "Abrir navegação" }).click();
    await page.getByRole("link", { name: "Desempenho" }).click();
    await expect(page.getByRole("heading", { name: "Rápida por arquitetura." })).toBeVisible();
    await page.getByRole("combobox", { name: "Aparência" }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByRole("button", { name: "Abrir apresentação da Gabi" }).click();
    await expect(page.getByRole("dialog", { name: "Gabi" })).toBeVisible();
    await expect(page.getByText(/Sem IA conectada/).first()).toBeVisible();
    await page.screenshot({ path: `test-results/f0-${width}px.png`, fullPage: true });
    await page.getByRole("button", { name: "Fechar Gabi" }).click();
  });
}

test("F0 Worker não revela APIs operacionais nem afirma conexão com banco", async ({ request }) => {
  const h = await request.get("/health");
  expect(h.status()).toBe(200);
  expect(await h.json()).toEqual({ status: "ok", phase: "f0_visual_only", connected: false });
  const api = await request.get("/api/boletos");
  expect(api.status()).toBe(404);
  expect(await api.json()).toEqual({ error: "not_found" });
});
