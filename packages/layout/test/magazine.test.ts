/** Design 2026-09-22 test case: magazine.woc at the test widths and two screen heights. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wocument/assets";
import { parse, type Document } from "@wocument/parser";
import { resolve } from "@wocument/resolver";
import { PrepareCache, createFixedEngine } from "@wocument/text-engine";
import { bandExtent, layout } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("playground/docs") });
const { doc: rd, diagnostics } = resolve(parse(readFileSync(here("playground/docs/magazine.woc"), "utf8")).ast as Document, { assets });
const lay = (width: number, height: number) => layout(rd, { width, height }, new PrepareCache(createFixedEngine()));

describe("magazine.woc", () => {
  it("resolves without warnings", () => {
    expect(diagnostics).toEqual([]);
  });

  describe.each([360, 768, 1280, 1470, 1920, 2560])("at %ipx", (width) => {
    it.each([800, 1440])("x %ipx: invariants hold and every page is at least a screen tall", (height) => {
      const pd = lay(width, height);
      layoutInvariants(rd, pd);
      for (const s of pd.scenes) expect(s.height).toBeGreaterThanOrEqual(height);
    });
  });

  it("the lead fills its columns to the bottom of the screen it starts on; a wide screen shows more of it", () => {
    /** The lead's lines, and the bottom of the text area of the screen the lead starts on. */
    const lead = (w: number, h: number) => {
      const s = lay(w, h).scenes[0]!;
      const lines = s.lines.filter((l) => l.story === "lead");
      const screen = Math.floor((Math.min(...lines.map((l) => l.y)) - s.y) / h);
      return { lines, bottom: s.y + (screen + 1) * h - s.grid.marginY };
    };
    const laptop = lead(1280, 800);
    // Design 2026-09-29 rule 1: the lead starts where it is, or on the next screen when less than a
    // third of a screen is left; either way it starts at most one screen down.
    expect(Math.min(...laptop.lines.map((l) => l.y))).toBeLessThanOrEqual(800 + 800 / 3);
    for (const col of [0, 1])
      expect(laptop.lines.filter((l) => l.column === col && l.y + l.height <= laptop.bottom + 1e-6).length, `column ${col}`).toBeGreaterThanOrEqual(4);
    // It continues in a second band, and nothing straddles the first screen's bottom.
    expect(laptop.lines.some((l) => l.y >= laptop.bottom)).toBe(true);
    for (const l of laptop.lines.filter((l) => l.y < laptop.bottom)) expect(l.y + l.height).toBeLessThanOrEqual(laptop.bottom + 1e-6);
    // A 27" screen shows a larger share of the lead on its first screen (more, wider columns).
    const share = (r: ReturnType<typeof lead>) => r.lines.filter((l) => l.y + l.height <= r.bottom + 1e-6).length / r.lines.length;
    expect(share(lead(2560, 1440))).toBeGreaterThan(share(laptop));
  });

  it("page 2's feature starts on its first screen at 1280x800 and wraps the cut-out on its left", () => {
    const s = lay(1280, 800).scenes.find((x) => x.name === "feature")!;
    const text = s.lines.filter((l) => l.story === "feature");
    const cut = s.objects.find((o) => o.name === "figure-1")!;
    const bandEnd = s.y + 800 - s.grid.marginY;
    const screen1 = text.filter((l) => l.y + l.height <= bandEnd + 1e-6);
    expect(screen1.length).toBeGreaterThan(10);
    // Column 0 fills and column 1 carries text; column 2 sits behind the cut-out.
    const quote = s.objects.find((o) => o.name === "pullquote-1")!;
    expect(screen1.filter((l) => l.column === 0).length).toBeGreaterThanOrEqual(6);
    expect(screen1.filter((l) => l.column === 1).length).toBeGreaterThan(0);
    // The pull quote sits wholly inside one band: it never straddles the first screen's bottom.
    expect(quote.box.y + quote.box.height <= bandEnd + 1e-6 || quote.box.y >= bandEnd - 1e-6).toBe(true);
    // Reading order: in story order, within a band, text never jumps back to an earlier column
    // (a stray line below a fully blocked column would).
    // Bands are screens (design 2026-09-29 rule 1): a line's band is the screen it is on.
    const band = (y: number) => Math.floor((y - s.y) / 800);
    for (let i = 1; i < text.length; i++)
      if (band(text[i]!.y) === band(text[i - 1]!.y)) expect(text[i]!.column, text[i]!.text).toBeGreaterThanOrEqual(text[i - 1]!.column);
    // Lines beside the cut-out stay left of its box.
    for (const l of screen1.filter((l) => l.y < cut.box.y + cut.box.height && l.y + l.height > cut.box.y)) expect(l.x).toBeLessThan(cut.box.x);
  });

  it("no line runs under a picture's box or outline (the feature at 1470x956)", () => {
    // 2026-10-20: the composer floated the pull quote into the third column, under the scene's
    // cut-out; its lines showed through the picture. A floating box keeps clear of the frame's
    // wrapping objects as of its own.
    const pd = lay(1470, 956);
    layoutInvariants(rd, pd);
    const v = rd.variants[pd.breakpoint]!;
    for (const s of pd.scenes)
      for (const o of s.objects.filter((o) => v.objects[o.name]?.placement.mode !== "contained"))
        for (const l of s.lines.filter((l) => l.frame !== o.name && !(v.objects[l.frame]?.placement.mode === "contained"))) {
          if (!(l.y < o.box.y + o.box.height - 1 && o.box.y < l.y + l.height - 1)) continue;
          const ext: [number, number] | null = o.exclusion && !o.exclusion.jump ? bandExtent({ ...o.exclusion, offset: 0 }, l.y, l.y + l.height) : [o.box.x, o.box.x + o.box.width];
          if (ext) expect(l.x + l.width <= ext[0] + 1 || l.x >= ext[1] - 1, `${o.name} over "${l.text}"`).toBe(true);
        }
  });

  it("the front headline is fitted", () => {
    const head = lay(1280, 800).scenes[0]!.lines.find((l) => l.style === "front-head");
    expect(head?.size).toBeGreaterThan(0);
  });
});
