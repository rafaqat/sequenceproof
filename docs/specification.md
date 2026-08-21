# SequenceProof — Codex implementation specification

Status: implementation directive
Date: 2026-08-21
Target products: `sequenceproof-rails` and `@sequenceproof/core`
Initial coordinated release: `0.1.0`

This document is the source of truth for building SequenceProof. It answers the public-API,
repository-bootstrap, and product-differentiation questions before implementation begins. Codex
must implement the complete v1 described here, not merely scaffold empty classes or generate a demo.

## 0. Execution boundary

TrustDesk is not the SequenceProof repository. Do not add SequenceProof runtime code to TrustDesk and do
not change TrustDesk to make SequenceProof tests pass.

SequenceProof lives in its own repository. Keep its runtime, package metadata, tests, and release
evidence isolated from TrustDesk. When working in an existing checkout, inspect and preserve local
work before writing. Do not create an external repository, reserve a package, publish a gem/package,
or push code without explicit user authorization.

The exact names returned no package on RubyGems (`sequenceproof-rails`) or npm
(`@sequenceproof/core`) during read-only checks on 2026-08-21, and no exact GitHub identity was
found. Absence is not reservation or trademark clearance: recheck immediately before publishing,
obtain name/legal clearance, and prove control of the npm scope before release.

## 1. Product definition

SequenceProof is a Rails-aware, model-based testing system for stateful application behaviour.

It checks that a Rails application's externally exercised behaviour agrees with an explicit abstract
model across generated command sequences. After every command it can compare:

- expected abstract model state;
- observed application state;
- the command result;
- server-side invariants such as authorization, persistence, job, and audit constraints.

SequenceProof has two coordinated artifacts:

- `@sequenceproof/core`: an environment-neutral TypeScript model runner with deterministic generation,
  shrinking, trace serialization, replay, reporters, and a generic driver contract;
- `sequenceproof-rails`: a Rails Engine and test adapter DSL exposing only explicitly registered test
  operations and observations through an authenticated, versioned protocol.

The TypeScript model is the sole abstract model. The Ruby adapter is the sole description of how to
exercise and observe the Rails system. Do not create a second Ruby state-machine DSL that duplicates
TypeScript transitions.

### 1.1 Core promise

Given the same model version, adapter manifest digest, seed, run options, and deterministic resettable
system, SequenceProof generates the same command sequence. When a property fails, it resets the system,
replays candidates, and produces a smaller failing trace when possible.

Determinism of external services, time, background workers, and the application itself is not
magically guaranteed. Record replay divergence explicitly; never report a flaky or divergent replay
as a minimal proof.

### 1.2 Non-goals for 0.1

- SequenceProof is not a production workflow engine or an Active Record state-machine gem.
- It does not infer business correctness from routes, models, or database schemas.
- It does not expose arbitrary Ruby evaluation, constantization, SQL, factories, or controller
  actions over HTTP.
- It is not a browser crawler, DOM fuzzer, temporal-logic language, terminal driver, or replacement
  for system tests.
- It does not require, embed, fork, or wrap Bombadil.
- It does not promise deterministic replay when an adapter cannot reset its system deterministically.
- It does not publish a hosted dashboard or SaaS service.
- It does not publish artifacts during this build.

## 2. Why SequenceProof is not a Bombadil wrapper

Bombadil is a framework-agnostic black-box explorer for browser and terminal UIs. Its current public
surface centres on state extractors, generated browser/terminal actions, weighted action trees,
linear-temporal-logic formulas, coverage-guided exploration, traces, and replay.

SequenceProof must occupy a different layer:

| Concern | Bombadil | SequenceProof |
|---|---|---|
| System knowledge | Black-box UI state | Explicit abstract domain model plus a Rails test adapter |
| Actions | DOM/terminal interaction templates | Named, schema-validated domain commands exercised through real Rails request paths |
| Oracle | Extracted UI properties and LTL | Model/SUT agreement, postconditions, server invariants, and authorization outcomes |
| State visibility | Browser or terminal observations | Application-selected JSON projections, response results, database-backed invariants |
| Actors | Browser context | Named Rails actors and explicit per-command actor policy |
| Isolation | External environment | Per-case setup/reset contract, with in-process transaction support where valid |
| Failure reduction | Trace replay; evolving product capability | Sequence and input shrinking are a core v1 contract with divergence reporting |
| Rails knowledge | None | Engine, integration sessions, routes, jobs, time, notifications, generators, RSpec/Minitest hooks |
| Production footprint | External runner | Engine is dormant by default and forbidden in production |

The compelling use case is not “fuzz a Rails UI.” It is:

> Generate long, legal and illegal business-operation sequences, execute them through Rails as
> different actors, and prove after every step that persisted application state and policy outcomes
> still agree with a small executable model.

Examples include double cancellation, stale approvals, role changes between steps, retry/idempotency
behaviour, cross-tenant access, job-driven transitions, and audit-history invariants. These are often
awkward to express as DOM-only properties.

SequenceProof and Bombadil can be complementary. A future optional exporter may turn SequenceProof
observations into Bombadil extractors or seed Bombadil actions, but this is outside 0.1 and must be a
separate adapter package. Keep the core free of Bombadil types and dependencies.

## 3. Architecture decisions that are frozen for 0.1

1. **One monorepo, two publishable artifacts.** The gem lives at the repository root; the npm
   package lives at `packages/core`.
2. **One abstract model.** It is authored in TypeScript using `@sequenceproof/core`.
3. **Ruby is an adapter, not another model.** Ruby registers concrete setup, actor authentication,
   named commands, observations, server invariants, redaction, and reset behaviour.
4. **A versioned JSON protocol is the seam.** No Ruby-to-JavaScript code generation and no execution
   of source strings.
5. **The root TypeScript import is runtime-neutral and ESM-only.** Node-only CLI and HTTP code use
   explicit subpath exports.
6. **Public data is JSON-compatible.** Model state, generated inputs, command results, observations,
   traces, and protocol errors must be serializable JSON values.
7. **Commands are explicit allow-listed identifiers.** SequenceProof never derives callable Ruby names
   from client input.
8. **Every run has deterministic randomness.** No `Math.random`, current time, UUID generation, or
   unordered object/database enumeration inside generation.
9. **Shrinking always replays from reset.** Never shrink by continuing from contaminated state.
10. **The engine is test infrastructure.** It is disabled unless explicitly enabled and must abort
    boot if enabled in `production`.
11. **Versions are coordinated but protocol compatibility is explicit.** Gem/npm versions start in
    lockstep; the protocol has its own integer major version.
12. **No framework coupling in core.** React, Rails, Active Record, RSpec, Minitest, Capybara,
    Playwright, and Bombadil types may not appear in the root `@sequenceproof/core` API.

Record any change to these decisions in `docs/decisions.md` before implementing the change.

## 4. Shared wire contracts

Check in canonical JSON Schema Draft 2020-12 schemas under `schemas/`. Ruby and TypeScript contract
tests must consume the same files.

Required schemas:

```text
schemas/protocol-v1.schema.json
schemas/manifest-v1.schema.json
schemas/trace-v1.schema.json
schemas/problem-v1.schema.json
```

Every protocol response carries:

```json
{
  "protocol": "sequenceproof.protocol",
  "protocol_version": 1,
  "request_id": "opaque-id"
}
```

All identifiers use ASCII lowercase letters, digits, `_`, `.`, `-`, are 1–128 bytes, and are
validated at registration and parsing. Unknown object members are rejected in protocol requests.

### 4.1 Manifest

The Rails adapter manifest is immutable for a process and contains:

- adapter `name` and integer `version`;
- SequenceProof gem version and protocol versions supported;
- command IDs, input/output JSON schemas, permitted actor IDs, and command metadata;
- observation JSON schema;
- server-invariant IDs;
- isolation/reset capability;
- SHA-256 digest of canonical manifest JSON.

The manifest must not expose callback source locations, model names, database structure, secrets, or
factory internals.

```ts
export interface AdapterManifestV1 {
  readonly protocol: "sequenceproof.protocol";
  readonly protocol_version: 1;
  readonly request_id: string;
  readonly sequenceproof_rails_version: string;
  readonly supported_protocol_versions: readonly [1];
  readonly adapter: { readonly name: string; readonly version: number };
  readonly commands: readonly {
    readonly id: string;
    readonly actors: readonly string[];
    readonly input_schema: JsonObject;
    readonly output_schema: JsonObject;
    readonly metadata: JsonObject;
  }[];
  readonly observation_schema: JsonObject;
  readonly server_invariants: readonly string[];
  readonly isolation: {
    readonly mode: "transaction" | "callback";
    readonly resettable: true;
  };
  readonly digest: string;
}
```

The digest is SHA-256 over RFC 8785 canonical JSON of the manifest with `request_id` and `digest`
omitted. Commands, actors, and invariants are sorted by identifier before hashing.

### 4.2 Command outcome

Command execution returns exactly one discriminated outcome:

```ts
export type CommandOutcome<T extends JsonValue = JsonValue> =
  | { status: "ok"; value: T }
  | { status: "rejected"; code: string; value?: T };
```

An unexpected exception is a protocol problem and fails the run as `errored`; it is not converted to
`rejected`. Expected application refusals must be mapped explicitly by the Ruby command adapter.

### 4.3 Problem response

Use an RFC 9457-style JSON problem object with stable SequenceProof codes:

```ts
export interface SequenceProofProblem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  request_id: string;
  errors?: readonly { path: string; code: string; message: string }[];
}
```

Do not include Ruby exception messages or backtraces unless the Rails adapter explicitly enables
debug detail in test and the value passes redaction.

### 4.4 Engine endpoints

The isolated engine exposes these authenticated JSON endpoints beneath the configured mount path:

```text
GET    /v1/adapters/:adapter/manifest
POST   /v1/adapters/:adapter/runs
GET    /v1/runs/:run_id/observation
POST   /v1/runs/:run_id/commands/:command_id
POST   /v1/runs/:run_id/reset
DELETE /v1/runs/:run_id
GET    /v1/health
```

Creating a run receives seed/run metadata, performs setup, creates actor sessions, and returns the
initial observation plus server-invariant results. Reset destroys all per-run sessions/state,
executes the declared isolation reset, repeats setup, and returns a fresh initial observation and
invariant results. Delete is idempotent and always runs cleanup.

A command response contains its outcome, the post-command observation, and server-invariant results
from the same serialized per-run executor operation. `createProtocolDriver` caches that observation
so the core runner's following `observe()` call does not create a consistency gap or second request.

Every command request includes actor ID, JSON input, monotonically increasing step number, and the
manifest digest. Reject stale/reordered step numbers and digest mismatches. Retrying an already
completed identical `(run_id, step)` returns the same stored outcome; a different payload for that
step returns `409`.

### 4.5 Trace

`TraceV1` is a portable replay artifact with this stable top-level shape:

```ts
export interface TraceV1 {
  readonly schema: "urn:sequenceproof:schema:trace:v1";
  readonly protocol_version: 1;
  readonly core_version: string;
  readonly model: { readonly name: string; readonly version: number };
  readonly adapter: {
    readonly name: string;
    readonly version: number;
    readonly manifest_digest: string;
  };
  readonly run: {
    readonly id: string;
    readonly seed: string;
    readonly options: JsonObject;
    readonly metadata: JsonObject;
  };
  readonly status: RunStatus;
  readonly initial: {
    readonly model: JsonValue;
    readonly observation: JsonValue;
    readonly properties: readonly DriverAssertion[];
  };
  readonly steps: readonly TraceStepV1[];
  readonly failure?: Failure;
  readonly shrink?: {
    readonly attempted: number;
    readonly complete: boolean;
    readonly original_steps: number;
    readonly minimal_steps: number;
  };
  readonly diagnostics?: {
    readonly started_at: string;
    readonly duration_ms: number;
  };
}

export interface TraceStepV1 {
  readonly step: number;
  readonly command: string;
  readonly target: string;
  readonly actor: string;
  readonly input: JsonValue;
  readonly outcome: CommandOutcome;
  readonly model_before: JsonValue;
  readonly model_after: JsonValue;
  readonly observation_before: JsonValue;
  readonly observation_after: JsonValue;
  readonly properties: readonly {
    readonly kind: "invariant" | "postcondition" | "server_invariant";
    readonly name: string;
    readonly result: AssertionResult;
  }[];
}
```

Diagnostic time is not part of replay equality. Manifest digests and trace canonicalization use RFC
8785 JSON Canonicalization Scheme semantics in both languages. Reject non-finite numbers,
`undefined`, sparse arrays, cycles, and unsupported prototypes before canonicalization. All
configured redaction runs before any trace or reporter event is materialized, not only before the
file is written.

## 5. Complete public API — `@sequenceproof/core`

The package is ESM-only, side-effect free at its root, and works in modern Node and browser runtimes.
The CLI and HTTP driver are Node-only subpaths. Do not export internal classes or directory globs.

### 5.1 Package exports

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./protocol": {
      "types": "./dist/protocol/index.d.ts",
      "import": "./dist/protocol/index.js"
    },
    "./node": {
      "types": "./dist/node/index.d.ts",
      "import": "./dist/node/index.js"
    },
    "./package.json": "./package.json"
  },
  "bin": {
    "sequenceproof": "./dist/cli.js"
  }
}
```

### 5.2 Root types and factories

The following names are public and must be documented and type-tested:

```ts
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
export type MaybePromise<T> = T | Promise<T>;
export type Seed = string;
export type RunId = string;

export interface Generator<T extends JsonValue> {
  readonly description: string;
  sample(random: Random, size: number): T;
  shrink(value: T): Iterable<T>;
}

export interface Random {
  integer(min: number, max: number): number;
  boolean(): boolean;
  pick<T>(values: readonly T[]): T;
  fork(label: string): Random;
}

export interface Decoder<T extends JsonValue> {
  readonly description: string;
  decode(value: JsonValue): T;
}

export function decoder<T extends JsonValue>(
  description: string,
  decode: (value: JsonValue) => T,
): Decoder<T>;

export const jsonValueDecoder: Decoder<JsonValue>;

export type CommandOutcome<T extends JsonValue = JsonValue> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "rejected"; readonly code: string; readonly value?: T };

export interface Driver<Observation extends JsonValue> {
  readonly name: string;
  setup(context: DriverSetupContext): Promise<Observation>;
  execute<Input extends JsonValue>(
    call: CommandCall<Input>,
    context: DriverStepContext,
  ): Promise<CommandOutcome<JsonValue>>;
  observe(context: DriverObserveContext): Promise<Observation>;
  assertions?(context: DriverObserveContext): Promise<readonly DriverAssertion[]>;
  reset(context: DriverResetContext): Promise<Observation>;
  dispose(context: DriverDisposeContext): Promise<void>;
}

export interface AssertionPass {
  readonly pass: true;
}

export interface AssertionFailure {
  readonly pass: false;
  readonly message: string;
  readonly expected?: JsonValue;
  readonly actual?: JsonValue;
  readonly path?: string;
}

export type AssertionResult = boolean | AssertionPass | AssertionFailure;
export interface DriverAssertion {
  readonly name: string;
  readonly result: AssertionResult;
}
export type ActorSelector<Model extends JsonValue, Observation extends JsonValue> =
  | string
  | ((context: Readonly<ModelContext<Model, Observation>>) => string);
```

The supporting driver types are also public and have these stable shapes:

```ts
export interface CommandCall<Input extends JsonValue = JsonValue> {
  readonly id: string;
  readonly actor: string;
  readonly input: Input;
}

export interface DriverSetupContext {
  readonly runId: RunId;
  readonly seed: Seed;
  readonly metadata: JsonObject;
  readonly signal: AbortSignal;
}

export interface DriverStepContext extends DriverSetupContext {
  readonly step: number;
}

export interface DriverObserveContext extends DriverSetupContext {
  readonly step: number;
  readonly reason: "initial" | "after_command" | "explicit";
}

export interface DriverResetContext extends DriverSetupContext {
  readonly attempt: number;
  readonly reason: "shrink" | "replay" | "manual";
}

export interface DriverDisposeContext extends DriverSetupContext {
  readonly status: RunStatus;
}
```

Driver contexts do not expose mutable runner internals or RNG. `AbortSignal` is the standard web
platform type and is supported by the documented Node versions.

### 5.3 Model definition

Use a model-scoped builder so callers declare model and observation types once and every command,
invariant, and postcondition receives correct contextual types:

```ts
export function defineModel<
  Model extends JsonValue,
  Observation extends JsonValue,
>(): <Commands extends CommandDefinitions<Model, Observation>>(
  factory: (
    builders: ModelBuilders<Model, Observation>,
  ) => ModelDefinition<Model, Observation, Commands>,
) => StateModel<Model, Observation, Commands>;
```

The public definition types are:

```ts
export type CommandDefinitions<Model extends JsonValue, Observation extends JsonValue> =
  Readonly<Record<string, CommandDefinition<Model, Observation, JsonValue, JsonValue>>>;

export interface ModelBuilders<Model extends JsonValue, Observation extends JsonValue> {
  command<Input extends JsonValue, Output extends JsonValue = JsonValue>(
    definition: CommandDefinition<Model, Observation, Input, Output>,
  ): CommandDefinition<Model, Observation, Input, Output>;
  invariant(
    definition: InvariantDefinition<Model, Observation>,
  ): InvariantDefinition<Model, Observation>;
  postcondition<Input extends JsonValue, Output extends JsonValue>(
    definition: PostconditionDefinition<Model, Observation, Input, Output>,
  ): PostconditionDefinition<Model, Observation, Input, Output>;
}

export interface ModelContext<Model extends JsonValue, Observation extends JsonValue> {
  readonly model: Model;
  readonly observation: Observation;
  readonly step: number;
}

export interface CommandDefinition<
  Model extends JsonValue,
  Observation extends JsonValue,
  Input extends JsonValue,
  Output extends JsonValue,
> {
  readonly target?: string;
  readonly input: Generator<Input>;
  readonly output?: Decoder<Output>;
  readonly actor: ActorSelector<Model, Observation>;
  enabled(context: Readonly<ModelContext<Model, Observation>>): boolean;
  readonly weight?: number | ((context: Readonly<ModelContext<Model, Observation>>) => number);
  transition(
    context: Readonly<ModelContext<Model, Observation>>,
    input: Input,
    outcome: CommandOutcome<Output>,
  ): Model;
  readonly postconditions?: readonly PostconditionDefinition<Model, Observation, Input, Output>[];
  readonly tags?: readonly string[];
}

export interface InvariantDefinition<Model extends JsonValue, Observation extends JsonValue> {
  readonly name: string;
  check(
    context: Readonly<ModelContext<Model, Observation>>,
  ): MaybePromise<AssertionResult>;
}

export interface PostconditionContext<
  Model extends JsonValue,
  Observation extends JsonValue,
  Input extends JsonValue,
  Output extends JsonValue,
> {
  readonly before: Readonly<ModelContext<Model, Observation>>;
  readonly input: Input;
  readonly outcome: CommandOutcome<Output>;
  readonly nextModel: Model;
  readonly observation: Observation;
  readonly actor: string;
  readonly step: number;
}

export interface PostconditionDefinition<
  Model extends JsonValue,
  Observation extends JsonValue,
  Input extends JsonValue,
  Output extends JsonValue,
> {
  readonly name: string;
  check(
    context: Readonly<PostconditionContext<Model, Observation, Input, Output>>,
  ): MaybePromise<AssertionResult>;
}

export interface StateModel<
  Model extends JsonValue,
  Observation extends JsonValue,
  Commands extends CommandDefinitions<Model, Observation>,
> {
  readonly name: string;
  readonly version: number;
  readonly commandNames: readonly (keyof Commands & string)[];
}
```

`StateModel` is opaque beyond these inspection fields; callers create it only with `defineModel`.

`ModelDefinition` has this stable shape:

```ts
export interface ModelDefinition<
  Model extends JsonValue,
  Observation extends JsonValue,
  Commands extends CommandDefinitions<Model, Observation>,
> {
  readonly name: string;
  readonly version: number;
  readonly initial: (context: { readonly observation: Observation }) => Model;
  readonly commands: Commands;
  readonly invariants?: readonly InvariantDefinition<Model, Observation>[];
}
```

`CommandDefinition` has:

- `target?: string` — Rails/protocol command ID; defaults to its key in `commands`;
- `input: Generator<Input>`;
- `output?: Decoder<Output>` — defaults to `jsonValueDecoder`; decoding failure errors the step
  before transition/postconditions run;
- `actor: ActorSelector<Model, Observation>`;
- `enabled(context): boolean` — evaluated before generation and again before execution;
- `weight?: number | ((context) => number)` — non-negative safe integer, default `1`;
- `transition(context, input, outcome): Model` — pure next-model function;
- `postconditions?: readonly PostconditionDefinition[]`;
- `tags?: readonly string[]` — reporting/coverage metadata only.

`ModelContext` contains immutable `model`, `observation`, and `step`. `PostconditionContext` contains
the before model/observation, input, command outcome, next model, after observation, actor, and step.

Model, command, invariant, and postcondition definitions are deeply frozen when constructed and
never mutated by the runner. Duplicate names, invalid identifiers, empty command maps, invalid
weights, or non-JSON values fail at model construction with typed configuration errors.

Canonical model example:

```ts
import {
  assert,
  decoder,
  defineModel,
  gen,
  type JsonObject,
} from "@sequenceproof/core";

type CartModel = { quantity: number; stock: number };
type CartObservation = { quantity: number; stock: number };
type StatusResult = { status: number };

const statusResult = decoder<StatusResult>("status result", (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  const status = (value as JsonObject).status;
  if (typeof status !== "number") throw new Error("expected numeric status");
  return { status };
});

export default defineModel<CartModel, CartObservation>()(
  ({ command, invariant, postcondition }) => ({
    name: "shopping_cart",
    version: 1,
    initial: ({ observation }) => ({ ...observation }),
    commands: {
      add_item: command<{ quantity: number }, StatusResult>({
        input: gen.record({ quantity: gen.integer({ min: 1, max: 3 }) }),
        output: statusResult,
        actor: "customer",
        enabled: ({ model }) => model.stock > 0,
        transition: ({ model }, input, outcome) =>
          outcome.status === "ok"
            ? {
                quantity: model.quantity + input.quantity,
                stock: model.stock - input.quantity,
              }
            : model,
        postconditions: [
          postcondition<{ quantity: number }, StatusResult>({
            name: "rails_matches_model",
            check: ({ nextModel, observation }) =>
              assert.deepEqual(observation, nextModel),
          }),
        ],
      }),
    },
    invariants: [
      invariant({
        name: "stock_never_negative",
        check: ({ observation }) => assert.ok(observation.stock >= 0),
      }),
    ],
  }),
);
```

### 5.4 Generator namespace

Export a single `gen` namespace/object with:

```ts
export type Generated<Value> = Value extends Generator<infer Output> ? Output : never;

export interface GeneratorApi {
  constant<T extends JsonValue>(value: T): Generator<T>;
  boolean(): Generator<boolean>;
  integer(options: { readonly min: number; readonly max: number }): Generator<number>;
  nat(options: { readonly max: number }): Generator<number>;
  float(options: { readonly min: number; readonly max: number }): Generator<number>;
  string(options?: {
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly alphabet?: string;
  }): Generator<string>;
  uuid(): Generator<string>;
  emailAddress(): Generator<string>;
  oneOf<T extends JsonValue>(...generators: readonly Generator<T>[]): Generator<T>;
  frequency<T extends JsonValue>(
    entries: readonly { readonly weight: number; readonly generator: Generator<T> }[],
  ): Generator<T>;
  tuple<Values extends readonly Generator<JsonValue>[]>(
    ...generators: Values
  ): Generator<{ readonly [Key in keyof Values]: Generated<Values[Key]> }>;
  record<Shape extends Readonly<Record<string, Generator<JsonValue>>>>(
    shape: Shape,
  ): Generator<{ readonly [Key in keyof Shape]: Generated<Shape[Key]> }>;
  array<T extends JsonValue>(
    generator: Generator<T>,
    options?: { readonly minLength?: number; readonly maxLength?: number },
  ): Generator<readonly T[]>;
  option<T extends JsonValue, Nil extends JsonValue = null>(
    generator: Generator<T>,
    options?: { readonly nil?: Nil },
  ): Generator<T | Nil>;
  map<T extends JsonValue, Output extends JsonValue>(
    generator: Generator<T>,
    mapper: (value: T) => Output,
    options: { readonly description: string },
  ): Generator<Output>;
  suchThat<T extends JsonValue>(
    generator: Generator<T>,
    predicate: (value: T) => boolean,
    options: { readonly maxAttempts: number; readonly description: string },
  ): Generator<T>;
}

export const gen: GeneratorApi;
```

All built-ins must have deterministic shrinking. `suchThat` must fail as generator exhaustion after
`maxAttempts`; it may not loop indefinitely. Generated numbers must be finite JSON numbers. Object
key iteration is canonical and independent of insertion/hash order.

The public API must not expose a third-party property-testing library's types. A future adapter can
be added without making that library part of SequenceProof's compatibility promise.

### 5.5 Running, checking, and replay

```ts
export function run<Model extends JsonValue, Observation extends JsonValue>(
  model: StateModel<Model, Observation, CommandDefinitions<Model, Observation>>,
  options: RunOptions<Observation>,
): Promise<RunResult<Model, Observation>>;

export function check<Model extends JsonValue, Observation extends JsonValue>(
  model: StateModel<Model, Observation, CommandDefinitions<Model, Observation>>,
  options: CheckOptions<Observation>,
): Promise<CheckResult>;

export function replay<Model extends JsonValue, Observation extends JsonValue>(
  model: StateModel<Model, Observation, CommandDefinitions<Model, Observation>>,
  trace: TraceV1,
  options: ReplayOptions<Observation>,
): Promise<ReplayResult>;

export function parseTrace(value: unknown): TraceV1;
export function serializeTrace(trace: TraceV1): string;
export function createSeed(value?: string | number): Seed;
export function createRandom(seed: Seed): Random;
```

The public run/result contracts are:

```ts
export type RunStatus =
  | "passed"
  | "failed"
  | "errored"
  | "exhausted"
  | "aborted"
  | "replay_diverged";

export interface RunOptions<Observation extends JsonValue> {
  readonly driver: Driver<Observation>;
  readonly seed?: Seed | string | number;
  readonly maxSteps?: number;
  readonly size?: number;
  readonly commandTimeoutMs?: number;
  readonly stopOnFailure?: boolean;
  readonly shrink?: boolean;
  readonly maxShrinkAttempts?: number;
  readonly maxShrinkTimeMs?: number;
  readonly reporters?: readonly Reporter[];
  readonly metadata?: JsonObject;
  readonly signal?: AbortSignal;
}

export type DriverFactory<Observation extends JsonValue> =
  () => MaybePromise<Driver<Observation>>;

export interface CheckOptions<Observation extends JsonValue>
  extends Omit<RunOptions<Observation>, "driver"> {
  readonly driver: DriverFactory<Observation>;
  readonly runs?: number;
  readonly concurrency?: number;
}

export interface ReplayOptions<Observation extends JsonValue> {
  readonly driver: Driver<Observation>;
  readonly reporters?: readonly Reporter[];
  readonly signal?: AbortSignal;
}

export interface Failure {
  readonly kind:
    | "invariant"
    | "postcondition"
    | "server_invariant"
    | "driver"
    | "generator"
    | "decoder"
    | "timeout";
  readonly name?: string;
  readonly message: string;
  readonly step?: number;
  readonly assertion?: AssertionFailure;
}

export interface RunResult<Model extends JsonValue, Observation extends JsonValue> {
  readonly status: RunStatus;
  readonly seed: Seed;
  readonly stepsExecuted: number;
  readonly termination:
    | "max_steps"
    | "no_enabled_commands"
    | "failure"
    | "error"
    | "exhaustion"
    | "abort";
  readonly finalModel: Model;
  readonly finalObservation: Observation;
  readonly failure?: Failure;
  readonly trace: TraceV1;
}

export interface CheckResult {
  readonly status: RunStatus;
  readonly runs: number;
  readonly passed: number;
  readonly failed: number;
  readonly firstFailure?: TraceV1;
}

export interface ReplayResult {
  readonly status: RunStatus;
  readonly matchedSteps: number;
  readonly divergence?: { readonly step: number; readonly message: string };
  readonly trace: TraceV1;
}
```

`RunOptions` requires a `driver`; accepts `seed`, `maxSteps`, `size`, per-command timeout,
`stopOnFailure`, `shrink`, `maxShrinkAttempts`, `reporters`, `metadata`, and `AbortSignal`.

`CheckOptions` uses a driver factory so every run owns independent driver state. It adds `runs`,
`concurrency` (default `1`), and a deterministic seed derivation rule. Concurrency may change
wall-clock ordering but not a run's derived seed or generated sequence.

An empty enabled-command set before `maxSteps` is a documented normal termination reason, not a
pass/fail status by itself. A run passes only if all evaluated properties passed and no driver or
generator error occurred.

Shrinking order is deterministic:

1. delete command subsequences using deterministic chunk reduction;
2. shrink individual command inputs in step order;
3. stop at the configured attempt/time budget;
4. retain the smallest replay-confirmed candidate found;
5. report divergence separately and retain the original proven failure.

### 5.6 Assertions and reporters

Public helpers:

```ts
export const assert: {
  ok(value: unknown, message?: string): AssertionResult;
  equal(actual: JsonValue, expected: JsonValue, message?: string): AssertionResult;
  deepEqual(actual: JsonValue, expected: JsonValue, message?: string): AssertionResult;
  match(value: string, pattern: RegExp, message?: string): AssertionResult;
  includes(value: readonly JsonValue[] | string, expected: JsonValue | string, message?: string): AssertionResult;
  fail(message: string, details?: Omit<AssertionFailure, "pass" | "message">): AssertionFailure;
};
```

Do not use Node's assertion types in the root API. A failed assertion is structured data, not a
required thrown exception. If a user callback throws, preserve it as an `errored` result.

Reporter interface events:

```text
onCheckStart, onRunStart, onStep, onProperty, onShrinkStart,
onShrinkCandidate, onShrinkComplete, onRunComplete, onCheckComplete
```

```ts
export type ReporterEventName =
  | "check_start"
  | "run_start"
  | "step"
  | "property"
  | "shrink_start"
  | "shrink_candidate"
  | "shrink_complete"
  | "run_complete"
  | "check_complete";

export interface ReporterEvent {
  readonly type: ReporterEventName;
  readonly checkId: string;
  readonly runId?: RunId;
  readonly seed?: Seed;
  readonly at: string;
  readonly data: JsonObject;
}

export interface Reporter {
  onCheckStart?(event: ReporterEvent): MaybePromise<void>;
  onRunStart?(event: ReporterEvent): MaybePromise<void>;
  onStep?(event: ReporterEvent): MaybePromise<void>;
  onProperty?(event: ReporterEvent): MaybePromise<void>;
  onShrinkStart?(event: ReporterEvent): MaybePromise<void>;
  onShrinkCandidate?(event: ReporterEvent): MaybePromise<void>;
  onShrinkComplete?(event: ReporterEvent): MaybePromise<void>;
  onRunComplete?(event: ReporterEvent): MaybePromise<void>;
  onCheckComplete?(event: ReporterEvent): MaybePromise<void>;
}

export type ReporterWriter = (line: string) => MaybePromise<void>;
```

Each reporter receives deeply frozen, JSON-compatible events. Wall-clock fields are for diagnostics
and never influence generation, replay comparison, or shrinking.

```ts
export function silentReporter(): Reporter;
export function consoleReporter(options?: { readonly color?: boolean }): Reporter;
export function jsonReporter(writer: ReporterWriter): Reporter;
```

Reporter failures are contained and reported; they must not corrupt trace execution.

### 5.7 Protocol and Node subpaths

`@sequenceproof/core/protocol` exports protocol types, schema validators, canonical JSON/digest helpers,
and `createProtocolDriver(options)`. It may use `fetch` but no Rails-specific names.

```ts
export interface ProtocolDriverOptions {
  readonly baseUrl: string | URL;
  readonly adapter: string;
  readonly token: string | (() => MaybePromise<string>);
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly requestTimeoutMs?: number;
  readonly redact?: (value: JsonValue) => JsonValue;
}

export function createProtocolDriver<Observation extends JsonValue = JsonValue>(
  options: ProtocolDriverOptions,
): Driver<Observation>;

export function validateManifest(value: unknown): AdapterManifestV1;
export function validateProblem(value: unknown): SequenceProofProblem;
export function canonicalize(value: JsonValue): string;
export function digest(value: JsonValue): Promise<string>;
```

Disallow credentials in URLs. Redact bearer tokens and configured JSON pointers from errors and
traces. Verify protocol version and manifest digest before the first command.

`@sequenceproof/core/node` exports:

```ts
export function readTraceFile(file: string | URL): Promise<TraceV1>;
export function writeTraceFile(
  file: string | URL,
  trace: TraceV1,
  options?: { readonly overwrite?: boolean; readonly mode?: number },
): Promise<void>;
```

Writes default to exclusive creation and mode `0o600`; overwrite must be explicit. Root imports must
continue to bundle without Node built-ins.

The `sequenceproof` CLI supports:

```text
sequenceproof check <model...> --endpoint URL --adapter NAME [--profile FILE:NAME] [options]
sequenceproof replay <trace> --model FILE --endpoint URL --adapter NAME [options]
sequenceproof validate <model-or-trace...>
sequenceproof inspect <trace> --format text|json
sequenceproof --version
```

Check options include `--seed`, `--runs`, `--max-steps`, `--size`, `--concurrency`,
`--command-timeout-ms`, `--shrink`/`--no-shrink`, `--max-shrink-attempts`,
`--max-shrink-time-ms`, `--stop-on-failure`, and `--output`. Command-line values override a named
profile. Unknown profile keys are errors; do not silently ignore misspellings.

No implicit network install, no telemetry, and no shell interpolation. Exit codes: `0` pass, `1`
usage/runtime/configuration error, `2` property failure, `3` replay divergence, `130` abort.

### 5.8 Errors, export ledger, and compatibility

All TypeScript runtime errors derive from `SequenceProofError`, whose public fields are `code`,
`details?: JsonObject`, and standard `cause`. Export these subclasses from the root:

```text
ConfigurationError
GeneratorExhaustedError
DecodeError
DriverError
TimeoutError
TraceValidationError
ReplayDivergenceError
```

The protocol subpath additionally exports `ProtocolError`, `ProtocolVersionError`,
`ManifestMismatchError`, and `RemoteProblemError`. Stable decisions use `code`; callers must not
parse English messages.

The root value exports are exactly:

```text
defineModel, decoder, jsonValueDecoder,
gen, run, check, replay, parseTrace, serializeTrace, createSeed, createRandom,
assert, silentReporter, consoleReporter, jsonReporter,
SequenceProofError and its root error subclasses
```

The root also exports every type explicitly named in sections 4.2, 4.5, and 5.2–5.6. There is no
default export. Package export snapshot tests fail on additions or removals so accidental helpers do
not become public API.

Follow semantic versioning. During `0.x`, document breaking API/protocol/replay changes in the
changelog and bump the minor version. Once `1.0` is released, remove a public API only after at least
one minor release with a runtime/type deprecation where technically possible. Protocol major
support is negotiated independently of package version.

## 6. Complete public API — `sequenceproof-rails`

### 6.1 Installation and constants

```ruby
require "sequenceproof/rails"

SequenceProof::Rails::VERSION
SequenceProof::Rails::PROTOCOL_VERSION # => 1
```

The gem exposes:

```ruby
SequenceProof::Rails.configure { |_config| }
SequenceProof::Rails.configuration
SequenceProof::Rails.adapter(name, version: 1) { }
SequenceProof::Rails.fetch_adapter(name)
SequenceProof::Rails.adapters
SequenceProof::Rails.enabled?
```

`adapters` returns immutable descriptors, not the mutable registry. Registration is thread-safe and
rejects duplicates. In development reloads, Railtie integration must rebuild app-owned registrations
through `ActiveSupport::Reloader.to_prepare` without accumulating duplicates.

### 6.2 Configuration

```ruby
SequenceProof::Rails.configure do |config|
  config.enabled_environments = %w[test]
  config.mount_path = "/__sequenceproof"
  config.token = -> { ENV["SEQUENCEPROOF_TOKEN"] }
  config.request_timeout = 10.seconds
  config.max_request_bytes = 1.megabyte
  config.run_ttl = 15.minutes
  config.max_runs = 4
  config.debug_errors = false
  config.logger = Rails.logger
  config.redact = ->(value) { value }
  config.before_command = ->(context) {}
  config.after_command = ->(context) {}
end
```

Configuration is finalized at application boot. Unknown settings fail. The engine is not mounted
outside `enabled_environments`; if configuration would enable it in production, boot fails with a
clear error. A missing/blank token while enabled also fails boot. Tokens require at least 32 bytes,
are compared in constant time, and tokens generated by SequenceProof use a cryptographically secure
random source.

Hooks are observability hooks, not authorization hooks. Their return values are ignored and their
exceptions fail the command visibly.

### 6.3 Adapter DSL

Canonical example:

```ruby
SequenceProof::Rails.adapter :shopping_cart, version: 1 do
  isolation :transaction, connection_classes: [ApplicationRecord]

  setup do |run|
    customer = User.create!(email: "customer-#{run.seed}@example.test")
    product = Product.create!(name: "Widget", stock: 3, price_cents: 500)
    run.store :customer, customer
    run.store :product, product
  end

  actor :customer do
    authenticate do |session, run|
      session.post "/test/sign_in", params: { user_id: run.fetch(:customer).id }
      run.assert_response! session, :redirect
    end
  end

  command :add_item,
          actors: [:customer],
          input: SequenceProof::Rails::Schema.object({
            quantity: SequenceProof::Rails::Schema.integer(minimum: 1, maximum: 3)
          }),
          output: SequenceProof::Rails::Schema.object({
            status: SequenceProof::Rails::Schema.integer(minimum: 100, maximum: 599)
          }) do |command, input|
    command.post "/cart/items", params: {
      product_id: command.run.fetch(:product).id,
      quantity: input.fetch("quantity")
    }

    if command.response.status == 201
      command.ok(status: 201)
    else
      command.rejected(code: "cart_refused", value: { status: command.response.status })
    end
  end

  observe schema: SequenceProof::Rails::Schema.object({
    quantity: SequenceProof::Rails::Schema.integer(minimum: 0),
    stock: SequenceProof::Rails::Schema.integer(minimum: 0)
  }) do |run|
    {
      quantity: CartItem.sum(:quantity),
      stock: run.fetch(:product).reload.stock
    }
  end

  invariant :stock_never_negative do |_run, observation|
    observation.fetch("stock") >= 0
  end
end
```

Public DSL methods:

```text
isolation(mode, connection_classes: [])
setup(&block)
cleanup(&block)
reset(&block)
actor(name, &block)
command(name, actors:, input:, output: Schema.any_json, metadata: {}, &block)
observe(schema:, &block)
invariant(name, &block)
redact(*json_pointers)
```

Exactly one `setup`, `observe`, and isolation strategy are required. `cleanup`, `reset`, actors, and
invariants may be omitted. At least one command is required. All definitions are frozen after boot.

Supported isolation modes:

- `:transaction` — default for the in-process Rack driver. A dedicated per-run executor thread owns
  the declared connection classes and their outer transactions for the full run; every adapter
  callback and nested integration request executes on that thread. Roll back all declared
  connections during reset/cleanup. Refuse this mode when undeclared database connections or
  external/cross-thread workers participate because those writes are not covered.
- `:callback` — requires a `reset` block and is intended for live-server/browser or multi-connection
  use. The callback must make the next setup equivalent to a fresh run.

There is no `:none` mode in 0.1. Cleanup is best-effort resource release and never substitutes for
reset/isolation.

### 6.4 Ruby schema API

`SequenceProof::Rails::Schema` returns deeply frozen JSON Schema fragments:

```ruby
Schema.string(min_length: nil, max_length: nil, pattern: nil, format: nil)
Schema.integer(minimum: nil, maximum: nil)
Schema.number(minimum: nil, maximum: nil)
Schema.boolean
Schema.null
Schema.any_json
Schema.literal(value)
Schema.enum(*values)
Schema.array(items:, min_items: nil, max_items: nil)
Schema.object(properties = {}, required: properties.keys, additional_properties: false)
Schema.one_of(*schemas)
Schema.nullable(schema)
Schema.raw(hash)
```

`raw` validates that the value is a supported Draft 2020-12 schema. Do not silently accept unknown
keywords that the runtime validator ignores. Input validation happens after allow-listed command
lookup but before its callback executes; observation validation happens before data leaves Rails.

### 6.5 Context objects

`RunContext` public methods:

```text
run_id, seed, metadata
store(key, value), fetch(key), key?(key)
session(actor)
assert!(condition, message, details: nil)
assert_response!(session, expected)
instrument(name, payload = {})
```

Stored Ruby objects never enter the manifest or trace unless an adapter explicitly returns a JSON
projection. Keys are symbols local to the run. Run state is isolated and thread-safe.

`CommandContext` public methods:

```text
run, actor, step, session, response
get, post, put, patch, delete, follow_redirect!
parsed_json
ok(value = nil)
rejected(code:, value: nil)
assert!(...)
```

HTTP methods delegate to a dedicated `ActionDispatch::Integration::Session` for the selected actor.
Do not invoke controller methods directly. Command blocks may call application service objects when
the adapter is explicitly testing a non-HTTP boundary, but generated defaults exercise routes.

Actor DSL public method:

```text
authenticate(&block) # receives integration session and RunContext
```

Each actor gets its own cookie/session jar. Unknown or unpermitted actors are rejected before command
execution.

Invariant blocks receive `(run, observation)` and return boolean or a structured assertion hash.
They run after setup/initial observation and after every command. They may query the database but may
not mutate it; document this contract and detect writes in tests where practical.

### 6.6 Errors

All public gem errors derive from `SequenceProof::Rails::Error`. Required subclasses:

```text
ConfigurationError
DuplicateAdapterError
UnknownAdapterError
UnknownCommandError
UnknownActorError
SchemaError
AuthenticationError
RunNotFoundError
RunExpiredError
StepConflictError
IsolationError
InvariantViolation
ProtocolError
```

Error `code` values are stable snake_case strings. Do not make callers parse English messages.

### 6.7 Rails integration

Ship an isolated `SequenceProof::Rails::Engine`, Railtie, controllers, routes, request validation,
run registry, instrumentation, rake tasks, and generators.

Because the public namespace itself is `SequenceProof::Rails`, gem internals must qualify framework
constants as `::Rails`, `::ActiveRecord`, and `::ActionDispatch` to avoid lexical constant lookup
resolving back into the gem namespace.

Active Support notifications:

```text
sequenceproof.run.start
sequenceproof.run.reset
sequenceproof.run.finish
sequenceproof.command.start
sequenceproof.command.finish
sequenceproof.invariant.finish
sequenceproof.protocol.error
```

Payloads contain IDs, durations, and statuses only. Never include authorization headers, cookies,
raw inputs, full observations, or stored objects by default.

Rake tasks:

```text
bin/rails sequenceproof:doctor
bin/rails sequenceproof:manifest[adapter]
bin/rails sequenceproof:check[model,profile]
bin/rails sequenceproof:replay[model,trace]
```

`sequenceproof:check` uses the already-installed local `node_modules/.bin/sequenceproof`; it must not use
`npx` in a way that downloads code. It launches the test-only endpoint with an ephemeral token,
waits for health, runs the core CLI, propagates the exit code, and always terminates its child process.
`sequenceproof:replay` uses the same lifecycle and adapter-name convention, but invokes the CLI replay
command with the supplied trace. Rake arguments containing commas are unsupported; the task must
detect that ambiguity and print the equivalent direct CLI command.

### 6.8 Optional test-framework helpers

Load helpers only when their frameworks are present:

```ruby
# RSpec
require "sequenceproof/rails/rspec"
SequenceProof::Rails::RSpec.check(model:, adapter:, **options)

# Minitest
require "sequenceproof/rails/minitest"
SequenceProof::Rails::Minitest.check(model:, adapter:, **options)
```

Both are thin process/driver helpers returning structured results and raising only when the caller
uses `check!`. `model:` is a TypeScript model file path, not a Ruby model object. Do not monkey-patch
global test classes automatically.

## 7. First generators

### 7.1 Install generator

```text
bin/rails generate sequenceproof:install
```

Options:

```text
--package-manager=npm|pnpm|yarn|bun
--test-framework=rspec|minitest
--mount-path=/__sequenceproof
--skip-package-install
```

It must:

- create `config/initializers/sequenceproof.rb` with safe test-only defaults;
- create `spec/sequenceproof/adapters/` or `test/sequenceproof/adapters/`;
- create `sequenceproof/models/` and `sequenceproof/traces/.gitkeep`;
- create `sequenceproof/profiles.yml` with the versioned `smoke`, `ci`, and `full` profiles from section
  15, preserving user edits on later generator runs;
- add generated traces except `.gitkeep` to `.gitignore` idempotently;
- add `@sequenceproof/core` using the selected package manager unless skipped;
- add scripts `sequenceproof`, `sequenceproof:check`, and `sequenceproof:validate` without deleting existing
  scripts;
- create `sequenceproof/tsconfig.json` extending the app config when possible, otherwise a standalone
  strict config;
- create a smoke model/adapter only when `--example` is supplied;
- print exact next steps and never claim the app is covered after installation.

Run the generator twice in a dummy app: the second run must be idempotent or present normal Rails
conflict prompts; it must not duplicate initializer blocks or package scripts.

### 7.2 Model generator

```text
bin/rails generate sequenceproof:model ShoppingCart add_item remove_item
```

It creates:

```text
sequenceproof/models/shopping_cart.ts
spec/sequenceproof/adapters/shopping_cart_adapter.rb   # or test/... for Minitest
spec/sequenceproof/shopping_cart_spec.rb               # or test/...
```

The TypeScript file compiles and contains a small typed model with one command definition per named
command. The Ruby adapter registers matching allow-listed commands with closed schemas. Generated
code contains explicit TODOs for application setup, route exercise, observation, and model
transition; it must not invent model names, routes, factories, authentication, or correctness rules.

Reject invalid/duplicate command names and path traversal. Support `--force` only through standard
Rails generator conflict behaviour.

### 7.3 Adapter generator

Also ship:

```text
bin/rails generate sequenceproof:adapter NAME COMMAND...
```

This creates only the Ruby adapter and its unit/request spec for teams whose TypeScript model lives
elsewhere. The model generator may invoke it internally, but their public behaviour is tested
separately.

## 8. Open-source repository structure

Create this structure deliberately; do not use a generated full Rails application as the repository
root.

```text
sequenceproof/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   ├── dependabot.yml
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── lib/
│   ├── sequenceproof-rails.rb
│   └── sequenceproof/
│       ├── rails.rb
│       └── rails/
│           ├── version.rb
│           ├── engine.rb
│           ├── railtie.rb
│           ├── configuration.rb
│           ├── adapter.rb
│           ├── registry.rb
│           ├── schema.rb
│           ├── protocol/
│           ├── runtime/
│           ├── rspec.rb
│           └── minitest.rb
├── lib/generators/sequenceproof/
│   ├── install/
│   ├── model/
│   └── adapter/
├── app/controllers/sequenceproof/rails/
├── config/routes.rb
├── lib/tasks/sequenceproof_tasks.rake
├── packages/core/
│   ├── src/
│   │   ├── index.ts
│   │   ├── model/
│   │   ├── generator/
│   │   ├── runner/
│   │   ├── shrink/
│   │   ├── trace/
│   │   ├── reporters/
│   │   ├── protocol/
│   │   ├── node/
│   │   └── cli.ts
│   ├── test/
│   ├── package.json
│   ├── README.md
│   ├── LICENSE.txt
│   ├── tsconfig.json
│   └── tsup.config.ts
├── schemas/
├── spec/
│   ├── dummy/
│   ├── generators/
│   ├── integration/
│   ├── protocol/
│   └── support/
├── test-vectors/
├── examples/shopping_cart/
├── docs/
│   ├── public-api.md
│   ├── protocol.md
│   ├── security.md
│   ├── bombadil-comparison.md
│   ├── compatibility.md
│   └── decisions.md
├── sequenceproof-rails.gemspec
├── Gemfile
├── Rakefile
├── package.json
├── package-lock.json
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── LICENSE.txt
└── CODEX.md
```

The root `CODEX.md` should be distilled from this specification and tell future agents where the API
contract, decisions, and build status live. Keep this full specification in `docs/specification.md`
inside the new repository.

## 9. Packaging metadata

### 9.1 Gem

`sequenceproof-rails.gemspec` must include real metadata, MIT license, files from Git, MFA-required
RubyGems metadata, source/changelog/issues/documentation URLs, and:

```ruby
spec.name = "sequenceproof-rails"
spec.version = SequenceProof::Rails::VERSION
spec.required_ruby_version = ">= 3.2"
spec.add_dependency "rails", ">= 7.1", "< 9.0"
spec.add_dependency "json_schemer", ">= 2.4", "< 3.0"
```

Do not depend on RSpec, Minitest, a database-cleaner gem, Node, Bombadil, React, or a browser driver
at gem runtime. Test/development dependencies belong in the Gemfile/gemspec development section.

The gem must work with Zeitwerk and `require "sequenceproof/rails"`. `require "sequenceproof-rails"` may
be a compatibility shim but is not the documented require path.

### 9.2 npm

The repository root is a private npm workspace. `packages/core/package.json` is publishable and has:

```json
{
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspace @sequenceproof/core",
    "check": "npm run check --workspace @sequenceproof/core",
    "test": "npm run test --workspace @sequenceproof/core",
    "lint": "npm run lint --workspace @sequenceproof/core",
    "pack:check": "npm run pack:check --workspace @sequenceproof/core"
  }
}
```

`packages/core/package.json` has:

```json
{
  "name": "@sequenceproof/core",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20" },
  "files": ["dist", "README.md", "LICENSE.txt"],
  "publishConfig": { "access": "public", "provenance": true }
}
```

Build declarations and source maps; do not ship TypeScript source unintentionally. Ensure the CLI
has a portable Node shebang and executable mode. Pin the package manager through the root
`packageManager` field and commit its lockfile.

Gem and npm versions remain equal in 0.x. Add a CI check that fails when version files diverge.
The release workflow is manual and performs build/test/package/provenance checks first. Leave its
publish jobs disabled until the user explicitly authorizes registry publication and configures
trusted publishing.

## 10. Security requirements

Treat the engine as a privileged test backdoor and design it accordingly.

- It is disabled by default, mounted only in configured non-production environments, and
  unconditionally refuses production.
- Authenticate every endpoint including health and manifest with a bearer token. Use constant-time
  comparison and generic unauthorized responses.
- Bind the launched test server to loopback by default. External binding requires an explicit flag.
- Apply JSON content type, method, body-size, request timeout, run-count, run-TTL, and command-count
  limits.
- Generate run IDs with a cryptographically secure random source. Never accept caller-selected IDs.
- Validate adapter, actor, command, step, manifest digest, and input before invoking app code.
- Store no arbitrary classes or executable input from the client. No `eval`, `class_eval`,
  `constantize`, YAML object deserialization, Marshal, or shell command construction.
- Scope each run's sessions and stored values independently. Make registry cleanup safe under
  concurrent reset/delete/expiry.
- Redact tokens and configured JSON pointers before logs, errors, notifications, and trace writes.
- Never record request cookies, Rails session contents, authorization headers, full SQL, or Ruby
  stored objects.
- The CLI refuses `http://` for non-loopback endpoints unless `--allow-insecure-http` is explicit.
- Schema validation failures do not execute setup/command callbacks.
- Cleanup executes in `ensure`; original failures are retained if cleanup also fails.
- Add Brakeman, bundler-audit, npm audit, CodeQL or equivalent SAST, and secret scanning to CI.
- Document that adapters are trusted test code with the same authority as the Rails test process.

Threat-model the engine in `docs/security.md`, including accidental production enablement, token
leakage, malicious command input, cross-run access, stale retries, callback exceptions, denial of
service, trace PII, and compromised npm/gem releases.

## 11. Implementation phases and acceptance gates

Complete phases in order. Keep `docs/build-status.md` current. Commit only when the user authorizes
commits; otherwise preserve completed work in the worktree and report it precisely.

### Phase 0 — design freeze and repository bootstrap

- Create structure, licenses, contribution/security docs, decisions log, build status, gemspec,
  workspace manifests, formatters, linters, and CI skeleton.
- Copy this document to `docs/specification.md` and derive `CODEX.md`.
- Write `docs/public-api.md` from sections 4–7 before runtime code.
- Add compile-only examples proving intended TypeScript inference.
- Add Ruby API contract specs proving names and method signatures.

Gate: gem builds, npm package packs, API examples typecheck, versions match, no implementation stubs
are presented as working behaviour.

### Phase 1 — core deterministic model runner

- Implement JSON validation, deterministic RNG, generators, command selection, model transition,
  invariants, postconditions, results, reporters, and abort/timeouts.
- Specify the RNG algorithm and seed derivation in docs and golden vectors; changing it is a breaking
  replay change.
- Ensure all callback inputs are immutable snapshots.

Gate: unit/property tests cover determinism, generator bounds, exhaustion, command eligibility,
weights, outcome branches, invariant timing, callback errors, timeout, abort, and reporter isolation.

### Phase 2 — trace, replay, and shrinking

- Implement trace schema, canonical serialization, parser validation, replay, divergence detection,
  sequence deletion, input shrinking, and budgets.
- Add cross-process golden traces and malicious/invalid trace fixtures.

Gate: planted multi-step failures shrink to a stable minimal trace; nondeterministic reset yields
`replay_diverged`, never a false minimal result.

### Phase 3 — Rails DSL and in-process runtime

- Implement configuration, registry, adapter/actor/command/schema DSLs, contexts, per-actor
  integration sessions, isolation, observations, server invariants, errors, notifications, and
  reload behaviour.
- Use a dummy Rails app with real routes, sessions, Active Record records, jobs, and two actors.

Gate: request-level specs prove that commands use real Rails dispatch, actor cookies do not leak,
input and observations are validated, illegal commands are rejected, invariants run at the right
times, reset is clean, and concurrent runs remain isolated.

### Phase 4 — engine and protocol driver

- Implement authenticated engine routes, run registry, manifest/digest, retries, expiry, limits,
  problems, protocol client, and protocol driver.
- Run shared request/response fixtures through Ruby and TypeScript validators.

Gate: a TypeScript model drives the dummy Rails app end to end and finds then shrinks a deliberately
planted state bug. Protocol mutation tests cover missing authentication, unknown members, stale
steps, changed retry payloads, expired runs, digest mismatch, oversized bodies, and callback errors.

### Phase 5 — generators and developer workflow

- Implement install, adapter, and model generators plus doctor/manifest/check tasks and CLI commands.
- Test npm, pnpm, yarn, and bun edits without requiring all package managers to perform network
  installs in every CI job; at minimum parse and fixture-test each supported manifest mutation.
- Test both RSpec and Minitest dummy apps.

Gate: a fresh Rails app can install SequenceProof, generate a model, fill the documented TODOs, run a
check, replay its trace, and uninstall generated app files without hidden manual wiring.

### Phase 6 — compatibility, hardening, and release readiness

- Test Ruby 3.2, 3.3, 3.4 and supported current Ruby; Rails 7.1, 7.2, 8.0, and 8.1 where compatible;
  Node 20, 22, and current LTS.
- Run RuboCop, RSpec, Minitest integration, TypeScript strict checks, package unit tests, package
  export tests, gem build/install smoke, npm pack/install smoke, audits, SAST, and secret scan.
- Validate generated code on Linux and macOS in CI.
- Build the complete shopping-cart example and a multi-tenant/authorization example.
- Complete README, API, protocol, security, compatibility, troubleshooting, and release docs.

Gate: all matrices are green on the exact commit, packed artifacts contain only intended files, no
network publish occurred, and the known limits are explicit.

## 12. Required tests — proxies are not enough

Test behaviour and mutation sensitivity, not merely declarations.

- A deterministic-RNG test must fail if any generator uses `Math.random`.
- A shrink test must fail if reset is removed between candidates.
- A replay test must fail if the manifest digest is ignored.
- A Rails routing test must fail if a command calls a controller/service directly instead of the
  configured integration-session request.
- An actor-isolation test must fail if sessions are shared.
- A schema test must prove the callback was not invoked for invalid input.
- A production guard test must boot a dummy production environment and prove enablement aborts.
- An authentication test must exercise every engine route, not grep route definitions.
- A retry test must prove identical retries are idempotent and changed payloads conflict.
- A reset test must create persistent state, reset, and prove the next initial observation is clean.
- A redaction test must put canary secrets in input, result, observation, error, log, notification,
  and trace paths and prove none escape.
- A package-exports test installs the packed tarball into an empty fixture and imports every public
  subpath while proving internal paths are unavailable.
- A gem smoke test installs the built `.gem` into an isolated gem home and boots the dummy app.
- Generator tests inspect real resulting files and run Ruby/TypeScript syntax checks.
- Cross-language protocol fixtures must fail both implementations after the same representative
  schema mutations.

For every critical guard, temporarily plant the defect, verify the mutation applied, run the named
test and see it fail for the intended reason, then restore from a private backup and verify the
restoration. Never weaken an assertion to make a gate green.

## 13. Documentation requirements

The README should lead with one complete ten-minute example and explain the two-process architecture
without calling SequenceProof “fuzzing for Rails.” Document:

- when SequenceProof is appropriate and when ordinary request/system tests are better;
- the TypeScript model and Ruby adapter side by side;
- deterministic seed reproduction and the limits of replay;
- transaction versus callback isolation;
- multi-actor and authorization testing;
- trace sensitivity and redaction;
- CI integration with immutable trace artifacts;
- exact supported versions;
- the honest Bombadil comparison from section 2.

Generate TypeDoc for the npm API and YARD docs for the Ruby API. `docs/public-api.md` remains the
human compatibility contract. Every exported symbol must be documented; every documented symbol
must exist and be tested.

## 14. Definition of done

SequenceProof 0.1 is implementation-complete only when all of the following are true:

- both packed artifacts install from local files in clean fixtures;
- the public APIs in sections 5 and 6 exist with no undocumented root exports;
- the shared protocol validates identically in Ruby and TypeScript;
- the dummy Rails application is driven end to end by the core runner;
- a planted state bug is found, traced, replayed, and deterministically shrunk;
- authentication, production refusal, schema validation, isolation, idempotency, expiry, cleanup,
  concurrency, and redaction are behaviourally proven;
- all three generators produce usable, compiling code;
- CI matrices, audits, static analysis, formatting, and package-content checks pass;
- documentation describes limitations and does not claim browser/LTL coverage;
- no gem, npm package, GitHub repository, tag, release, or deployment was published without explicit
  authorization.

A green scaffold, a generated Rails Engine with placeholder endpoints, or a package containing only
types is not “the full gem.” Do not mark a phase complete until its acceptance gate has been observed
on the current code.

## 15. Full end-to-end model-fuzzing flow

This section is the executable reference journey. Implement it before describing SequenceProof as an
end-to-end fuzzing system.

### 15.1 Scope of the word “fuzzing”

SequenceProof performs **stateful, model-based domain fuzzing**. It generates command sequences and
structured inputs from a TypeScript model, sends them through authenticated Rails integration
sessions, exercises real routes, controllers, sessions, models, database constraints, and
deterministic jobs, then compares the resulting application state with the model and Rails-side
invariants.

It does not fuzz the DOM, rendering engine, JavaScript event ordering, focus, layout, or browser
navigation. Keep Playwright system tests for fixed browser journeys. Bombadil may be an independent,
complementary exploratory browser gate; it must not become a SequenceProof dependency and its coverage
must not be reported as SequenceProof coverage.

The complete execution path is:

```text
TypeScript model
  -> seeded command and input generation
  -> @sequenceproof/core runner
  -> authenticated SequenceProof Rails Engine protocol
  -> per-actor ActionDispatch integration session
  -> real application route/controller/database transaction
  -> atomic outcome + observation + Rails invariant response
  -> model transition + model/postcondition comparison
  -> trace on every step
  -> isolated reset + deterministic replay + shrinking on failure
  -> original trace, minimal trace, summary, and JUnit artifacts
```

Do not substitute direct service calls, controller method invocation, mocks, fixtures that precompute
the result, or a second toy implementation of the application.

### 15.2 Generated run profiles

`sequenceproof:install` creates this strict, safe-loaded file:

```yaml
version: 1
profiles:
  smoke:
    runs: 10
    max_steps: 25
    size: 20
    concurrency: 1
    shrink: true
    max_shrink_attempts: 250
    max_shrink_time_ms: 10000
    stop_on_failure: true
  ci:
    runs: 250
    max_steps: 100
    size: 100
    concurrency: 2
    shrink: true
    max_shrink_attempts: 2000
    max_shrink_time_ms: 60000
    stop_on_failure: true
  full:
    runs: 2000
    max_steps: 250
    size: 250
    concurrency: 4
    shrink: true
    max_shrink_attempts: 20000
    max_shrink_time_ms: 300000
    stop_on_failure: true
```

The schema permits only the keys shown plus `command_timeout_ms`. All numeric values are bounded by
the global limits in section 6.6. YAML aliases, custom tags, symbols, and object deserialization are
forbidden. The Rails task resolves the selected profile and passes explicit flags to the CLI; Ruby
and TypeScript both validate the effective values.

These are reference budgets, not timing promises. `smoke` is a local pre-commit signal, `ci` is a PR
gate, and `full` is a scheduled or manual campaign of up to 500,000 state transitions. Teams may
change budgets in their generated file, but a smaller run must not be reported as the reference
`full` profile. Every invocation has exactly one seed. If no seed is supplied, generate it from a
cryptographically secure source, print it at startup, and write it to every result artifact. Never
use an unreported random seed.

### 15.3 Concrete shopping-cart suite

The reference example is intentionally richer than CRUD. The generated TypeScript model tracks:

- available inventory and quantities in one customer's cart;
- order lifecycle state and the inventory reserved or released by it;
- checkout idempotency keys and the order each key created;
- the current actor role and the tenant whose state is observable;
- a stable audit-transition count, not timestamps or database IDs.

The Ruby adapter setup creates a unique tenant, customer, administrator, stranger, product with stock
five, and an untouched control tenant. It declares four actors with separate integration sessions.
Stable public handles from setup are returned as JSON; generated commands never depend on
environment-specific primary keys.

Implement at least these commands through real application routes:

| Command | Actor/input | Required behaviour |
|---|---|---|
| `add_item` | customer, quantity including zero and overstock values | valid quantities add; invalid or overstock requests are rejected without mutation |
| `remove_item` | customer, existing or absent product | removal is idempotent or returns the documented rejection |
| `checkout` | customer, generated idempotency key | creates at most one order and reserves inventory once |
| `retry_checkout` | customer, an existing key and same or changed payload | identical retry is stable; changed reuse conflicts |
| `cancel_order` | customer, open or terminal order | valid cancellation releases stock once |
| `restock` | administrator, bounded quantity | succeeds and is represented in both model and observation |
| `restock_as_customer` | customer, bounded quantity | is rejected and changes no observed state |
| `view_other_tenant_cart` | stranger or customer, control-tenant handle | returns forbidden/not-found and changes neither tenant |

Illegal operations remain generatable. They are part of the model: their decoded rejected outcome
must leave the abstract model unchanged. Do not hide authorization, validation, idempotency, or
terminal-state bugs by marking those commands ineligible.

After every command, compare a stable observation containing cart quantities, stock, normalized
order states, idempotency mappings, audit counts, and a digest of the untouched control tenant. The
adapter and model together must enforce:

- quantities and stock are never negative;
- stock, cart, reservations, fulfilled units, and explicit restocks obey the documented conservation
  equation;
- one idempotency key can identify no more than one order;
- a rejected or unauthorized command causes no observable mutation;
- terminal orders cannot transition again;
- the control tenant remains unchanged;
- audit transitions occur exactly once for successful state changes and never for rejections.

Avoid volatile fields such as timestamps, random database IDs, encrypted ciphertext, CSRF tokens,
and nondeterministically ordered arrays. Normalize at the adapter boundary and validate the
observation against its declared JSON Schema.

### 15.4 Process lifecycle

Running the suite from a Rails application is one command:

```sh
bin/rails 'sequenceproof:check[shopping_cart,full]'
```

The task must perform these steps in order:

1. Refuse to run unless the spawned application environment is `test`; invoke Rails protected-
   environment checks before any database access.
2. Validate the profile, model path, adapter name, local CLI path, and engine configuration before
   spawning anything.
3. Allocate an available loopback port without exposing it on a non-loopback interface and create a
   high-entropy bearer token. Pass secrets by child-process environment and redact them from command
   output and exceptions.
4. Start `bin/rails server -e test -b 127.0.0.1 -p PORT` as a directly managed child process. Do not
   invoke a shell or interpolate user-controlled values.
5. Poll the authenticated `/__sequenceproof/v1/health` endpoint with a bounded deadline. A socket being
   open is not proof that the correct engine is ready.
6. Invoke the installed `node_modules/.bin/sequenceproof` with explicit model, adapter, endpoint,
   profile values, token, output directory, and seed.
7. Forward `INT` and `TERM`, bound graceful shutdown, kill only the recorded child when needed,
   preserve the CLI exit status, and perform cleanup in `ensure`/`finally`.

Never run `db:drop`, `db:reset`, truncate unrelated tables, or delete a shared development database.
Per-run cleanup is owned by the selected adapter isolation strategy. In transaction mode the
dedicated executor owns the declared database connections for setup, all commands, observations,
invariants, and rollback. Callback mode must use its explicit reset callback before every replay or
shrink candidate.

### 15.5 Semantics of one full check

Before scheduling runs, the CLI loads and typechecks the model, fetches the adapter manifest,
validates the protocol version, and compares the manifest digest, actors, commands, and input/output
schemas with the model. A mismatch is a configuration error, not a discarded generated case.

Each run receives a fresh driver instance and a random stream derived deterministically from the
campaign seed plus run index. It then:

1. creates a protocol run and receives setup handles, the initial observation, and initial
   Rails-invariant results;
2. initializes the abstract model from those stable handles and the observation;
3. chooses an eligible weighted command using only that run's random stream;
4. generates and locally schema-checks its JSON input and selects its declared actor;
5. posts the step with run ID, monotonically increasing step number, idempotency key, manifest
   digest, actor, command, and input;
6. receives one atomic response containing decoded command outcome, post-command observation, and
   Rails-invariant results;
7. applies the model transition, then evaluates postconditions and model invariants against the same
   observation;
8. appends the canonical step to the in-memory trace and continues until failure or `max_steps`;
9. disposes the run in all exit paths.

A property failure immediately preserves the unmodified original trace. If shrinking is enabled,
each candidate begins from a new, clean protocol run; SequenceProof first removes command ranges, then
shrinks individual inputs using the command's generator. It accepts a candidate only when it
reproduces the same stable failure identity without replay divergence. The original failure wins if
shrinking, cleanup, reporting, or artifact writing has a secondary failure.

With concurrency greater than one, only separate runs execute concurrently. Steps within a run stay
ordered, reporters serialize their own output, trace filenames cannot collide, and no driver,
session, transaction, mutable model, or random stream is shared between runs.

### 15.6 Artifacts and replay

Write a campaign directory containing:

```text
sequenceproof/traces/<suite>/<campaign-id>/
  summary.json
  junit.xml
  original.trace.json       # on failure
  minimal.trace.json        # only after a successful shrink
```

Files use exclusive creation and mode `0600` where supported. `summary.json` includes package/gem
versions, protocol and model versions, manifest digest, profile, effective options, seed, run/step
counts, terminal status, and artifact digests. It must not contain the bearer token. All artifacts
pass the same recursive redactor and secret-canary test as traces. CI storage is sensitive test
output; set explicit retention and access appropriate to the repository.

Reproduce a failure through the same Rails lifecycle, not a mocked replay target:

```sh
bin/rails 'sequenceproof:replay[shopping_cart,sequenceproof/traces/shopping_cart/CAMPAIGN/minimal.trace.json]'
```

Replay verifies protocol/model versions and manifest digest before setup, recreates a clean run,
uses the exact actors, commands, and inputs in the trace, and compares every recorded outcome and
observation. A fixed bug returns replay status `passed`, with a message that the recorded failure was
not reproduced. A changed environment or contract returns `replay_diverged`; neither result is
reported as reproduction of the original failure.

### 15.7 CI and scheduled full campaigns

The generated documentation includes a GitHub Actions example equivalent to:

```yaml
- run: bundle install
- run: npm ci
- run: bin/rails db:test:prepare
- name: SequenceProof PR campaign
  run: bin/rails 'sequenceproof:check[shopping_cart,ci]'
  env:
    SEQUENCEPROOF_SEED: "${{ github.sha }}"
- name: Upload SequenceProof artifacts
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: sequenceproof-${{ github.sha }}
    path: sequenceproof/traces/
    retention-days: 14
```

The Rails task uses `SEQUENCEPROOF_SEED` when present. A PR seed based on the immutable commit gives
repeatability while changing across commits. A scheduled/manual workflow runs the `full` profile
with a recorded seed such as `nightly-${{ github.run_id }}` and retains failures long enough to
triage. Do not claim the full campaign ran when only unit tests, the smoke profile, or the CI profile
ran. Exit code `2` is a property failure and must fail the job; replay divergence is exit code `3`.

Browser E2E remains a separate job. At minimum retain one fixed Playwright journey proving a human
can reach the application feature whose routes the adapter drives. A green SequenceProof campaign does
not replace that check, and a green browser journey does not establish SequenceProof's state-space
coverage.

### 15.8 Proof that the harness finds real defects

The dummy application must contain an isolated mutation fixture for an overstock, authorization, or
idempotency defect. Maintain a checked-in regression seed that reaches it quickly. In a disposable
copy or mutation-test process, and never by leaving broken production code in the branch:

1. run the seed against the correct implementation and observe a pass;
2. apply the mutation and verify the intended source actually changed;
3. run the real Rails server and `smoke` profile with that seed;
4. observe exit `2`, the intended invariant/postcondition failure, and both original and minimal
   traces;
5. replay the minimal trace and reproduce the same stable failure identity;
6. restore the source, verify the restoration, and observe replay status `passed`, documented by the
   CLI as “the recorded failure was not reproduced” rather than as a reproduced failure;
7. run the complete unit, protocol, integration, package, gem, and full-profile gates on the current
   code where the milestone requires them.

Also mutation-prove that removing reset, sharing actor cookies, bypassing the real route, ignoring
the manifest digest, using `Math.random`, or leaking a canary token makes its specifically named test
fail. A test that remains green after its guard is removed is not evidence.

SequenceProof's own release gate must record the exact full command, seed, profile digest, commit SHA,
run count, step count, result, and artifact digests. Keep local, CI, packed-artifact, and published-
artifact evidence distinct.

## 16. Primary comparison sources

Recheck these before changing the Bombadil comparison because it is an active 0.x project:

- Bombadil repository and README: https://github.com/antithesishq/bombadil
- Bombadil manual: https://antithesishq.github.io/bombadil/
- Bombadil v0.7.0 release notes: https://github.com/antithesishq/bombadil/releases/tag/v0.7.0
- Rails Engines guide: https://guides.rubyonrails.org/engines.html
- npm package `exports`: https://nodejs.org/api/packages.html#package-entry-points
- JSON Schema Draft 2020-12: https://json-schema.org/draft/2020-12
- RFC 9457 problem details: https://www.rfc-editor.org/rfc/rfc9457
- RFC 8785 JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785
