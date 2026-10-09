/**
 * Alpha contour tracing (spec §12.2): threshold the alpha channel, trace an
 * outline, simplify it, normalize it to the box. Pure: pixels in, points out.
 *
 * The outline is traced row by row: each row's leftmost and rightmost opaque
 * pixel, down the left side and back up the right. That is exactly the shape
 * wrap consumes, because in v1 a band's exclusion is the silhouette's extent
 * across the band, one interval (§12.2). Limit: notches and holes are not
 * traced; add a marching-squares outline when multi-interval bands arrive.
 */

export type AlphaImage = { width: number; height: number; alpha: Uint8Array };
export type Crop = { x: number; y: number; width: number; height: number };

export type TraceOptions = {
  /** 0..1: a pixel is inside when its alpha is at or above this (spec `alpha-threshold`, default 50%). */
  threshold: number;
  /** The part of the image visible in the box, in image pixels; `fit`/`focus` cropping is applied first. */
  crop: Crop;
  /** Upper bound on points after simplification. */
  maxPoints?: number;
};

/**
 * The silhouette as a closed polygon in box coordinates, `[0, 0]` top-left to
 * `[1, 1]` bottom-right, or null when nothing in the crop is transparent (the
 * spec's "opaque image" case: fall back to `rect`).
 */
export function traceAlpha(img: AlphaImage, opts: TraceOptions): [number, number][] | null {
  const { x: cx, y: cy, width: cw, height: ch } = opts.crop;
  const limit = Math.round(opts.threshold * 255);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  let transparent = false;
  for (let y = 0; y < ch; y++) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < cw; x++) {
      const a = img.alpha[(cy + y) * img.width + (cx + x)]!;
      if (a >= limit) {
        if (lo < 0) lo = x;
        hi = x;
      } else transparent = true;
    }
    if (lo < 0) continue;
    // Pixel edges, not centres: the row covers [y, y+1] and the run [lo, hi+1].
    left.push([lo / cw, y / ch], [lo / cw, (y + 1) / ch]);
    right.push([(hi + 1) / cw, y / ch], [(hi + 1) / cw, (y + 1) / ch]);
  }
  if (!transparent || left.length === 0) return null;
  const outline = [...left, ...right.reverse()];
  return simplify(outline, opts.maxPoints ?? 64);
}

/** Douglas-Peucker on a closed outline, tightening the tolerance until it fits the point budget. */
function simplify(points: [number, number][], maxPoints: number): [number, number][] {
  let tolerance = 0.002;
  let out = dp(points, tolerance);
  while (out.length > maxPoints) {
    tolerance *= 1.5;
    out = dp(points, tolerance);
  }
  return out.map(([x, y]) => [round(x), round(y)]);
}

function dp(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let dist = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distance(points[i]!, points[a]!, points[b]!);
      if (d > dist) {
        dist = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function distance([px, py]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The part of an image a box of aspect `ratio` (width / height) shows (spec
 * §11.4): all of it for `contain`, `fill` and `none`, and for `cover` the
 * largest centred-on-focus rectangle of that ratio, clamped to the image.
 */
export function cropFor(w: number, h: number, ratio: number, fit: string, focus: { x: number; y: number }): Crop {
  if (fit !== "cover" || Math.abs(w / h - ratio) < 1e-9) return { x: 0, y: 0, width: w, height: h };
  if (w / h > ratio) {
    const cw = Math.round(h * ratio);
    return { x: Math.round(Math.min(w - cw, Math.max(0, focus.x * w - cw / 2))), y: 0, width: cw, height: h };
  }
  const ch = Math.round(w / ratio);
  return { x: 0, y: Math.round(Math.min(h - ch, Math.max(0, focus.y * h - ch / 2))), width: w, height: ch };
}
