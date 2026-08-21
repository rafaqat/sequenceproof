import { ConfigurationError, GeneratorExhaustedError } from "./errors.js";
import { assertJson, canonicalizeJson, cloneJson, deepFreeze } from "./json.js";
import type { Generated, Generator, GeneratorApi, JsonValue, Random } from "./types.js";

function boundedLength(random: Random, size: number, minLength: number, maxLength: number): number {
  const effectiveMax = Math.max(minLength, Math.min(maxLength, Math.max(minLength, size)));
  return random.integer(minLength, effectiveMax);
}

function integerShrinks(value: number, min: number, max: number): number[] {
  const target = min <= 0 && max >= 0 ? 0 : Math.abs(min) < Math.abs(max) ? min : max;
  if (value === target) return [];
  const values = new Set<number>([target]);
  let delta = value - target;
  while (Math.abs(delta) > 1) {
    delta = Math.trunc(delta / 2);
    values.add(value - delta);
  }
  return [...values].filter((candidate) => candidate >= min && candidate <= max && candidate !== value);
}

function make<T extends JsonValue>(
  description: string,
  sample: (random: Random, size: number) => T,
  shrink: (value: T) => Iterable<T>,
): Generator<T> {
  return Object.freeze({ description, sample, shrink });
}

/** Deterministic primitive and structured JSON generators. */
export const gen: GeneratorApi = Object.freeze({
  constant<T extends JsonValue>(value: T): Generator<T> {
    assertJson(value);
    const frozen = deepFreeze(cloneJson(value)) as T;
    return make(`constant(${canonicalizeJson(value)})`, () => frozen, () => []);
  },

  boolean(): Generator<boolean> {
    return make("boolean", (random) => random.boolean(), function* (value) { if (value) yield false; });
  },

  integer(options: { readonly min: number; readonly max: number }): Generator<number> {
    const { min, max } = options;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new ConfigurationError("invalid_generator", "integer bounds must be ordered safe integers");
    }
    return make(`integer(${min},${max})`, (random) => random.integer(min, max), (value) => integerShrinks(value, min, max));
  },

  nat(options: { readonly max: number }): Generator<number> { return this.integer({ min: 0, max: options.max }); },

  float(options: { readonly min: number; readonly max: number }): Generator<number> {
    const { min, max } = options;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new ConfigurationError("invalid_generator", "float bounds must be ordered finite numbers");
    }
    if (!Number.isFinite(max - min)) throw new ConfigurationError("invalid_generator", "float range is too large");
    return make(
      `float(${min},${max})`,
      (random) => min + (max - min) * (random.integer(0, 0xff_ffff) / 0xff_ffff),
      function* (value) {
        const target = min <= 0 && max >= 0 ? 0 : min;
        if (value !== target) yield target;
        const half = target + (value - target) / 2;
        if (half !== value && Number.isFinite(half)) yield half;
      },
    );
  },

  string(options: { readonly minLength?: number; readonly maxLength?: number; readonly alphabet?: string } = {}): Generator<string> {
    const minLength = options.minLength ?? 0;
    const maxLength = options.maxLength ?? 32;
    const alphabet = options.alphabet ?? "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
    if (!Number.isSafeInteger(minLength) || !Number.isSafeInteger(maxLength) || minLength < 0 || minLength > maxLength || alphabet.length === 0) {
      throw new ConfigurationError("invalid_generator", "invalid string generator options");
    }
    return make(
      `string(${minLength},${maxLength})`,
      (random, size) => {
        const length = boundedLength(random, size, minLength, maxLength);
        return Array.from({ length }, () => alphabet[random.integer(0, alphabet.length - 1)]!).join("");
      },
      function* (value) {
        for (let length = Math.max(minLength, Math.floor(value.length / 2)); length >= minLength; length = Math.floor(length / 2)) {
          if (length < value.length) yield value.slice(0, length);
          if (length === minLength) break;
        }
      },
    );
  },

  uuid(): Generator<string> {
    return make("uuid", (random) => {
      const bytes = Array.from({ length: 16 }, () => random.integer(0, 255));
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }, function* (value) {
      const minimal = "00000000-0000-4000-8000-000000000000";
      if (value !== minimal) yield minimal;
    });
  },

  emailAddress(): Generator<string> {
    const local = this.string({ minLength: 1, maxLength: 16, alphabet: "abcdefghijklmnopqrstuvwxyz0123456789" });
    return make("email_address", (random, size) => `${local.sample(random.fork("local"), size)}@example.test`, function* (value) {
      const prefix = value.slice(0, value.indexOf("@"));
      for (const candidate of local.shrink(prefix)) yield `${candidate}@example.test`;
    });
  },

  oneOf<T extends JsonValue>(...generators: readonly Generator<T>[]): Generator<T> {
    if (generators.length === 0) throw new ConfigurationError("invalid_generator", "oneOf requires at least one generator");
    return make("oneOf", (random, size) => random.pick(generators).sample(random.fork("choice"), size), function* (value) {
      const seen = new Set<string>();
      for (const generator of generators) {
        try {
          for (const candidate of generator.shrink(value)) {
            assertJson(candidate);
            const key = canonicalizeJson(candidate);
            if (!seen.has(key)) { seen.add(key); yield candidate; }
          }
        } catch {
          // A heterogeneous branch may reject another branch's value.
        }
      }
    });
  },

  frequency<T extends JsonValue>(entries: readonly { readonly weight: number; readonly generator: Generator<T> }[]): Generator<T> {
    if (entries.length === 0 || entries.some(({ weight }) => !Number.isSafeInteger(weight) || weight <= 0)) {
      throw new ConfigurationError("invalid_generator", "frequency requires positive safe-integer weights");
    }
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (!Number.isSafeInteger(total)) throw new ConfigurationError("invalid_generator", "frequency weight total is unsafe");
    return make("frequency", (random, size) => {
      let selected = random.integer(1, total);
      for (const entry of entries) {
        selected -= entry.weight;
        if (selected <= 0) return entry.generator.sample(random.fork("weighted"), size);
      }
      throw new ConfigurationError("invalid_generator", "frequency selection failed");
    }, function* (value) {
      const seen = new Set<string>();
      for (const { generator } of entries) {
        try {
          for (const candidate of generator.shrink(value)) {
            assertJson(candidate);
            const key = canonicalizeJson(candidate);
            if (!seen.has(key)) { seen.add(key); yield candidate; }
          }
        } catch {
          // A heterogeneous weighted branch may reject another branch's value.
        }
      }
    });
  },

  tuple<Values extends readonly Generator<JsonValue>[]>(...generators: Values): Generator<{ readonly [Key in keyof Values]: Generated<Values[Key]> }> {
    type Output = { readonly [Key in keyof Values]: Generated<Values[Key]> };
    return make(
      "tuple",
      (random, size) => generators.map((generator, index) => generator.sample(random.fork(String(index)), size)) as Output,
      function* (value) {
        for (let index = 0; index < generators.length; index += 1) {
          for (const candidate of generators[index]!.shrink(value[index] as JsonValue)) {
            const copy = [...value] as JsonValue[];
            copy[index] = candidate;
            yield copy as Output;
          }
        }
      },
    );
  },

  record<Shape extends Readonly<Record<string, Generator<JsonValue>>>>(shape: Shape): Generator<{ readonly [Key in keyof Shape]: Generated<Shape[Key]> }> {
    type Output = { readonly [Key in keyof Shape]: Generated<Shape[Key]> };
    const keys = Object.keys(shape).sort() as (keyof Shape & string)[];
    return make(
      "record",
      (random, size) => Object.fromEntries(keys.map((key) => [key, shape[key]!.sample(random.fork(key), size)])) as Output,
      function* (value) {
        for (const key of keys) {
          for (const candidate of shape[key]!.shrink(value[key])) yield { ...value, [key]: candidate };
        }
      },
    );
  },

  array<T extends JsonValue>(generator: Generator<T>, options: { readonly minLength?: number; readonly maxLength?: number } = {}): Generator<readonly T[]> {
    const minLength = options.minLength ?? 0;
    const maxLength = options.maxLength ?? 32;
    if (!Number.isSafeInteger(minLength) || !Number.isSafeInteger(maxLength) || minLength < 0 || minLength > maxLength) {
      throw new ConfigurationError("invalid_generator", "invalid array generator options");
    }
    return make(
      "array",
      (random, size) => Array.from({ length: boundedLength(random, size, minLength, maxLength) }, (_, index) => generator.sample(random.fork(String(index)), size)),
      function* (value) {
        if (value.length > minLength) yield value.slice(0, Math.max(minLength, Math.floor(value.length / 2)));
        for (let index = 0; index < value.length; index += 1) {
          for (const candidate of generator.shrink(value[index]!)) {
            const copy = [...value];
            copy[index] = candidate;
            yield copy;
          }
        }
      },
    );
  },

  option<T extends JsonValue, Nil extends JsonValue = null>(generator: Generator<T>, options?: { readonly nil?: Nil }): Generator<T | Nil> {
    const nil = options?.nil ?? null as Nil;
    assertJson(nil);
    return make("option", (random, size) => random.boolean() ? generator.sample(random.fork("some"), size) : nil, function* (value) {
      if (canonicalizeJson(value) !== canonicalizeJson(nil)) {
        yield nil;
        for (const candidate of generator.shrink(value as T)) yield candidate;
      }
    });
  },

  map<T extends JsonValue, Output extends JsonValue>(generator: Generator<T>, mapper: (value: T) => Output, options: { readonly description: string }): Generator<Output> {
    return make(options.description, (random, size) => {
      const source = generator.sample(random, size);
      const output = mapper(source);
      assertJson(output);
      return output;
    }, () => []);
  },

  suchThat<T extends JsonValue>(generator: Generator<T>, predicate: (value: T) => boolean, options: { readonly maxAttempts: number; readonly description: string }): Generator<T> {
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts <= 0) {
      throw new ConfigurationError("invalid_generator", "suchThat maxAttempts must be a positive safe integer");
    }
    return make(options.description, (random, size) => {
      for (let attempt = 0; attempt < options.maxAttempts; attempt += 1) {
        const value = generator.sample(random.fork(String(attempt)), size);
        if (predicate(value)) return value;
      }
      throw new GeneratorExhaustedError("generator_exhausted", `${options.description} exhausted after ${options.maxAttempts} attempts`);
    }, function* (value) {
      for (const candidate of generator.shrink(value)) if (predicate(candidate)) yield candidate;
    });
  },
});
