/**
 * Milestone M3: spec §18's "Stone & Strategy" laid out at every test width
 * (spec §15.6), checked by the layout invariants: every
 * character set once, no overlapping lines, no line inside an exclusion,
 * snapped baselines on the grid. Fixed-width engine, real demo assets.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import type { ParagraphBlock } from "@wmxdsl/resolved-document";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { bandExtent, layout } from "../src/index.js";

const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const src = readFileSync(here("parser/test/fixtures/stone-and-strategy.wmx"), "utf8");
const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("parser/test/fixtures") });
const { doc: rd } = resolve(parse(src).ast as Document, { assets });

const SHY = /\u00ad/g;

describe.each([360, 640, 768, 1000, 1280, 1470, 2560])("Stone & Strategy at %ipx", (width) => {
  const pd = layout(rd, { width, height: 900 }, new PrepareCache(createFixedEngine()));
  const v = rd.variants[pd.breakpoint]!;
  const lines = pd.scenes.flatMap((s) => s.lines);

  it("sets every word of the main story once, in order, across both scenes", () => {
    const expected = v.stories.main!.blocks
      .filter((b): b is ParagraphBlock => b.kind === "paragraph")
      .map((b) => (b.dropcap ? rd.strings[b.dropcap.s] : "") + b.runs.map((r) => (r.kind === "break" ? "" : rd.strings[r.s])).join(""))
      .join(" ")
      .replace(SHY, "")
      .split(/\s+/)
      .filter(Boolean);
    const got = lines
      .filter((l) => l.story === "main")
      .map((l) => (l.paragraphStart ? capOf(l.block) : "") + l.text + (l.text.endsWith("\u00ad") ? "" : " "))
      .join("")
      .replace(SHY, "")
      .split(/\s+/)
      .filter(Boolean);
    // Lowercased, as the shared invariants compare: a style may set its text in capitals (subheads do).
    expect(got.map((w) => w.toLowerCase())).toEqual(expected.map((w) => w.toLowerCase()));
  });

  it("the main story threads through part one and part two only, split at the frame break", () => {
    const scenes = new Set(pd.scenes.filter((s) => s.lines.some((l) => l.story === "main")).map((s) => s.name));
    expect(scenes).toEqual(new Set(["part-one", "part-two"]));
  });

  it("no two lines of one column overlap", () => {
    const byCol = new Map<string, typeof lines>();
    for (const l of lines) byCol.set(`${l.frame}:${l.column}`, [...(byCol.get(`${l.frame}:${l.column}`) ?? []), l]);
    for (const ls of byCol.values()) {
      const bands = [...new Set(ls.map((l) => l.y))].sort((a, b) => a - b);
      for (let i = 1; i < bands.length; i++) expect(bands[i]! - bands[i - 1]!).toBeGreaterThanOrEqual(Math.min(...ls.map((l) => l.height)) - 1e-6);
    }
  });

  it("no main-story line runs into a wrapping object's box (bounding check)", () => {
    for (const s of pd.scenes)
      for (const o of s.objects.filter((o) => o.exclusion && !o.exclusion.jump && o.anchoredAt !== null)) {
        const e = o.exclusion!;
        for (const l of s.lines.filter((l) => l.story === "main" && l.y < e.box.y + e.box.height && l.y + l.height > e.box.y)) {
          // Lines sit wholly left or wholly right of the object's box, less its standoff.
          const left = l.x + l.width <= e.box.x + e.box.width + 1e-6;
          const right = l.x >= e.box.x - 1e-6;
          expect(left || right).toBe(true);
        }
      }
  });

  it("every line of every frame clears the keep's contour, the bio frame's too (§11.3 any overlapping frame)", () => {
    for (const s of pd.scenes)
      for (const o of s.objects.filter((o) => o.exclusion && !o.exclusion.jump && o.anchoredAt !== null))
        for (const l of s.lines.filter((l) => v.frames[l.frame])) {
          const ext = bandExtent({ ...o.exclusion!, offset: 0 }, l.y, l.y + l.height);
          if (ext) expect(l.x + l.width <= ext[0] + 0.5 || l.x >= ext[1] - 0.5, `${o.name} vs "${l.text}"`).toBe(true);
        }
  });

  it("every snapped baseline sits on its scene's baseline grid", () => {
    for (const s of pd.scenes)
      for (const l of s.lines.filter((x) => x.snapped)) {
        const steps = (l.baseline - s.y) / s.grid.baseline;
        expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6); // distance to the nearest whole step
      }
  });

  it("the keep follows its breakpoint: contour beside the text at base and tablet, full width on phone", () => {
    const keep = pd.scenes.flatMap((s) => s.objects).find((o) => o.name === "figure-1")!;
    expect(keep.exclusion?.shape.kind).toBe(pd.breakpoint === "phone" ? "rect" : "poly");
    if (pd.breakpoint === "phone") expect(keep.exclusion?.jump).toBe(true);
  });
});

const capOf = (block: number): string => {
  const b = rd.variants.base!.stories.main!.blocks[block] as ParagraphBlock;
  return b.dropcap ? rd.strings[b.dropcap.s]! : "";
};
