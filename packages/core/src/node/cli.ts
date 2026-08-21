#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check, consoleReporter, parseTrace, replay, serializeTrace } from "../index.js";
import { createProtocolDriver, digest } from "../protocol/index.js";
import type { CommandDefinitions, JsonObject, JsonValue, Reporter, StateModel, TraceStepV1, TraceV1 } from "../index.js";
import type { AdapterManifestV1 } from "../types.js";
import { readTraceFile, writeTraceFile } from "./trace-file.js";
import { tsImport } from "tsx/esm/api";
import YAML from "yaml";
import ts from "typescript";
import { VERSION } from "../version.js";

const PROFILE_KEYS = new Set([
  "runs", "max_steps", "size", "concurrency", "command_timeout_ms", "shrink",
  "max_shrink_attempts", "max_shrink_time_ms", "stop_on_failure",
]);
const REQUIRED_PROFILE_KEYS = [...PROFILE_KEYS].filter((key) => key !== "command_timeout_ms");

type OptionValue = string | true;
interface ParsedArguments { readonly command: string; readonly positionals: readonly string[]; readonly options: Readonly<Record<string, OptionValue>> }

const OPTIONS = {
  check: new Set(["endpoint", "adapter", "profile", "seed", "runs", "max-steps", "size", "concurrency", "command-timeout-ms", "shrink", "no-shrink", "max-shrink-attempts", "max-shrink-time-ms", "stop-on-failure", "output", "token-env", "allow-insecure-http"]),
  replay: new Set(["model", "endpoint", "adapter", "token-env", "allow-insecure-http"]),
  validate: new Set<string>(),
  inspect: new Set(["format"]),
} as const;

function usage(message?: string): never {
  if (message !== undefined) process.stderr.write(`sequenceproof: ${message}\n`);
  process.stderr.write("usage: sequenceproof check <model...> --endpoint URL --adapter NAME [options]\n");
  process.stderr.write("       sequenceproof replay <trace> --model FILE --endpoint URL --adapter NAME\n");
  process.stderr.write("       sequenceproof validate <model-or-trace...>\n");
  process.stderr.write("       sequenceproof inspect <trace> --format text|json\n");
  process.exit(1);
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const command = argv[0] ?? "";
  const positionals: string[] = [];
  const options: Record<string, OptionValue> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (!value.startsWith("--")) { positionals.push(value); continue; }
    const [rawName = "", inline] = value.slice(2).split("=", 2);
    if (rawName.length === 0) usage("bare -- is not supported");
    if (Object.hasOwn(options, rawName)) usage(`option --${rawName} may only be supplied once`);
    if (rawName === "shrink" || rawName === "no-shrink" || rawName === "stop-on-failure" || rawName === "allow-insecure-http") {
      if (inline !== undefined) usage(`--${rawName} does not take a value`);
      options[rawName] = true;
    }
    else {
      const next = inline ?? argv[index + 1];
      if (next === undefined || next.startsWith("--")) usage(`--${rawName} requires a value`);
      options[rawName] = next;
      if (inline === undefined) index += 1;
    }
  }
  if (!Object.hasOwn(OPTIONS, command)) usage(`unknown command: ${command || "(missing)"}`);
  const allowed = OPTIONS[command as keyof typeof OPTIONS];
  const unknown = Object.keys(options).filter((name) => !allowed.has(name));
  if (unknown.length > 0) usage(`unknown options for ${command}: ${unknown.map((name) => `--${name}`).join(", ")}`);
  if (options.shrink === true && options["no-shrink"] === true) usage("--shrink and --no-shrink are mutually exclusive");
  return { command, positionals, options };
}

function stringOption(options: ParsedArguments["options"], name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown, name: string, minimum: number, maximum: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) usage(`${name} must be an integer from ${minimum} to ${maximum}`);
  return parsed;
}

async function importModel(file: string): Promise<StateModel<JsonValue, JsonValue, CommandDefinitions<JsonValue, JsonValue>>> {
  typecheckModel(file);
  const module = await tsImport(pathToFileURL(resolve(file)).href, import.meta.url) as { readonly default?: unknown };
  const model = module.default;
  if (typeof model !== "object" || model === null || typeof (model as { name?: unknown }).name !== "string" || !Array.isArray((model as { commandNames?: unknown }).commandNames)) {
    usage(`${file} does not default-export a SequenceProof model`);
  }
  return model as StateModel<JsonValue, JsonValue, CommandDefinitions<JsonValue, JsonValue>>;
}

function typecheckModel(file: string): void {
  const absolute = resolve(file);
  const configFile = ts.findConfigFile(dirname(absolute), ts.sys.fileExists, "tsconfig.json");
  let options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
  };
  let files = [absolute];
  if (configFile !== undefined) {
    const loaded = ts.readConfigFile(configFile, ts.sys.readFile);
    if (loaded.error !== undefined) usage(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configFile), { noEmit: true }, configFile);
    options = parsed.options;
    files = parsed.fileNames.includes(absolute) ? parsed.fileNames : [...parsed.fileNames, absolute];
  }
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(files, options));
  if (diagnostics.length > 0) {
    const host: ts.FormatDiagnosticsHost = {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getNewLine: () => ts.sys.newLine,
    };
    usage(`model typecheck failed:\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, host)}`);
  }
}

interface Profile {
  readonly runs: number;
  readonly maxSteps: number;
  readonly size: number;
  readonly concurrency: number;
  readonly commandTimeoutMs?: number;
  readonly shrink: boolean;
  readonly maxShrinkAttempts: number;
  readonly maxShrinkTimeMs: number;
  readonly stopOnFailure: boolean;
}

async function readProfile(reference: string | undefined): Promise<Profile> {
  const defaults: Profile = {
    runs: 100, maxSteps: 100, size: 100, concurrency: 1, shrink: true,
    maxShrinkAttempts: 1_000, maxShrinkTimeMs: 60_000, stopOnFailure: true,
  };
  if (reference === undefined) return defaults;
  const split = reference.lastIndexOf(":");
  if (split < 1 || split === reference.length - 1) usage("--profile must be FILE:NAME");
  const file = reference.slice(0, split);
  const name = reference.slice(split + 1);
  const source = await readFile(file, "utf8");
  const document = YAML.parseDocument(source, { schema: "core", uniqueKeys: true, strict: true });
  if (document.errors.length > 0 || document.warnings.length > 0) usage("profile YAML contains aliases, custom tags, duplicate keys, or invalid syntax");
  let parsed: unknown;
  try { parsed = document.toJS({ maxAliasCount: 0 }); } catch { usage("profile YAML contains forbidden aliases or values"); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) usage("profile file must contain an object");
  const root = parsed as Record<string, unknown>;
  if (root.version !== 1 || typeof root.profiles !== "object" || root.profiles === null || Array.isArray(root.profiles)) usage("profile file must use version 1");
  const unknownRoot = Object.keys(root).filter((key) => !["version", "profiles"].includes(key));
  if (unknownRoot.length > 0) usage(`unknown profile document keys: ${unknownRoot.join(", ")}`);
  const rawProfiles = root.profiles as Record<string, unknown>;
  if (Object.keys(rawProfiles).length === 0) usage("profile file must contain at least one profile");
  const profiles = new Map<string, Profile>();
  for (const [profileName, raw] of Object.entries(rawProfiles)) {
    if (!/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(profileName)) usage(`invalid profile name ${profileName}`);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) usage(`profile ${profileName} must be an object`);
    const values = raw as Record<string, unknown>;
    const unknown = Object.keys(values).filter((key) => !PROFILE_KEYS.has(key));
    if (unknown.length > 0) usage(`unknown keys in profile ${profileName}: ${unknown.join(", ")}`);
    const missing = REQUIRED_PROFILE_KEYS.filter((key) => !Object.hasOwn(values, key));
    if (missing.length > 0) usage(`missing keys in profile ${profileName}: ${missing.join(", ")}`);
    const booleanValue = (key: string, fallback: boolean): boolean => {
      const value = values[key] ?? fallback;
      if (typeof value !== "boolean") usage(`${profileName}.${key} must be boolean`);
      return value;
    };
    const timeout = values.command_timeout_ms;
    profiles.set(profileName, {
      runs: numberValue(values.runs, `${profileName}.runs`, 1, 100_000),
      maxSteps: numberValue(values.max_steps, `${profileName}.max_steps`, 0, 100_000),
      size: numberValue(values.size, `${profileName}.size`, 0, 100_000),
      concurrency: numberValue(values.concurrency, `${profileName}.concurrency`, 1, 64),
      ...(timeout === undefined ? {} : { commandTimeoutMs: numberValue(timeout, `${profileName}.command_timeout_ms`, 1, 600_000) }),
      shrink: booleanValue("shrink", true),
      maxShrinkAttempts: numberValue(values.max_shrink_attempts, `${profileName}.max_shrink_attempts`, 0, 1_000_000),
      maxShrinkTimeMs: numberValue(values.max_shrink_time_ms, `${profileName}.max_shrink_time_ms`, 0, 3_600_000),
      stopOnFailure: booleanValue("stop_on_failure", true),
    });
  }
  return profiles.get(name) ?? usage(`unknown profile ${name}`);
}

function overrideProfile(profile: Profile, options: ParsedArguments["options"]): Profile {
  const numberOverride = (name: string, current: number, min: number, max: number): number => {
    const value = stringOption(options, name);
    return value === undefined ? current : numberValue(value, `--${name}`, min, max);
  };
  return {
    runs: numberOverride("runs", profile.runs, 1, 100_000),
    maxSteps: numberOverride("max-steps", profile.maxSteps, 0, 100_000),
    size: numberOverride("size", profile.size, 0, 100_000),
    concurrency: numberOverride("concurrency", profile.concurrency, 1, 64),
    commandTimeoutMs: numberOverride("command-timeout-ms", profile.commandTimeoutMs ?? 10_000, 1, 600_000),
    shrink: options["no-shrink"] === true ? false : options.shrink === true ? true : profile.shrink,
    maxShrinkAttempts: numberOverride("max-shrink-attempts", profile.maxShrinkAttempts, 0, 1_000_000),
    maxShrinkTimeMs: numberOverride("max-shrink-time-ms", profile.maxShrinkTimeMs, 0, 3_600_000),
    stopOnFailure: options["stop-on-failure"] === true || profile.stopOnFailure,
  };
}

async function exclusiveJson(file: string, value: JsonValue): Promise<void> {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
  finally { await handle.close(); }
}

function redactToken(value: JsonValue, token: string): JsonValue {
  if (typeof value === "string") return value.includes(token) ? value.replaceAll(token, "[REDACTED]") : value;
  if (Array.isArray(value)) {
    const values = value as readonly JsonValue[];
    return values.map((item) => redactToken(item, token));
  }
  if (typeof value === "object" && value !== null) {
    const record = value as JsonObject;
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, redactToken(item, token)]));
  }
  return value;
}

async function fileDigest(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function xml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"); }

async function checkCommand(parsed: ParsedArguments): Promise<number> {
  if (parsed.positionals.length === 0) usage("check requires at least one model file");
  const endpoint = stringOption(parsed.options, "endpoint") ?? process.env.SEQUENCEPROOF_ENDPOINT;
  const adapter = stringOption(parsed.options, "adapter");
  const token = process.env[stringOption(parsed.options, "token-env") ?? "SEQUENCEPROOF_TOKEN"];
  if (endpoint === undefined || adapter === undefined || token === undefined) usage("check requires endpoint, adapter, and a token environment variable");
  const profile = overrideProfile(await readProfile(stringOption(parsed.options, "profile")), parsed.options);
  const seed = stringOption(parsed.options, "seed") ?? process.env.SEQUENCEPROOF_SEED;
  const outputRoot = resolve(stringOption(parsed.options, "output") ?? "sequenceproof/traces");
  let exitCode = 0;
  for (const modelFile of parsed.positionals) {
    const model = await importModel(modelFile);
    const effectiveSeed = seed ?? globalThis.crypto.randomUUID();
    process.stdout.write(`SequenceProof seed: ${effectiveSeed}\n`);
    let originalSteps: readonly TraceStepV1[] | undefined;
    let originalFailure: TraceV1["failure"] | undefined;
    let totalSteps = 0;
    type ManifestDriver = ReturnType<typeof createProtocolDriver> & { readonly manifest?: AdapterManifestV1 };
    const drivers: ManifestDriver[] = [];
    const capture: Reporter = {
      onShrinkStart(event) {
        const candidate = event.data.original_trace_steps;
        if (Array.isArray(candidate)) originalSteps = candidate;
        const failure = event.data.original_failure;
        if (typeof failure === "object" && failure !== null && !Array.isArray(failure)) {
          originalFailure = failure as unknown as TraceV1["failure"];
        }
      },
      onRunComplete(event) {
        const steps = event.data.steps;
        if (typeof steps === "number") totalSteps += steps;
      },
    };
    const result = await check(model, {
      driver: () => {
        const driver = createProtocolDriver({
          baseUrl: endpoint,
          adapter,
          token,
          allowInsecureHttp: parsed.options["allow-insecure-http"] === true,
          redact: (value) => redactToken(value, token),
        }) as ManifestDriver;
        drivers.push(driver);
        return driver;
      },
      seed: effectiveSeed,
      ...profile,
      reporters: [consoleReporter(), capture],
    });
    if (result.status === "failed") exitCode = 2;
    else if (result.status !== "passed" && exitCode === 0) exitCode = 1;
    try {
    const campaign = `${Date.now()}-${globalThis.crypto.randomUUID()}-${effectiveSeed.replaceAll(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 48)}`;
    const directory = resolve(outputRoot, model.name, campaign);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const junit = `<testsuite name="sequenceproof.${xml(model.name)}" tests="${result.runs}" failures="${result.failed}"><testcase name="campaign">${result.failed === 0 ? "" : `<failure message="property failure">seed ${xml(effectiveSeed)}</failure>`}</testcase></testsuite>\n`;
    const junitPath = resolve(directory, "junit.xml");
    const junitFile = await open(junitPath, "wx", 0o600);
    try { await junitFile.writeFile(junit, "utf8"); } finally { await junitFile.close(); }
    const artifacts: Record<string, JsonValue> = { "junit.xml": await fileDigest(junitPath) };
    if (result.firstFailure !== undefined) {
      const minimal = redactToken(result.firstFailure as unknown as JsonValue, token) as unknown as TraceV1;
      const originalPath = resolve(directory, "original.trace.json");
      if (originalSteps !== undefined) {
        const { shrink: removedShrink, ...withoutShrink } = minimal;
        void removedShrink;
        const original = {
          ...withoutShrink,
          steps: redactToken(originalSteps as unknown as JsonValue, token),
          ...(originalFailure === undefined ? {} : { failure: redactToken(originalFailure as unknown as JsonValue, token) }),
        } as unknown as TraceV1;
        await writeTraceFile(originalPath, original);
      } else await writeTraceFile(originalPath, minimal);
      artifacts["original.trace.json"] = await fileDigest(originalPath);
      if (minimal.shrink !== undefined) {
        const minimalPath = resolve(directory, "minimal.trace.json");
        await writeTraceFile(minimalPath, minimal);
        artifacts["minimal.trace.json"] = await fileDigest(minimalPath);
      }
    }
    const manifest = drivers.find((driver) => driver.manifest !== undefined)?.manifest;
    const summary = redactToken({
      core_version: VERSION,
      sequenceproof_rails_version: manifest?.sequenceproof_rails_version ?? null,
      protocol_version: 1,
      model: { name: model.name, version: model.version },
      adapter: { name: adapter, version: manifest?.adapter.version ?? null },
      manifest_digest: manifest?.digest ?? null,
      profile: stringOption(parsed.options, "profile") ?? "defaults",
      profile_digest: await digest(profile as unknown as JsonObject),
      seed: effectiveSeed,
      options: profile as unknown as JsonObject,
      commit_sha: process.env.GITHUB_SHA ?? null,
      status: result.status,
      runs: result.runs,
      steps: totalSteps,
      passed: result.passed,
      failed: result.failed,
      artifacts,
    }, token);
    await exclusiveJson(resolve(directory, "summary.json"), summary);
    process.stdout.write(`SequenceProof artifacts: ${directory}\n`);
    } catch (error) {
      if (exitCode !== 2) throw error;
      const message = error instanceof Error ? error.message : "unknown artifact error";
      process.stderr.write(`sequenceproof: property failure retained; artifact writing also failed: ${message.replaceAll(token, "[REDACTED]")}\n`);
    }
  }
  return exitCode;
}

async function replayCommand(parsed: ParsedArguments): Promise<number> {
  const traceFile = parsed.positionals[0];
  const modelFile = stringOption(parsed.options, "model");
  const endpoint = stringOption(parsed.options, "endpoint") ?? process.env.SEQUENCEPROOF_ENDPOINT;
  const adapter = stringOption(parsed.options, "adapter");
  const token = process.env[stringOption(parsed.options, "token-env") ?? "SEQUENCEPROOF_TOKEN"];
  if (traceFile === undefined || modelFile === undefined || endpoint === undefined || adapter === undefined || token === undefined) usage("replay requires trace, model, endpoint, adapter, and token");
  const trace = await readTraceFile(traceFile);
  const model = await importModel(modelFile);
  const result = await replay(model, trace, {
    driver: createProtocolDriver({
      baseUrl: endpoint,
      adapter,
      token,
      allowInsecureHttp: parsed.options["allow-insecure-http"] === true,
    }),
    reporters: [consoleReporter()],
  });
  process.stdout.write(`${result.status}: matched ${result.matchedSteps}/${trace.steps.length} steps\n`);
  return result.status === "replay_diverged" ? 3 : 0;
}

async function validateCommand(parsed: ParsedArguments): Promise<number> {
  if (parsed.positionals.length === 0) usage("validate requires at least one path");
  for (const file of parsed.positionals) {
    if (file.endsWith(".json")) parseTrace(JSON.parse(await readFile(file, "utf8")) as unknown);
    else await importModel(file);
    process.stdout.write(`valid: ${file}\n`);
  }
  return 0;
}

async function inspectCommand(parsed: ParsedArguments): Promise<number> {
  const file = parsed.positionals[0];
  if (file === undefined) usage("inspect requires a trace");
  const trace = await readTraceFile(file);
  const format = stringOption(parsed.options, "format") ?? "text";
  if (!["text", "json"].includes(format)) usage("--format must be text or json");
  if (format === "json") process.stdout.write(serializeTrace(trace));
  else process.stdout.write(`${trace.model.name} ${trace.status}: ${trace.steps.length} steps, seed ${trace.run.seed}\n`);
  return 0;
}

async function main(): Promise<number> {
  if (process.argv.includes("--version")) { process.stdout.write(`${VERSION}\n`); return 0; }
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.command === "check") return checkCommand(parsed);
  if (parsed.command === "replay") return replayCommand(parsed);
  if (parsed.command === "validate") return validateCommand(parsed);
  if (parsed.command === "inspect") return inspectCommand(parsed);
  usage();
}

main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  process.stderr.write(`sequenceproof: ${error instanceof Error ? error.message : "unknown failure"}\n`);
  process.exitCode = 1;
});
