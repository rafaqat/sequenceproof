import { canonicalizeJson, deepFreeze } from "./json.js";
import type { JsonObject, Reporter, ReporterEvent, ReporterWriter } from "./types.js";

/** Returns a reporter that intentionally observes no events. */
export function silentReporter(): Reporter { return Object.freeze({}); }

/** Returns a concise human-readable console reporter. */
export function consoleReporter(options: { readonly color?: boolean } = {}): Reporter {
  const color = options.color ?? true;
  const write = (label: string, event: ReporterEvent): void => {
    const prefix = color ? "\u001b[36msequenceproof\u001b[0m" : "sequenceproof";
    globalThis.console.log(`${prefix} ${label} ${canonicalizeJson(event.data)}`);
  };
  return {
    onCheckStart: (event) => { write("check:start", event); },
    onRunComplete: (event) => { write("run:complete", event); },
    onShrinkComplete: (event) => { write("shrink:complete", event); },
    onCheckComplete: (event) => { write("check:complete", event); },
  };
}

/** Returns a reporter writing canonical newline-delimited JSON events. */
export function jsonReporter(writer: ReporterWriter): Reporter {
  const emit = (event: ReporterEvent): Promise<void> => Promise.resolve(writer(canonicalizeJson(event as unknown as JsonObject))).then(() => undefined);
  return {
    onCheckStart: emit,
    onRunStart: emit,
    onStep: emit,
    onProperty: emit,
    onShrinkStart: emit,
    onShrinkCandidate: emit,
    onShrinkComplete: emit,
    onRunComplete: emit,
    onCheckComplete: emit,
  };
}

const handlers = {
  check_start: "onCheckStart",
  run_start: "onRunStart",
  step: "onStep",
  property: "onProperty",
  shrink_start: "onShrinkStart",
  shrink_candidate: "onShrinkCandidate",
  shrink_complete: "onShrinkComplete",
  run_complete: "onRunComplete",
  check_complete: "onCheckComplete",
} as const;

export async function report(reporters: readonly Reporter[], event: ReporterEvent): Promise<void> {
  const frozen = deepFreeze(event);
  const handler = handlers[event.type];
  await Promise.all(reporters.map(async (reporter) => {
    try {
      const callback = reporter[handler];
      if (callback !== undefined) await callback.call(reporter, frozen);
    } catch {
      // Reporter failures are deliberately isolated from the run.
    }
  }));
}
