/**
 * M2 layout, in Node with the fixed-width engine: the minimum valid file's
 * Resolved Document at every test width (spec §15.6), checked by the layout
 * layout invariants rather than by snapshots. Since 2026-10-07 the
 * implicit form is a magazine page: the headline in a heading frame (`frame-1`),
 * the body in a story frame in columns (`frame-2`).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ResolvedDocument } from "@wmxdsl/resolved-document";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { activeVariant, layout, type PositionedDocument } from "../src/index.js";

const rd = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../resolved-document/examples/minimum.resolved.json", import.meta.url)), "utf8"),
) as ResolvedDocument;

const WIDTHS = [360, 768, 1280, 1470, 2560];
const run = (width: number, cache = new PrepareCache(createFixedEngine())): PositionedDocument =>
  layout(rd, { width, height: 800 }, cache);

/** Line texts rejoined: a line ending at a soft hyphen (U+00AD) joins the next without a space. */
const rejoin = (pd: PositionedDocument, story: string): string =>
  pd.scenes[0]!.lines
    .filter((l) => l.story === story)
    .map((l) => l.text)
    .reduce((acc, t) => (acc.endsWith("\u00ad") ? acc.slice(0, -1) + t : acc === "" ? t : `${acc.trimEnd()} ${t}`), "")
    .trimEnd();

describe.each(WIDTHS)("minimum file at %ipx", (width) => {
  const pd = run(width);
  const scene = pd.scenes[0]!;
  const lines = scene.lines;

  it("picks the variant the breakpoint cover names", () => {
    expect(pd.breakpoint).toBe(width < 640 ? "phone" : width < 1024 ? "tablet" : width < 1440 ? "compact" : width < 1800 ? "base" : "wide");
  });

  it("sets every character of every paragraph exactly once", () => {
    // The headline binds "A" to "Brief".
    expect(rejoin(pd, "frame-1#text")).toBe("A\u00a0Brief Note");
    expect(rejoin(pd, "frame-2#text")).toBe("This is the entire article.");
  });

  it("no two lines overlap, and lines come in story order", () => {
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.y).toBeGreaterThanOrEqual(lines[i - 1]!.y + lines[i - 1]!.height - 1e-6);
  });

  it("every snapped baseline is on the scene's baseline step", () => {
    const bl = scene.grid.baseline;
    for (const l of lines.filter((x) => x.snapped)) expect(((l.baseline - scene.y) / bl) % 1).toBeCloseTo(0, 6);
  });

  it("every line stays inside its frame's columns", () => {
    for (const l of lines) {
      const { from, to } = rd.variants[pd.breakpoint]!.frames[l.frame]!.cols;
      // On wide screens a heading frame on the grid's edge reaches into the margin (outdent, §07.5).
      const left = scene.grid.originX + (from - 1) * (scene.grid.colWidth + scene.grid.gutter) - (from === 1 ? scene.grid.outdent : 0);
      const right = scene.grid.originX + to * scene.grid.colWidth + (to - 1) * scene.grid.gutter;
      expect(l.x).toBeGreaterThanOrEqual(left - 1e-6);
      expect(l.x + l.width).toBeLessThanOrEqual(right + 1e-6);
    }
  });

  it("the scene is its content plus margin-y, and the document is the scene", () => {
    const last = lines.at(-1)!;
    expect(scene.height).toBeGreaterThan(last.y + last.height - scene.y);
    expect(pd.height).toBe(scene.height);
  });
});

describe("geometry at 1470px (MacBook Air 13\", base variant)", () => {
  it("places the heading frame on columns 1-8 of the 12-column grid", () => {
    const { grid, lines } = run(1470).scenes[0]!;
    // content = min(1470 - 2*128, 1440) = 1214; column = (1214 - 11*24) / 12
    expect(grid.content).toBe(1214);
    expect(grid.colWidth).toBeCloseTo((1214 - 11 * 24) / 12, 9);
    expect(lines[0]!.x).toBeCloseTo(grid.originX, 9);
    expect(lines[0]!.y).toBe(66); // margin-y = 2bl = 66px on the 33px grid, and the first band starts there
  });

  it("the headline does not snap, and the body after it sits back on the grid", () => {
    const { lines } = run(1470).scenes[0]!;
    const body = lines.find((l) => l.story === "frame-2#text")!;
    expect(lines[0]!.snapped).toBe(false);
    expect(body.snapped).toBe(true);
    expect(body.baseline % 33).toBeCloseTo(0, 6);
  });
});

describe("soft-hyphen breaks", () => {
  // Engines draw a soft-hyphen break as "-" (Pretext does). Layout rewrites that
  // hyphen to U+00AD, so the renderer can show it without copying it, and a real
  // hyphen ("stone-cutter") is never mistaken for one.
  const narrow = (text: string, width: number): string[] => {
    const doc = structuredClone(rd);
    doc.strings[1] = text;
    // Line by line, so the break falls where the text forces it, not where the composer prefers.
    for (const v of Object.values(doc.variants)) v.styles.body!.composer = "line";
    return layout(doc, { width, height: 800 }, new PrepareCache(createFixedEngine()))
      .scenes[0]!.lines.filter((l) => l.story === "frame-2#text")
      .map((l) => l.text);
  };

  it("a break at a soft hyphen ends the line with U+00AD, not a hyphen", () => {
    // 360px phone: 304px column, 18px body at 9px a character, so "fortifications" cannot fit whole after 28 letters.
    const lines = narrow("xxxxxxxxxxxxxxxxxxxxxxxxxxxx for\u00adti\u00adfi\u00adca\u00adtions", 360);
    expect(lines.some((t) => t.endsWith("\u00ad"))).toBe(true);
    expect(lines.every((t) => !t.endsWith("-"))).toBe(true);
    expect(lines.join("").replaceAll("\u00ad", "").replaceAll(" ", "")).toBe("xxxxxxxxxxxxxxxxxxxxxxxxxxxxfortifications");
  });

  it("a real hyphen at a line end stays a hyphen", () => {
    const lines = narrow("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx stone-cutter", 360);
    expect(lines.every((t) => !t.includes("\u00ad"))).toBe(true);
  });
});

describe("prepare cache (spec §15.4 point 6)", () => {
  it("returning to a width re-prepares nothing; a fluid headline re-prepares when its size changes", () => {
    const cache = new PrepareCache(createFixedEngine());
    run(1300, cache);
    const afterFirst = cache.size;
    run(1300, cache);
    expect(cache.size).toBe(afterFirst);
    run(1400, cache); // same variant (compact), different fluid headline size, same body size
    expect(cache.size).toBe(afterFirst + 1);
  });

  it("activeVariant follows the cover at the edges, including fractional widths", () => {
    expect([639, 639.5, 640, 1023.9, 1024, 1419.9, 1420, 1425].map((w) => activeVariant(rd, w))).toEqual(["phone", "phone", "tablet", "tablet", "compact", "compact", "base", "base"]);
  });
});

describe("a viewport narrower than its margins", () => {
  it("finishes, with a finite height (flow frames once looped forever on a column with no width)", () => {
    for (const width of [0, 30, 40]) expect(Number.isFinite(run(width).height)).toBe(true);
  });
});
