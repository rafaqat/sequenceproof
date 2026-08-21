import { readFile } from "node:fs/promises";

const packageManifest = JSON.parse(await readFile(new URL("../packages/core/package.json", import.meta.url), "utf8"));
const rubyVersion = await readFile(new URL("../lib/sequenceproof/rails/version.rb", import.meta.url), "utf8");
const coreVersion = await readFile(new URL("../packages/core/src/version.ts", import.meta.url), "utf8");

const rubyMatch = rubyVersion.match(/VERSION = "([^"]+)"/);
const coreMatch = coreVersion.match(/VERSION = "([^"]+)"/);
if (rubyMatch === null || coreMatch === null) throw new Error("could not read SequenceProof version declarations");

const versions = new Set([packageManifest.version, rubyMatch[1], coreMatch[1]]);
if (versions.size !== 1) {
  throw new Error(`SequenceProof versions differ: npm=${packageManifest.version}, gem=${rubyMatch[1]}, core=${coreMatch[1]}`);
}

process.stdout.write(`SequenceProof version ${packageManifest.version} is coordinated\n`);
