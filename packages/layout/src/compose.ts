/**
 * Picture composition, 2026-10-17: where the floating objects of one screen go.
 * Design: docs/superpowers/specs/2026-10-17-picture-composition-design.md, "How the engine chooses".
 *
 * Pure: no DOM, no clocks, no randomness. The caller lays a screen out with a combination's boxes
 * (`tryLayout`) and summarises the result; this module makes the candidates, applies the hard rules,
 * scores, and searches the combinations best first within a fixed budget.
 */
import type { FloatPlace, FloatSize, Spot } from "@wocument/resolved-document";

const EPS = 1e-6;

export type Box = { x: number; y: number; width: number; height: number };

/** One screen: `band` = foot − top of a full screen; `origin` = the screen's grid origin. */
export type ScreenGeometry = {
  index: number;
  top: number;
  foot: number;
  band: number;
  columns: { x: number; width: number }[];
  baseline: number;
  origin: number;
};

/** A floating object. `heightAt(width)` is its whole box height (picture and caption) at that width. */
export type Float = {
  id: string;
  order: number;
  sizes: FloatSize[];
  place: FloatPlace;
  kind: "picture" | "quote" | "box";
  anchorScreen: number;
  anchorColumn: number;
  heightAt: (width: number) => number;
  crops: boolean;
};

/** A box on this screen, or `wait`: the object goes to a later screen. */
export type Candidate = { id: string; size: FloatSize; spot: Spot; first: number; span: number; box: Box } | { id: string; wait: true };
type Placed = Extract<Candidate, { box: Box }>;

/**
 * What a trial layout gave. `feet[i]`: the y where column i's content (lines or a bottom box) ends.
 * `gaps`: whole lines of empty room inside the columns, next to or beside a box.
 */
export type TrialSummary = { allSet: boolean; overlaps: boolean; stubs: boolean; feet: number[]; last: boolean; alone: boolean; gaps: number };

/** A trial not set: it breaks no rule seen, and has no feet or empty room to cost. */
export const UNTRIED: TrialSummary = { allSet: false, overlaps: false, stubs: false, feet: [], last: true, alone: false, gaps: 0 };

/** `gap` (2026-10-20): a line of empty room inside a column costs as a line short at its foot does. */
export const PENALTY = { column: 1, screen: 6, order: 20, shortLine: 2, crowd: 4, balance: 2, rhythm: 1, gap: 2 };

const SCREEN_SPOT: Spot = { size: "hero", place: "top", span: { kind: "all" }, side: null };

/** Span lengths and their first columns, clipped to `n` columns. */
function placings(span: Spot["span"], n: number): [number, number][] {
  const lengths = span.kind === "all" ? [n] : span.kind === "all-but-one" ? [Math.max(n - 1, 1)] : [];
  if (span.kind === "count") for (let k = Math.max(span.from, 1); k <= Math.min(span.to, n); k++) lengths.push(k);
  const out: [number, number][] = [];
  for (const k of lengths.filter((k) => k >= 1)) for (let first = 0; first + k <= n; first++) out.push([first, k]);
  return out;
}

export function candidates(f: Float, spots: Spot[], g: ScreenGeometry): Candidate[] {
  const max = 0.85 * g.band;
  const menu =
    f.place === "screen" ? [SCREEN_SPOT]
    : f.place === "here" ? []
    : spots.filter((s) => s.place !== "anchor" && f.sizes.includes(s.size) && (f.place === "float" || s.place === f.place));
  const top = g.origin + Math.ceil((g.top - g.origin) / g.baseline - EPS) * g.baseline;
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const spot of menu) {
    for (const [first, span] of placings(spot.span, g.columns.length)) {
      const key = `${spot.size} ${spot.place} ${first} ${span}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = g.columns[first]!, b = g.columns[first + span - 1]!;
      const width = b.x + b.width - a.x;
      let height = f.heightAt(width);
      if (f.place === "screen") height = Math.min(height, max);
      if (height > max + EPS) continue;
      let y = top;
      if (spot.place === "bottom") {
        y = g.origin + Math.floor((g.foot - height - g.origin) / g.baseline + EPS) * g.baseline;
        if (y < top - EPS) continue;
        // A crop grows to the foot only within the 85% cap; past it, the box keeps its own height.
        if (f.crops && g.foot - y <= max + EPS) height = g.foot - y;
      } else if (y + height > g.foot + EPS) continue;
      out.push({ id: f.id, size: spot.size, spot, first, span, box: { x: a.x, y, width, height } });
    }
  }
  if (f.anchorScreen >= g.index) out.push({ id: f.id, wait: true });
  return out;
}

const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;

/** The hard rules a combination breaks before any layout: one hero, no two boxes overlapping. */
function fitsTogether(combo: Candidate[]): boolean {
  const placed = combo.filter((c): c is Placed => "box" in c);
  if (placed.filter((c) => c.size === "hero").length > 1) return false;
  return placed.every((a, i) => placed.slice(i + 1).every((b) => !overlap(a.box, b.box)));
}

export function hardOk(combo: Candidate[], floats: Float[], g: ScreenGeometry, t: TrialSummary): boolean {
  const ids = new Set(combo.map((c) => c.id));
  if (combo.length !== floats.length || ids.size !== combo.length || floats.some((f) => !ids.has(f.id))) return false;
  return fitsTogether(combo) && t.allSet && !t.overlaps && !t.stubs && !t.alone;
}

/** Distance from the anchor: columns away plus screens away (a `wait` lands one screen on). */
export function distance(c: Candidate, f: Float, g: ScreenGeometry): number {
  if ("wait" in c) return PENALTY.screen * Math.abs(g.index + 1 - f.anchorScreen);
  return PENALTY.column * Math.abs(c.first - f.anchorColumn) + PENALTY.screen * Math.abs(g.index - f.anchorScreen);
}

/** Reading position: top before bottom, then left to right; a `wait` reads after everything here. */
const reading = (c: Candidate): [number, number] => ("wait" in c ? [2, 0] : [c.spot.place === "top" ? 0 : 1, c.box.x]);
const readsBefore = (a: Candidate, b: Candidate): number => {
  const [p, q] = [reading(a), reading(b)];
  return p[0] - q[0] || p[1] - q[1];
};

/** The penalty's terms (the visor shows them): `gaps` is the lines short at the feet and the empty room inside. */
export type PenaltyParts = { distance: number; order: number; gaps: number; crowd: number; balance: number; rhythm: number };

export function penaltyParts(combo: Candidate[], floats: Float[], g: ScreenGeometry, t: TrialSummary, previous: string | null): PenaltyParts {
  const byId = new Map(floats.map((f) => [f.id, f]));
  const order = (c: Candidate) => byId.get(c.id)?.order ?? 0;
  const p: PenaltyParts = { distance: 0, order: 0, gaps: 0, crowd: 0, balance: 0, rhythm: 0 };
  for (const c of combo) {
    const f = byId.get(c.id);
    if (f) p.distance += distance(c, f, g);
  }
  for (const [i, a] of combo.entries())
    for (const b of combo.slice(i + 1)) {
      const [early, late] = order(a) <= order(b) ? [a, b] : [b, a];
      if (order(a) !== order(b) && readsBefore(late, early) < 0) p.order += PENALTY.order;
    }
  if (!t.last && Number.isFinite(g.foot))
    for (const foot of t.feet) p.gaps += PENALTY.shortLine * Math.max(0, Math.round((g.foot - foot) / g.baseline));
  p.gaps += PENALTY.gap * t.gaps;
  const placed = combo.filter((c): c is Placed => "box" in c);
  for (const [i, a] of placed.entries())
    for (const b of placed.slice(i + 1)) {
      const shareColumn = a.first < b.first + b.span && b.first < a.first + a.span;
      const sideBySide = a.size === b.size && a.box.y < b.box.y + b.box.height && b.box.y < a.box.y + a.box.height;
      if (shareColumn || sideBySide) p.crowd += PENALTY.crowd;
    }
  const last = g.columns[g.columns.length - 1];
  // One box always sits on one side; balance weighs two or more.
  if (placed.length > 1 && g.columns[0] && last) {
    const mid = (g.columns[0].x + last.x + last.width) / 2;
    if (placed.every((c) => c.box.x + c.box.width <= mid + EPS) || placed.every((c) => c.box.x >= mid - EPS)) p.balance += PENALTY.balance;
  }
  if (signature(combo) === previous) p.rhythm += PENALTY.rhythm;
  return p;
}

export function penalty(combo: Candidate[], floats: Float[], g: ScreenGeometry, t: TrialSummary, previous: string | null): number {
  const p = penaltyParts(combo, floats, g, t, previous);
  return p.distance + p.order + p.gaps + p.crowd + p.balance + p.rhythm;
}

/** The arrangement, without the objects' names: what the next screen's rhythm penalty compares. */
export function signature(combo: Candidate[]): string {
  return combo
    .filter((c): c is Placed => "box" in c)
    .map((c) => `${c.size}:${c.spot.place}:${c.first}+${c.span}`)
    .sort()
    .join(" ");
}

/** Story-order tie-break: the earliest object that differs reads first on the screen. */
const storyFirst = (a: Candidate[], b: Candidate[]): number => {
  for (let i = 0; i < a.length; i++) {
    const d = readsBefore(a[i]!, b[i]!);
    if (d !== 0) return d;
  }
  return 0;
};

/**
 * The cheapest combination that keeps the hard rules, or `null`. Combinations come best first by
 * their summed distance; those that break a rule seen without layout cost no trial; the search stops
 * after `budget` trials or when no later combination can cost less than the best found.
 */
export function choose(
  floats: Float[],
  spots: Spot[],
  g: ScreenGeometry,
  /**
   * `lost` tells the trial when it cannot win, so it can skip work: with `null`, before any layout (its
   * cost from the combination alone is over the best); with a summary, a hard rule broken or a cost
   * over the best even with no empty room.
   */
  tryLayout: (combo: Candidate[], lost: (t: TrialSummary | null) => boolean) => TrialSummary,
  previous: string | null,
  budget = 40,
): { combo: Candidate[]; cost: number; parts: PenaltyParts; ranked: { combo: Candidate[]; cost: number }[] } | null {
  const fs = [...floats].sort((a, b) => a.order - b.order);
  const lists = fs.map((f) =>
    candidates(f, spots, g)
      .map((c) => ({ c, d: distance(c, f, g) }))
      .sort((a, b) => a.d - b.d),
  );
  if (lists.some((l) => l.length === 0)) return null;

  // Best-first walk over the index vectors: from (v, p) step any position j ≥ p, so each vector comes once.
  type Node = { v: number[]; p: number; sum: number; combo: Candidate[] };
  const node = (v: number[], p: number): Node => ({
    v, p,
    sum: v.reduce((s, i, k) => s + lists[k]![i]!.d, 0),
    combo: v.map((i, k) => lists[k]![i]!.c),
  });
  const before = (a: Node, b: Node): number =>
    a.sum - b.sum || storyFirst(a.combo, b.combo) || compareVectors(a.v, b.v);
  // ponytail: sorted-array frontier, O(n) inserts; a heap if screens ever hold many more floats.
  const frontier: Node[] = [node(fs.map(() => 0), 0)];
  let best: { combo: Candidate[]; cost: number; parts: PenaltyParts } | null = null;
  /** Every combination that kept the hard rules, for the visor's alternatives. */
  const valid: { combo: Candidate[]; cost: number }[] = [];
  let calls = 0;
  while (frontier.length > 0 && calls < budget) {
    const n = frontier.shift()!;
    if (best && n.sum > best.cost + EPS) break;
    for (let j = n.p; j < n.v.length; j++) {
      if (n.v[j]! + 1 >= lists[j]!.length) continue;
      const next = node(n.v.map((x, k) => (k === j ? x + 1 : x)), j);
      let at = frontier.findIndex((m) => before(next, m) < 0);
      if (at < 0) at = frontier.length;
      frontier.splice(at, 0, next);
    }
    if (!fitsTogether(n.combo)) continue;
    // Every term of the penalty is zero or more, so these are lower bounds of the trial's cost.
    const over = (t: TrialSummary): boolean => best !== null && penalty(n.combo, fs, g, { ...t, gaps: 0 }, previous) > best.cost + EPS;
    const t = tryLayout(n.combo, (t) => (t ? !hardOk(n.combo, fs, g, t) || over(t) : over(UNTRIED)));
    calls++;
    if (!hardOk(n.combo, fs, g, t)) continue;
    const parts = penaltyParts(n.combo, fs, g, t, previous);
    const cost = parts.distance + parts.order + parts.gaps + parts.crowd + parts.balance + parts.rhythm;
    valid.push({ combo: n.combo, cost });
    if (!best || cost < best.cost - EPS || (cost < best.cost + EPS && storyFirst(n.combo, best.combo) < 0)) best = { combo: n.combo, cost, parts };
  }
  if (!best) return null;
  const b = best;
  const others = valid.filter((r) => r.combo !== b.combo).sort((x, y) => x.cost - y.cost || storyFirst(x.combo, y.combo));
  return { ...b, ranked: [{ combo: b.combo, cost: b.cost }, ...others].slice(0, 4) };
}

function compareVectors(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
