import { open, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseTrace, serializeTrace } from "../trace.js";
import type { TraceV1 } from "../types.js";

function pathOf(file: string | URL): string { return file instanceof URL ? fileURLToPath(file) : file; }

/** Reads and strictly validates a UTF-8 trace file. */
export async function readTraceFile(file: string | URL): Promise<TraceV1> {
  return parseTrace(JSON.parse(await readFile(pathOf(file), "utf8")) as unknown);
}

/** Exclusively writes a canonical trace with mode `0600` by default. */
export async function writeTraceFile(
  file: string | URL,
  trace: TraceV1,
  options: { readonly overwrite?: boolean; readonly mode?: number } = {},
): Promise<void> {
  const handle = await open(pathOf(file), options.overwrite === true ? "w" : "wx", options.mode ?? 0o600);
  try { await handle.writeFile(serializeTrace(trace), "utf8"); }
  finally { await handle.close(); }
}
