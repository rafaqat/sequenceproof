import {
  DecodeError,
  DriverError,
  GeneratorExhaustedError,
  SequenceProofError,
  TimeoutError,
} from "./errors.js";
import { cloneJson, deepFreeze, jsonEqual } from "./json.js";
import { jsonValueDecoder, modelDefinition } from "./model.js";
import { createRandom, createSeed } from "./random.js";
import { report } from "./reporters.js";
import { VERSION as CORE_VERSION } from "./version.js";
import type {
  AdapterManifestV1,
  AssertionFailure,
  AssertionResult,
  CheckOptions,
  CheckResult,
  CommandDefinition,
  CommandDefinitions,
  CommandOutcome,
  Driver,
  DriverAssertion,
  Failure,
  JsonObject,
  JsonValue,
  InvariantDefinition,
  ModelContext,
  ReplayOptions,
  ReplayResult,
  Reporter,
  ReporterEventName,
  RunId,
  RunOptions,
  RunResult,
  RunStatus,
  Seed,
  StateModel,
  TraceStepV1,
  TraceV1,
} from "./types.js";

type AnyCommand<Model extends JsonValue, Observation extends JsonValue> =
  CommandDefinition<Model, Observation, JsonValue, JsonValue>;

type DriverWithManifest = Driver<JsonValue> & { readonly manifest?: AdapterManifestV1 };
type DriverWithRedactor = Driver<JsonValue> & { redactTraceValue?(value: JsonValue): JsonValue };
const IDENTIFIER = /^[a-z0-9][a-z0-9_.-]{0,127}$/;

function redactTraceValue(driver: Driver<JsonValue>, value: JsonValue): JsonValue {
  const redactor = (driver as DriverWithRedactor).redactTraceValue;
  const redacted = redactor === undefined ? cloneJson(value) : redactor.call(driver, cloneJson(value));
  return cloneJson(redacted);
}

function validateRunOptions(options: {
  readonly maxSteps?: number;
  readonly size?: number;
  readonly commandTimeoutMs?: number;
  readonly maxShrinkAttempts?: number;
  readonly maxShrinkTimeMs?: number;
}): void {
  const boundedInteger = (value: number | undefined, name: string, minimum: number, maximum: number): void => {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum || value > maximum)) {
      throw new SequenceProofError("invalid_run_options", `${name} must be an integer from ${minimum} to ${maximum}`);
    }
  };
  boundedInteger(options.maxSteps, "maxSteps", 0, 100_000);
  boundedInteger(options.size, "size", 0, 100_000);
  boundedInteger(options.commandTimeoutMs, "commandTimeoutMs", 1, 600_000);
  boundedInteger(options.maxShrinkAttempts, "maxShrinkAttempts", 0, 1_000_000);
  boundedInteger(options.maxShrinkTimeMs, "maxShrinkTimeMs", 0, 3_600_000);
}

function validateModelManifest<Model extends JsonValue, Observation extends JsonValue>(
  definition: ReturnType<typeof modelDefinition<Model, Observation, CommandDefinitions<Model, Observation>>>,
  manifest: AdapterManifestV1 | undefined,
): void {
  if (manifest === undefined) return;
  const remote = new Map(manifest.commands.map((command) => [command.id, command]));
  for (const [name, command] of Object.entries(definition.commands)) {
    const target = command.target ?? name;
    const registered = remote.get(target);
    if (registered === undefined) throw new SequenceProofError("manifest_command_mismatch", `model target ${target} is absent from the adapter manifest`);
    if (typeof command.actor === "string" && !registered.actors.includes(command.actor)) {
      throw new SequenceProofError("manifest_actor_mismatch", `actor ${command.actor} is not permitted for adapter command ${target}`);
    }
  }
}

function validateSelectedActor(actor: unknown, target: string, manifest: AdapterManifestV1 | undefined): string {
  if (typeof actor !== "string" || !IDENTIFIER.test(actor)) {
    throw new SequenceProofError("invalid_actor", "actor selectors must return a SequenceProof identifier");
  }
  const command = manifest?.commands.find(({ id }) => id === target);
  if (command !== undefined && !command.actors.includes(actor)) {
    throw new SequenceProofError("manifest_actor_mismatch", `actor ${actor} is not permitted for adapter command ${target}`);
  }
  return actor;
}

function makeRunId(seed: Seed): RunId {
  const random = createRandom(seed).fork("run-id");
  return `run-${Array.from({ length: 4 }, () => random.integer(0, 0xffff).toString(16).padStart(4, "0")).join("")}`;
}

function isPass(result: AssertionResult): boolean { return result === true || (typeof result === "object" && result.pass); }

function failedAssertion(result: AssertionResult, fallback: string): AssertionFailure {
  if (result === false) return { pass: false, message: fallback };
  if (typeof result === "object" && !result.pass) return result;
  return { pass: false, message: fallback };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function isAborted(signal: AbortSignal): boolean { return signal.aborted; }

function failureForError(error: unknown, step?: number): Failure {
  const base = step === undefined ? {} : { step };
  if (error instanceof GeneratorExhaustedError) return { kind: "generator", message: error.message, ...base };
  if (error instanceof DecodeError) return { kind: "decoder", message: error.message, ...base };
  if (error instanceof TimeoutError) return { kind: "timeout", message: error.message, ...base };
  return { kind: "driver", message: errorMessage(error), ...base };
}

async function within<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new TimeoutError("command_timeout", `command exceeded ${timeoutMs}ms`)); }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function metadata(options: { readonly metadata?: JsonObject }): JsonObject {
  return deepFreeze(cloneJson(options.metadata ?? {}));
}

function immutableContext<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }

async function emit(
  reporters: readonly Reporter[],
  type: ReporterEventName,
  checkId: string,
  data: JsonObject,
  runId?: RunId,
  seed?: Seed,
): Promise<void> {
  await report(reporters, {
    type,
    checkId,
    at: new Date().toISOString(),
    data,
    ...(runId === undefined ? {} : { runId }),
    ...(seed === undefined ? {} : { seed }),
  });
}

async function evaluateInvariants<Model extends JsonValue, Observation extends JsonValue>(
  definition: { readonly invariants?: readonly InvariantDefinition<Model, Observation>[] },
  context: Readonly<ModelContext<Model, Observation>>,
): Promise<{ readonly assertions: DriverAssertion[]; readonly failure?: Failure }> {
  const assertions: DriverAssertion[] = [];
  for (const invariant of definition.invariants ?? []) {
    const result = await invariant.check(context);
    assertions.push({ name: invariant.name, result });
    if (!isPass(result)) {
      return {
        assertions,
        failure: { kind: "invariant", name: invariant.name, message: failedAssertion(result, `invariant ${invariant.name} failed`).message, assertion: failedAssertion(result, `invariant ${invariant.name} failed`), step: context.step },
      };
    }
  }
  return { assertions };
}

async function driverAssertions<Observation extends JsonValue>(
  driver: Driver<Observation>,
  context: Parameters<NonNullable<Driver<Observation>["assertions"]>>[0],
): Promise<{ readonly assertions: readonly DriverAssertion[]; readonly failure?: Failure }> {
  const assertions = driver.assertions === undefined ? [] : await driver.assertions(context);
  for (const assertion of assertions) {
    if (!isPass(assertion.result)) {
      const failed = failedAssertion(assertion.result, `server invariant ${assertion.name} failed`);
      return { assertions, failure: { kind: "server_invariant", name: assertion.name, message: failed.message, assertion: failed, step: context.step } };
    }
  }
  return { assertions };
}

function weightedCommand<Model extends JsonValue, Observation extends JsonValue>(
  commands: readonly [string, AnyCommand<Model, Observation>][],
  context: Readonly<ModelContext<Model, Observation>>,
  random: ReturnType<typeof createRandom>,
): readonly [string, AnyCommand<Model, Observation>] | undefined {
  const eligible = commands.flatMap(([name, command]) => {
    if (!command.enabled(context)) return [];
    const weight = typeof command.weight === "function" ? command.weight(context) : command.weight ?? 1;
    if (!Number.isSafeInteger(weight) || weight < 0) throw new GeneratorExhaustedError("invalid_weight", `command ${name} produced invalid weight`);
    return weight === 0 ? [] : [{ name, command, weight }];
  });
  if (eligible.length === 0) return undefined;
  const total = eligible.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isSafeInteger(total)) throw new GeneratorExhaustedError("invalid_weight", "command weight total is unsafe");
  let selection = random.integer(1, total);
  for (const item of eligible) {
    selection -= item.weight;
    if (selection <= 0) return [item.name, item.command];
  }
  return undefined;
}

interface SequenceResult<Model extends JsonValue, Observation extends JsonValue> {
  readonly initialModel: Model;
  readonly initialProperties: readonly DriverAssertion[];
  readonly model: Model;
  readonly observation: Observation;
  readonly steps: readonly TraceStepV1[];
  readonly failure?: Failure;
  readonly divergence?: string;
}

async function executeRecorded<Model extends JsonValue, Observation extends JsonValue, Commands extends CommandDefinitions<Model, Observation>>(
  modelObject: StateModel<Model, Observation, Commands>,
  driver: Driver<Observation>,
  contextBase: { readonly runId: RunId; readonly seed: Seed; readonly metadata: JsonObject; readonly signal: AbortSignal },
  records: readonly Pick<TraceStepV1, "command" | "target" | "actor" | "input">[],
  resetAttempt: number,
  expectedInitialObservation?: Observation,
): Promise<SequenceResult<Model, Observation>> {
  const definition = modelDefinition(modelObject);
  let observation = deepFreeze(await driver.reset(immutableContext({ ...contextBase, attempt: resetAttempt, reason: "shrink" }))) as Observation;
  let currentModel = deepFreeze(definition.initial(immutableContext({ observation }))) as Model;
  const initialModel = currentModel;
  const steps: TraceStepV1[] = [];
  if (expectedInitialObservation !== undefined && !jsonEqual(observation, expectedInitialObservation)) {
    return { initialModel, initialProperties: [], model: currentModel, observation, steps, divergence: "reset observation differs" };
  }
  const initialInvariant = await evaluateInvariants(definition, immutableContext({ model: currentModel, observation, step: 0 }));
  const initialServer = await driverAssertions(driver, immutableContext({ ...contextBase, step: 0, reason: "initial" }));
  const initialProperties = [...initialInvariant.assertions, ...initialServer.assertions];
  const initialFailure = initialInvariant.failure ?? initialServer.failure;
  if (initialFailure !== undefined) return { initialModel, initialProperties, model: currentModel, observation, steps, failure: initialFailure };
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const command = definition.commands[record.command] as AnyCommand<Model, Observation> | undefined;
    if (command === undefined) return { initialModel, initialProperties, model: currentModel, observation, steps, divergence: `unknown replay command ${record.command}` };
    const before = deepFreeze({ model: currentModel, observation, step: index });
    if (!command.enabled(before)) return { initialModel, initialProperties, model: currentModel, observation, steps };
    const target = command.target ?? record.command;
    if (target !== record.target) return { initialModel, initialProperties, model: currentModel, observation, steps, divergence: "command target differs" };
    const actor = validateSelectedActor(
      typeof command.actor === "function" ? command.actor(before) : command.actor,
      target,
      (driver as unknown as DriverWithManifest).manifest,
    );
    if (actor !== record.actor) return { initialModel, initialProperties, model: currentModel, observation, steps, divergence: "command actor differs" };
    const input = deepFreeze(cloneJson(record.input)) as JsonValue;
    const outcome = await driver.execute(
      immutableContext({ id: target, actor, input }),
      immutableContext({ ...contextBase, step: index }),
    );
    const nextObservation = deepFreeze(await driver.observe(immutableContext({ ...contextBase, step: index, reason: "after_command" }))) as Observation;
    const decoded = deepFreeze(outcome.status === "ok"
      ? { status: "ok" as const, value: (command.output ?? jsonValueDecoder).decode(outcome.value) }
      : outcome) as CommandOutcome;
    const nextModel = deepFreeze(command.transition(before, input, decoded)) as Model;
    const properties: TraceStepV1["properties"][number][] = [];
    let failure: Failure | undefined;
    for (const postcondition of command.postconditions ?? []) {
      const result = await postcondition.check(immutableContext({ before, input, outcome: decoded, nextModel, observation: nextObservation, actor, step: index }));
      properties.push({ kind: "postcondition", name: postcondition.name, result });
      if (!isPass(result) && failure === undefined) {
        const failed = failedAssertion(result, `postcondition ${postcondition.name} failed`);
        failure = { kind: "postcondition", name: postcondition.name, message: failed.message, assertion: failed, step: index };
      }
    }
    const invariants = await evaluateInvariants(definition, immutableContext({ model: nextModel, observation: nextObservation, step: index }));
    for (const assertion of invariants.assertions) properties.push({ kind: "invariant", name: assertion.name, result: assertion.result });
    failure ??= invariants.failure;
    const server = await driverAssertions(driver, immutableContext({ ...contextBase, step: index, reason: "after_command" }));
    for (const assertion of server.assertions) properties.push({ kind: "server_invariant", name: assertion.name, result: assertion.result });
    failure ??= server.failure;
    steps.push({
      step: index,
      command: record.command,
      target,
      actor,
      input: cloneJson(input),
      outcome: cloneJson(decoded),
      model_before: cloneJson(currentModel),
      model_after: cloneJson(nextModel),
      observation_before: cloneJson(observation),
      observation_after: cloneJson(nextObservation),
      properties,
    });
    currentModel = nextModel;
    observation = nextObservation;
    if (failure !== undefined) return { initialModel, initialProperties, model: currentModel, observation, steps, failure };
  }
  return { initialModel, initialProperties, model: currentModel, observation, steps };
}

function sameFailure(left: Failure | undefined, right: Failure): boolean {
  return left?.kind === right.kind && left.name === right.name;
}

async function shrinkFailure<Model extends JsonValue, Observation extends JsonValue, Commands extends CommandDefinitions<Model, Observation>>(
  modelObject: StateModel<Model, Observation, Commands>,
  driver: Driver<Observation>,
  base: { readonly runId: RunId; readonly seed: Seed; readonly metadata: JsonObject; readonly signal: AbortSignal },
  original: readonly TraceStepV1[],
  failure: Failure,
  maxAttempts: number,
  maxTimeMs: number,
  expectedInitialObservation: Observation,
  onCandidate: (attempt: number, steps: number, reproduced: boolean) => Promise<void>,
): Promise<{ readonly steps: readonly TraceStepV1[]; readonly failure: Failure; readonly attempted: number; readonly complete: boolean }> {
  const definition = modelDefinition(modelObject);
  let records = original.map(({ command, target, actor, input }) => ({ command, target, actor, input }));
  let best = original;
  let bestFailure = failure;
  let attempts = 0;
  const deadline = Date.now() + maxTimeMs;
  const tryCandidate = async (candidate: typeof records): Promise<boolean> => {
    if (attempts >= maxAttempts || Date.now() >= deadline) return false;
    attempts += 1;
    const result = await executeRecorded(modelObject, driver, base, candidate, attempts, expectedInitialObservation);
    const reproduced = result.divergence === undefined && sameFailure(result.failure, failure);
    await onCandidate(attempts, candidate.length, reproduced);
    if (!reproduced) return false;
    records = candidate;
    best = result.steps;
    bestFailure = result.failure!;
    return true;
  };

  for (let chunk = Math.max(1, Math.floor(records.length / 2)); chunk >= 1;) {
    let reduced = false;
    for (let start = 0; start < records.length; start += chunk) {
      const candidate = [...records.slice(0, start), ...records.slice(start + chunk)];
      if (await tryCandidate(candidate)) { reduced = true; break; }
    }
    if (!reduced) chunk = Math.floor(chunk / 2);
    if (attempts >= maxAttempts || Date.now() >= deadline) break;
  }

  for (let index = 0; index < records.length && attempts < maxAttempts && Date.now() < deadline; index += 1) {
    const record = records[index]!;
    const command = definition.commands[record.command] as AnyCommand<Model, Observation> | undefined;
    if (command === undefined) continue;
    for (const input of command.input.shrink(record.input)) {
      const candidate = records.map((item, itemIndex) => itemIndex === index ? { ...item, input } : item);
      if (await tryCandidate(candidate)) break;
      if (attempts >= maxAttempts || Date.now() >= deadline) break;
    }
  }
  return { steps: best, failure: bestFailure, attempted: attempts, complete: attempts < maxAttempts && Date.now() < deadline };
}

/** Executes one deterministic model run against one driver. */
export async function run<Model extends JsonValue, Observation extends JsonValue, Commands extends CommandDefinitions<Model, Observation>>(
  modelObject: StateModel<Model, Observation, Commands>,
  options: RunOptions<Observation>,
): Promise<RunResult<Model, Observation>> {
  validateRunOptions(options);
  const seed = createSeed(options.seed);
  const runId = makeRunId(seed);
  const checkId = `check-${runId}`;
  const reporters = options.reporters ?? [];
  const signal = options.signal ?? new AbortController().signal;
  const meta = metadata(options);
  const base = immutableContext({ runId, seed, metadata: meta, signal });
  const definition = modelDefinition(modelObject);
  const commands = Object.entries(definition.commands) as [string, AnyCommand<Model, Observation>][];
  const maxSteps = options.maxSteps ?? 100;
  const size = options.size ?? 100;
  const started = new Date().toISOString();
  const startedMs = Date.now();
  let status: RunStatus = "errored";
  let termination: RunResult<Model, Observation>["termination"] = "error";
  let failure: Failure | undefined;
  let observation = {} as Observation;
  let currentModel = {} as Model;
  let initialModel = {} as Model;
  let initialObservation = {} as Observation;
  let initialProperties: DriverAssertion[] = [];
  let steps: TraceStepV1[] = [];
  let shrink: TraceV1["shrink"] | undefined;
  await emit(reporters, "run_start", checkId, { driver: options.driver.name }, runId, seed);
  try {
    if (isAborted(signal)) throw new DOMException("run aborted", "AbortError");
    observation = deepFreeze(await options.driver.setup(base));
    validateModelManifest(definition, (options.driver as unknown as DriverWithManifest).manifest);
    currentModel = deepFreeze(definition.initial(immutableContext({ observation })));
    initialModel = cloneJson(currentModel);
    initialObservation = cloneJson(observation);
    const initialInvariant = await evaluateInvariants(definition, immutableContext({ model: currentModel, observation, step: 0 }));
    const initialServer = await driverAssertions(options.driver, immutableContext({ ...base, step: 0, reason: "initial" }));
    initialProperties = [...initialInvariant.assertions, ...initialServer.assertions];
    for (const property of initialProperties) {
      await emit(reporters, "property", checkId, {
        step: 0,
        phase: "initial",
        kind: initialInvariant.assertions.includes(property) ? "invariant" : "server_invariant",
        name: property.name,
        pass: isPass(property.result),
      }, runId, seed);
    }
    failure = initialInvariant.failure ?? initialServer.failure;
    if (failure !== undefined) { status = "failed"; termination = "failure"; }

    const random = createRandom(seed);
    for (let step = 0; failure === undefined && step < maxSteps; step += 1) {
      if (isAborted(signal)) { status = "aborted"; termination = "abort"; break; }
      const before = deepFreeze({ model: currentModel, observation, step });
      const selected = weightedCommand(commands, before, random.fork(`step:${step}:command`));
      if (selected === undefined) { status = "passed"; termination = "no_enabled_commands"; break; }
      const [name, command] = selected;
      const input = deepFreeze(command.input.sample(random.fork(`step:${step}:input`), size)) as JsonValue;
      if (!command.enabled(before)) throw new GeneratorExhaustedError("command_disabled", `command ${name} became disabled before execution`);
      const target = command.target ?? name;
      const actor = validateSelectedActor(
        typeof command.actor === "function" ? command.actor(before) : command.actor,
        target,
        (options.driver as unknown as DriverWithManifest).manifest,
      );
      const rawOutcome = await within(options.driver.execute(immutableContext({ id: target, actor, input }), immutableContext({ ...base, step })), options.commandTimeoutMs);
      const nextObservation = deepFreeze(await options.driver.observe(immutableContext({ ...base, step, reason: "after_command" }))) as Observation;
      const outcome = deepFreeze(rawOutcome.status === "ok"
        ? { status: "ok", value: (command.output ?? jsonValueDecoder).decode(rawOutcome.value) }
        : rawOutcome) as CommandOutcome;
      const nextModel = deepFreeze(command.transition(before, input, outcome)) as Model;
      const properties: TraceStepV1["properties"][number][] = [];
      for (const postcondition of command.postconditions ?? []) {
        const result = await postcondition.check(immutableContext({ before, input, outcome, nextModel, observation: nextObservation, actor, step }));
        properties.push({ kind: "postcondition", name: postcondition.name, result });
        if (!isPass(result) && failure === undefined) {
          const failed = failedAssertion(result, `postcondition ${postcondition.name} failed`);
          failure = { kind: "postcondition", name: postcondition.name, message: failed.message, assertion: failed, step };
        }
      }
      const invariants = await evaluateInvariants(definition, immutableContext({ model: nextModel, observation: nextObservation, step }));
      for (const assertion of invariants.assertions) properties.push({ kind: "invariant", name: assertion.name, result: assertion.result });
      failure ??= invariants.failure;
      const server = await driverAssertions(options.driver, immutableContext({ ...base, step, reason: "after_command" }));
      for (const assertion of server.assertions) properties.push({ kind: "server_invariant", name: assertion.name, result: assertion.result });
      failure ??= server.failure;
      const traceStep: TraceStepV1 = {
        step,
        command: name,
        target,
        actor,
        input: cloneJson(input),
        outcome: cloneJson(outcome),
        model_before: cloneJson(currentModel),
        model_after: cloneJson(nextModel),
        observation_before: cloneJson(observation),
        observation_after: cloneJson(nextObservation),
        properties,
      };
      steps.push(traceStep);
      currentModel = nextModel;
      observation = nextObservation;
      for (const property of properties) {
        await emit(reporters, "property", checkId, {
          step,
          phase: "after_command",
          kind: property.kind,
          name: property.name,
          pass: isPass(property.result),
        }, runId, seed);
      }
      await emit(reporters, "step", checkId, { step, command: name, actor, outcome: outcome.status }, runId, seed);
      if (failure !== undefined) { status = "failed"; termination = "failure"; }
      else if (step === maxSteps - 1) { status = "passed"; termination = "max_steps"; }
    }
    if (maxSteps === 0 && failure === undefined) { status = "passed"; termination = "max_steps"; }

    if (failure !== undefined && options.shrink === true && steps.length > 0) {
      const original = [...steps];
      await emit(reporters, "shrink_start", checkId, {
        original_steps: original.length,
        original_trace_steps: redactTraceValue(options.driver, original as unknown as JsonValue),
        original_failure: redactTraceValue(options.driver, failure as unknown as JsonValue),
      }, runId, seed);
      const reduced = await shrinkFailure(
        modelObject,
        options.driver,
        base,
        original,
        failure,
        options.maxShrinkAttempts ?? 1_000,
        options.maxShrinkTimeMs ?? 60_000,
        initialObservation,
        async (attempt, candidateSteps, reproduced) => {
          await emit(reporters, "shrink_candidate", checkId, {
            attempt,
            candidate_steps: candidateSteps,
            reproduced,
          }, runId, seed);
        },
      );
      steps = [...reduced.steps];
      failure = reduced.failure;
      shrink = { attempted: reduced.attempted, complete: reduced.complete, original_steps: original.length, minimal_steps: steps.length };
      await emit(reporters, "shrink_complete", checkId, { attempted: reduced.attempted, complete: reduced.complete, original_steps: original.length, minimal_steps: steps.length }, runId, seed);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") { status = "aborted"; termination = "abort"; }
    else {
      failure = failureForError(error, steps.length);
      status = error instanceof GeneratorExhaustedError ? "exhausted" : "errored";
      termination = error instanceof GeneratorExhaustedError ? "exhaustion" : "error";
    }
  }

  try {
    await options.driver.dispose(immutableContext({ ...base, status }));
  } catch (disposeError) {
    if (failure === undefined) {
      failure = failureForError(new DriverError("dispose_failed", "driver disposal failed", { cause: disposeError }));
      status = "errored";
      termination = "error";
    }
  }
  const manifest = (options.driver as unknown as DriverWithManifest).manifest;
  const rawTrace = {
    schema: "urn:sequenceproof:schema:trace:v1",
    protocol_version: 1,
    core_version: CORE_VERSION,
    model: { name: modelObject.name, version: modelObject.version },
    adapter: { name: manifest?.adapter.name ?? options.driver.name, version: manifest?.adapter.version ?? 1, manifest_digest: manifest?.digest ?? "local" },
    run: {
      id: runId,
      seed,
      options: {
        max_steps: maxSteps,
        size,
        ...(options.commandTimeoutMs === undefined ? {} : { command_timeout_ms: options.commandTimeoutMs }),
        shrink: options.shrink ?? false,
        max_shrink_attempts: options.maxShrinkAttempts ?? 1_000,
        max_shrink_time_ms: options.maxShrinkTimeMs ?? 60_000,
      },
      metadata: meta,
    },
    status,
    initial: { model: cloneJson(initialModel), observation: cloneJson(initialObservation), properties: initialProperties },
    steps,
    ...(failure === undefined ? {} : { failure }),
    ...(shrink === undefined ? {} : { shrink }),
    diagnostics: { started_at: started, duration_ms: Date.now() - startedMs },
  } as TraceV1;
  const trace = deepFreeze(redactTraceValue(options.driver as unknown as Driver<JsonValue>, rawTrace as unknown as JsonValue) as unknown as TraceV1);
  await emit(reporters, "run_complete", checkId, { status, steps: steps.length }, runId, seed);
  return {
    status,
    seed,
    stepsExecuted: steps.length,
    termination,
    finalModel: currentModel,
    finalObservation: observation,
    ...(failure === undefined ? {} : { failure }),
    trace,
  };
}

/** Executes a bounded campaign with one fresh driver per independently seeded run. */
export async function check<Model extends JsonValue, Observation extends JsonValue, Commands extends CommandDefinitions<Model, Observation>>(
  model: StateModel<Model, Observation, Commands>,
  options: CheckOptions<Observation>,
): Promise<CheckResult> {
  const runs = options.runs ?? 100;
  const concurrency = options.concurrency ?? 1;
  validateRunOptions(options);
  if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new SequenceProofError("invalid_check_options", "runs and concurrency must be positive safe integers");
  }
  const baseSeed = createSeed(options.seed);
  const checkId = `check-${makeRunId(baseSeed)}`;
  const reporters = options.reporters ?? [];
  await emit(reporters, "check_start", checkId, { runs, concurrency, seed: baseSeed });
  let nextIndex = 0;
  let passed = 0;
  let failed = 0;
  let firstFailure: TraceV1 | undefined;
  let terminal: RunStatus = "passed";
  const worker = async (): Promise<void> => {
    while (nextIndex < runs && !(options.stopOnFailure === true && firstFailure !== undefined)) {
      const index = nextIndex;
      nextIndex += 1;
      const driver = await options.driver();
      const result = await run(model, {
        driver,
        seed: `${baseSeed}:${index}`,
        ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
        ...(options.size === undefined ? {} : { size: options.size }),
        ...(options.commandTimeoutMs === undefined ? {} : { commandTimeoutMs: options.commandTimeoutMs }),
        ...(options.stopOnFailure === undefined ? {} : { stopOnFailure: options.stopOnFailure }),
        ...(options.shrink === undefined ? {} : { shrink: options.shrink }),
        ...(options.maxShrinkAttempts === undefined ? {} : { maxShrinkAttempts: options.maxShrinkAttempts }),
        ...(options.maxShrinkTimeMs === undefined ? {} : { maxShrinkTimeMs: options.maxShrinkTimeMs }),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        reporters,
      });
      if (result.status === "passed") passed += 1;
      else {
        failed += 1;
        firstFailure ??= result.trace;
        terminal = result.status;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, runs) }, worker));
  await emit(reporters, "check_complete", checkId, { status: terminal, runs: passed + failed, passed, failed });
  return {
    status: terminal,
    runs: passed + failed,
    passed,
    failed,
    ...(firstFailure === undefined ? {} : { firstFailure }),
  };
}

/** Replays a trace and distinguishes reproduction, a fixed failure, and divergence. */
export async function replay<Model extends JsonValue, Observation extends JsonValue, Commands extends CommandDefinitions<Model, Observation>>(
  model: StateModel<Model, Observation, Commands>,
  trace: TraceV1,
  options: ReplayOptions<Observation>,
): Promise<ReplayResult> {
  if (trace.model.name !== model.name || trace.model.version !== model.version) {
    return { status: "replay_diverged", matchedSteps: 0, divergence: { step: 0, message: "model identity differs" }, trace };
  }
  const signal = options.signal ?? new AbortController().signal;
  const base = immutableContext({ runId: trace.run.id, seed: trace.run.seed, metadata: deepFreeze(cloneJson(trace.run.metadata)), signal });
  let status: RunStatus = "replay_diverged";
  let matchedSteps = 0;
  let divergence: ReplayResult["divergence"];
  try {
    const observation = await options.driver.setup(base);
    const manifest = (options.driver as unknown as DriverWithManifest).manifest;
    if (manifest !== undefined && manifest.digest !== trace.adapter.manifest_digest) {
      divergence = { step: 0, message: "adapter manifest digest differs" };
    } else if (!jsonEqual(observation, trace.initial.observation)) divergence = { step: 0, message: "initial observation differs" };
    else {
      const result = await executeRecorded(model, options.driver, base, trace.steps, 1, trace.initial.observation as Observation);
      matchedSteps = result.steps.length;
      if (result.divergence !== undefined) divergence = { step: 0, message: result.divergence };
      else if (matchedSteps !== trace.steps.length) divergence = { step: matchedSteps, message: "replay ended before the trace" };
      else {
        const initialMismatch = !jsonEqual(result.initialModel, trace.initial.model)
          ? "initial model differs"
          : !jsonEqual(result.initialProperties as unknown as JsonValue, trace.initial.properties as unknown as JsonValue)
            ? "initial properties differ"
            : undefined;
        const mismatch = result.steps.findIndex((actual, index) => {
          const expected = trace.steps[index]!;
          return !jsonEqual(actual.outcome, expected.outcome)
            || !jsonEqual(actual.model_before, expected.model_before)
            || !jsonEqual(actual.model_after, expected.model_after)
            || !jsonEqual(actual.observation_before, expected.observation_before)
            || !jsonEqual(actual.observation_after, expected.observation_after)
            || !jsonEqual(actual.properties as unknown as JsonValue, expected.properties as unknown as JsonValue);
        });
        if (trace.failure === undefined) {
          if (initialMismatch !== undefined) divergence = { step: 0, message: initialMismatch };
          else if (mismatch >= 0) divergence = { step: mismatch, message: "recorded step behavior differs" };
          else {
            status = result.failure === undefined ? "passed" : "replay_diverged";
            if (status === "replay_diverged") divergence = { step: 0, message: "passing trace now fails" };
          }
        } else if (result.failure === undefined) status = "passed";
        else if (!sameFailure(result.failure, trace.failure)) {
          divergence = { step: result.failure.step ?? 0, message: "replay produced a different failure" };
        } else if (initialMismatch !== undefined) divergence = { step: 0, message: initialMismatch };
        else if (mismatch >= 0) divergence = { step: mismatch, message: "recorded step behavior differs" };
        else status = trace.status;
      }
    }
  } catch (error) {
    divergence = { step: matchedSteps, message: errorMessage(error) };
  } finally {
    try {
      await options.driver.dispose(immutableContext({ ...base, status }));
    } catch (error) {
      if (divergence === undefined && trace.failure === undefined) {
        status = "replay_diverged";
        divergence = { step: matchedSteps, message: errorMessage(error) };
      }
    }
  }
  return { status, matchedSteps, ...(divergence === undefined ? {} : { divergence }), trace };
}
