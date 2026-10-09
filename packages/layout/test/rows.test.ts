/** Row packing (design 2026-09-26), from the design's worked examples and edge cases. */
import { describe, expect, it } from "vitest";
import { packRows, type RowItem } from "../src/rows.js";

const fill = (min: number, max = 99): RowItem => ({ min, max, fixed: false });
const fixed = (w: number): RowItem => ({ min: w, max: w, fixed: true });
const spans = (items: RowItem[], n: number): number[][] => packRows(items, n).map((r) => r.map((s) => s.span));

describe("packRows", () => {
  const photos = [1, 2, 3, 4, 5].map(() => fill(3));

  it("five photos of min 3: a short last row keeps the columns of the row above", () => {
    expect(spans(photos, 12)).toEqual([[3, 3, 3, 3], [3]]);
    expect(spans(photos, 8)).toEqual([[4, 4], [4, 4], [4]]);
    expect(spans(photos, 4)).toEqual([[4], [4], [4], [4], [4]]);
  });

  it("minimums 2, 3, 5: spare columns shared evenly, extras to the earliest", () => {
    expect(spans([fill(2), fill(3), fill(5)], 12)).toEqual([[3, 4, 5]]);
    // 8 columns: [2, 3] share 3 as +2 +1; the last row [5] grows by the per-child growth, floor(3 / 2) = 1.
    expect(spans([fill(2), fill(3), fill(5)], 8)).toEqual([[4, 4], [6]]);
  });

  it("a child at its maximum drops out and the others take its share", () => {
    expect(spans([fill(3, 3), fill(3)], 12)).toEqual([[3, 9]]);
    // Nobody can take the rest: it stays empty at the row's end.
    expect(spans([fill(2, 3), fill(2, 4)], 12)).toEqual([[3, 4]]);
  });

  it("a fixed child neither shrinks nor grows", () => {
    expect(spans([fixed(3), fill(2)], 12)).toEqual([[3, 9]]);
    expect(spans([fixed(3), fixed(4)], 12)).toEqual([[3, 4]]);
  });

  it("clamps a child wider than the row, and never splits one", () => {
    expect(spans([fill(7), fill(4, 5)], 4)).toEqual([[4], [4]]);
    expect(spans([fill(20)], 12)).toEqual([[12]]);
  });

  it("the spread opener: 7 + 4 on 12, one row each on 8", () => {
    const opener = [fill(7), fill(4, 5)];
    expect(spans(opener, 12)).toEqual([[8, 4]]);
    // The stack takes the first row whole; the photo's last row grows by 1 of its possible 1.
    expect(spans(opener, 8)).toEqual([[8], [5]]);
  });

  it("keeps source order and reports indices", () => {
    expect(packRows([fill(6), fill(6), fill(6)], 12).map((r) => r.map((s) => s.index))).toEqual([[0, 1], [2]]);
  });
});
