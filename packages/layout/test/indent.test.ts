/**
 * §07.6 indent after an object: a paragraph after a picture the reader sees there starts flush; one
 * after a picture that floated elsewhere runs on from the text before it, so it takes its indent.
 */
import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wocument/parser";
import { resolve, type AssetHost } from "@wocument/resolver";
import { PrepareCache, createFixedEngine } from "@wocument/text-engine";
import { layout } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const fake: AssetHost = { image: (p) => ({ url: p, type: "image/jpeg", width: 1600, height: 1000, animated: false }), contour: () => null, file: (p) => ({ url: p, type: "x" }) };
const P = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays.`).join(" ");
const SRC = `---\nwocument: 1\ntitle: T\n---\n${[P(8, "a"), P(8, "b"), `\\figure[src=/w.jpg, alt="w", size=wide]`, P(8, "c"), P(8, "d"), P(8, "e"), P(8, "f")].join("\n\n")}\n`;

/** The x of the first line of the paragraph after the figure, and of its column's other lines. */
function after(width: number, height: number) {
  const rd = resolve(parse(SRC).ast as Document, { assets: fake }).doc;
  const pd = layout(rd, { width, height }, new PrepareCache(createFixedEngine()));
  layoutInvariants(rd, pd);
  const lines = pd.scenes.flatMap((s) => s.lines).filter((l) => l.style === "body");
  const first = lines.find((l) => l.block === 3 && l.paragraphStart)!;
  const column = lines.filter((l) => l.column === first.column && Math.abs(l.y - first.y) < 300 && !l.paragraphStart);
  const figure = pd.scenes.flatMap((s) => s.objects).find((o) => o.kind === "figure")!;
  return { indent: first.x - Math.min(...column.map((l) => l.x)), between: figure.box.y < first.y && figure.box.y + figure.box.height <= first.y + 1 && figure.box.x <= first.x };
}

describe("indent after an object", () => {
  it("a picture that floated away: the paragraph after it takes its indent", () => {
    const r = after(1920, 1080);
    expect(r.between).toBe(false);
    expect(r.indent).toBeGreaterThan(10);
  });

  it("a picture set between the paragraphs (a phone): the paragraph after it starts flush", () => {
    const r = after(390, 844);
    expect(r.between).toBe(true);
    expect(r.indent).toBe(0);
  });
});
