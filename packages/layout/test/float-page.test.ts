/**
 * Picture composition in screen pages (docs/superpowers/specs/2026-10-17-picture-composition-design.md,
 * "How the engine chooses"): a floating object goes to the best spot on its screen, the screen before
 * or the screen after; `place=here`, the fallback and the budget keep today's placement.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { type AssetHost, resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout, type PositionedDocument, type PositionedObject } from "../src/index.js";
import { columnHoles, layoutInvariants, windowBreaks } from "./invariants.js";

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
/** The screen of an object's real anchor: the last line of its story set before its block. */
function anchorScreen(doc: ReturnType<typeof resolve>["doc"], pd: PositionedDocument, o: PositionedObject): number {
  const p = doc.variants[pd.breakpoint]!.objects[o.name]!.placement;
  const block = p.mode === "anchored" ? p.block : -1;
  const before = pd.scenes[0]!.lines.filter((l) => l.story === "s" && l.block < block).at(-1)!;
  return screenOf(pd, before.y);
}
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

  it("seven floats close together: each within a screen of its anchor", () => {
    const seven = Array.from({ length: 7 }, () => fig("ratio=3:2")).join("\n\n");
    const { doc, pd } = lay(page(`${para(62, "a")}\n\n${seven}\n\n${para(80, "b")}`));
    const os = objects(pd);
    expect(os).toHaveLength(7);
    for (const o of os) expect(Math.abs(screenOf(pd, o.box.y) - anchorScreen(doc, pd, o)), o.name).toBeLessThanOrEqual(1);
  });

  it("a hero on a wide screen keeps within 85% of the band", () => {
    // Wide screens: what sits on the grid's outer edge reaches into the margin (outdent), so a box on
    // both edges is wider, and taller, than its columns.
    // One hero spot, across every column: on both edges.
    const src = `\\grid[name=page, at=wide, margin-x=200px, outdent=50%]\n\\spot[size=hero, place=top, span=all]\n${page(`${para(70, "a")}\n\n${fig("size=hero, ratio=2:1")}\n\n${para(80, "b")}\n\n${para(80, "c")}`)}`;
    const view = { width: 1920, height: 1080 };
    const { pd } = lay(src, view);
    const [o] = objects(pd);
    expect(o!.box.width).toBeGreaterThan(pd.scenes[0]!.grid.content + pd.scenes[0]!.grid.outdent + 1); // both outdents apply
    expect(o!.box.height).toBeLessThanOrEqual(0.85 * (1080 - 2 * 56) + 1e-6);
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
    // Seven pictures just before the break: some are still to place when the frame's text ends.
    const seven = Array.from({ length: 7 }, () => fig("ratio=3:2")).join("\n\n");
    const src =
      `\\story[name=s]{${para(62, "a")}\n\n${seven}\n\n\\framebreak\n\n${para(60, "b")}}\n` +
      "\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}";
    const { pd } = lay(src);
    expect(objects({ ...pd, scenes: [pd.scenes[0]!] })).toHaveLength(7);
    expect(pd.scenes[0]!.lines.filter((l) => /Stone b\d/.test(l.text))).toEqual([]);
    expect(pd.scenes[1]!.lines.some((l) => /Stone b\d/.test(l.text))).toBe(true);
  });

  it("a frame not set in bands keeps every object at its text's end", () => {
    // A frame of fixed height in a scrolling scene: objects still waiting at its last column's end are
    // set there, even past its foot; none is dropped.
    const side = fig("side=left, width=50%, place=here");
    const { pd } = lay(`\\story[name=s]{${para(3, "a")}\n\n${[side, side, side].join("\n\n")}\n\n${para(1, "b")}}\n\\scene[grid=page]{\\frame[story=s, cols=1-12, columns=2, height=300px]}`);
    expect(objects(pd)).toHaveLength(3);
  });

  it("a subhead never ends a column beside a floating box", () => {
    // stress-salt at 2560x1440 (2026-10-17): on the balanced last page of a scene, a wide box over two
    // columns left the subhead "The first rain" at a column's foot and its paragraph in the next.
    const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
    const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("playground/docs") });
    const { doc } = resolve(parse(readFileSync(here("playground/docs/stress-salt.wmx"), "utf8")).ast as Document, { assets });
    const pd = layout(doc, { width: 2560, height: 1440 }, new PrepareCache(createFixedEngine()));
    layoutInvariants(doc, pd, { standoff: false });
    const v = doc.variants[pd.breakpoint]!;
    for (const s of pd.scenes) {
      const lines = s.lines.filter((l) => v.frames[l.frame]);
      for (const [i, l] of lines.entries()) {
        const n = lines[i + 1];
        if (n && n.frame === l.frame && v.styles[l.style]?.keepWithNext && n.block !== l.block) expect(n.column, `"${l.text}" ends a column`).toBe(l.column);
      }
    }
  });

  it("a screen tries at most its budget of trial layouts", () => {
    // Ten pictures before a frame break: screens where no combination keeps the rules retry with
    // fewer competitors and then all waiting; every try counts against the one budget of the screen.
    const ten = Array.from({ length: 10 }, () => fig("ratio=3:2")).join("\n\n");
    const src =
      `\\story[name=s]{${para(50, "a")}\n\n${ten}\n\n\\framebreak\n\n${para(60, "b")}}\n` +
      "\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}";
    for (const budget of [5, 40]) {
      const trials: number[] = [];
      const { doc } = resolve(parse(FM + GRID + src).ast as Document, { assets: fake });
      const pd = layout(doc, VIEW, new PrepareCache(createFixedEngine()), { composeBudget: budget, onCompose: (_, n) => trials.push(n) });
      layoutInvariants(doc, pd, { standoff: false });
      expect(trials.length, `budget ${budget}`).toBeGreaterThan(0);
      expect(Math.max(...trials), `budget ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it("the screen report names exactly the floating objects set two screens or more from their anchor (copyfitting)", () => {
    const ten = Array.from({ length: 10 }, () => fig("size=wide, ratio=3:2")).join("\n\n");
    const { doc, pd } = lay(`\\story[name=s]{${para(50, "a")}\n\n${ten}\n\n\\framebreak\n\n${para(60, "b")}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`);
    const objects = doc.variants[pd.breakpoint]!.objects;
    const floats = (name: string): boolean => {
      const o = objects[name];
      return !!o && !o.hidden && o.placement.mode === "anchored" && o.placement.place !== "here" && o.placement.horizontal.mode !== "cols";
    };
    for (const s of pd.scenes) {
      const expected = s.objects
        .filter((o) => floats(o.name) && o.anchoredAt !== null && screenOf(pd, o.box.y) - screenOf(pd, o.anchoredAt) >= 2)
        .map((o) => `${o.name}@${screenOf(pd, o.box.y) + 1}:${screenOf(pd, o.box.y) - screenOf(pd, o.anchoredAt!)}`)
        .sort();
      const got = (s.screens ?? []).flatMap((r) => r.far.map((f) => `${f.object}@${r.screen}:${f.screens}`)).sort();
      expect(got, s.name).toEqual(expected);
    }
    expect(pd.scenes[0]!.screens!.some((r) => r.far.length > 0)).toBe(true);
  });

  it("the window yields only to overflow", () => {
    // Seven pictures anchored together on screen 2: three on screen 2, four on screen 3.
    const seven = Array.from({ length: 7 }, () => fig("ratio=3:2")).join("\n\n");
    const { doc, pd } = lay(page(`${para(62, "a")}\n\n${seven}\n\n${para(80, "b")}`));
    const moved = (shift: Record<string, number>): PositionedDocument => {
      const copy = structuredClone(pd);
      for (const o of copy.scenes[0]!.objects) if (shift[o.name]) o.box.y += shift[o.name]! * copy.viewport.height;
      return copy;
    };
    const s = (name: string) => screenOf(pd, objects(pd).find((o) => o.name === name)!.box.y);
    expect(windowBreaks(doc, pd)).toEqual([]);
    // Figure 7 a screen later: every screen from its anchor's on holds an earlier picture, so it may.
    expect([s("figure-1"), s("figure-4"), s("figure-7")]).toEqual([1, 2, 2]);
    expect(windowBreaks(doc, moved({ "figure-7": 1 }))).toEqual([]);
    // With figures 4 to 6 moved back to screen 2, screen 3 holds no earlier picture: no excuse.
    expect(windowBreaks(doc, moved({ "figure-7": 1, "figure-4": -1, "figure-5": -1, "figure-6": -1 }))).toEqual(["figure-7 window: screen 4, anchor on 2"]);
    // Two screens on, past the last screen an earlier picture fills: no excuse.
    expect(windowBreaks(doc, moved({ "figure-7": 2 }))).toEqual(["figure-7 window: screen 5, anchor on 2"]);
    // The anchor's own screen does not count: empty, with the screen after it full, figure 7 may.
    expect(windowBreaks(doc, moved({ "figure-7": 1, "figure-1": 1, "figure-2": 1, "figure-3": 1 }))).toEqual([]);
    // A screen after the anchor's with no earlier picture: reported.
    expect(windowBreaks(doc, moved({ "figure-7": 1, "figure-4": -1, "figure-5": -1, "figure-6": -1 }))).toEqual(["figure-7 window: screen 4, anchor on 2"]);
  });

  /** stress-portraits page 1 at one size: whether it holds a picture, and how far apart its columns end (boxes counted). */
  function portraitsPage1(width: number, height: number): { pictures: number; apart: number; limit: number } {
    const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
    const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("playground/docs") });
    const { doc } = resolve(parse(readFileSync(here("playground/docs/stress-portraits.wmx"), "utf8")).ast as Document, { assets });
    const pd = layout(doc, { width, height }, new PrepareCache(createFixedEngine()));
    layoutInvariants(doc, pd, { standoff: false });
    const s = pd.scenes[0]!;
    const pictures = s.objects.filter((o) => doc.variants[pd.breakpoint]!.objects[o.name]?.placement.mode !== "contained" && screenOf(pd, o.box.y) === 0);
    const lines = s.lines.filter((l) => l.story === "nine" && screenOf(pd, l.y) === 0);
    const feet = [...new Set(lines.map((l) => l.column))].map((c) => {
      const own = lines.filter((l) => l.column === c);
      const [left, right] = [Math.min(...own.map((l) => l.x)), Math.max(...own.map((l) => l.x + l.width))];
      const boxes = pictures.filter((o) => o.box.x < right - 1 && left < o.box.x + o.box.width - 1);
      return Math.max(...own.map((l) => l.y + l.height), ...boxes.map((o) => o.box.y + o.box.height));
    });
    return { pictures: pictures.length, apart: Math.max(...feet) - Math.min(...feet), limit: 2 * s.grid.baseline + 1 };
  }

  // 2026-10-17 (stress-portraits page 1): the text ends on page 1 with pictures still to come, so
  // rule 3 sets the band shorter. Scored on the full band, a picture at its foot stood up to 330px
  // below the text beside it; refusing such settings left page 1 no picture at all. Each trial is now
  // scored on the band as rule 3 sets it: page 1 keeps a picture, and its columns end level, where
  // their text or a box at their foot does.
  it.each([[1440, 900], [1600, 900], [1799, 1000], [1800, 1000]] as const)("a page rule 3 sets shorter keeps a picture and level columns (stress-portraits at %ix%i)", (width, height) => {
    const p = portraitsPage1(width, height);
    expect(p.pictures, "page 1 holds a picture").toBeGreaterThan(0);
    expect(p.apart, "columns of page 1 end apart").toBeLessThanOrEqual(p.limit);
  });

  // 2026-10-17: at 1920x1080 no setting with a picture lets the text go on (each leaves one or two
  // lines alone by a box, rule 13), so every picture waits and the text ends on page 1: the text's
  // last page. It is balanced by whole blocks, as the story's end is: each paragraph in one column,
  // the columns filled from the left at the smallest height; the pictures follow, within their window.
  it("the text's last page, every picture waiting, is balanced by whole blocks (stress-portraits at 1920x1080)", () => {
    const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
    const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("playground/docs") });
    const { doc } = resolve(parse(readFileSync(here("playground/docs/stress-portraits.wmx"), "utf8")).ast as Document, { assets });
    const pd = layout(doc, { width: 1920, height: 1080 }, new PrepareCache(createFixedEngine()));
    layoutInvariants(doc, pd, { standoff: false });
    expect(windowBreaks(doc, pd)).toEqual([]);
    const s = pd.scenes[0]!;
    const text = s.lines.filter((l) => l.story === "nine");
    expect(text.every((l) => screenOf(pd, l.y) === 0), "the text ends on page 1").toBe(true);
    // Each paragraph in one column.
    for (const b of new Set(text.map((l) => l.block))) expect(new Set(text.filter((l) => l.block === b).map((l) => l.column)).size, `block ${b}`).toBe(1);
    // Filled from the left at the smallest height: a column's first paragraph would not fit at the
    // foot of the column before it within the tallest column.
    const cols = [...new Set(text.map((l) => l.column))].sort((a, b) => a - b);
    expect(cols.length).toBeGreaterThan(1);
    const foot = (c: number) => Math.max(...text.filter((l) => l.column === c).map((l) => l.y + l.height));
    const tallest = Math.max(...cols.map(foot));
    for (const [i, c] of cols.entries()) {
      if (i === 0) continue;
      const first = text.filter((l) => l.column === c && l.block === text.find((x) => x.column === c)!.block);
      const height = first.at(-1)!.y + first.at(-1)!.height - first[0]!.y;
      expect(foot(cols[i - 1]!) + height, `column ${c}'s first paragraph fits in column ${cols[i - 1]}`).toBeGreaterThan(tallest + 1);
    }
  });

  // 2026-10-21: the all-wait setting was never laid out (the search gave it up before the first
  // layout), so figure-1 fell back to its anchor's screen (y 374.6, screen 1) and not to the next one.
  it.skipIf(!existsSync(fileURLToPath(new URL("../../playground/docs/stress-portraits.wmx", import.meta.url))))("the all-wait setting competes on a screen (stress-portraits at 1920x1080)", () => {
    const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
    const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("playground/docs") });
    const { doc } = resolve(parse(readFileSync(here("playground/docs/stress-portraits.wmx"), "utf8")).ast as Document, { assets });
    const pd = layout(doc, { width: 1920, height: 1080 }, new PrepareCache(createFixedEngine()));
    const o = pd.scenes.flatMap((s) => s.objects).find((x) => x.name === "figure-1")!;
    expect(screenOf(pd, o.box.y)).toBe(1);
  });

  it("a trial's rule-3 cut search sets at most seven layouts", () => {
    // 2026-10-17: the budget counts combinations; each trial's cut search is bounded as the levelling
    // search is, six lines at most, so a trial is its own layout and up to six cuts.
    const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
    const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("playground/docs") });
    const { doc } = resolve(parse(readFileSync(here("playground/docs/stress-portraits.wmx"), "utf8")).ast as Document, { assets });
    for (const [width, height] of [[1440, 900], [1799, 1000], [1920, 1080]] as const) {
      const layouts: number[] = [];
      layout(doc, { width, height }, new PrepareCache(createFixedEngine()), { onCut: (_, n) => layouts.push(n) });
      expect(layouts.some((n) => n > 1), `${width}: some trial cut`).toBe(true);
      expect(Math.max(...layouts), `${width}`).toBeLessThanOrEqual(7);
    }
  });

  // 2026-10-20 (vanilla-spread at 1470x956): the fact box, a portrait box, floated at a column's top
  // narrowed to the column's right, and the strip left of it was too narrow for body text: the
  // subhead "After" stood there alone above some ten empty lines. A box in a band leaves room for a
  // line of body text beside it (min-slot) or takes the column's width; and empty room inside a
  // column costs (PENALTY.gap). Character widths of 0.45em set the page as the browser's fonts did.
  it.each([0.45, 0.5])("no empty room inside a column (vanilla-spread at 1470x956, characters %fem)", (em) => {
    const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
    const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("playground/docs") });
    const { doc } = resolve(parse(readFileSync(here("playground/docs/vanilla-spread.wmx"), "utf8")).ast as Document, { assets });
    const pd = layout(doc, { width: 1470, height: 956 }, new PrepareCache(createFixedEngine(em)));
    layoutInvariants(doc, pd, { standoff: false });
    expect(columnHoles(doc, pd, pd.scenes[0]!.grid.baseline)).toEqual([]);
  });

  /** test-spread at 1470x956, characters `em` wide (0.45 to 0.47 set it as the browser's fonts did). */
  function testSpread(em: number) {
    const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
    const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("playground/docs") });
    const { doc } = resolve(parse(readFileSync(here("playground/docs/test-spread.wmx"), "utf8")).ast as Document, { assets });
    const pd = layout(doc, { width: 1470, height: 956 }, new PrepareCache(createFixedEngine(em)));
    layoutInvariants(doc, pd, { standoff: false });
    return { doc, pd };
  }

  // 2026-10-20 (test-spread at 1470x956): the story's last three lines had a screen of their own.
  // The page before was full of floating pictures, so the stub could not fold back into it. That
  // page is now set again with a picture moved on to the next page, inside its window.
  it.each([0.45, 0.46, 0.47, 0.5])("no screen holds three lines or fewer and nothing else (test-spread at 1470x956, characters %fem)", (em) => {
    const { doc, pd } = testSpread(em);
    const v = doc.variants[pd.breakpoint]!;
    for (const s of pd.scenes.filter((s) => s.paged))
      for (let k = 0; k < Math.round(s.height / pd.viewport.height); k++) {
        const on = (y: number) => Math.floor((y - s.y + 1e-6) / pd.viewport.height) === k;
        const lines = s.lines.filter((l) => v.frames[l.frame] && on(l.y));
        if (s.objects.some((o) => on(o.box.y))) continue;
        expect(lines.length === 0 || lines.length > 3, `${s.name} screen ${k + 1}: ${lines.length} lines alone`).toBe(true);
      }
  });

  // 2026-10-21 (test-spread at 1470x956, characters 0.42 to 0.46em): on the text's last page a pull
  // quote at the foot stood 47 to 103px below the balanced columns. The last page is no exception: a
  // box at the foot rises with the balanced columns.
  it.each([0.42, 0.44, 0.46, 0.47])("no page holds a hole taller than a line, the last included (test-spread at 1470x956, characters %fem)", (em) => {
    const { doc, pd } = testSpread(em);
    expect(columnHoles(doc, pd, pd.scenes[0]!.grid.baseline, { last: true })).toEqual([]);
  });

  // 2026-10-20 (test-spread at 1470x956, the screen with the gallery): the gallery and the pull quote
  // stood at the foot, and the text above them stopped up to four lines short. Counted by its boxes
  // every column ended level, so the screen was scored and kept as level. Empty room above a box now
  // costs (PENALTY.gap), on the band as it is balanced too: on every page but the last, each column
  // ends level, and its text reaches a box under it, within rule 11's two lines.
  it.each([0.42, 0.45, 0.47, 0.5])("every page but the last ends level, its text down to the boxes (test-spread at 1470x956, characters %fem)", (em) => {
    const { doc, pd } = testSpread(em);
    const v = doc.variants[pd.breakpoint]!;
    const limit = 2 * pd.scenes[0]!.grid.baseline + 1;
    expect(columnHoles(doc, pd, limit, { last: false })).toEqual([]);
    for (const s of pd.scenes.filter((s) => s.paged)) {
      const screen = (y: number) => Math.floor((y - s.y + 1e-6) / pd.viewport.height);
      const own = s.objects.filter((o) => v.objects[o.name]?.placement.mode !== "contained");
      for (const frame of new Set(s.lines.filter((l) => v.frames[l.frame]).map((l) => l.frame))) {
        const lines = s.lines.filter((l) => l.frame === frame);
        if (new Set(lines.map((l) => l.column)).size < 2) continue;
        for (let k = 0; k < Math.max(...lines.map((l) => screen(l.y))); k++) {
          const on = lines.filter((l) => screen(l.y) === k);
          const feet = [...new Set(on.map((l) => l.column))].map((c) => {
            const col = on.filter((l) => l.column === c);
            const [left, right] = [Math.min(...col.map((l) => l.x)), Math.max(...col.map((l) => l.x + l.width))];
            const boxes = own.filter((o) => screen(o.box.y) === k && o.box.x < right - 1 && left < o.box.x + o.box.width - 1);
            return Math.max(...col.map((l) => l.y + l.height), ...boxes.map((o) => o.box.y + o.box.height));
          });
          expect(Math.max(...feet) - Math.min(...feet), `${s.name} screen ${k + 1}`).toBeLessThanOrEqual(limit);
        }
      }
    }
  });
});

describe("size=small", () => {
  it("sets the box at half the column, with text beside it", () => {
    // Two columns: at three, the strip beside half a column is too narrow for body text and stays empty.
    const { pd } = lay(page(`${para(6, "a")}\n\n${fig("size=small, ratio=3:2")}\n\n${para(20, "b")}`).replace("columns=3", "columns=2"));
    const o = objects(pd)[0]!;
    const col = columnsOf(pd).find((c) => o.box.x >= c.x - 1 && o.box.x < c.x + c.width)!;
    expect(o.box.width).toBeCloseTo(col.width / 2, 0);
    const beside = pd.scenes[0]!.lines.filter((l) => l.story === "s" && l.y < o.box.y + o.box.height && l.y + l.height > o.box.y && l.x < col.x + col.width && l.x + l.width > col.x);
    expect(beside.length).toBeGreaterThan(0);
    for (const l of beside) expect(l.x >= o.box.x + o.box.width - 1e-3 || l.x + l.width <= o.box.x + 1e-3).toBe(true);
  });
});
