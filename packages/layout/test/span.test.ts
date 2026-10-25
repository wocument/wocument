/**
 * `span=all` (spec §10.3): a text element across every column of a multi-column frame. The text
 * before it is set and balanced in the columns, the element across all of them, the text after it
 * in the columns below.
 */
import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wocument/parser";
import { resolve } from "@wocument/resolver";
import { PrepareCache, createFixedEngine } from "@wocument/text-engine";
import { layout, type PositionedLine } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const P = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays.`).join(" ");
function lay(story: string, scene = "", width = 1470) {
  const p = parse(`---\nwocument: 1\ntitle: T\n---\n\\story[name=s]{\n${story}\n}\n\\scene[${scene}]{\\frame[story=s, cols=1-12, columns=3]}\n`);
  expect(p.diagnostics).toEqual([]);
  const rd = resolve(p.ast as Document).doc;
  const pd = layout(rd, { width, height: 956 }, new PrepareCache(createFixedEngine()));
  layoutInvariants(rd, pd);
  return pd.scenes[0]!.lines;
}
const widest = (ls: PositionedLine[]) => Math.max(...ls.map((l) => l.width));

describe("span=all", () => {
  it("a subhead in the middle: balanced columns above it, it across all of them, columns below", () => {
    // Columns balance by whole blocks (§09.4), so three paragraphs on each side.
    const lines = lay(`${P(4, "a")}\n\n${P(4, "c")}\n\n${P(4, "d")}\n\n\\subhead[span=all]{A crosshead}\n\n${P(4, "b")}\n\n${P(4, "e")}\n\n${P(4, "f")}`);
    const head = lines.filter((l) => l.style === "subhead");
    const before = lines.filter((l) => l.block < 3);
    const after = lines.filter((l) => l.block > 3);
    const column = widest(before);
    expect(head).toHaveLength(1);
    expect(head[0]!.width).toBeGreaterThan(2.5 * column);
    expect(Math.max(...before.map((l) => l.y + l.height))).toBeLessThanOrEqual(head[0]!.y + 0.5);
    expect(Math.min(...after.map((l) => l.y))).toBeGreaterThanOrEqual(head[0]!.y + head[0]!.height - 0.5);
    expect(new Set(before.map((l) => l.column)).size).toBe(3);
    expect(new Set(after.map((l) => l.column)).size).toBe(3);
  });

  it("a lede at the start sets across the columns, and the text below in columns", () => {
    const lines = lay(`\\lede[span=all]{${P(3, "l")}}\n\n${P(20, "a")}`);
    const lede = lines.filter((l) => l.style === "lede");
    const body = lines.filter((l) => l.style === "body");
    expect(widest(lede)).toBeGreaterThan(2.5 * widest(body));
    expect(Math.min(...body.map((l) => l.y))).toBeGreaterThan(Math.max(...lede.map((l) => l.y)));
  });

  it("at the start of column bands in a page scene too", () => {
    const lines = lay(`\\lede[span=all]{${P(3, "l")}}\n\n${P(60, "a")}`, "height=page");
    expect(widest(lines.filter((l) => l.style === "lede"))).toBeGreaterThan(2.5 * widest(lines.filter((l) => l.style === "body")));
  });

  it("a one-column frame is unchanged", () => {
    const p = parse(`---\nwocument: 1\ntitle: T\n---\n\\story[name=s]{\n${P(4, "a")}\n\n\\subhead[span=all]{X}\n\n${P(4, "b")}\n}\n\\scene{\\frame[story=s, cols=3-10]}\n`);
    const q = parse(`---\nwocument: 1\ntitle: T\n---\n\\story[name=s]{\n${P(4, "a")}\n\n\\subhead{X}\n\n${P(4, "b")}\n}\n\\scene{\\frame[story=s, cols=3-10]}\n`);
    const at = (x: typeof p) => layout(resolve(x.ast as Document).doc, { width: 1470, height: 956 }, new PrepareCache(createFixedEngine())).scenes[0]!.lines.map((l) => [l.x, l.y, l.width]);
    expect(at(p)).toEqual(at(q));
  });
});

describe("span=all in column bands", () => {
  it("later than a frame's start, warns W035 and is set in its column", () => {
    const src = `---\nwocument: 1\ntitle: T\n---\n\\story[name=s]{\n${P(30, "a")}\n\n\\subhead[span=all]{Late}\n\n${P(30, "b")}\n}\n\\scene[height=page]{\\frame[story=s, cols=1-12, columns=3]}\n`;
    const r = resolve(parse(src).ast as Document);
    expect(r.diagnostics.filter((d) => d.code === "W035").map((d) => d.message)).toEqual([expect.stringContaining('story "s"')]);
    const lines = layout(r.doc, { width: 1470, height: 956 }, new PrepareCache(createFixedEngine())).scenes[0]!.lines;
    expect(widest(lines.filter((l) => l.style === "subhead"))).toBeLessThanOrEqual(widest(lines.filter((l) => l.style === "body")) + 0.5);
  });
});
