/**
 * The bottom line (2026-10-17): a page scene's grid counts up from each screen's bottom line (the
 * screen's foot less margin-y), so every full column ends exactly there, on every page and every
 * screen size. A page that ends early (the rule that keeps columns level) is short by whole lines.
 */
import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wocument/parser";
import { resolve } from "@wocument/resolver";
import { PrepareCache, createFixedEngine } from "@wocument/text-engine";
import { layout } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const FM = "---\nwocument: 1\ntitle: T\n---\n";
const STORY = Array.from({ length: 40 }, () => "Stone endures where nearly everything else decays, and the keepers wrote it down every night.").join(" ");

describe("the bottom line", () => {
  it.each([[1024, 768], [1280, 800], [1470, 956], [1920, 1080], [2560, 1440]])("at %ix%i every full column of every full page ends on it", (width, height) => {
    const { doc } = resolve(parse(`${FM}\\story[name=s]{${[1, 2, 3, 4, 5, 6].map(() => STORY).join("\n\n")}}\n\\scene[height=page]{\\frame[story=s, cols=1-12, columns=3]}`).ast as Document);
    const pd = layout(doc, { width, height }, new PrepareCache(createFixedEngine()));
    layoutInvariants(doc, pd);
    const s = pd.scenes[0]!;
    const pages = s.height / height;
    expect(pages).toBeGreaterThan(2);
    for (let p = 0; p < pages - 1; p++) {
      const foot = (p + 1) * height - s.grid.marginY;
      const ls = s.lines.filter((l) => Math.floor(l.y / height) === p);
      for (const c of new Set(ls.map((l) => l.column))) {
        const last = ls.filter((l) => l.column === c).at(-1)!;
        const short = (foot - (last.y + last.height)) / s.grid.baseline;
        expect(short, `page ${p + 1}, column ${c + 1}`).toBeCloseTo(Math.round(short), 6); // whole lines
        expect(Math.round(short)).toBeLessThanOrEqual(6);
      }
      // Plain text: nothing ends a page early, so every column reaches the line.
      const ends = [...new Set(ls.map((l) => l.column))].map((c) => ls.filter((l) => l.column === c).at(-1)!);
      for (const l of ends) expect(l.y + l.height).toBeCloseTo(foot, 6);
    }
  });
});
