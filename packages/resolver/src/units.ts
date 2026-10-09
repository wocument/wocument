/**
 * Source lengths to Resolved Document lengths (spec §06.3).
 *
 * `rem` and `em` are eliminated; `bl` is eliminated only where a grid's own
 * baseline is known; `vw`, `vh`, `%`, `col` and `fluid` stay symbolic because
 * they need the viewport or the scene's grid.
 */

import type { Len } from "@wmxdsl/resolved-document";
import type { Value } from "@wmxdsl/schema";

/** Root font size for `rem`. */
export const REM_PX = 16;

/** Where two-argument `fluid()` starts interpolating (spec §06.3). */
export const FLUID_FROM = 360;

/**
 * Derived lengths are rounded to 4 decimal places, so `1.05em` of 36px is 37.8,
 * not 37.800000000000004, on every platform. A ten-thousandth of a CSS pixel is
 * far below anything a layout can show.
 */
export const round = (n: number): number => Math.round(n * 1e4) / 1e4 + 0;

export type LenContext = {
  /** What `em` is relative to: a style's own size. `null` means the root. */
  em: Len | null;
  /** A grid's baseline in px when resolving inside a grid definition, else null (bl stays symbolic). */
  baseline: number | null;
  /** Where two-argument `fluid()` ends: grid `default`'s max at this breakpoint. */
  fluidTo: number;
};

export function toLen(v: Value, ctx: LenContext): Len {
  if (v.t === "fluid") {
    const px = (x: Value): number => {
      const l = toLen(x, ctx);
      if (l.u !== "px") throw new Error(`fluid() bounds must be absolute, got ${x.raw}`);
      return l.n;
    };
    const min = px(v.min);
    const max = px(v.max);
    // A fluid value that does not change is a constant.
    if (min === max) return { u: "px", n: min };
    return { u: "fluid", min, max, from: v.from ? px(v.from) : FLUID_FROM, to: v.to ? px(v.to) : ctx.fluidTo };
  }
  if (v.t === "percentage") return { u: "pct", n: v.n };
  if (v.t !== "length") throw new Error(`not a length: ${v.raw}`);
  const n = v.n;
  switch (v.unit) {
    case "px":
      return { u: "px", n: round(n) };
    case "rem":
      return { u: "px", n: round(n * REM_PX) };
    case "em":
      return scale(ctx.em ?? { u: "px", n: REM_PX }, n);
    case "bl":
      return ctx.baseline === null ? { u: "bl", n } : { u: "px", n: round(n * ctx.baseline) };
    case "col":
      return { u: "col", n };
    case "vw":
    case "vh":
      return { u: v.unit, n };
    case "%":
      return { u: "pct", n };
  }
}

/** `k` times a length. Exact for fluid: k·fluid(a, b) is fluid(k·a, k·b) over the same range. */
function scale(base: Len, k: number): Len {
  switch (base.u) {
    case "fluid": {
      const min = round(base.min * k);
      const max = round(base.max * k);
      return min === max ? { u: "px", n: min } : { ...base, min, max };
    }
    case "px":
      return { u: "px", n: round(base.n * k) };
    default:
      // A font size in vw, bl, col or %: scale it symbolically.
      return { ...base, n: round(base.n * k) };
  }
}

/** A length that must be absolute px here, such as a breakpoint bound or a grid baseline. */
export function toPx(v: Value, ctx: LenContext): number {
  const l = toLen(v, ctx);
  if (l.u !== "px") throw new Error(`expected an absolute length, got ${v.raw}`);
  return l.n;
}
