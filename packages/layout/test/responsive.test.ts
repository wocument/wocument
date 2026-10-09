/**
 * Readability on a bigger canvas: `max-width` stops an
 * object growing with the grid, and `columns=auto` picks the number of
 * internal columns from the measure instead of a hand-set number per
 * breakpoint.
 */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout, type PositionedScene } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const LONG = Array.from({ length: 60 }, () => "Stone endures where nearly everything else decays.").join(" ");

function scene(body: string, width = 1470): PositionedScene {
  const { doc } = resolve(parse(FM + body).ast as Document);
  return layout(doc, { width, height: 900 }, new PrepareCache(createFixedEngine())).scenes[0]!;
}

describe("max-width on a grid-placed object (§11.1)", () => {
  const doc = (attrs: string) => `\\scene{\\sidebar[cols=1-6${attrs}]{Aside.}\n\\frame[cols=1-12]{${LONG}}}`;

  it("caps the box and keeps the centre of the columns it was given", () => {
    const free = scene(doc("")).objects.find((o) => o.name === "sidebar-1")!;
    const capped = scene(doc(", max-width=300px")).objects.find((o) => o.name === "sidebar-1")!;
    expect(free.box.width).toBeGreaterThan(300);
    expect(capped.box.width).toBe(300);
    // Same centre, so the room it gives back is shared by both sides.
    expect(capped.box.x + capped.box.width / 2).toBeCloseTo(free.box.x + free.box.width / 2, 6);
  });

  it("is a cap, not a width: a span narrower than the cap is left alone", () => {
    const s = scene(doc(", max-width=3000px")).objects.find((o) => o.name === "sidebar-1")!;
    expect(s.box.width).toBe(scene(doc("")).objects.find((o) => o.name === "sidebar-1")!.box.width);
  });

});

describe("max-width on an anchored object (§11.3)", () => {
  const doc = (attrs: string) =>
    `\\story[name=s]{Opening line of the story.\n\n\\pullquote[cols=3-10${attrs}]{Quoted.}\n\n${LONG}}\n\\scene{\\frame[story=s, cols=1-12, columns=2]}`;

  it("caps the box and keeps the centre of its columns", () => {
    const free = scene(doc("")).objects.find((o) => o.name === "pullquote-1")!;
    const capped = scene(doc(", max-width=260px")).objects.find((o) => o.name === "pullquote-1")!;
    expect(free.box.width).toBeGreaterThan(260);
    expect(capped.box.width).toBe(260);
    expect(capped.box.x + capped.box.width / 2).toBeCloseTo(free.box.x + free.box.width / 2, 6);
  });

  it("gives the room back to the text beside it", () => {
    const beside = (attrs: string) => {
      const s = scene(doc(attrs));
      const o = s.objects.find((x) => x.name === "pullquote-1")!;
      const band = s.lines.filter((l) => l.frame !== "pullquote-1" && l.y >= o.box.y && l.y + l.height <= o.box.y + o.box.height);
      return Math.max(...band.map((l) => l.width));
    };
    expect(beside(", max-width=260px")).toBeGreaterThan(beside(""));
  });

  it("the cap is in force in the first pass too, so pin-and-reflow sees the smaller shape", () => {
    const s = scene(doc(", max-width=260px"));
    const o = s.objects.find((x) => x.name === "pullquote-1")!;
    const band = s.lines.filter((l) => l.frame !== "pullquote-1" && l.y < o.box.y + o.box.height && l.y + l.height > o.box.y);
    for (const l of band) expect(l.x + l.width <= o.box.x + 1e-6 || l.x >= o.box.x + o.box.width - 1e-6).toBe(true);
  });
});

describe("columns=auto (§09.2)", () => {
  const doc = (attrs: string) => `\\grid[max=4000px]\n\\scene{\\frame[cols=1-12, columns=auto${attrs}]{${LONG}}}`;
  const columns = (s: PositionedScene): number => new Set(s.lines.map((l) => l.column)).size;

  it("splits the frame so no column is wider than the measure", () => {
    const s = scene(doc(", measure=300px"), 1470);
    expect(Math.max(...s.lines.map((l) => l.width))).toBeLessThanOrEqual(300);
    expect(columns(s)).toBeGreaterThan(1);
  });

  it("a wider screen gets more columns, not longer lines", () => {
    const narrow = scene(doc(", measure=300px"), 1000);
    const wide = scene(doc(", measure=300px"), 2560);
    expect(columns(wide)).toBeGreaterThan(columns(narrow));
    expect(Math.max(...wide.lines.map((l) => l.width))).toBeLessThanOrEqual(300);
  });

  it("without a measure it aims at 32 times the text size", () => {
    const s = scene(`\\grid[max=4000px]\n\\style[name=body, size=20px]\n\\scene{\\frame[cols=1-12, columns=auto]{${LONG}}}`, 2560);
    expect(columns(s)).toBeGreaterThan(1);
    // 32em of 20px type is 640px; no column may be wider.
    expect(Math.max(...s.lines.map((l) => l.width))).toBeLessThanOrEqual(640);
  });

  it("never goes below one column, however narrow the frame", () => {
    const s = scene(`\\scene{\\frame[cols=1-2, columns=auto, measure=600px]{${LONG}}}`, 360);
    expect(columns(s)).toBe(1);
  });
});

