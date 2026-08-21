import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { ProtocolError, ProtocolVersionError } from "./errors.js";
import { assertJson, deepFreeze } from "../json.js";
import { schemas } from "./schema-data.generated.js";
import type { AdapterManifestV1, JsonObject, JsonValue, SequenceProofProblem, TraceV1 } from "../types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const manifestValidator = ajv.compile(schemas["manifest-v1"]);
const problemValidator = ajv.compile(schemas["problem-v1"]);
const protocolValidator = ajv.compile(schemas["protocol-v1"]);
const traceValidator = ajv.compile(schemas["trace-v1"]);

function errorsFor(validator: ValidateFunction): JsonObject {
  return {
    errors: (validator.errors ?? []).map((error: ErrorObject) => ({
      path: error.instancePath,
      code: error.keyword,
      message: error.message ?? "schema validation failed",
    })),
  };
}

function validateJson(value: unknown, validator: ValidateFunction, code: string, label: string): JsonValue {
  try {
    assertJson(value);
  } catch (error) {
    throw new ProtocolError(code, `${label} is not JSON-compatible`, { cause: error });
  }
  if (!validator(value)) throw new ProtocolError(code, `${label} does not match its v1 schema`, { details: errorsFor(validator) });
  return value;
}

function requireProtocolV1(value: JsonValue, label: string): void {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const version = (value as JsonObject).protocol_version;
    if (version !== undefined && version !== 1) {
      throw new ProtocolVersionError("unsupported_protocol", `${label} protocol version is unsupported`);
    }
  }
}

function ensureUniqueManifestIdentifiers(manifest: AdapterManifestV1): void {
  const commandIds = manifest.commands.map(({ id }) => id);
  if (new Set(commandIds).size !== commandIds.length) throw new ProtocolError("invalid_manifest", "manifest command identifiers are not unique");
  for (const command of manifest.commands) {
    if (new Set(command.actors).size !== command.actors.length) throw new ProtocolError("invalid_manifest", `manifest actors for ${command.id} are not unique`);
  }
  if (new Set(manifest.server_invariants).size !== manifest.server_invariants.length) {
    throw new ProtocolError("invalid_manifest", "manifest invariant identifiers are not unique");
  }
}

/** Validates and deeply freezes a version-one adapter manifest. */
export function validateManifest(value: unknown): AdapterManifestV1 {
  requireProtocolV1(value as JsonValue, "manifest");
  const json = validateJson(value, manifestValidator, "invalid_manifest", "manifest");
  const manifest = json as unknown as AdapterManifestV1;
  ensureUniqueManifestIdentifiers(manifest);
  return deepFreeze(manifest);
}

/** Validates and deeply freezes a version-one problem response. */
export function validateProblem(value: unknown): SequenceProofProblem {
  return deepFreeze(validateJson(value, problemValidator, "invalid_problem", "problem") as unknown as SequenceProofProblem);
}

export function validateProtocolResponse(value: unknown): JsonObject {
  requireProtocolV1(value as JsonValue, "response");
  const json = validateJson(value, protocolValidator, "invalid_response", "protocol response");
  return deepFreeze(json as JsonObject);
}

export function validateTraceValue(value: unknown): TraceV1 {
  requireProtocolV1(value as JsonValue, "trace");
  const json = validateJson(value, traceValidator, "invalid_trace", "trace");
  return deepFreeze(json as unknown as TraceV1);
}
