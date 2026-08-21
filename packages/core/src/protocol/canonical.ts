import { canonicalizeJson } from "../json.js";
import type { JsonValue } from "../types.js";

/** Returns RFC 8785 canonical JSON for a finite JSON value. */
export function canonicalize(value: JsonValue): string { return canonicalizeJson(value); }

/** Returns the lowercase SHA-256 digest of canonical JSON. */
export async function digest(value: JsonValue): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(value));
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
