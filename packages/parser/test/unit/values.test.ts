import { describe, expect, it } from "vitest";
import type { AttrSchema, TypeName } from "@wmxdsl/schema";
import { Diagnostics } from "../../src/diagnostics.js";
import { PositionIndex } from "../../src/positions.js";
import { lexAttrList, type RawValue } from "../../src/attrs.js";
import { typeValue } from "../../src/values.js";

/** Lexes `[k=<src>]` and types the value, so the real lexer feeds the typer. */
function typed(src: string, decl: AttrSchema) {
  const text = `[k=${src}]`;
  const diags = new Diagnostics();
  const r = lexAttrList(text, 0, diags, new PositionIndex(text));
  const attr = r.list.attrs[0];
  if (attr === undefined) return { lexCodes: diags.sorted().map((d) => d.code), result: null };
  return { lexCodes: diags.sorted().map((d) => d.code), result: typeValue(attr.value, decl) };
}

const of = (types: TypeName[], extra: Partial<AttrSchema> = {}): AttrSchema => ({ types, ...extra });

/** Every row of the grammar §04.1 type table: one passing, one failing. */
const TABLE: [string, AttrSchema, string, string][] = [
  ["integer", of(["integer"]), "12", "1.5"],
  ["number", of(["number"]), "-0.02", "1.2.3"],
  ["length", of(["length"]), "24px", "24parsec"],
  ["length (bare zero only)", of(["length"]), "0", "5"],
  ["percentage", of(["percentage"]), "50%", "50"],
  ["time", of(["time"]), "600ms", "600"],
  ["range", of(["range"]), "1-4", "8-1"],
  ["ratio", of(["ratio"]), "16:9", "16/9"],
  ["color", of(["color"]), "#00000080", "#12345"],
  ["role", of(["role"]), "accent", "magenta"],
  ["boolean", of(["boolean"]), "true", "yes"],
  ["enum", of(["enum"], { enum: ["cover", "contain"] }), "cover", "crop"],
  ["ident", of(["ident"]), "feature-2", "Feature"],
  ["string", of(["string"]), '"A caption"', ""],
  ["path", of(["path"]), "/img/keep.png", ""],
  ["pair", of(["pair"], { pairOf: "length" }), '"50% 30%"', '"50%"'],
  ["fluid", of(["fluid"]), "fluid(18px, 22px)", "fluid(18px)"],
  ["poly", of(["poly"]), "poly(0 0, 1 0, 0.5 1)", "poly(0 0, 1 0)"],
  ["tokenref", of(["color"]), "$ember", "$Ember"],
];

describe("type table (grammar §04.1)", () => {
  for (const [name, decl, good, bad] of TABLE) {
    it(`${name}: accepts ${good || "<empty>"}`, () => {
      const r = typed(good, decl);
      expect(r.result?.ok, JSON.stringify(r)).toBe(true);
    });
    it(`${name}: rejects ${bad || "<empty>"}`, () => {
      const r = typed(bad, decl);
      const rejected = r.result === null || r.result.ok === false || r.lexCodes.length > 0;
      expect(rejected, JSON.stringify(r)).toBe(true);
    });
  }
});

describe("value shapes", () => {
  const val = (src: string, decl: AttrSchema) => {
    const r = typed(src, decl);
    if (r.result === null || !r.result.ok) throw new Error(`did not type: ${src}`);
    return r.result.value;
  };

  it("normalizes colors to 8 lowercase hex digits and keeps the spelling", () => {
    expect(val("#FFF", of(["color"]))).toEqual({ t: "color", hex: "ffffffff", raw: "#FFF" });
    expect(val("#1a1a1a", of(["color"]))).toEqual({ t: "color", hex: "1a1a1aff", raw: "#1a1a1a" });
    expect(val("#00000080", of(["color"]))).toEqual({ t: "color", hex: "00000080", raw: "#00000080" });
    expect(val("#abcd", of(["color"]))).toEqual({ t: "color", hex: "aabbccdd", raw: "#abcd" });
  });

  it("expands ranges", () => {
    expect(val("all", of(["range"]))).toMatchObject({ from: 1, to: "end" });
    expect(val("3", of(["range"]))).toMatchObject({ from: 3, to: 3 });
    expect(val("5-end", of(["range"]))).toMatchObject({ from: 5, to: "end" });
    expect(val("1-4", of(["range"]))).toMatchObject({ from: 1, to: 4 });
  });

  it("converts time to milliseconds", () => {
    expect(val("0.4s", of(["time"]))).toMatchObject({ ms: 400 });
    expect(val("600ms", of(["time"]))).toMatchObject({ ms: 600 });
  });

  it("keeps fluid arguments typed", () => {
    expect(val("fluid(18px, 22px)", of(["fluid"]))).toMatchObject({
      t: "fluid",
      min: { n: 18, unit: "px" },
      max: { n: 22, unit: "px" },
    });
    expect(val("fluid(1rem, 2rem, 360px, 1440px)", of(["fluid"]))).toMatchObject({ t: "fluid" });
  });

  it("rejects %, col and bl inside fluid", () => {
    for (const bad of ["fluid(10%, 20%)", "fluid(1col, 2col)", "fluid(1bl, 2bl)"]) {
      expect(typed(bad, of(["fluid"])).result?.ok).toBe(false);
    }
  });

  it("rejects poly points outside 0..1", () => {
    expect(typed("poly(0 0, 1 0, 1.5 1)", of(["poly"])).result?.ok).toBe(false);
    expect(typed("poly(0 0, 1 0, -0.1 1)", of(["poly"])).result?.ok).toBe(false);
  });
});

describe("union order (grammar §04.1 rule 1)", () => {
  it("prefers an enum keyword over a scalar", () => {
    const decl = of(["length", "enum"], { enum: ["auto"] });
    const v = typed("auto", decl).result;
    expect(v?.ok && v.value.t).toBe("enum");
  });

  it("prefers a role over a color for a role name", () => {
    const decl = of(["role", "color"]);
    const v = typed("accent", decl).result;
    expect(v?.ok && v.value.t).toBe("role");
  });

  it("accepts a token reference for the types listed in rule 2", () => {
    for (const t of ["integer", "number", "length", "percentage", "time", "color", "ratio", "string"] as TypeName[]) {
      const v = typed("$brand", of([t])).result;
      expect(v?.ok, t).toBe(true);
      expect(v?.ok && v.value.t).toBe("tokenref");
    }
  });

  it("rejects a token reference for ident, enum, boolean, range, path and role", () => {
    const cases: [TypeName, Partial<AttrSchema>][] = [
      ["ident", {}],
      ["enum", { enum: ["x"] }],
      ["boolean", {}],
      ["range", {}],
      ["path", {}],
      ["role", {}],
    ];
    for (const [t, extra] of cases) {
      expect(typed("$g", of([t], extra)).result?.ok, t).toBe(false);
    }
  });
});

describe("booleans and \\token", () => {
  it("treats a bare key as true", () => {
    const absent: RawValue = { kind: "absent" };
    expect(typeValue(absent, of(["boolean"]))).toEqual({ ok: true, value: { t: "boolean", b: true, raw: "" } });
  });

  it("rejects a bare key on a non-boolean attribute", () => {
    expect(typeValue({ kind: "absent" }, of(["length"])).ok).toBe(false);
  });

  it("stores a \\token value untyped", () => {
    const v = typed("4bl", of(["any"])).result;
    expect(v).toEqual({ ok: true, value: { t: "any", raw: "4bl" } });
  });
});
