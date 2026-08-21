import { canonicalizeJson } from "./json.js";
import type { AssertionFailure, AssertionResult, JsonValue } from "./types.js";

function failure(message: string, expected?: JsonValue, actual?: JsonValue): AssertionFailure {
  return {
    pass: false,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  };
}

/** Assertion helpers returning structured, trace-safe property results. */
export const assert = {
  /** Passes for truthy values. */
  ok(value: unknown, message = "expected value to be truthy"): AssertionResult {
    return value ? { pass: true } : failure(message);
  },
  /** Compares JSON scalar identity with `Object.is`. */
  equal(actual: JsonValue, expected: JsonValue, message = "expected values to be equal"): AssertionResult {
    return Object.is(actual, expected) ? { pass: true } : failure(message, expected, actual);
  },
  /** Compares canonical JSON structure. */
  deepEqual(actual: JsonValue, expected: JsonValue, message = "expected values to be deeply equal"): AssertionResult {
    return canonicalizeJson(actual) === canonicalizeJson(expected) ? { pass: true } : failure(message, expected, actual);
  },
  /** Tests a string against a regular expression. */
  match(value: string, pattern: RegExp, message = `expected ${value} to match ${pattern.source}`): AssertionResult {
    return pattern.test(value) ? { pass: true } : failure(message);
  },
  /** Tests membership in a string or JSON array. */
  includes(value: readonly JsonValue[] | string, expected: JsonValue | string, message = "expected collection to include value"): AssertionResult {
    const pass = typeof value === "string"
      ? typeof expected === "string" && value.includes(expected)
      : value.some((item) => canonicalizeJson(item) === canonicalizeJson(expected));
    return pass ? { pass: true } : failure(message, expected, value);
  },
  /** Constructs an explicit structured failure. */
  fail(message: string, details: Omit<AssertionFailure, "pass" | "message"> = {}): AssertionFailure {
    return { pass: false, message, ...details };
  },
};
