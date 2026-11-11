// A2 client-side convenience only. The Worker is the sole security authority.
// Keep this module free of account hostnames, IDs, secrets and runtime bindings.
export function a2SyntheticOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.startsWith("licita-hml.") &&
      url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
const currentOrigin = (): string =>
  typeof window === "undefined" ? "" : window.location.origin;
export function a2SyntheticIntent(id: string, origin = currentOrigin()): string {
  if (!a2SyntheticOrigin(origin)) return id;
  if (/^a2-test-[A-Za-z0-9_-]{3,100}$/.test(id)) return id;
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(id)) throw new Error("a2_invalid_intent");
  return "a2-test-" + id;
}
export function a2SyntheticHeaders(origin = currentOrigin()): Record<string, string> {
  return a2SyntheticOrigin(origin) ? { "X-Lunaris-Synthetic-Only": "confirmed" } : {};
}
