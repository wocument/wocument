/**
 * Milestone M4: the three stress-test articles and spec §18's laid out at every
 * test width (spec §15.6), checked by the layout invariants. Fixed-width
 * engine; their media files are missing, so the resolver's placeholder sizes stand in.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here("parser/test/fixtures") });

describe.each(["forty-questions", "stone-and-strategy", "the-last-signalman", "white-desert"])("%s", (name) => {
  const { doc: rd } = resolve(parse(readFileSync(here(`parser/test/fixtures/${name}.wmx`), "utf8")).ast as Document, { assets });

  it.each([360, 768, 1280, 1470, 2560])("holds the layout invariants at %ipx", (width) => {
    layoutInvariants(rd, layout(rd, { width, height: 900 }, new PrepareCache(createFixedEngine())));
  });
});

describe("The Last Signalman", () => {
  it("balanced columns make room for the sidebar beside its paragraph, not in the next scene", () => {
    const { doc } = resolve(parse(readFileSync(here("parser/test/fixtures/the-last-signalman.wmx"), "utf8")).ast as Document, { assets });
    const pd = layout(doc, { width: 1470, height: 900 }, new PrepareCache(createFixedEngine()));
    expect(pd.scenes.find((s) => s.objects.some((o) => o.name === "sidebar-1"))!.name).toBe("two-text");
  });
});
