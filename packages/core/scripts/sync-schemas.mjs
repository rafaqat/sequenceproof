import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const names = ["manifest-v1", "problem-v1", "protocol-v1", "trace-v1"];
const entries = [];
for (const name of names) {
  const source = await readFile(resolve(repository, "schemas", `${name}.schema.json`), "utf8");
  entries.push(`  ${JSON.stringify(name)}: ${JSON.stringify(JSON.parse(source), null, 2).replaceAll("\n", "\n  ")}`);
}
const generated = [
  "// Generated from ../../../../schemas by scripts/sync-schemas.mjs. Do not edit.",
  "export const schemas = {",
  entries.join(",\n"),
  "} as const;",
  "",
].join("\n");
const output = resolve(here, "../src/protocol/schema-data.generated.ts");
if (process.argv.includes("--check")) {
  const current = await readFile(output, "utf8").catch(() => "");
  if (current !== generated) {
    process.stderr.write("generated protocol schemas are stale; run npm run schemas:sync --workspace @sequenceproof/core\n");
    process.exitCode = 1;
  }
} else {
  await writeFile(output, generated, "utf8");
}
