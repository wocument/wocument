/**
 * Phase A observable behavior of conformance vectors 1 to 7 (grammar §13).
 * The phase B and C halves of vectors 6 and 7 are asserted in vectors.test.ts.
 */
import { describe, expect, it } from "vitest";
import { surface } from "../helpers.js";

describe("conformance: surface (vectors 1-7)", () => {
  it("1. a single % is literal text", () => {
    const r = surface("40% of readers, 100%.");
    expect(r.sketch).toEqual(['text "40% of readers, 100%."']);
    expect(r.codes).toEqual([]);
  });

  it("2. a trailing comment keeps its newline and drops the space before it", () => {
    const r = surface("Done. %% note");
    expect(r.sketch).toEqual(['text "Done."', 'comment(trail) "%% note"']);
    expect(r.codes).toEqual([]);
  });

  it("3. a whole-line comment never splits a paragraph", () => {
    const r = surface("A\n%% c\nB");
    expect(r.sketch).toEqual(['text "A\\n"', 'comment(line) "%% c"', 'text "B"']);
  });

  it("4. a blank line either side of a comment still separates paragraphs", () => {
    const r = surface("A\n\n%% c\n\nB");
    expect(r.sketch).toEqual(['text "A"', 'comment(line) "%% c"', "blank", 'text "B"']);
  });

  it("4b. a comment collapsing onto a blank line still separates paragraphs", () => {
    // The line comment vanishes with its newline, leaving `A\n\nB`.
    const r = surface("A\n%% c\n\nB");
    expect(r.sketch).toEqual(['text "A"', 'comment(line) "%% c"', "blank", 'text "B"']);
  });

  it("5. \\%% is a literal percent sign followed by text", () => {
    const r = surface("\\%% literal");
    expect(r.sketch).toEqual(['escape "%"', 'text "% literal"']);
    expect(r.codes).toEqual([]);
  });

  it("6. whitespace before [ means the bracket is text", () => {
    const r = surface("\\frame [x]");
    expect(r.sketch).toEqual(["\\frame", 'text " [x]"']);
    expect(r.codes).toEqual([]);
  });

  it("7. whitespace before { means the brace opens nothing", () => {
    const r = surface("\\headline {Hi}");
    expect(r.sketch).toEqual(["\\headline", 'text " "', 'text "Hi"']);
    expect(r.codes).toEqual(["P010"]);
  });

  it("7b. the stray-brace diagnostic carries the whitespace hint", () => {
    const r = surface("\\headline {Hi}");
    // exercised through parseSurface so the hint text itself is pinned
    expect(r.codes).toEqual(["P010"]);
  });
});

describe("phase A details", () => {
  it("takes command names by maximal munch", () => {
    expect(surface("\\brand").sketch).toEqual(["\\brand"]);
    expect(surface("\\br and").sketch).toEqual(["\\br", 'text " and"']);
  });

  it("ends a bodiless command at the first non-lowercase character", () => {
    expect(surface("Stone \\br and Strategy").sketch).toEqual([
      'text "Stone "',
      "\\br",
      'text " and Strategy"',
    ]);
  });

  it("attaches an attribute list only when it is adjacent", () => {
    expect(surface("\\frame[cols=1-8]").sketch).toEqual(["\\frame[cols]"]);
    expect(surface("\\frame[cols=1-8]{x}").sketch).toEqual(["\\frame[cols] {", '  text "x"', "}"]);
  });

  it("allows newlines inside an attribute list", () => {
    expect(surface("\\frame[cols=1-8,\n  hide@phone]").sketch).toEqual(["\\frame[cols,hide@phone]"]);
  });

  it("reports a closing brace that closes nothing", () => {
    expect(surface("a } b").codes).toEqual(["P011"]);
  });

  it("reports a body that is never closed", () => {
    const r = surface("\\sidebar{a");
    expect(r.codes).toEqual(["P010"]);
  });

  it("reports an invalid escape", () => {
    // `\q` is the command `q` by maximal munch, not a bad escape.
    expect(surface("\\q").sketch).toEqual(["\\q"]);
    expect(surface("\\q").codes).toEqual([]);
    expect(surface("\\1").codes).toEqual(["L004"]);
    expect(surface("\\&").codes).toEqual(["L004"]);
  });

  it("treats every escapable character as an opaque literal", () => {
    const r = surface("\\-\\-");
    expect(r.sketch).toEqual(['escape "-"', 'escape "-"']);
  });

  it("nests bodies", () => {
    const r = surface("\\a{\\b{x}}");
    expect(r.sketch).toEqual(["\\a {", "  \\b {", '    text "x"', "  }", "}"]);
  });

  it("keeps a trailing comment out of the text run", () => {
    const r = surface("\\figure[src=/a.png]  %% note\nnext");
    expect(r.sketch).toEqual(["\\figure[src]", 'comment(trail) "%% note"', 'text "\\nnext"']);
  });
});
