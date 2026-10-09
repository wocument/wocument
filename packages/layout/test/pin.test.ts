/**
 * §11.3 pin and reflow. The spread's pull quote is pinned
 * and the frame reflowed; the reflow slides lines under a second object that cut
 * into nothing on the first pass. With a single reflow those lines ran through
 * it (9 of them at 1600x1080). The document is the spread of 2026-09-25,
 * frozen in test/fixtures. Photos are left missing on purpose, so the
 * resolver's placeholder sizes stand in and the case does not depend on files
 * that are not in git.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { bandExtent, layout } from "../src/index.js";

const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));

it("sets the frame again when a reflow slides lines under another object", () => {
  // A frozen copy of the spread as it was when the bug was found, so the playground document can keep changing.
  const ast = parse(readFileSync(here("layout/test/fixtures/r27-spread.wmx"), "utf8")).ast as Document;
  const assets = createAssetHost({ publicDir: here("layout/test"), sourceDir: here("playground/docs") });
  const rd = resolve(ast, { assets }).doc;
  const pd = layout(rd, { width: 1600, height: 1080 }, new PrepareCache(createFixedEngine()));
  const v = rd.variants[pd.breakpoint]!;
  const through: string[] = [];
  for (const s of pd.scenes)
    for (const o of s.objects.filter((o) => o.exclusion && !o.exclusion.jump))
      for (const l of s.lines.filter((l) => v.frames[l.frame])) {
        // The bare shape, not the standoff: the standoff is a different question.
        const ext = bandExtent({ ...o.exclusion!, offset: 0 }, l.y, l.y + l.height);
        if (ext && l.x + l.width > ext[0] + 0.5 && l.x < ext[1] - 0.5) through.push(`${o.name}: "${l.text}"`);
      }
  expect(through).toEqual([]);
});
