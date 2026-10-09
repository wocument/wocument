/**
 * Generates, from src/resolved-document.ts (the source of truth):
 *   - resolved-document.schema.json
 *   - the field reference in resolved-document.schema.md (between markers)
 *   - examples/*.resolved.json from examples/*.ts
 *
 * Run: npm run gen:resolved. The test suite calls the same functions and
 * fails if any output on disk is stale.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGenerator } from "ts-json-schema-generator";

const here = (p: string): string => fileURLToPath(new URL(`../${p}`, import.meta.url));

export const PATHS = {
  types: here("src/resolved-document.ts"),
  tsconfig: here("tsconfig.json"),
  schema: here("resolved-document.schema.json"),
  doc: here("resolved-document.schema.md"),
};

export const EXAMPLES = ["minimum", "stone-and-strategy"] as const;
export const examplePath = (name: string): string => here(`examples/${name}.resolved.json`);

type Schema = {
  $ref?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  anyOf?: Schema[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  description?: string;
  definitions?: Record<string, Schema>;
  [k: string]: unknown;
};

export function buildSchema(): Schema {
  const schema = createGenerator({
    path: PATHS.types,
    tsconfig: PATHS.tsconfig,
    type: "ResolvedDocument",
    expose: "export",
    topRef: true,
    jsDoc: "extended",
    skipTypeCheck: true,
  }).createSchema("ResolvedDocument") as Schema;
  schema.$id = "https://wmxdsl.dev/schema/resolved-document/1.json";
  schema.title = "WMXDSL Resolved Document, format version 1";
  return schema;
}

export const serialize = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;

// ---------------------------------------------------------------------------
// Markdown field reference
// ---------------------------------------------------------------------------

export const BEGIN = "<!-- BEGIN GENERATED FIELD REFERENCE: npm run gen:resolved -->";
export const END = "<!-- END GENERATED FIELD REFERENCE -->";

const refName = (ref: string): string => ref.replace("#/definitions/", "");
const anchor = (name: string): string => name.toLowerCase();

function typeOf(s: Schema): string {
  if (s.$ref) return `[\`${refName(s.$ref)}\`](#${anchor(refName(s.$ref))})`;
  if (s.const !== undefined) return `\`${JSON.stringify(s.const)}\``;
  if (s.enum) return s.enum.map((e) => `\`${JSON.stringify(e)}\``).join(" \\| ");
  if (s.anyOf) return s.anyOf.map(typeOf).join(" \\| ");
  if (s.type === "array") {
    if (Array.isArray(s.items)) return `[${(s.items as Schema[]).map(typeOf).join(", ")}][]`;
    return s.items ? `${typeOf(s.items)}[]` : "array";
  }
  if (s.type === "object" && s.additionalProperties && typeof s.additionalProperties === "object" && !s.properties)
    return `Record<string, ${typeOf(s.additionalProperties)}>`;
  if (Array.isArray(s.type)) return s.type.map((t) => `\`${t}\``).join(" \\| ");
  return s.type ? `\`${s.type}\`` : "any";
}

const oneLine = (t: string | undefined): string => (t ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");

/** Definitions in reading order: breadth-first from the root, following refs in property order. */
function readingOrder(schema: Schema): string[] {
  const defs = schema.definitions ?? {};
  const seen: string[] = [];
  const queue = [refName(schema.$ref!)];
  const visit = (s: Schema | undefined): void => {
    if (!s) return;
    if (s.$ref) queue.push(refName(s.$ref));
    s.anyOf?.forEach(visit);
    if (Array.isArray(s.items)) (s.items as Schema[]).forEach(visit);
    else visit(s.items);
    if (typeof s.additionalProperties === "object") visit(s.additionalProperties);
    Object.values(s.properties ?? {}).forEach(visit);
  };
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (seen.includes(n)) continue;
    seen.push(n);
    visit(defs[n]);
  }
  return seen;
}

export function renderReference(schema: Schema): string {
  const defs = schema.definitions ?? {};
  const out: string[] = [BEGIN, ""];
  for (const name of readingOrder(schema)) {
    const d = defs[name]!;
    out.push(`### ${name}`, "", oneLine(d.description), "");
    if (d.properties) {
      out.push("| Field | Type | Meaning |", "| :---- | :---- | :---- |");
      for (const [k, p] of Object.entries(d.properties)) out.push(`| \`${k}\` | ${typeOf(p)} | ${oneLine(p.description)} |`);
      if (typeof d.additionalProperties === "object")
        out.push(`| *any other key* | ${typeOf(d.additionalProperties)} | ${oneLine(d.additionalProperties.description)} |`);
    } else {
      out.push(`Type: ${typeOf({ ...d, description: undefined })}`);
    }
    out.push("");
  }
  out.push(END);
  return out.join("\n");
}

export function spliceReference(doc: string, reference: string): string {
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error("resolved-document.schema.md: generated-reference markers missing");
  return doc.slice(0, a) + reference + doc.slice(b + END.length);
}

export async function loadExample(name: string): Promise<unknown> {
  const mod = (await import(`../examples/${name}.ts`)) as { default: unknown };
  return mod.default;
}

async function main(): Promise<void> {
  const schema = buildSchema();
  writeFileSync(PATHS.schema, serialize(schema));
  writeFileSync(PATHS.doc, spliceReference(readFileSync(PATHS.doc, "utf8"), renderReference(schema)));
  for (const name of EXAMPLES) writeFileSync(examplePath(name), serialize(await loadExample(name)));
  console.log(`wrote ${PATHS.schema}, reference in ${PATHS.doc}, ${EXAMPLES.length} examples`);
}

// Imported by the test suite as a library; run as a script otherwise.
if (!process.env.VITEST) await main();
