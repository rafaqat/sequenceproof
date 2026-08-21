/** A scalar JSON value. */
export type JsonPrimitive = null | boolean | number | string;
/** Any finite, serializable JSON value. */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
/** A JSON object with immutable JSON-valued properties. */
export type JsonObject = { readonly [key: string]: JsonValue };
/** A value returned synchronously or asynchronously. */
export type MaybePromise<T> = T | Promise<T>;
/** Reproducible campaign or run seed after normalization. */
export type Seed = string;
/** Opaque deterministic core-run identifier. */
export type RunId = string;

/** Deterministically samples values and enumerates smaller candidates. */
export interface Generator<T extends JsonValue> {
  readonly description: string;
  /** Samples one deterministic value at the supplied size. */
  sample(random: Random, size: number): T;
  /** Enumerates deterministic smaller candidates. */
  shrink(value: T): Iterable<T>;
}

/** Deterministic random source scoped by a seed and fork labels. */
export interface Random {
  /** Samples an inclusive integer range without modulo bias. */
  integer(min: number, max: number): number;
  /** Samples a boolean. */
  boolean(): boolean;
  /** Selects one element from a non-empty collection. */
  pick<T>(values: readonly T[]): T;
  /** Derives an independent stream from a stable label. */
  fork(label: string): Random;
}

/** Runtime decoder for successful command output. */
export interface Decoder<T extends JsonValue> {
  readonly description: string;
  /** Validates and returns a typed JSON value. */
  decode(value: JsonValue): T;
}

/** Successful command value or explicit application rejection. */
export type CommandOutcome<T extends JsonValue = JsonValue> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "rejected"; readonly code: string; readonly value?: T };

/** Concrete driver command chosen by the model runner. */
export interface CommandCall<Input extends JsonValue = JsonValue> {
  readonly id: string;
  readonly actor: string;
  readonly input: Input;
}

/** Immutable context supplied when a driver creates a run. */
export interface DriverSetupContext {
  readonly runId: RunId;
  readonly seed: Seed;
  readonly metadata: JsonObject;
  readonly signal: AbortSignal;
}

/** Driver context for one monotonically numbered command. */
export interface DriverStepContext extends DriverSetupContext {
  readonly step: number;
}

/** Driver context describing why an observation is requested. */
export interface DriverObserveContext extends DriverSetupContext {
  readonly step: number;
  readonly reason: "initial" | "after_command" | "explicit";
}

/** Driver context for a deterministic reset attempt. */
export interface DriverResetContext extends DriverSetupContext {
  readonly attempt: number;
  readonly reason: "shrink" | "replay" | "manual";
}

/** Driver context supplied during guaranteed disposal. */
export interface DriverDisposeContext extends DriverSetupContext {
  readonly status: RunStatus;
}

/** Environment-neutral stateful system boundary consumed by the runner. */
export interface Driver<Observation extends JsonValue> {
  readonly name: string;
  /** Creates fresh system state and returns its initial observation. */
  setup(context: DriverSetupContext): Promise<Observation>;
  /** Executes one concrete command. */
  execute<Input extends JsonValue>(
    call: CommandCall<Input>,
    context: DriverStepContext,
  ): Promise<CommandOutcome>;
  /** Returns a stable projection of current system state. */
  observe(context: DriverObserveContext): Promise<Observation>;
  /** Optionally returns server-side property results for the observation. */
  assertions?(context: DriverObserveContext): Promise<readonly DriverAssertion[]>;
  /** Restores a state equivalent to a fresh setup. */
  reset(context: DriverResetContext): Promise<Observation>;
  /** Releases all run resources in every terminal path. */
  dispose(context: DriverDisposeContext): Promise<void>;
}

/** Explicit successful assertion result. */
export interface AssertionPass { readonly pass: true }
/** Structured assertion failure suitable for traces and reports. */
export interface AssertionFailure {
  readonly pass: false;
  readonly message: string;
  readonly expected?: JsonValue;
  readonly actual?: JsonValue;
  readonly path?: string;
}
/** Boolean or structured result returned by a property. */
export type AssertionResult = boolean | AssertionPass | AssertionFailure;
/** Named server-side property returned by a driver. */
export interface DriverAssertion { readonly name: string; readonly result: AssertionResult }

/** Static actor identifier or deterministic selector from model state. */
export type ActorSelector<Model extends JsonValue, Observation extends JsonValue> =
  | string
  | ((context: Readonly<ModelContext<Model, Observation>>) => string);

/** Named command definitions belonging to a model. */
export type CommandDefinitions<Model extends JsonValue, Observation extends JsonValue> =
  Readonly<Record<string, CommandDefinition<Model, Observation, JsonValue, JsonValue>>>;

/** Identity builders that preserve command and property inference. */
export interface ModelBuilders<Model extends JsonValue, Observation extends JsonValue> {
  /** Preserves inferred input and output types for a command definition. */
  command<Input extends JsonValue, Output extends JsonValue = JsonValue>(
    definition: CommandDefinition<Model, Observation, Input, Output>,
  ): CommandDefinition<Model, Observation, Input, Output>;
  /** Preserves types for an invariant definition. */
  invariant(definition: InvariantDefinition<Model, Observation>): InvariantDefinition<Model, Observation>;
  /** Preserves inferred input and output types for a postcondition. */
  postcondition<Input extends JsonValue, Output extends JsonValue>(
    definition: PostconditionDefinition<Model, Observation, Input, Output>,
  ): PostconditionDefinition<Model, Observation, Input, Output>;
}

/** Immutable model and observation snapshot for selection and invariants. */
export interface ModelContext<Model extends JsonValue, Observation extends JsonValue> {
  readonly model: Model;
  readonly observation: Observation;
  readonly step: number;
}

/** Generation, eligibility, transition, actor, and property rules for one command. */
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
  /** Returns whether the command may run in the current state. */
  enabled(context: Readonly<ModelContext<Model, Observation>>): boolean;
  /** Static or state-derived non-negative selection weight. */
  readonly weight?: number | ((context: Readonly<ModelContext<Model, Observation>>) => number);
  /** Computes the next abstract model state. */
  transition(
    context: Readonly<ModelContext<Model, Observation>>,
    input: Input,
    outcome: CommandOutcome<Output>,
  ): Model;
  readonly postconditions?: readonly PostconditionDefinition<Model, Observation, Input, Output>[];
  readonly tags?: readonly string[];
}

/** Named property evaluated against every model/observation snapshot. */
export interface InvariantDefinition<Model extends JsonValue, Observation extends JsonValue> {
  readonly name: string;
  /** Evaluates the property for one immutable state snapshot. */
  check(context: Readonly<ModelContext<Model, Observation>>): MaybePromise<AssertionResult>;
}

/** Immutable state supplied to a command postcondition. */
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

/** Named property evaluated after a command transition. */
export interface PostconditionDefinition<
  Model extends JsonValue,
  Observation extends JsonValue,
  Input extends JsonValue,
  Output extends JsonValue,
> {
  readonly name: string;
  /** Evaluates the property immediately after a command transition. */
  check(context: Readonly<PostconditionContext<Model, Observation, Input, Output>>): MaybePromise<AssertionResult>;
}

/** Frozen public identity and command list returned by `defineModel`. */
export interface StateModel<
  Model extends JsonValue,
  Observation extends JsonValue,
  Commands extends CommandDefinitions<Model, Observation>,
> {
  readonly name: string;
  readonly version: number;
  readonly commandNames: readonly (keyof Commands & string)[];
}

/** Full trusted model definition retained internally by a `StateModel`. */
export interface ModelDefinition<
  Model extends JsonValue,
  Observation extends JsonValue,
  Commands extends CommandDefinitions<Model, Observation>,
> {
  readonly name: string;
  readonly version: number;
  /** Creates the initial abstract state from the first observation. */
  readonly initial: (context: { readonly observation: Observation }) => Model;
  readonly commands: Commands;
  readonly invariants?: readonly InvariantDefinition<Model, Observation>[];
}

/** Infers the JSON value produced by a generator. */
export type Generated<Value> = Value extends Generator<infer Output> ? Output : never;

/** Complete built-in generator surface. */
export interface GeneratorApi {
  /** Always produces one deeply frozen JSON value. */
  constant<T extends JsonValue>(value: T): Generator<T>;
  /** Produces booleans and shrinks `true` to `false`. */
  boolean(): Generator<boolean>;
  /** Produces safe integers in an inclusive range. */
  integer(options: { readonly min: number; readonly max: number }): Generator<number>;
  /** Produces natural numbers from zero through the inclusive maximum. */
  nat(options: { readonly max: number }): Generator<number>;
  /** Produces finite floating-point values in an inclusive range. */
  float(options: { readonly min: number; readonly max: number }): Generator<number>;
  /** Produces bounded strings from a configurable alphabet. */
  string(options?: { readonly minLength?: number; readonly maxLength?: number; readonly alphabet?: string }): Generator<string>;
  /** Produces deterministic RFC 4122 version-four-shaped identifiers. */
  uuid(): Generator<string>;
  /** Produces deterministic non-deliverable `example.test` addresses. */
  emailAddress(): Generator<string>;
  /** Selects uniformly from one or more generators. */
  oneOf<T extends JsonValue>(...generators: readonly Generator<T>[]): Generator<T>;
  /** Selects from generators using positive integer weights. */
  frequency<T extends JsonValue>(entries: readonly { readonly weight: number; readonly generator: Generator<T> }[]): Generator<T>;
  /** Combines generators into a fixed-length tuple. */
  tuple<Values extends readonly Generator<JsonValue>[]>(
    ...generators: Values
  ): Generator<{ readonly [Key in keyof Values]: Generated<Values[Key]> }>;
  /** Combines named generators into a canonically ordered object. */
  record<Shape extends Readonly<Record<string, Generator<JsonValue>>>>(
    shape: Shape,
  ): Generator<{ readonly [Key in keyof Shape]: Generated<Shape[Key]> }>;
  /** Produces bounded arrays of generated values. */
  array<T extends JsonValue>(generator: Generator<T>, options?: { readonly minLength?: number; readonly maxLength?: number }): Generator<readonly T[]>;
  /** Produces either a generated value or a configurable JSON sentinel. */
  option<T extends JsonValue, Nil extends JsonValue = null>(generator: Generator<T>, options?: { readonly nil?: Nil }): Generator<T | Nil>;
  /** Maps sampled values; generic mapped-input shrinking is intentionally unavailable in 0.1. */
  map<T extends JsonValue, Output extends JsonValue>(
    generator: Generator<T>,
    mapper: (value: T) => Output,
    options: { readonly description: string },
  ): Generator<Output>;
  /** Filters samples with an explicit exhaustion budget. */
  suchThat<T extends JsonValue>(
    generator: Generator<T>,
    predicate: (value: T) => boolean,
    options: { readonly maxAttempts: number; readonly description: string },
  ): Generator<T>;
}

/** Terminal state for a run, check, or replay. */
export type RunStatus = "passed" | "failed" | "errored" | "exhausted" | "aborted" | "replay_diverged";

/** Bounded execution, shrinking, reporting, and cancellation settings for one run. */
export interface RunOptions<Observation extends JsonValue> {
  readonly driver: Driver<Observation>;
  readonly seed?: string | number;
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

/** Creates an independent driver for one concurrent check run. */
export type DriverFactory<Observation extends JsonValue> = () => MaybePromise<Driver<Observation>>;
/** Campaign options extending single-run options with count and concurrency. */
export interface CheckOptions<Observation extends JsonValue> extends Omit<RunOptions<Observation>, "driver"> {
  readonly driver: DriverFactory<Observation>;
  readonly runs?: number;
  readonly concurrency?: number;
}
/** Driver, reporters, and cancellation settings for replay. */
export interface ReplayOptions<Observation extends JsonValue> {
  readonly driver: Driver<Observation>;
  readonly reporters?: readonly Reporter[];
  readonly signal?: AbortSignal;
}

/** Stable structured failure recorded in results and traces. */
export interface Failure {
  readonly kind: "invariant" | "postcondition" | "server_invariant" | "driver" | "generator" | "decoder" | "timeout";
  readonly name?: string;
  readonly message: string;
  readonly step?: number;
  readonly assertion?: AssertionFailure;
}

/** Validated version-one Rails adapter capability manifest. */
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
  readonly isolation: { readonly mode: "transaction" | "callback"; readonly resettable: true };
  readonly digest: string;
}

/** RFC 9457-style protocol problem returned by the Rails engine. */
export interface SequenceProofProblem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  request_id: string;
  errors?: readonly { path: string; code: string; message: string }[];
}

/** One canonical command transition in a version-one trace. */
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

/** Portable, schema-validated version-one replay artifact. */
export interface TraceV1 {
  readonly schema: "urn:sequenceproof:schema:trace:v1";
  readonly protocol_version: 1;
  readonly core_version: string;
  readonly model: { readonly name: string; readonly version: number };
  readonly adapter: { readonly name: string; readonly version: number; readonly manifest_digest: string };
  readonly run: { readonly id: string; readonly seed: string; readonly options: JsonObject; readonly metadata: JsonObject };
  readonly status: RunStatus;
  readonly initial: { readonly model: JsonValue; readonly observation: JsonValue; readonly properties: readonly DriverAssertion[] };
  readonly steps: readonly TraceStepV1[];
  readonly failure?: Failure;
  readonly shrink?: { readonly attempted: number; readonly complete: boolean; readonly original_steps: number; readonly minimal_steps: number };
  readonly diagnostics?: { readonly started_at: string; readonly duration_ms: number };
}

/** Complete result of one model run. */
export interface RunResult<Model extends JsonValue, Observation extends JsonValue> {
  readonly status: RunStatus;
  readonly seed: Seed;
  readonly stepsExecuted: number;
  readonly termination: "max_steps" | "no_enabled_commands" | "failure" | "error" | "exhaustion" | "abort";
  readonly finalModel: Model;
  readonly finalObservation: Observation;
  readonly failure?: Failure;
  readonly trace: TraceV1;
}
/** Aggregate result of a multi-run check. */
export interface CheckResult {
  readonly status: RunStatus;
  readonly runs: number;
  readonly passed: number;
  readonly failed: number;
  readonly firstFailure?: TraceV1;
}
/** Result of replaying a recorded trace against a driver. */
export interface ReplayResult {
  readonly status: RunStatus;
  readonly matchedSteps: number;
  readonly divergence?: { readonly step: number; readonly message: string };
  readonly trace: TraceV1;
}

/** Names of lifecycle events emitted to reporters. */
export type ReporterEventName = "check_start" | "run_start" | "step" | "property" | "shrink_start" | "shrink_candidate" | "shrink_complete" | "run_complete" | "check_complete";
/** Deeply frozen JSON-compatible reporter event. */
export interface ReporterEvent {
  readonly type: ReporterEventName;
  readonly checkId: string;
  readonly runId?: RunId;
  readonly seed?: Seed;
  readonly at: string;
  readonly data: JsonObject;
}
/** Optional callbacks observing check, run, step, property, and shrink lifecycles. */
export interface Reporter {
  /** Receives campaign start. */
  onCheckStart?(event: ReporterEvent): MaybePromise<void>;
  /** Receives individual run start. */
  onRunStart?(event: ReporterEvent): MaybePromise<void>;
  /** Receives a completed command step. */
  onStep?(event: ReporterEvent): MaybePromise<void>;
  /** Receives one evaluated property result. */
  onProperty?(event: ReporterEvent): MaybePromise<void>;
  /** Receives shrink start and the redacted original trace data. */
  onShrinkStart?(event: ReporterEvent): MaybePromise<void>;
  /** Receives each attempted shrink candidate. */
  onShrinkCandidate?(event: ReporterEvent): MaybePromise<void>;
  /** Receives the final shrinking result. */
  onShrinkComplete?(event: ReporterEvent): MaybePromise<void>;
  /** Receives individual run completion. */
  onRunComplete?(event: ReporterEvent): MaybePromise<void>;
  /** Receives aggregate campaign completion. */
  onCheckComplete?(event: ReporterEvent): MaybePromise<void>;
}
/** Sink used by the newline-delimited JSON reporter. */
export type ReporterWriter = (line: string) => MaybePromise<void>;
