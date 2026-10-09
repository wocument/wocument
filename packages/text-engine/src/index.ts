/**
 * The text engine contract (spec §15.4). Layout codes against this interface,
 * never against Pretext: swapping engines means rewriting one adapter.
 *
 *   1. prepare   -- styled runs + fonts -> a reusable prepared paragraph.
 *                   Measurement happens here and only here (point 5).
 *   2. nextLine  -- prepared + cursor + max width -> the next line, or null.
 *                   The width may differ on every call (contour wrap).
 *   3. cursor    -- plain data, resumable across frames (threading).
 *   4. hyphens   -- U+00AD inserted by the resolver is a break opportunity.
 */

/**
 * Where a line starts or ends: run, segment within the run, grapheme within
 * the segment. Plain data: it is stored in the Positioned Document. `item`
 * extends the frozen spike shape for mixed-style paragraphs.
 */
export type TextCursor = { readonly item: number; readonly seg: number; readonly grapheme: number };

export const CURSOR_START: TextCursor = { item: 0, seg: 0, grapheme: 0 };

/** A font at one concrete size: everything measurement depends on. */
export type EngineFont = {
  /** Family fallback list, most preferred first. */
  family: readonly string[];
  weight: number;
  italic: boolean;
  /** Font size in px, already evaluated at the viewport width. */
  size: number;
  /** Letter spacing in px. */
  tracking: number;
};

/** One styled run of a paragraph. */
export type EngineRun = { text: string; font: EngineFont };

/** One prepared paragraph. Opaque above the adapter except for its metrics. */
export type Prepared = {
  readonly runs: readonly EngineRun[];
  /** The block font's ascent and descent in px. A browser places a line's baseline
   *  at half-leading + ascent, where half-leading = (line height - (ascent + descent)) / 2. */
  readonly ascent: number;
  readonly descent: number;
  /** Height of a capital letter above the baseline, in px: sizes drop caps (spec §10.4). */
  readonly capHeight: number;
  readonly opaque: unknown;
};

/** The part of a line set in one run. */
export type Fragment = { run: number; text: string };

export type LineBox = {
  text: string;
  /** Measured width of the line's text in px. */
  width: number;
  start: TextCursor;
  end: TextCursor;
  /** The line's text split at run boundaries, in order. Joined, they are `text`. */
  fragments: Fragment[];
};

export type TextEngine = {
  /** `base` is the block's own font: the line metrics come from it, whatever the runs are. */
  prepare(runs: readonly EngineRun[], base: EngineFont): Prepared;
  nextLine(prepared: Prepared, from: TextCursor, maxWidth: number): LineBox | null;
};

/** A CSS `font` shorthand for a font, for engines and renderers that speak CSS. */
export function cssFont(f: EngineFont): string {
  const family = f.family.map((x) => (/^[a-z-]+$/.test(x) ? x : JSON.stringify(x))).join(", ");
  return `${f.italic ? "italic " : ""}${f.weight} ${f.size}px ${family}`;
}

const fontKey = (f: EngineFont): string => `${cssFont(f)}|${f.tracking}`;

/**
 * Prepared paragraphs, cached by runs and fonts (spec §15.4 point 6). Keying on
 * evaluated fonts rather than the breakpoint means a return to a breakpoint is
 * free, and a fluid size re-prepares exactly when its pixel size changes
 *.
 */
export class PrepareCache {
  private readonly map = new Map<string, Prepared>();
  constructor(readonly engine: TextEngine) {}

  get(runs: readonly EngineRun[], base: EngineFont): Prepared {
    const key = `${fontKey(base)}\n${runs.map((r) => `${fontKey(r.font)}\t${r.text}`).join("\n")}`;
    let p = this.map.get(key);
    if (!p) {
      p = this.engine.prepare(runs, base);
      this.map.set(key, p);
    }
    return p;
  }

  get size(): number {
    return this.map.size;
  }
}

export { createFixedEngine } from "./fixed.js";
export { createPretextEngine } from "./pretext.js";
