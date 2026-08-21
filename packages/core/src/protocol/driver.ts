import { cloneJson } from "../json.js";
import type {
  AdapterManifestV1,
  CommandCall,
  CommandOutcome,
  Driver,
  DriverAssertion,
  DriverObserveContext,
  DriverResetContext,
  DriverSetupContext,
  DriverStepContext,
  JsonObject,
  JsonValue,
  MaybePromise,
  SequenceProofProblem,
} from "../types.js";
import { digest } from "./canonical.js";
import { ManifestMismatchError, ProtocolError, RemoteProblemError } from "./errors.js";
import { validateManifest, validateProblem, validateProtocolResponse } from "./validate.js";

/** Authenticated HTTP protocol driver configuration. */
export interface ProtocolDriverOptions {
  readonly baseUrl: string | URL;
  readonly adapter: string;
  /** Static bearer token or asynchronous token provider. */
  readonly token: string | (() => MaybePromise<string>);
  /** Optional fetch-compatible transport, primarily for controlled tests. */
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly requestTimeoutMs?: number;
  readonly allowInsecureHttp?: boolean;
  /** Recursive redactor applied before values enter errors or traces. */
  readonly redact?: (value: JsonValue) => JsonValue;
}

interface RunResponse {
  readonly run_id: string;
  readonly observation: JsonValue;
  readonly assertions: readonly DriverAssertion[];
}
interface CommandResponse extends RunResponse { readonly outcome: CommandOutcome }

function parseRunResponse(value: JsonValue): RunResponse {
  const record = validateProtocolResponse(value);
  return {
    run_id: record.run_id as string,
    observation: record.observation!,
    assertions: record.assertions as unknown as readonly DriverAssertion[],
  };
}

function parseCommandResponse(value: JsonValue): CommandResponse {
  const record = validateProtocolResponse(value);
  const run = parseRunResponse(record);
  const outcome = record.outcome;
  return { ...run, outcome: outcome as CommandOutcome };
}

class HttpProtocolDriver<Observation extends JsonValue> implements Driver<Observation> {
  readonly name: string;
  manifest?: AdapterManifestV1;
  readonly #baseUrl: URL;
  readonly #token: ProtocolDriverOptions["token"];
  readonly #fetch: typeof globalThis.fetch;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #timeout: number;
  readonly #redact: (value: JsonValue) => JsonValue;
  #serverRunId: string | undefined;
  #observation?: Observation;
  #assertions: readonly DriverAssertion[] = [];

  constructor(options: ProtocolDriverOptions) {
    this.#baseUrl = new URL(options.baseUrl);
    if (this.#baseUrl.username !== "" || this.#baseUrl.password !== "") throw new ProtocolError("credentials_in_url", "credentials are forbidden in endpoint URLs");
    if (!["http:", "https:"].includes(this.#baseUrl.protocol)) throw new ProtocolError("invalid_endpoint", "endpoint URLs must use HTTP or HTTPS");
    if (this.#baseUrl.protocol === "http:" && !["127.0.0.1", "localhost", "::1"].includes(this.#baseUrl.hostname) && options.allowInsecureHttp !== true) {
      throw new ProtocolError("insecure_endpoint", "plain HTTP is allowed only for loopback endpoints");
    }
    if (this.#baseUrl.search !== "" || this.#baseUrl.hash !== "") throw new ProtocolError("invalid_endpoint", "endpoint URLs may not contain a query or fragment");
    if (!this.#baseUrl.pathname.endsWith("/")) this.#baseUrl.pathname += "/";
    this.name = options.adapter;
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#headers = options.headers ?? {};
    this.#timeout = options.requestTimeoutMs ?? 10_000;
    this.#redact = options.redact ?? ((value) => value);
  }

  async #request(method: string, path: string, body?: JsonObject): Promise<JsonValue> {
    const token = typeof this.#token === "function" ? await this.#token() : this.#token;
    if (token.length < 32) throw new ProtocolError("invalid_token", "protocol token must contain at least 32 characters");
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, this.#timeout);
    try {
      const response = await this.#fetch(new URL(path, this.#baseUrl), {
        method,
        headers: { ...this.#headers, Accept: "application/json", Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: "error",
      });
      const value = this.#redact(await response.json() as JsonValue);
      if (!response.ok) {
        let problem: SequenceProofProblem;
        try { problem = validateProblem(value); } catch { throw new RemoteProblemError("remote_error", `remote request failed with HTTP ${response.status}`); }
        throw new RemoteProblemError(problem.code, `${problem.title} (HTTP ${problem.status})`, { details: { request_id: problem.request_id } });
      }
      return value;
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new ProtocolError("request_timeout", `protocol request exceeded ${this.#timeout}ms`);
      throw new ProtocolError("request_failed", "protocol request failed", { cause: error });
    } finally { clearTimeout(timeout); }
  }

  async #loadManifest(): Promise<void> {
    if (this.manifest !== undefined) return;
    const manifest = validateManifest(await this.#request("GET", `v1/adapters/${encodeURIComponent(this.name)}/manifest`));
    const unsigned = cloneJson(manifest as unknown as JsonValue) as Record<string, JsonValue>;
    delete unsigned.request_id;
    delete unsigned.digest;
    const actual = await digest(unsigned);
    if (actual !== manifest.digest) throw new ManifestMismatchError("manifest_digest_mismatch", "adapter manifest digest is invalid");
    this.manifest = manifest;
  }

  async setup(context: DriverSetupContext): Promise<Observation> {
    await this.#loadManifest();
    const response = parseRunResponse(await this.#request("POST", `v1/adapters/${encodeURIComponent(this.name)}/runs`, { seed: context.seed, metadata: context.metadata }));
    this.#serverRunId = response.run_id;
    this.#observation = response.observation as Observation;
    this.#assertions = response.assertions;
    return this.#observation;
  }

  async execute<Input extends JsonValue>(call: CommandCall<Input>, context: DriverStepContext): Promise<CommandOutcome> {
    if (this.#serverRunId === undefined || this.manifest === undefined) throw new ProtocolError("run_not_started", "driver setup has not completed");
    const response = parseCommandResponse(await this.#request("POST", `v1/runs/${encodeURIComponent(this.#serverRunId)}/commands/${encodeURIComponent(call.id)}`, {
      actor: call.actor,
      input: call.input,
      step: context.step,
      manifest_digest: this.manifest.digest,
    }));
    this.#observation = response.observation as Observation;
    this.#assertions = response.assertions;
    return response.outcome;
  }

  async observe(context: DriverObserveContext): Promise<Observation> {
    if (this.#serverRunId === undefined) throw new ProtocolError("run_not_started", "driver setup has not completed");
    if (this.#observation !== undefined && context.reason === "after_command") return this.#observation;
    const response = parseRunResponse(await this.#request("GET", `v1/runs/${encodeURIComponent(this.#serverRunId)}/observation`));
    this.#observation = response.observation as Observation;
    this.#assertions = response.assertions;
    return this.#observation;
  }

  assertions(): Promise<readonly DriverAssertion[]> { return Promise.resolve(this.#assertions); }

  async reset(context: DriverResetContext): Promise<Observation> {
    if (this.#serverRunId === undefined) throw new ProtocolError("run_not_started", "driver setup has not completed");
    const response = parseRunResponse(await this.#request("POST", `v1/runs/${encodeURIComponent(this.#serverRunId)}/reset`, { attempt: context.attempt, reason: context.reason }));
    this.#observation = response.observation as Observation;
    this.#assertions = response.assertions;
    return this.#observation;
  }

  async dispose(): Promise<void> {
    if (this.#serverRunId === undefined) return;
    const runId = this.#serverRunId;
    this.#serverRunId = undefined;
    await this.#request("DELETE", `v1/runs/${encodeURIComponent(runId)}`);
  }

  redactTraceValue(value: JsonValue): JsonValue {
    return this.#redact(cloneJson(value));
  }
}

/** Creates a strict, manifest-verifying SequenceProof HTTP driver. */
export function createProtocolDriver<Observation extends JsonValue = JsonValue>(options: ProtocolDriverOptions): Driver<Observation> {
  return new HttpProtocolDriver(options);
}
