/** Alpha contour tracing (spec §12.2), on synthetic alpha masks. */

import { describe, expect, it } from "vitest";
import { cropFor, traceAlpha } from "../src/contour.js";

/** A w×h alpha mask from a predicate over pixel centres. */
function mask(w: number, h: number, opaque: (x: number, y: number) => boolean): { width: number; height: number; alpha: Uint8Array } {
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alpha[y * w + x] = opaque(x + 0.5, y + 0.5) ? 255 : 0;
  return { width: w, height: h, alpha };
}

/** Horizontal extent of a normalized polygon at height y (0..1). */
function extentAt(points: [number, number][], y: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    if ((y1 <= y && y2 >= y) || (y2 <= y && y1 >= y)) xs.push(y1 === y2 ? x1 : x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
  }
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

describe("traceAlpha", () => {
  it("a centred disc traces to a closed, normalized outline that follows its edge", () => {
    const m = mask(200, 200, (x, y) => (x - 100) ** 2 + (y - 100) ** 2 < 80 ** 2);
    const poly = traceAlpha(m, { threshold: 0.5, crop: { x: 0, y: 0, width: 200, height: 200 } })!;
    expect(poly.length).toBeGreaterThanOrEqual(3);
    for (const [x, y] of poly) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    // At the equator the disc spans 20..180 of 200: 0.1..0.9.
    const [lo, hi] = extentAt(poly, 0.5)!;
    expect(lo).toBeCloseTo(0.1, 1);
    expect(hi).toBeCloseTo(0.9, 1);
    // Near the top it is much narrower.
    const [tlo, thi] = extentAt(poly, 0.15)!;
    expect(thi - tlo).toBeLessThan(0.5);
  });

  it("stays within a point budget", () => {
    const m = mask(400, 400, (x, y) => (x - 200) ** 2 + (y - 200) ** 2 < 180 ** 2);
    expect(traceAlpha(m, { threshold: 0.5, crop: { x: 0, y: 0, width: 400, height: 400 }, maxPoints: 48 })!.length).toBeLessThanOrEqual(48);
  });

  it("an image with no transparency has no contour (the caller falls back to rect)", () => {
    const m = mask(50, 50, () => true);
    expect(traceAlpha(m, { threshold: 0.5, crop: { x: 0, y: 0, width: 50, height: 50 } })).toBeNull();
  });

  it("a crop is applied before tracing, so the contour is in the cropped box's coordinates", () => {
    // Opaque square in the right half only; crop to the right half: it fills the box.
    const m = mask(200, 100, (x) => x >= 100);
    const poly = traceAlpha(m, { threshold: 0.5, crop: { x: 100, y: 0, width: 100, height: 100 } });
    expect(poly).toBeNull(); // fully opaque inside the crop
    const half = traceAlpha(m, { threshold: 0.5, crop: { x: 50, y: 0, width: 100, height: 100 } })!;
    expect(extentAt(half, 0.5)![0]).toBeCloseTo(0.5, 1);
  });
});

describe("cropFor (fit=cover with focus)", () => {
  it("a wide image in a square box crops its sides around the focus", () => {
    expect(cropFor(400, 200, 1, "cover", { x: 0.5, y: 0.5 })).toEqual({ x: 100, y: 0, width: 200, height: 200 });
    expect(cropFor(400, 200, 1, "cover", { x: 0, y: 0.5 })).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });

  it("contain and a matching ratio keep the whole image", () => {
    expect(cropFor(400, 200, 2, "cover", { x: 0.5, y: 0.5 })).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(cropFor(400, 200, 1, "contain", { x: 0.5, y: 0.5 })).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });
});
