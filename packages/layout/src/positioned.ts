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
};

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
