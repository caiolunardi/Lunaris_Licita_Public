import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Badge, Button, EmptyState, ProgressPill, SearchInput, Skeleton } from "./UI";

it("botão respeita disabled e não dispara ação", () => {
  const clicked = vi.fn();
  render(<Button disabled onClick={clicked}>Bloqueado</Button>);
  fireEvent.click(screen.getByRole("button", { name: "Bloqueado" }));
  expect(clicked).not.toHaveBeenCalled();
});
it("barra de progresso limita valor e fornece semântica", () => {
  render(<ProgressPill label="Etapas" value={150}/>);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
});
it("campo de pesquisa possui nome acessível", () => {
  render(<SearchInput label="Pesquisar licitações fictícias" />);
  expect(screen.getByRole("searchbox", { name: "Pesquisar licitações fictícias" })).toBeTruthy();
});
it("sinalizações e estados de espera têm indicação acessível", () => {
  render(<><Badge tone="warning">Atenção</Badge><Skeleton lines={2}/><EmptyState title="Vazio" message="Sem dados"/></>);
  expect(screen.getByText("Atenção")).toBeTruthy();
  expect(screen.getByRole("status", { name: "Carregando" })).toBeTruthy();
  expect(screen.getByText("Vazio")).toBeTruthy();
});
