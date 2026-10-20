/**
 * Speed of picture composition (docs/superpowers/specs/2026-10-17-picture-composition-design.md):
 * a ten-screen page story with 15 floating figures lays out in at most 4 times the time of the layout
 * without composition (`composeBudget: 0`); real articles, where they are present, in at most 8 times.
 * Each run uses a fresh PrepareCache, so neither side gains from caching.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import type { ResolvedDocument } from "@wmxdsl/resolved-document";
import { type AssetHost, resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const GRID = "\\grid[name=page, cols=12, gutter=24px, margin-x=48px, margin-y=2bl, baseline=28px, body=1-12]\n";
const VIEW = { width: 1470, height: 956 };
const fake: AssetHost = {
  image: (path) => ({ url: path, type: "image/jpeg", width: 800, height: 600, animated: false }),
  contour: () => null,
  file: (path) => ({ url: path, type: "video/mp4" }),
};

const RATIOS = ["3:2", "4:3", "1:1", "4:5", "16:9", "2:3", "3:1"];
const SIZES = ["auto", "column", "wide", "small", "auto"];
const para = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays.`).join(" ");
const fig = (i: number): string =>
  `\\figure[src=/f${i}.jpg, alt="Picture ${i}", ratio=${RATIOS[i % RATIOS.length]}, size=${SIZES[i % SIZES.length]}]` + (i % 2 === 0 ? `{\\caption{Picture ${i} of the series, seen from the shore.}}` : "");
const story = Array.from({ length: 15 }, (_, i) => `${para(20, `p${i}x`)}\n\n${fig(i)}\n\n${para(16, `p${i}y`)}`).join("\n\n");
const SRC = `${FM}${GRID}\\story[name=s]{${story}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`;

const { doc } = resolve(parse(SRC).ast as Document, { assets: fake });

/** The median of five runs at budget 40 over the median of five at budget 0, the two in turn. */
function ratio(d: ResolvedDocument, view: { width: number; height: number }): number {
  const run = (composeBudget: number) => {
    const t = performance.now();
    layout(d, view, new PrepareCache(createFixedEngine()), { composeBudget });
    return performance.now() - t;
  };
  run(0), run(40); // warm up
  const times: Record<number, number[]> = { 0: [], 40: [] };
  for (let i = 0; i < 5; i++) for (const b of i % 2 ? [0, 40] : [40, 0]) times[b]!.push(run(b));
  const median = (a: number[]) => a.sort((x, y) => x - y)[2]!;
  return median(times[40]!) / median(times[0]!);
}

const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const article = (name: string): ResolvedDocument => {
  const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("playground/docs") });
  return resolve(parse(readFileSync(here(`playground/docs/${name}`), "utf8")).ast as Document, { assets }).doc;
};

describe("speed of picture composition", () => {
  it("floating takes at most 4 times the layout without composition", () => {
    expect(Math.round(layout(doc, VIEW, new PrepareCache(createFixedEngine()), { composeBudget: 0 }).height / VIEW.height)).toBeGreaterThanOrEqual(10);
    let trials = 0;
    layout(doc, VIEW, new PrepareCache(createFixedEngine()), { onCompose: (_, n) => (trials += n) });
    expect(trials).toBeGreaterThan(0); // the floating side really composes
    expect(ratio(doc, VIEW)).toBeLessThanOrEqual(4);
  }, 120_000);

  // Real articles, where composition costs more than the layout itself (2026-10-21: about 4.7 and 6.3
  // times once trials share their work, from 10.4 and 7.2). The plan's bound is 4 times; the owner set
  // the real-article bound at 8 times on 2026-10-21 (the synthetic test keeps 4 times).
  for (const [name, width, height] of [["test-spread.wmx", 2560, 1440], ["stress-portraits.wmx", 1470, 956]] as const)
    it.skipIf(!existsSync(here(`playground/docs/${name}`)))(`${name} at ${width}x${height} takes at most 8 times the layout without composition`, () => {
      expect(ratio(article(name), { width, height })).toBeLessThanOrEqual(8);
    }, 120_000);
});
