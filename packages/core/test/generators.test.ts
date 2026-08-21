import { describe, expect, it } from "vitest";
import { GeneratorExhaustedError, createRandom, gen } from "../src/index.js";

describe("generators", () => {
  it("honours integer bounds and shrinks toward zero", () => {
    const generator = gen.integer({ min: -10, max: 10 });
    const values = Array.from({ length: 100 }, (_, index) => generator.sample(createRandom(`integer:${index}`), 100));
    expect(values.every((value) => value >= -10 && value <= 10)).toBe(true);
    expect([...generator.shrink(9)]).toEqual([0, 5, 7, 8]);
  });

  it("samples record keys canonically", () => {
    const left = gen.record({ z: gen.integer({ min: 0, max: 100 }), a: gen.integer({ min: 0, max: 100 }) });
    const right = gen.record({ a: gen.integer({ min: 0, max: 100 }), z: gen.integer({ min: 0, max: 100 }) });
    expect(left.sample(createRandom("record"), 10)).toEqual(right.sample(createRandom("record"), 10));
  });

  it("bounds suchThat attempts", () => {
    const generator = gen.suchThat(gen.constant(1), () => false, { maxAttempts: 3, description: "impossible" });
    expect(() => generator.sample(createRandom("exhaust"), 1)).toThrow(GeneratorExhaustedError);
  });

  it("keeps mapped shrinking stateless across concurrent runs", () => {
    const mapped = gen.map(gen.integer({ min: 0, max: 10 }), (value) => `bucket-${value % 2}`, {
      description: "non-injective bucket",
    });
    mapped.sample(createRandom("first"), 10);
    mapped.sample(createRandom("second"), 10);

    expect([...mapped.shrink("bucket-1")]).toEqual([]);
  });
});
