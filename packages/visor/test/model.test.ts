/** The visor's model (design 2026-10-21): what the overlay draws, from layout coordinates only. */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { type AssetHost, resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { type GridGeometry, type PositionedDocument, type PositionedLine, layout } from "@wmxdsl/layout";
import { DEFAULT_LAYERS, buildModel } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const GRID = "\\grid[name=page, cols=12, gutter=24px, margin-x=48px, margin-y=2bl, baseline=28px, body=1-12]\n";
const VIEW = { width: 1280, height: 800 };
const fake: AssetHost = {
  image: (path) => ({ url: path, type: "image/jpeg", width: 800, height: 600, animated: false }),
  contour: () => null,
  file: (path) => ({ url: path, type: "video/mp4" }),
};
const LONG = "Stone endures where nearly everything else decays. ".repeat(100).trim();
const para = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays.`).join(" ");
const fig = (attrs: string): string => `\\figure[src=/a.jpg, alt="A picture", ${attrs}]`;
const page = (story: string, name = "s"): string => `\\story[name=${name}]{${story}}\n\\scene[height=page, grid=page]{\\frame[story=${name}, cols=1-12, columns=3]}`;
function lay(src: string, view = VIEW): PositionedDocument {
  const rd = resolve(parse(FM + GRID + src).ast as Document, { assets: fake }).doc;
  return layout(rd, view, new PrepareCache(createFixedEngine()), { explain: true });
}

/** A levelled page, a page with pictures and a scrolling scene after them. */
function mixed(): PositionedDocument {
  const words = LONG.split(" ");
  const blocks = Array.from({ length: 40 }, (_, i) => (i % 5 === 4 ? `\\subhead{Part ${i}}` : words.slice(0, 20 + ((i * 37) % 60)).join(" ")));
  return lay(
    `\\style[name=body, space-after=0, indent=1em]\n\\style[name=subhead, leading=1bl, space-before=1bl, space-after=0]\n${page(blocks.join("\n\n"))}\n` +
      `${page(`${para(40, "a")}\n\n${fig("size=column, ratio=4:3")}\n\n${para(30, "b")}\n\n${fig("size=column, ratio=1:1")}\n\n${para(20, "c")}`, "t")}\n` +
      `\\story[name=u]{${LONG}}\n\\scene{\\frame[story=u, cols=1-12, columns=2]}`,
  );
}

describe("the visor model", () => {
  const pd = mixed();
  const models = buildModel(pd, pd.explain!);

  it("every screen has a model", () => {
    const expected = pd.scenes.flatMap((s) =>
      s.paged ? Array.from({ length: Math.round(s.height / VIEW.height) }, (_, k) => `${s.name}|${Math.floor((s.y + k * VIEW.height + 1e-6) / VIEW.height) + 1}`) : [`${s.name}|null`],
    );
    expect(models.map((m) => `${m.scene}|${m.screen}`)).toEqual(expected);
    expect(expected.length).toBeGreaterThanOrEqual(4);
    // Every decision is in exactly one screen model, in log order.
    for (const { scene, decisions } of pd.explain!.scenes) {
      const at = models.filter((m) => m.scene === scene).map((m) => m.decisions.map((d) => decisions.indexOf(d)));
      for (const idx of at) expect(idx).toEqual([...idx].sort((a, b) => a - b));
      expect(at.flat().sort((a, b) => a - b)).toEqual(decisions.map((_, i) => i));
    }
    for (const m of models) for (const d of m.decisions) if (m.screen !== null) expect(d.screen).toBe(m.screen);
  });

  it("one marker per column-end decision, ringed except bottom-line and story-end", () => {
    let ringed = 0;
    for (const m of models) {
      const markers = m.shapes.filter((s) => s.kind === "marker");
      const ends = m.decisions.map((d, i) => [d, i] as const).filter(([d]) => d.kind === "column-end");
      expect(markers.map((s) => s.decision)).toEqual(ends.map(([, i]) => i));
      let n = 0;
      for (const s of markers) {
        const d = m.decisions[s.decision!]!;
        expect(s.layer).toBe("flow");
        expect(s.ringed).toBe(d.reason !== "bottom-line" && d.reason !== "story-end");
        expect(s.number).toBe(s.ringed ? ++n : undefined);
      }
      ringed += n;
    }
    expect(ringed).toBeGreaterThan(0);
  });

  it("picture outline, badge and anchor link per picture decision", () => {
    let pictures = 0;
    for (const m of models)
      m.decisions.forEach((d, i) => {
        if (d.kind !== "picture") return;
        pictures++;
        const mine = m.shapes.filter((s) => s.decision === i);
        expect(mine.every((s) => s.layer === "pictures")).toBe(true);
        expect(mine.map((s) => s.kind).sort()).toEqual(["anchor-link", "badge", "outline"]);
        const outline = mine.find((s) => s.kind === "outline")!;
        expect({ x: outline.x, y: outline.y, width: outline.width, height: outline.height }).toEqual(d.at);
        expect(outline.label).toContain(d.refs.objects![0]);
        expect(mine.find((s) => s.kind === "badge")!.label).toBe(d.numbers.score === undefined ? d.reason : `${d.reason} · score ${Math.round(d.numbers.score)}`);
      });
    expect(pictures).toBe(2);
  });

  it("grid shapes come from the scene grid", () => {
    for (const m of models) {
      const g = pd.scenes.find((s) => s.name === m.scene)!.grid;
      const tints = m.shapes.filter((s) => s.kind === "column-tint");
      expect(tints.map((s) => s.x)).toEqual(Array.from({ length: g.cols }, (_, i) => g.originX + i * (g.colWidth + g.gutter)));
      for (const t of tints) expect(t).toMatchObject({ layer: "space", width: g.colWidth });
      const baselines = m.shapes.filter((s) => s.kind === "baseline").map((s) => s.y);
      expect(baselines.length).toBeGreaterThan(3);
      for (let i = 1; i < baselines.length; i++) expect(baselines[i]! - baselines[i - 1]!).toBeCloseTo(g.baseline);
      const bottom = m.shapes.filter((s) => s.kind === "bottom-line");
      if (m.screen === null) expect(bottom).toEqual([]);
      else expect(bottom.map((s) => s.y)).toEqual([m.top + VIEW.height - g.marginY]);
    }
  });
});

describe("a model per layout", () => {
  it("two layouts of different widths share no shapes", () => {
    const src = page(`${para(40, "a")}\n\n${fig("size=column, ratio=4:3")}\n\n${para(30, "b")}`);
    const [wide, narrow] = [VIEW, { width: 900, height: 800 }].map((v) => {
      const pd = lay(src, v);
      return buildModel(pd, pd.explain!);
    });
    const a = new Set(wide!.flatMap((m) => m.shapes));
    const b = narrow!.flatMap((m) => m.shapes);
    expect(a.size).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(b.filter((s) => a.has(s))).toEqual([]);
    expect(wide).not.toEqual(narrow);
  });
});

describe("gaps", () => {
  const grid: GridGeometry = { cols: 12, gutter: 24, marginX: 48, marginY: 56, max: 1280, baseline: 28, rows: 1, rowGap: 0, body: [1, 12], outdent: 0, viewport: 1280, content: 1184, originX: 48, colWidth: 76.67 };
  const line = (column: number, row: number): PositionedLine => ({
    story: "s", block: 0, style: "body", frame: "f", column, x: 48 + column * 400, y: 56 + row * 28, baseline: 56 + row * 28 + 20, width: 380, measured: 370, height: 28, text: "x",
    start: { item: 0, seg: 0, grapheme: 0 }, end: { item: 0, seg: 0, grapheme: 0 }, paragraphStart: false, snapped: true, fragments: [{ run: 0, text: "x" }],
  } as PositionedLine);
  // Column 0: rows 0-4, a hole of rows 5-7, rows 8-12. Column 1: rows 0-12, no hole, then the empty foot.
  const lines = [...[0, 1, 2, 3, 4, 8, 9, 10, 11, 12].map((r) => line(0, r)), ...Array.from({ length: 13 }, (_, r) => line(1, r))];
  const pd: PositionedDocument = {
    viewport: { width: 1280, height: 800 }, breakpoint: "base", height: 800,
    scenes: [{ name: "a", y: 0, height: 800, grid, lines, objects: [], caps: [], rules: [], columnRules: [], continues: [], paged: true }],
  };

  it("gaps are found and sized in lines", () => {
    const [m] = buildModel(pd, { version: 1, scenes: [{ scene: "a", decisions: [] }] });
    const gaps = m!.shapes.filter((s) => s.kind === "gap");
    expect(gaps).toEqual([{ layer: "space", kind: "gap", x: 48, y: 56 + 5 * 28, width: 380, height: 3 * 28, label: "3 lines" }]);
  });

  const gapsOf = (ls: PositionedLine[], objects: PositionedDocument["scenes"][number]["objects"] = []) =>
    buildModel({ ...pd, scenes: [{ ...pd.scenes[0]!, lines: ls, objects }] }, { version: 1, scenes: [{ scene: "a", decisions: [] }] })[0]!.shapes.filter((s) => s.kind === "gap");
  const rows = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => line(0, from + i));
  const object = (y: number, height: number) => ({ name: "p", kind: "figure", box: { x: 48, y, width: 380, height }, exclusion: null, anchoredAt: null, media: null });

  it("an object above or below the lines gives no gap", () => {
    expect(gapsOf(rows(4, 12), [object(0, 100), object(600, 100)])).toEqual([]);
  });

  it("a run under one baseline gives no gap", () => {
    const after = rows(5, 9).map((l) => ({ ...l, y: l.y + 20, baseline: l.baseline + 20 }));
    expect(gapsOf([...rows(0, 4), ...after])).toEqual([]);
  });

  it("the space a new block's style asks for gives no gap", () => {
    const next = rows(7, 12).map((l, i) => ({ ...l, block: 1, paragraphStart: i === 0 }));
    expect(gapsOf([...rows(0, 4), ...next])).toEqual([]);
    // The same run inside one block is a gap.
    expect(gapsOf([...rows(0, 4), ...rows(7, 12)]).map((g) => g.label)).toEqual(["2 lines"]);
  });

  it("lines and words are off by default", () => {
    expect([...DEFAULT_LAYERS].sort()).toEqual(["flow", "pictures", "space"]);
  });
});
