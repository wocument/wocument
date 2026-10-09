/** Design 2026-09-29: screen pages. Where scrolling settles, which page is current, and hanging hyphens. */

import { describe, expect, it } from "vitest";
import type { PositionedLine } from "@wmxdsl/layout";
import { continuingLines, currentPage, pageStep, screenPoints, snapStops } from "../src/pages.js";

describe("screenPoints", () => {
  it("every screen of a page scene is a point; flow scenes have none", () => {
    const scenes = [
      { y: 0, height: 700, page: false },
      { y: 700, height: 2700, page: true },
      { y: 3400, height: 900, page: true },
    ];
    expect(screenPoints(scenes, 900)).toEqual([700, 1600, 2500, 3400]);
  });
});

describe("snapStops", () => {
  it("every page screen, the top of every other scene, and the end, so nothing is out of reach", () => {
    // A cover, three screens of page, and a 246px colophon after them.
    const scenes = [
      { y: 0, height: 900, page: false },
      { y: 900, height: 2700, page: true },
      { y: 3600, height: 246, page: false },
    ];
    expect(snapStops(scenes, 900)).toEqual([0, 900, 1800, 2700, 2946]);
  });

  it("the end is never past the last scroll position, and no stop repeats", () => {
    expect(snapStops([{ y: 0, height: 1800, page: true }], 900)).toEqual([0, 900]);
  });
});

describe("currentPage", () => {
  it("is the point nearest the scroll position", () => {
    expect(currentPage(1100, [700, 1600, 2500])).toBe(0);
    expect(currentPage(1200, [700, 1600, 2500])).toBe(1);
    expect(currentPage(9999, [700, 1600, 2500])).toBe(2);
  });
});

describe("continuingLines", () => {
  it("a line that carries on a word hyphenated at the end of the line before, in the same block", () => {
    const a = { story: "s", block: 0, text: "calli­" };
    const b = { story: "s", block: 0, text: "graphy and more" };
    const c = { story: "s", block: 1, text: "Next paragraph" };
    const d = { story: "t", block: 0, text: "other story" };
    expect([...continuingLines([a, d, b, c] as unknown as PositionedLine[])]).toEqual([b]);
  });
});

describe("pageStep (2026-10-09)", () => {
  const stops = [0, 900, 1800, 2700];
  it("Space goes to the next page's top, Shift + Space to the one before", () => {
    expect(pageStep(0, 1, stops, 900, 3000)).toBe(900);
    expect(pageStep(1000, 1, stops, 900, 3000)).toBe(1800);
    expect(pageStep(1800, -1, stops, 900, 3000)).toBe(900);
    expect(pageStep(1000, -1, stops, 900, 3000)).toBe(900);
  });
  it("a position within a few pixels of a page counts as on it", () => {
    expect(pageStep(898, 1, stops, 900, 3000)).toBe(1800);
  });
  it("past the last page, or with no pages, it moves most of a screen, within the page", () => {
    expect(pageStep(2700, 1, stops, 900, 3000)).toBe(3000);
    expect(pageStep(500, 1, [], 1000, 5000)).toBe(1400);
    expect(pageStep(100, -1, [], 1000, 5000)).toBe(0);
  });
});
