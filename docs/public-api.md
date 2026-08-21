# Public API contract

This is the human compatibility ledger for 0.1. The normative signatures remain sections 4–7 of
`specification.md`; export and Ruby contract tests fail when this ledger and implementation drift.

## `@sequenceproof/core`

The root package exports these runtime values and no others:

```text
assert, check, consoleReporter, createRandom, createSeed, decoder, defineModel,
gen, jsonReporter, jsonValueDecoder, parseTrace, replay, run, serializeTrace,
silentReporter

ConfigurationError, DecodeError, DriverError, GeneratorExhaustedError,
ReplayDivergenceError, SequenceProofError, TimeoutError, TraceValidationError
```

Its public TypeScript types are `ActorSelector`, `AssertionFailure`, `AssertionPass`,
`AssertionResult`, `CheckOptions`, `CheckResult`, `CommandCall`, `CommandDefinition`,
`CommandDefinitions`, `CommandOutcome`, `Decoder`, `Driver`, `DriverAssertion`, all five driver
contexts, `DriverFactory`, `Failure`, `Generated`, `Generator`, `GeneratorApi`,
`InvariantDefinition`, `JsonObject`, `JsonPrimitive`, `JsonValue`, `MaybePromise`, `ModelBuilders`,
`ModelContext`, `ModelDefinition`, `PostconditionContext`, `PostconditionDefinition`, `Random`,
`ReplayOptions`, `ReplayResult`, all reporter types, `RunId`, `RunOptions`, `RunResult`, `RunStatus`,
`Seed`, `StateModel`, `TraceStepV1`, and `TraceV1`.

`defineModel<Model, Observation>()` returns a typed model factory. `run` executes one driver;
`check` creates one fresh driver per run and supports bounded concurrency; `replay` executes recorded
steps and reports changed behaviour. Model values, inputs, outcomes, observations, metadata, reporter
data, and traces are finite JSON values.

`gen` exposes `constant`, `boolean`, `integer`, `nat`, `float`, `string`, `uuid`, `emailAddress`,
`oneOf`, `frequency`, `tuple`, `record`, `array`, `option`, `map`, and `suchThat`. Generated callback
inputs are deeply frozen. The random algorithm and seed derivation are compatibility-sensitive.

`assert` exposes `ok`, `equal`, `deepEqual`, `match`, `includes`, and `fail`. Reporters receive
deeply frozen `check_start`, `run_start`, `step`, `property`, `shrink_start`, `shrink_candidate`,
`shrink_complete`, `run_complete`, and `check_complete` events. Reporter failures are contained.

`@sequenceproof/core/protocol` exports canonicalization/digest helpers, schema validators, protocol
errors, and `createProtocolDriver`. `@sequenceproof/core/node` exports trace-file read/write helpers.
No other subpath is public.

`ProtocolDriverOptions` follows the specification and additionally exposes optional
`allowInsecureHttp`. It is the programmatic equivalent of the CLI's explicit
`--allow-insecure-http` escape hatch and defaults to false.

## `sequenceproof-rails`

Require `sequenceproof/rails`. Root module methods are `configure`, `configuration`, `adapter`,
`fetch_adapter`, `adapters`, `enabled?`, and `run_registry`. Double-underscore methods are internal
test/reloader hooks, not public API.

Configuration attributes are `enabled_environments`, `mount_path`, `token`, `request_timeout`,
`max_request_bytes`, `run_ttl`, `max_runs`, `debug_errors`, `logger`, `redact`, `before_command`, and
`after_command`. Configuration freezes at application boot.

The adapter DSL is:

```text
isolation(mode, connection_classes: [])
setup, cleanup, reset
actor(name) { authenticate }
command(name, actors:, input:, output:, metadata:)
observe(schema:)
invariant(name)
redact(*json_pointers)
```

`RunContext` exposes `run_id`, `seed`, `metadata`, `store`, `fetch`, `key?`, `session`, `assert!`,
`assert_response!`, and `instrument`. `CommandContext` exposes `run`, `actor`, `step`, `session`,
`response`, all five common HTTP verbs, `follow_redirect!`, `parsed_json`, `ok`, `rejected`, and
`assert!`.

`Schema` exposes `string`, `integer`, `number`, `boolean`, `null`, `any_json`, `literal`, `enum`,
`array`, `object`, `one_of`, `nullable`, and `raw`. Schemas are validated Draft 2020-12 fragments;
external references and unsupported formats are rejected.

All public errors derive from `SequenceProof::Rails::Error`: `ConfigurationError`,
`DuplicateAdapterError`, `UnknownAdapterError`, `UnknownCommandError`, `UnknownActorError`,
`SchemaError`, `AuthenticationError`, `RunNotFoundError`, `RunExpiredError`, `StepConflictError`,
`IsolationError`, `InvariantViolation`, and `ProtocolError`. Stable `code` strings, not messages, are
the machine interface.

Optional explicit helpers are `SequenceProof::Rails::RSpec.check/check!` and
`SequenceProof::Rails::Minitest.check/check!`. Rake tasks are `sequenceproof:doctor`,
`sequenceproof:manifest`, `sequenceproof:check`, and `sequenceproof:replay`. Generators are
`sequenceproof:install`, `sequenceproof:model`, and `sequenceproof:adapter`.
