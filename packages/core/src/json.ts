import { ConfigurationError } from "./errors.js";
import type { JsonObject, JsonValue } from "./types.js";

export function assertJson(value: unknown, path = "$", ancestors = new WeakSet()): asserts value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ConfigurationError("invalid_json", `${path} is not a finite JSON number`);
    return;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new ConfigurationError("invalid_json", `${path} contains a cycle`);
    ancestors.add(value);
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new ConfigurationError("invalid_json", `${path} is a sparse array`);
      assertJson(value[index], `${path}/${index}`, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    if (ancestors.has(value)) throw new ConfigurationError("invalid_json", `${path} contains a cycle`);
    ancestors.add(value);
    for (const key of Object.keys(value)) assertJson((value as Record<string, unknown>)[key], `${path}/${escapePointer(key)}`, ancestors);
    ancestors.delete(value);
    return;
  }
  throw new ConfigurationError("invalid_json", `${path} is not JSON-compatible`);
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function deepFreeze<T>(value: T, seen = new WeakSet()): Readonly<T> {
  if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as object)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function cloneJson<T extends JsonValue>(value: T): T {
  assertJson(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function canonicalizeJson(value: JsonValue): string {
  assertJson(value);
  return serialize(value);
}

function serialize(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${serialize((value as JsonObject)[key]!)}`).join(",")}}`;
}

export function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}
