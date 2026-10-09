/**
 * The playground showcase, parsed and resolved in Node, laid out with the
 * fixed-width engine at every test width: threading across scenes, a frame
 * break, balanced columns, screen scenes, a drop cap and an in-frame rule.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import type { ParagraphBlock } from "@wmxdsl/resolved-document";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout, type PositionedDocument } from "../src/index.js";

const src = readFileSync(fileURLToPath(new URL("../../playground/docs/showcase.wmx", import.meta.url)), "utf8");
const assets = createAssetHost({ publicDir: fileURLToPath(new URL("../../playground/public", import.meta.url)), sourceDir: "." });
const { doc: rd } = resolve(parse(src).ast as Document, { assets });
const at = (width: number, height = 900): PositionedDocument => layout(rd, { width, height }, new PrepareCache(createFixedEngine()));

/** A story's text as laid out, rejoined across lines, columns, frames and scenes. */
function laidOut(pd: PositionedDocument, story: string): string {
  const lines = pd.scenes.flatMap((s) => s.lines).filter((l) => l.story === story);
  let out = "";
  let block = -1;
  for (const l of lines) {
    if (l.block !== block) {
      out += (out ? "\n" : "") + (l.paragraphStart ? capOf(l.block) : "");
      block = l.block;
    } else if (!out.endsWith("\u00ad")) out = out.trimEnd() + " ";
    out = out.replace(/\u00ad$/, "") + l.text;
  }
  return out.replace(/\u00ad/g, "").trimEnd();
}
const capOf = (block: number): string => {
  const b = rd.variants.base!.stories.main!.blocks[block] as ParagraphBlock;
  return b.dropcap ? rd.strings[b.dropcap.s]! : "";
};
/** The story's source text, block by block, as the reader should see it. */
const source = (): string =>
  rd.variants.base!.stories.main!.blocks
    .filter((b): b is ParagraphBlock => b.kind === "paragraph")
    .map((b) => (b.dropcap ? rd.strings[b.dropcap.s] : "") + b.runs.map((r) => (r.kind === "text" ? rd.strings[r.s] : "")).join(""))
    .join("\n")
    .replace(/\u00ad/g, "");

describe.each([360, 768, 1280, 1470, 2560])("showcase at %ipx", (width) => {
  const pd = at(width);

  it("sets every character of the threaded story exactly once, across both scenes", () => {
    // Lowercased, as the shared invariants compare: a style may set its text in capitals (subheads do).
    expect(laidOut(pd, "main").toLowerCase()).toBe(source().toLowerCase());
  });

  it("splits the story at the frame break: part one ends before it, part two starts after it", () => {
    const blocks = (scene: string) => new Set(pd.scenes.find((s) => s.name === scene)!.lines.filter((l) => l.story === "main").map((l) => l.block));
    const framebreak = rd.variants.base!.stories.main!.blocks.findIndex((b) => b.kind === "framebreak");
    expect(Math.max(...blocks("part-one"))).toBeLessThan(framebreak);
    expect(Math.min(...blocks("part-two"))).toBeGreaterThan(framebreak);
  });

  it("screen scenes are at least one viewport tall", () => {
    for (const s of pd.scenes.filter((s) => ["opener", "breath"].includes(s.name))) expect(s.height).toBeGreaterThanOrEqual(900);
  });

  it("no two lines in the same column overlap", () => {
    for (const s of pd.scenes) {
      const byCol = new Map<string, typeof s.lines>();
      for (const l of s.lines) byCol.set(`${l.frame}:${l.column}`, [...(byCol.get(`${l.frame}:${l.column}`) ?? []), l]);
      for (const ls of byCol.values())
        for (let i = 1; i < ls.length; i++) expect(ls[i]!.y).toBeGreaterThanOrEqual(ls[i - 1]!.y + ls[i - 1]!.height - 1e-6);
    }
  });

  it("the drop cap sits on the baseline of its third line", () => {
    const s = pd.scenes.find((x) => x.name === "part-one")!;
    const cap = s.caps[0]!;
    const own = s.lines.filter((l) => l.story === cap.story && l.block === cap.block);
    expect(cap.baseline).toBeCloseTo(own[2]!.baseline, 6);
    expect(own[0]!.x).toBeGreaterThan(cap.x + cap.width - 1e-6);
  });
});

describe("balanced columns (§09.4)", () => {
  // Text-only, so balance is always reachable. (Part one of the showcase holds a 400px figure
  // that cannot split, and there the best split leaves the columns uneven, as §09.4 allows.)
  it("two columns of plain text end within one baseline step of each other", () => {
    const text = Array.from({ length: 9 }, (_, i) => `Paragraph ${i} ${"words that wrap across lines ".repeat(6)}`).join("\n\n");
    const { doc } = resolve(parse(`---\nwmxdsl: 1\ntitle: T\n---\n\\story[name=s]{${text}}\n\\scene{\\frame[story=s, cols=1-8, columns=2]}`).ast as Document);
    const s = layout(doc, { width: 1470, height: 900 }, new PrepareCache(createFixedEngine())).scenes[0]!;
    const bottoms = [0, 1].map((c) => Math.max(...s.lines.filter((l) => l.column === c).map((l) => l.y + l.height)));
    expect(bottoms.every(Number.isFinite)).toBe(true);
    expect(Math.abs(bottoms[0]! - bottoms[1]!)).toBeLessThanOrEqual(s.grid.baseline + 1e-6);
  });

  it("phone lays part one out in one column", () => {
    const s = at(360).scenes.find((x) => x.name === "part-one")!;
    expect(new Set(s.lines.map((l) => l.column))).toEqual(new Set([0]));
  });
});

describe("the rule in part two's bio frame", () => {
  it("is placed once, above the bio, at full column width", () => {
    const s = at(1470).scenes.find((x) => x.name === "part-two")!;
    expect(s.rules).toHaveLength(1);
    const bio = s.lines.find((l) => l.style === "bio")!;
    expect(s.rules[0]!.y).toBeLessThan(bio.y);
    expect(s.rules[0]!.x).toBeCloseTo(bio.x, 6);
  });
});
