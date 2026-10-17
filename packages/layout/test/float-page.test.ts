/**
 * Picture composition in screen pages (docs/superpowers/specs/2026-10-17-picture-composition-design.md,
 * "How the engine chooses"): a floating object goes to the best spot on its screen, the screen before
 * or the screen after; `place=here`, the fallback and the budget keep today's placement.
 */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { type AssetHost, resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout, type PositionedDocument, type PositionedObject } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const GRID = "\\grid[name=page, cols=12, gutter=24px, margin-x=48px, margin-y=2bl, baseline=28px, body=1-12]\n";
const VIEW = { width: 1280, height: 800 };
const fake: AssetHost = {
  image: (path) => ({ url: path, type: "image/jpeg", width: 800, height: 600, animated: false }),
  contour: () => null,
  file: (path) => ({ url: path, type: "video/mp4" }),
};

/** `n` sentences, numbered so that every paragraph's words differ. */
const para = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays.`).join(" ");
const fig = (attrs: string): string => `\\figure[src=/a.jpg, alt="A picture", ${attrs}]`;
const page = (story: string): string => `\\story[name=s]{${story}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`;

function lay(src: string, viewport = VIEW, opts?: { composeBudget?: number }) {
  const { doc } = resolve(parse(FM + GRID + src).ast as Document, { assets: fake });
  const pd = layout(doc, viewport, new PrepareCache(createFixedEngine()), opts);
  layoutInvariants(doc, pd, { standoff: false });
  return { doc, pd };
}

const objects = (pd: PositionedDocument): PositionedObject[] => pd.scenes.flatMap((s) => s.objects).filter((o) => o.name.startsWith("figure") || o.name.startsWith("gallery"));
const screenOf = (pd: PositionedDocument, y: number): number => Math.floor(y / pd.viewport.height);
/** Each column's left edge and width, from the story's lines. */
function columnsOf(pd: PositionedDocument): { x: number; width: number }[] {
  const lines = pd.scenes[0]!.lines.filter((l) => l.story === "s");
  return [0, 1, 2].map((c) => {
    const ls = lines.filter((l) => l.column === c);
    const x = Math.min(...ls.map((l) => l.x));
    return { x, width: Math.max(...ls.map((l) => l.x + l.width)) - x };
  });
}
/** The first grid line at or below a screen's band top: the residue of a snapped baseline on that screen. */
function firstGridLine(pd: PositionedDocument, screen: number): number {
  const top = screen * pd.viewport.height + 56;
  const l = pd.scenes[0]!.lines.find((x) => x.story === "s" && x.snapped && screenOf(pd, x.y) === screen)!;
  const bl = pd.scenes[0]!.grid.baseline;
  return top + ((((l.baseline - top) % bl) + bl) % bl);
}

describe("floating in screen pages", () => {
  it("a hero takes the top band", () => {
    const { pd } = lay(page(`${para(70, "a")}\n\n${fig("size=hero, ratio=3:1")}\n\n${para(40, "b")}\n\n${para(40, "c")}`));
    const [o] = objects(pd);
    const cols = columnsOf(pd);
    expect(o!.box.x).toBeCloseTo(cols[0]!.x, 3);
    expect(o!.box.x + o!.box.width).toBeCloseTo(cols[2]!.x + cols[2]!.width, 3);
    expect(o!.box.y).toBeCloseTo(firstGridLine(pd, screenOf(pd, o!.box.y)), 3);
  });

  it("a wide picture spans columns", () => {
    const { pd } = lay(page(`${para(70, "a")}\n\n${fig("size=wide, ratio=3:2")}\n\n${para(40, "b")}\n\n${para(40, "c")}`));
    const [o] = objects(pd);
    const cols = columnsOf(pd);
    const two = cols[1]!.x + cols[1]!.width - cols[0]!.x;
    const three = cols[2]!.x + cols[2]!.width - cols[0]!.x;
    expect([two, three].some((w) => Math.abs(o!.box.width - w) < 1e-3)).toBe(true);
  });

  it("place=here stays at the anchor", () => {
    const src = page(`${para(30, "a")}\n\n${fig("place=here, ratio=3:2")}\n\n${para(60, "b")}\n\n${fig("place=here, ratio=4:3")}\n\n${para(40, "c")}`);
    const boxes = (pd: PositionedDocument) => objects(pd).map((o) => [o.name, o.box]);
    expect(boxes(lay(src).pd)).toEqual(boxes(lay(src, VIEW, { composeBudget: 0 }).pd));
  });

  it("place=screen gets a screen of its own", () => {
    const { pd } = lay(page(`${para(70, "a")}\n\n${fig("place=screen, ratio=3:2")}\n\n${para(40, "b")}\n\n${para(40, "c")}`));
    const [o] = objects(pd);
    const k = screenOf(pd, o!.box.y);
    expect(pd.scenes[0]!.lines.filter((l) => l.story === "s" && screenOf(pd, l.y) === k)).toEqual([]);
  });

  it("a picture may come before its text", () => {
    // Screen 1's third column ends early at a column break; the picture is anchored in the first
    // lines of screen 2, and the free foot of screen 1 is the cheaper spot.
    const { pd } = lay(page(`${para(40, "a")}\n\n${para(6, "b")}\n\n\\framebreak[column]\n\n${para(3, "c")}\n\n${fig("size=column, ratio=4:3")}\n\n${para(60, "d")}`));
    const [o] = objects(pd);
    expect(o!.anchoredAt).not.toBeNull();
    expect(screenOf(pd, o!.box.y)).toBe(screenOf(pd, o!.anchoredAt!) - 1);
  });

  it("the fallback sets every word", () => {
    const { pd } = lay(page(`${para(30, "a")}\n\n${fig("ratio=3:2")}\n\n${para(30, "b")}\n\n${fig("ratio=2:3")}\n\n${para(30, "c")}\n\n${fig("ratio=16:9")}\n\n${para(30, "d")}`), VIEW, { composeBudget: 0 });
    expect(objects(pd)).toHaveLength(3);
  });

  it("same input, same page", () => {
    const src = page(`${para(30, "a")}\n\n${fig("ratio=3:2")}\n\n${para(30, "b")}\n\n${fig("size=hero, ratio=3:1")}\n\n${para(30, "c")}\n\n${fig("ratio=16:9")}\n\n${para(30, "d")}`);
    expect(lay(src).pd).toEqual(lay(src).pd);
  });

  it("a float too tall for every spot is still set", () => {
    const { pd } = lay(page(`${para(30, "a")}\n\n\\gallery[per-row=1, ratio=9:16]{\n${fig("ratio=9:16")}\n}\n\n${para(60, "b")}`), { width: 1280, height: 600 });
    expect(pd.scenes.flatMap((s) => s.objects).filter((o) => o.name.startsWith("gallery"))).toHaveLength(1);
  });

  it("four floats close together: none dropped", () => {
    const four = [1, 2, 3, 4].map(() => fig("ratio=3:2")).join("\n\n");
    const { pd } = lay(page(`${para(50, "a")}\n\n${four}\n\n${para(80, "b")}`));
    const os = objects(pd);
    expect(os).toHaveLength(4);
    for (const o of os) expect(Math.abs(screenOf(pd, o.box.y) - screenOf(pd, o.anchoredAt!))).toBeLessThanOrEqual(1);
  });

  it("a float in the last paragraph", () => {
    const { pd } = lay(page(`${para(60, "a")}\n\n${para(10, "b")}\n\n${fig("ratio=3:2")}\n\n${para(8, "c")}`));
    const lines = pd.scenes[0]!.lines.filter((l) => l.story === "s");
    const last = screenOf(pd, lines.at(-1)!.y);
    const [o] = objects(pd);
    expect(screenOf(pd, o!.box.y)).toBe(last);
    const onLast = lines.filter((l) => screenOf(pd, l.y) === last);
    for (const b of new Set(onLast.map((l) => l.block))) expect(new Set(onLast.filter((l) => l.block === b).map((l) => l.column)).size, `block ${b}`).toBe(1);
  });

  it("a float stays in its anchor's frame", () => {
    const src =
      `\\story[name=s]{${para(60, "a")}\n\n${fig("ratio=3:2")}\n\n\\framebreak\n\n${para(60, "b")}}\n` +
      "\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}";
    const { pd } = lay(src);
    expect(objects({ ...pd, scenes: [pd.scenes[0]!] })).toHaveLength(1);
  });
});
