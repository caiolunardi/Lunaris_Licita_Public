import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
  try { window.localStorage.clear(); } catch { /* jsdom */ }
  document.documentElement.dataset.theme = "system";
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
