/**
 * Keeps the three artifacts in agreement and the examples honest:
 *   - the JSON Schema and the markdown field reference are what the generator
 *     produces from src/resolved-document.ts today (TS is the source);
 *   - every example validates against the JSON Schema and passes the
 *     invariants JSON Schema cannot express;
 *   - the committed example JSON is the serialization of the typed example.
 * TypeScript itself checks the examples against the types (npm run typecheck).
 */

import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { checkInvariants, type ResolvedDocument } from "@wmxdsl/resolved-document";
import { EXAMPLES, PATHS, buildSchema, examplePath, loadExample, renderReference, serialize, spliceReference } from "../scripts/generate.js";

const schema = buildSchema();
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

describe("resolved-document artifacts agree", () => {
  it("resolved-document.schema.json is generated from the types", () => {
    expect(readFileSync(PATHS.schema, "utf8")).toBe(serialize(schema));
  });

  it("the markdown field reference is generated from the types", () => {
    const md = readFileSync(PATHS.doc, "utf8");
    expect(md).toBe(spliceReference(md, renderReference(schema)));
  });
});

describe.each(EXAMPLES)("example %s", (name) => {
  it("validates against the JSON Schema", async () => {
    const doc = await loadExample(name);
    const ok = validate(doc);
    expect(ok ? [] : validate.errors).toEqual([]);
  });

  it("holds every invariant", async () => {
    expect(checkInvariants((await loadExample(name)) as ResolvedDocument)).toEqual([]);
  });

  it("committed JSON matches the typed example", async () => {
    expect(readFileSync(examplePath(name), "utf8")).toBe(serialize(await loadExample(name)));
  });
});

describe("the validator and invariants catch what they claim to", () => {
  // A JSON round trip, not structuredClone: the examples share objects between
  // variants, and structuredClone would keep them shared.
  const copy = (x: unknown): ResolvedDocument => JSON.parse(JSON.stringify(x)) as ResolvedDocument;
  const good = async (): Promise<ResolvedDocument> => copy(await loadExample("minimum"));

  it("rejects an omitted field (no optional fields)", async () => {
    const doc = (await good()) as unknown as { meta: Record<string, unknown> };
    delete doc.meta.description;
    expect(validate(doc)).toBe(false);
  });

  it("rejects an unknown unit", async () => {
    const doc = await good();
    (doc.variants.base.frames["frame-2"]!.inset as unknown) = { u: "rem", n: 1 };
    expect(validate(doc)).toBe(false);
  });

  it("flags a dangling style key and a broken thread", async () => {
    const doc = await good();
    const v = doc.variants.phone!;
    (v.stories["frame-2#text"]!.blocks[0] as { style: string }).style = "nope";
    v.threads["frame-2#text"] = [];
    const errs = checkInvariants(doc).join("\n");
    expect(errs).toContain('G4: frame-2#text[0]: style "nope" not in table');
    expect(errs).toContain("G7:");
  });

  it("flags a named story whose block list differs between variants", async () => {
    const doc = copy(await loadExample("stone-and-strategy"));
    doc.variants.phone!.stories.main!.blocks.pop();
    expect(checkInvariants(doc).join("\n")).toContain('G6: story "main"');
  });
});
