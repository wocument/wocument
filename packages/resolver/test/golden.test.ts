/**
 * Golden tests: a fixture, parsed and resolved, must equal the hand-resolved
 * example in packages/resolved-document/examples byte for byte, and hold every
 * invariant. The examples were written before the resolver, from the spec, so
 * a mismatch is either a resolver bug or a finding about the example.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { checkInvariants } from "@wmxdsl/resolved-document";
import { resolve } from "../src/index.js";

const repo = (p: string): string => fileURLToPath(new URL(`../../../${p}`, import.meta.url));

function resolveFixture(name: string) {
  const src = readFileSync(repo(`packages/parser/test/fixtures/${name}.wmx`), "utf8");
  const parsed = parse(src, { file: `${name}.wmx` });
  expect(parsed.diagnostics).toEqual([]);
  return resolve(parsed.ast as Document, { file: `${name}.wmx` });
}

describe("golden: minimum valid file (spec §18)", () => {
  it("resolves to examples/minimum.resolved.json exactly", () => {
    const { doc } = resolveFixture("minimum");
    const golden = readFileSync(repo("packages/resolved-document/examples/minimum.resolved.json"), "utf8");
    expect(`${JSON.stringify(doc, null, 2)}\n`).toBe(golden);
  });

  it("holds every invariant and raises no diagnostics", () => {
    const { doc, diagnostics } = resolveFixture("minimum");
    expect(diagnostics).toEqual([]);
    expect(checkInvariants(doc)).toEqual([]);
  });
});

describe("golden: Stone & Strategy (spec §18), milestone M3", () => {
  /**
   * The example was resolved by hand, from the spec, before this resolver
   * existed. It simplified three things on purpose: text without soft hyphens,
   * illustrative asset sizes and ids, and diagnostic wording. Those are dropped
   * here; everything else (scenes, frames, objects, placements, wraps, reveals,
   * threads, story blocks, runs, styles, linearize) must match exactly.
   */
  const simplified = (doc: unknown): unknown =>
    JSON.parse(JSON.stringify(doc), (key, value) =>
      ["strings", "assets", "diagnostics", "image", "video", "poster", "polygon", "ratio", "s"].includes(key) ? undefined : value,
    );

  it("resolves to examples/stone-and-strategy.resolved.json, asset details aside", () => {
    const src = readFileSync(repo("packages/parser/test/fixtures/stone-and-strategy.wmx"), "utf8");
    const parsed = parse(src, { file: "stone-and-strategy.wmx" });
    expect(parsed.diagnostics).toEqual([]);
    const assets = createAssetHost({ publicDir: repo("packages/playground/public"), sourceDir: repo("packages/parser/test/fixtures") });
    const { doc, diagnostics } = resolve(parsed.ast as Document, { file: "stone-and-strategy.wmx", assets });
    expect(checkInvariants(doc)).toEqual([]);
    const golden = JSON.parse(readFileSync(repo("packages/resolved-document/examples/stone-and-strategy.resolved.json"), "utf8"));
    expect(simplified(doc)).toEqual(simplified(golden));
    // The two linearize warnings the example records, plus the files this repo cannot ship.
    expect(diagnostics.filter((d) => d.code === "W031").map((d) => d.variant)).toEqual(["tablet", "phone"]);
    expect(diagnostics.filter((d) => d.code === "W050").map((d) => d.message.split(" ").at(-1) === "family" || d.message.includes(".mp4"))).toEqual([true, true, true, true]);
  });
});
