import { ConfigurationError } from "./errors.js";
import type { Random, Seed } from "./types.js";

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

class DeterministicRandom implements Random {
  #state: number;
  readonly #seed: Seed;

  constructor(seed: Seed) {
    this.#seed = seed;
    this.#state = hash32(seed) || 0x9e3779b9;
  }

  #next(): number {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state;
  }

  integer(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new ConfigurationError("invalid_random_range", `invalid integer range ${min}..${max}`);
    }
    const span = max - min + 1;
    if (!Number.isSafeInteger(span) || span <= 0 || span > 0x1_0000_0000) {
      throw new ConfigurationError("invalid_random_range", "integer range exceeds 32-bit sampling bounds");
    }
    const limit = Math.floor(0x1_0000_0000 / span) * span;
    let value: number;
    do value = this.#next(); while (value >= limit);
    return min + (value % span);
  }

  boolean(): boolean { return (this.#next() & 1) === 1; }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new ConfigurationError("empty_choice", "cannot pick from an empty collection");
    return values[this.integer(0, values.length - 1)]!;
  }

  fork(label: string): Random { return new DeterministicRandom(`${this.#seed}\u0000${label}`); }
}

/** Normalizes a supplied seed or securely generates and returns one. */
export function createSeed(value?: string | number): Seed {
  if (value !== undefined) return String(value);
  const bytes = new Uint32Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((part) => part.toString(16).padStart(8, "0")).join("");
}

/** Creates the compatibility-versioned deterministic random stream for a seed. */
export function createRandom(seed: Seed): Random { return new DeterministicRandom(seed); }
