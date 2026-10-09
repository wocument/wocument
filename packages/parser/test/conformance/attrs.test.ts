/**
 * Conformance vectors 21 to 29 (grammar §13), at the attribute-list level.
 * The vectors that also depend on the command schema are re-asserted
 * end-to-end in vectors.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { AttrSchema } from "@wmxdsl/schema";
import { lexAttrList } from "../../src/attrs.js";
import { Diagnostics } from "../../src/diagnostics.js";
import { PositionIndex } from "../../src/positions.js";
import { typeValue } from "../../src/values.js";

function lex(list: string) {
  const diags = new Diagnostics();
  const r = lexAttrList(list, 0, diags, new PositionIndex(list));
  return { attrs: r.list.attrs, codes: diags.sorted().map((d) => d.code), diags: diags.sorted(), next: r.next };
}

const decl = (a: AttrSchema): AttrSchema => a;

describe("conformance: attribute lists (vectors 21-29)", () => {
  it("21. base value, breakpoint override and a bare boolean", () => {
    const r = lex("[cols=1-8, cols@phone=all, hide@tablet]");
    expect(r.codes).toEqual([]);
    expect(r.attrs.map((a) => [a.key, a.at])).toEqual([
      ["cols", null],
      ["cols", "phone"],
      ["hide", "tablet"],
    ]);
    const range = decl({ types: ["range"] });
    expect(typeValue(r.attrs[0]!.value, range)).toEqual({
      ok: true,
      value: { t: "range", from: 1, to: 8, raw: "1-8" },
    });
    expect(typeValue(r.attrs[1]!.value, range)).toEqual({
      ok: true,
      value: { t: "range", from: 1, to: "end", raw: "all" },
    });
    expect(typeValue(r.attrs[2]!.value, decl({ types: ["boolean"] }))).toEqual({
      ok: true,
      value: { t: "boolean", b: true, raw: "" },
    });
  });

  it("22. a duplicate key is P014", () => {
    expect(lex("[cols=1-8, cols=2-4]").codes).toEqual(["P014"]);
  });

  it("22b. the same key at a different breakpoint is not a duplicate", () => {
    expect(lex("[cols=1-8, cols@phone=all]").codes).toEqual([]);
  });

  it("23. a reversed range is P015", () => {
    const r = lex("[cols=8-1]");
    expect(r.codes).toEqual([]); // lexes fine
    expect(typeValue(r.attrs[0]!.value, decl({ types: ["range"] })).ok).toBe(false);
  });

  it("24. fluid and a negative em length", () => {
    const r = lex("[name=x, size=fluid(18px, 22px), tracking=-0.02em]");
    expect(r.codes).toEqual([]);
    expect(typeValue(r.attrs[1]!.value, decl({ types: ["fluid", "length"] }))).toMatchObject({
      ok: true,
      value: { t: "fluid", min: { n: 18, unit: "px" }, max: { n: 22, unit: "px" } },
    });
    expect(typeValue(r.attrs[2]!.value, decl({ types: ["length"] }))).toEqual({
      ok: true,
      value: { t: "length", n: -0.02, unit: "em", raw: "-0.02em" },
    });
  });

  it("25. an unquoted URL with a query string is L003 with the quoting hint", () => {
    const r = lex('[src=https://x.org/i.png?w=2, alt=""]');
    expect(r.codes).toEqual(["L003"]);
    expect(r.diags[0]?.hint).toBe("Quote the value.");
  });

  it("26. quoting it makes it valid, and alt is an empty string", () => {
    const r = lex('[src="https://x.org/i.png?w=2", alt=""]');
    expect(r.codes).toEqual([]);
    expect(typeValue(r.attrs[0]!.value, decl({ types: ["path"] }))).toMatchObject({
      ok: true,
      value: { t: "path", s: "https://x.org/i.png?w=2" },
    });
    expect(typeValue(r.attrs[1]!.value, decl({ types: ["string"] }))).toMatchObject({
      ok: true,
      value: { t: "string", s: "" },
    });
  });

  it("27. poly with three points", () => {
    const r = lex('[src=/a.png, shape=poly(0 0, 1 0, 0.5 1), alt="x"]');
    expect(r.codes).toEqual([]);
    expect(typeValue(r.attrs[1]!.value, decl({ types: ["poly"] }))).toMatchObject({
      ok: true,
      value: { t: "poly", points: [[0, 0], [1, 0], [0.5, 1]] },
    });
  });

  it("28. a token reference is accepted for a color", () => {
    const r = lex("[name=n, accent=$ember]");
    expect(r.codes).toEqual([]);
    expect(typeValue(r.attrs[1]!.value, decl({ types: ["role", "color"] }))).toEqual({
      ok: true,
      value: { t: "tokenref", name: "ember", raw: "$ember" },
    });
  });

  it("29. a token reference is rejected for an ident", () => {
    const r = lex("[grid=$g]");
    expect(r.codes).toEqual([]);
    expect(typeValue(r.attrs[0]!.value, decl({ types: ["ident"] })).ok).toBe(false);
  });
});

describe("attribute list lexing", () => {
  it("accepts an empty list and a trailing comma", () => {
    expect(lex("[]").attrs).toEqual([]);
    expect(lex("[a=1,]").codes).toEqual([]);
    expect(lex("[a=1,]").attrs).toHaveLength(1);
  });

  it("treats newlines as whitespace", () => {
    const r = lex("[\n  cols=1-8,\n  hide\n]");
    expect(r.codes).toEqual([]);
    expect(r.attrs.map((a) => a.key)).toEqual(["cols", "hide"]);
  });

  it("does not split on commas inside quotes or parentheses", () => {
    expect(lex('[alt="a, b", shape=poly(0 0, 1 0, 0 1)]').attrs.map((a) => a.key)).toEqual(["alt", "shape"]);
  });

  it("reports a newline inside a string as L006", () => {
    expect(lex('[alt="a\nb"]').codes).toEqual(["L006"]);
  });

  it("reports EOF inside a string as L002", () => {
    expect(lex('[alt="abc').codes).toEqual(["L002"]);
  });

  it("reports a brace or backslash inside the list as L003", () => {
    expect(lex("[a={]").codes).toEqual(["L003"]);
    expect(lex("[a=\\x]").codes).toEqual(["L003"]);
  });

  it("reports a comment marker inside the list as L003", () => {
    expect(lex("[a=1 %% no]").codes).toEqual(["L003"]);
  });

  it("reports an invalid escape inside a string as L003", () => {
    expect(lex('[alt="a\\nb"]').codes).toEqual(["L003"]);
  });

  it("recovers to a ] that ends the list", () => {
    const r = lex("[a=?]{");
    expect(r.codes).toEqual(["L003"]);
    expect(r.next).toBe(5); // just past the `]`
  });

  it("keeps uppercase and punctuation in bare values", () => {
    const r = lex("[id=a1B2c3D4e5F, src=/img/a.png, ratio=16:9, w=40%, c=#fff]");
    expect(r.codes).toEqual([]);
    expect(r.attrs.map((a) => (a.value.kind === "bare" ? a.value.text : null))).toEqual([
      "a1B2c3D4e5F",
      "/img/a.png",
      "16:9",
      "40%",
      "#fff",
    ]);
  });
});
