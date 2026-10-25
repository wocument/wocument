/**
 * `\blockquote` (spec §10.3): quoted paragraphs in the flow, with an optional
 * `\cite`, set in from both sides of the column, and able to break across
 * columns like any other text.
 */
import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wocument/parser";
import type { ParagraphBlock } from "@wocument/resolved-document";
import { resolve } from "@wocument/resolver";
import { PrepareCache, createFixedEngine } from "@wocument/text-engine";
import { layout } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const P = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays.`).join(" ");
const SRC = `---\nwocument: 1\ntitle: T\n---\n\\style[name=blockquote, indent=2em]\n\\story[name=s]{\n${P(6, "a")}\n\n\\blockquote{${P(4, "q")}\n\n${P(3, "r")}\n\\cite{A Keeper}}\n\n${P(6, "b")}\n\n${P(6, "c")}\n}\n\\scene{\\frame[story=s, cols=3-10]}\n`;

function lay(src: string, width = 1470) {
  const p = parse(src);
  expect(p.diagnostics).toEqual([]);
  const rd = resolve(p.ast as Document).doc;
  const pd = layout(rd, { width, height: 956 }, new PrepareCache(createFixedEngine()));
  layoutInvariants(rd, pd);
  return { rd, pd };
}

describe("\\blockquote", () => {
  it("resolves to paragraphs that share a quote number, in the blockquote style, and a cite", () => {
    const { rd } = lay(SRC);
    const blocks = rd.variants.base!.stories.s!.blocks as ParagraphBlock[];
    expect(blocks.map((b) => [b.element, b.style, b.quote])).toEqual([
      ["prose", "body", null],
      ["prose", "blockquote", 1],
      ["prose", "blockquote", 1],
      ["cite", "blockquote+cite", 1],
      ["prose", "body", null],
      ["prose", "body", null],
    ]);
    // Flush at its first paragraph and after it; indented inside it (the test gives the quote style an indent).
    expect(blocks.map((b) => "n" in b.indent && b.indent.n === 0)).toEqual([true, true, false, true, true, false]);
  });

  it("is set in from both sides of the column", () => {
    const { pd } = lay(SRC);
    const lines = pd.scenes[0]!.lines;
    const body = lines.filter((l) => l.style === "body");
    // Not a paragraph's first line, which also takes the first-line indent.
    const quote = lines.filter((l) => l.style === "blockquote" && !l.paragraphStart);
    const left = Math.min(...body.map((l) => l.x));
    const right = Math.max(...body.map((l) => l.x + l.width));
    expect(quote.length).toBeGreaterThan(3);
    for (const l of quote) {
      expect(l.x).toBeGreaterThan(left + 20);
      expect(l.x + l.width).toBeLessThan(right - 20);
      // Even on both sides.
      expect(Math.abs(l.x - left - (right - (l.x + l.width)))).toBeLessThan(1);
    }
  });

  it("on a phone, takes at most an eighth of the column from each side", () => {
    const { pd } = lay(SRC, 390);
    const lines = pd.scenes[0]!.lines;
    const body = lines.filter((l) => l.style === "body");
    const left = Math.min(...body.map((l) => l.x));
    const width = Math.max(...body.map((l) => l.x + l.width)) - left;
    for (const l of lines.filter((x) => x.style === "blockquote" && !x.paragraphStart)) expect(l.x - left).toBeLessThanOrEqual(width / 8 + 0.5);
  });

  it("breaks across columns like the text around it", () => {
    const long = SRC.replace(P(4, "q"), P(40, "q")).replace("cols=3-10]", "cols=1-12, columns=3]");
    const { pd } = lay(long);
    const columns = new Set(pd.scenes[0]!.lines.filter((l) => l.style === "blockquote").map((l) => l.column));
    expect(columns.size).toBeGreaterThan(1);
  });
});

describe("\\blockquote[span=all]", () => {
  it("crosses every column of a multi-column frame", () => {
    const src = SRC.replace("\\blockquote{", "\\blockquote[span=all]{").replace("cols=3-10]", "cols=1-12, columns=3]");
    const { pd } = lay(src);
    const lines = pd.scenes[0]!.lines;
    const body = Math.max(...lines.filter((l) => l.style === "body").map((l) => l.width));
    expect(Math.max(...lines.filter((l) => l.style === "blockquote").map((l) => l.width))).toBeGreaterThan(2 * body);
  });
});
