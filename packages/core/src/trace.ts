import { TraceValidationError } from "./errors.js";
import { canonicalizeJson } from "./json.js";
import { validateTraceValue } from "./protocol/validate.js";
import type { JsonValue, TraceV1 } from "./types.js";

/** Strictly validates an unknown value as a version-one trace. */
export function parseTrace(value: unknown): TraceV1 {
  try {
    return validateTraceValue(value);
  } catch (error) {
    throw new TraceValidationError("invalid_trace", "trace does not match trace schema v1", { cause: error });
  }
}

/** Serializes a trace as canonical JSON followed by one newline. */
export function serializeTrace(trace: TraceV1): string { return `${canonicalizeJson(trace as unknown as JsonValue)}\n`; }
