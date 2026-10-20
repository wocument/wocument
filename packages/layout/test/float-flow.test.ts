/**
 * Picture composition in a multi-column scrolling frame (design 2026-10-17): the frame is one screen;
 * a floating object takes a top spot at the frame's content top, and the columns balance below it.
 */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { type AssetHost, resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout, type PositionedDocument } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const GRID = "\\grid[name=page, cols=12, gutter=24px, margin-x=48px, margin-y=2bl, baseline=28px, body=1-12]\n";
const VIEW = { width: 1470, height: 900 };
const fake: AssetHost = {
  image: (path) => ({ url: path, type: "image/jpeg", width: 800, height: 600, animated: false }),
  contour: () => null,
  file: (path) => ({ url: path, type: "video/mp4" }),
};

const para = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays.`).join(" ");
const fig = (attrs: string): string => `\\figure[src=/a.jpg, alt="A picture", ${attrs}]`;
const flow = (story: string, columns = 3): string => `\\story[name=s]{${story}}\n\\scene[grid=page]{\\frame[story=s, cols=1-12, columns=${columns}]}`;
const STORY = `${para(12, "a")}\n\n${fig("size=wide, ratio=3:2")}\n\n${para(20, "b")}\n\n${para(16, "c")}\n\n${para(14, "d")}`;

function lay(src: string, opts?: { composeBudget?: number }): PositionedDocument {
  const { doc } = resolve(parse(FM + GRID + src).ast as Document, { assets: fake });
  const pd = layout(doc, VIEW, new PrepareCache(createFixedEngine()), opts);
  layoutInvariants(doc, pd, { standoff: false });
  return pd;
}

const lines = (pd: PositionedDocument) => pd.scenes[0]!.lines.filter((l) => l.story === "s");
const figure = (pd: PositionedDocument) => pd.scenes[0]!.objects.find((o) => o.name.startsWith("figure"))!;

describe("floating in multi-column scrolling frames", () => {
  it("a wide picture takes the frame's top", () => {
    const pd = lay(flow(STORY));
    const top = Math.min(...lines(lay(flow(STORY), { composeBudget: 0 })).map((l) => l.y));
    const o = figure(pd);
    const ls = lines(pd);
    const cols = [0, 1, 2].map((c) => Math.min(...ls.filter((l) => l.column === c).map((l) => l.x)));
    const colWidth = Math.max(...ls.filter((l) => l.column === 0).map((l) => l.x + l.width)) - cols[0]!;
    // At the frame's content top, on the grid line there: nothing of the frame above it.
    expect(o.box.y).toBeGreaterThanOrEqual(top - 28);
    expect(o.box.y).toBeLessThanOrEqual(top + 1e-3);
    expect(Math.min(...ls.map((l) => l.y))).toBeGreaterThanOrEqual(o.box.y - 1e-3);
    // Two or three columns wide, from a column's left edge.
    expect(cols.some((x) => Math.abs(o.box.x - x) < 1)).toBe(true);
    expect(o.box.width).toBeGreaterThan(colWidth + 1);
    // Text in the columns it spans starts below it.
    for (const l of ls) if (l.x < o.box.x + o.box.width && l.x + l.width > o.box.x) expect(l.y).toBeGreaterThanOrEqual(o.box.y + o.box.height - 1e-3);
  });

  it("a frame stacked below starts below every floated box", () => {
    const src = `\\story[name=s]{${para(2, "a")}\n\n${fig("size=wide, ratio=3:2")}\n\n${para(2, "b")}}\n\\story[name=u]{${para(6, "u")}}\n\\scene[grid=page]{\\frame[story=s, cols=1-12, columns=3]\n\\frame[story=u, cols=1-12]}`;
    const pd = lay(src);
    const o = figure(pd);
    expect(o.box.y).toBeLessThan(Math.min(...lines(pd).map((l) => l.y)) + 1e-3);
    const u = pd.scenes[0]!.lines.filter((l) => l.story === "u");
    expect(Math.min(...u.map((l) => l.y))).toBeGreaterThanOrEqual(o.box.y + o.box.height - 1e-3);
  });

  it("a single-column frame is unchanged", () => {
    const one = flow(STORY, 1);
    expect(lay(one)).toEqual(lay(one, { composeBudget: 0 }));
  });

  it("balancing still keeps paragraphs whole", () => {
    const pd = lay(flow(STORY));
    const byBlock = new Map<number, Set<number>>();
    for (const l of lines(pd)) byBlock.set(l.block, (byBlock.get(l.block) ?? new Set()).add(l.column));
    for (const cols of byBlock.values()) expect(cols.size).toBe(1);
    // And composed: the picture is not where today's rule sets it.
    expect(figure(pd).box).not.toEqual(figure(lay(flow(STORY), { composeBudget: 0 })).box);
  });
  it("only a float anchored within one band of the frame top moves to the top", () => {
    // 1280x800: the band is 800 - 2*56 = 688px. The anchors lie about 0.8, 3.4 and 5.9 bands down.
    const story = `${para(14, "a")}\n\n${fig("ratio=3:2")}\n\n${para(38, "b")}\n\n${fig("ratio=3:2")}\n\n${para(36, "c")}\n\n${fig("ratio=3:2")}\n\n${para(200, "d")}`;
    const { doc } = resolve(parse(FM + GRID + flow(story)).ast as Document, { assets: fake });
    const pd = layout(doc, { width: 1280, height: 800 }, new PrepareCache(createFixedEngine()));
    layoutInvariants(doc, pd, { standoff: false });
    const ls = lines(pd);
    const top = Math.min(...ls.map((l) => l.y));
    const [a, b, c] = pd.scenes[0]!.objects.filter((o) => o.name.startsWith("figure"));
    expect(a!.box.y).toBeLessThanOrEqual(top + 1e-3);
    // The others stay inline at their anchors, far below the top.
    for (const o of [b!, c!]) {
      expect(o.box.y).toBeGreaterThan(top + 688);
      expect(Math.abs(o.box.y - o.anchoredAt!)).toBeLessThanOrEqual(2 * 28);
    }
  });
});
