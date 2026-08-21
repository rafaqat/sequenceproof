import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("the root package entrypoint", () => {
  it("bundles for a browser without Node built-ins", async () => {
    const result = await build({
      entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      write: false,
      logLevel: "silent",
    });

    expect(result.outputFiles).toHaveLength(1);
    expect(result.outputFiles[0]!.text).not.toContain("node:");
  });
});
