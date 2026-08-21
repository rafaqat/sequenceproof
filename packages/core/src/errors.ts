import type { JsonObject } from "./types.js";

/** Base error with a stable machine-readable code and optional JSON details. */
export class SequenceProofError extends Error {
  readonly code: string;
  readonly details?: JsonObject;

  constructor(code: string, message: string, options?: { readonly details?: JsonObject; readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    if (options?.details !== undefined) this.details = options.details;
  }
}

/** Invalid model, generator, or runner configuration. */
export class ConfigurationError extends SequenceProofError {}
/** Generator could not produce a value within its explicit budget. */
export class GeneratorExhaustedError extends SequenceProofError {}
/** Successful command output failed its model decoder. */
export class DecodeError extends SequenceProofError {}
/** Driver lifecycle or cleanup failure. */
export class DriverError extends SequenceProofError {}
/** Command execution exceeded its configured deadline. */
export class TimeoutError extends SequenceProofError {}
/** Trace input failed strict version-one schema validation. */
export class TraceValidationError extends SequenceProofError {}
/** Replay behavior differed from the recorded contract. */
export class ReplayDivergenceError extends SequenceProofError {}
