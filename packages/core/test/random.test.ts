import { describe, expect, it, vi } from "vitest";
import { createRandom, gen } from "../src/index.js";

describe("deterministic generation", () => {
  it("reproduces the golden vector", () => {
    const random = createRandom("golden-v1");
    expect(Array.from({ length: 8 }, () => random.integer(0, 1_000))).toEqual([
      780, 133, 488, 15, 962, 54, 129, 502,
    ]);
  });

  it("does not use Math.random", () => {
    const spy = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("forbidden"); });
    const value = gen.record({ count: gen.integer({ min: -3, max: 3 }), enabled: gen.boolean() })
      .sample(createRandom("no-math-random"), 10);
    expect(value).toHaveProperty("count");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("forks independently of parent consumption", () => {
    const first = createRandom("fork");
    const expected = first.fork("child").integer(0, 100);
    first.integer(0, 100);
    first.integer(0, 100);
    expect(first.fork("child").integer(0, 100)).toBe(expected);
  });
});
