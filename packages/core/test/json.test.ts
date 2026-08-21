import { describe, expect, it } from "vitest";
import { TraceValidationError, parseTrace } from "../src/index.js";
import { canonicalize } from "../src/protocol/index.js";

describe("canonical JSON and traces", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalize({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it("rejects non-JSON values", () => {
    expect(() => canonicalize({ value: Number.NaN })).toThrow();
  });

  it("rejects cycles without rejecting repeated non-cyclic values", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalize(cyclic as never)).toThrow(/cycle/);
    const shared = { value: 1 };
    expect(canonicalize({ left: shared, right: shared })).toBe('{"left":{"value":1},"right":{"value":1}}');
  });

  it("rejects an invalid trace", () => {
    expect(() => parseTrace({ schema: "wrong", protocol_version: 1, steps: [] })).toThrow(TraceValidationError);
  });
});
