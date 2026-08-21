import { ConfigurationError, DecodeError } from "./errors.js";
import { assertJson, deepFreeze } from "./json.js";
import type {
  CommandDefinitions,
  Decoder,
  JsonValue,
  ModelBuilders,
  ModelDefinition,
  StateModel,
} from "./types.js";

const IDENTIFIER = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const DEFINITION = Symbol.for("sequenceproof.model.definition.v1");
const definitions = new WeakMap<object, ModelDefinition<JsonValue, JsonValue, CommandDefinitions<JsonValue, JsonValue>>>();

/** Creates a named JSON output decoder with normalized failures. */
export function decoder<T extends JsonValue>(description: string, decodeValue: (value: JsonValue) => T): Decoder<T> {
  if (description.length === 0) throw new ConfigurationError("invalid_decoder", "decoder description cannot be empty");
  return Object.freeze({
    description,
    decode(value: JsonValue): T {
      try {
        const decoded = decodeValue(value);
        assertJson(decoded);
        return decoded;
      } catch (error) {
        if (error instanceof DecodeError) throw error;
        throw new DecodeError("decode_failed", `${description}: output could not be decoded`, { cause: error });
      }
    },
  });
}

/** Identity decoder accepting any finite JSON value. */
export const jsonValueDecoder: Decoder<JsonValue> = decoder("JSON value", (value) => value);

/** Creates a frozen, inferred state model from its typed definition factory. */
export function defineModel<Model extends JsonValue, Observation extends JsonValue>():
<Commands extends CommandDefinitions<Model, Observation>>(
  factory: (builders: ModelBuilders<Model, Observation>) => ModelDefinition<Model, Observation, Commands>,
) => StateModel<Model, Observation, Commands> {
  return function build<Commands extends CommandDefinitions<Model, Observation>>(
    factory: (builders: ModelBuilders<Model, Observation>) => ModelDefinition<Model, Observation, Commands>,
  ): StateModel<Model, Observation, Commands> {
    const identity = <T>(value: T): T => value;
    const built = factory({ command: identity, invariant: identity, postcondition: identity });
    if (!IDENTIFIER.test(built.name)) throw new ConfigurationError("invalid_model", `invalid model name: ${built.name}`);
    if (!Number.isSafeInteger(built.version) || built.version < 1) throw new ConfigurationError("invalid_model", "model version must be a positive safe integer");
    const commandNames = Object.keys(built.commands).sort() as (keyof Commands & string)[];
    if (commandNames.length === 0) throw new ConfigurationError("invalid_model", "a model requires at least one command");
    for (const name of commandNames) {
      if (!IDENTIFIER.test(name)) throw new ConfigurationError("invalid_model", `invalid command name: ${name}`);
      const command = built.commands[name]!;
      const target = command.target ?? name;
      if (!IDENTIFIER.test(target)) throw new ConfigurationError("invalid_model", `invalid command target: ${target}`);
      if (typeof command.actor === "string" && !IDENTIFIER.test(command.actor)) throw new ConfigurationError("invalid_model", `invalid actor: ${command.actor}`);
      if (typeof command.weight === "number" && (!Number.isSafeInteger(command.weight) || command.weight < 0)) {
        throw new ConfigurationError("invalid_model", `invalid weight for ${name}`);
      }
      const postconditionNames = new Set<string>();
      for (const postcondition of command.postconditions ?? []) {
        if (!IDENTIFIER.test(postcondition.name) || postconditionNames.has(postcondition.name)) {
          throw new ConfigurationError("invalid_model", `invalid or duplicate postcondition for ${name}: ${postcondition.name}`);
        }
        postconditionNames.add(postcondition.name);
      }
    }
    const invariantNames = new Set<string>();
    for (const invariant of built.invariants ?? []) {
      if (!IDENTIFIER.test(invariant.name) || invariantNames.has(invariant.name)) throw new ConfigurationError("invalid_model", `invalid or duplicate invariant: ${invariant.name}`);
      invariantNames.add(invariant.name);
    }
    const frozen = deepFreeze(built);
    const publicModel = { name: built.name, version: built.version, commandNames: Object.freeze(commandNames) };
    Object.defineProperty(publicModel, DEFINITION, { value: frozen, enumerable: false, configurable: false, writable: false });
    Object.freeze(publicModel);
    definitions.set(publicModel, frozen as unknown as ModelDefinition<JsonValue, JsonValue, CommandDefinitions<JsonValue, JsonValue>>);
    return publicModel;
  };
}

export function modelDefinition<
  Model extends JsonValue,
  Observation extends JsonValue,
  Commands extends CommandDefinitions<Model, Observation>,
>(model: StateModel<Model, Observation, Commands>): ModelDefinition<Model, Observation, Commands> {
  const found = definitions.get(model) ?? (model as unknown as Record<symbol, typeof definitions extends WeakMap<object, infer Value> ? Value : never>)[DEFINITION];
  if (found === undefined) throw new ConfigurationError("unknown_model", "model was not created by defineModel");
  return found as unknown as ModelDefinition<Model, Observation, Commands>;
}
