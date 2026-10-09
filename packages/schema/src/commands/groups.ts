/**
 * Shared attribute groups, defined once and mixed into command rows.
 *
 * Sources are named per group. Where an attribute is described in prose
 * rather than in a table (`side` and `width` in spec §11.3, `alpha-threshold`
 * in §12.2, `motion` in §13 rule 3) the group says so, because those are the
 * rows most likely to drift.
 */

import type { AttrSchema } from "../types.js";

export type Attrs = Record<string, AttrSchema>;

const IDENT_FIXED: AttrSchema = { types: ["ident"], responsive: false };

/** `name` is never breakpoint-varying (grammar §06.1). */
export const NAME_ATTR: Attrs = {
  name: { ...IDENT_FIXED, note: "auto-generated when omitted" },
};

/**
 * Grid placement, spec §11.1, plus the anchored-mode pair from §11.3.
 * Every object takes all of these.
 */
export const PLACEMENT: Attrs = {
  ...NAME_ATTR,
  cols: { types: ["range"], note: "defaults to the grid's body range" },
  rows: { types: ["range"], default: "all", note: "screen scenes only" },
  top: { types: ["enum", "length"], enum: ["auto"], default: "auto", note: "flow scenes only" },
  height: { types: ["enum", "length"], enum: ["auto"], default: "auto" },
  bleed: { types: ["enum"], enum: ["none", "left", "right", "both"], default: "none" },
  "max-width": { types: ["fluid", "length"], note: "caps the box width; the box keeps the centre of the space it was given. In a row group: the widest it may grow" },
  "min-width": { types: ["fluid", "length"], note: "row groups only: the narrowest it may be, rounded up to whole columns" },
  "offset-x": { types: ["length"], default: "0" },
  "offset-y": { types: ["length"], default: "0" },
  layer: { types: ["enum"], enum: ["background", "content", "overlay"], default: "content" },
  z: { types: ["integer"], note: "defaults to source order" },
  hide: { types: ["boolean"], default: "false" },
  // Spec §11.3, prose rather than a table row.
  side: { types: ["enum"], enum: ["full", "left", "right", "center"], default: "full", note: "anchored objects; spec §11.3. center: centred in the column, text on both sides where the gap is wide enough" },
  width: { types: ["length"], note: "anchored objects with side=left|right, % of the column; in a row group, a fixed width rounded to whole columns" },
};

/** How a child of a row group is sized (spec §11.11, design 2026-09-26). Frames take these; objects have them in PLACEMENT. */
export const ROW_SIZING: Attrs = {
  width: { types: ["enum", "length"], enum: ["fit"], note: "row groups only: a fixed width, rounded to whole columns; fit: the columns its widest line needs" },
  "min-width": { types: ["fluid", "length"], note: "row groups only: the narrowest it may be, rounded up to whole columns" },
  "max-width": { types: ["fluid", "length"], note: "row groups only: the widest it may grow, rounded down to whole columns" },
};

/** Text wrap, spec §12.1. Every object pushes text away. */
export const WRAP: Attrs = {
  wrap: {
    types: ["enum"],
    enum: ["none", "rect", "contour", "jump"],
    note: "default depends on placement mode: rect when anchored with side=left|right or cols, jump for side=full, none when grid-placed",
  },
  "wrap-side": { types: ["enum"], enum: ["both", "left", "right", "largest"], default: "largest" },
  "wrap-offset": { types: ["length"], default: "1bl" },
};

/**
 * Contour shapes, spec §12.2. Only objects with real pixels can carry them,
 * so `\embed`, `\audio`, `\gallery`, `\pullquote` and `\sidebar` are excluded.
 */
export const SHAPE: Attrs = {
  shape: { types: ["enum", "poly"], enum: ["rect", "circle", "ellipse", "alpha"], default: "rect" },
  clip: { types: ["boolean"], default: "false" },
  "alpha-threshold": { types: ["percentage"], default: "50%", note: "only with shape=alpha" },
};

/** Reveals, spec §13. `stagger` is added separately; it is container-only. */
export const REVEAL: Attrs = {
  enter: {
    types: ["enum"],
    enum: ["none", "fade", "rise", "drop", "slide-left", "slide-right", "zoom", "wipe"],
    default: "none",
  },
  exit: {
    types: ["enum"],
    enum: ["none", "fade", "rise", "drop", "slide-left", "slide-right", "zoom", "wipe"],
    default: "none",
  },
  "enter-at": { types: ["percentage"], default: "15%" },
  duration: { types: ["time"], default: "600ms" },
  delay: { types: ["time"], default: "0ms" },
  ease: { types: ["enum"], enum: ["standard", "in", "out", "linear"], default: "standard" },
  replay: { types: ["boolean"], default: "false" },
  // Spec §13: the only value is `always`. Same carriers as `enter`.
  motion: { types: ["enum"], enum: ["always"], note: "spec §13 rule 3; emits a resolve warning" },
};

/** Only scenes, parents and groups stagger their children. */
export const STAGGER: Attrs = {
  stagger: { types: ["time"], default: "80ms" },
};

/** Media caption placement, spec §11.4. */
export const CAPTION_SIDE: Attrs = {
  "caption-side": { types: ["enum"], enum: ["below", "above", "overlay"], default: "below" },
};

/** A colour-ish value: a palette role, a literal colour, or a token. */
export const COLOR_VALUE: readonly ["role", "color"] = ["role", "color"];

/** Everything an object accepts: placement, wrap and reveals. */
export const OBJECT_BASE: Attrs = { ...PLACEMENT, ...WRAP, ...REVEAL };

/** Text elements: spec §10.3. `span=all` works inside a multi-column frame. */
export const TEXT_ATTRS: Attrs = {
  style: { types: ["ident"] },
  span: { types: ["enum"], enum: ["all"] },
};
