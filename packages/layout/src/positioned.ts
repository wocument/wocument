/**
 * The Positioned Document: layout's output, the renderer's input. Frozen in
 * spec §15.3. `GridGeometry` and `Exclusion` are named there but not defined;
 * these are the spike's definitions plus `rows` and `rowGap`.
 * CSS pixels in document space: every `y` is from the top of the document.
 */

import type { TextCursor } from "@wmxdsl/text-engine";

export type PositionedDocument = {
  viewport: { width: number; height: number };
  /** The active variant's name. */
  breakpoint: string;
  scenes: PositionedScene[];
  height: number;
  /** The visor (design 2026-10-21): why the engine set the page as it did; only with `layout(..., { explain: true })`. */
  explain?: Explanation;
};

/** The reasons log (design 2026-10-21): plain versioned JSON, one entry per scene in scene order. */
export type Explanation = { version: 1; scenes: { scene: string; decisions: Decision[] }[] };

export type Decision = {
  kind: "column-end" | "picture" | "space" | "line";
  /** A fixed code: for `column-end`, one of `COLUMN_END_REASONS`; for `picture`, one of `PICTURE_REASONS`. */
  reason: string;
  /** 1-based across the document; null in scrolling scenes. */
  screen: number | null;
  frame: string | null;
  column: number | null;
  /** Where the overlay draws it, in document px. */
  at: Rect;
  numbers: Record<string, number>;
  refs: { blocks?: number[]; objects?: string[] };
  /** Spec reference, e.g. "§09.7 rule 11". */
  rule: string;
  /** Pictures: the next three spots. */
  alternatives?: { spot: string; size: string; score: number }[];
};

/** Why a column ends (`kind: "column-end"`). */
export const COLUMN_END_REASONS = ["bottom-line", "levelled", "rule-3-cut", "keep-with-next", "orphans", "widows", "hyphen-avoided", "frame-break", "column-break", "story-end", "balanced-last-page", "stub-folded", "picture-at-foot"] as const;
export type ColumnEndReason = (typeof COLUMN_END_REASONS)[number];

/** Why a floating object took its spot (`kind: "picture"`); `here`: it does not float. */
export const PICTURE_REASONS = ["chosen", "fallback-budget", "fallback-no-spot", "waited", "here"] as const;
export type PictureReason = (typeof PICTURE_REASONS)[number];

export type PositionedScene = {
  /** Scene id in the Resolved Document. */
  name: string;
  y: number;
  height: number;
  grid: GridGeometry;
  /** STORY order, never visual order: the renderer emits them as they come (spec §14). */
  lines: PositionedLine[];
  objects: PositionedObject[];
  /** Additive: drop caps, which layout places and the renderer must draw. */
  caps: PositionedCap[];
  /** Additive: `\rule` blocks inside frames. */
  rules: PositionedRule[];
  /** Design 2026-09-22 §4: vertical column rules, one per gap and band. Color: the palette's `rule`. */
  columnRules: PositionedColumnRule[];
  /** Design 2026-09-29 rule 7: where a column's text carries on elsewhere; x is the column's right edge, y its last line's foot. */
  continues: PositionedContinue[];
  /** Design 2026-09-29: a page scene with column bands, so its height is whole screens and scrolling settles on each. */
  paged: boolean;
  /** Design 2026-10-17, the copyfitting report: one per screen a banded frame sets, for page scenes only (absent when the scene scrolls). */
  screens?: ScreenReport[];
};

/** What a content change could fix on one screen of a page scene; the engine never changes the words. */
export type ScreenReport = {
  /** The screen, from 1, counted in viewport heights from the top of the document. */
  screen: number;
  /** Whole baseline steps between the bottom line and where the screen's lowest text column ends (its last line, or a box at its foot); 0 on the frame's last screen. */
  short: number;
  /** The first five words of the last paragraph with a line on the screen. */
  lastParagraph: string;
  /** A photograph on the screen that crops (`fit=cover`, rect), which could grow to fill it; the first in story order, or null. */
  photo: string | null;
  /** Floating objects set two screens or more from their anchor: it had no room nearer. */
  far: { object: string; screens: number }[];
};

export type PositionedContinue = { frame: string; x: number; y: number };

/** A drop cap (spec §10.4). Its text is the Resolved Document's `Dropcap.s`. */
export type PositionedCap = {
  story: string;
  block: number;
  frame: string;
  x: number;
  /** Top of the cap's line box; the box is `height` tall with the baseline at `baseline`. */
  y: number;
  height: number;
  baseline: number;
  /** Font size in px that makes the cap span its lines. */
  size: number;
  width: number;
};

/** A horizontal rule set as a block in a frame (spec §10.4). Color and style come from the block. */
export type PositionedRule = {
  story: string;
  block: number;
  frame: string;
  x: number;
  /** Vertical center of the stroke. */
  y: number;
  width: number;
  weight: number;
};

export type PositionedColumnRule = {
  frame: string;
  /** Centre of the 1px line. */
  x: number;
  y: number;
  height: number;
};

export type PositionedLine = {
  story: string;
  /** Index into the story's `blocks`. */
  block: number;
  /** The block's style key. */
  style: string;
  frame: string;
  /** Internal column of the frame, from 0. */
  column: number;
  x: number;
  y: number;
  /** Stored, not derived, so the snapping rule lives in one place. */
  baseline: number;
  /** The slot width. */
  width: number;
  /** The text's measured width. */
  measured: number;
  height: number;
  text: string;
  start: TextCursor;
  end: TextCursor;
  paragraphStart: boolean;
  snapped: boolean;
  /**
   * Additive: the line's text split at run
   * boundaries. `run` indexes the block's `runs`, so the renderer can emit
   * the run's style, marks and link. Joined, the texts are `text`.
   */
  fragments: { run: number; text: string }[];
  /** Design 2026-09-22 §5: the px size of the block's style for a fitted paragraph (fit=width); absent otherwise. Run styles scale with it. */
  size?: number;
  /** §07.6 `hang`: how far, in px, the line's first character sits left of `x` and its last right of the slot's edge (hanging punctuation). The line box itself stays the slot. Absent when nothing hangs. */
  hang?: { left: number; right: number };
};

export type PositionedObject = {
  name: string;
  kind: string;
  box: Rect;
  exclusion: Exclusion | null;
  anchoredAt: number | null;
  /** Additive: where the image or video sits inside `box` (the box less its caption); null for text objects. */
  media: Rect | null;
  /** A pull quote's decorative mark (§07.6 `mark`), set at the box's top left at `size` px; `close`, the closing mark after the last word, as large, its glyph's top at `y` (level with the last line's capitals). */
  mark?: { text: string; size: number; close?: { text: string; x: number; y: number; size: number } };
};

export type Rect = { x: number; y: number; width: number; height: number };

/** A grid resolved for one viewport (spec §07.5). All values in px. */
export type GridGeometry = {
  cols: number;
  gutter: number;
  marginX: number;
  marginY: number;
  max: number;
  baseline: number;
  rows: number;
  rowGap: number;
  body: [number, number];
  /** How far an object on the outer edge reaches into the margin: never past the viewport. */
  outdent: number;
  /** Viewport width this was resolved for. */
  viewport: number;
  /** Width of the column area. */
  content: number;
  /** Left edge of column 1. */
  originX: number;
  colWidth: number;
};

export type Exclusion = {
  id: string;
  box: Rect;
  /** `ellipse` is inscribed in `box` (a circle is an ellipse in a square box); `poly` points are normalized to `box`. */
  shape: { kind: "rect" } | { kind: "ellipse" } | { kind: "poly"; points: readonly (readonly [number, number])[] };
  offset: number;
  side: "both" | "left" | "right" | "largest";
  jump: boolean;
};
