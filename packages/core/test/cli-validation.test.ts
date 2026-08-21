import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const cli = new URL("../src/node/cli.ts", import.meta.url).pathname;
const tsx = new URL("../../../node_modules/.bin/tsx", import.meta.url).pathname;
const temporaryDirectories: string[] = [];

function invoke(arguments_: readonly string[]) {
  return spawnSync(tsx, [cli, ...arguments_], {
    encoding: "utf8",
    env: { ...process.env, SEQUENCEPROOF_TOKEN: "token".padEnd(40, "x") },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("CLI validation", () => {
  it("rejects repeated and conflicting boolean flags", () => {
    const repeated = invoke(["check", "model.ts", "--runs", "1", "--runs", "2"]);
    const conflicting = invoke(["check", "model.ts", "--shrink", "--no-shrink"]);

    expect(repeated.status).toBe(1);
    expect(repeated.stderr).toContain("--runs may only be supplied once");
    expect(conflicting.status).toBe(1);
    expect(conflicting.stderr).toContain("mutually exclusive");
  });

  it("validates every profile, including profiles not selected for the run", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequenceproof-profile-"));
    temporaryDirectories.push(directory);
    const profile = join(directory, "profiles.yml");
    writeFileSync(profile, [
      "version: 1",
      "profiles:",
      "  good:",
      "    runs: 1",
      "    max_steps: 1",
      "    size: 1",
      "    concurrency: 1",
      "    shrink: true",
      "    max_shrink_attempts: 1",
      "    max_shrink_time_ms: 1",
      "    stop_on_failure: true",
      "  broken:",
      "    runs: nope",
      "    max_steps: 1",
      "    size: 1",
      "    concurrency: 1",
      "    shrink: true",
      "    max_shrink_attempts: 1",
      "    max_shrink_time_ms: 1",
      "    stop_on_failure: true",
      "",
    ].join("\n"), { mode: 0o600 });

    const result = invoke([
      "check", "model.ts", "--endpoint", "http://127.0.0.1:3210", "--adapter", "example",
      "--profile", `${profile}:good`,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("broken.runs must be an integer");
  });

  it("requires the same complete profile shape as the Rails task", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequenceproof-profile-"));
    temporaryDirectories.push(directory);
    const profile = join(directory, "profiles.yml");
    writeFileSync(profile, [
      "version: 1",
      "profiles:",
      "  incomplete:",
      "    runs: 1",
      "    max_steps: 1",
      "    size: 1",
      "    concurrency: 1",
      "    max_shrink_attempts: 1",
      "    max_shrink_time_ms: 1",
      "    stop_on_failure: true",
      "",
    ].join("\n"), { mode: 0o600 });

    const result = invoke([
      "check", "model.ts", "--endpoint", "http://127.0.0.1:3210", "--adapter", "example",
      "--profile", `${profile}:incomplete`,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing keys in profile incomplete: shrink");
  });
});
