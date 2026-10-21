/** The visor's reasons log (design 2026-10-21): why each column ends. */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { type AssetHost, resolve } from "@wmxdsl/resolver";
import type { ResolvedDocument } from "@wmxdsl/resolved-document";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { COLUMN_END_REASONS, LINE_REASONS, PICTURE_REASONS, SPACE_REASONS, type Decision, type PositionedDocument, layout } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const GRID = "\\grid[name=page, cols=12, gutter=24px, margin-x=48px, margin-y=2bl, baseline=28px, body=1-12]\n";
const VIEW = { width: 1280, height: 800 };
const fake: AssetHost = {
  image: (path) => ({ url: path, type: "image/jpeg", width: 800, height: 600, animated: false }),
  contour: () => null,
  file: (path) => ({ url: path, type: "video/mp4" }),
};
const LONG = "Stone endures where nearly everything else decays. ".repeat(100).trim();
/** `n` sentences, numbered so that every paragraph's words differ. */
const para = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays.`).join(" ");
const fig = (attrs: string): string => `\\figure[src=/a.jpg, alt="A picture", ${attrs}]`;
const page = (story: string): string => `\\story[name=s]{${story}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`;

const doc = (src: string): ResolvedDocument => resolve(parse(FM + GRID + src).ast as Document, { assets: fake }).doc;
function lay(src: string, viewport = VIEW, opts: { explain?: boolean; composeBudget?: number } = { explain: true }): PositionedDocument {
  return layout(doc(src), viewport, new PrepareCache(createFixedEngine()), opts);
}
const ends = (pd: PositionedDocument): Decision[] => pd.explain!.scenes.flatMap((s) => s.decisions.filter((d) => d.kind === "column-end"));
const reasons = (pd: PositionedDocument): string[] => ends(pd).map((d) => d.reason);
const one = (pd: PositionedDocument, reason: string): Decision => {
  const d = ends(pd).find((x) => x.reason === reason);
  expect(d, `no ${reason} in ${reasons(pd).join(", ")}`).toBeDefined();
  return d!;
};
/** Every (screen, frame, column) of a scene's frame text that holds lines. */
function columnsWithLines(rd: ResolvedDocument, pd: PositionedDocument): string[] {
  const v = rd.variants[pd.breakpoint]!;
  return pd.scenes.flatMap((s) => [
    ...new Set(s.lines.filter((l) => v.frames[l.frame]).map((l) => `${s.paged ? Math.floor((l.y + 1e-6) / pd.viewport.height) + 1 : null}|${l.frame}|${l.column}`)),
  ]);
}
const keyOf = (d: Decision): string => `${d.screen}|${d.frame}|${d.column}`;

const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const SPREAD = here("playground/docs/test-spread.wmx");

describe("the reasons log", () => {
  it("lists every column-end code", () => {
    expect(COLUMN_END_REASONS).toEqual(["bottom-line", "levelled", "rule-3-cut", "keep-with-next", "orphans", "widows", "hyphen-avoided", "frame-break", "column-break", "story-end", "balanced-last-page", "stub-folded", "picture-at-foot"]);
  });

  const hand = [
    page(LONG),
    page(`${para(40, "a")}\n\n${fig("size=column, ratio=4:3")}\n\n${para(30, "b")}\n\n\\subhead{More}\n\n${para(20, "c")}`),
    `\\story[name=s]{${LONG}}\n\\scene{\\frame[story=s, cols=1-12, columns=2]}`,
  ];
  it.each(hand.map((src, i) => [i, src]))("off by default and identical when on (document %i)", (_, src) => {
    const rd = doc(src as string);
    const off = layout(rd, VIEW, new PrepareCache(createFixedEngine()));
    const on = layout(rd, VIEW, new PrepareCache(createFixedEngine()), { explain: true });
    expect(off.explain).toBeUndefined();
    expect(on.explain?.version).toBe(1);
    delete on.explain;
    expect(on).toEqual(off);
  });

  it.skipIf(!existsSync(SPREAD))("off by default and identical when on (test-spread)", () => {
    const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("playground/docs") });
    const rd = resolve(parse(readFileSync(SPREAD, "utf8")).ast as Document, { assets }).doc;
    const view = { width: 1470, height: 956 };
    const off = layout(rd, view, new PrepareCache(createFixedEngine(0.46)));
    const on = layout(rd, view, new PrepareCache(createFixedEngine(0.46)), { explain: true });
    expect(off.explain).toBeUndefined();
    const keys = ends(on).map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(columnsWithLines(rd, on).sort());
    // Every placed anchored object has exactly one picture decision.
    const v = rd.variants[on.breakpoint]!;
    const anchored = on.scenes.flatMap((s) => s.objects.filter((o) => v.objects[o.name]?.placement.mode === "anchored").map((o) => o.name));
    const pics = on.explain!.scenes.flatMap((s) => s.decisions.filter((d) => d.kind === "picture").map((d) => d.refs.objects![0]));
    expect(pics.sort()).toEqual(anchored.sort());
    delete on.explain;
    expect(on).toEqual(off);
  });

  it("one column-end per column per screen", () => {
    const src = page(LONG + " " + LONG.slice(0, 2000));
    const rd = doc(src);
    const pd = layout(rd, VIEW, new PrepareCache(createFixedEngine()), { explain: true });
    expect(pd.scenes[0]!.height / 800).toBeGreaterThanOrEqual(3);
    const keys = ends(pd).map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(columnsWithLines(rd, pd).sort());
    for (const d of ends(pd)) expect(COLUMN_END_REASONS).toContain(d.reason);
  });
});

describe("column-end reasons", () => {
  it("bottom-line: a full column", () => {
    const d = one(lay(page(LONG)), "bottom-line");
    expect(d).toMatchObject({ kind: "column-end", screen: 1, frame: expect.any(String), column: 0, rule: expect.stringContaining("§09.7") });
  });

  it("story-end: where the text ends", () => {
    const pd = lay(page(LONG));
    const d = ends(pd).at(-1)!;
    expect(d.reason).toBe("story-end");
    expect(d.numbers).toEqual({});
  });

  it("levelled: set lines short so the columns end on one line", () => {
    const words = LONG.split(" ");
    const blocks = Array.from({ length: 40 }, (_, i) => (i % 5 === 4 ? `\\subhead{Part ${i}}` : words.slice(0, 20 + ((i * 37) % 60)).join(" ")));
    const src = `\\style[name=body, space-after=0, indent=1em]\n\\style[name=subhead, leading=1bl, space-before=1bl, space-after=0]\n${page(blocks.join("\n\n"))}`;
    const d = one(lay(src), "levelled");
    expect(d.numbers.lines).toBeGreaterThanOrEqual(1);
    expect(d.rule).toBe("§09.7 rule 11");
  });

  it("keep-with-next: a subhead at a column's foot moves on with its paragraph", () => {
    const d = one(lay(KEEP), "keep-with-next");
    expect(d.rule).toBe("§07.6 keep-with-next");
  });

  it("orphans: a paragraph's first lines move on whole", () => {
    const d = one(lay(ORPHANS), "orphans");
    expect(d.numbers.lines).toBeGreaterThanOrEqual(1);
  });

  it("widows: lines move over with a paragraph's last ones", () => {
    const d = one(lay(WIDOWS), "widows");
    expect(d.numbers.lines).toBeGreaterThanOrEqual(1);
  });

  it("hyphen-avoided: the last column's last line carries its word over whole", () => {
    one(lay(HYPHEN), "hyphen-avoided");
  });

  it("frame-break and column-break: an author's break", () => {
    const frame = lay(`\\story[name=s]{${para(4, "a")}\n\n\\framebreak\n\n${para(4, "b")}}\n\\scene{\\frame[story=s, cols=1-6]}\n\\scene{\\frame[story=s, cols=1-6]}`);
    expect(one(frame, "frame-break")).toMatchObject({ screen: null, column: 0 });
    const column = lay(page(`${para(6, "a")}\n\n\\framebreak[column]\n\n${para(60, "b")}`));
    expect(one(column, "column-break")).toMatchObject({ screen: 1, column: 0 });
  });

  it("balanced-last-page: whole paragraphs at the smallest height", () => {
    const pd = lay(page(Array.from({ length: 14 }, (_, i) => para(6, `p${i}`)).join("\n\n")));
    const d = one(pd, "balanced-last-page");
    expect(d.numbers.height).toBeGreaterThan(0);
    expect(d.rule).toBe("§09.4");
  });

  it("stub-folded: a short last page folds back into the one before", () => {
    one(lay(STUB), "stub-folded");
  });

  it("picture-at-foot: a picture leaving a line or two under it ends the column", () => {
    const d = one(lay(FOOT, VIEW, { explain: true, composeBudget: 0 }), "picture-at-foot");
    expect(d).toMatchObject({ column: 0, rule: "§09.7 rule 13", refs: { objects: [expect.stringMatching(/^figure/)] } });
  });

  it("rule-3-cut: a page with a waiting picture and little text left is set shorter", () => {
    const d = one(lay(RULE3, VIEW, { explain: true, composeBudget: 0 }), "rule-3-cut");
    expect(d.numbers.lines).toBeGreaterThanOrEqual(1);
  });
});

describe("only kept settings record", () => {
  it("trials do not record", () => {
    const figs = Array.from({ length: 5 }, (_, i) => `${para(12, `t${i}`)}\n\n${fig(`size=column, ratio=4:3`)}`).join("\n\n");
    const src = page(`${figs}\n\n${para(30, "z")}`);
    const rd = doc(src);
    const pd = layout(rd, VIEW, new PrepareCache(createFixedEngine()), { explain: true });
    expect(ends(pd).length).toBe(columnsWithLines(rd, pd).length);
  });

  it("rollbacks leave no decisions", () => {
    const pd = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\group[layout=row, valign=center, cols=1-12]{\\frame[story=s, columns=3]}}`);
    const keys = ends(pd).map(keyOf);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("scrolling scenes", () => {
    const two = lay(`\\story[name=s]{${[para(8, "a"), para(8, "b"), para(8, "c")].join("\n\n")}}\n\\scene{\\frame[story=s, cols=1-12, columns=2]}`);
    expect(ends(two).length).toBe(2);
    for (const d of ends(two)) expect(d.screen).toBeNull();
    const phone = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12]}`, { width: 390, height: 800 });
    expect(ends(phone).map((d) => d.reason)).toEqual(["story-end"]);
  });
});

describe("picture reasons", () => {
  const pictures = (pd: PositionedDocument): Decision[] => pd.explain!.scenes.flatMap((s) => s.decisions.filter((d) => d.kind === "picture"));
  const FIVE = page(`${Array.from({ length: 5 }, (_, i) => `${para(12, `p${i}`)}\n\n${fig("size=column, ratio=4:3")}`).join("\n\n")}\n\n${para(30, "z")}`);
  const placed = (pd: PositionedDocument) => pd.scenes.flatMap((s) => s.objects);

  it("lists every picture code", () => {
    expect(PICTURE_REASONS).toEqual(["chosen", "fallback-budget", "fallback-no-spot", "waited", "here"]);
  });

  it("one picture decision per object", () => {
    const pd = lay(FIVE, VIEW, { explain: true, composeBudget: 40 });
    const ds = pictures(pd);
    expect(ds).toHaveLength(5);
    expect(new Set(ds.map((d) => d.refs.objects![0])).size).toBe(5);
    for (const d of ds) {
      const o = placed(pd).find((x) => x.name === d.refs.objects![0])!;
      expect(d.at).toEqual(o.box);
      expect(d.refs.blocks).toHaveLength(1);
      expect(PICTURE_REASONS).toContain(d.reason);
      expect(d.screen).toBeGreaterThanOrEqual(1);
    }
    const scored = ds.filter((d) => d.reason === "chosen" || d.reason === "waited");
    expect(scored.length).toBeGreaterThan(0);
    for (const d of scored) {
      const { distance, order, gaps, crowd, balance, rhythm, score, ownDistance, windowFrom, windowTo } = d.numbers;
      expect(distance! + order! + gaps! + crowd! + balance! + rhythm!).toBe(score);
      // The object's own distance is part of the combination's.
      expect(ownDistance).toBeGreaterThanOrEqual(0);
      expect(ownDistance).toBeLessThanOrEqual(distance!);
      expect(windowFrom).toBeLessThanOrEqual(d.screen!);
      expect(windowTo).toBeGreaterThanOrEqual(d.screen!);
      // The window is the anchor's screen and one either side: waited is the screen after the anchor's.
      expect(d.reason === "waited").toBe(d.screen === windowTo);
      if (d.reason === "waited") expect(ownDistance).toBeGreaterThanOrEqual(6);
    }
  });

  it("fallback is explained", () => {
    const ds = pictures(lay(FIVE, VIEW, { explain: true, composeBudget: 0 }));
    expect(ds.map((d) => d.reason)).toEqual(Array(5).fill("fallback-budget"));
  });

  it("a frame where nothing floats is here, never a fallback", () => {
    const one = `\\story[name=s]{${para(30, "a")}\n\n${fig("size=column, ratio=4:3")}\n\n${para(60, "b")}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12]}`;
    expect(pictures(lay(one, VIEW, { explain: true, composeBudget: 0 })).map((d) => d.reason)).toEqual(["here"]);
  });

  it("here is explained", () => {
    const ds = pictures(lay(page(`${para(30, "a")}\n\n${fig("place=here, ratio=3:2")}\n\n${para(60, "b")}`)));
    expect(ds.map((d) => d.reason)).toEqual(["here"]);
  });

  it("alternatives score no better than the choice", () => {
    const ds = pictures(lay(FIVE, VIEW, { explain: true, composeBudget: 40 })).filter((d) => d.alternatives?.length);
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) {
      expect(d.alternatives!.length).toBeLessThanOrEqual(3);
      expect(new Set(d.alternatives!.map((a) => a.spot)).size).toBe(d.alternatives!.length);
      for (const a of d.alternatives!) {
        expect(a.score).toBeGreaterThanOrEqual(d.numbers.score!);
        expect(a.spot).toMatch(/^(\w+ \w+ cols \d+-\d+|wait)$/);
      }
    }
  });
});

describe("picture reasons, waiting and no spot", () => {
  const pictures = (pd: PositionedDocument): Decision[] => pd.explain!.scenes.flatMap((s) => s.decisions.filter((d) => d.kind === "picture"));
  const FIVE = page(`${Array.from({ length: 5 }, (_, i) => `${para(12, `p${i}`)}\n\n${fig("size=column, ratio=4:3")}`).join("\n\n")}\n\n${para(30, "z")}`);

  it("waited: with a small budget the last two pictures go to the screen after their anchors'", () => {
    const ds = pictures(lay(FIVE, VIEW, { explain: true, composeBudget: 3 }));
    const waited = ds.filter((d) => d.reason === "waited");
    expect(waited.map((d) => [d.refs.objects![0], d.screen])).toEqual([["figure-4", 3], ["figure-5", 3]]);
    for (const d of waited) expect(d.screen).toBe(d.numbers.windowTo);
  });

  it("fallback-no-spot: a scrolling frame's picture anchored more than a screen down", () => {
    const pd = lay(`\\story[name=s]{${para(150, "a")}\n\n${fig("size=column, ratio=4:3")}\n\n${para(20, "b")}}\n\\scene{\\frame[story=s, cols=1-12, columns=3]}`);
    const ds = pictures(pd);
    expect(ds.map((d) => d.reason)).toEqual(["fallback-no-spot"]);
    expect(ds[0]!.screen).toBeNull();
    expect(ds[0]!.rule).toBe("§09.7 rule 6");
  });
});

describe("space reasons", () => {
  const spaces = (pd: PositionedDocument, reason: string): Decision[] => pd.explain!.scenes.flatMap((s) => s.decisions.filter((d) => d.kind === "space" && d.reason === reason));

  it("lists every space and line code", () => {
    expect(SPACE_REASONS).toEqual(["slot-too-narrow", "cropped", "grown", "early-end"]);
    expect(LINE_REASONS).toEqual(["ragged", "hung", "hyphenated", "loose", "tight"]);
  });

  it("slot-too-narrow: the strip beside a side=right picture stays empty", () => {
    const pd = lay(`\\story[name=s]{${para(4, "a")}\n\n${fig("side=right, width=450px, ratio=4:3")}\n\n${para(30, "b")}}\n\\scene{\\frame[story=s, cols=1-6]}`);
    const ds = spaces(pd, "slot-too-narrow");
    // Merged: one strip down the picture's side, not one a line.
    expect(ds).toHaveLength(1);
    const d = ds[0]!;
    const o = pd.scenes[0]!.objects[0]!;
    expect(d.numbers.width).toBeLessThan(d.numbers.min!);
    expect(d.numbers.width).toBeGreaterThan(0);
    expect(d.at.x + d.at.width).toBeLessThanOrEqual(o.box.x + 1e-6);
    expect(d.at.height).toBeGreaterThan(28);
    expect(d).toMatchObject({ screen: null, column: 0, rule: "§09.6 step 3", refs: { objects: [o.name] } });
  });

  it("the strips stay out of the page: identical with explain on and off", () => {
    const rd = doc(`\\story[name=s]{${para(4, "a")}\n\n${fig("side=right, width=450px, ratio=4:3")}\n\n${para(30, "b")}}\n\\scene{\\frame[story=s, cols=1-6]}`);
    const off = layout(rd, VIEW, new PrepareCache(createFixedEngine()));
    const on = layout(rd, VIEW, new PrepareCache(createFixedEngine()), { explain: true });
    expect(on.explain!.scenes[0]!.decisions.some((d) => d.reason === "slot-too-narrow")).toBe(true);
    delete on.explain;
    expect(on).toEqual(off);
  });

  it("grown: rule 12 makes a photograph a line taller so the page ends full", () => {
    const pd = lay(page(`${para(7, "a")}\n\n${fig("size=column, ratio=4:3")}\n\n${para(8, "b")}\n\n${para(30, "c")}`), VIEW, { explain: true, composeBudget: 0 });
    const ds = [...spaces(pd, "grown"), ...spaces(pd, "cropped")];
    expect(ds).toHaveLength(1);
    const o = pd.scenes[0]!.objects[0]!;
    expect(ds[0]).toMatchObject({ reason: "grown", numbers: { px: 28 }, at: o.media, rule: "§09.7 rule 12", refs: { objects: [o.name] }, screen: 1 });
  });

  it("early-end: a screen whose columns all end short of the bottom line", () => {
    const br = "\n\n\\framebreak[column]\n\n";
    const pd = lay(page([para(6, "a"), para(6, "b"), para(6, "c"), para(60, "d")].join(br)));
    const ds = spaces(pd, "early-end");
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ screen: 1, rule: "§09.7 rule 12" });
    expect(ds[0]!.numbers.lines).toBeGreaterThanOrEqual(1);
    // From where the lowest column ends down to the bottom line.
    const low = Math.max(...pd.scenes[0]!.lines.filter((l) => l.y < 800).map((l) => l.y + l.height));
    expect(ds[0]!.at.y).toBeCloseTo(low);
    expect(ds[0]!.at.height).toBeCloseTo(ds[0]!.numbers.lines! * 28);
  });
});

describe("line reasons", () => {
  const notes = (pd: PositionedDocument, reason: string): Decision[] => pd.explain!.scenes.flatMap((s) => s.decisions.filter((d) => d.kind === "line" && d.reason === reason));
  const lineAt = (pd: PositionedDocument, d: Decision) => pd.scenes.flatMap((s) => s.lines).find((l) => l.x === d.at.x && l.y === d.at.y && l.frame === d.frame)!;
  const JUSTIFIED = `\\style[name=body, align=justify]\n${page(LONG)}`;

  it("ragged: a justified paragraph's last line (code 1)", () => {
    const pd = lay(JUSTIFIED);
    const ds = notes(pd, "ragged");
    expect(ds).toHaveLength(1);
    const last = pd.scenes[0]!.lines.at(-1)!;
    expect(ds[0]).toMatchObject({ numbers: { reasonCode: 1 }, at: { x: last.x, y: last.y, width: last.width, height: last.height }, refs: { blocks: [last.block] }, rule: "§07.6 justify" });
  });

  it("ragged: a line narrower than justify-min (code 2)", () => {
    const pd = lay(`\\style[name=body, align=justify, justify-min=2000px]\n${page(LONG)}`);
    const ds = notes(pd, "ragged");
    expect(ds).toHaveLength(pd.scenes[0]!.lines.length);
    expect(ds.filter((d) => d.numbers.reasonCode === 2)).toHaveLength(ds.length - 1);
    expect(notes(pd, "loose")).toEqual([]);
  });

  it("ragged: a paragraph threaded on to the next scene ends each scene ragged, as the renderer draws it", () => {
    const src = `\\style[name=body, align=justify]\n\\story[name=s]{${para(12, "a")}}\n\\scene{\\frame[story=s, cols=1-6, height=3bl]}\n\\scene{\\frame[story=s, cols=1-6]}`;
    const pd = lay(src);
    const [first, second] = pd.explain!.scenes;
    const ragged = (ds: Decision[]) => ds.filter((d) => d.kind === "line" && d.reason === "ragged");
    const end = pd.scenes[0]!.lines.at(-1)!;
    expect(ragged(first!.decisions)).toEqual([expect.objectContaining({ numbers: { reasonCode: 1 }, at: { x: end.x, y: end.y, width: end.width, height: end.height } })]);
    expect(ragged(second!.decisions)).toHaveLength(1);
  });

  it("ragged: justify-min in % is of the viewport's width, as the renderer reads it", () => {
    // A 522px column: under 45% of 1280px (576px) is ragged; 40% (512px) is not.
    const of = (pct: number) => notes(lay(`\\style[name=body, align=justify, justify-min=${pct}%]\n\\story[name=s]{${para(6, "a")}}\n\\scene{\\frame[story=s, cols=1-6]}`), "ragged");
    expect(of(45).filter((d) => d.numbers.reasonCode === 2).length).toBeGreaterThan(0);
    expect(of(40).filter((d) => d.numbers.reasonCode === 2)).toEqual([]);
  });

  it("hung: a quotation mark opening a line hangs outside the column", () => {
    const pd = lay(`\\style[name=body, hang=punctuation, indent=0]\n${page(`“${para(3, "a")}”`)}`);
    const ds = notes(pd, "hung");
    expect(ds.length).toBeGreaterThanOrEqual(1);
    const l = lineAt(pd, ds[0]!);
    expect(ds[0]!.numbers).toEqual(l.hang);
    expect(ds[0]!.numbers.left).toBeGreaterThan(0);
    expect(ds[0]!.rule).toBe("§07.6 hang");
  });

  it("hyphenated: a line that breaks at a soft hyphen", () => {
    const pd = lay(HYPHEN);
    const ds = notes(pd, "hyphenated");
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) expect(lineAt(pd, d).text.endsWith("\u00ad")).toBe(true);
  });

  it("loose: a justified line whose spaces open past 1.5 of a space", () => {
    const pd = lay(JUSTIFIED);
    const ds = notes(pd, "loose");
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) {
      expect(d.numbers.ratio).toBeGreaterThan(1.5);
      expect(d.rule).toBe("§07.6 justify");
    }
    // Not every line is loose; one decision a line a code.
    const keys = ds.map((d) => `${d.at.x}|${d.at.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ds.length).toBeLessThan(pd.scenes[0]!.lines.length);
  });
});

describe("column-end at", () => {
  it("is the lower of the column's last line and its lowest object", () => {
    // The text ends part-way down column 2; the pull quote with no text after it sets below it there.
    const pd = lay(page(`${para(30, "a")}\n\n\\pullquote{Stone keeps what water gives it.}`), VIEW, { explain: true, composeBudget: 0 });
    const q = pd.scenes[0]!.objects.find((o) => o.kind === "pullquote")!;
    const d = ends(pd).find((x) => x.reason === "story-end")!;
    const last = pd.scenes[0]!.lines.filter((l) => l.frame === d.frame && l.column === d.column).at(-1)!;
    expect(q.box.x).toBe(last.x);
    expect(q.box.y).toBeGreaterThan(last.y + last.height);
    expect(d.at).toEqual(q.box);
    expect(d.refs.blocks).toEqual([last.block]);
  });
});

// Minimal stories for the codes that need a setting just so (lengths found by a search at 1280x800, fixed engine).
/** A subhead whose paragraph has no room under it at column 1's foot. */
const KEEP = page(`${para(15, "a")}\n\n\\subhead{The keepers}\n\n${para(20, "b")}`);
/** A paragraph whose first line alone would end column 1. */
const ORPHANS = page(`${para(17, "a")}\n\n${para(20, "b")}`);
/** A paragraph whose last line alone would start column 3. */
const WIDOWS = page(`${para(16, "a")}\n\n${para(20, "b")}`);
/** Words with soft hyphens, so the band's last line would end on one. */
const HYPHEN = page(`${para(1, "a")} ${"extra\u00adordinarily ".repeat(200)}`);
/** A picture that waits, and two lines of text left for the last page. */
const STUB = page(`${para(40, "a")}\n\n${fig("size=column, ratio=4:3")}\n\n${para(6, "b")}`);
/** Under a heading, a picture opening the band that leaves a line under it. */
const FOOT = `\\story[name=s]{${fig("size=column, ratio=100:115, place=here")}\n\n${para(60, "b")}}\n\\scene[height=page, grid=page]{\\frame[cols=1-12]{\\headline{${"Stone endures ".repeat(4)}}}\\frame[story=s, cols=1-12, columns=3]}`;
/** A picture anchored late, with too little text after it to go on alone. */
const RULE3 = page(`${para(42, "a")}\n\n${fig("size=column, ratio=4:3")}\n\n${para(4, "b")}`);
