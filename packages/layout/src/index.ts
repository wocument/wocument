/**
 * @wocument/layout -- Resolved Document + viewport -> Positioned Document
 * (spec §15.1 stage 4, §09.6).
 *
 * Pure after prepare: it reads no DOM and measures nothing itself. All text
 * measurement goes through the PrepareCache's engine (spec §15.4 point 5).
 *
 * Covered: flow, screen and page scenes (rows, valign, growing on overset;
 * page scenes set in column bands, §09.7), threading across frames and
 * scenes, internal columns with balancing (§09.4), frame and column breaks,
 * orphans, widows and keep-with-next, baseline snapping, space, indent,
 * `measure`, `fit=width`, drop caps, in-frame rules, mixed-style paragraphs,
 * media and text-bearing objects grid-placed, anchored (with or without
 * `cols=`) or floating to a spot (§09.7 rule 15), groups and row groups
 * (§11.11), and wrap around rectangles, ellipses, polygons and alpha contours
 * with slots and `wrap-side` (§09.6, §12). With `explain`, every decision is
 * logged for the visor.
 *
 * Not laid out yet (they throw): `\lottie` objects, and a `\group` on the
 * background layer. `docs/capabilities.md` lists what every attribute does.
 */

import type {
  AnchoredPlacement,
  GalleryObject,
  GroupChild,
  GroupObject,
  Len,
  Frame,
  ObjectElement,
  ParagraphBlock,
  ResolvedDocument,
  ResolvedStyle,
  Scene,
  Story,
  Variant,
} from "@wocument/resolved-document";
import { CURSOR_START, type EngineRun, type LineBox, type PrepareCache, type Prepared, type TextCursor, type TextEngine } from "@wocument/text-engine";
import { type EvalContext, type Viewport, engineFont, gridGeometry, px, span } from "./evaluate.js";
import { type RowItem, packRows } from "./rows.js";
import { type Candidate, type Float, type PenaltyParts, type ScreenGeometry, type TrialSummary, UNTRIED, candidates, choose, distance, hardOk, signature } from "./compose.js";
import type {
  Exclusion,
  GridGeometry,
  PositionedCap,
  PositionedColumnRule,
  PositionedContinue,
  PositionedDocument,
  PositionedLine,
  PositionedObject,
  PositionedRule,
  PositionedScene,
  ColumnEndReason,
  Decision,
  PictureReason,
  SpaceReason,
  LineReason,
  Explanation,
  Rect,
  ScreenReport,
} from "./positioned.js";

export * from "./positioned.js";
export * from "./evaluate.js";
export * from "./rows.js";

const SHY = /\u00ad/g;
const SHY_CHAR = "\u00ad";
const EPS = 1e-6;

/** §11.3 pin and reflow: how many times a frame is set again to catch an object that only a reflow put in the way. */
const PIN_ROUNDS = 3;

/** §09.2 `columns=auto` with no `measure`: the target column width, in ems of the text. */
const AUTO_MEASURE_EM = 32;

/**
 * Where a story continues: block, the piece of that block between forced
 * breaks (`\br`), the engine cursor, and the character offset into the piece.
 */
type Resume = { block: number; piece: number; at: TextCursor; offset: number };
const START: Resume = { block: 0, piece: 0, at: CURSOR_START, offset: 0 };

/** What one fill produced. `narrow` (the visor, only with `explain`): strips under min-slot left empty beside an object. */
type Placed = { lines: PositionedLine[]; caps: PositionedCap[]; rules: PositionedRule[]; objects: PositionedObject[]; columnRules: PositionedColumnRule[]; continues: PositionedContinue[]; narrow?: Narrow[] };
type Narrow = Rect & { min: number; frame: string; column: number; object?: string };
const empty = (): Placed => ({ lines: [], caps: [], rules: [], objects: [], columnRules: [], continues: [] });
const append = (a: Placed, b: Placed): void => {
  a.lines.push(...b.lines);
  a.caps.push(...b.caps);
  a.rules.push(...b.rules);
  a.objects.push(...b.objects);
  a.columnRules.push(...b.columnRules);
  a.continues.push(...b.continues);
  if (b.narrow?.length) (a.narrow ??= []).push(...b.narrow);
};
const mark = (p: Placed) => ({ lines: p.lines.length, caps: p.caps.length, rules: p.rules.length, objects: p.objects.length, columnRules: p.columnRules.length, continues: p.continues.length, narrow: p.narrow?.length ?? 0 });
function rollback(out: Placed, to: ReturnType<typeof mark>): void {
  out.lines.length = to.lines;
  out.caps.length = to.caps;
  out.rules.length = to.rules;
  out.objects.length = to.objects;
  out.columnRules.length = to.columnRules;
  out.continues.length = to.continues;
  if (out.narrow) out.narrow.length = to.narrow;
}

/** Everything a fill needs that does not change within one scene. */
type Env = {
  rd: ResolvedDocument;
  v: Variant;
  grid: GridGeometry;
  sceneY: number;
  viewport: Viewport;
  cache: PrepareCache;
  /** Design 2026-09-22 §1: the scene is `height=page`, so multi-column frames fill column bands. */
  page: boolean;
  /** Design 2026-09-29: set when a frame in the scene is set in column bands, which makes the scene screen pages. */
  paged: boolean;
  /** §09.7 rule 2: where the baseline grid counts from while a band is set, its page's top (absent: the scene's top). */
  origin?: number;
  /** §09.7 rule 12: extra height, in px (negative to crop), a photograph takes so that its page ends full. */
  grow?: ReadonlyMap<string, number>;
  /** 2026-10-17: set while columns are balanced. A paragraph, picture or box is never split across columns. */
  whole?: boolean;
  /** 2026-10-17: the scene is set in screen pages, so every frame snaps to the grid of the screen a line is on. */
  pageGrids?: boolean;
  /** Picture composition (2026-10-17): how many combinations a screen may try; 0: no composition, every object takes rule 6. */
  budget: number;
  /** Picture composition: told how many trial layouts each composed screen used (tests and reports). */
  onCompose?: (screen: number, trials: number) => void;
  /** Test hook (2026-10-17): the layouts one composition trial set, its rule-3 cuts included. */
  onCut?: (screen: number, layouts: number) => void;
  /**
   * Picture composition, while a screen is set: the frame's floating objects. The text steps over
   * their anchors; one with a box is set at it on this screen (`fixed`: at the box's height, a crop).
   */
  floated?: ReadonlyMap<string, Floated | null>;
  /** The copyfitting report: each banded frame adds its screens. */
  reports: ScreenReport[];
  /** The visor (2026-10-21): decisions of kept settings only; absent when `explain` is off. Truncated with `reports` at every rollback. */
  explain?: Decision[];
  /** The visor: why each floating object took its spot, as the composer last decided; absent when `explain` is off. */
  picks?: Map<string, Pick>;
};
/** The visor: a floating object's reason, and for a chosen spot its score parts and the alternatives. */
type Pick = { reason: PictureReason; numbers: Record<string, number>; alternatives?: NonNullable<Decision["alternatives"]> };
type Floated = { box: Rect; fixed: boolean };

/** The active variant: the last breakpoint range starting at or below the width. */
export function activeVariant(rd: ResolvedDocument, width: number): string {
  let name = rd.breakpoints[0]!.variant;
  for (const r of rd.breakpoints) if (r.minWidth <= width) name = r.variant;
  return name;
}

export function layout(rd: ResolvedDocument, viewport: Viewport, cache: PrepareCache, opts: { composeBudget?: number; onCompose?: (screen: number, trials: number) => void; onCut?: (screen: number, layouts: number) => void; explain?: boolean } = {}): PositionedDocument {
  const breakpoint = activeVariant(rd, viewport.width);
  const v = rd.variants[breakpoint]!;
  const cursors = new Map<string, Resume>();
  const scenes: PositionedScene[] = [];
  const explained: Explanation["scenes"] = [];
  const kept: { env: Env; scene: PositionedScene }[] = [];
  let y = 0;
  for (const scene of v.scenes) {
    const env = (pageGrids: boolean): Env => ({ rd, v, grid: gridGeometry(scene.grid, viewport), sceneY: y, viewport, cache, page: scene.height === "page", paged: false, pageGrids, budget: opts.composeBudget ?? 40, onCompose: opts.onCompose, onCut: opts.onCut, reports: [], ...(opts.explain ? { explain: [], picks: new Map() } : {}) });
    const before = new Map(cursors);
    let e = env(false);
    let s = layoutScene(e, scene, cursors);
    // 2026-10-17: a scene set in screen pages is set again with every frame on its screen's grid (only
    // known once a frame has been set in bands); one that scrolls keeps a single grid.
    if (s.paged) {
      cursors.clear();
      for (const [k, c] of before) cursors.set(k, c);
      s = layoutScene((e = env(true)), scene, cursors);
    }
    if (e.explain) (explained.push({ scene: scene.id, decisions: e.explain }), kept.push({ env: e, scene: s }));
    scenes.push(s);
    y += s.height;
  }
  if (opts.explain) noteLines(v, cache, viewport, kept);
  return { viewport, breakpoint, scenes, height: y, ...(opts.explain ? { explain: { version: 1 as const, scenes: explained } } : {}) };
}

// ---------------------------------------------------------------------------
// Scenes (§08)
// ---------------------------------------------------------------------------

function layoutScene(env: Env, scene: Scene, cursors: Map<string, Resume>): PositionedScene {
  const { grid, sceneY, viewport, v } = env;
  const contentTop = sceneY + grid.marginY;
  const screen = scene.height === "screen";
  // §08.2 screen: one small-viewport height, the area inside margin-y divided into rows.
  const rowHeight = screen ? (viewport.height - 2 * grid.marginY - (grid.rows - 1) * grid.rowGap) / grid.rows : 0;
  const rows = (from: number, to: number) => ({
    top: contentTop + (from - 1) * (rowHeight + grid.rowGap),
    height: (to - from + 1) * rowHeight + (to - from) * grid.rowGap,
  });
  const ctx: EvalContext = { viewport, grid, pctOf: viewport.width };
  /** Siblings set so far; `wraps`: text flows around it (an exclusion), so auto tops do not stack under it. */
  const placed: { from: number; to: number; bottom: number; wraps: boolean }[] = [];
  // Below every earlier sibling that overlaps these columns, not just the last one: a short photo
  // placed after a tall heading beside it must not let the next frame start inside the heading.
  // A sibling that wraps text is flowed around instead, so it does not count.
  const above = (from: number, to: number): number => {
    const hits = placed.filter((p) => !p.wraps && p.from <= to && p.to >= from);
    return hits.length ? Math.max(...hits.map((p) => p.bottom)) + grid.rowGap : contentTop;
  };
  const out = empty();
  const exclusions: Exclusion[] = [];
  let bottom = contentTop;

  // Pass 1: grid-placed objects whose position does not depend on frames, so
  // their wrap can cut into every frame of the scene (§12.1).
  const pending: string[] = [];
  /** Pass-1 boxes, joined to the sibling list in source order during pass 2 (§09.2 top=auto). */
  const early = new Map<string, { from: number; to: number; bottom: number; wraps: boolean }>();
  for (const child of scene.children) {
    if (child.kind !== "object") continue;
    const o = v.objects[child.id]!;
    if (o.hidden || o.placement.mode === "background") continue;
    if (o.placement.mode !== "grid") notYet(`${o.placement.mode} placement of "${o.id}"`);
    // A group may hold frames, which fill in source order: pass 2 places it.
    if (o.kind === "group") continue;
    const vert = o.placement.vertical;
    if (vert.mode === "flow" && vert.top === "auto") {
      pending.push(o.id);
      continue;
    }
    const box = capWidth(o, span(grid, o.placement.cols.from, o.placement.cols.to), ctx);
    const top = vert.mode === "rows" ? rows(vert.rows.from, vert.rows.to).top : contentTop + px(vert.top as never, ctx);
    const fixed = vert.mode === "rows" ? rows(vert.rows.from, vert.rows.to).height : vert.height === "auto" ? null : px(vert.height, ctx);
    const r = placeObject(env, o, { x: box.x, y: top, width: box.width }, fixed);
    append(out, r.placed);
    exclusions.push(...r.exclusions);
    early.set(o.id, { from: o.placement.cols.from, to: o.placement.cols.to, bottom: r.box.y + r.box.height, wraps: r.exclusions.length > 0 });
    bottom = Math.max(bottom, r.box.y + r.box.height);
  }

  /**
   * Sets a frame's slice of its story at `box`, from `top`; `height` null is auto. Returns the bottom of
   * its text, which later siblings stack under, of everything it placed, anchored objects included, and
   * of what it drew: `ink` stops at the last line, not after its paragraph's space-after, which is what
   * group rows align and space by.
   */
  const setFrame = (frame: Frame, box: { x: number; width: number }, top: number, height: number | null): { text: number; all: number; ink: number } => {
    const story = v.stories[frame.story]!;
    const last = (v.threads[frame.story] ?? []).at(-1) === frame.id;
    const result = fillFrame(env, frame, story, box, top, height, cursors.get(frame.story) ?? START, last, exclusions);
    cursors.set(frame.story, result.cursor);
    append(out, result.placed);
    // §11.3: text in any overlapping frame wraps, so an object anchored here that hangs past this
    // frame cuts into the frames after it. Limit: not the frames before it, which are already set.
    exclusions.push(...result.placed.objects.flatMap((o) => (o.exclusion ? [o.exclusion] : [])));
    const p = result.placed;
    const ink = Math.max(top, ...p.lines.map((l) => l.y + l.height), ...p.objects.map((o) => o.box.y + o.box.height), ...p.caps.map((c) => c.y + c.height), ...p.rules.map((r) => r.y + r.weight / 2));
    // §09.2 wrap=rect: the frame's box, to what it drew, cuts into the frames set after it. Its sides
    // are on grid lines, where the gutter already separates it, so its offset is below it only.
    if (frame.wrap)
      exclusions.push({ id: frame.id, box: { x: box.x, y: top, width: box.width, height: ink - top + px(frame.wrap.offset, ctx) }, shape: { kind: "rect" }, offset: 0, side: "both", jump: false });
    // A definite height is the frame's box, whatever it drew.
    return { text: result.bottom, all: Math.max(result.bottom, ...p.objects.map((o) => o.box.y + o.box.height)), ink: height === null ? ink : Math.max(ink, top + height) };
  };

  /** The next baseline step at or below `y`, so group rows and stacked children stay on the grid. */
  const onBaseline = (y: number): number => sceneY + Math.ceil((y - sceneY) / grid.baseline - EPS) * grid.baseline;

  /**
   * A group (§11.11, design 2026-09-26) in columns `from`..`to`, from `top`.
   * A stack puts its children one below another at its width; a row group
   * packs them into rows of whole columns (packRows). Returns the bottom.
   */
  const placeGroup = (g: GroupObject, from: number, to: number, top: number): number => {
    const kids = g.children.filter((c) => !(c.kind === "frame" ? v.frames[c.id]!.hidden : v.objects[c.id]!.hidden));
    const width = span(grid, from, to).width;
    const gap = px(g.gap, { ...ctx, pctOf: width });
    /** One child in columns a..b at y; `h` is a definite height (valign=stretch), else null. */
    const kid = (c: GroupChild, a: number, b: number, y: number, h: number | null): number => {
      if (c.kind === "frame") return setFrame(v.frames[c.id]!, span(grid, a, b), y, h).ink;
      const o = v.objects[c.id]!;
      if (o.kind === "group") return placeGroup(o, a, b, y);
      const at = span(grid, a, b);
      const r = placeObject(env, o, { x: at.x, y, width: at.width }, h);
      append(out, r.placed);
      return r.box.y + r.box.height;
    };
    let y = top;
    let end = top;
    if (g.layout === "stack") {
      for (const c of kids) {
        end = kid(c, from, to, onBaseline(y), null);
        y = end + gap;
      }
      return end;
    }
    const n = to - from + 1;
    // A viewport narrower than its margins has no column pitch; every length is then one column.
    const pitch = grid.colWidth + grid.gutter;
    const cols = (l: Len | null, round: (k: number) => number, fallback: number): number =>
      l === null ? fallback : pitch <= EPS ? 1 : Math.max(1, Math.min(n, round((px(l, { ...ctx, pctOf: width }) + grid.gutter) / pitch)));
    // width=fit (2026-09-30): a text frame takes the whole columns its widest line needs, measured by
    // setting it first at the widest it could be beside the other children's least widths.
    const least = (c: GroupChild): number =>
      c.width === "fit" ? 1 : c.width !== null ? cols(c.width, Math.round, 1) : cols(c.minWidth, (k) => Math.ceil(k - EPS), 1);
    const fitted = (c: GroupChild, i: number): number => {
      const room = Math.max(1, n - kids.reduce((sum, k, j) => (j === i ? sum : sum + least(k)), 0));
      if (c.kind !== "frame" || pitch <= EPS) return room;
      const before = { out: mark(out), exclusions: exclusions.length, cursors: new Map(cursors), reports: env.reports.length, explain: env.explain?.length ?? 0 };
      const box = span(grid, from, from + room - 1);
      setFrame(v.frames[c.id]!, box, top, null);
      const widest = Math.max(0, ...out.lines.slice(before.out.lines).filter((l) => l.frame === c.id).map((l) => l.x + l.measured - box.x));
      rollback(out, before.out);
      exclusions.length = before.exclusions;
      env.reports.length = before.reports;
      if (env.explain) env.explain.length = before.explain;
      cursors.clear();
      for (const [k, x] of before.cursors) cursors.set(k, x);
      return Math.max(1, Math.min(room, Math.ceil((widest + grid.gutter) / pitch - EPS)));
    };
    const items = kids.map((c, i): RowItem => {
      if (c.width === "fit") {
        const w = fitted(c, i);
        return { min: w, max: w, fixed: true };
      }
      if (c.width !== null) {
        const w = cols(c.width, Math.round, 1);
        return { min: w, max: w, fixed: true };
      }
      const min = cols(c.minWidth, (k) => Math.ceil(k - EPS), 1);
      return { min, max: Math.max(min, cols(c.maxWidth, (k) => Math.floor(k + EPS), n)), fixed: false };
    });
    for (const row of packRows(items, n)) {
      y = onBaseline(y);
      let a = from;
      const slots = row.map((s) => {
        const slot = { c: kids[s.index]!, a, b: a + s.span - 1 };
        a += s.span;
        return slot;
      });
      // Set at the top first, to learn each child's height; anything else sets the row again.
      const before = { out: mark(out), exclusions: exclusions.length, cursors: new Map(cursors), reports: env.reports.length, explain: env.explain?.length ?? 0 };
      const bottoms = slots.map((s) => kid(s.c, s.a, s.b, y, null));
      // valign=text (2026-09-30): the row is as tall as its tallest text frame; media are cropped to it.
      const texts = slots.flatMap((s, i) => (s.c.kind === "frame" ? [bottoms[i]!] : []));
      const rowBottom = g.valign === "text" && texts.length ? Math.max(...texts) : Math.max(...bottoms);
      if (g.valign !== "top") {
        rollback(out, before.out);
        exclusions.length = before.exclusions;
        env.reports.length = before.reports;
        if (env.explain) env.explain.length = before.explain;
        cursors.clear();
        for (const [k, c] of before.cursors) cursors.set(k, c);
        const H = rowBottom - y;
        slots.forEach((s, i) => {
          const h = bottoms[i]! - y;
          const shift = g.valign === "center" ? (H - h) / 2 : g.valign === "bottom" ? H - h : 0;
          kid(s.c, s.a, s.b, y + shift, g.valign === "stretch" || g.valign === "text" ? H : null);
        });
      }
      end = rowBottom;
      y = rowBottom + gap;
    }
    return end;
  };

  // Pass 2: frames, groups, and objects that follow siblings (top=auto), in source order.
  for (const child of scene.children) {
    const grouped = child.kind === "object" ? v.objects[child.id]! : null;
    if (grouped?.kind === "group" && !grouped.hidden && grouped.placement.mode === "grid") {
      const { from, to } = grouped.placement.cols;
      const vert = grouped.placement.vertical;
      const top = vert.mode === "rows" ? rows(vert.rows.from, vert.rows.to).top : vert.top === "auto" ? above(from, to) : contentTop + px(vert.top, ctx);
      const end = placeGroup(grouped, from, to, top);
      // To everything outside it, the group is one unit (§11.11): its wrap cuts into later frames as its bounding box.
      const cut = exclusionsOf(env, grouped, { ...span(grid, from, to), y: top, height: end - top }, null);
      exclusions.push(...cut);
      placed.push({ from, to, bottom: end, wraps: cut.length > 0 });
      bottom = Math.max(bottom, end);
      continue;
    }
    if (child.kind === "object") {
      const done = early.get(child.id);
      if (done) placed.push(done);
      if (!pending.includes(child.id)) continue;
      const o = v.objects[child.id]!;
      if (o.placement.mode !== "grid") continue;
      const { from, to } = o.placement.cols;
      const box = capWidth(o, span(grid, from, to), ctx);
      const vert = o.placement.vertical as Extract<typeof o.placement.vertical, { mode: "flow" }>;
      // Limit: an object placed after frames cannot cut into them; its wrap applies to later frames only.
      const r = placeObject(env, o, { x: box.x, y: above(from, to), width: box.width }, vert.height === "auto" ? null : px(vert.height, ctx));
      append(out, r.placed);
      exclusions.push(...r.exclusions);
      placed.push({ from, to, bottom: r.box.y + r.box.height, wraps: r.exclusions.length > 0 });
      bottom = Math.max(bottom, r.box.y + r.box.height);
      continue;
    }
    const frame = v.frames[child.id]!;
    if (frame.hidden) continue;
    const box = span(grid, frame.cols.from, frame.cols.to);
    // §07.5 outdent (design 2026-09-29 rule 8): a frame with its own text, such as a heading block,
    // reaches into the margin like an object; a frame showing a threaded story never does.
    if (frame.story === `${frame.id}#text` && grid.outdent > 0) {
      if (Math.abs(box.x - grid.originX) < EPS) (box.x -= grid.outdent), (box.width += grid.outdent);
      if (Math.abs(box.x + box.width - (grid.originX + grid.content)) < EPS) box.width += grid.outdent;
    }
    let top: number;
    let height: number | null; // null = auto
    if (frame.vertical.mode === "rows") ({ top, height } = rows(frame.vertical.rows.from, frame.vertical.rows.to));
    else {
      const t = frame.vertical.top;
      top = t === "auto" ? above(frame.cols.from, frame.cols.to) : contentTop + px(t, ctx);
      height = frame.vertical.height === "auto" ? null : px(frame.vertical.height, { ...ctx, pctOf: viewport.height });
    }
    const end = setFrame(frame, box, top, height);
    placed.push({ from: frame.cols.from, to: frame.cols.to, bottom: end.text, wraps: frame.wrap !== null });
    bottom = Math.max(bottom, end.all);
  }

  // §08.2: a flow scene is its content plus margin-y; a screen scene is the viewport, or taller
  // when a story grew past it (§09.5 grow); a page scene is at least the viewport (design §1).
  const natural = bottom - sceneY + grid.marginY;
  const tall = screen || env.page ? Math.max(viewport.height, natural) : natural;
  // Design 2026-09-29 rule 1: a page scene with column bands is a whole number of screens, so every
  // band has a screen of its own and scrolling can settle on each. With none (one column, as on a
  // phone) the text runs on across screens and the scene scrolls freely.
  const height = env.paged ? Math.ceil(tall / viewport.height - EPS) * viewport.height : tall;

  // §11.2 background: fills the whole scene behind everything; never excludes text. First, so it paints beneath.
  const behind = empty();
  for (const child of scene.children) {
    const o = child.kind === "object" ? v.objects[child.id] : undefined;
    if (!o || o.hidden || o.placement.mode !== "background") continue;
    const r = placeObject(env, o, { x: 0, y: sceneY, width: viewport.width }, height);
    append(behind, r.placed);
  }
  append(behind, out);
  // The visor's strips stay out of the page.
  const { narrow: _, ...drawn } = behind;
  return { name: scene.id, y: sceneY, height, grid, paged: env.paged, ...drawn, ...(env.paged ? { screens: env.reports } : {}) };
}

// ---------------------------------------------------------------------------
// Objects (§11)
// ---------------------------------------------------------------------------

type Placement = { placed: Placed; box: Rect; exclusions: Exclusion[] };

/**
 * Places an object at `at` (its top-left and width). Text objects set their
 * own story inside the box, less any inset. Media objects take their height
 * from their ratio and set their caption as its own story below, above or
 * over the media (§11.1). An auto height is the content's. Returns the box
 * and, for a wrapping content-layer object, its exclusions.
 */
/**
 * §11.1 `max-width`: the box, no wider than its cap, keeping the centre of the
 * space its placement gave it. Without a cap the space is the
 * box. Centring, rather than hugging an edge, means the room a capped object
 * gives back is shared by the text on both sides; `offset-x` moves it off
 * centre.
 */
/** The narrowest strip beside a box that body text runs in: the body style's min-slot, else 6em (§09.6). */
function minStrip(env: Env, ctx: EvalContext): number {
  const body = env.v.styles["body"];
  if (!body) return 0;
  return body.minSlot ? px(body.minSlot, ctx) : 6 * px(body.size, ctx);
}

function capWidth(o: ObjectElement, at: { x: number; width: number }, ctx: EvalContext): { x: number; width: number } {
  if (o.maxWidth === null) return at;
  const width = Math.min(at.width, px(o.maxWidth, ctx));
  return { x: at.x + (at.width - width) / 2, width };
}

function placeObject(
  env: Env,
  o: ObjectElement,
  at: { x: number; y: number; width: number },
  fixedHeight: number | null,
  anchoredAt: number | null = null,
  /** In a column band (§09.7): a box narrower than its place leaves text room beside it, or none (rule 15). */
  banded = false,
): Placement {
  const ctx: EvalContext = { viewport: env.viewport, grid: env.grid, pctOf: at.width };
  // §11.1 bleed: the box runs through the margin to the viewport edge.
  let x = at.x + px(o.offsetX, ctx);
  let width = at.width;
  if (o.bleed === "left" || o.bleed === "both") (width += x), (x = 0);
  if (o.bleed === "right" || o.bleed === "both") width = env.viewport.width - x;
  // §07.5 outdent: an object on the grid's outer edge reaches that far into the margin, so what is
  // not text breaks the column edge a little. Text never does.
  const { originX, content, outdent } = env.grid;
  if (o.bleed === "none" && outdent > 0) {
    if (Math.abs(x - originX) < EPS) (x -= outdent), (width += outdent);
    if (Math.abs(x + width - (originX + content)) < EPS) width += outdent;
  }
  const y = at.y + px(o.offsetY, ctx);

  if (o.kind === "pullquote" || o.kind === "sidebar") {
    const inset = o.kind === "sidebar" ? px(o.inset, ctx) : 0;
    // §07.6 mark: the pull quote's decorative mark sits above its text, three times its size; its
    // glyph's upper part, about 0.7 of that, is the room it takes.
    const first = env.v.stories[o.story]!.blocks[0];
    const style = first?.kind === "paragraph" ? env.v.styles[first.style] : undefined;
    const marks = o.kind === "pullquote" && style?.mark ? [...style.mark] : [];
    const mark = marks[0] ? { text: marks[0], size: 3 * px(style!.size, ctx) } : null;
    const markRoom = mark ? Math.round(mark.size * 0.45) : 0;
    const fill = (w: number) => fillColumn(env, o.id, env.v.stories[o.story]!, { x: x + inset, width: w - 2 * inset }, 0, Number.POSITIVE_INFINITY, y + inset + markRoom, Number.POSITIVE_INFINITY, START, []);
    // §11.10 portrait: the widest box, to a pixel, that is still taller than wide (never under 10em of
    // its text); one on the right keeps its right edge.
    if (o.kind === "sidebar" && o.portrait && fixedHeight === null) {
      const tall = (w: number) => fill(w).bottom + inset - y >= w;
      const least = Math.min(width, 10 * px(style?.size ?? { u: "px", n: 16 }, ctx) + 2 * inset);
      let w = width;
      if (!tall(width)) {
        let lo = least;
        let hi = width;
        while (hi - lo > 1) {
          const mid = (lo + hi) / 2;
          if (tall(mid)) lo = mid;
          else hi = mid;
        }
        w = Math.floor(lo); // down: one pixel wider can take a line less
      }
      // 2026-10-20: in a band, a strip beside it too narrow for a line of body text stays empty; the
      // box takes the whole width instead.
      if (banded && width - w - (o.wrap.mode === "none" ? 0 : px(o.wrap.offset, ctx)) < minStrip(env, ctx)) w = width;
      const h = o.placement.mode === "anchored" ? o.placement.horizontal : null;
      if (h?.mode === "side") x += h.side === "right" ? width - w : h.side === "center" ? (width - w) / 2 : 0;
      width = w;
    }
    // A second mark closes the quote after its last word (before any \cite), as large as the first,
    // its top level with the last line's capitals (0.7 of the text size). A mark is about 0.45 of
    // its size wide; when it would not fit after the last word, the quote sets narrower by the
    // mark and its space, so that whatever line comes last has room for it.
    const closeOf = (t: ReturnType<typeof fill>) => {
      const last = mark && marks[1] ? t.placed.lines.filter((l) => l.block === 0).at(-1) : undefined;
      return last ? { text: marks[1]!, x: last.x + last.measured + 0.06 * mark!.size, y: last.baseline - 0.7 * px(style!.size, ctx), size: mark!.size } : null;
    };
    let text = fill(width);
    let close = closeOf(text);
    const over = close ? close.x + 0.45 * close.size - (x + width - inset) : 0;
    if (over > 0) (text = fill(width - 0.51 * close!.size)), (close = closeOf(text));
    const box: Rect = { x, y, width, height: fixedHeight ?? Math.max(0, text.bottom - y) + inset };
    const exclusions = exclusionsOf(env, o, box, null);
    text.placed.objects.unshift({ name: o.id, kind: o.kind, box, exclusion: exclusions[0] ?? null, anchoredAt, media: null, ...(mark ? { mark: { ...mark, ...(close ? { close } : {}) } } : {}) });
    return { placed: text.placed, box, exclusions };
  }
  if (o.kind !== "figure" && o.kind !== "video" && o.kind !== "embed" && o.kind !== "audio" && o.kind !== "gallery") notYet(`\\${o.kind} objects`);

  // The caption is laid out once to learn its height, then again where it goes.
  const caption = o.caption;
  const setCaption = (top: number) =>
    fillColumn(env, o.id, env.v.stories[caption!.story]!, { x, width }, 0, Number.POSITIVE_INFINITY, top, Number.POSITIVE_INFINITY, START, []);
  // Limit: half a baseline step between media and caption; the spec does not state the gap.
  const gap = env.grid.baseline / 2;
  // A caption's height is to its last line. The fill's own bottom adds the last paragraph's
  // space-after, which below a photo is space nobody sees but everything under the box inherits.
  // An overlay caption keeps that space as its padding from the photo's bottom edge.
  const first = caption ? setCaption(y) : null;
  const captionHeight = first ? Math.max(y, ...first.placed.lines.map((l) => l.y + l.height)) - y : 0;
  const overlayHeight = first ? first.bottom - y : 0;
  const takesSpace = caption !== null && caption.side !== "overlay";
  const mediaTop = caption?.side === "above" ? y + captionHeight + gap : y;
  // The media area: a gallery's items, an audio player, or a box of the media's ratio.
  const items = empty();
  let mediaHeight: number;
  if (o.kind === "gallery") mediaHeight = placeItems(env, o, { x, y: mediaTop, width }, items);
  // Limit: the browser's audio player is about 54px tall; rounded up to whole baseline steps. Measure it if a theme restyles it.
  else if (o.kind === "audio") mediaHeight = Math.ceil(54 / env.grid.baseline) * env.grid.baseline;
  else {
    const ratio = o.kind === "embed" ? o.ratio : o.media.ratio;
    mediaHeight = fixedHeight !== null ? fixedHeight - (takesSpace ? captionHeight + gap : 0) : (width * ratio.h) / ratio.w + (env.grow?.get(o.id) ?? 0);
  }
  // §09.7 rule 14 (2026-10-08): a figure takes whole lines of the baseline grid, its caption
  // included, so the text after it resumes exactly one standoff below and every column keeps the
  // same rhythm, whatever the screen. A photograph that crops takes the nearest whole number of
  // lines; anything that must show whole (a diagram, a cut-out) is scaled down to the line above,
  // centred in its space, or, when that would shrink it by more than a sixth, letterboxed to the
  // line below.
  let mx = x;
  let mw = width;
  // A cut-out is left as it is: text wraps its outline line by line, on the grid already.
  if (o.kind === "figure" && o.media.shape.kind === "rect" && fixedHeight === null && o.placement.mode !== "contained" && caption?.side !== "above" && mediaHeight > 0) {
    const bl = env.grid.baseline;
    const extra = takesSpace ? captionHeight + gap : 0;
    const total = mediaHeight + extra;
    if (o.media.fit === "cover") mediaHeight = Math.max(bl, Math.round(total / bl) * bl) - extra;
    else {
      const fitted = Math.floor(total / bl + EPS) * bl - extra;
      if (fitted > 0 && fitted >= mediaHeight * 0.85) {
        mw = (width * fitted) / mediaHeight;
        mx = x + (width - mw) / 2;
        mediaHeight = fitted;
      } else mediaHeight = Math.ceil(total / bl - EPS) * bl - extra;
    }
  }
  const media: Rect = { x: mx, y: mediaTop, width: mw, height: Math.max(0, mediaHeight) };
  const placed = caption
    ? setCaption(caption.side === "above" ? y : caption.side === "overlay" ? mediaTop + mediaHeight - overlayHeight : mediaTop + mediaHeight + gap).placed
    : empty();
  // A caption below ends the box at its last line as finally set: set lower, its lines snap to the
  // baseline grid differently than when it was measured. A definite height is kept exactly.
  const below = caption?.side === "below" ? Math.max(0, ...placed.lines.map((l) => l.y + l.height - media.y - media.height)) : 0;
  append(placed, items);
  const box: Rect = {
    x,
    y,
    width,
    height: fixedHeight !== null && takesSpace ? fixedHeight : caption?.side === "below" ? media.y + media.height + below - y : media.height + (takesSpace ? captionHeight + gap : 0),
  };
  const exclusions = exclusionsOf(env, o, box, media);
  placed.objects.unshift({ name: o.id, kind: o.kind, box, exclusion: exclusions[0] ?? null, anchoredAt, media });
  return { placed, box, exclusions };
}

/**
 * A gallery's items (§11.9), left to right in rows of `perRow`, each as wide
 * as its share of the row and as tall as its ratio and caption make it. A
 * strip is one row that runs past the box and scrolls sideways. Returns the
 * items' height.
 */
function placeItems(env: Env, g: GalleryObject, at: { x: number; y: number; width: number }, out: Placed): number {
  const gap = px(g.gap, { viewport: env.viewport, grid: env.grid, pctOf: at.width });
  const n = Math.max(1, g.perRow);
  // Limit: a strip's items are sized as if n and a half fit, so the next one peeks and shows it scrolls.
  const w = g.layout === "strip" ? (at.width - n * gap) / (n + 0.5) : (at.width - (n - 1) * gap) / n;
  let top = at.y;
  let rowHeight = 0;
  g.items.forEach((id, i) => {
    const col = g.layout === "strip" ? i : i % n;
    if (col === 0 && i > 0) (top += rowHeight + gap), (rowHeight = 0);
    const p = placeObject(env, env.v.objects[id]!, { x: at.x + col * (w + gap), y: top, width: w }, null);
    append(out, p.placed);
    rowHeight = Math.max(rowHeight, p.box.height);
  });
  return top + rowHeight - at.y;
}

/**
 * A content-layer object's exclusions (§12). `rect` excludes the box.
 * `contour` excludes the media's shape (circle, ellipse or polygon), and the
 * caption below or above it as a rectangle, so text never runs into it.
 */
function exclusionsOf(env: Env, o: ObjectElement, box: Rect, media: Rect | null): Exclusion[] {
  if (o.layer !== "content" || o.wrap.mode === "none") return [];
  const offset = px(o.wrap.offset, { viewport: env.viewport, grid: env.grid, pctOf: box.width });
  if (o.wrap.mode === "jump") return [{ id: o.id, box, shape: { kind: "rect" }, offset, side: "both", jump: true }];
  const side = o.wrap.side;
  const rect = (b: Rect): Exclusion => ({ id: o.id, box: b, shape: { kind: "rect" }, offset, side, jump: false });
  if (o.wrap.mode === "rect" || !media || !("media" in o)) return [rect(box)];
  const shape = o.media.shape;
  let main: Exclusion;
  if (shape.kind === "polygon") {
    const asset = env.rd.assets[shape.polygon];
    main = { id: o.id, box: media, shape: { kind: "poly", points: asset?.kind === "polygon" ? asset.points : [] }, offset, side, jump: false };
  } else if (shape.kind === "ellipse") main = { id: o.id, box: media, shape: { kind: "ellipse" }, offset, side, jump: false };
  else if (shape.kind === "circle") {
    const d = Math.min(media.width, media.height);
    const sq = { x: media.x + (media.width - d) / 2, y: media.y + (media.height - d) / 2, width: d, height: d };
    main = { id: o.id, box: sq, shape: { kind: "ellipse" }, offset, side, jump: false };
  } else main = rect(media);
  // The caption part of the box, if any, as a plain rectangle.
  const rest: Exclusion[] = [];
  if (box.height > media.height + EPS) {
    const top = media.y > box.y + EPS ? box.y : media.y + media.height;
    rest.push(rect({ x: box.x, y: top, width: box.width, height: box.height - media.height }));
  }
  return [main, ...rest];
}

/**
 * §12.2: an exclusion's horizontal extent across a line band, expanded by its
 * offset, or null when it does not reach the band. For a shape this is its
 * extent across the whole band, not at one y: one interval per band in v1.
 */
export function bandExtent(e: Exclusion, top: number, bottom: number): [number, number] | null {
  const t = top - e.offset;
  const b = bottom + e.offset;
  const { x, y, width: w, height: h } = e.box;
  if (b <= y + EPS || t >= y + h - EPS) return null;
  if (e.shape.kind === "rect") return [x - e.offset, x + w + e.offset];
  if (e.shape.kind === "ellipse") {
    const cy = y + h / 2;
    const ry = h / 2;
    const nearest = Math.min(Math.max(cy, t), b); // the band's point closest to the centre is its widest
    const dy = (nearest - cy) / ry;
    if (Math.abs(dy) >= 1) return null;
    const hw = (w / 2) * Math.sqrt(1 - dy * dy);
    return [x + w / 2 - hw - e.offset, x + w / 2 + hw + e.offset];
  }
  const pts = e.shape.points.map(([px, py]) => [x + px * w, y + py * h] as const);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    // The part of this edge inside the band.
    const ya = Math.max(t, Math.min(y1, y2));
    const yb = Math.min(b, Math.max(y1, y2));
    if (ya > yb) continue;
    const at = (yy: number): number => (y1 === y2 ? x1 : x1 + ((yy - y1) / (y2 - y1)) * (x2 - x1));
    for (const xx of y1 === y2 ? [x1, x2] : [at(ya), at(yb)]) {
      lo = Math.min(lo, xx);
      hi = Math.max(hi, xx);
    }
  }
  return lo <= hi ? [lo - e.offset, hi + e.offset] : null;
}

// ---------------------------------------------------------------------------
// Frames (§09.2 - §09.5)
// ---------------------------------------------------------------------------

/**
 * §09.2 `columns=auto`: the fewest columns that keep every column inside the
 * target measure. `n` columns of a `width`-wide frame are
 * `(width - (n-1)*gap) / n` across, so the smallest `n` with a column no wider
 * than the target is `ceil((width + gap) / (target + gap))`.
 *
 * The target is the frame's `measure`. Without one it is `AUTO_MEASURE_EM`
 * times the size of the story's first paragraph -- about 64 characters of a
 * typical serif, the middle of the readable range.
 */
function autoColumns(env: Env, frame: Frame, story: Story, width: number, gap: number, ctx: EvalContext): number {
  const target = frame.measure !== null ? px(frame.measure, { ...ctx, pctOf: width }) : AUTO_MEASURE_EM * bodySize(env, story, ctx);
  return Math.max(1, Math.ceil((width + gap) / (target + gap)));
}

/** The text size `columns=auto` sizes itself by: the story's first paragraph, or the `body` style. */
function bodySize(env: Env, story: Story, ctx: EvalContext): number {
  const first = story.blocks.find((b) => b.kind === "paragraph");
  const style = env.v.styles[first?.style ?? "body"] ?? env.v.styles["body"];
  return style ? px(style.size, ctx) : 16;
}

function fillFrame(
  env: Env,
  frame: Frame,
  story: Story,
  box: { x: number; width: number },
  top: number,
  height: number | null,
  cursor: Resume,
  lastInThread: boolean,
  exclusions: readonly Exclusion[],
): { placed: Placed; cursor: Resume; bottom: number } {
  const ctx: EvalContext = { viewport: env.viewport, grid: env.grid, pctOf: box.width };
  const inset = px(frame.inset, ctx);
  const inner = { x: box.x + inset, width: box.width - 2 * inset };
  const gap = px(frame.columnGap, { ...ctx, pctOf: inner.width });
  const count = frame.columns === "auto" ? autoColumns(env, frame, story, inner.width, gap, ctx) : frame.columns;
  const colWidth = (inner.width - (count - 1) * gap) / count;
  const columns = Array.from({ length: count }, (_, i) => ({ x: inner.x + i * (colWidth + gap), width: colWidth }));
  const measure = frame.measure === null ? Number.POSITIVE_INFINITY : px(frame.measure, { ...ctx, pctOf: colWidth });
  const contentTop = top + inset;
  const banded = height === null && env.page && count > 1;
  if (banded) env.paged = true;
  const pass = (at: number, limit: number, from: Resume, pins: Pins, earlier: readonly Exclusion[], deferred: readonly string[], moved: ReadonlySet<string> = new Set()): Columns =>
    fillColumns(env, frame, story, columns, measure, at, limit, from, [...exclusions, ...earlier, ...[...pins.values()].flatMap((p) => p.exclusions)], lastInThread, pins, banded, deferred, undefined, moved);
  // §11.3 pin and reflow: a `cols=` object whose exclusion hits lines already set in this frame is
  // pinned where its anchor put it, and the frame is set again from its first line around it.
  // Reflowing can slide a line under an object that cut into nothing before,
  // so the pass repeats while it finds a new one, up to `PIN_ROUNDS`. `collides` reports an object
  // still unpinned when the rounds run out; balancing rejects a trial height that leaves one.
  /** `earlier`: exclusions of objects placed in earlier bands of this frame, which may hang into this one. */
  const run = (limit: number, at = contentTop, from = cursor, earlier: readonly Exclusion[] = [], deferred: readonly string[] = []): Columns => {
    let pins = new Map<string, { y: number; exclusions: Exclusion[] }>();
    const moved = new Set<string>();
    let out = pass(at, limit, from, pins, earlier, deferred, moved);
    for (let round = 0; ; round++) {
      // Pins accumulate: an object keeps the y of the pass that first caught it. Replacing the set
      // instead would let two objects take turns colliding, each reflow undoing the last.
      const fresh: string[] = [];
      for (const [id, pin] of pinsFor(env, frame, out))
        if (!pins.has(id)) (pins.set(id, pin), fresh.push(id));
      if (fresh.length === 0) return out;
      if (round === PIN_ROUNDS) {
        out.collides = true;
        return out;
      }
      out = pass(at, limit, from, pins, earlier, deferred, moved);
      // 2026-10-07: in a band, a pin that leaves it no text at all (a picture taller than the band,
      // pinned at its top across every column) would end the story there. Those objects move to the
      // next band, which they open, and this band is set again without them.
      if (banded && !out.placed.lines.some((l) => l.frame === frame.id)) {
        for (const id of fresh) (pins.delete(id), moved.add(id));
        out = pass(at, limit, from, pins, earlier, deferred, moved);
      }
    }
  };
  const feet = (band: Columns): number[] => columns.map((_, c) => Math.max(Number.NEGATIVE_INFINITY, ...band.placed.lines.filter((l) => l.frame === frame.id && l.column === c).map((l) => l.y + l.height)));
  /** Where each column's content ends, its text or a picture in it, whichever is lower. */
  const ends = (band: Columns): number[] => columns.map((col, c) => Math.max(feet(band)[c]!, ...band.placed.objects.filter((o) => env.v.objects[o.name]?.placement.mode !== "contained" && o.box.x < col.x + col.width - EPS && o.box.x + o.box.width > col.x + EPS).map((o) => o.box.y + o.box.height)));
  const auto = (): Columns => (count > 1 && frame.balance ? (floatFlow(env, frame.id, story, cursor, contentTop, columns, run, ends, exclusions) ?? balance(env, run)) : run(Number.POSITIVE_INFINITY));
  const onBand = (at: number, band: Columns, last: boolean): void => {
    if (frame.columnRule === "rule" && count > 1) band.placed.columnRules.push(...columnRulesOf(frame, columns, at, band));
    // Rule 7: the story carries on in the next band, or in a frame after this one.
    if (!last || band.stop !== "end") {
      const lines = band.placed.lines.filter((l) => l.frame === frame.id);
      const col = Math.max(-1, ...lines.map((l) => l.column));
      const foot = lines.filter((l) => l.column === col).at(-1);
      // At the column's right edge, under whatever ends the column: its last line, or a picture that
      // runs on below a short line set beside it.
      const c = columns[col];
      const below = c ? band.placed.objects.filter((o) => o.box.x < c.x + c.width && o.box.x + o.box.width > c.x).map((o) => o.box.y + o.box.height) : [];
      if (foot && c) band.placed.continues.push({ frame: frame.id, x: c.x + c.width, y: Math.max(foot.y + foot.height, ...below) });
    }
  };

  // Design §2 (§09.7): a multi-column frame with automatic height in a page scene fills column bands.
  if (banded) {
    // Text before the story ends, or before a frame break sends it on.
    const textAfter = (from: Resume): boolean => {
      for (const b of story.blocks.slice(from.block)) {
        if (b.kind === "paragraph") return true;
        if (b.kind === "framebreak" && b.scope === "frame") return false;
      }
      return false;
    };
    /** An object still to come before the story ends or a frame break sends it on. */
    const objectsAfter = (from: Resume): boolean => {
      for (const b of story.blocks.slice(from.block)) {
        if (b.kind === "object") return true;
        if (b.kind === "framebreak" && b.scope === "frame") return false;
      }
      return false;
    };
    /** Rule 3 (see `bands`): the text ends with objects still waiting, so the band is set shorter. */
    const lone = (r: Columns): boolean => r.stop === "full" && (r.deferred.length > 0 || objectsAfter(r.cursor)) && !textAfter(r.cursor);
    const compose = env.budget > 0 ? composer(env, frame.id, story, cursor, columns, run, ends, lone, textAfter, exclusions) : undefined;
    // The visor: with no budget, every object that would float here falls back.
    if (env.picks && env.budget <= 0) for (const id of floatingIn(env, story, cursor)) env.picks.set(id, { reason: "fallback-budget", numbers: {} });
    const r = bands(env, contentTop, cursor, (limit, at, from, earlier, deferred) => run(limit, at, from, earlier, deferred), onBand, textAfter, feet, ends, lone, compose);
    anchorsAt(env, story, cursor, frame.id, r.placed);
    env.reports.push(...screenReports(env, frame.id, story, cursor, columns, r.placed));
    return { placed: r.placed, cursor: r.cursor, bottom: Math.max(contentTop, ...r.bottoms) + inset };
  }

  let result: Columns;
  if (height === null) result = auto();
  else {
    result = run(height - 2 * inset);
    // §09.5 grow: text left over after the last frame of its thread makes that frame auto-height.
    if (result.stop === "full" && lastInThread && story.overset === "grow") result = auto();
    else valign(env, frame, result, contentTop, height - 2 * inset);
  }
  onBand(contentTop, result, true);
  noteEnds(env, result, env.explain && result.balanced !== undefined ? { why: "balanced-last-page", numbers: { height: result.balanced } } : undefined);
  const used = Math.max(contentTop, ...result.bottoms) + inset;
  return { placed: result.placed, cursor: result.cursor, bottom: height === null ? used : Math.max(top + height, used) };
}

/**
 * §09.4, 2026-10-17: columns are balanced by whole blocks. Paragraphs, pictures and boxes stay in
 * reading order, filling from the left, and are never split across columns; a subhead goes with the
 * paragraph after it. The height is the smallest, in baseline steps, at which every block fits in the
 * columns; columns that height does not need stay empty, and one block alone stays in the first.
 * The search halves the height; keep-with-next breaks monotonic fitting, so it may settle on a taller
 * height than the smallest that fits, never losing text.
 */
function balance(env: Env, run: (limit: number) => Columns, rest = false): Columns {
  const bl = env.grid.baseline;
  const before = env.whole;
  // The columns filled as on any other page, splitting paragraphs: always takes what the caller gave.
  env.whole = false;
  const lines = run(Number.POSITIVE_INFINITY);
  env.whole = true;
  try {
    const natural = run(Number.POSITIVE_INFINITY);
    // Text that ends exactly at the last column's foot reports the column full, yet takes it all: that
    // fit counts (2026-10-07: two columns stayed 28 and 26 lines where 27 and 27 fit exactly).
    // §09.7 rule 5: a block kept with the next one never ends a column (a box over two columns can leave
    // a subhead's paragraph no room beside it).
    // `rest`: the text's last page with objects still to come after it (2026-10-17): those wait for
    // the next page as they do in the line setting, so a fit leaves the same ones waiting.
    const waits = (r: Columns): boolean => (rest ? r.deferred.join() === lines.deferred.join() : r.deferred.length === 0);
    const same = (r: Columns): boolean => r.cursor.block === lines.cursor.block && (r.stop !== "full" || waits(r)) && !r.collides && !keptApart(env, r.placed.lines);
    // Whole blocks that do not fit at all (a page's last band is only so tall, and the gaps they leave
    // take room): the columns stay filled in order, so nothing is left out.
    if (!same(natural)) return lines;
    // Anchored objects hang below the text they wrap; the search must reach heights that hold them too.
    const total = Math.max(...natural.bottoms, ...natural.placed.objects.map((o) => o.box.y + o.box.height)) - Math.min(...natural.tops);
    let lo = 1;
    let hi = Math.max(1, Math.ceil(total / bl));
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (same(run(mid * bl))) hi = mid;
      else lo = mid + 1;
    }
    // The upper bound is measured, not tried: when even it does not take the text (lines snapping to a
    // page's grid can need a line more), the natural setting stands.
    const tried = run(lo * bl);
    const best = same(tried) ? { ...tried, balanced: lo * bl } : natural;
    // Such a fit took all the text: it ends where the line setting does, not "full" (2026-10-11: a
    // last page whose columns ended exactly at the balanced foot got a continuation arrow).
    return best.stop === "full" ? { ...best, stop: lines.stop } : best;
  } finally {
    env.whole = before;
  }
}

/** A keep-with-next block's last line ends a column while the text after it starts another (§07.6, §09.7 rule 5). */
function keptApart(env: Env, lines: readonly PositionedLine[]): boolean {
  const text = lines.filter((l) => env.v.frames[l.frame]);
  return text.some((l, i) => {
    const n = text[i + 1];
    return n !== undefined && n.frame === l.frame && n.block !== l.block && n.column !== l.column && env.v.styles[l.style]?.keepWithNext === true;
  });
}

/** Design §4 column-rule: a line mid-gap between two adjacent columns that both hold text, from the band's first line's top to its tallest column's bottom. */
function columnRulesOf(frame: Frame, columns: Col[], top: number, band: Columns): PositionedColumnRule[] {
  // Limit: `band.bottoms` can carry a phantom entry for a column with zero lines (a paragraph
  // exhausted right at a trial height still reports a moved bottom, from block epilogue alone, before
  // the column ever tries to fetch a line and finds none left). Both "does this column hold text" and
  // "how tall is the band" are answered from `band.placed.lines` instead, which cannot be fooled that way.
  const used = columns.map((_, c) => band.placed.lines.some((l) => l.column === c));
  // `top` (the band's content top) sits above the text when a non-banded frame is valigned
  // center/bottom, so the rule must start where the text actually starts: its first line's top.
  const y = band.placed.lines.length ? Math.min(...band.placed.lines.map((l) => l.y)) : top;
  const bottom = Math.max(y, ...band.placed.lines.map((l) => l.y + l.height));
  const out: PositionedColumnRule[] = [];
  for (let c = 0; c + 1 < columns.length; c++)
    if (used[c] && used[c + 1]) out.push({ frame: frame.id, x: (columns[c]!.x + columns[c]!.width + columns[c + 1]!.x) / 2, y, height: bottom - y });
  return out;
}

/** The visor: a band-level outcome that names the columns ending at the band's foot (`bottom-line`) instead. */
type Over = { why: ColumnEndReason; numbers: Record<string, number> } | undefined;

/** The spec rule each column-end code stands on. */
const COLUMN_END_RULE: Record<ColumnEndReason, string> = {
  "bottom-line": "§09.7 rule 11",
  levelled: "§09.7 rule 11",
  "rule-3-cut": "§09.7 rule 6",
  "keep-with-next": "§07.6 keep-with-next",
  orphans: "§07.6 orphans",
  widows: "§07.6 widows",
  "hyphen-avoided": "§09.7 rule 9",
  "frame-break": "§09.3",
  "column-break": "§09.3",
  "story-end": "§09.3",
  "balanced-last-page": "§09.4",
  "stub-folded": "§09.7 rule 14",
  "picture-at-foot": "§09.7 rule 13",
};

/** The spec rule each picture code stands on. */
const PICTURE_RULE: Record<PictureReason, string> = {
  chosen: "§11.3 floating",
  waited: "§11.3 floating",
  "fallback-budget": "§09.7 rule 6",
  "fallback-no-spot": "§09.7 rule 6",
  here: "§09.7 rule 6",
};

/**
 * The visor (design 2026-10-21): one column-end decision for each column of a kept setting that holds
 * text, at whichever is lower, its last line or the lowest object in it (a pull quote set after the
 * text), and for one a picture ends (rule 13: it opens the column, so the column often holds no text),
 * at the picture. Then one picture decision for each anchored object the setting placed. Called only
 * where a setting is kept; a no-op when `explain` is off.
 */
function noteEnds(env: Env, set: Columns, over: Over): void {
  if (!env.explain) return;
  const screenOf = (y: number): number | null => screenAt(env, y);
  const objects = set.placed.objects.filter((o) => env.v.objects[o.name]?.placement.mode === "anchored");
  const inColumn = (o: PositionedObject, w: Columns["why"][number]): boolean => o.box.x < w.x + w.width - EPS && o.box.x + o.box.width > w.x + EPS;
  set.why.forEach((w, column) => {
    const last = set.placed.lines.filter((l) => l.frame === w.frame && l.column === column).at(-1);
    const pic = w.object === undefined ? undefined : set.placed.objects.find((o) => o.name === w.object);
    const low = objects.filter((o) => inColumn(o, w)).sort((a, b) => b.box.y + b.box.height - (a.box.y + a.box.height))[0];
    const at = pic?.box ?? (last && low && low.box.y + low.box.height > last.y + last.height + EPS ? low.box : last);
    if (!at) return;
    const swap = over !== undefined && w.code === "bottom-line";
    const reason = swap ? over.why : w.code;
    env.explain!.push({
      kind: "column-end",
      reason,
      screen: screenOf(at.y),
      frame: w.frame,
      column,
      at: box(at),
      numbers: swap ? { ...over.numbers } : w.moved !== undefined ? { lines: w.moved } : {},
      refs: { ...(last ? { blocks: [last.block] } : {}), ...(pic ? { objects: [pic.name] } : {}) },
      rule: COLUMN_END_RULE[reason],
    });
  });
  for (const o of objects) {
    const p = env.v.objects[o.name]!.placement as AnchoredPlacement;
    // No verdict: the object never floats (place=here, cols=, or a frame where nothing floats).
    const pick = env.picks!.get(o.name) ?? { reason: "here", numbers: {} };
    const column = set.why.findIndex((w) => inColumn(o, w));
    env.explain.push({
      kind: "picture",
      reason: pick.reason,
      screen: screenOf(o.box.y),
      frame: set.why[0]?.frame ?? null,
      column: column < 0 ? null : column,
      at: box(o.box),
      numbers: { ...pick.numbers },
      refs: { blocks: [p.block], objects: [o.name] },
      rule: PICTURE_RULE[pick.reason],
      ...(pick.alternatives ? { alternatives: pick.alternatives } : {}),
    });
  }
  // Space: strips under min-slot, one a run of bands down an object's side (a line apart at most).
  const strips: Narrow[] = [];
  for (const n of [...(set.placed.narrow ?? [])].sort((a, b) => a.frame.localeCompare(b.frame) || a.column - b.column || a.x - b.x || a.y - b.y)) {
    const prev = strips.at(-1);
    const joins = prev && prev.frame === n.frame && prev.column === n.column && prev.object === n.object && Math.abs(prev.x - n.x) < 1 && n.y <= prev.y + prev.height + n.height + EPS;
    if (joins) (prev.height = Math.max(prev.height, n.y + n.height - prev.y)), (prev.width = Math.max(prev.width, n.width));
    else strips.push({ ...n });
  }
  for (const n of strips)
    space(env, "slot-too-narrow", { x: n.x, y: n.y, width: n.width, height: n.height }, n.frame, n.column, { width: n.width, min: n.min }, n.object);
  // Rule 12: a photograph this setting holds that is taller (or shorter, cropped) so its page ends full.
  for (const o of set.placed.objects) {
    const k = env.grow?.get(o.name) ?? 0;
    if (k !== 0 && o.media) space(env, k > 0 ? "grown" : "cropped", box(o.media), set.why[0]?.frame ?? null, null, { px: Math.abs(k) }, o.name);
  }
}

/**
 * The visor: line decisions, read from each kept line and its style once every scene is set.
 * Justified lines follow what the renderer draws: a block's last line in the scene and one under
 * justify-min (a % of the viewport's width, as the renderer reads it) are ragged, and the rest open or close their spaces
 * by `justifySpacing`, loose past 2 of a normal space and tight under 0.8.
 */
function noteLines(v: Variant, cache: PrepareCache, viewport: Viewport, kept: readonly { env: Env; scene: PositionedScene }[]): void {
  const key = (l: PositionedLine): string => `${l.story}\u0000${l.block}`;
  const spaces = new Map<string, number>();
  for (const { env, scene } of kept) {
    const last = new Map<string, PositionedLine>();
    for (const l of scene.lines) last.set(key(l), l);
    for (const l of scene.lines) {
      const style = v.styles[l.style];
      if (!style) continue;
      const ctx: EvalContext = { viewport, grid: scene.grid, pctOf: viewport.width };
      const note = (reason: LineReason, numbers: Record<string, number>, rule: string): number =>
        env.explain!.push({ kind: "line", reason, screen: screenAt(env, l.y), frame: l.frame, column: l.column, at: box(l), numbers, refs: { blocks: [l.block] }, rule });
      if (style.align === "justify") {
        const end = last.get(key(l)) === l;
        if (end || (style.justifyMin && l.width < px(style.justifyMin, ctx) - 0.5)) note("ragged", { reasonCode: end ? 1 : 2 }, end ? "§07.6 justify" : "§07.6 justify-min");
        else {
          const f = engineFont(style, ctx);
          const font = l.size ? { ...f, size: l.size } : f;
          const extra = justifySpacing(l.hang ? { ...l, width: l.width + l.hang.left + l.hang.right } : l, font.size);
          const k = `${l.style}|${font.size}`;
          if (!spaces.has(k)) {
            const w = (t: string): number => cache.engine.nextLine(cache.get([{ text: t, font }], font), CURSOR_START, 1e9)?.width ?? 0;
            spaces.set(k, w("x x") - w("xx"));
          }
          const normal = spaces.get(k)!;
          const ratio = normal > 0 ? Math.round(((normal + extra) / normal) * 100) / 100 : 1;
          if (ratio > 2) note("loose", { ratio }, "§07.6 justify");
          else if (ratio < 0.8) note("tight", { ratio }, "§07.6 justify");
        }
      }
      if (l.hang) note("hung", { left: l.hang.left, right: l.hang.right }, "§07.6 hang");
      if (l.text.endsWith(SHY_CHAR)) note("hyphenated", {}, "§07.6 hyphenate");
    }
  }
}

const box = (r: Rect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

/** In screen pages, the screen `y` is on, counted from the document's top (as `ScreenReport`); null when the scene scrolls. */
function screenAt(env: Env, y: number): number | null {
  const vh = env.viewport.height;
  return env.pageGrids ? Math.floor((env.sceneY + Math.floor((y - env.sceneY + EPS) / vh) * vh + EPS) / vh) + 1 : null;
}

const SPACE_RULE: Record<SpaceReason, string> = { "slot-too-narrow": "§09.6 step 3", cropped: "§09.7 rule 12", grown: "§09.7 rule 12", "early-end": "§09.7 rule 12" };

/** The visor: one space decision. */
function space(env: Env, reason: SpaceReason, at: Rect, frame: string | null, column: number | null, numbers: Record<string, number>, object?: string): void {
  env.explain!.push({ kind: "space", reason, screen: screenAt(env, at.y), frame, column, at, numbers, refs: object ? { objects: [object] } : {}, rule: SPACE_RULE[reason] });
}

/** The visor: each object of a chosen combination gets its score, its window and its spot in the runners-up. */
function pickChosen(env: Env, best: { combo: Candidate[]; cost: number; parts: PenaltyParts; ranked: { combo: Candidate[]; cost: number }[] }, reason: (id: string) => PictureReason, window: (id: string) => Record<string, number>, own: (c: Candidate) => number): void {
  const spotOf = (c: Candidate): string => ("box" in c ? `${c.size} ${c.spot.place} cols ${c.first + 1}-${c.first + c.span}` : "wait");
  for (const c of best.combo) {
    if (!("box" in c)) continue;
    const alternatives: NonNullable<Decision["alternatives"]> = [];
    for (const r of best.ranked.slice(1)) {
      const a = r.combo.find((x) => x.id === c.id);
      if (!a || spotOf(a) === spotOf(c) || alternatives.some((x) => x.spot === spotOf(a))) continue;
      alternatives.push({ spot: spotOf(a), size: "box" in a ? a.size : "", score: r.cost });
    }
    env.picks!.set(c.id, { reason: reason(c.id), numbers: { ...best.parts, score: best.cost, ownDistance: own(c), ...window(c.id) }, alternatives });
  }
}

/**
 * §09.7 column bands. The first band runs from `contentTop` to the bottom of the first screen (less
 * margin-y), or starts on the next screen when that leaves less than a line. Each later band is one
 * screen tall, one row-gap below the last. The last band, where the story ends or a frame break
 * sends it on, is balanced. `onBand` sees each band before it is added.
 */
function bands(
  env: Env,
  contentTop: number,
  start: Resume,
  run: (limit: number, at: number, from: Resume, earlier: readonly Exclusion[], deferred: readonly string[]) => Columns,
  onBand: (at: number, band: Columns, last: boolean) => void,
  /** Whether text is left to set from a resume point before the story or the frame's part ends. */
  textAfter: (from: Resume) => boolean = () => true,
  /** Where each column's text ends in a band (-Infinity for a column with none). */
  feet: (band: Columns) => number[] = () => [],
  /** Where each column's content ends, pictures included. */
  ends: (band: Columns) => number[] = feet,
  /** Rule 3: the text ends in a band with objects still waiting, so the next page would hold them alone. */
  lone: (band: Columns) => boolean = () => false,
  /** Picture composition (2026-10-17): the frame's floating objects, screen by screen. */
  compose?: Composer,
): Columns {
  const { grid, viewport, sceneY } = env;
  const screen = viewport.height - 2 * grid.marginY;
  let at = contentTop;
  // The first band ends at the bottom of the screen `at`'s content top is on, not always screen 1:
  // a frame whose content starts on a later screen (e.g. stacked below a long banded frame) must not
  // measure its first band against screen 1's bottom, which would go negative and misplace it.
  const k = Math.floor((at - sceneY) / viewport.height);
  let limit = sceneY + (k + 1) * viewport.height - grid.marginY - at;
  // Limit: "less than a line" is one baseline step; a frame whose first style is taller may still start with an empty band.
  // Design 2026-09-29 rule 1: less than a quarter of a band left (a third until 2026-09-30, when the
  // one-line grid pushed a laptop's first band just under it), and the text starts on the next screen.
  const next = limit < grid.baseline || limit < screen / 4;
  if (next) (at = sceneY + (k + 1) * viewport.height + grid.marginY), (limit = screen);
  /** The screen the current band is on: every later band starts on the next screen (rule 1). */
  let page = next ? k + 1 : k;
  const out = empty();
  const tops: number[] = [];
  const bottoms: number[] = [];
  let from = start;
  /** Objects placed in earlier bands can hang into later ones (an object taller than what was left of its band). */
  const earlier: Exclusion[] = [];
  /** Objects that did not fit in a band's last column (§11.3): they open the next band. */
  let waiting: readonly string[] = [];
  // 2026-10-07: every page's lines sit on the same grid, so the columns of every page line up alike.
  const originOf = (p: number): number => pageOrigin(env, p);
  env.origin = originOf(page);
  /** Objects set in earlier bands that run on below `y` (one taller than what was left of its band), as boxes to keep clear of. */
  const hanging = (y: number): Exclusion[] =>
    out.objects.filter((o) => o.box.y + o.box.height > y + EPS && env.v.objects[o.name]?.placement.mode !== "contained").map((o) => ({ id: o.name, box: o.box, shape: { kind: "rect" }, offset: 0, side: "both", jump: true }));
  /** The last band set, to set again when the section's last page would be a stub. */
  let prev: { mark: ReturnType<typeof mark>; tops: number; bottoms: number; earlier: number; at: number; limit: number; from: Resume; waiting: readonly string[]; page: number; band: Columns; floated: Env["floated"]; explain: number; over: Over } | null = null;
  for (;;) {
    // The screen's floating objects are chosen first; every setting of the screen below keeps them.
    /** How much shorter the composer set this band, rule 3 applied (2026-10-17). */
    let cut = 0;
    /** The visor: how much shorter rule 3 and the levelling set the band, in px. */
    let rule3 = 0;
    let level = 0;
    if (compose) {
      // Objects that fall back join those already waiting in story order, so earlier ones open the band first.
      let extra: string[];
      ({ extra, cut } = compose.screen(page, at, limit, from, earlier, waiting, hanging(at)));
      rule3 = cut;
      // The chosen setting was scored on the band as rule 3 sets it: this band is that much shorter.
      limit -= cut;
      const block = (id: string) => (env.v.objects[id]!.placement as AnchoredPlacement).block;
      if (extra.length) waiting = [...waiting, ...extra].sort((a, b) => block(a) - block(b));
    }
    let full = run(limit, at, from, earlier, waiting);
    // Rule 3 (2026-09-30): a band that ends the text with objects still waiting would leave the next
    // page to them alone. It sets a line less at a time until some of the text goes over with them.
    // A band the composer set already has rule 3 applied: its boxes stand against that foot.
    if (lone(full) && !cut)
      for (let k = grid.baseline; k < limit / 2; k += grid.baseline) {
        const t = run(limit - k, at, from, earlier, waiting);
        if (textAfter(t.cursor)) {
          full = t;
          rule3 = k;
          break;
        }
      }
    // Still a quote or fact box left for a page of its own (too little text to carry over): pictures
    // carried in from the last page wait one more instead, so the quote sets with the text and the
    // pictures open the next page, which may hold pictures alone (2026-10-07).
    const tied = (id: string): boolean => env.v.objects[id]?.kind === "pullquote" || env.v.objects[id]?.kind === "sidebar";
    let holdOver: string[] = [];
    if (lone(full) && full.deferred.some(tied)) {
      const held = waiting.filter((id) => !tied(id));
      const t = held.length ? run(limit, at, from, earlier, waiting.filter(tied)) : null;
      if (t && !t.deferred.some(tied)) (full = t), (waiting = waiting.filter(tied)), (holdOver = held);
    }
    // 2026-09-30: a page's columns end on the same line. Where a kept subhead or a paragraph's
    // first lines moving on would leave a column short, the band is set a line shorter at a time, up
    // to six lines (a subhead, its space and two lines of text moving on is four), and the try whose
    // columns end closest together wins (the first that ends them all on one line; ties to the
    // longer band). Limit: short of editing the copy, as a magazine would, a page can end a few
    // lines early, or rarely stay a line apart.
    // With floating boxes on the screen (2026-10-17), a column ends where its content does: a box at
    // the foot ends it, and text that stops above a box is not short.
    const boxed = [...(env.floated?.values() ?? [])].some((f) => f !== null);
    const spread = (r: Columns): number => {
      const f = (boxed ? ends(r) : feet(r)).filter(Number.isFinite);
      return f.length ? Math.max(...f) - Math.min(...f) : 0;
    };
    if (full.stop === "full" && spread(full) > EPS) {
      let best = full;
      for (let cut = grid.baseline; cut <= 6 * grid.baseline + EPS && cut < limit / 2; cut += grid.baseline) {
        const t = run(limit - cut, at, from, earlier, waiting);
        // A try that sets nothing is level only because it has no columns: never a candidate.
        if (t.stop !== "full" || lone(t) || sameResume(t.cursor, from) || spread(t) >= spread(best) - EPS) continue;
        best = t;
        level = cut;
        if (spread(t) <= EPS) break;
      }
      full = best;
    }
    const levelled = full;
    // Rule 12 (2026-10-07): a page whose columns end short of the
    // foot, level or not, has a photograph on it take the difference, a line at a time taller (or
    // shorter, by up to three lines), cropped. The first height that ends every column, text or
    // picture, on the page's last line wins; the smallest change first.
    const foot = at + limit;
    const short = (r: Columns): boolean => foot - Math.max(...ends(r).filter(Number.isFinite)) >= grid.baseline - EPS;
    if (full.stop === "full" && (short(full) || spread(full) > EPS)) {
      const photos = full.placed.objects.filter((o) => {
        const r = env.v.objects[o.name];
        // Only a photograph that crops (fit=cover): a diagram set to contain keeps all of itself.
        return r?.kind === "figure" && r.placement.mode !== "contained" && r.media.shape.kind === "rect" && r.media.fit === "cover" && o.media !== null;
      });
      const steps = [1, 2, 3, 4, 5, 6, -1, -2, -3];
      search: for (const p of photos)
        for (const k of steps) {
          const h = p.media!.height + k * grid.baseline;
          if (h < p.media!.height * 0.6 || h > 0.85 * screen) continue;
          const before = env.grow;
          env.grow = new Map([...(before ?? []), [p.name, k * grid.baseline]]);
          const t = run(limit, at, from, earlier, waiting);
          const inside = t.placed.objects.every((o) => o.box.y + o.box.height <= foot + EPS);
          const fits = t.stop === "full" && !t.collides && inside && !lone(t) && !sameResume(t.cursor, from) && spread(t) <= EPS && !short(t);
          if (fits) {
            full = t;
            break search;
          }
          env.grow = before;
        }
    }
    const done = full.stop !== "full";
    // 2026-10-17: every floating object waits on this screen and the text still ends here (rule 3
    // could not carry any on): this is the text's last page. It is balanced by whole blocks, as the
    // story's end is; the pictures follow on the pages after it.
    const last = !done && compose !== undefined && compose.left() && ![...(env.floated?.values() ?? [])].some((f) => f !== null) && lone(full);
    let folded = 0;
    let band = done || last ? rise(env, (l) => run(Math.min(l, limit), at, from, earlier, waiting), last, foot) : full;
    // 2026-10-08: a section's last page never holds a stub of three lines or fewer and nothing
    // else. The page before is set again at its full height; when the rest of the text fits there,
    // that page ends the section (balanced) and the stub page goes.
    if (done && prev && band.placed.objects.length === 0 && band.placed.lines.length > 0 && band.placed.lines.length <= 3) {
      rollback(out, prev.mark);
      if (env.explain) env.explain.length = prev.explain;
      tops.length = prev.tops;
      bottoms.length = prev.bottoms;
      earlier.length = prev.earlier;
      env.origin = originOf(prev.page);
      const floated = env.floated;
      env.floated = prev.floated;
      const fits = (r: Columns): boolean => r.stop !== "full" && !r.collides;
      // 2026-10-20: a page its floating pictures fill is set again with one of them moved on to the
      // next page, the last in story order first, so the stub's lines fit. Only a picture anchored on
      // that page (the next one is inside its window), never a quote or fact box (it would be alone).
      const movable = [...(prev.floated ?? [])]
        .flatMap(([id, f]) => (f && !tied(id) && (env.v.objects[id]!.placement as AnchoredPlacement).block >= prev!.from.block ? [id] : []))
        .sort((a, b) => (env.v.objects[b]!.placement as AnchoredPlacement).block - (env.v.objects[a]!.placement as AnchoredPlacement).block);
      let moved: string | null = null;
      if (!fits(run(prev.limit, prev.at, prev.from, earlier, prev.waiting)))
        for (const id of movable) {
          env.floated = new Map(prev.floated).set(id, null);
          if (fits(run(prev.limit, prev.at, prev.from, earlier, prev.waiting))) {
            moved = id;
            break;
          }
          env.floated = prev.floated;
        }
      if (moved !== null || fits(run(prev.limit, prev.at, prev.from, earlier, prev.waiting))) {
        folded = band.placed.lines.length;
        band = rise(env, (l) => run(Math.min(l, prev!.limit), prev!.at, prev!.from, earlier, prev!.waiting), false, prev.at + prev.limit);
        at = prev.at;
        page = prev.page;
        // The next page chooses the moved picture's spot.
        if (moved !== null) compose?.release(moved);
      } else {
        // It does not fit: both pages stand as they were.
        env.origin = originOf(page);
        env.floated = floated;
        append(out, prev.band.placed);
        noteEnds(env, prev.band, prev.over);
        tops.push(...prev.band.tops);
        bottoms.push(...prev.band.bottoms);
        earlier.push(...prev.band.carried);
      }
    }
    // The visor: a band-level outcome names the columns that ended at the band's (shortened) foot.
    const bl = grid.baseline;
    const r3 = band === levelled ? rule3 : cut;
    const over: Over = !env.explain ? undefined
      : folded ? { why: "stub-folded", numbers: { lines: folded } }
      : band.balanced !== undefined ? { why: "balanced-last-page", numbers: { height: band.balanced } }
      : band === levelled && level > 0 ? { why: "levelled", numbers: { lines: Math.round(level / bl) } }
      : r3 > 0 ? { why: "rule-3-cut", numbers: { lines: Math.round(r3 / bl) } }
      : undefined;
    prev = { mark: mark(out), tops: tops.length, bottoms: bottoms.length, earlier: earlier.length, at, limit, from, waiting, page, band, floated: env.floated, explain: env.explain?.length ?? 0, over };
    onBand(at, band, done);
    append(out, band.placed);
    noteEnds(env, band, over);
    tops.push(...band.tops);
    bottoms.push(...band.bottoms);
    earlier.push(...band.carried);
    // A band that set nothing would repeat forever: stop, as an overset frame does.
    const idle = sameResume(band.cursor, from) && band.placed.lines.length === 0 && band.placed.objects.length === 0;
    // 2026-10-07: a picture taller than a band hangs into the next ones (W043). A band it fills sets
    // nothing, and the text continues on the first band below the picture's foot.
    const covered = idle && !done && earlier.some((e) => e.box.y + e.box.height > at + EPS);
    // A floating object still to place keeps the frame going, as objects held over do.
    if ((done && holdOver.length === 0 && !compose?.left()) || (idle && !covered)) {
      env.origin = undefined;
      env.floated = undefined;
      return { placed: out, cursor: band.cursor, stop: band.stop, tops, bottoms, carried: earlier, deferred: band.deferred, why: [] };
    }
    waiting = [...holdOver, ...band.deferred];
    // Going on after a frame break (an object still to place) starts at the break, never past it: the
    // text after it is the next frame's.
    from = done && band.stop === "frame" ? { ...START, block: band.cursor.block - 1 } : band.cursor;
    at = sceneY + ++page * viewport.height + grid.marginY;
    env.origin = originOf(page);
    limit = screen;
  }
}

/** Picture composition (2026-10-17) for one banded frame; see `composer`. */
type Composer = {
  /** Before screen `page` is set: chooses its floating objects (into `env.floated`) and returns those that fall back to today's rule and open the band (§11.3). */
  screen: (page: number, at: number, limit: number, from: Resume, earlier: readonly Exclusion[], waiting: readonly string[], hanging: readonly Exclusion[]) => { extra: string[]; cut: number };
  /** Floating objects still to place: the frame does not end before they are set. */
  left: () => boolean;
  /** An object set on the screen before goes back to those still to place (the stub fold, 2026-10-20). */
  release: (id: string) => void;
};

/** The objects that float (design 2026-10-17, "The author's words"). */
const FLOATING = new Set<ObjectElement["kind"]>(["figure", "video", "lottie", "gallery", "pullquote", "sidebar"]);

/** A banded frame's floating objects in story order: from `start` to a frame break. */
function floatingIn(env: Env, story: Story, start: Resume): string[] {
  const ids: string[] = [];
  for (const b of story.blocks.slice(start.block)) {
    if (b.kind === "framebreak" && b.scope === "frame") break;
    if (b.kind !== "object") continue;
    const o = env.v.objects[b.object]!;
    if (!o.hidden && o.placement.mode === "anchored" && o.placement.place !== "here" && o.placement.horizontal.mode !== "cols" && FLOATING.has(o.kind)) ids.push(o.id);
  }
  return ids;
}

/**
 * The `anchoredAt` of each object that may float in a banded frame, whether composition set it or
 * today's rule did: its anchor's y in the text set, below the last line before it (the window rule
 * measures from here).
 */
function anchorsAt(env: Env, story: Story, start: Resume, frameId: string, placed: Placed): void {
  const ids = new Set(floatingIn(env, story, start));
  const lines = placed.lines.filter((l) => l.frame === frameId);
  for (const o of placed.objects) {
    if (!ids.has(o.name)) continue;
    const at = (env.v.objects[o.name]!.placement as AnchoredPlacement).block;
    const before = lines.filter((l) => l.block < at).at(-1);
    const after = lines.find((l) => l.block > at);
    o.anchoredAt = before ? before.y + before.height : after ? after.y : o.anchoredAt;
  }
}

/**
 * The copyfitting report (design 2026-10-17) for a banded frame, one per screen it set: how many
 * lines its columns end short of the bottom line (never on its last screen), the photograph that
 * could grow, and the floating objects set two screens or more from their anchor.
 */
function screenReports(env: Env, frameId: string, story: Story, start: Resume, columns: Col[], placed: Placed): ScreenReport[] {
  const { sceneY, grid, v, rd } = env;
  const vh = env.viewport.height;
  const screenOf = (y: number): number => Math.floor((y - sceneY + EPS) / vh);
  const order = (name: string): number => {
    const p = v.objects[name]!.placement;
    return p.mode === "anchored" ? p.block : Number.POSITIVE_INFINITY;
  };
  const floating = new Set(floatingIn(env, story, start));
  const lines = placed.lines.filter((l) => l.frame === frameId);
  const objects = placed.objects.filter((o) => v.objects[o.name]?.placement.mode !== "contained").sort((a, b) => order(a.name) - order(b.name));
  const pages = [...new Set([...lines.map((l) => screenOf(l.y)), ...objects.map((o) => screenOf(o.box.y))])].sort((a, b) => a - b);
  return pages.map((p) => {
    const top = sceneY + p * vh;
    const foot = top + vh - grid.marginY;
    const on = lines.filter((l) => screenOf(l.y) === p);
    const here = objects.filter((o) => screenOf(o.box.y) === p);
    const ends = columns.flatMap((col, c) => {
      const last = on.filter((l) => l.column === c).at(-1);
      if (!last) return [];
      const boxes = objects.filter((o) => o.box.y < top + vh && o.box.y + o.box.height > top && o.box.x < col.x + col.width - EPS && o.box.x + o.box.width > col.x + EPS);
      return [Math.max(last.y + last.height, ...boxes.map((o) => o.box.y + o.box.height))];
    });
    const short = p !== pages.at(-1) && ends.length ? Math.max(0, Math.round((foot - Math.max(...ends)) / grid.baseline)) : 0;
    // The visor: the screen ends a line or more short, from its lowest column end to the bottom line.
    if (env.explain && short >= 1) {
      const low = Math.max(...ends);
      const right = columns.at(-1)!;
      space(env, "early-end", { x: columns[0]!.x, y: low, width: right.x + right.width - columns[0]!.x, height: foot - low }, frameId, null, { lines: short });
    }
    const para = [...on].reverse().map((l) => story.blocks[l.block]).find((b) => b?.kind === "paragraph");
    const words = para?.kind === "paragraph" ? para.runs.map((r) => (r.kind === "text" ? rd.strings[r.s]! : " ")).join("").replace(SHY, "").split(/\s+/).filter(Boolean).slice(0, 5).join(" ") : "";
    const photo = here.find((o) => {
      const r = v.objects[o.name];
      return r?.kind === "figure" && r.media.shape.kind === "rect" && r.media.fit === "cover" && o.media !== null;
    });
    const far = here.flatMap((o) => {
      const screens = o.anchoredAt === null ? 0 : p - screenOf(o.anchoredAt);
      return floating.has(o.name) && screens >= 2 ? [{ object: o.name, screens }] : [];
    });
    return { screen: Math.floor((top + EPS) / vh) + 1, short, lastParagraph: words, photo: photo?.name ?? null, far };
  });
}

/**
 * `balance`, then (2026-10-21) the floating boxes at the band's `foot` rise into the empty room above
 * them, by whole lines, when the balanced columns end higher: the text's last page has no hole inside
 * a column either. Kept only when nothing collides and the text still ends here.
 */
function rise(env: Env, run: (limit: number) => Columns, rest: boolean, foot: number): Columns {
  const band = balance(env, run, rest);
  const bl = env.grid.baseline;
  const lines = band.placed.lines.filter((l) => env.v.frames[l.frame]);
  const up = new Map(env.floated);
  for (const [id, f] of env.floated ?? []) {
    const o = f && f.box.y + f.box.height > foot - bl + EPS ? band.placed.objects.find((x) => x.name === id) : undefined;
    if (!o) continue;
    const e = o.exclusion?.box ?? o.box;
    const off = o.exclusion?.offset ?? 0;
    const across = (r: Rect): boolean => r.x < e.x + e.width + off - EPS && r.x + r.width > e.x - off + EPS && r.y < e.y - EPS;
    const above = lines.filter(across);
    if (above.length === 0) continue;
    const others = band.placed.objects.filter((x) => x.name !== id && across(x.exclusion?.box ?? x.box)).map((x) => (x.exclusion ? x.exclusion.box.y + x.exclusion.box.height + x.exclusion.offset : x.box.y + x.box.height));
    const k = Math.floor((e.y - off - Math.max(...above.map((l) => l.y + l.height), ...others)) / bl + EPS);
    if (k >= 1) up.set(id, { ...f!, box: { ...f!.box, y: f!.box.y - k * bl } });
  }
  if ([...up].every(([id, f]) => f === env.floated!.get(id))) return band;
  const was = env.floated;
  env.floated = up;
  const t = balance(env, run, rest);
  if (!t.collides && t.stop === band.stop) return t;
  env.floated = was;
  return band;
}

/**
 * Picture composition, 2026-10-17, for a multi-column frame in a scrolling scene: the frame is one
 * screen (index 0) from its content top, a screen's band tall. Its floating objects anchored within
 * that band, at most three in story order, compete for `place=top` spots only; the rest, and every object when no combination
 * keeps the hard rules, keep today's placement (`null` before any trial: the caller balances). The columns balance by whole blocks below
 * and around the boxes chosen.
 */
function floatFlow(
  env: Env,
  frameId: string,
  story: Story,
  start: Resume,
  top: number,
  columns: Col[],
  run: (limit: number) => Columns,
  ends: (band: Columns) => number[],
  /** The frame's wrapping objects (a scene's cut-out): no box goes over them. */
  exclusions: readonly Exclusion[],
): Columns | null {
  const { v, grid, viewport, sceneY } = env;
  const ids = floatingIn(env, story, start);
  if (env.picks && !env.page && env.budget <= 0) for (const id of ids) env.picks.set(id, { reason: "fallback-budget", numbers: {} });
  if (env.page || env.budget <= 0 || ids.length === 0) return null;
  const today = balance(env, run);
  const lines = today.placed.lines.filter((l) => l.frame === frameId);
  const band = viewport.height - 2 * grid.marginY;
  const g: ScreenGeometry = { index: 0, top, foot: top + band, band, columns, baseline: grid.baseline, origin: env.origin ?? sceneY };
  const spots = v.spots.filter((s) => s.place === "top");
  const { floatOf } = floatMaker(env, columns, ids);
  const { summarise } = trials(env, frameId, columns, ends);
  const eligible = ids
    .flatMap((id) => {
      const at = (v.objects[id]!.placement as AnchoredPlacement).block;
      const near = lines.filter((l) => l.block < at).at(-1) ?? lines.find((l) => l.block > at);
      // Near is within one band of the frame's top: an object anchored lower keeps today's placement.
      if (near && near.y >= top + band) return [];
      // Screen -1: there is no later screen to wait for, so `candidates` offers no `wait`.
      return [floatOf(id, { screen: -1, column: near?.column ?? 0 })];
    })
    // A whole screen (`place=screen`) has no meaning in a scrolling frame.
    .filter((f) => f.place !== "screen" && candidates(f, spots, g).some((c) => "box" in c));
  const floats = eligible.slice(0, 3);
  // The visor: left out with no spot (anchored low, or no box fits), or past the three that compete.
  if (env.picks) for (const id of ids) env.picks.set(id, { reason: eligible.slice(3).some((f) => f.id === id) ? "fallback-budget" : "fallback-no-spot", numbers: {} });
  if (floats.length === 0) return today;
  /** Each combination's setting, by the array `choose` passes and returns. */
  const set = new Map<Candidate[], Columns>();
  const tryLayout = (combo: Candidate[]): TrialSummary => {
    const was = env.floated;
    // A top box is never cropped (`candidates` crops at the foot only): `fixed` stays false.
    env.floated = new Map(combo.flatMap((c) => ("box" in c ? [[c.id, { box: c.box, fixed: false }] as const] : [])));
    try {
      const t = balance(env, run);
      set.set(combo, t);
      // The foot only bounds the boxes; the text below it scrolls on.
      return summarise(t, combo, { ...g, foot: Number.POSITIVE_INFINITY }, start, [], exclusions);
    } finally {
      env.floated = was;
    }
  };
  let calls = 0;
  const best = choose(floats, spots, g, (c) => (calls++, tryLayout(c)), null, env.budget);
  env.onCompose?.(0, set.size);
  // With no valid combination, the search spent its budget or found none.
  if (env.picks && !best && calls >= env.budget) for (const f of floats) env.picks.set(f.id, { reason: "fallback-budget", numbers: {} });
  if (env.picks && best) pickChosen(env, best, () => "chosen", () => ({}), (c) => distance(c, floats.find((f) => f.id === c.id)!, g));
  if (!best) return today;
  const t = set.get(best.combo)!;
  anchorsAt(env, story, start, frameId, t.placed);
  // The frame ends below its boxes and their standoff too, so a frame stacked below never runs beside one.
  const boxes = t.placed.objects.filter((o) => best.combo.some((c) => c.id === o.name)).map((o) => (o.exclusion ? o.exclusion.box.y + o.exclusion.box.height : o.box.y + o.box.height));
  return { ...t, bottoms: [...t.bottoms, ...boxes] };
}

/** A composition trial's summary (`TrialSummary`) for one frame, and the objects that run past a foot. */
function trials(env: Env, frameId: string, columns: Col[], ends: (band: Columns) => number[]) {
  const { v } = env;
  const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;
  /** A box over an exclusion's shape: a cut-out's outline, not its transparent corners (2026-10-20). */
  const covers = (a: Rect, e: Exclusion): boolean => {
    if (!overlap(a, e.box)) return false;
    const ext = bandExtent({ ...e, offset: 0 }, a.y, a.y + a.height);
    return ext !== null && ext[0] < a.x + a.width - EPS && ext[1] > a.x + EPS;
  };
  /** The objects of a setting that run past the band's foot. */
  const overflow = (t: Columns, foot: number): string[] => t.placed.objects.filter((o) => v.objects[o.name]?.placement.mode !== "contained" && o.box.y + o.box.height > foot + EPS).map((o) => o.name);
  /** `over`: objects that run past the foot without any box (taller than a band): those may. */
  const summarise = (t: Columns, combo: Candidate[], g: ScreenGeometry, from: Resume, over: readonly string[], earlier: readonly Exclusion[]): TrialSummary => {
    const lines = t.placed.lines.filter((l) => l.frame === frameId);
    const objects = t.placed.objects.filter((o) => v.objects[o.name]?.placement.mode !== "contained");
    const boxes = combo.flatMap((c) => ("box" in c ? [{ c, p: objects.find((o) => o.name === c.id) }] : []));
    // Every box set, and nothing pushed past the foot by them (an object waiting would hang onto the next page).
    const allSet = !t.collides && boxes.every((b) => b.p) && overflow(t, g.foot).every((n) => over.includes(n)) && (lines.length > 0 || boxes.length > 0 || !sameResume(t.cursor, from));
    // An object hanging from the band before (taller than its band) counts too, and so does a wrapping
    // object of the frame's own (a scene's cut-out, by its outline).
    // A subhead never ends a column (§09.7 rule 5): a box can leave its paragraph no room beside it.
    if (keptApart(env, lines)) return { allSet: false, overlaps: false, stubs: false, feet: columns.map(() => g.foot), last: t.stop !== "full", alone: false, gaps: 0 };
    const overlaps = boxes.some(({ c, p }) => p && (objects.some((o) => o.name !== c.id && overlap(p.box, o.box)) || earlier.some((e) => covers(p.box, e)) || lines.some((l) => overlap(p.box, l))));
    // Rule 13 as a hard rule: one or two lines alone between a box and the band's top or foot, or another box, in a column it spans.
    const stubs = columns.some((col) => {
      const inCol = boxes.flatMap((b) => (b.p && b.p.box.x < col.x + col.width - EPS && b.p.box.x + b.p.box.width > col.x + EPS ? [b.p.box] : [])).sort((a, b) => a.y - b.y);
      if (inCol.length === 0) return false;
      const edges = [g.top, ...inCol.flatMap((b) => [b.y, b.y + b.height]), g.foot];
      const own = lines.filter((l) => l.x < col.x + col.width - EPS && l.x + l.width > col.x + EPS);
      for (let i = 0; i < edges.length; i += 2) {
        const n = own.filter((l) => l.y >= edges[i]! - EPS && l.y + l.height <= edges[i + 1]! + EPS).length;
        if (n > 0 && n < 3) return true;
      }
      return false;
    });
    const screen = combo.some((c) => "box" in c && v.objects[c.id]!.placement.mode === "anchored" && (v.objects[c.id]!.placement as AnchoredPlacement).place === "screen");
    const feet = screen ? columns.map(() => g.foot) : ends(t).map((f) => (Number.isFinite(f) ? f : g.top));
    const alone = lines.length === 0 && combo.some((c) => "box" in c && (v.objects[c.id]!.kind === "pullquote" || v.objects[c.id]!.kind === "sidebar"));
    return { allSet, overlaps, stubs, feet, last: t.stop !== "full", alone, gaps: holes(t, lines, objects, g.baseline) };
  };
  return { overflow, summarise };
}

/**
 * 2026-10-20: whole lines of empty room inside the columns, next to a box or beside one, where text
 * stops short of a box under it, or a strip beside a box stays empty. A box counts with its standoff.
 */
function holes(t: Columns, lines: readonly PositionedLine[], objects: readonly PositionedObject[], bl: number): number {
  let n = 0;
  for (const c of new Set(lines.map((l) => l.column))) {
    const own = lines.filter((l) => l.column === c);
    const [left, right] = [Math.min(...own.map((l) => l.x)), Math.max(...own.map((l) => l.x + l.width))];
    const boxes = objects.flatMap((o) => {
      const e = o.exclusion?.box ?? o.box;
      const off = o.exclusion?.offset ?? 0;
      return o.box.x < right - EPS && o.box.x + o.box.width > left + EPS ? [{ top: e.y - off, bottom: e.y + e.height + off, full: e.x - off <= left + EPS && e.x + e.width + off >= right - EPS }] : [];
    });
    if (boxes.length === 0) continue;
    const spans = [...own.map((l) => ({ top: l.y, bottom: l.y + l.height, box: false })), ...boxes.filter((b) => b.full).map((b) => ({ ...b, box: true }))].sort((a, b) => a.top - b.top);
    let { bottom, box } = spans[0]!;
    for (const s of spans.slice(1)) {
      const gap = s.top - bottom;
      if (gap > bl + EPS && (box || s.box || boxes.some((b) => b.top < s.top - EPS && b.bottom > bottom + EPS))) n += Math.floor(gap / bl + EPS);
      if (s.bottom > bottom) ({ bottom, box } = s);
    }
  }
  return n;
}

/** Each floating object's box height at a width, and its `Float` for `choose` given where its anchor fell. */
function floatMaker(env: Env, columns: Col[], ids: readonly string[]) {
  const { v, sceneY } = env;
  const heights = new Map<string, number>();
  const heightAt = (o: ObjectElement, width: number): number => {
    const key = `${o.id}|${width}`;
    // On a grid line, as every box is, so a caption snaps as it will where it is set; off the grid's
    // edges, so the outdent there does not count (a box on an edge keeps this height, see fillColumns).
    if (!heights.has(key)) heights.set(key, placeObject(env, o, { x: columns[0]!.x + 1, y: env.origin ?? sceneY, width }, null, null, true).box.height);
    return heights.get(key)!;
  };
  const floatOf = (id: string, a: { screen: number; column: number }): Float => {
    const o = v.objects[id]!;
    const p = o.placement as AnchoredPlacement;
    const kind = o.kind === "pullquote" ? "quote" : o.kind === "sidebar" ? "box" : "picture";
    const w = columns[0]!.width;
    const ratio = "media" in o ? o.media.ratio.w / o.media.ratio.h : w / Math.max(1, heightAt(o, w));
    const sizes: Float["sizes"] =
      p.size !== "auto" ? [p.size]
      : kind !== "picture" ? ["column", "small"]
      : ratio >= 1.2 ? ["wide", "column"]
      : ratio < 0.9 ? ["column", "small"]
      : ["column", "wide"];
    return {
      id, order: ids.indexOf(id), sizes, place: p.place, kind, anchorScreen: a.screen, anchorColumn: a.column,
      heightAt: (width) => heightAt(o, width),
      crops: "media" in o && o.media.fit === "cover" && o.media.shape.kind === "rect",
    };
  };
  return { heightAt, floatOf };
}

/**
 * Picture composition, 2026-10-17 (spec §09.7 rule 15,
 * Floating), for a frame set in screen pages. A floating object is anchored, has a
 * `place` other than `here` and no `cols=`; every other object keeps today's placement.
 *
 * Screen by screen: a text-only trial (every floating object stepped over) gives the blocks on the
 * screen, and a second, one full band on, the next screen's. Competing are the objects left over from
 * the screen before and those anchored in either range, at most three in story order; the rest wait.
 * `choose` (compose.ts) tries their combinations, each set as the band with the boxes in place. When
 * none keeps the hard rules, or an object has no spot on the screen at all, it falls back to today's
 * placement: at its anchor, or, left over, at the top of the band.
 */
function composer(
  env: Env,
  frameId: string,
  story: Story,
  start: Resume,
  columns: Col[],
  run: (limit: number, at: number, from: Resume, earlier: readonly Exclusion[], deferred: readonly string[]) => Columns,
  ends: (band: Columns) => number[],
  lone: (band: Columns) => boolean,
  textAfter: (from: Resume) => boolean,
  /** The frame's wrapping objects (a scene's cut-out): no box goes over them. */
  exclusions: readonly Exclusion[],
): Composer | undefined {
  const { v, grid, viewport, sceneY } = env;
  /** The frame's floating objects in story order: from its first block to a frame break. */
  const ids = floatingIn(env, story, start);
  if (ids.length === 0) return undefined;
  const block = (id: string): number => (v.objects[id]!.placement as AnchoredPlacement).block;
  /** Text resuming at `c` has set everything before an object's anchor: only objects lie between. */
  const beyond = (c: Resume, id: string): boolean => story.blocks.slice(c.block, block(id)).every((b) => b.kind === "object");
  const pending = new Set(ids);
  const set = new Set<string>();
  /**
   * Where a trial met an object's anchor: its screen and column. Until the text set passes the anchor,
   * each screen's trials say it again; once it has, it stays.
   */
  const anchors = new Map<string, { screen: number; column: number }>();
  const band = viewport.height - 2 * grid.marginY;
  let previous: string | null = null;
  /** The visor: an object's window, the anchor's screen and one either side, 1-based across the document. */
  const window = (id: string): Record<string, number> => {
    const a = anchors.get(id)?.screen;
    const doc = (p: number): number => Math.floor((sceneY + p * viewport.height + EPS) / viewport.height) + 1;
    return a === undefined ? {} : { windowFrom: doc(Math.max(0, a - 1)), windowTo: doc(a + 1) };
  };

  const { heightAt, floatOf: floatAt } = floatMaker(env, columns, ids);
  const floatOf = (id: string): Float => floatAt(id, anchors.get(id)!);
  /** Every floating object not fallen back is stepped over; those in `combo` are set at their boxes. */
  const floatedFor = (combo: Candidate[]): Map<string, Floated | null> => {
    const m = new Map<string, Floated | null>([...pending, ...set].map((id) => [id, null]));
    for (const c of combo) if ("box" in c) m.set(c.id, { box: c.box, fixed: Math.abs(c.box.height - heightAt(v.objects[c.id]!, c.box.width)) > EPS });
    return m;
  };
  /** Records where a trial on screen `screen` met the anchors it passed. */
  const meet = (t: Columns, screen: number): void => {
    const lines = t.placed.lines.filter((l) => l.frame === frameId);
    for (const id of pending) {
      const at = block(id);
      if (anchors.has(id) || !beyond(t.cursor, id)) continue;
      const near = lines.filter((l) => l.block < at).at(-1) ?? lines.find((l) => l.block > at);
      anchors.set(id, { screen, column: near?.column ?? 0 });
    }
  };
  const { overflow, summarise } = trials(env, frameId, columns, ends);

  return {
    left: () => pending.size > 0,
    release: (id) => (set.delete(id), pending.add(id)),
    screen(page, at, limit, from, earlier, waiting, hanging) {
      env.floated = floatedFor([]);
      if (pending.size === 0) return { extra: [], cut: 0 };
      const passed = (id: string): boolean => beyond(from, id);
      for (const id of pending) if (!passed(id)) anchors.delete(id);
      const t = run(limit, at, from, earlier, waiting);
      meet(t, page);
      /**
       * One full band of text on the next screen from `c`, every floating object stepped over except
       * `inline`, which take today's placement there (as they would if that screen fell back), with
       * `deferred` opening it.
       */
      const reached = new Map<string, Columns>();
      const ahead = (c: Resume, inline: readonly string[] = [], deferred: readonly string[] = []): Columns => {
        const key = `${c.block}:${c.piece}:${c.offset}:${inline.join(",")}:${deferred.join(",")}`;
        if (!reached.has(key)) {
          const [origin, floated] = [env.origin, env.floated];
          const m = floatedFor([]);
          for (const id of inline) m.delete(id);
          (env.origin = pageOrigin(env, page + 1)), (env.floated = m);
          reached.set(key, run(band, sceneY + (page + 1) * viewport.height + grid.marginY, c, [], deferred));
          (env.origin = origin), (env.floated = floated);
        }
        return reached.get(key)!;
      };
      if (t.stop === "full" && [...pending].some((id) => !anchors.has(id))) meet(ahead(t.cursor), page + 1);
      /** Fallen back to today's rule: one whose anchor the text has passed opens this band; any other meets its anchor. */
      const extra: string[] = [];
      /** Fallen back with its anchor's text already set: it is set on this screen, never sent on. */
      const due: string[] = [];
      const fall = (id: string, why: PictureReason): void => {
        env.picks?.set(id, { reason: why, numbers: window(id) });
        pending.delete(id);
        if (passed(id)) due.push(id);
        if (from.block > block(id)) extra.push(id);
      };
      // Past its window already (one that waited behind three others): today's placement.
      for (const id of [...pending]) if (passed(id) && (anchors.get(id)?.screen ?? page) < page - 1) fall(id, "fallback-budget");
      const g: ScreenGeometry = { index: page, top: at, foot: at + limit, band, columns, baseline: grid.baseline, origin: env.origin ?? sceneY };
      // Objects set before their text owe this screen their anchors: a setting that pushes one on is
      // refused, so none lands two screens from its picture.
      const owed = [...set].filter((id) => !passed(id) && beyond(t.cursor, id));
      const over = overflow(t, at + limit);
      const floats: Float[] = [];
      // From the next screen only those anchored early on it, in its first column: the rest of its
      // text can still move on a screen when pictures take room.
      const near = (id: string): boolean => anchors.has(id) && (anchors.get(id)!.screen <= page || anchors.get(id)!.column === 0);
      const competing = [...pending].filter(near).slice(0, 3);
      // A leftover at the end of its window that is not among them falls back now, on this screen.
      for (const id of [...pending]) if (passed(id) && !competing.includes(id) && (anchors.get(id)?.screen ?? page) <= page - 1) fall(id, "fallback-budget");
      for (const id of competing) {
        const f = floatOf(id);
        if (candidates(f, v.spots, g).some((c) => "box" in c)) floats.push(f);
        else if (f.anchorScreen <= page) fall(id, "fallback-no-spot");
      }
      /** Trial layouts left on this screen: every search and fallback below shares the one budget. */
      let left = env.budget;
      /** Each combination as it was set: rule 3's cut and the boxes raised with the band's foot. */
      const setAs = new Map<string, { cut: number; combo: Candidate[] }>();
      const keyOf = (combo: Candidate[]): string => combo.map((c) => ("box" in c ? `${c.id}@${c.box.x},${c.box.y},${c.box.width}` : `${c.id}:wait`)).join("|");
      /**
       * Rule 3's cut for a setting whose text ends here with boxes set (see `tryLayout`): of those that
       * let text go on and keep the hard rules, the one whose columns end closest to level (ties to
       * the smaller cut; the first level one ends the search); else the first that lets text go on.
       * Limit: up to six lines, as the levelling search in `bands` (2026-10-17: a trial is at most
       * seven layouts; the budget counts combinations). `runs` counts the cut layouts set.
       */
      const cutFor = (combo: Candidate[], trial: Columns): { k: number; t: Columns; as: Candidate[]; runs: number } | null => {
        if (!lone(trial) || !combo.some((c) => "box" in c)) return null;
        let runs = 0;
        const ok = (s: TrialSummary): boolean => s.allSet && !s.overlaps && !s.stubs && !s.alone;
        const spread = (s: TrialSummary): number => Math.max(...s.feet) - Math.min(...s.feet);
        type Cut = { k: number; t: Columns; as: Candidate[]; spread: number };
        let first: Cut | null = null;
        let going = null as Cut | null;
        for (let k = grid.baseline; k <= 6 * grid.baseline + EPS && k < limit / 2; k += grid.baseline) {
          const gk = { ...g, foot: g.foot - k };
          const raised: Candidate[] = [];
          for (const c of combo) {
            const d = "box" in c && c.spot.place === "bottom" ? candidates(floatOf(c.id), v.spots, gk).find((d) => "box" in d && d.spot === c.spot && d.first === c.first && d.span === c.span) : c;
            if (d) raised.push(d);
          }
          // A box that no longer fits at its spot: a shorter band cannot hold it either.
          if (raised.length < combo.length) break;
          env.floated = floatedFor(raised);
          const t = run(limit - k, at, from, earlier, [...waiting, ...extra]);
          runs++;
          const s = summarise(t, raised, gk, from, over, [...exclusions, ...earlier, ...hanging]);
          if (textAfter(t.cursor)) {
            if (ok(s) && (!going || spread(s) < going.spread - EPS)) going = { k, t, as: raised, spread: spread(s) };
            first ??= { k, t, as: raised, spread: spread(s) };
            if (going && going.spread <= EPS) break;
          }
        }
        const cut = going ?? first;
        if (cut) return { k: cut.k, t: cut.t, as: cut.as, runs };
        return runs ? { k: 0, t: trial, as: combo, runs } : null;
      };
      /**
       * Each combination's trial on this screen, by `keyOf`: the first search, the retries with fewer
       * competitors and the all-wait trial share it. `rescore` is the balanced count of empty room,
       * done only when the trial can still win (`full` keeps it once done).
       */
      const trialsDone = new Map<string, { pre: TrialSummary; rescore: (() => TrialSummary) | null; full: TrialSummary | null }>();
      const tryLayout = (combo: Candidate[], lost: (t: TrialSummary | null) => boolean = () => false): TrialSummary => {
        // A repeated or skipped combination still counts against the budget, so the search is the same.
        left--;
        if (lost(null)) return UNTRIED;
        const key = keyOf(combo);
        const e = trialsDone.get(key) ?? setTrial(combo, key);
        if (!e.rescore || e.full) return e.full ?? e.pre;
        if (lost(e.pre)) return e.pre;
        return (e.full = e.rescore());
      };
      const setTrial = (combo: Candidate[], key: string) => {
        env.floated = floatedFor(combo);
        let trial = run(limit, at, from, earlier, [...waiting, ...extra]);
        // Rule 3 as `bands` applies it (2026-10-17): text that ends here with objects still waiting
        // is set shorter, a line at a time, until some goes on. Each box at the foot is set again at
        // its spot against the shorter band (on the grid, cropped to it, never above the band's top),
        // so the setting scored is the one the page gets (see `cutFor`); one whose text never goes on
        // is refused below.
        const found = cutFor(combo, trial);
        env.onCut?.(page, 1 + (found?.runs ?? 0));
        const shortAt = found && found.k > 0 ? found : null;
        if (!shortAt) env.floated = floatedFor(combo);
        else (trial = shortAt.t), (env.floated = floatedFor(shortAt.as));
        const cut = shortAt?.k ?? 0;
        const as = shortAt?.as ?? combo;
        setAs.set(key, { cut, combo: as });
        const sum = summarise(trial, as, cut ? { ...g, foot: g.foot - cut } : g, from, over, [...exclusions, ...earlier, ...hanging]);
        // A box set before its text: the text must still reach its anchor on the next screen, even
        // with the objects still to place set there by today's rule.
        const early = combo.filter((c) => "box" in c && !beyond(trial.cursor, c.id));
        const rest = [...pending].filter((id) => !combo.some((c) => c.id === id && "box" in c));
        const reach = early.length && trial.stop === "full" ? ahead(trial.cursor, rest, trial.deferred).cursor : null;
        // Objects fallen back at the end of their window are set on this screen, not sent on.
        // Still alone after it: no cut lets the text go on, and the boxes would stand beside ragged
        // columns, neither full nor balanced. Refused, so a setting that lets it go on wins.
        const stuck = lone(trial) && combo.some((c) => "box" in c);
        // Objects waiting from the screen before whose window ends here are set here too, not sent on
        // by boxes that take their room (2026-10-17: three pictures two screens past their anchors).
        const ending = waiting.filter((id) => (anchors.get(id)?.screen ?? page) <= page - 1);
        const kept = !stuck && owed.every((id) => beyond(trial.cursor, id)) && early.every((c) => !reach || beyond(reach, c.id)) && ![...due, ...ending].some((id) => trial.deferred.includes(id));
        const pre = kept ? sum : { ...sum, allSet: false };
        // The text ends here: `bands` balances the page (rule 11's last band), so its empty room is
        // counted on the balanced setting, where a box at the foot can stand below shorter columns
        // (2026-10-20).
        const rescore =
          trial.stop === "full"
            ? null
            : (): TrialSummary => {
                env.floated = floatedFor(as);
                const even = balance(env, (l) => run(Math.min(l, limit), at, from, earlier, [...waiting, ...extra]));
                return { ...pre, gaps: holes(even, even.placed.lines.filter((l) => l.frame === frameId), even.placed.objects.filter((o) => v.objects[o.name]?.placement.mode !== "contained"), grid.baseline) };
              };
        const e = { pre, rescore, full: null };
        trialsDone.set(key, e);
        return e;
      };
      /** The visor: a search ran out of trials, so a fallback below is the budget's. */
      let spent = false;
      const search = (fs: Float[], tl: typeof tryLayout, budget: number) => {
        const before = left;
        const r = choose(fs, v.spots, g, tl, previous, budget);
        if (before - left >= budget) spent = true;
        return r;
      };
      // The first search keeps back one trial for each fallback below.
      let best = floats.length ? search(floats, tryLayout, Math.max(0, left - floats.length)) : null;
      // When the budget runs out, the later objects wait for the next screen, inside their window, and
      // the earlier ones are chosen again; at last all wait. Setting them here by rule 6 instead can
      // push the screen's last lines, and the anchors of pictures set before them, a screen further.
      for (let k = floats.length - 1; !best && k >= 1 && left > k && floats.slice(k).every((f) => f.anchorScreen >= page); k--) {
        const rest: Candidate[] = floats.slice(k).map((f) => ({ id: f.id, wait: true }));
        const r = search(floats.slice(0, k), (c, lost) => tryLayout([...c, ...rest], lost), left - k);
        if (r) best = { ...r, combo: [...r.combo, ...rest], ranked: r.ranked.map((x) => ({ combo: [...x.combo, ...rest], cost: x.cost })) };
      }
      const waits: Candidate[] = floats.map((f) => ({ id: f.id, wait: true }));
      if (!best && left > 0 && floats.length && floats.every((f) => f.anchorScreen >= page) && hardOk(waits, floats, g, tryLayout(waits, (t) => t !== null))) best = { combo: waits, cost: 0, parts: { distance: 0, order: 0, gaps: 0, crowd: 0, balance: 0, rhythm: 0 }, ranked: [] };
      if (floats.length) env.onCompose?.(page, env.budget - left);
      if (!best) for (const f of floats) if (f.anchorScreen <= page) fall(f.id, spent || left <= 0 ? "fallback-budget" : "fallback-no-spot");
      if (best && env.picks) pickChosen(env, best, (id) => ((anchors.get(id)?.screen ?? page) < page ? "waited" : "chosen"), window, (c) => distance(c, floats.find((f) => f.id === c.id)!, g));
      const chosen = best ? setAs.get(keyOf(best.combo)) : undefined;
      const combo = chosen?.combo ?? best?.combo ?? [];
      for (const c of combo) if ("box" in c) (pending.delete(c.id), set.add(c.id));
      env.floated = floatedFor(combo);
      // An empty arrangement earns no rhythm penalty on the next screen.
      previous = signature(combo) || null;
      return { extra, cut: chosen?.cut ?? 0 };
    },
  };
}

/**
 * 2026-10-17: where a page scene's baseline grid counts from on screen `p`. It counts up from the
 * screen's bottom line (the screen's foot less margin-y), so a full column's last line of body text
 * ends exactly on it, at the same place on every page and every screen; what a screen holds beyond
 * whole lines (a screen is rarely a whole number of them) goes to the top margin instead.
 */
function pageOrigin(env: Env, p: number): number {
  const { grid, viewport, sceneY, v } = env;
  const body = v.styles["body"];
  const ctx: EvalContext = { viewport, grid, pctOf: 0 };
  const lead = body ? px(body.leading, ctx) : grid.baseline;
  let drop = lead;
  if (body) {
    const font = engineFont(body, ctx);
    const m = env.cache.get([{ text: "x", font }], font);
    // From a line's top to its baseline, as fillColumn sets body text.
    drop = (lead - (m.ascent + m.descent)) / 2 + m.ascent;
  }
  const top = sceneY + p * viewport.height;
  const lastBaseline = top + viewport.height - grid.marginY - lead + drop;
  return lastBaseline - Math.floor((lastBaseline - top) / grid.baseline) * grid.baseline;
}

const sameResume = (a: Resume, b: Resume): boolean =>
  a.block === b.block && a.piece === b.piece && a.offset === b.offset && a.at.item === b.at.item && a.at.seg === b.at.seg && a.at.grapheme === b.at.grapheme;

/** §09.2 valign: content that fits a definite height moves down, by whole baseline steps so snapped lines stay on the grid. */
function valign(env: Env, frame: Frame, result: Columns, top: number, height: number): void {
  if (frame.valign === "top") return;
  const room = height - (Math.max(...result.bottoms) - top);
  if (room <= EPS) return;
  const bl = env.grid.baseline;
  const shift = Math.floor((frame.valign === "center" ? room / 2 : room) / bl) * bl;
  for (const l of result.placed.lines) (l.y += shift), (l.baseline += shift);
  for (const c of result.placed.caps) (c.y += shift), (c.baseline += shift);
  for (const r of result.placed.rules) r.y += shift;
  for (const o of result.placed.objects) o.box.y += shift;
  result.bottoms = result.bottoms.map((b) => b + shift);
}

// ---------------------------------------------------------------------------
// Columns and blocks (§09.6)
// ---------------------------------------------------------------------------

type Stop = "full" | "frame" | "end";
/** `collides`: after pin and reflow, a `cols=` object still cuts into lines of the frame (one it did not pin). */
/** `carried`: exclusions of the objects this fill placed (pinned ones included), which reach past it into later bands. */
type Columns = {
  placed: Placed;
  cursor: Resume;
  stop: Stop;
  tops: number[];
  bottoms: number[];
  collides?: boolean;
  carried: Exclusion[];
  /** Objects still waiting for a column when this fill ended (§11.3); the next band takes them. */
  deferred: string[];
  /** The visor (2026-10-21): why each column set ended, by column; `moved`: lines orphans or widows sent on; `object`: the picture that ends it (rule 13). */
  why: { code: ColumnEndReason; frame: string; x: number; width: number; moved?: number; object?: string }[];
  /** Set by `balance` when the whole-block search chose a height: that height, in px. */
  balanced?: number;
};
/** Anchored objects deferred to the next column (§11.3), and whether a later column or band exists to take one. */
/**
 * Objects waiting for a column; `allowed`: a later column or band can take one; `last`: this is the
 * fill's last column; `banded`: the frame fills column bands, where the design 2026-09-29 rules apply.
 */
/** `hoisted`: objects already set at this column's top ahead of their anchors, which the text then passes by. */
/** `tail`: where the text ends, objects still waiting are set after it in this column if they fit. */
/** `moved`: objects held over to the next band (they open it), met here as their anchors pass; `held` collects them. */
/** `span`: the whole fill, first column to last, whose middle a `side=center` object sits on (2026-10-09). */
/** `floated`: objects picture composition sets (2026-10-17); the text steps over their anchors, as over `hoisted`. */
type Defer = { list: string[]; allowed: boolean; last: boolean; banded: boolean; span?: Col; hoisted?: ReadonlySet<string>; turn?: boolean; tail?: boolean; moved?: ReadonlySet<string>; held?: string[]; floated?: ReadonlyMap<string, Floated | null> };
type Col = { x: number; width: number };

/** A `side=center` object in a fill of more than one column: it sits across the middle gutter. */
function gutterCentred(o: ObjectElement, col: Col, defer: Defer): boolean {
  const h = o.placement.mode === "anchored" ? o.placement.horizontal : null;
  return h?.mode === "side" && h.side === "center" && defer.span !== undefined && defer.span.width > col.width + EPS;
}

/** A box `width` wide centred on `on`. */
const centredOn = (on: Col, width: number): Col => ({ x: on.x + (on.width - width) / 2, width });

/** Objects pinned for the second pass of §11.3, with the exclusions they make at their pinned y. */
type Pins = ReadonlyMap<string, { y: number; exclusions: Exclusion[] }>;

/** The `cols=` objects of a first pass whose exclusions cut into lines of this frame, at the y their anchors gave them. */
function pinsFor(env: Env, frame: Frame, first: Columns): Pins {
  const pins = new Map<string, { y: number; exclusions: Exclusion[] }>();
  const lines = first.placed.lines.filter((l) => l.frame === frame.id);
  for (const p of first.placed.objects) {
    const o = env.v.objects[p.name];
    if (p.anchoredAt === null || o?.placement.mode !== "anchored" || o.placement.horizontal.mode !== "cols") continue;
    const h = o.placement.horizontal;
    const ctx: EvalContext = { viewport: env.viewport, grid: env.grid, pctOf: env.viewport.width };
    const onGrid = capWidth(o, span(env.grid, h.cols.from, h.cols.to), ctx);
    const fixed = o.placement.height === "auto" ? null : px(o.placement.height, { ...ctx, pctOf: onGrid.width });
    const { exclusions } = placeObject(env, o, { x: onGrid.x, y: p.anchoredAt, width: onGrid.width }, fixed, p.anchoredAt);
    const hits = lines.some((l) =>
      exclusions.some((e) => {
        const ext = bandExtent(e, l.y, l.y + l.height);
        return ext !== null && ext[0] < l.x + l.width - EPS && ext[1] > l.x + EPS;
      }),
    );
    if (hits) pins.set(o.id, { y: p.anchoredAt, exclusions });
  }
  return pins;
}

/** Fills a frame's internal columns left to right (§09.3), each with the same height limit. */
function fillColumns(
  env: Env,
  frame: Frame,
  story: Story,
  columns: Col[],
  measure: number,
  top: number,
  limit: number,
  start: Resume,
  exclusions: readonly Exclusion[],
  lastInThread: boolean,
  pins: Pins,
  /** The frame is banded (§09.7): an object waiting at the end of the last column moves on to the next band. */
  banded = false,
  /** Objects deferred from the previous band, which open this one. */
  deferred: readonly string[] = [],
  /** The column after which the page turns, when its text ends before the last column (rule 9). */
  turn = columns.length - 1,
  /** Objects held over to the next band (run, 2026-10-07). */
  moved: ReadonlySet<string> = new Set(),
): Columns {
  const placed = empty();
  const span = { x: columns[0]!.x, width: columns.at(-1)!.x + columns.at(-1)!.width - columns[0]!.x };
  const defer: Defer = { list: [...deferred], allowed: false, last: false, banded, span, moved, held: [], floated: env.floated };
  const tops: number[] = [];
  const bottoms: number[] = [];
  const why: Columns["why"] = [];
  let cursor = start;
  let stop: Stop = "end";
  /** Exclusions of objects placed in earlier columns: a `cols=` object can reach into later ones. */
  const carry: Exclusion[] = [];
  // Picture composition (2026-10-17): the objects this screen sets at their boxes, before any text.
  // The text keeps their standoff above and below and never runs beside them in a column they span;
  // an object with a screen of its own (`place=screen`) leaves the screen no text at all.
  const boxed: Exclusion[] = [];
  for (const [id, f] of env.floated ?? []) {
    if (!f) continue;
    const o = env.v.objects[id]!;
    let r = placeObject(env, o, f.box, f.fixed ? f.box.height : null, null, true);
    // On the grid's outer edge a box reaches into the margin (outdent), wider and so taller than it was
    // scored: it keeps its scored height, which is within 85% of the band, cropped to it (with what
    // rule 12 gives it).
    const scored = f.box.height + (f.fixed ? 0 : (env.grow?.get(id) ?? 0));
    if (r.box.height > scored + EPS) r = placeObject(env, o, f.box, scored, null, true);
    const off = o.wrap.mode === "none" ? 0 : px(o.wrap.offset, { viewport: env.viewport, grid: env.grid, pctOf: r.box.width });
    const whole = o.placement.mode === "anchored" && o.placement.place === "screen";
    // The standoff above stays inside the band: above it is another frame's text, or the screen before.
    const above = Math.max(top, r.box.y - off);
    const box = whole ? { x: span.x, y: top, width: span.width, height: limit } : { ...r.box, y: above, height: r.box.y + r.box.height + off - above };
    const cut: Exclusion = { id, box, shape: { kind: "rect" }, offset: 0, side: "both", jump: false };
    r.placed.objects[0]!.exclusion = cut;
    append(placed, r.placed);
    boxed.push(cut);
  }
  for (let c = 0; c < columns.length; c++) {
    const nowhere = lastInThread ? { frame: true, column: c === columns.length - 1 } : undefined;
    defer.allowed = c < columns.length - 1 || banded;
    defer.last = c === columns.length - 1;
    defer.turn = c === turn;
    defer.banded = banded;
    const waited = [...defer.list];
    const carried = carry.length;
    const inherited = [...exclusions, ...boxed, ...carry];
    let r = fillColumn(env, frame.id, story, columns[c]!, c, measure, top, top + limit, cursor, inherited, nowhere, pins, carry, defer);
    // Rule 3 at the text's end (2026-09-30): an object anchored part-way down a band's last column
    // would wait for the next band and have a page to itself. When the text ends in that column, the
    // column is set again with the object at its top instead, if the rest of the text still fits below.
    const late = defer.list.filter((id) => !waited.includes(id));
    if (banded && c === columns.length - 1 && r.stop === "end" && late.length > 0) {
      const own = carry.splice(carried); // the first try's exclusions, set aside
      const trial: Defer = { ...defer, list: [...waited, ...late], hoisted: new Set(late) };
      const t = fillColumn(env, frame.id, story, columns[c]!, c, measure, top, top + limit, cursor, inherited, nowhere, pins, carry, trial);
      if (t.stop === "end" && trial.list.length === 0) (r = t), (defer.list = []);
      else carry.splice(carried, carry.length - carried, ...own);
    }
    // Failing that, it is set after the text in this column, where there is room below it.
    if (banded && c === columns.length - 1 && r.stop === "end" && defer.list.length > 0) {
      const own = carry.splice(carried);
      const trial: Defer = { ...defer, list: [...waited], tail: true };
      const t = fillColumn(env, frame.id, story, columns[c]!, c, measure, top, top + limit, cursor, inherited, nowhere, pins, carry, trial);
      if (t.stop === "end" && trial.list.length < defer.list.length) (r = t), (defer.list = trial.list);
      else carry.splice(carried, carry.length - carried, ...own);
    }
    // The story ended exactly at the last column's foot: this one sets nothing and is no column at
    // all, so it reports no bottom (an empty bottom would make balancing think the columns uneven).
    if (c > 0 && r.stop === "end" && r.placed.lines.length === 0 && r.placed.objects.length === 0 && defer.list.length === 0) {
      // The visor: so the text ended in the column before.
      why[why.length - 1] = { code: r.why, frame: frame.id, x: why.at(-1)!.x, width: why.at(-1)!.width };
      cursor = r.cursor;
      stop = "end";
      break;
    }
    append(placed, r.placed);
    tops.push(top);
    bottoms.push(r.bottom);
    why.push({ code: r.why, frame: frame.id, x: columns[c]!.x, width: columns[c]!.width, ...(r.moved === undefined ? {} : { moved: r.moved }), ...(r.object === undefined ? {} : { object: r.object }) });
    cursor = r.cursor;
    // The story ended with objects still waiting: the next column (or, after the last, the next band) takes them.
    if (r.stop === "end" && defer.list.length > 0) {
      stop = "full";
      continue;
    }
    if (r.stop === "frame" || r.stop === "end") {
      stop = r.stop;
      break;
    }
    // A full column, or a column break: the next column takes over. After the last, the frame is full.
    stop = "full";
  }
  // Rule 9 when the page turns early: a later column holds only a picture, so the page turns after
  // the last column with text. Its last line is set again, as a last column's is.
  if (banded && stop === "full" && turn === columns.length - 1) {
    const text = placed.lines.filter((l) => l.frame === frame.id);
    const at = Math.max(-1, ...text.map((l) => l.column));
    if (at >= 0 && at < columns.length - 1 && text.filter((l) => l.column === at).at(-1)?.text.endsWith(SHY_CHAR))
      return fillColumns(env, frame, story, columns, measure, top, limit, start, exclusions, lastInThread, pins, banded, deferred, at, moved);
  }
  return { placed, cursor, stop, tops, bottoms, carried: [...carry, ...[...pins.values()].flatMap((p) => p.exclusions)], deferred: [...defer.list, ...new Set(defer.held)], why };
}

/**
 * §09.6 step 2-4: the free slots of one line band. The column interval minus
 * every exclusion that intersects the band (expanded by its offset); slots
 * narrower than `minSlot` dropped, but the widest kept if none is wide enough
 * (step 3, W042); then `wrap-side` picks which slots take text. A `jump`
 * exclusion leaves the band empty.
 */
function slotsFor(col: Col, exclusions: readonly Exclusion[], top: number, bottom: number, minSlot: number, strict = false, dropped?: Col[]): Col[] {
  let free: { lo: number; hi: number }[] = [{ lo: col.x, hi: col.x + col.width }];
  let side: Exclusion["side"] = "both";
  for (const e of exclusions) {
    // An object whose box spans the whole column leaves it only slivers beside its outline, on
    // either side by turns: the column's text goes above and below its box instead, transparent
    // corners included. `wrap-side=both` asks for both sides, and keeps them.
    const spans = e.box.x <= col.x + EPS && e.box.x + e.box.width >= col.x + col.width - EPS;
    if (e.side !== "both" && spans && e.box.y < bottom && e.box.y + e.box.height > top) return [];
    const ext = bandExtent(e, top, bottom);
    if (!ext) continue;
    const [lo, hi] = ext;
    if (hi <= col.x || lo >= col.x + col.width) continue;
    if (e.jump) return [];
    side = e.side;
    free = free.flatMap((f) => [
      ...(lo > f.lo ? [{ lo: f.lo, hi: Math.min(lo, f.hi) }] : []),
      ...(hi < f.hi ? [{ lo: Math.max(hi, f.lo), hi: f.hi }] : []),
    ]);
    // Which side of this object text may occupy (§12.1).
    if (e.side === "left") free = free.filter((f) => f.hi <= lo + EPS);
    else if (e.side === "right") free = free.filter((f) => f.lo >= hi - EPS);
  }
  free = free.filter((f) => f.hi - f.lo > EPS);
  const wide = free.filter((f) => f.hi - f.lo >= minSlot);
  const widest = [...free].sort((a, b) => b.hi - b.lo - (a.hi - a.lo))[0];
  // `strict` (banded frames, rule 4): never a gap under minSlot, not even the widest.
  const usable = wide.length > 0 || strict ? wide : widest ? [widest] : [];
  // The visor: the strips under minSlot that stay empty.
  if (dropped) for (const f of free) if (!usable.includes(f) && f.hi - f.lo < minSlot) dropped.push({ x: f.lo, width: f.hi - f.lo });
  const chosen = side === "largest" ? usable.sort((a, b) => b.hi - b.lo - (a.hi - a.lo)).slice(0, 1) : usable;
  return chosen.sort((a, b) => a.lo - b.lo).map((f) => ({ x: f.lo, width: f.hi - f.lo }));
}

/**
 * How many lines are left of a paragraph from `at`, up to `cap`, at one width.
 * Limit: the next column's exclusions are unknown here, so this counts at the full column width.
 */
function linesLeft(next: NextLine, pieces: Prepared[], at: TextCursor, width: number, cap: number): number {
  let n = 0;
  let cursor = at;
  for (let p = 0; p < pieces.length && n < cap; p++, cursor = CURSOR_START)
    for (let line = next(pieces[p]!, cursor, width); line && n < cap; line = next(pieces[p]!, line.end, width)) n++;
  return n;
}

type NextLine = (p: Prepared, from: TextCursor, width: number) => LineBox | null;
type Plan = { cost: number; line: LineBox | null };
/** Composer plans per prepared paragraph, kept while the paragraph is: the levelling search's trials reuse them. */
const PLANS = new WeakMap<Prepared, Map<string, Plan>>();
/**
 * §07.6 `justify`: how much to add to each space so the line fills its slot. The slack is what
 * layout measured the line without; `white-space: pre` stops the browser justifying on its own, so
 * the renderer does the arithmetic itself (and the visor reads it, 2026-10-21). Zero when there is no slack or nowhere to put it (a
 * single long word, or a line already at its slot's width). Given the text's `size`, a line that
 * would open its spaces by more than half an em is set flush left instead (2026-09-30: a sliver
 * beside a picture, two words to a line, justified into rivers). A line a little longer than its
 * slot (the paragraph composer's, §07.6 composer=paragraph) closes its spaces instead, by up to a
 * twentieth of an em each (about a fifth of a space); a line longer than that is left alone.
 */
export function justifySpacing(l: { text: string; width: number; measured: number }, size = Number.POSITIVE_INFINITY): number {
  const spaces = (l.text.trimEnd().match(/ /g) ?? []).length;
  const slack = l.width - l.measured;
  const each = spaces > 0 ? slack / spaces : 0;
  if (each < 0) return -each <= SHRINK * size + 0.01 ? each : 0;
  return each > size / 2 ? 0 : each;
}

/** The most a justified line's spaces close, in em: a fifth of Georgia's space (0.24em). The composer uses the same. */
export const SHRINK = 0.05;
const sameCursor = (a: TextCursor, b: TextCursor): boolean => a.item === b.item && a.seg === b.seg && a.grapheme === b.grapheme;

/**
 * §07.6 composer=paragraph: a line's break is chosen for the whole paragraph. The candidates are the
 * line that fills `width` and up to three that break earlier; each is scored with the best score for
 * the rest of the paragraph at the column's full width (`rest`), and the cheapest wins. A line costs
 * more the further justification has to open its spaces (cubed, towards half an em, where it is set
 * flush left instead) or, ragged, the shorter it falls; a hyphen costs, a second in a row more and a
 * third nearly forbids it; a last line of one word costs as much as a very loose line, and so does a
 * last line that finishes a hyphenated word.
 * Limit: lines only ever break earlier than the greedy fill (justification never squeezes), and a
 * line's width is assumed to be `rest` from the next line on; a narrower slot re-plans when it comes.
 */
function composeLine(engine: TextEngine, p: Prepared, at: TextCursor, width: number, rest: number, o: { justify: number; size: number; hyphens: number; first: boolean }): LineBox | null {
  let memo = PLANS.get(p);
  if (!memo) PLANS.set(p, (memo = new Map()));
  const plan = (at: TextCursor, width: number, hyphens: number, first: boolean): Plan => {
    const key = `${width}|${rest}|${o.justify}|${o.size}|${at.item}.${at.seg}.${at.grapheme}|${hyphens}|${first}`;
    const known = memo!.get(key);
    if (known) return known;
    const justify = width >= o.justify;
    const candidates: LineBox[] = [];
    for (let w = width; candidates.length < 4; ) {
      const line = engine.nextLine(p, at, w);
      if (!line || sameCursor(line.end, at) || candidates.some((c) => sameCursor(c.end, line.end))) break;
      if (candidates.length > 0 && line.width < width * 0.6) break;
      candidates.push(line);
      w = line.width - 0.5;
    }
    // Justified, a line may also take a little more than fits, its spaces closing up (SHRINK).
    const fill = candidates[0];
    if (justify && fill) {
      const spaces = (fill.text.trimEnd().match(/ /g) ?? []).length + 1;
      const more = engine.nextLine(p, at, width + spaces * SHRINK * o.size);
      if (more && !sameCursor(more.end, fill.end) && more.width > width) candidates.unshift(more);
    }
    // The greedy fill stands when every candidate is ruled out.
    let best: Plan = { cost: fill ? Number.POSITIVE_INFINITY : 0, line: fill ?? null };
    for (const line of candidates) {
      const hy = /-$/.test(line.text.trimEnd()) ? hyphens + 1 : 0;
      let cost: number;
      const slack = width - line.width;
      const spaces = (line.text.trimEnd().match(/ /g) ?? []).length;
      if (engine.nextLine(p, line.end, rest) === null) {
        // A last line is never justified, so it cannot close its spaces.
        if (slack < 0) continue;
        const runt = !first && line.text.trim().split(/\s+/).length === 1;
        cost = runt ? (hyphens > 0 ? 3e4 : 2e4) : 0;
      } else {
        if (slack < 0 && (spaces === 0 || -slack / spaces > SHRINK * o.size)) continue;
        // How far the spaces open (towards half an em) or close (towards SHRINK); ragged, how short the line falls.
        const r = !justify ? slack / (width / 4) : slack < 0 ? -slack / spaces / (SHRINK * o.size) : spaces > 0 ? slack / spaces / (o.size / 2) : slack > 1 ? 2 : 0;
        // Past half an em the line is set flush left: as bad as can be, and worse the looser.
        const badness = r > 1 ? 1e4 * r : 100 * r ** 3;
        cost = (10 + badness) ** 2 + (hy === 1 ? 2500 : hy === 2 ? 1e4 : hy > 2 ? 1e6 : 0) + plan(line.end, rest, hy, false).cost;
      }
      if (cost < best.cost) best = { cost, line };
    }
    memo!.set(key, best);
    return best;
  };
  return plan(at, width, o.hyphens, o.first).line;
}

/** Characters that hang outside the column under `hang` (§07.6): opening and closing quotation marks; with `punctuation`, also hyphens, full stops and commas. */
const HANG_OPEN = /^[“‘"'«„‚]/;
const HANG_CLOSE = { quotes: /[”’"'»]$/, punctuation: /[”’"'».,\-\u00ad\u2010]$/ } as const;

/**
 * §07.6 balance: the narrowest width, to a pixel, at which a paragraph takes no more lines than at
 * `width`. A paragraph of one line keeps `width`.
 * Limit: measured at the column's width, so lines beside a wrap balance to the column, not the slot.
 */
function balancedWidth(cache: PrepareCache, pieces: ReturnType<PrepareCache["get"]>[], width: number): number {
  // A width that splits a word (an engine breaking an overlong word between letters) or lets one
  // overflow is never a candidate: it takes no fewer lines, it only breaks the word (2026-10-07: a
  // phone headline set "The keeper / s' logbooks" once bind-short made "The keepers'" one unit).
  const count = (w: number): number => {
    let n = 0;
    for (const p of pieces)
      for (let line = cache.engine.nextLine(p, CURSOR_START, w); line && n <= 60; line = cache.engine.nextLine(p, line.end, w)) {
        if (line.width > w + 0.5 || (line.end.grapheme > 0 && !line.text.endsWith("-"))) return Number.POSITIVE_INFINITY;
        n++;
      }
    return n;
  };
  const n = count(width);
  // One line, or a word wider than the slot itself: nothing to balance.
  if (n < 2 || !Number.isFinite(n)) return width;
  let lo = width / 2;
  let hi = width;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    if (count(mid) <= n) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** A style at `k` times its size: how fitted text measures its runs. */
const scaled = (s: ResolvedStyle, k: number, ctx: EvalContext): ResolvedStyle => (k === 1 ? s : { ...s, size: { u: "px", n: px(s.size, ctx) * k } });

/** A fitted paragraph's leading: the style's, scaled with the size, in whole baseline steps if the style snaps. */
function fitLeading(style: ResolvedStyle, size: number, ctx: EvalContext, grid: GridGeometry): number {
  const leading = (px(style.leading, ctx) * size) / px(style.size, ctx);
  return style.snap === "baseline" ? Math.ceil(leading / grid.baseline - EPS) * grid.baseline : leading;
}

/**
 * Design §5 fit=width: the largest whole-pixel size, from the style's size to `fit.max` (three times
 * the size when unset), at which no line overflows `width` or splits a word and, with `fit.height`,
 * the paragraph is no taller. The style's own size when none qualifies. Soft hyphens are ignored.
 * Limit: fits the column width; a slot narrowed by an exclusion is not considered.
 */
function fitSize(env: Env, style: ResolvedStyle, pieces: Piece[], width: number, ctx: EvalContext): number {
  const min = px(style.size, ctx);
  const max = style.fit!.max ? px(style.fit!.max, ctx) : 3 * min;
  const cap = style.fit!.height ? px(style.fit!.height, { ...ctx, pctOf: env.viewport.height }) : Number.POSITIVE_INFINITY;
  const fits = (size: number): boolean => {
    const k = size / min;
    let lines = 0;
    for (const piece of pieces) {
      const runs = piece.map((r): EngineRun => ({ text: r.text.replace(SHY, ""), font: engineFont(scaled(env.v.styles[r.style]!, k, ctx), ctx) }));
      const prepared = env.cache.get(runs, engineFont(scaled(style, k, ctx), ctx));
      for (let line = env.cache.engine.nextLine(prepared, CURSOR_START, width); line; line = env.cache.engine.nextLine(prepared, line.end, width)) {
        if (line.width > width + EPS || line.end.grapheme !== 0) return false;
        lines++;
      }
    }
    return lines * fitLeading(style, size, ctx, env.grid) <= cap + EPS;
  };
  let best = min;
  for (let lo = Math.ceil(min), hi = Math.floor(max); lo <= hi; ) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) (best = mid), (lo = mid + 1);
    else hi = mid - 1;
  }
  return best;
}

function fillColumn(
  env: Env,
  frameId: string,
  story: Story,
  col: Col,
  column: number,
  measure: number,
  top: number,
  limitY: number,
  start: Resume,
  inherited: readonly Exclusion[],
  /** Breaks with nowhere to go: a frame break in the thread's last frame, a column break in its last column too. */
  nowhere: { frame: boolean; column: boolean } = { frame: false, column: false },
  pins: Pins = new Map(),
  carry: Exclusion[] = [],
  /** Objects waiting for a column (§11.3); `allowed`: a later column or band of this fill can take one. */
  defer: Defer = { list: [], allowed: false, last: false, banded: false },
): { placed: Placed; cursor: Resume; bottom: number; stop: Stop | "column"; why: ColumnEndReason; moved?: number; object?: string } {
  const { v, rd, grid, sceneY, cache } = env;
  const ctx: EvalContext = { viewport: env.viewport, grid, pctOf: col.width };
  // In a scene of screen pages, a frame not set in bands snaps to the grid of the screen each line is on.
  const pageGrid = new Map<number, number>();
  const originAt = (y: number): number => {
    if (env.origin !== undefined || !env.pageGrids) return env.origin ?? sceneY;
    const p = Math.max(0, Math.floor((y - sceneY + EPS) / env.viewport.height));
    if (!pageGrid.has(p)) pageGrid.set(p, pageOrigin(env, p));
    return pageGrid.get(p)!;
  };
  const snapUp = (y: number): number => {
    const origin = originAt(y);
    return origin + Math.ceil((y - origin - EPS) / grid.baseline) * grid.baseline;
  };
  const exclusions = [...inherited];
  const out = empty();
  if (env.explain) out.narrow = [];
  let cursor = start;
  let y = top;
  let atTop = true;
  /** Where the previous keep-with-next block started, so it can follow its successor to the next column. */
  let kept: { cursor: Resume; y: number; at: ReturnType<typeof mark> } | null = null;

  /**
   * Sets an anchored object at the current y (§11.3): its top on the baseline step where it occurs.
   * False when it does not fit in what is left of the column (nothing is placed); `force` sets it
   * anyway (a deferred object opening a column, or one left over at the story's end).
   */
  /** A band's full height, a screen less its margins; `short`: this band is less (the first, under a heading). */
  const fullBand = env.viewport.height - 2 * grid.marginY;
  const short = defer.banded && limitY - top < fullBand - EPS;
  const placeAnchored = (o: ObjectElement, force: boolean): boolean => {
    if (o.placement.mode !== "anchored") return true;
    const h = o.placement.horizontal;
    // §11.3 cols=: absolute columns of the scene's grid, whichever frame holds the anchor.
    // Lines set before the anchor are handled by pin and reflow (fillFrame).
    // side=center (2026-10-09): on the middle of the whole fill, across the gutter between its
    // columns, from its first column (which sets it before the columns beside it fill); anywhere
    // else, or in a fill of one column, on the middle of its own column.
    const across = gutterCentred(o, col, defer) && column === 0;
    const slot = h.mode === "cols" ? span(grid, h.cols.from, h.cols.to) : across ? centredOn(defer.span!, px((h as { width: Len }).width, ctx)) : null;
    // Design 2026-09-29 rule 5, banded frames: a cut-out is 150% of its column, reaching into the
    // column read next; in the last column it stays one column wide.
    const cutout = defer.banded && h.mode === "full" && "media" in o && o.media.shape.kind === "polygon";
    let given = slot ? slot.width : h.mode === "full" ? (cutout && !defer.last ? Math.round(col.width * 1.5) : col.width) : h.mode === "side" ? Math.min(col.width, px(h.width, ctx)) : col.width;
    // Rule 15 (2026-10-20): in a band, an object at its anchor's side leaves a strip a line of body
    // text fits in, or takes the column's width.
    if (defer.banded && !slot && h.mode === "side" && col.width - given - (o.wrap.mode === "none" ? 0 : px(o.wrap.offset, ctx)) < minStrip(env, ctx)) given = col.width;
    const at = slot ? slot.x : h.mode !== "side" || h.side === "left" ? col.x : col.x + (col.width - given) * (h.side === "right" ? 1 : 0.5);
    const capped = capWidth(o, { x: at, width: given }, ctx);
    const x = capped.x;
    let width = capped.width;
    // A pinned object keeps its first-pass y even if its anchor moved; its exclusions are already in force.
    const pin = pins.get(o.id);
    // §12.1: an object that follows text keeps its standoff from the line above too (2026-10-07: with
    // no space between paragraphs, a quote otherwise sat inside its own standoff).
    const above = !atTop && o.wrap.mode !== "none" ? px(o.wrap.offset, ctx) : 0;
    let objTop = pin?.y ?? (atTop ? y : snapUp(y + above));
    const fixed = o.placement.height === "auto" ? null : px(o.placement.height, ctx);
    let r = placeObject(env, o, { x, y: objTop, width }, fixed, objTop, defer.banded);
    // Rule 8 (2026-09-30: every picture in the flow, not only cut-outs; a `cols=` picture is the
    // author's to size): in a band, no picture is taller than 85% of a full band; a taller one
    // narrows, keeping its left edge. A few rounds, since its caption does not shrink with it.
    for (let k = 0; defer.banded && "media" in o && !slot && k < 8 && r.box.height > 0.85 * fullBand + 0.5; k++) {
      width = Math.max(col.width / 2, Math.floor((width * 0.85 * fullBand) / r.box.height));
      r = placeObject(env, o, { x, y: objTop, width }, fixed, objTop, defer.banded);
    }
    const anchorTop = objTop;
    // Objects do not overlap; one that would lands below the wrapping object it hits.
    // Measured against the object's wrap shape, not its box: a contour leaves room beside it.
    for (let tries = 0; !pin && tries < 8; tries++) {
      const hit = exclusions.find((e) => {
        if (e.jump) return false;
        // The bare shape: wrap-offset keeps text away, not a neighbouring object in the next column.
        const ext = bandExtent({ ...e, offset: 0 }, r.box.y, r.box.y + r.box.height);
        return ext !== null && ext[0] < r.box.x + r.box.width - EPS && ext[1] > r.box.x + EPS;
      });
      if (!hit) break;
      objTop = snapUp(hit.box.y + hit.box.height + hit.offset);
      r = placeObject(env, o, { x, y: objTop, width }, fixed, objTop, defer.banded);
    }
    // At the top of a column already (nowhere to move it to), it is set there and overflows -- in a
    // band (§09.7 rule 5) that is `W043`; Limit: layout has no diagnostics channel yet, so
    // its W043 is not reported (like W040 above). Pushed down past the limit by another object,
    // it moves on too, even from a column's top.
    // In a band shorter than a full one (the first, under a heading) it waits for a full band rather
    // than hang past this one's foot onto the next page.
    // Forced (it opens a band's column), it is still pushed on when another object pushed it past the
    // foot: a later column or band takes it. Elsewhere forced means set (nowhere else is left).
    if ((!force || (defer.banded && objTop > anchorTop + EPS)) && !pin && r.box.y + r.box.height > limitY + EPS && (!atTop || objTop > anchorTop + EPS || short)) return false;
    append(out, r.placed);
    const jump = r.exclusions.find((e) => e.jump);
    if (jump || (r.exclusions.length === 0 && h.mode === "full")) y = r.box.y + r.box.height + (jump?.offset ?? 0);
    else if (!pin) exclusions.push(...r.exclusions), carry.push(...r.exclusions);
    atTop = false;
    kept = null;
    return true;
  };
  /** `defer.tail`: the text has ended; objects still waiting are set after it here while they fit. */
  const settle = (): void => {
    if (!defer.tail) return;
    const rest = defer.list.splice(0);
    for (const [i, id] of rest.entries())
      if (!placeAnchored(v.objects[id]!, false)) {
        defer.list.push(...rest.slice(i));
        break;
      }
  };
  // §11.3: objects deferred from an earlier column open this one, at its top. Only the first is set
  // whatever its height; the rest follow while they fit, and wait again from the first that does not
  // (forcing them all once ran a pull quote past a band's foot, over the next band's text).
  /** Text before the story ends or a frame break sends it on (§09.7 rule 6: both end the text). */
  const textAhead = (from: number): boolean => {
    for (const x of story.blocks.slice(from)) {
      if (x.kind === "paragraph") return true;
      if (x.kind === "framebreak" && x.scope === "frame") return false;
    }
    return false;
  };
  /**
   * Rule 13 (2026-10-07): in a banded column, a picture as wide as the column that leaves room
   * for only one or two lines under it ends the column; the text goes on to the next one, and rule 12
   * may crop the picture down to the foot.
   */
  /** The picture that ends the column, or null. */
  const stub = (): PositionedObject | null => {
    if (!defer.banded) return null;
    const pics = out.objects.filter((o) => env.v.objects[o.name]?.placement.mode !== "contained" && o.box.x <= col.x + EPS && o.box.x + o.box.width >= col.x + col.width - EPS);
    if (!pics.length) return null;
    const lowest = pics.reduce((a, o) => (o.box.y + o.box.height > a.box.y + a.box.height ? o : a));
    const room = Math.floor((limitY - (lowest.box.y + lowest.box.height + grid.baseline) + EPS) / grid.baseline);
    return room > 0 && room < 3 ? lowest : null;
  };
  // A gutter-centred object waits for a band's first column: from a later one it would reach back
  // over text already set (2026-10-09).
  const later = column > 0 ? defer.list.filter((id) => gutterCentred(v.objects[id]!, col, defer)) : [];
  const waiting = defer.list.splice(0).filter((id) => !later.includes(id));
  // Once the text has ended, pull quotes and fact boxes go before pictures: a page of pictures alone
  // is allowed, one holding only a quote is not (2026-10-07: 2 columns at 1280px left a quote last).
  if (!textAhead(cursor.block)) {
    const tied = (id: string) => v.objects[id]!.kind === "pullquote" || v.objects[id]!.kind === "sidebar";
    waiting.sort((a, b) => Number(tied(b)) - Number(tied(a)));
  }
  for (const [i, id] of waiting.entries())
    if (!placeAnchored(v.objects[id]!, i === 0 && !short)) {
      defer.list.push(...waiting.slice(i));
      break;
    }
  defer.list.push(...later);
  const opened = stub();
  if (opened && textAhead(cursor.block)) return { placed: out, cursor, bottom: y, stop: "full", why: "picture-at-foot", object: opened.name };

  while (cursor.block < story.blocks.length) {
    const b = cursor.block;
    const block = story.blocks[b]!;

    if (block.kind === "framebreak") {
      // §09.3: a break with nowhere to go is ignored and text continues where it is.
      // Limit: layout has no diagnostics channel yet, so its W040 is not reported.
      if (block.scope === "frame" ? nowhere.frame : nowhere.column) {
        cursor = { ...START, block: b + 1 };
        continue;
      }
      // A frame break ends the text here. Objects still waiting open the next column, or the next
      // band, as they would at the story's end, and meet the break again there; with no later column
      // they are set in this one, after the text.
      if (block.scope === "frame") settle();
      if (block.scope === "frame" && defer.list.length > 0 && defer.allowed) return { placed: out, cursor: { ...START, block: b }, bottom: y, stop: "end", why: "frame-break" };
      if (block.scope === "frame") for (const id of defer.list.splice(0)) placeAnchored(v.objects[id]!, true);
      return { placed: out, cursor: { ...START, block: b + 1 }, bottom: y, stop: block.scope === "frame" ? "frame" : "column", why: block.scope === "frame" ? "frame-break" : "column-break" };
    }

    if (block.kind === "object") {
      const o = v.objects[block.object]!;
      if (o.hidden || o.placement.mode !== "anchored" || defer.hoisted?.has(o.id) || defer.floated?.has(o.id)) {
        cursor = { ...START, block: b + 1 };
        continue;
      }
      if (defer.moved?.has(o.id)) {
        defer.held?.push(o.id);
        cursor = { ...START, block: b + 1 };
        continue;
      }
      // Rule 3, banded frames: an object never interrupts a column; it waits for the next column's top.
      // A pull quote or fact box with no text after it interrupts nothing: it sets after the text
      // here if it fits, rather than wait for a page it would have alone (2026-10-07).
      const last = (o.kind === "pullquote" || o.kind === "sidebar") && !textAhead(b + 1);
      if (defer.banded && !atTop && defer.allowed && !pins.has(o.id) && !last) {
        defer.list.push(o.id);
        cursor = { ...START, block: b + 1 };
        continue;
      }
      if (!placeAnchored(o, false)) {
        // §11.3: it does not fit in what is left of the column. It moves to the top of the next
        // column (or band) and the text continues here without a gap -- where there is a next
        // column in this fill to take it; otherwise the column ends at the object, as before.
        if (defer.allowed && !pins.has(o.id) && !env.whole) {
          defer.list.push(o.id);
          cursor = { ...START, block: b + 1 };
          continue;
        }
        return { placed: out, cursor, bottom: y, stop: "full", why: "bottom-line" };
      }
      cursor = { ...START, block: b + 1 };
      const atFoot = stub();
      if (atFoot && textAhead(b + 1)) return { placed: out, cursor, bottom: y, stop: "full", why: "picture-at-foot", object: atFoot.name };
      continue;
    }

    if (block.kind === "rule") {
      // Limit: a rule takes one baseline step, the stroke centred in it.
      if (y + grid.baseline > limitY + EPS && !atTop) return { placed: out, cursor, bottom: y, stop: "full", why: "bottom-line" };
      const width = px(block.rule.width, ctx);
      const align = block.rule.align;
      const x = align === "left" ? col.x : align === "right" ? col.x + col.width - width : col.x + (col.width - width) / 2;
      out.rules.push({ story: story.id, block: b, frame: frameId, x, y: y + grid.baseline / 2, width, weight: px(block.rule.weight, ctx) });
      y += grid.baseline;
      atTop = false;
      kept = null;
      cursor = { ...START, block: b + 1 };
      continue;
    }

    // Design §5: a fitted paragraph is measured and set at its fitted size; its runs scale with it.
    const own = v.styles[block.style]!;
    const ownPieces = paragraphPieces(rd, v, block, own);
    const fitted = own.fit ? fitSize(env, own, ownPieces, Math.min(col.width, measure), ctx) : null;
    const k = fitted === null ? 1 : fitted / px(own.size, ctx);
    const style = fitted === null ? own : { ...scaled(own, k, ctx), leading: { u: "px" as const, n: fitLeading(own, fitted, ctx, grid) } };
    const resuming = cursor.piece > 0 || cursor.at.seg !== 0 || cursor.at.grapheme !== 0 || cursor.at.item !== 0;
    const blockMark = { y, at: mark(out) };
    // No space above at a column's top, nor beside a picture that opened the column without pushing
    // the text down (a cut-out the text wraps): the column still starts level with its neighbours.
    if (!atTop && y > top + EPS && !resuming) y += px(style.spaceBefore, ctx);
    const leading = px(style.leading, ctx);
    const base = engineFont(style, ctx);
    const pieces = fitted === null ? ownPieces : ownPieces.map((p) => p.map((r) => ({ ...r, text: r.text.replace(SHY, "") })));
    const prepare = (p: Piece) => cache.get(p.map((r): EngineRun => ({ text: r.text, font: engineFont(scaled(v.styles[r.style]!, k, ctx), ctx) })), base);
    const metrics = prepare(pieces[0]!);
    const baselineOffset = (leading - (metrics.ascent + metrics.descent)) / 2 + metrics.ascent;
    const snap = style.snap === "baseline";
    const indent = resuming ? 0 : px(block.indent, ctx);
    const cap = block.dropcap && !resuming ? dropcap(env, block, style, metrics.capHeight, leading, ctx, col.x) : null;
    const minSlot = style.minSlot ? px(style.minSlot, ctx) : 6 * base.size; // §09.6 step 3: min-slot, else 6em
    /** Where the drop cap goes: the first line's first slot. */
    let capX = col.x;
    // §07.6 balance: lines break at the narrowest width that keeps their count, so they come out even.
    const even = style.balance && !resuming ? balancedWidth(cache, pieces.map(prepare), Math.min(col.width, measure) - indent) : Number.POSITIVE_INFINITY;
    const blockTop = y;
    // §07.6 composer=paragraph: breaks chosen for the whole paragraph (balanced text keeps its own).
    const full = Math.min(col.width, measure);
    /** The narrowest line that justifies (§07.6 justify-min); a narrower one is ragged. */
    const justifyFrom = style.align !== "justify" ? Number.POSITIVE_INFINITY : style.justifyMin ? px(style.justifyMin, ctx) : 0;
    let hyphens = 0;
    const lineOf: NextLine = style.composer === "paragraph" && even === Number.POSITIVE_INFINITY
      ? (p, from, w) => composeLine(cache.engine, p, from, w, full, { justify: justifyFrom, size: base.size, hyphens, first: n === 0 && !resuming })
      : (p, from, w) => cache.engine.nextLine(p, from, w);
    /** A glyph's advance in the block's font, for hanging punctuation. */
    const glyph = (ch: string): number => cache.engine.nextLine(cache.get([{ text: ch, font: base }], base), CURSOR_START, 1e9)?.width ?? 0;

    let piece = cursor.piece;
    let at = cursor.at;
    let offset = cursor.offset;
    let n = 0;
    let done = false;
    /** Where each line of this block started, so widow control can hand lines to the next column. */
    const starts: { resume: Resume; y: number }[] = [];
    /** Line bands skipped because exclusions left no slot: the column is then not "at its top" any more. */
    let skipped = false;
    bands: while (!done) {
      let lineY = y;
      let baseline = y + baselineOffset;
      if (snap) {
        baseline = snapUp(baseline);
        lineY = baseline - baselineOffset;
      }
      // The first line at a column's top is always set, so a column can never refuse text forever;
      // but once exclusions made it skip bands, running past the limit would set a stray line below
      // the column (into the next band's space), so it ends here, empty, like any full column.
      if (lineY + leading > limitY + EPS && !(atTop && n === 0 && !skipped)) {
        // Keep-with-next: when this block moves on whole, its predecessor comes along (§07.6).
        const backToKept = (k: NonNullable<typeof kept>) => {
          rollback(out, k.at);
          // Going back to the kept block means meeting every object after it again, so one deferred
          // since then must not also open the next column (it was set twice: atlas at 1600x1440).
          const back = k.cursor.block;
          defer.list = defer.list.filter((id) => !story.blocks.some((x, i) => i >= back && x.kind === "object" && x.object === id));
          return { placed: out, cursor: k.cursor, bottom: k.y, stop: "full" as const, why: "keep-with-next" as const };
        };
        // Rule 6: once a band's or frame's last column is final, its last line
        // never ends in a hyphenated break; that line breaks earlier and the word carries on whole.
        // `i` is the index, in this block's lines here, of the line that ends the column.
        const unhyphen = (i: number): Resume | null => {
          const last = out.lines.at(-1);
          if (!(defer.last || defer.turn) || i < 0 || !last || last.block !== b || !last.text.endsWith(SHY_CHAR)) return null;
          const from = starts[i]!.resume;
          const src = pieces[from.piece]!;
          for (let w = last.width - base.size / 2; w > minSlot; w -= base.size / 2) {
            const shorter = cache.engine.nextLine(prepare(src), from.at, w);
            if (!shorter) return null;
            const aligned = alignLine(src.map((r) => r.text).join(""), from.offset, shorter.text);
            if (aligned.text.endsWith(SHY_CHAR)) continue;
            Object.assign(last, { text: aligned.text, measured: shorter.width, end: shorter.end, fragments: shorter.fragments.map((f) => ({ run: src[f.run]!.index, text: f.text })) });
            return { block: b, piece: from.piece, at: shorter.end, offset: aligned.next };
          }
          // No shorter break in a narrow slot (beside a cut-out): the line goes over whole, when
          // what stays still keeps the orphans rule (2026-10-07, a tablet's wide cut-out).
          if (resuming ? i >= 1 : i >= style.orphans) {
            out.lines.pop();
            return from;
          }
          return null;
        };
        // Balancing (2026-10-17): a paragraph is one block. Text left over means it moves on whole, its
        // kept subhead with it; one that does not fit even at a column's top leaves the column empty,
        // so the balancing search takes a taller height.
        if (env.whole && linesLeft(lineOf, pieces.slice(piece).map(prepare), at, Math.min(col.width, measure), 1) > 0) {
          if (kept) return backToKept(kept);
          rollback(out, blockMark.at);
          return { placed: out, cursor, bottom: blockMark.y, stop: "full", why: "bottom-line" };
        }
        // Column full. Orphans: a paragraph that started here and would leave too few
        // lines behind moves whole, and a block kept with it comes along.
        if (!resuming && n > 0 && n < style.orphans && !(atTop && blockMark.at.lines === 0)) {
          if (kept) return backToKept(kept);
          rollback(out, blockMark.at);
          return { placed: out, cursor, bottom: blockMark.y, stop: "full", why: "orphans", moved: n };
        }
        if (n === 0 && kept) return backToKept(kept);
        // Widows: too few lines would start the next column, so lines move over with them,
        // as long as the orphans rule still holds here and no drop cap is split.
        // Nothing left means the paragraph ended exactly at the foot: no widow to protect.
        const left = n > 0 ? linesLeft(lineOf, pieces.slice(piece).map(prepare), at, Math.min(col.width, measure), style.widows) : 0;
        // Keep-with-next (§07.6): a block that ends exactly at the foot would still end the column on
        // its own (a subhead here, its text in the next column): it moves on whole, as an orphan does.
        if (left === 0 && n > 0 && style.keepWithNext && !resuming && !(atTop && blockMark.at.lines === 0)) {
          if (kept) return backToKept(kept);
          rollback(out, blockMark.at);
          return { placed: out, cursor, bottom: blockMark.y, stop: "full", why: "keep-with-next" };
        }
        const give = left > 0 ? style.widows - left : 0;
        if (give > 0 && n - give >= style.orphans && !(cap && n - give < cap.lines)) {
          const from = starts[n - give]!;
          out.lines.length -= give;
          return { placed: out, cursor: unhyphen(n - give - 1) ?? from.resume, bottom: from.y, stop: "full", why: "widows", moved: give };
        }
        // No split satisfies both rules: the paragraph moves whole, unless it already starts the column.
        if (give > 0 && !resuming && !(atTop && blockMark.at.lines === 0)) {
          if (kept) return backToKept(kept);
          rollback(out, blockMark.at);
          return { placed: out, cursor, bottom: blockMark.y, stop: "full", why: "widows", moved: n };
        }
        // A paragraph that ended exactly at the foot resumes at the next block, not at its own end, so
        // "is there text after this point" can be read from the cursor alone (2026-09-30).
        const next = n > 0 && left === 0 ? { ...START, block: b + 1 } : { block: b, piece, at, offset };
        const whole = unhyphen(n - 1);
        // The visor: a paragraph ending exactly at the foot with no text after it ends the story (or the frame's part) here.
        const ended = !whole && n > 0 && left === 0 && !textAhead(b + 1);
        const why = whole ? "hyphen-avoided" : !ended ? "bottom-line" : story.blocks.slice(b + 1).some((x) => x.kind === "framebreak" && x.scope === "frame") ? "frame-break" : "story-end";
        return { placed: out, cursor: whole ?? next, bottom: n === 0 ? blockMark.y : y, stop: "full", why };
      }
      // Strict (no text in a gap under minSlot, the band skipped instead) in a band, and wherever the
      // column itself is wide enough: skipping then ends below the object (2026-09-30: slivers beside
      // pictures on phones). Only a column narrower than minSlot keeps its widest gap, or it would
      // never set a line.
      const dropped: Col[] | undefined = out.narrow ? [] : undefined;
      const slots = slotsFor(col, exclusions, lineY, lineY + leading, minSlot, defer.banded || col.width >= minSlot, dropped);
      for (const d of dropped ?? []) {
        // The object whose side the strip is on: its extent on this band meets the strip.
        const by = exclusions.find((e) => {
          const x = bandExtent(e, lineY, lineY + leading);
          return x !== null && (Math.abs(x[0] - (d.x + d.width)) < 0.5 || Math.abs(x[1] - d.x) < 0.5);
        });
        out.narrow!.push({ x: d.x, y: lineY, width: d.width, height: leading, min: minSlot, frame: frameId, column, ...(by ? { object: by.id } : {}) });
      }
      // A column with no width (a viewport narrower than its margins) has no slot on any band;
      // in a flow frame the bands never run out, so the column ends here as if full.
      if (!(col.width > EPS)) return { placed: out, cursor: { block: b, piece, at, offset }, bottom: n === 0 ? blockMark.y : y, stop: "full", why: "bottom-line" };
      if (slots.length === 0) skipped = true;
      let inBand = 0;
      for (const slot of slots) {
        // The drop cap and first-line indent push text in from the line's first slot: the column's left
        // edge, or where an object on that edge lets text start. The cap is set where the first line starts.
        // Limit: lines 2 and 3 are pushed from their own slots, so a contour narrowing below the first
        // line can still bring one under the cap.
        if (n === 0 && slot === slots[0]) capX = slot.x;
        const push = slot === slots[0] ? (n === 0 ? indent : 0) + (cap && n < cap.lines ? Math.max(0, capX + cap.width + cap.gap - slot.x) : 0) : 0;
        const width = Math.min(slot.width - push, measure);
        let line = lineOf(prepare(pieces[piece]!), at, Math.min(width, even));
        // End of a piece: a forced break (§10.2 \br) puts the next piece on this band, which is
        // already a new line. The end of the last piece ends the paragraph.
        while (line === null && piece + 1 < pieces.length) {
          piece++;
          at = CURSOR_START;
          offset = 0;
          line = lineOf(prepare(pieces[piece]!), at, Math.min(width, even));
        }
        if (line === null) {
          done = true;
          if (inBand === 0) break bands; // nothing on this band: do not advance past it
          break;
        }
        const src = pieces[piece]!;
        // An engine line that does not advance would loop forever: end the paragraph instead.
        if (line.end.item === at.item && line.end.seg === at.seg && line.end.grapheme === at.grapheme) {
          done = true;
          break;
        }
        const aligned = alignLine(src.map((r) => r.text).join(""), offset, line.text);
        inBand++;
        starts.push({ resume: { block: b, piece, at, offset }, y: lineY });
        const fragments = line.fragments.map((f) => ({ run: src[f.run]!.index, text: f.text }));
        if (aligned.text.endsWith(SHY_CHAR)) fragments.at(-1)!.text = fragments.at(-1)!.text.replace(/-$/, SHY_CHAR);
        hyphens = /[-\u00ad]$/.test(aligned.text.trimEnd()) ? hyphens + 1 : 0;
        // §07.6 hang: a quotation mark that opens a line at the column's edge sits outside it, and a
        // closing mark (or hyphen, full stop, comma) ending a justified line hangs past the other edge.
        // Only at the column's own edges: beside a picture the standoff stays clear.
        const t = aligned.text.trimEnd();
        const hangL = style.hang !== "none" && push === 0 && slot.x <= col.x + EPS && HANG_OPEN.test(aligned.text) ? glyph(aligned.text[0]!) : 0;
        const hangR = style.hang !== "none" && width >= justifyFrom && slot.x + slot.width >= col.x + col.width - EPS && HANG_CLOSE[style.hang].test(t) ? glyph(t.endsWith(SHY_CHAR) ? "-" : t.at(-1)!) : 0;
        out.lines.push({
          story: story.id,
          block: b,
          style: block.style,
          frame: frameId,
          column,
          x: slot.x + push,
          y: lineY,
          baseline,
          width,
          measured: line.width,
          height: leading,
          text: aligned.text,
          start: line.start,
          end: line.end,
          paragraphStart: n === 0 && !resuming,
          snapped: snap,
          fragments,
          ...(fitted === null ? {} : { size: fitted }),
          ...(hangL || hangR ? { hang: { left: hangL, right: hangR } } : {}),
        });
        if (cap && n === cap.lines - 1) out.caps.push(cap.place(story.id, b, frameId, capX, baseline));
        at = line.end;
        offset = aligned.next;
        n++;
      }
      y = lineY + leading;
    }
    // A paragraph that ended exactly at the foot of the last column resumes here with nothing left:
    // it sets no line, so it must not add its space-after either, and the column is still at its top.
    if (resuming && n === 0) {
      cursor = { ...START, block: b + 1 };
      continue;
    }
    // A paragraph shorter than its cap: place the cap on the grid anyway and clear it.
    if (cap && n > 0 && n < cap.lines) {
      const first = out.lines[out.lines.length - n]!;
      out.caps.push(cap.place(story.id, b, frameId, capX, first.baseline + (cap.lines - 1) * leading));
      y = Math.max(y, first.y + cap.lines * leading);
    }
    // §07.6: a non-snapping block's height rounds up to whole baseline steps, so the text after it is
    // back on the grid; only before text that snaps (2026-09-30: between the heading block's display
    // lines, a one-line grid added up to a line after each).
    const after = story.blocks.slice(b + 1).find((x) => x.kind === "paragraph");
    if (!snap && after?.kind === "paragraph" && v.styles[after.style]?.snap === "baseline") y = blockTop + Math.ceil((y - blockTop - EPS) / grid.baseline) * grid.baseline;
    y += px(style.spaceAfter, ctx);
    kept = style.keepWithNext ? { cursor, y: blockMark.y, at: blockMark.at } : null;
    atTop = false;
    cursor = { ...START, block: b + 1 };
  }
  settle();
  // The story ended with objects still waiting and no later column to take them: set them here, after the text.
  if (!defer.allowed) for (const id of defer.list.splice(0)) placeAnchored(v.objects[id]!, true);
  return { placed: out, cursor, bottom: y, stop: "end", why: "story-end" };
}

/**
 * §10.4: the cap spans `lines` baseline steps, from the cap height of the
 * first line to the baseline of the last. Its width is measured, not derived
 *: prepare measures the cap at 100px, and both its width and
 * its cap height scale linearly with size.
 */
function dropcap(env: Env, para: ParagraphBlock, body: ResolvedStyle, bodyCapHeight: number, leading: number, ctx: EvalContext, room: number) {
  const d = para.dropcap!;
  const font = { ...engineFont(env.v.styles[d.style]!, ctx), size: 100, tracking: 0 };
  const ref = env.cache.get([{ text: env.rd.strings[d.s]!, font }], font);
  const width100 = env.cache.engine.nextLine(ref, CURSOR_START, 1e9)?.width ?? 0;
  const size = ((d.lines - 1) * leading + bodyCapHeight) / (ref.capHeight / 100);
  const scale = size / 100;
  // §10.4 quote=hang: the opening quotation mark sits outside the column, so the letter lines up with the
  // text; where the margin is narrower than twice the mark (a phone), it stays inside.
  const quote = d.hang ? (/^[“‘"'«„‚]+/.exec(env.rd.strings[d.s]!)?.[0] ?? "") : "";
  const mark = quote ? (env.cache.engine.nextLine(env.cache.get([{ text: quote, font }], font), CURSOR_START, 1e9)?.width ?? 0) * scale : 0;
  // At least the mark's own width of margin stays clear to its left, or it looks cramped (2026-10-07).
  const hung = 2 * mark <= room ? mark : 0;
  return {
    lines: d.lines,
    width: width100 * scale - hung,
    // Limit: the standoff between cap and text is unstated; a quarter of the body size.
    gap: px(body.size, ctx) * 0.25,
    place: (story: string, block: number, frame: string, x: number, baseline: number): PositionedCap => ({
      story,
      block,
      frame,
      x: x - hung,
      y: baseline - ref.ascent * scale,
      height: (ref.ascent + ref.descent) * scale,
      baseline,
      size,
      width: width100 * scale,
    }),
  };
}

/**
 * Walks the piece's source alongside one line the engine returned. Engines
 * drop the soft hyphens inside a line and draw a break at one as "-" (Pretext
 * does). A trailing "-" where the source has U+00AD is a soft-hyphen break, and
 * the line's text ends with U+00AD instead: the renderer shows a hyphen there
 * without letting it into the copy buffer, and a real hyphen stays a hyphen.
 * Also returns where the next line starts in the source.
 */
function alignLine(src: string, from: number, text: string): { text: string; next: number } {
  let i = from;
  while (src[i] === " ") i++; // a line never starts with the space it broke at
  for (let k = 0; k < text.length; k++) {
    const ch = text[k]!;
    if (k === text.length - 1 && ch === "-" && src[i] === SHY_CHAR) return { text: `${text.slice(0, -1)}${SHY_CHAR}`, next: i + 1 };
    while (src[i] === SHY_CHAR && ch !== SHY_CHAR) i++;
    if (src[i] !== ch) return { text, next: i }; // cannot align (should not happen): keep the engine's text
    i++;
  }
  return { text, next: i };
}

/** One piece of a paragraph between forced breaks: its runs, each with its block run index. */
type Piece = { text: string; style: string; index: number }[];

/**
 * The runs the engine measures, split at forced breaks: soft hyphens kept only
 * where the run's style hyphenates, case applied. Empty pieces are dropped.
 */
function paragraphPieces(rd: ResolvedDocument, v: Variant, block: ParagraphBlock, style: ResolvedStyle): Piece[] {
  const pieces: Piece[] = [[]];
  block.runs.forEach((r, index) => {
    if (r.kind === "break") pieces.push([]);
    else {
      const s = v.styles[r.style] ?? style;
      let text = rd.strings[r.s]!;
      if (!s.hyphenate) text = text.replace(SHY, "");
      // Limit: case transforms change the measured text; the renderer shows the same transformed text.
      if (s.case === "upper") text = text.toUpperCase();
      else if (s.case === "lower") text = text.toLowerCase();
      if (text !== "") pieces.at(-1)!.push({ text, style: r.style, index });
    }
  });
  const kept = pieces.filter((p) => p.length > 0);
  return kept.length > 0 ? kept : [[{ text: "", style: block.style, index: 0 }]];
}

function notYet(what: string): never {
  throw new Error(`layout: ${what} is not laid out yet`);
}
