import { describe, expect, it } from "vitest";
import { createProtocolDriver, digest, ProtocolError, ProtocolVersionError, validateManifest } from "../src/protocol/index.js";
import type { AdapterManifestV1, JsonObject, JsonValue } from "../src/types.js";

async function manifest(): Promise<AdapterManifestV1> {
  const unsigned: Omit<AdapterManifestV1, "digest"> = {
    protocol: "sequenceproof.protocol",
    protocol_version: 1,
    request_id: "request-1",
    sequenceproof_rails_version: "0.1.0",
    supported_protocol_versions: [1],
    adapter: { name: "shopping_cart", version: 1 },
    commands: [{ id: "add_item", actors: ["customer"], input_schema: {}, output_schema: {}, metadata: {} }],
    observation_schema: {},
    server_invariants: [],
    isolation: { mode: "callback", resettable: true },
  };
  const digestInput = { ...unsigned } as unknown as Record<string, JsonValue>;
  delete digestInput.request_id;
  return { ...unsigned, digest: await digest(digestInput) };
}

function jsonResponse(value: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("protocol", () => {
  it("normalizes a mount URL and prevents custom headers from replacing the bearer token", async () => {
    const adapterManifest = await manifest();
    const requests: Array<{ readonly url: string; readonly authorization: string | null }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
      if (requests.length === 1) return jsonResponse(adapterManifest as unknown as JsonObject);
      return jsonResponse({
        protocol: "sequenceproof.protocol", protocol_version: 1, request_id: "request-2",
        run_id: "run-1", observation: {}, assertions: [],
      });
    };
    const token = "correct-token-".padEnd(40, "x");
    const driver = createProtocolDriver({
      baseUrl: "http://127.0.0.1:3210/__sequenceproof",
      adapter: "shopping_cart",
      token,
      headers: { Authorization: "Bearer attacker" },
      fetch: fakeFetch,
    });

    await driver.setup({ runId: "run-local", seed: "seed", metadata: {}, signal: new AbortController().signal });

    expect(requests.map(({ url }) => url)).toEqual([
      "http://127.0.0.1:3210/__sequenceproof/v1/adapters/shopping_cart/manifest",
      "http://127.0.0.1:3210/__sequenceproof/v1/adapters/shopping_cart/runs",
    ]);
    expect(requests.every(({ authorization }) => authorization === `Bearer ${token}`)).toBe(true);
  });

  it("rejects unknown response members through the canonical schema", async () => {
    const adapterManifest = await manifest();
    let request = 0;
    const driver = createProtocolDriver({
      baseUrl: "http://127.0.0.1:3210/__sequenceproof/",
      adapter: "shopping_cart",
      token: "token".padEnd(40, "x"),
      fetch: async () => {
        request += 1;
        if (request === 1) return jsonResponse(adapterManifest as unknown as JsonObject);
        return jsonResponse({
          protocol: "sequenceproof.protocol", protocol_version: 1, request_id: "request-2",
          run_id: "run-1", observation: {}, assertions: [], leaked: "canary",
        });
      },
    });

    await expect(driver.setup({ runId: "run-local", seed: "seed", metadata: {}, signal: new AbortController().signal }))
      .rejects.toBeInstanceOf(ProtocolError);
  });

  it("distinguishes an unsupported protocol version from a malformed manifest", () => {
    expect(() => validateManifest({ protocol_version: 2 }))
      .toThrow(ProtocolVersionError);
  });

  it("requires an explicit opt-in for non-loopback plain HTTP", () => {
    const options = { baseUrl: "http://example.test/sequenceproof", adapter: "example", token: "x".repeat(40) };

    expect(() => createProtocolDriver(options)).toThrow(/plain HTTP/);
    expect(() => createProtocolDriver({ ...options, allowInsecureHttp: true })).not.toThrow();
    expect(() => createProtocolDriver({ ...options, baseUrl: "file:///tmp/sequenceproof" })).toThrow(/HTTP or HTTPS/);
  });
});
