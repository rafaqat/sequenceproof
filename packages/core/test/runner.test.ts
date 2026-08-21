import { describe, expect, it } from "vitest";
import {
  assert,
  check,
  defineModel,
  gen,
  replay,
  run,
  type CommandCall,
  type CommandOutcome,
  type Driver,
  type JsonValue,
  type ReporterEvent,
} from "../src/index.js";
import type { AdapterManifestV1 } from "../src/types.js";

type Counter = { value: number };

class CounterDriver implements Driver<Counter> {
  readonly name = "counter";
  value = 0;
  resets = 0;
  disposed = false;
  readonly broken: boolean;

  constructor(broken = false) { this.broken = broken; }
  async setup(): Promise<Counter> { this.value = 0; return { value: this.value }; }
  async execute<Input extends JsonValue>(call: CommandCall<Input>): Promise<CommandOutcome> {
    const amount = (call.input as { amount: number }).amount;
    this.value += this.broken && amount === 2 ? amount + 1 : amount;
    return { status: "ok", value: { accepted: amount } };
  }
  async observe(): Promise<Counter> { return { value: this.value }; }
  async reset(): Promise<Counter> { this.resets += 1; this.value = 0; return { value: 0 }; }
  async dispose(): Promise<void> { this.disposed = true; }
}

const counterModel = defineModel<Counter, Counter>()(({ command, invariant, postcondition }) => ({
  name: "counter",
  version: 1,
  initial: ({ observation }) => observation,
  commands: {
    increment: command<{ amount: number }, { accepted: number }>({
      input: gen.record({ amount: gen.integer({ min: 1, max: 3 }) }),
      actor: "user",
      enabled: () => true,
      transition: ({ model }, input) => ({ value: model.value + input.amount }),
      postconditions: [postcondition({
        name: "matches",
        check: ({ nextModel, observation }) => assert.deepEqual(observation, nextModel),
      })],
    }),
  },
  invariants: [invariant({ name: "nonnegative", check: ({ model }) => assert.ok(model.value >= 0) })],
}));

describe("runner", () => {
  it("executes a deterministic passing run and disposes", async () => {
    const driver = new CounterDriver();
    const result = await run(counterModel, { driver, seed: "pass", maxSteps: 10 });
    expect(result.status).toBe("passed");
    expect(result.stepsExecuted).toBe(10);
    expect(driver.disposed).toBe(true);
  });

  it("passes immutable snapshots to driver and model callbacks", async () => {
    const callbackChecks: boolean[] = [];
    const model = defineModel<Counter, Counter>()(({ command, invariant, postcondition }) => ({
      name: "immutable-counter",
      version: 1,
      initial: (context) => {
        callbackChecks.push(Object.isFrozen(context), Object.isFrozen(context.observation));
        return context.observation;
      },
      commands: {
        increment: command<{ amount: number }>({
          input: gen.constant({ amount: 1 }),
          actor: "user",
          enabled: (context) => { callbackChecks.push(Object.isFrozen(context)); return true; },
          transition: (context, input, outcome) => {
            callbackChecks.push(Object.isFrozen(context), Object.isFrozen(input), Object.isFrozen(outcome));
            return { value: context.model.value + input.amount };
          },
          postconditions: [postcondition({
            name: "frozen-postcondition",
            check: (context) => {
              callbackChecks.push(Object.isFrozen(context), Object.isFrozen(context.nextModel), Object.isFrozen(context.observation));
              return true;
            },
          })],
        }),
      },
      invariants: [invariant({
        name: "frozen-invariant",
        check: (context) => { callbackChecks.push(Object.isFrozen(context), Object.isFrozen(context.model)); return true; },
      })],
    }));
    const baseDriver = new CounterDriver();
    const driver: Driver<Counter> = {
      name: baseDriver.name,
      async setup(context) {
        callbackChecks.push(Object.isFrozen(context), Object.isFrozen(context.metadata));
        return baseDriver.setup();
      },
      async execute(call, context) {
        callbackChecks.push(Object.isFrozen(call), Object.isFrozen(call.input), Object.isFrozen(context));
        return baseDriver.execute(call);
      },
      async observe(context) {
        callbackChecks.push(Object.isFrozen(context));
        return baseDriver.observe();
      },
      async reset(context) {
        callbackChecks.push(Object.isFrozen(context));
        return baseDriver.reset();
      },
      async dispose(context) {
        callbackChecks.push(Object.isFrozen(context));
        return baseDriver.dispose();
      },
    };

    const result = await run(model, { driver, seed: "immutable", maxSteps: 1, metadata: { source: "test" } });

    expect(result.status).toBe("passed");
    expect(callbackChecks.length).toBeGreaterThan(0);
    expect(callbackChecks.every(Boolean)).toBe(true);
  });

  it("finds and shrinks a planted failure from clean resets", async () => {
    const driver = new CounterDriver(true);
    const result = await run(counterModel, {
      driver, seed: "find-two", maxSteps: 20, shrink: true, maxShrinkAttempts: 100, maxShrinkTimeMs: 5_000,
    });
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ kind: "postcondition", name: "matches" });
    expect(result.trace.shrink?.minimal_steps).toBe(1);
    expect(result.trace.failure?.step).toBe(0);
    expect(driver.resets).toBeGreaterThan(0);
  });

  it("uses a fresh driver for every check run", async () => {
    const drivers: CounterDriver[] = [];
    const result = await check(counterModel, {
      driver: () => { const driver = new CounterDriver(); drivers.push(driver); return driver; },
      seed: "check", runs: 8, concurrency: 3, maxSteps: 3,
    });
    expect(result).toMatchObject({ status: "passed", runs: 8, passed: 8 });
    expect(new Set(drivers).size).toBe(8);
    expect(drivers.every((driver) => driver.disposed)).toBe(true);
  });

  it("excludes zero-weight commands from deterministic selection", async () => {
    const selected: string[] = [];
    const driver = new CounterDriver();
    const execute = driver.execute.bind(driver);
    driver.execute = async (call) => { selected.push(call.id); return execute(call); };
    const model = defineModel<Counter, Counter>()(({ command }) => ({
      name: "weighted-counter",
      version: 1,
      initial: ({ observation }) => observation,
      commands: {
        excluded: command<{ amount: number }>({
          input: gen.constant({ amount: 100 }), actor: "user", enabled: () => true, weight: 0,
          transition: ({ model: current }, input) => ({ value: current.value + input.amount }),
        }),
        selected: command<{ amount: number }>({
          input: gen.constant({ amount: 1 }), actor: "user", enabled: () => true, weight: 1,
          transition: ({ model: current }, input) => ({ value: current.value + input.amount }),
        }),
      },
    }));

    const result = await run(model, { driver, seed: "weights", maxSteps: 5 });

    expect(result.status).toBe("passed");
    expect(selected).toEqual(Array.from({ length: 5 }, () => "selected"));
  });

  it("treats an empty enabled-command set as normal termination", async () => {
    const model = defineModel<Counter, Counter>()(({ command }) => ({
      name: "disabled-counter",
      version: 1,
      initial: ({ observation }) => observation,
      commands: {
        disabled: command<{ amount: number }>({
          input: gen.constant({ amount: 1 }), actor: "user", enabled: () => false,
          transition: ({ model: current }) => current,
        }),
      },
    }));

    const result = await run(model, { driver: new CounterDriver(), seed: "disabled", maxSteps: 5 });

    expect(result).toMatchObject({ status: "passed", termination: "no_enabled_commands", stepsExecuted: 0 });
  });

  it("passes explicit rejected outcomes through the model transition", async () => {
    const driver = new CounterDriver();
    driver.execute = async () => { driver.value = -1; return { status: "rejected", code: "refused" }; };
    const model = defineModel<Counter, Counter>()(({ command, invariant }) => ({
      name: "rejected-counter",
      version: 1,
      initial: ({ observation }) => observation,
      commands: {
        reject: command<null>({
          input: gen.constant(null), actor: "user", enabled: () => true,
          transition: (_context, _input, outcome) => ({ value: outcome.status === "rejected" ? -1 : 1 }),
        }),
      },
      invariants: [invariant({ name: "matches-rejection", check: ({ model: current, observation }) => assert.deepEqual(current, observation) })],
    }));

    const result = await run(model, { driver, seed: "rejected", maxSteps: 1 });

    expect(result.status).toBe("passed");
    expect(result.trace.steps[0]?.outcome).toEqual({ status: "rejected", code: "refused" });
  });

  it("reports that a recorded property failure no longer reproduces after a fix", async () => {
    const failed = await run(counterModel, { driver: new CounterDriver(true), seed: "find-two", maxSteps: 20 });
    const replayed = await replay(counterModel, failed.trace, { driver: new CounterDriver(false) });
    expect(replayed.status).toBe("passed");
  });

  it("reports replay divergence when reset no longer recreates the recorded initial state", async () => {
    const failed = await run(counterModel, { driver: new CounterDriver(true), seed: "find-two", maxSteps: 20 });
    const changed = new CounterDriver(true);
    changed.reset = async () => {
      changed.value = 99;
      return { value: 99 };
    };

    const replayed = await replay(counterModel, failed.trace, { driver: changed });

    expect(replayed).toMatchObject({
      status: "replay_diverged",
      divergence: { step: 0, message: "reset observation differs" },
    });
  });

  it("does not accept the same named failure when recorded step behavior changed", async () => {
    const failed = await run(counterModel, { driver: new CounterDriver(true), seed: "find-two", maxSteps: 20 });
    const changed = new CounterDriver();
    changed.execute = async <Input extends JsonValue>(call: CommandCall<Input>) => {
      const amount = (call.input as { amount: number }).amount;
      changed.value += amount + 2;
      return { status: "ok", value: { accepted: amount } };
    };

    const replayed = await replay(counterModel, failed.trace, { driver: changed });

    expect(replayed).toMatchObject({
      status: "replay_diverged",
      divergence: { message: "recorded step behavior differs" },
    });
  });

  it("detects abstract model drift even when the same named failure still occurs", async () => {
    const failed = await run(counterModel, { driver: new CounterDriver(true), seed: "find-two", maxSteps: 20 });
    type ChangedCounter = Counter & { shadow?: number };
    const changedModel = defineModel<ChangedCounter, Counter>()(({ command, invariant, postcondition }) => ({
      name: "counter",
      version: 1,
      initial: ({ observation }) => observation,
      commands: {
        increment: command<{ amount: number }, { accepted: number }>({
          input: gen.record({ amount: gen.integer({ min: 1, max: 3 }) }),
          actor: "user",
          enabled: () => true,
          transition: ({ model }, input) => ({ value: model.value + input.amount, shadow: (model.shadow ?? 0) + 1 }),
          postconditions: [postcondition({
            name: "matches",
            check: ({ nextModel, observation }) => assert.equal(observation.value, nextModel.value),
          })],
        }),
      },
      invariants: [invariant({ name: "nonnegative", check: ({ model }) => assert.ok(model.value >= 0) })],
    }));

    const replayed = await replay(changedModel, failed.trace, { driver: new CounterDriver(true) });

    expect(replayed).toMatchObject({
      status: "replay_diverged",
      divergence: { message: "recorded step behavior differs" },
    });
  });

  it("rejects a replay when a command target changed without a model version bump", async () => {
    const failed = await run(counterModel, { driver: new CounterDriver(true), seed: "find-two", maxSteps: 20 });
    const changedTarget = defineModel<Counter, Counter>()(({ command, postcondition }) => ({
      name: "counter",
      version: 1,
      initial: ({ observation }) => observation,
      commands: {
        increment: command<{ amount: number }, { accepted: number }>({
          target: "increment_v2",
          input: gen.record({ amount: gen.integer({ min: 1, max: 3 }) }),
          actor: "user",
          enabled: () => true,
          transition: ({ model }, input) => ({ value: model.value + input.amount }),
          postconditions: [postcondition({
            name: "matches",
            check: ({ nextModel, observation }) => assert.deepEqual(observation, nextModel),
          })],
        }),
      },
    }));

    const replayed = await replay(changedTarget, failed.trace, { driver: new CounterDriver(true) });

    expect(replayed).toMatchObject({
      status: "replay_diverged",
      divergence: { message: "command target differs" },
    });
  });

  it("reevaluates failures that occur in the initial state", async () => {
    const model = (passes: boolean) => defineModel<Counter, Counter>()(({ command, invariant }) => ({
      name: "initial-counter",
      version: 1,
      initial: ({ observation }) => observation,
      commands: {
        noop: command<null>({
          input: gen.constant(null),
          actor: "user",
          enabled: () => true,
          transition: ({ model: current }) => current,
        }),
      },
      invariants: [invariant({ name: "initial-check", check: () => passes })],
    }));
    const failed = await run(model(false), { driver: new CounterDriver(), seed: "initial-failure", maxSteps: 0 });

    const reproduced = await replay(model(false), failed.trace, { driver: new CounterDriver() });
    const fixed = await replay(model(true), failed.trace, { driver: new CounterDriver() });

    expect(reproduced).toMatchObject({ status: "failed", matchedSteps: 0 });
    expect(fixed).toMatchObject({ status: "passed", matchedSteps: 0 });
  });

  it("records a cleanup failure in both the result and trace", async () => {
    const driver = new CounterDriver();
    driver.dispose = async () => { throw new Error("cleanup canary"); };

    const result = await run(counterModel, { driver, seed: "cleanup", maxSteps: 1 });

    expect(result).toMatchObject({ status: "errored", termination: "error", failure: { kind: "driver" } });
    expect(result.trace).toMatchObject({ status: "errored", failure: { kind: "driver" } });
  });

  it("fails before executing when a protocol manifest does not permit the model actor", async () => {
    const driver = new CounterDriver() as CounterDriver & { manifest: AdapterManifestV1 };
    driver.manifest = {
      protocol: "sequenceproof.protocol", protocol_version: 1, request_id: "request-1",
      sequenceproof_rails_version: "0.1.0", supported_protocol_versions: [1],
      adapter: { name: "counter", version: 1 },
      commands: [{ id: "increment", actors: ["administrator"], input_schema: {}, output_schema: {}, metadata: {} }],
      observation_schema: {}, server_invariants: [], isolation: { mode: "callback", resettable: true },
      digest: "a".repeat(64),
    };
    const execute = driver.execute.bind(driver);
    let executed = false;
    driver.execute = async (...arguments_) => { executed = true; return execute(...arguments_); };

    const result = await run(counterModel, { driver, seed: "manifest", maxSteps: 1 });

    expect(result).toMatchObject({ status: "errored", failure: { kind: "driver" } });
    expect(executed).toBe(false);
  });

  it("validates a dynamic actor against the manifest before executing", async () => {
    const dynamicActorModel = defineModel<Counter, Counter>()(({ command }) => ({
      name: "counter",
      version: 1,
      initial: ({ observation }) => observation,
      commands: {
        increment: command<{ amount: number }>({
          input: gen.constant({ amount: 1 }),
          actor: () => "user",
          enabled: () => true,
          transition: ({ model }, input) => ({ value: model.value + input.amount }),
        }),
      },
    }));
    const driver = new CounterDriver() as CounterDriver & { manifest: AdapterManifestV1 };
    driver.manifest = {
      protocol: "sequenceproof.protocol", protocol_version: 1, request_id: "request-1",
      sequenceproof_rails_version: "0.1.0", supported_protocol_versions: [1],
      adapter: { name: "counter", version: 1 },
      commands: [{ id: "increment", actors: ["administrator"], input_schema: {}, output_schema: {}, metadata: {} }],
      observation_schema: {}, server_invariants: [], isolation: { mode: "callback", resettable: true },
      digest: "a".repeat(64),
    };
    let executed = false;
    driver.execute = async () => { executed = true; return { status: "ok", value: null }; };

    const result = await run(dynamicActorModel, { driver, seed: "dynamic-actor", maxSteps: 1 });

    expect(result).toMatchObject({ status: "errored", failure: { kind: "driver" } });
    expect(executed).toBe(false);
  });

  it("rejects duplicate postcondition identities within one command", () => {
    expect(() => defineModel<Counter, Counter>()(({ command, postcondition }) => {
      const repeated = postcondition({ name: "same", check: () => true });
      return {
        name: "duplicate-postcondition",
        version: 1,
        initial: ({ observation }) => observation,
        commands: {
          noop: command<null>({
            input: gen.constant(null),
            actor: "user",
            enabled: () => true,
            transition: ({ model }) => model,
            postconditions: [repeated, repeated],
          }),
        },
      };
    })).toThrow(/duplicate postcondition/);
  });

  it("applies a driver redactor before an error reaches a trace", async () => {
    const canary = "TRACE_SECRET_CANARY";
    const driver = new CounterDriver() as CounterDriver & {
      redactTraceValue(value: JsonValue): JsonValue;
    };
    driver.execute = async () => { throw new Error(canary); };
    driver.redactTraceValue = (value) => JSON.parse(JSON.stringify(value).replaceAll(canary, "[REDACTED]")) as JsonValue;

    const result = await run(counterModel, { driver, seed: "redaction", maxSteps: 1 });

    expect(JSON.stringify(result.trace)).not.toContain(canary);
    expect(result.trace.failure?.message).toContain("[REDACTED]");
  });

  it("redacts canaries from input, outcome, model, observation, and failure trace paths", async () => {
    const canary = "TRACE_SECRET_CANARY";
    type Secret = { secret: string };
    let state: Secret = { secret: "safe" };
    const driver: Driver<Secret> & { redactTraceValue(value: JsonValue): JsonValue } = {
      name: "secret-driver",
      async setup() { state = { secret: "safe" }; return state; },
      async execute(call) { state = call.input as Secret; return { status: "ok", value: state }; },
      async observe() { return state; },
      async reset() { state = { secret: "safe" }; return state; },
      async dispose() {},
      redactTraceValue(value) {
        return JSON.parse(JSON.stringify(value).replaceAll(canary, "[REDACTED]")) as JsonValue;
      },
    };
    const model = defineModel<Secret, Secret>()(({ command, postcondition }) => ({
      name: "secret-model",
      version: 1,
      initial: ({ observation }) => observation,
      commands: {
        reveal: command<Secret, Secret>({
          input: gen.constant({ secret: canary }),
          actor: "user",
          enabled: () => true,
          transition: (_context, _input, outcome) => outcome.status === "ok" ? outcome.value : state,
          postconditions: [postcondition({ name: "secret-failure", check: () => assert.fail(canary) })],
        }),
      },
    }));

    const result = await run(model, { driver, seed: "secret-redaction", maxSteps: 1 });

    expect(result.status).toBe("failed");
    expect(JSON.stringify(result.trace)).not.toContain(canary);
    expect(JSON.stringify(result.trace)).toContain("[REDACTED]");
  });

  it("emits property and shrink-candidate reporter events", async () => {
    const events: ReporterEvent[] = [];
    const result = await run(counterModel, {
      driver: new CounterDriver(true),
      seed: "find-two",
      maxSteps: 20,
      shrink: true,
      reporters: [{
        onProperty(event) { events.push(event); },
        onShrinkCandidate(event) { events.push(event); },
      }],
    });

    expect(result.status).toBe("failed");
    expect(events.some(({ type }) => type === "property")).toBe(true);
    expect(events.some(({ type }) => type === "shrink_candidate")).toBe(true);
    expect(events.every(Object.isFrozen)).toBe(true);
  });

  it("contains reporter failures without changing execution", async () => {
    const result = await run(counterModel, {
      driver: new CounterDriver(),
      seed: "reporter-failure",
      maxSteps: 2,
      reporters: [{ onRunStart() { throw new Error("reporter canary"); } }],
    });

    expect(result).toMatchObject({ status: "passed", stepsExecuted: 2 });
  });

  it("turns a bounded command timeout into a structured error and still disposes", async () => {
    const driver = new CounterDriver();
    driver.execute = async () => await new Promise<CommandOutcome>(() => undefined);

    const result = await run(counterModel, {
      driver,
      seed: "timeout",
      maxSteps: 1,
      commandTimeoutMs: 5,
    });

    expect(result).toMatchObject({ status: "errored", failure: { kind: "timeout" } });
    expect(driver.disposed).toBe(true);
  });

  it("honours a signal aborted before setup and still disposes", async () => {
    const controller = new AbortController();
    controller.abort();
    const driver = new CounterDriver();

    const result = await run(counterModel, {
      driver,
      signal: controller.signal,
      seed: "aborted",
    });

    expect(result).toMatchObject({ status: "aborted", termination: "abort", stepsExecuted: 0 });
    expect(driver.disposed).toBe(true);
  });
});
