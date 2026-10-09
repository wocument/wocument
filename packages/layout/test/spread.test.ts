/**
 * The spread opener as row groups (design 2026-09-26): side by side on a
 * laptop, three across on a wide screen, a row each on tablet and phone with
 * the headline kept under its photo. Photos are missing on purpose (they are
 * not in git), so the resolver's ratio placeholders stand in.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout, type PositionedDocument } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const assets = createAssetHost({ publicDir: here("layout/test"), sourceDir: here("playground/docs") });
const rd = resolve(parse(readFileSync(here("playground/docs/spread.wmx"), "utf8")).ast as Document, { assets }).doc;
const at = (width: number, height = 900) => layout(rd, { width, height }, new PrepareCache(createFixedEngine()));

const scene = (pd: PositionedDocument) => pd.scenes.find((s) => s.name === "spread")!;
const box = (pd: PositionedDocument, name: string) => scene(pd).objects.find((o) => o.name === name)!.box;
const cols = (pd: PositionedDocument, name: string): [number, number] => {
  const g = scene(pd).grid;
  const b = box(pd, name);
  const from = Math.round((b.x - g.originX) / (g.colWidth + g.gutter)) + 1;
  return [from, from + Math.round((b.width + g.gutter) / (g.colWidth + g.gutter)) - 1];
};
/** The headline frame's first line. */
const head = (pd: PositionedDocument) => scene(pd).lines.find((l) => l.text.startsWith("INTERVIEW") || l.text.startsWith("Interview"))!;

describe("spread opener as row groups", () => {
  it("laptop: the weaver and its headline in 7 columns, the look photo beside them in 5", () => {
    const pd = at(1440);
    expect(cols(pd, "figure-4")).toEqual([1, 7]);
    expect(cols(pd, "figure-5")).toEqual([8, 12]);
    expect(head(pd).y).toBeGreaterThanOrEqual(box(pd, "figure-4").y + box(pd, "figure-4").height);
  });

  it("wide: three across, as the art direction had it", () => {
    const pd = at(2560);
    expect(cols(pd, "figure-4")).toEqual([1, 6]);
    expect(cols(pd, "figure-5")).toEqual([13, 16]);
    const g = scene(pd).grid;
    expect(Math.round((head(pd).x - g.originX) / (g.colWidth + g.gutter)) + 1).toBe(7);
    expect(head(pd).y).toBeLessThan(box(pd, "figure-4").y + box(pd, "figure-4").height);
  });

  it.each([768, 390])("at %ipx: photo, headline, then the look photo, each full width", (width) => {
    const pd = at(width);
    const g = scene(pd).grid;
    expect(cols(pd, "figure-4")).toEqual([1, g.cols]);
    expect(cols(pd, "figure-5")).toEqual([1, g.cols]);
    expect(head(pd).y).toBeGreaterThanOrEqual(box(pd, "figure-4").y + box(pd, "figure-4").height);
    expect(box(pd, "figure-5").y).toBeGreaterThan(head(pd).y);
  });

  for (const height of [700, 1080, 1440])
    it.each([360, 390, 768, 1024, 1280, 1600, 1920, 2560, 3440])(`holds the layout invariants at %ipx x ${height}`, (width) => {
      // Against bare shapes: the spread has standoff cases, before row groups as after.
      layoutInvariants(rd, at(width, height), { standoff: false });
    });
});
