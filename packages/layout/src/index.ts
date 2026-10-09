/**
 * @wmxdsl/layout -- Resolved Document + viewport -> Positioned Document
 * (spec §15.1 stage 4, §09.6).
 *
 * Pure after prepare: it reads no DOM and measures nothing itself. All text
 * measurement goes through the PrepareCache's engine (spec §15.4 point 5).
 *
 * Covered: flow and screen scenes (rows, valign, growing on overset),
 * threading across frames and scenes, internal columns with balancing (§09.4),
 * frame and column breaks, orphans and keep-with-next, baseline snapping,
 * space, indent, `measure`, drop caps, in-frame rules, mixed-style paragraphs,
 * text-bearing objects (pull quotes, sidebars) grid-placed or anchored, and
 * rectangular wrap with slots and `wrap-side` (§09.6, §12). Media objects,
 * contour wrap and anchored `cols=` come next and throw until then.
 */

import type {
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
} from "@wmxdsl/resolved-document";
import { CURSOR_START, type EngineRun, type LineBox, type PrepareCache, type Prepared, type TextCursor, type TextEngine } from "@wmxdsl/text-engine";
import { type EvalContext, type Viewport, engineFont, gridGeometry, px, span } from "./evaluate.js";
import { type RowItem, packRows } from "./rows.js";
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
  Rect,
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

/** What one fill produced. */
type Placed = { lines: PositionedLine[]; caps: PositionedCap[]; rules: PositionedRule[]; objects: PositionedObject[]; columnRules: PositionedColumnRule[]; continues: PositionedContinue[] };
const empty = (): Placed => ({ lines: [], caps: [], rules: [], objects: [], columnRules: [], continues: [] });
const append = (a: Placed, b: Placed): void => {
  a.lines.push(...b.lines);
  a.caps.push(...b.caps);
  a.rules.push(...b.rules);
  a.objects.push(...b.objects);
  a.columnRules.push(...b.columnRules);
  a.continues.push(...b.continues);
};
const mark = (p: Placed) => ({ lines: p.lines.length, caps: p.caps.length, rules: p.rules.length, objects: p.objects.length, columnRules: p.columnRules.length, continues: p.continues.length });
function rollback(out: Placed, to: ReturnType<typeof mark>): void {
  out.lines.length = to.lines;
  out.caps.length = to.caps;
  out.rules.length = to.rules;
  out.objects.length = to.objects;
  out.columnRules.length = to.columnRules;
  out.continues.length = to.continues;
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
};

/** The active variant: the last breakpoint range starting at or below the width. */
export function activeVariant(rd: ResolvedDocument, width: number): string {
  let name = rd.breakpoints[0]!.variant;
  for (const r of rd.breakpoints) if (r.minWidth <= width) name = r.variant;
  return name;
}

export function layout(rd: ResolvedDocument, viewport: Viewport, cache: PrepareCache): PositionedDocument {
  const breakpoint = activeVariant(rd, viewport.width);
  const v = rd.variants[breakpoint]!;
  const cursors = new Map<string, Resume>();
  const scenes: PositionedScene[] = [];
  let y = 0;
  for (const scene of v.scenes) {
    const s = layoutScene({ rd, v, grid: gridGeometry(scene.grid, viewport), sceneY: y, viewport, cache, page: scene.height === "page", paged: false }, scene, cursors);
    scenes.push(s);
    y += s.height;
  }
  return { viewport, breakpoint, scenes, height: y };
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
      const before = { out: mark(out), exclusions: exclusions.length, cursors: new Map(cursors) };
      const box = span(grid, from, from + room - 1);
      setFrame(v.frames[c.id]!, box, top, null);
      const widest = Math.max(0, ...out.lines.slice(before.out.lines).filter((l) => l.frame === c.id).map((l) => l.x + l.measured - box.x));
      rollback(out, before.out);
      exclusions.length = before.exclusions;
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
      const before = { out: mark(out), exclusions: exclusions.length, cursors: new Map(cursors) };
      const bottoms = slots.map((s) => kid(s.c, s.a, s.b, y, null));
      // valign=text (2026-09-30): the row is as tall as its tallest text frame; media are cropped to it.
      const texts = slots.flatMap((s, i) => (s.c.kind === "frame" ? [bottoms[i]!] : []));
      const rowBottom = g.valign === "text" && texts.length ? Math.max(...texts) : Math.max(...bottoms);
      if (g.valign !== "top") {
        rollback(out, before.out);
        exclusions.length = before.exclusions;
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
  return { name: scene.id, y: sceneY, height, grid, paged: env.paged, ...behind };
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
  const auto = (): Columns => (count > 1 && frame.balance ? balance(env, run) : run(Number.POSITIVE_INFINITY));
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
    const feet = (band: Columns): number[] => columns.map((_, c) => Math.max(Number.NEGATIVE_INFINITY, ...band.placed.lines.filter((l) => l.frame === frame.id && l.column === c).map((l) => l.y + l.height)));
    /** Where each column's content ends, its text or a picture in it, whichever is lower. */
    const ends = (band: Columns): number[] => columns.map((col, c) => Math.max(feet(band)[c]!, ...band.placed.objects.filter((o) => env.v.objects[o.name]?.placement.mode !== "contained" && o.box.x < col.x + col.width - EPS && o.box.x + o.box.width > col.x + EPS).map((o) => o.box.y + o.box.height)));
    const r = bands(env, contentTop, cursor, (limit, at, from, earlier, deferred) => run(limit, at, from, earlier, deferred), onBand, textAfter, feet, ends, objectsAfter);
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
  const used = Math.max(contentTop, ...result.bottoms) + inset;
  return { placed: result.placed, cursor: result.cursor, bottom: height === null ? used : Math.max(top + height, used) };
}

/**
 * §09.4: the height, in baseline steps, that minimizes the difference between
 * the tallest and shortest column, the smaller height breaking ties. The
 * smallest height that still takes the same text is found first (fitting is
 * monotonic in height); a few steps above it are then compared for level.
 */
function balance(env: Env, run: (limit: number) => Columns): Columns {
  const bl = env.grid.baseline;
  const natural = run(Number.POSITIVE_INFINITY);
  // Anchored objects hang below the text they wrap; the search must reach heights that hold them too.
  const total = Math.max(...natural.bottoms, ...natural.placed.objects.map((o) => o.box.y + o.box.height)) - Math.min(...natural.tops);
  // A height that leaves a column holding one lone line is no good, whatever it does for level:
  // splitting a short remainder 1 + 1 breaks the widow and orphan rules (§07.6) the fill could not.
  // Limit: 2 is the default widows and orphans, not the story's own; per-style minimums if one sets more.
  const lone = (r: Columns): boolean => {
    const per = new Map<number, number>();
    for (const l of r.placed.lines) per.set(l.column, (per.get(l.column) ?? 0) + 1);
    return per.size > 1 && [...per.values()].some((n) => n < 2);
  };
  // Text that ends exactly at the last column's foot reports the column full, yet takes it all: that
  // fit counts (2026-10-07: two columns stayed 28 and 26 lines where 27 and 27 fit exactly).
  const same = (r: Columns): boolean => r.cursor.block === natural.cursor.block && (r.stop !== "full" || r.deferred.length === 0) && !r.collides && !lone(r);
  let lo = 1;
  let hi = Math.max(1, Math.ceil(total / bl));
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (same(run(mid * bl))) hi = mid;
    else lo = mid + 1;
  }
  // The upper bound is measured, not tried: when even it does not take the text (lines snapping to a
  // page's grid can need a line more), the natural setting stands, so nothing is left behind.
  let best = run(lo * bl);
  if (!same(best)) return natural;
  const spread = (r: Columns): number => Math.max(...r.bottoms) - Math.min(...r.bottoms);
  for (let k = 1; k <= 3 && spread(best) > bl + EPS; k++) {
    const trial = run((lo + k) * bl);
    if (same(trial) && spread(trial) < spread(best) - EPS) best = trial;
  }
  return best;
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
  /** Whether an object is still to come in the story from a resume point (before a frame break). */
  objectsAfter: (from: Resume) => boolean = () => false,
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
  // 2026-10-07: every page's lines sit on the same grid, counted from that page's top, so the
  // columns of every page line up alike (a screen is rarely a whole number of lines).
  env.origin = sceneY + page * viewport.height;
  /** The last band set, to set again when the section's last page would be a stub. */
  let prev: { mark: ReturnType<typeof mark>; tops: number; bottoms: number; earlier: number; at: number; limit: number; from: Resume; waiting: readonly string[]; page: number; band: Columns } | null = null;
  for (;;) {
    let full = run(limit, at, from, earlier, waiting);
    // Rule 3 (2026-09-30): a band that ends the text with objects still waiting would leave the next
    // page to them alone. It sets a line less at a time until some of the text goes over with them.
    /** The text ends here with objects still waiting: the next page would hold them alone. */
    const lone = (r: Columns): boolean => r.stop === "full" && (r.deferred.length > 0 || objectsAfter(r.cursor)) && !textAfter(r.cursor);
    if (lone(full))
      for (let cut = grid.baseline; cut < limit / 2; cut += grid.baseline) {
        const t = run(limit - cut, at, from, earlier, waiting);
        if (textAfter(t.cursor)) {
          full = t;
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
    const spread = (r: Columns): number => {
      const f = feet(r).filter(Number.isFinite);
      return f.length ? Math.max(...f) - Math.min(...f) : 0;
    };
    if (full.stop === "full" && spread(full) > EPS) {
      let best = full;
      for (let cut = grid.baseline; cut <= 6 * grid.baseline + EPS && cut < limit / 2; cut += grid.baseline) {
        const t = run(limit - cut, at, from, earlier, waiting);
        // A try that sets nothing is level only because it has no columns: never a candidate.
        if (t.stop !== "full" || lone(t) || sameResume(t.cursor, from) || spread(t) >= spread(best) - EPS) continue;
        best = t;
        if (spread(t) <= EPS) break;
      }
      full = best;
    }
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
    let band = done ? balance(env, (l) => run(Math.min(l, limit), at, from, earlier, waiting)) : full;
    // 2026-10-08: a section's last page never holds a stub of three lines or fewer and nothing
    // else. The page before is set again at its full height; when the rest of the text fits there,
    // that page ends the section (balanced) and the stub page goes.
    if (done && prev && band.placed.objects.length === 0 && band.placed.lines.length > 0 && band.placed.lines.length <= 3) {
      rollback(out, prev.mark);
      tops.length = prev.tops;
      bottoms.length = prev.bottoms;
      earlier.length = prev.earlier;
      env.origin = sceneY + prev.page * viewport.height;
      const t = run(prev.limit, prev.at, prev.from, earlier, prev.waiting);
      if (t.stop !== "full" && !t.collides) {
        band = balance(env, (l) => run(Math.min(l, prev!.limit), prev!.at, prev!.from, earlier, prev!.waiting));
        at = prev.at;
        page = prev.page;
      } else {
        // It does not fit: both pages stand as they were.
        env.origin = sceneY + page * viewport.height;
        append(out, prev.band.placed);
        tops.push(...prev.band.tops);
        bottoms.push(...prev.band.bottoms);
        earlier.push(...prev.band.carried);
      }
    }
    prev = { mark: mark(out), tops: tops.length, bottoms: bottoms.length, earlier: earlier.length, at, limit, from, waiting, page, band };
    onBand(at, band, done);
    append(out, band.placed);
    tops.push(...band.tops);
    bottoms.push(...band.bottoms);
    earlier.push(...band.carried);
    // A band that set nothing would repeat forever: stop, as an overset frame does.
    const idle = sameResume(band.cursor, from) && band.placed.lines.length === 0 && band.placed.objects.length === 0;
    // 2026-10-07: a picture taller than a band hangs into the next ones (W043). A band it fills sets
    // nothing, and the text continues on the first band below the picture's foot.
    const covered = idle && !done && earlier.some((e) => e.box.y + e.box.height > at + EPS);
    if ((done && holdOver.length === 0) || (idle && !covered)) {
      env.origin = undefined;
      return { placed: out, cursor: band.cursor, stop: band.stop, tops, bottoms, carried: earlier, deferred: band.deferred };
    }
    waiting = [...holdOver, ...band.deferred];
    from = band.cursor;
    at = sceneY + ++page * viewport.height + grid.marginY;
    env.origin = sceneY + page * viewport.height;
    limit = screen;
  }
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
type Defer = { list: string[]; allowed: boolean; last: boolean; banded: boolean; span?: Col; hoisted?: ReadonlySet<string>; turn?: boolean; tail?: boolean; moved?: ReadonlySet<string>; held?: string[] };
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
  const defer: Defer = { list: [...deferred], allowed: false, last: false, banded, span, moved, held: [] };
  const tops: number[] = [];
  const bottoms: number[] = [];
  let cursor = start;
  let stop: Stop = "end";
  /** Exclusions of objects placed in earlier columns: a `cols=` object can reach into later ones. */
  const carry: Exclusion[] = [];
  for (let c = 0; c < columns.length; c++) {
    const nowhere = lastInThread ? { frame: true, column: c === columns.length - 1 } : undefined;
    defer.allowed = c < columns.length - 1 || banded;
    defer.last = c === columns.length - 1;
    defer.turn = c === turn;
    defer.banded = banded;
    const waited = [...defer.list];
    const carried = carry.length;
    const inherited = [...exclusions, ...carry];
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
      cursor = r.cursor;
      stop = "end";
      break;
    }
    append(placed, r.placed);
    tops.push(top);
    bottoms.push(r.bottom);
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
  return { placed, cursor, stop, tops, bottoms, carried: [...carry, ...[...pins.values()].flatMap((p) => p.exclusions)], deferred: [...defer.list, ...new Set(defer.held)] };
}

/**
 * §09.6 step 2-4: the free slots of one line band. The column interval minus
 * every exclusion that intersects the band (expanded by its offset); slots
 * narrower than `minSlot` dropped, but the widest kept if none is wide enough
 * (step 3, W042); then `wrap-side` picks which slots take text. A `jump`
 * exclusion leaves the band empty.
 */
function slotsFor(col: Col, exclusions: readonly Exclusion[], top: number, bottom: number, minSlot: number, strict = false): Col[] {
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
/** The most a justified line's spaces close, in em (the renderer's SHRINK). */
const SHRINK = 0.05;
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
): { placed: Placed; cursor: Resume; bottom: number; stop: Stop | "column" } {
  const { v, rd, grid, sceneY, cache } = env;
  const ctx: EvalContext = { viewport: env.viewport, grid, pctOf: col.width };
  const origin = env.origin ?? sceneY;
  const snapUp = (y: number): number => origin + Math.ceil((y - origin - EPS) / grid.baseline) * grid.baseline;
  const exclusions = [...inherited];
  const out = empty();
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
    const given = slot ? slot.width : h.mode === "full" ? (cutout && !defer.last ? Math.round(col.width * 1.5) : col.width) : h.mode === "side" ? Math.min(col.width, px(h.width, ctx)) : col.width;
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
    let r = placeObject(env, o, { x, y: objTop, width }, fixed, objTop);
    // Rule 8 (2026-09-30: every picture in the flow, not only cut-outs; a `cols=` picture is the
    // author's to size): in a band, no picture is taller than 85% of a full band; a taller one
    // narrows, keeping its left edge. A few rounds, since its caption does not shrink with it.
    for (let k = 0; defer.banded && "media" in o && !slot && k < 3 && r.box.height > 0.85 * fullBand + 0.5; k++) {
      width = Math.max(col.width / 2, Math.floor((width * 0.85 * fullBand) / r.box.height));
      r = placeObject(env, o, { x, y: objTop, width }, fixed, objTop);
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
      r = placeObject(env, o, { x, y: objTop, width }, fixed, objTop);
    }
    // At the top of a column already (nowhere to move it to), it is set there and overflows -- in a
    // band (§09.7 rule 5) that is `W043`; Limit: layout has no diagnostics channel yet, so
    // its W043 is not reported (like W040 above). Pushed down past the limit by another object,
    // it moves on too, even from a column's top.
    // In a band shorter than a full one (the first, under a heading) it waits for a full band rather
    // than hang past this one's foot onto the next page.
    if (!force && !pin && r.box.y + r.box.height > limitY + EPS && (!atTop || objTop > anchorTop + EPS || short)) return false;
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
  const stub = (): boolean => {
    if (!defer.banded) return false;
    const pics = out.objects.filter((o) => env.v.objects[o.name]?.placement.mode !== "contained" && o.box.x <= col.x + EPS && o.box.x + o.box.width >= col.x + col.width - EPS);
    if (!pics.length) return false;
    const under = Math.max(...pics.map((o) => o.box.y + o.box.height)) + grid.baseline;
    const room = Math.floor((limitY - under + EPS) / grid.baseline);
    return room > 0 && room < 3;
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
  if (stub() && textAhead(cursor.block)) return { placed: out, cursor, bottom: y, stop: "full" };

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
      if (block.scope === "frame" && defer.list.length > 0 && defer.allowed) return { placed: out, cursor: { ...START, block: b }, bottom: y, stop: "end" };
      if (block.scope === "frame") for (const id of defer.list.splice(0)) placeAnchored(v.objects[id]!, true);
      return { placed: out, cursor: { ...START, block: b + 1 }, bottom: y, stop: block.scope === "frame" ? "frame" : "column" };
    }

    if (block.kind === "object") {
      const o = v.objects[block.object]!;
      if (o.hidden || o.placement.mode !== "anchored" || defer.hoisted?.has(o.id)) {
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
        if (defer.allowed && !pins.has(o.id)) {
          defer.list.push(o.id);
          cursor = { ...START, block: b + 1 };
          continue;
        }
        return { placed: out, cursor, bottom: y, stop: "full" };
      }
      cursor = { ...START, block: b + 1 };
      if (stub() && textAhead(b + 1)) return { placed: out, cursor, bottom: y, stop: "full" };
      continue;
    }

    if (block.kind === "rule") {
      // Limit: a rule takes one baseline step, the stroke centred in it.
      if (y + grid.baseline > limitY + EPS && !atTop) return { placed: out, cursor, bottom: y, stop: "full" };
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
          return { placed: out, cursor: k.cursor, bottom: k.y, stop: "full" as const };
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
        // Column full. Orphans: a paragraph that started here and would leave too few
        // lines behind moves whole, and a block kept with it comes along.
        if (!resuming && n > 0 && n < style.orphans && !(atTop && blockMark.at.lines === 0)) {
          if (kept) return backToKept(kept);
          rollback(out, blockMark.at);
          return { placed: out, cursor, bottom: blockMark.y, stop: "full" };
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
          return { placed: out, cursor, bottom: blockMark.y, stop: "full" };
        }
        const give = left > 0 ? style.widows - left : 0;
        if (give > 0 && n - give >= style.orphans && !(cap && n - give < cap.lines)) {
          const from = starts[n - give]!;
          out.lines.length -= give;
          return { placed: out, cursor: unhyphen(n - give - 1) ?? from.resume, bottom: from.y, stop: "full" };
        }
        // No split satisfies both rules: the paragraph moves whole, unless it already starts the column.
        if (give > 0 && !resuming && !(atTop && blockMark.at.lines === 0)) {
          if (kept) return backToKept(kept);
          rollback(out, blockMark.at);
          return { placed: out, cursor, bottom: blockMark.y, stop: "full" };
        }
        // A paragraph that ended exactly at the foot resumes at the next block, not at its own end, so
        // "is there text after this point" can be read from the cursor alone (2026-09-30).
        const next = n > 0 && left === 0 ? { ...START, block: b + 1 } : { block: b, piece, at, offset };
        return { placed: out, cursor: unhyphen(n - 1) ?? next, bottom: n === 0 ? blockMark.y : y, stop: "full" };
      }
      // Strict (no text in a gap under minSlot, the band skipped instead) in a band, and wherever the
      // column itself is wide enough: skipping then ends below the object (2026-09-30: slivers beside
      // pictures on phones). Only a column narrower than minSlot keeps its widest gap, or it would
      // never set a line.
      const slots = slotsFor(col, exclusions, lineY, lineY + leading, minSlot, defer.banded || col.width >= minSlot);
      // A column with no width (a viewport narrower than its margins) has no slot on any band;
      // in a flow frame the bands never run out, so the column ends here as if full.
      if (!(col.width > EPS)) return { placed: out, cursor: { block: b, piece, at, offset }, bottom: n === 0 ? blockMark.y : y, stop: "full" };
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
  return { placed: out, cursor, bottom: y, stop: "end" };
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
