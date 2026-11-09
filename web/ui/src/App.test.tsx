import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

describe("Laboratório F0", () => {
  it("rotula explicitamente todos os dados como fictícios e não consulta API", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("proibido")));
    render(<App />);
    expect(screen.getByText(/Todos os números e processos abaixo são fictícios/)).toBeTruthy();
    expect(screen.getByText("Materiais para laboratório")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("filtra exemplos sem requisição de rede", async () => {
    render(<App />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar processos fictícios" }), { target: { value: "informática" } });
    await waitFor(() => expect(screen.getByText("Equipamentos de informática")).toBeTruthy());
    await waitFor(() => expect(screen.queryByText("Materiais para laboratório")).toBeNull());
  });
  it("navega com History API sem carregar a página inteira", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "Componentes" }));
    expect(window.location.pathname).toBe("/componentes");
    expect(screen.getByText("Consistência em cada detalhe.")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Desempenho" }));
    expect(screen.getByText("Rápida por arquitetura.")).toBeTruthy();
  });
  it("habilita Licitações F4 e empenhos/compras F5; documentos continuam futuros", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "Licitações" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Empenhos" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Compras" })).toBeTruthy();
    expect(screen.getByRole("link",{name:"Documentos"}).getAttribute("href")).toBe("/documentos");
    expect(screen.getByRole("link",{name:"Avisos"}).getAttribute("href")).toBe("/notificacoes");
    expect(screen.getByRole("link",{name:"Central de ajuda"}).getAttribute("href")).toBe("/ajuda");
    expect(screen.getByRole("link",{name:"Calculadora e cotações"}).getAttribute("href")).toBe("/cotacoes");
    expect(screen.getByRole("link",{name:"Equipe e acessos"}).getAttribute("href")).toBe("/equipe");
  });
  it("altera preferência visual sem armazenar dados comerciais", async () => {
    render(<App />);
    fireEvent.change(screen.getByRole("combobox", { name: "Aparência" }), { target: { value: "dark" } });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(localStorage.getItem("licita-f0-theme")).toBe("dark");
  });
  it("abre Gabi visual sob demanda sem habilitar IA", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir apresentação da Gabi" }));
    expect(await screen.findByRole("dialog", { name: "Gabi" })).toBeTruthy();
    expect(screen.getAllByText(/Sem IA conectada/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Fechar Gabi" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Gabi" })).toBeNull());
  });
});
