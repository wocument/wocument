/**
 * The visor's model (design 2026-10-21): what the overlay draws on each screen, in document px,
 * from the Positioned Document and its reasons log only. Pure: no DOM.
 */

import type { Decision, Explanation, PositionedDocument, PositionedScene } from "@wmxdsl/layout";

export type Layer = "flow" | "pictures" | "space" | "lines";

/** The layers the visor shows when none are asked for: lines and words stay off until switched on. */
export const DEFAULT_LAYERS: readonly Layer[] = ["flow", "pictures", "space"];

export type Shape = {
  layer: Layer;
  kind: "column-tint" | "baseline" | "bottom-line" | "gap" | "marker" | "outline" | "anchor-link" | "badge" | "line-mark";
  /** For `anchor-link`: the anchor point; `width`/`height` are the signed run to the picture's top left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  ringed?: boolean;
  number?: number;
  /** Index into the screen's `decisions`. */
  decision?: number;
};

/** One screen of a paged scene, or a whole scrolling scene (`screen` null). */
export type ScreenModel = { screen: number | null; scene: string; top: number; height: number; shapes: Shape[]; decisions: Decision[] };

const EPS = 0.5;
export const MARKER = 14;
const PLAIN = new Set(["bottom-line", "story-end"]);
const linesOf = (n: number): string => `${n} line${n === 1 ? "" : "s"}`;

export function buildModel(pd: PositionedDocument, explain: Explanation): ScreenModel[] {
  const vh = pd.viewport.height;
  const out: ScreenModel[] = [];
  for (const ps of pd.scenes) {
    const log = explain.scenes.find((s) => s.scene === ps.name)?.decisions ?? [];
    if (!ps.paged) {
      out.push(screen(ps, null, ps.y, ps.height, log));
      continue;
    }
    const count = Math.max(1, Math.round(ps.height / vh));
    for (let k = 0; k < count; k++) {
      const top = ps.y + k * vh;
      const n = Math.floor((top + 1e-6) / vh) + 1;
      // A decision with no screen (none expected in a paged scene) goes by where it is drawn.
      const mine = log.filter((d) => (d.screen ?? Math.floor((d.at.y + 1e-6) / vh) + 1) === n);
      out.push(screen(ps, n, top, vh, mine));
    }
  }
  return out;
}

function screen(ps: PositionedScene, n: number | null, top: number, height: number, decisions: Decision[]): ScreenModel {
  const g = ps.grid;
  const foot = top + height;
  const inside = (y: number): boolean => y >= top - EPS && y < foot - EPS;
  const shapes: Shape[] = [];

  // Grid and space: columns, baselines, the bottom line.
  const [areaTop, areaFoot] = n === null ? [top, foot] : [top + g.marginY, foot - g.marginY];
  for (let i = 0; i < g.cols; i++) shapes.push({ layer: "space", kind: "column-tint", x: g.originX + i * (g.colWidth + g.gutter), y: areaTop, width: g.colWidth, height: areaFoot - areaTop });
  const here = ps.lines.filter((l) => inside(l.y));
  // Baselines count from a snapped line on this screen; layout does not report the grid's origin.
  const phase = here.find((l) => l.snapped)?.baseline ?? areaTop;
  const first = phase - Math.floor((phase - areaTop) / g.baseline) * g.baseline;
  for (let y = first; y <= areaFoot + 1e-6; y += g.baseline) shapes.push({ layer: "space", kind: "baseline", x: g.originX, y, width: g.content, height: 0 });
  if (n !== null) shapes.push({ layer: "space", kind: "bottom-line", x: g.originX, y: foot - g.marginY, width: g.content, height: 0, label: "bottom line" });

  // Empty runs of a baseline or more inside a column, between content. A run before a new block's
  // first line is the space its style asks for, not a gap.
  type Span = { from: number; to: number; line?: (typeof here)[number] };
  const columns = new Map<string, { x: number; right: number; spans: Span[] }>();
  for (const l of here) {
    const key = `${l.frame}\u0000${l.column}`;
    const c = columns.get(key) ?? { x: l.x, right: l.x + l.width, spans: [] };
    c.x = Math.min(c.x, l.x);
    c.right = Math.max(c.right, l.x + l.width);
    c.spans.push({ from: l.y, to: l.y + l.height, line: l });
    columns.set(key, c);
  }
  for (const c of columns.values()) {
    // Objects count only inside the column's run of lines, so one above or below the text makes no gap.
    const lo = Math.min(...c.spans.map((sp) => sp.from));
    const hi = Math.max(...c.spans.map((sp) => sp.to));
    for (const o of ps.objects) {
      const [from, to] = [Math.max(o.box.y, lo), Math.min(o.box.y + o.box.height, hi)];
      if (o.box.x < c.right - EPS && o.box.x + o.box.width > c.x + EPS && to > from) c.spans.push({ from, to });
    }
    c.spans.sort((a, b) => a.from - b.from);
    let last = c.spans[0]!;
    for (const sp of c.spans.slice(1)) {
      const gap = sp.from - last.to;
      // ponytail: any run between two text blocks counts as style space; compare with the styles' space-before/after if a real hole ever hides there.
      const styled = sp.line?.paragraphStart && last.line && last.line.block !== sp.line.block;
      if (gap >= g.baseline - EPS && !styled) shapes.push({ layer: "space", kind: "gap", x: c.x, y: last.to, width: c.right - c.x, height: gap, label: linesOf(Math.round(gap / g.baseline)) });
      if (sp.to > last.to) last = sp;
    }
  }

  // The decisions, in the order the engine made them.
  let ringed = 0;
  decisions.forEach((d, i) => {
    const at = d.at;
    if (d.kind === "column-end") {
      const plain = PLAIN.has(d.reason);
      shapes.push({ layer: "flow", kind: "marker", x: at.x + at.width + 2, y: at.y + at.height - MARKER, width: MARKER, height: MARKER, label: d.reason, ringed: !plain, ...(plain ? {} : { number: ++ringed }), decision: i });
    } else if (d.kind === "picture") {
      const name = d.refs.objects?.[0] ?? "";
      const col = (x: number): number => Math.min(g.cols, Math.max(1, Math.floor((x - g.originX + EPS) / (g.colWidth + g.gutter)) + 1));
      shapes.push({ layer: "pictures", kind: "outline", ...at, label: `${name} · ${Math.round(at.width)}×${Math.round(at.height)} · cols ${col(at.x)}-${col(at.x + at.width - 2 * EPS)}`, decision: i });
      shapes.push({ layer: "pictures", kind: "badge", x: at.x, y: at.y, width: 0, height: 0, label: d.numbers.score === undefined ? d.reason : `${d.reason} · score ${Math.round(d.numbers.score)}`, decision: i });
      const anchor = anchorOf(ps, d, name);
      if (anchor) shapes.push({ layer: "pictures", kind: "anchor-link", x: anchor.x, y: anchor.y, width: at.x - anchor.x, height: at.y - anchor.y, decision: i });
    } else if (d.kind === "space") {
      const label =
        d.reason === "slot-too-narrow" ? `${Math.round(d.numbers.width ?? 0)}px < ${Math.round(d.numbers.min ?? 0)}px`
        : d.reason === "early-end" ? `${linesOf(d.numbers.lines ?? 0)} short`
        : `${d.reason} ${Math.round(d.numbers.px ?? 0)}px`;
      shapes.push({ layer: "space", kind: d.reason === "cropped" || d.reason === "grown" ? "outline" : "gap", ...at, label, decision: i });
    } else {
      shapes.push({ layer: "lines", kind: "line-mark", ...at, label: d.reason, decision: i });
    }
  });
  return { screen: n, scene: ps.name, top, height, shapes, decisions };
}

/** Where the picture's anchor sits in the text: its anchor line (`anchoredAt`), at the start of the anchor block's nearest line. */
function anchorOf(ps: PositionedScene, d: Decision, name: string): { x: number; y: number } | null {
  const block = d.refs.blocks?.[0];
  const y = ps.objects.find((o) => o.name === name)?.anchoredAt ?? null;
  const candidates = ps.lines.filter((l) => l.block === block && (d.frame === null || l.frame === d.frame));
  if (candidates.length === 0) return y === null ? null : { x: d.at.x, y };
  const near = y === null ? candidates[0]! : candidates.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a));
  return { x: near.x, y: y ?? near.y };
}
