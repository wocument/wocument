/**
 * Speed of picture composition (docs/superpowers/specs/2026-10-17-picture-composition-design.md):
 * a ten-screen page story with 15 floating figures lays out in at most 4 times the time of today's
 * placement (`composeBudget: 0`). Each run uses a fresh PrepareCache, so neither side gains from caching.
 */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
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
const run = (composeBudget?: number) => layout(doc, VIEW, new PrepareCache(createFixedEngine()), composeBudget === undefined ? undefined : { composeBudget });

function median(composeBudget?: number): number {
  run(composeBudget); // warm up
  const times = Array.from({ length: 5 }, () => {
    const t = performance.now();
    run(composeBudget);
    return performance.now() - t;
  }).sort((a, b) => a - b);
  return times[2]!;
}

describe("speed of picture composition", () => {
  it("floating takes at most 4 times today's placement", () => {
    expect(Math.round(run(0).height / VIEW.height)).toBeGreaterThanOrEqual(10);
    let trials = 0;
    layout(doc, VIEW, new PrepareCache(createFixedEngine()), { onCompose: (_, n) => (trials += n) });
    expect(trials).toBeGreaterThan(0); // the floating side really composes
    const base = median(0);
    const float = median();
    console.log(`float-speed: budget 0 ${base.toFixed(1)} ms, floating ${float.toFixed(1)} ms, ratio ${(float / base).toFixed(2)}`);
    expect(float).toBeLessThanOrEqual(4 * base);
  }, 120_000);
});
