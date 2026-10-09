/**
 * `\group` placement (spec §11.11, design 2026-09-26): stacks, row groups
 * packing whole columns and wrapping, valign, and every layout invariant, on
 * the fixed-width engine.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout, span, type PositionedDocument } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
// Missing files on purpose: the resolver's placeholder sizes (from ratio=) stand in.
const assets = createAssetHost({ publicDir: here("."), sourceDir: here(".") });

const SRC = (valign: string) => `---
wmxdsl: 1
title: Groups
---
\\story[name=main]{
  One two three four five six seven eight nine ten. Eleven twelve thirteen fourteen fifteen.

  Sixteen seventeen eighteen nineteen twenty.
}

\\scene[name=s]{
  \\group[layout=row, cols=all, valign=${valign}]{
    \\group[min-width=7col]{
      \\figure[src=/a.jpg, alt="A", ratio=16:10]
      \\frame[story=main]
    }
    \\figure[src=/b.jpg, alt="B", min-width=4col, max-width=5col, ratio=4:5]
    \\frame[width=3col]{Beside the rest, a short inline frame.}
  }
  \\frame[cols=all]{After the group.}
}
`;

function lay(valign: string, width: number): { pd: PositionedDocument; rd: ReturnType<typeof resolve>["doc"] } {
  const rd = resolve(parse(SRC(valign)).ast as Document, { assets }).doc;
  return { rd, pd: layout(rd, { width, height: 900 }, new PrepareCache(createFixedEngine())) };
}
const obj = (pd: PositionedDocument, name: string) => pd.scenes[0]!.objects.find((o) => o.name === name)!;
const colsOf = (pd: PositionedDocument, x: number, w: number): [number, number] => {
  const g = pd.scenes[0]!.grid;
  const from = Math.round((x - g.originX) / (g.colWidth + g.gutter)) + 1;
  const to = from + Math.round((w + g.gutter) / (g.colWidth + g.gutter)) - 1;
  return [from, to];
};

describe("row group", () => {
  it("packs 7 + 4 on 12 columns, wraps the fixed 3-column frame onto a short last row", () => {
    const { pd } = lay("top", 1280);
    const a = obj(pd, "figure-1");
    const b = obj(pd, "figure-2");
    // The stack took the spare column: 8, then the photo 4.
    expect(colsOf(pd, a.box.x, a.box.width)).toEqual([1, 8]);
    expect(colsOf(pd, b.box.x, b.box.width)).toEqual([9, 12]);
    expect(a.box.y).toBe(b.box.y);
    const inline = pd.scenes[0]!.lines.filter((l) => l.frame === "frame-2");
    const g = pd.scenes[0]!.grid;
    expect(inline[0]!.x).toBeCloseTo(span(g, 1, 3).x);
    expect(Math.max(...inline.map((l) => l.x + l.width))).toBeLessThanOrEqual(span(g, 1, 3).x + span(g, 1, 3).width + 1e-6);
    // The second row starts below the first, on the baseline grid.
    const rowOne = Math.max(b.box.y + b.box.height, ...pd.scenes[0]!.lines.filter((l) => l.frame === "frame-1").map((l) => l.y + l.height));
    expect(inline[0]!.y).toBeGreaterThanOrEqual(rowOne);
  });

  it("puts every child in its own full-width row on a phone, the stack's photo and text together", () => {
    const { pd } = lay("top", 390);
    const a = obj(pd, "figure-1");
    const b = obj(pd, "figure-2");
    const g = pd.scenes[0]!.grid;
    expect(colsOf(pd, a.box.x, a.box.width)).toEqual([1, g.cols]);
    const text = pd.scenes[0]!.lines.filter((l) => l.frame === "frame-1");
    // Photo, then its text, then the other photo.
    expect(text[0]!.y).toBeGreaterThanOrEqual(a.box.y + a.box.height);
    expect(b.box.y).toBeGreaterThanOrEqual(Math.max(...text.map((l) => l.y + l.height)));
  });

  it("valign=stretch gives the photo beside the stack the row's full height", () => {
    const top = lay("top", 1280).pd;
    const stretched = lay("stretch", 1280).pd;
    const rowBottom = (pd: PositionedDocument) =>
      Math.max(obj(pd, "figure-1").box.y + obj(pd, "figure-1").box.height, ...pd.scenes[0]!.lines.filter((l) => l.frame === "frame-1").map((l) => l.y + l.height));
    const b = obj(stretched, "figure-2");
    expect(b.box.y + b.box.height).toBeCloseTo(rowBottom(stretched));
    expect(b.box.height).toBeGreaterThan(obj(top, "figure-2").box.height);
  });

  it("valign=text: the row is as tall as its text, and the photo is cropped to it (the opener, 2026-09-30)", () => {
    const src = `---\nwmxdsl: 1\ntitle: T\n---\n\\scene{\\group[layout=row, cols=all, valign=text]{\\frame[min-width=8col]{\\kicker{A kicker}\n\\headline{A headline}\n\\deck{A short deck.}}\n\\figure[src=/b.jpg, alt="B", min-width=4col, ratio=4:5]}}`;
    const pd = layout(resolve(parse(src).ast as Document, { assets }).doc, { width: 1280, height: 800 }, new PrepareCache(createFixedEngine()));
    const text = pd.scenes[0]!.lines.filter((l) => l.frame === "frame-1");
    const b = obj(pd, "figure-1");
    expect(Math.abs(b.box.y - text[0]!.y)).toBeLessThan(12); // the row's top: the kicker's line box starts a little lower
    expect(b.box.y + b.box.height).toBeCloseTo(Math.max(...text.map((l) => l.y + l.height)), 0);
  });

  it("width=fit: a frame takes the columns its widest line needs, and the photo the rest", () => {
    const src = `---\nwmxdsl: 1\ntitle: T\n---\n\\scene{\\group[layout=row, cols=all, valign=text]{\\frame[width=fit]{\\headline{Short}}\n\\figure[src=/b.jpg, alt="B", min-width=3col, ratio=4:5]}}`;
    const pd = layout(resolve(parse(src).ast as Document, { assets }).doc, { width: 1280, height: 800 }, new PrepareCache(createFixedEngine()));
    const text = pd.scenes[0]!.lines.filter((l) => l.frame === "frame-1");
    const b = obj(pd, "figure-1");
    const right = Math.max(...text.map((l) => l.x + l.measured));
    expect(b.box.x).toBeGreaterThan(right); // starts after the heading's widest line
    expect(b.box.x - right).toBeLessThan(span(pd.scenes[0]!.grid, 1, 1).width + 2 * pd.scenes[0]!.grid.gutter); // within a column of it
    expect(b.box.x + b.box.width).toBeCloseTo(1280 - pd.scenes[0]!.grid.marginX, 0); // to the right edge
  });

  it("valign=bottom lines the bottoms up", () => {
    const { pd } = lay("bottom", 1280);
    const a = obj(pd, "figure-1");
    const b = obj(pd, "figure-2");
    const stackBottom = Math.max(...pd.scenes[0]!.lines.filter((l) => l.frame === "frame-1").map((l) => l.y + l.height), a.box.y + a.box.height);
    expect(b.box.y + b.box.height).toBeCloseTo(stackBottom);
  });

  it("the frame after the group starts below it", () => {
    const { pd } = lay("top", 1280);
    const after = pd.scenes[0]!.lines.filter((l) => l.frame === "frame-3");
    const groupBottom = Math.max(...pd.scenes[0]!.lines.filter((l) => l.frame !== "frame-3").map((l) => l.y + l.height), ...pd.scenes[0]!.objects.map((o) => o.box.y + o.box.height));
    expect(after[0]!.y).toBeGreaterThanOrEqual(groupBottom);
  });

  for (const valign of ["top", "center", "bottom", "stretch"])
    it.each([360, 768, 1280, 1470, 2560])(`holds the layout invariants, valign=${valign}, at %ipx`, (width) => {
      const { rd, pd } = lay(valign, width);
      layoutInvariants(rd, pd);
    });
});
