/**
 * Resolved Document lengths to pixels at one viewport (spec §06.3). The only
 * place viewport-dependent arithmetic on `Len` happens; the renderer uses it
 * too, so layout and rendering can never disagree about a size.
 */

import type { Grid, Len, ResolvedStyle } from "@wmxdsl/resolved-document";
import type { EngineFont } from "@wmxdsl/text-engine";
import type { GridGeometry } from "./positioned.js";

export type Viewport = { width: number; height: number };

export type EvalContext = {
  viewport: Viewport;
  /** The grid of the scene the value is used in; needed for `col` and `bl`. */
  grid: GridGeometry | null;
  /** The px size `pct` is a percentage of. */
  pctOf: number;
};

export function px(l: Len, c: EvalContext): number {
  switch (l.u) {
    case "px":
      return l.n;
    case "vw":
      return (l.n / 100) * c.viewport.width;
    case "vh":
      return (l.n / 100) * c.viewport.height;
    case "pct":
      return (l.n / 100) * c.pctOf;
    case "col":
      if (!c.grid) throw new Error("`col` needs a grid");
      // n columns include the n-1 gutters between them (§06.3).
      return l.n * c.grid.colWidth + Math.max(0, l.n - 1) * c.grid.gutter;
    case "bl":
      if (!c.grid) throw new Error("`bl` needs a grid");
      return l.n * c.grid.baseline;
    case "fluid": {
      const t = Math.min(1, Math.max(0, (c.viewport.width - l.from) / (l.to - l.from)));
      return l.min + (l.max - l.min) * t;
    }
  }
}

/** §07.5: C = min(W - 2*margin-x, max); column width = (C - (cols-1)*gutter) / cols; origin x = (W - C) / 2. */
export function gridGeometry(g: Grid, viewport: Viewport): GridGeometry {
  const c: EvalContext = { viewport, grid: null, pctOf: viewport.width };
  const gutter = px(g.gutter, c);
  const marginX = px(g.marginX, c);
  const max = px(g.max, c);
  const content = Math.min(viewport.width - 2 * marginX, max);
  return {
    cols: g.cols,
    gutter,
    marginX,
    marginY: px(g.marginY, c),
    max,
    baseline: g.baseline,
    rows: g.rows,
    rowGap: px(g.rowGap, c),
    body: [g.body.from, g.body.to],
    viewport: viewport.width,
    content,
    originX: (viewport.width - content) / 2,
    // A percentage is of the side margin: 50% reaches halfway to the screen's edge.
    outdent: Math.max(0, Math.min(px(g.outdent, { ...c, pctOf: (viewport.width - content) / 2 }), (viewport.width - content) / 2)),
    colWidth: (content - (g.cols - 1) * gutter) / g.cols,
  };
}

/** The x and width of a column range, 1-based inclusive. */
export function span(g: GridGeometry, from: number, to: number): { x: number; width: number } {
  const x = g.originX + (from - 1) * (g.colWidth + g.gutter);
  return { x, width: (to - from + 1) * g.colWidth + (to - from) * g.gutter };
}

/** A style's font at this viewport: what the text engine measures with. */
export function engineFont(s: ResolvedStyle, c: EvalContext): EngineFont {
  return { family: s.family, weight: s.weight, italic: s.italic, size: px(s.size, c), tracking: px(s.tracking, c) };
}
