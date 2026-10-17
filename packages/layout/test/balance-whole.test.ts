/**
 * Balancing by whole blocks (2026-10-17): on a frame's last page, paragraphs stay whole and in
 * reading order; the smallest column height that holds them wins, and columns it does not need stay
 * empty. Paragraphs here are the same text, so all of them are the same height.
 */
import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const PARA = "Stone endures where nearly everything else decays, and the keepers wrote it down every night.";

function columnsOf(paragraphs: number, columns: number, text = PARA) {
  const story = Array.from({ length: paragraphs }, () => text).join("\n\n");
  const { doc } = resolve(parse(`${FM}\\story[name=s]{${story}}\n\\scene{\\frame[story=s, cols=1-12, columns=${columns}]}`).ast as Document);
  const pd = layout(doc, { width: 1440, height: 900 }, new PrepareCache(createFixedEngine()));
  layoutInvariants(doc, pd);
  const lines = pd.scenes[0]!.lines.filter((l) => l.story === "s");
  /** Paragraphs per column, and the columns each paragraph's lines sit in. */
  const per = Array.from({ length: columns }, (_, c) => new Set(lines.filter((l) => l.column === c).map((l) => l.block)).size);
  const spans = [...new Set(lines.map((l) => l.block))].map((b) => new Set(lines.filter((l) => l.block === b).map((l) => l.column)).size);
  return { per, spans };
}

describe("balancing by whole paragraphs", () => {
  it.each([
    [1, 1, [1]],
    [1, 3, [1, 0, 0]],
    [2, 2, [1, 1]],
    [2, 3, [1, 1, 0]],
    [3, 2, [2, 1]],
    [3, 3, [1, 1, 1]],
    [4, 3, [2, 2, 0]],
  ])("%i paragraphs in %i columns: %j", (paragraphs, columns, expected) => {
    const { per, spans } = columnsOf(paragraphs, columns);
    expect(per).toEqual(expected);
    expect(spans.every((n) => n === 1)).toBe(true); // no paragraph split across columns
  });

  it("keeps a subhead with the paragraph after it", () => {
    const story = [PARA, PARA, "\\subhead{The keepers}", PARA].join("\n\n");
    const { doc } = resolve(parse(`${FM}\\story[name=s]{${story}}\n\\scene{\\frame[story=s, cols=1-12, columns=2]}`).ast as Document);
    const lines = layout(doc, { width: 1440, height: 900 }, new PrepareCache(createFixedEngine())).scenes[0]!.lines.filter((l) => l.story === "s");
    const colOf = (style: string) => lines.find((l) => l.style === style)!.column;
    const last = lines.at(-1)!;
    expect(colOf("subhead")).toBe(last.column);
  });
});

describe("a page scene's last page", () => {
  it("fills earlier pages to the foot and keeps the last page's paragraphs whole", () => {
    const LONG = Array.from({ length: 30 }, () => PARA.repeat(2)).join("\n\n");
    const GRID = "\\grid[name=page, cols=12, gutter=24px, margin-x=48px, margin-y=2bl, baseline=28px, body=1-12]\n";
    const { doc } = resolve(parse(`${FM}${GRID}\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`).ast as Document);
    const pd = layout(doc, { width: 1280, height: 800 }, new PrepareCache(createFixedEngine()));
    layoutInvariants(doc, pd);
    const s = pd.scenes[0]!;
    const pages = s.height / 800;
    expect(pages).toBeGreaterThan(1);
    const last = s.lines.filter((l) => Math.floor(l.y / 800) === pages - 1);
    // Blocks that start on the last page sit in one column each.
    const starts = new Set(last.filter((l) => l.paragraphStart).map((l) => l.block));
    for (const b of starts) expect(new Set(last.filter((l) => l.block === b).map((l) => l.column)).size).toBe(1);
    expect(s.continues).toHaveLength(pages - 1);
  });
});
