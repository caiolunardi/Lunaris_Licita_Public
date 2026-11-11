import {describe,expect,it} from "vitest";
import {a2SyntheticOrigin,a2SyntheticIntent,a2SyntheticHeaders} from "./a2-synthetic";

describe("A2 synthetic client contract",()=>{
  const hml="https://licita-hml.test.invalid";
  it("only activates on a dedicated HTTPS HML hostname",()=>{
    expect(a2SyntheticOrigin(hml)).toBe(true);
    for(const host of ["https://licita.test.invalid","http://licita-hml.test.invalid",
      "https://not-licita-hml.test.invalid","https://licita-hml-example.test.invalid",
      "garbage"]) expect(a2SyntheticOrigin(host)).toBe(false);
  });
  it("never changes identities or headers outside HML",()=>{
    expect(a2SyntheticIntent("abc-123","https://licita.test.invalid")).toBe("abc-123");
    expect(a2SyntheticHeaders("https://licita.test.invalid")).toEqual({});
  });
  it("uses stable synthetic intent IDs and an explicit opt-in header",()=>{
    expect(a2SyntheticIntent("abc-123",hml)).toBe("a2-test-abc-123");
    expect(a2SyntheticIntent("a2-test-abc-123",hml)).toBe("a2-test-abc-123");
    expect(a2SyntheticHeaders(hml)).toEqual({"X-Lunaris-Synthetic-Only":"confirmed"});
  });
  it("rejects invalid intent rather than silently sending unsafe writes",()=>{
    expect(()=>a2SyntheticIntent("x",hml)).toThrow("a2_invalid_intent");
    expect(()=>a2SyntheticIntent("bad id",hml)).toThrow("a2_invalid_intent");
  });
});
