import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageDirectory = join(root, "packages/core");
const temporary = await mkdtemp(join(tmpdir(), "sequenceproof-npm-smoke-"));

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  run("npm", ["run", "build", "--workspace", "@sequenceproof/core"], { cwd: root });
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", temporary], { cwd: packageDirectory }));
  const detail = packed[0];
  if (detail === undefined) throw new Error("npm pack returned no package");
  const names = detail.files.map(({ path }) => path);
  for (const required of ["package.json", "README.md", "LICENSE.txt", "dist/index.js", "dist/protocol/index.js", "dist/node/index.js", "dist/cli.js"]) {
    if (!names.includes(required)) throw new Error(`packed package is missing ${required}`);
  }
  const forbidden = names.filter((name) => name.startsWith("src/") || name.startsWith("test/") || name.includes(".tsbuildinfo"));
  if (forbidden.length > 0) throw new Error(`packed package contains private build inputs: ${forbidden.join(", ")}`);

  const fixture = join(temporary, "fixture");
  await mkdir(fixture);
  await writeFile(join(fixture, "package.json"), JSON.stringify({ private: true, type: "module" }), { mode: 0o600 });
  const tarball = join(temporary, detail.filename);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: fixture });
  const verification = `
    import { defineModel, gen, run } from "@sequenceproof/core";
    import { canonicalize, createProtocolDriver } from "@sequenceproof/core/protocol";
    import { readTraceFile } from "@sequenceproof/core/node";
    if (![defineModel, gen, run, canonicalize, createProtocolDriver, readTraceFile].every(Boolean)) process.exit(2);
    try {
      await import("@sequenceproof/core/dist/runner.js");
      process.exit(3);
    } catch (error) {
      if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    }
  `;
  await writeFile(join(fixture, "verify.mjs"), verification, { mode: 0o600 });
  run(process.execPath, ["verify.mjs"], { cwd: fixture });
  const executable = join(fixture, "node_modules/.bin/sequenceproof");
  if (process.platform !== "win32") {
    const mode = (await stat(executable)).mode & 0o111;
    if (mode === 0) throw new Error("packed CLI is not executable");
  }
  const version = run(executable, ["--version"], { cwd: fixture }).trim();
  const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  if (version !== manifest.version) throw new Error(`CLI version ${version} differs from package ${manifest.version}`);
  process.stdout.write(`npm package smoke passed for ${detail.filename}\n`);
} finally {
  await chmod(temporary, 0o700).catch(() => undefined);
  await rm(temporary, { recursive: true, force: true });
}
