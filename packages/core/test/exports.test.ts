import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";

describe("root export ledger", () => {
  it("exports exactly the frozen runtime values", () => {
    expect(Object.keys(root).sort()).toEqual([
      "ConfigurationError", "DecodeError", "DriverError", "GeneratorExhaustedError",
      "ReplayDivergenceError", "SequenceProofError", "TimeoutError", "TraceValidationError",
      "assert", "check", "consoleReporter", "createRandom", "createSeed", "decoder",
      "defineModel", "gen", "jsonReporter", "jsonValueDecoder", "parseTrace", "replay",
      "run", "serializeTrace", "silentReporter",
    ].sort());
  });
});

