/**
 * Typed attribute values -- grammar §04.1.
 *
 * Phase A keeps every value raw. This module turns a raw value into a typed
 * `Value` using the attribute's declared types, in the union order the grammar
 * fixes: tokenref, enum keywords, role, function types, then the remaining
 * scalar types in schema order.
 *
 * Pure: no diagnostics are emitted here. The caller turns a failure into P015.
 */

import { ROLES, TOKENREF_OK, UNITS, type AttrSchema, type TypeName, type Unit, type Value } from "@wmxdsl/schema";
import type { RawArg, RawValue } from "./attrs.js";

export type TypeResult = { ok: true; value: Value } | { ok: false; expected: string };

const IDENT_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const INTEGER_RE = /^-?[0-9]+$/;
const NUMBER_RE = /^-?[0-9]+(?:\.[0-9]+)?$/;
const TIME_RE = /^([0-9]+(?:\.[0-9]+)?)(ms|s)$/;
const RANGE_RE = /^([1-9][0-9]*)(?:-([1-9][0-9]*|end))?$/;
const RATIO_RE = /^([1-9][0-9]*):([1-9][0-9]*)$/;
const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const LENGTH_RE = new RegExp(`^(-?[0-9]+(?:\\.[0-9]+)?)(${UNITS.map(escapeUnit).join("|")})$`);

function escapeUnit(u: string): string {
  return u === "%" ? "%" : u;
}

/** Units that a `fluid()` argument may not use (grammar §04.1). */
const FLUID_FORBIDDEN: ReadonlySet<Unit> = new Set<Unit>(["%", "col", "bl"]);

export function typeValue(raw: RawValue, decl: AttrSchema): TypeResult {
  const types = decl.types;
  const expected = describeTypes(decl);

  // `any` short-circuits everything: \token stores its value untyped.
  if (types.includes("any")) {
    return { ok: true, value: { t: "any", raw: rawText(raw) } };
  }

  // A bare key is boolean true (grammar §04 rule 2).
  if (raw.kind === "absent") {
    return types.includes("boolean")
      ? { ok: true, value: { t: "boolean", b: true, raw: "" } }
      : { ok: false, expected };
  }

  // 1. Token references.
  if (raw.kind === "bare" && raw.text.startsWith("$")) {
    const name = raw.text.slice(1);
    if (!IDENT_RE.test(name)) return { ok: false, expected };
    const usable = types.some((t) => TOKENREF_OK.has(t));
    return usable
      ? { ok: true, value: { t: "tokenref", name, raw: raw.text } }
      : { ok: false, expected };
  }

  // 2. Enum keywords.
  if (types.includes("enum") && raw.kind === "bare" && (decl.enum ?? []).includes(raw.text)) {
    return { ok: true, value: { t: "enum", id: raw.text, raw: raw.text } };
  }

  // 3. Palette roles.
  if (types.includes("role") && raw.kind === "bare" && (ROLES as readonly string[]).includes(raw.text)) {
    return { ok: true, value: { t: "role", id: raw.text, raw: raw.text } };
  }

  // 4. Function types.
  if (raw.kind === "func") {
    if (types.includes("fluid") && raw.name === "fluid") {
      const v = parseFluid(raw.args, raw.raw);
      if (v !== null) return { ok: true, value: v };
    }
    if (types.includes("poly") && raw.name === "poly") {
      const v = parsePoly(raw.args, raw.raw);
      if (v !== null) return { ok: true, value: v };
    }
    return { ok: false, expected };
  }

  // 5. Remaining scalar types, in schema order.
  for (const t of types) {
    const v = parseScalar(t, raw, decl);
    if (v !== null) return { ok: true, value: v };
  }
  return { ok: false, expected };
}

function parseScalar(t: TypeName, raw: RawValue, decl: AttrSchema): Value | null {
  if (t === "pair") {
    if (raw.kind !== "string") return null;
    return parsePair(raw.text, decl.pairOf ?? "length");
  }
  if (t === "string") {
    const s = raw.kind === "string" ? raw.text : raw.kind === "bare" ? raw.text : null;
    return s === null ? null : { t: "string", s, raw: rawText(raw) };
  }
  if (t === "path") {
    const s = raw.kind === "string" ? raw.text : raw.kind === "bare" ? raw.text : null;
    return s === null || s.length === 0 ? null : { t: "path", s, raw: rawText(raw) };
  }

  // Everything below is bare-only.
  if (raw.kind !== "bare") return null;
  const s = raw.text;

  switch (t) {
    case "integer":
      return INTEGER_RE.test(s) ? { t: "integer", n: Number(s), raw: s } : null;
    case "number":
      return NUMBER_RE.test(s) ? { t: "number", n: Number(s), raw: s } : null;
    case "length":
      return parseLength(s);
    case "percentage": {
      if (!s.endsWith("%")) return null;
      const head = s.slice(0, -1);
      return NUMBER_RE.test(head) ? { t: "percentage", n: Number(head), raw: s } : null;
    }
    case "time": {
      const m = TIME_RE.exec(s);
      if (m === null) return null;
      const n = Number(m[1]);
      return { t: "time", ms: m[2] === "s" ? n * 1000 : n, raw: s };
    }
    case "range":
      return parseRange(s);
    case "ratio": {
      if (s === "auto") return { t: "ratio", auto: true, raw: s };
      const m = RATIO_RE.exec(s);
      return m === null ? null : { t: "ratio", w: Number(m[1]), h: Number(m[2]), raw: s };
    }
    case "color": {
      const m = COLOR_RE.exec(s);
      return m === null ? null : { t: "color", hex: normalizeHex(m[1] as string), raw: s };
    }
    case "boolean":
      return s === "true" || s === "false" ? { t: "boolean", b: s === "true", raw: s } : null;
    case "ident":
      return IDENT_RE.test(s) ? { t: "ident", id: s, raw: s } : null;
    // Handled before this switch, or not reachable for a bare value.
    case "role":
    case "enum":
    case "fluid":
    case "poly":
    case "any":
      return null;
  }
}

export function parseLength(s: string): Value | null {
  if (s === "0") {
    // A bare zero is unitless; every unit agrees at zero. `raw` keeps "0" so
    // the formatter writes it back unchanged.
    return { t: "length", n: 0, unit: "px", raw: s };
  }
  const m = LENGTH_RE.exec(s);
  if (m === null) return null;
  return { t: "length", n: Number(m[1]), unit: m[2] as Unit, raw: s };
}

function parseRange(s: string): Value | null {
  if (s === "all") return { t: "range", from: 1, to: "end", raw: s };
  const m = RANGE_RE.exec(s);
  if (m === null) return null;
  const from = Number(m[1]);
  if (m[2] === undefined) return { t: "range", from, to: from, raw: s };
  if (m[2] === "end") return { t: "range", from, to: "end", raw: s };
  const to = Number(m[2]);
  if (to < from) return null; // N <= M
  return { t: "range", from, to, raw: s };
}

function parsePair(text: string, of: TypeName): Value | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const decl: AttrSchema = { types: [of] };
  const a = typeValue({ kind: "bare", text: parts[0] as string, start: 0, end: 0 }, decl);
  const b = typeValue({ kind: "bare", text: parts[1] as string, start: 0, end: 0 }, decl);
  if (!a.ok || !b.ok) return null;
  return { t: "pair", a: a.value, b: b.value, raw: text };
}

function parseFluid(args: readonly RawArg[], raw: string): Value | null {
  if (args.length !== 2 && args.length !== 4) return null;
  const parsed: Value[] = [];
  for (const arg of args) {
    if (arg.atoms.length !== 1) return null;
    const atom = arg.atoms[0] as string;
    if (atom.startsWith("$")) {
      const name = atom.slice(1);
      if (!IDENT_RE.test(name)) return null;
      parsed.push({ t: "tokenref", name, raw: atom });
      continue;
    }
    const v = parseLength(atom);
    if (v === null || v.t !== "length") return null;
    if (FLUID_FORBIDDEN.has(v.unit) && atom !== "0") return null;
    parsed.push(v);
  }
  const [min, max, from, to] = parsed as [Value, Value, Value?, Value?];
  return from === undefined ? { t: "fluid", min, max, raw } : { t: "fluid", min, max, from, to, raw };
}

function parsePoly(args: readonly RawArg[], raw: string): Value | null {
  if (args.length < 3) return null;
  const points: [number, number][] = [];
  for (const arg of args) {
    if (arg.atoms.length !== 2) return null;
    const [xs, ys] = arg.atoms as [string, string];
    if (!NUMBER_RE.test(xs) || !NUMBER_RE.test(ys)) return null;
    const x = Number(xs);
    const y = Number(ys);
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    points.push([x, y]);
  }
  return { t: "poly", points, raw };
}

/** 3, 4, 6 or 8 hex digits normalized to 8 lowercase (grammar §08). */
function normalizeHex(digits: string): string {
  const d = digits.toLowerCase();
  const expand = (s: string): string =>
    s
      .split("")
      .map((c) => c + c)
      .join("");
  switch (d.length) {
    case 3:
      return expand(d) + "ff";
    case 4:
      return expand(d);
    case 6:
      return d + "ff";
    default:
      return d;
  }
}

function rawText(raw: RawValue): string {
  switch (raw.kind) {
    case "absent":
      return "";
    case "string":
      return JSON.stringify(raw.text);
    case "bare":
      return raw.text;
    case "func":
      return raw.raw;
  }
}

export function describeTypes(decl: AttrSchema): string {
  const parts: string[] = [];
  for (const t of decl.types) {
    if (t === "enum") parts.push(`one of ${(decl.enum ?? []).map((e) => `\`${e}\``).join(", ")}`);
    else if (t === "role") parts.push(`a palette role (${ROLES.join(", ")})`);
    else if (t === "pair") parts.push(`a quoted pair of ${decl.pairOf ?? "length"} values`);
    else parts.push(`a ${t}`);
  }
  return parts.join(" or ");
}
