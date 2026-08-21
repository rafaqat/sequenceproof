import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/protocol/index.js";
import type { JsonValue } from "../src/index.js";

const root = new URL("../../../", import.meta.url);

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, root), "utf8")) as unknown;
}

describe("shared SequenceProof wire contracts", () => {
  it("matches every fixture using the checked-in Draft 2020-12 schemas", async () => {
    const corpus = await readJson("test-vectors/protocol-fixtures.json") as {
      readonly fixtures: readonly {
        readonly name: string;
        readonly schema: string;
        readonly valid: boolean;
        readonly value: unknown;
      }[];
    };
    const schemas = new Map<string, object>();
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const results: Record<string, boolean> = {};
    for (const fixture of corpus.fixtures) {
      let schema = schemas.get(fixture.schema);
      if (schema === undefined) {
        schema = await readJson(`schemas/${fixture.schema}`) as object;
        schemas.set(fixture.schema, schema);
      }
      results[fixture.name] = ajv.validate(schema, fixture.value);
    }

    expect(results).toEqual(Object.fromEntries(corpus.fixtures.map((fixture) => [fixture.name, fixture.valid])));
  });

  it("uses the same RFC 8785 canonical JSON vectors as Ruby", async () => {
    const corpus = await readJson("test-vectors/canonical-json-vectors.json") as {
      readonly vectors: readonly { readonly value: JsonValue; readonly canonical: string }[];
    };

    expect(corpus.vectors.map(({ value }) => canonicalize(value)))
      .toEqual(corpus.vectors.map(({ canonical }) => canonical));
  });
});
