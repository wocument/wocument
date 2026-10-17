/**
 * The picture composition module (docs/superpowers/specs/2026-10-17-picture-composition-design.md,
 * "How the engine chooses"): candidate spots, hard rules, penalties and the bounded search.
 */
import { describe, expect, it } from "vitest";
import type { Spot } from "@wmxdsl/resolved-document";
import { candidates, choose, hardOk, type Candidate, type Float, type ScreenGeometry, type TrialSummary } from "../src/compose.js";

const geometry = (count: number, over: Partial<ScreenGeometry> = {}): ScreenGeometry => ({
  index: 1,
  top: 56,
  foot: 900,
  band: 844,
  columns: Array.from({ length: count }, (_, i) => ({ x: i * 324, width: 300 })),
  baseline: 28,
  origin: 56,
  ...over,
});
const g3 = geometry(3);

const float = (over: Partial<Float> = {}): Float => ({
  id: "f",
  order: 0,
  sizes: ["column"],
  place: "float",
  kind: "picture",
  anchorScreen: 1,
  anchorColumn: 0,
  heightAt: (w) => Math.round(w * 0.6),
  crops: false,
  ...over,
});

const spot = (size: Spot["size"], place: Spot["place"], span: Spot["span"] = { kind: "count", from: 1, to: 1 }): Spot => ({ size, place, span, side: null });
const VANILLA: Spot[] = [
  spot("hero", "top", { kind: "all" }),
  spot("hero", "top", { kind: "all-but-one" }),
  spot("wide", "top", { kind: "count", from: 2, to: 3 }),
  spot("wide", "bottom", { kind: "count", from: 2, to: 3 }),
  spot("column", "top"),
  spot("column", "bottom"),
  spot("column", "anchor"),
  { size: "small", place: "anchor", span: { kind: "count", from: 1, to: 1 }, side: "left" },
  { size: "small", place: "anchor", span: { kind: "count", from: 1, to: 1 }, side: "right" },
];

const boxes = (cs: Candidate[]) => cs.filter((c) => "box" in c);
const fine = (over: Partial<TrialSummary> = {}): TrialSummary => ({ allSet: true, overlaps: false, stubs: false, feet: [900, 900, 900], last: false, alone: false, ...over });

describe("candidates", () => {
  it("wide at top spans 2 or 3 columns", () => {
    const cs = boxes(candidates(float({ sizes: ["wide"] }), [spot("wide", "top", { kind: "count", from: 2, to: 3 })], g3));
    expect(cs.map((c) => [c.first, c.span])).toEqual([[0, 2], [1, 2], [0, 3]]);
  });

  it("spans clip to the columns there are", () => {
    const g2 = geometry(2);
    // all-but-one of two columns is one column, at each start where it fits (controller ruling).
    const hero = boxes(candidates(float({ sizes: ["hero"] }), [spot("hero", "top", { kind: "all-but-one" })], g2));
    expect(hero.length).toBeGreaterThan(0);
    expect(hero.every((c) => c.span === 1)).toBe(true);
    const wide = boxes(candidates(float({ sizes: ["wide"] }), [spot("wide", "top", { kind: "count", from: 2, to: 3 })], g2));
    expect(wide.map((c) => [c.first, c.span])).toEqual([[0, 2]]);
    const one = boxes(candidates(float({ sizes: ["hero"] }), [spot("hero", "top", { kind: "all-but-one" })], geometry(1)));
    expect(one.map((c) => [c.first, c.span])).toEqual([[0, 1]]);
  });

  it("a box over 85% of the band is no candidate", () => {
    const cs = boxes(candidates(float({ sizes: ["hero", "wide", "column"], heightAt: () => 800 }), VANILLA, g3));
    expect(cs.filter((c) => c.spot.place === "top")).toEqual([]);
  });

  it("top and bottom boxes sit on grid lines", () => {
    const g = geometry(3, { origin: 50, top: 60 });
    for (const crops of [false, true]) {
      const cs = boxes(candidates(float({ sizes: ["hero", "wide", "column"], heightAt: (w) => Math.round(w * 0.37) + 3, crops }), VANILLA, g));
      expect(cs.length).toBeGreaterThan(0);
      for (const c of cs) {
        expect((c.box.y - g.origin) % 28).toBe(0);
        expect(c.box.y).toBeGreaterThanOrEqual(g.top);
        expect(c.box.y + c.box.height).toBeLessThanOrEqual(g.foot);
      }
    }
  });

  it("a crop grown to the foot stays within 85% of the band", () => {
    const cs = boxes(candidates(float({ sizes: ["column"], heightAt: () => 716, crops: true }), [spot("column", "bottom")], g3));
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) expect(c.box.height).toBeLessThanOrEqual(0.85 * g3.band);
  });

  it("wait only inside the window", () => {
    const waits = (anchorScreen: number) => candidates(float({ anchorScreen }), VANILLA, g3).filter((c) => "wait" in c);
    expect(waits(g3.index - 1)).toEqual([]);
    expect(waits(g3.index)).toEqual([{ id: "f", wait: true }]);
  });
});

describe("hard rules", () => {
  it("one hero per screen", () => {
    const [heroLeft] = boxes(candidates(float({ id: "a", sizes: ["hero"] }), [spot("hero", "top", { kind: "count", from: 1, to: 1 })], g3));
    const heroRight = boxes(candidates(float({ id: "b", sizes: ["hero"] }), [spot("hero", "top", { kind: "count", from: 1, to: 1 })], g3))[2];
    const col = boxes(candidates(float({ id: "b" }), [spot("column", "top")], g3))[2];
    const floats = [float({ id: "a", sizes: ["hero"] }), float({ id: "b", order: 1, sizes: ["hero", "column"] })];
    expect(hardOk([heroLeft!, heroRight!], floats, g3, fine())).toBe(false);
    expect(hardOk([heroLeft!, col!], floats, g3, fine())).toBe(true);
  });
});

describe("choose", () => {
  const sixSpots = [spot("column", "top"), spot("column", "bottom")];
  const four = [0, 1, 2, 3].map((i) => float({ id: `f${i}`, order: i, anchorScreen: 0, heightAt: () => 100 }));

  it("choose stays within budget", () => {
    for (const f of four) expect(candidates(f, sixSpots, g3)).toHaveLength(6);
    for (const allSet of [true, false]) {
      let calls = 0;
      choose(four, sixSpots, g3, () => (calls++, fine({ allSet })), null);
      expect(calls).toBeLessThanOrEqual(40);
      if (!allSet) expect(calls).toBe(40);
    }
  });

  it("choose prefers the anchor's column", () => {
    const f = float({ anchorColumn: 2 });
    const run = () => choose([f], [spot("column", "top")], g3, () => fine(), null);
    const got = run();
    expect(got && "box" in got.combo[0]! ? got.combo[0].first : null).toBe(2);
    expect(run()).toEqual(got);
  });

  it("no valid combination gives null", () => {
    expect(choose(four, sixSpots, g3, () => fine({ allSet: false }), null)).toBeNull();
  });

  it("ties go to story order", () => {
    const a = float({ id: "a", order: 0, anchorColumn: 1, anchorScreen: 0 });
    const b = float({ id: "b", order: 1, anchorColumn: 1, anchorScreen: 0 });
    for (const floats of [[a, b], [b, a]]) {
      const got = choose(floats, [spot("column", "top")], g3, () => fine(), null);
      const at = Object.fromEntries((got?.combo ?? []).map((c) => [c.id, "box" in c ? c.first : -1]));
      expect(at).toEqual({ a: 0, b: 1 });
    }
  });
});
