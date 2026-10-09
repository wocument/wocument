/**
 * Phase A0: prepare -- grammar §02.
 *
 * Decode, strip a BOM, normalize newlines, split off frontmatter. Every
 * position produced anywhere in the parser refers to the normalized text this
 * phase returns.
 */

import { FRONTMATTER_BY_NAME, FRONTMATTER_FIELDS, type Frontmatter, type FrontmatterField } from "@wmxdsl/schema";
import { parseDocument, type Document as YamlDocument } from "yaml";
import type { Diagnostics } from "./diagnostics.js";
import { PositionIndex } from "./positions.js";

export type SourceKind = "document" | "theme";

export type PrepareResult = {
  /** Normalized text: no BOM, `\n` newlines only. */
  text: string;
  index: PositionIndex;
  /** Offset in `text` where the content begins (past the frontmatter). */
  contentStart: number;
  frontmatter: Frontmatter | null;
  /** True when the failure is bad enough that phase A should not run. */
  fatal: boolean;
};

/** Decodes bytes as UTF-8, or reports L001. Strings pass through unchanged. */
export function decode(
  input: string | Uint8Array,
  diags: Diagnostics,
): string | null {
  if (typeof input === "string") return input;
  try {
    // ignoreBOM keeps U+FEFF so we can strip exactly one, as the grammar says.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    diags.add("L001", { line: 1, column: 1, length: 0 });
    return null;
  }
}

/** Grammar §02 steps 2 and 3. */
export function normalize(raw: string): string {
  const noBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return noBom.indexOf("\r") === -1 ? noBom : noBom.replace(/\r\n?/g, "\n");
}

export function prepare(
  input: string | Uint8Array,
  kind: SourceKind,
  diags: Diagnostics,
): PrepareResult {
  const decoded = decode(input, diags);
  if (decoded === null) {
    const text = "";
    return { text, index: new PositionIndex(text), contentStart: 0, frontmatter: null, fatal: true };
  }

  const text = normalize(decoded);
  const index = new PositionIndex(text);

  if (kind === "theme") {
    // Grammar §02 step 5: a leading fence in a theme file is P045.
    const fence = matchFence(text, 0);
    if (fence !== null) {
      diags.add("P045", index.span(0, fence), { what: "frontmatter" });
    }
    return { text, index, contentStart: 0, frontmatter: null, fatal: false };
  }

  const open = matchFence(text, 0);
  if (open === null) {
    diags.add("P001", index.span(0, Math.min(3, text.length)), { detail: "" }, "A document must begin with a `---` fence.");
    return { text, index, contentStart: 0, frontmatter: null, fatal: true };
  }

  // Find the closing fence, scanning line by line.
  let lineStart = open;
  let close = -1;
  let closeEnd = -1;
  while (lineStart < text.length) {
    const f = matchFence(text, lineStart);
    if (f !== null) {
      close = lineStart;
      closeEnd = f;
      break;
    }
    const nl = text.indexOf("\n", lineStart);
    if (nl === -1) break;
    lineStart = nl + 1;
  }

  if (close === -1) {
    diags.add("L005", index.span(0, Math.min(3, text.length)));
    return { text, index, contentStart: text.length, frontmatter: null, fatal: true };
  }

  const yamlStart = open;
  const yamlText = text.slice(yamlStart, close);
  const frontmatter = parseFrontmatter(yamlText, yamlStart, index, diags);
  return { text, index, contentStart: closeEnd, frontmatter, fatal: false };
}

/**
 * `fence ::= "---" hspace* NL`. Returns the offset just past the newline, or
 * null. A fence on the final line without a trailing newline still counts.
 */
function matchFence(text: string, at: number): number | null {
  if (text.startsWith("---", at) === false) return null;
  let i = at + 3;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  if (i >= text.length) return i;
  if (text[i] === "\n") return i + 1;
  return null;
}

function parseFrontmatter(
  yamlText: string,
  base: number,
  index: PositionIndex,
  diags: Diagnostics,
): Frontmatter | null {
  let doc: YamlDocument.Parsed;
  try {
    doc = parseDocument(yamlText, { version: "1.2" });
  } catch (err) {
    diags.add("P001", index.span(base, base + 1), { detail: String(err) });
    return null;
  }

  for (const e of doc.errors) {
    const [s, en] = e.pos;
    diags.add("P001", index.span(base + s, base + (en ?? s + 1)), { detail: e.message });
  }
  if (doc.errors.length > 0) return null;

  const value: unknown = doc.toJS({ mapAsMap: false });
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    diags.add("P001", index.span(base, base + Math.max(1, yamlText.length)), {
      detail: "frontmatter must be a mapping of fields",
    });
    return null;
  }
  const map = value as Record<string, unknown>;

  const keyPos = collectKeyPositions(doc, base);
  const posFor = (field: string): { start: number; end: number } =>
    keyPos.get(field) ?? { start: base, end: base + 1 };

  for (const field of Object.keys(map)) {
    if (FRONTMATTER_BY_NAME.has(field)) continue;
    const p = posFor(field);
    diags.add("P002", index.span(p.start, p.end), { field });
  }

  for (const field of FRONTMATTER_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(map, field.name);
    if (!present) {
      if (field.required) {
        diags.add("P003", index.span(base, base + 1), { field: field.name, reason: "missing" });
      }
      continue;
    }
    const v = map[field.name];
    if (!matchesType(v, field)) {
      const p = posFor(field.name);
      diags.add("P003", index.span(p.start, p.end), {
        field: field.name,
        reason: "type",
        expected: describeType(field.type),
      });
    }
  }

  return map as unknown as Frontmatter;
}

function collectKeyPositions(doc: YamlDocument.Parsed, base: number): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>();
  const contents = doc.contents as unknown;
  if (contents === null || typeof contents !== "object") return out;
  const items = (contents as { items?: unknown }).items;
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const key = (item as { key?: unknown }).key;
    if (key === null || typeof key !== "object") continue;
    const k = key as { value?: unknown; range?: [number, number, number] };
    if (typeof k.value !== "string" || k.range === undefined) continue;
    out.set(k.value, { start: base + k.range[0], end: base + k.range[1] });
  }
  return out;
}

function matchesType(v: unknown, field: FrontmatterField): boolean {
  switch (field.type) {
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "string":
    case "path":
      return typeof v === "string";
    case "string-or-list":
      return typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"));
    case "date":
      // YAML 1.2 core has no timestamp tag, so an ISO date arrives as a string.
      return typeof v === "string" || v instanceof Date;
  }
}

function describeType(t: FrontmatterField["type"]): string {
  switch (t) {
    case "integer":
      return "an integer";
    case "string":
      return "a string";
    case "path":
      return "a path";
    case "string-or-list":
      return "a string or a list of strings";
    case "date":
      return "an ISO date";
  }
}
