/**
 * The built-in default theme (spec §16) as flattened data, shared by the
 * examples. Plain values only: this is hand-resolved, not a resolver.
 *
 * Readings the owner ruled on:
 *   - §07.6's default column applies to every style, and §16 overrides it.
 *   - Two-argument fluid() interpolates from 360px to grid `default`'s `max`.
 * The theme is Vanilla (built in since 2026-10-07): Georgia and Helvetica Neue,
 * a one-line baseline grid, and a `wide` breakpoint at 1800px where the grid
 * grows to 1760px.
 */

import type { Grid, Len, Palette, Reveal, ResolvedStyle, Spot } from "../src/resolved-document.js";

export const px = (n: number): Len => ({ u: "px", n });
export const bl = (n: number): Len => ({ u: "bl", n });
export const pct = (n: number): Len => ({ u: "pct", n });
export const fluid = (min: number, max: number, to = 1440): Len => ({ u: "fluid", min, max, from: 360, to });

/** The §07.6 default family, for a style that names none. */
export const SERIF = ["serif"];
export const GEORGIA = ["Georgia", "serif"];
export const SANS = ["Helvetica Neue", "Helvetica", "Arial", "sans-serif"];

/** §07.6 defaults: what every style has unless §16 or the author says otherwise. */
export const STYLE_DEFAULTS: ResolvedStyle = {
  family: SERIF,
  weight: 400,
  italic: false,
  size: px(19),
  leading: bl(1),
  tracking: px(0),
  case: "none",
  align: "left",
  color: { role: "ink" },
  underline: false,
  indent: px(0),
  spaceBefore: px(0),
  spaceAfter: bl(1),
  hyphenate: true,
  widows: 2,
  orphans: 2,
  keepWithNext: false,
  balance: false,
  hyphenMark: "end",
  composer: "line",
  hyphenateMin: 5,
  hyphenateCaps: true,
  hang: "none",
  bindShort: false,
  justifyMin: null,
  minSlot: null,
  mark: null,
  features: ["liga", "kern"],
  snap: "baseline",
  fit: null,
};

const s = (over: Partial<ResolvedStyle>): ResolvedStyle => ({ ...STYLE_DEFAULTS, ...over });

/** §16 styles for one breakpoint, hand-resolved from the Vanilla source (lengths in em already in px). */
export function themeStyles(bp: Bp): Record<string, ResolvedStyle> {
  const phone = bp === "phone";
  const tablet = bp === "tablet";
  // Two-argument fluid() runs from 360px to the default grid's max at this breakpoint.
  const to = bp === "wide" ? 1760 : bp === "compact" ? 1224 : 1440;
  const f = (min: number, max: number): Len => ({ u: "fluid", min, max, from: 360, to });
  // On laptops (compact) every size is 85% of base, rounded to the pixel.
  const c = bp === "compact";
  const k = (base: number, compact: number): number => (c ? compact : base);
  const bodySize = phone ? 18 : tablet ? 19 : k(21, 18);
  const headline = s({
    // regular weight, a touch larger.
    family: GEORGIA, weight: 400, size: c ? f(34, 61) : f(40, 72), leading: c ? f(36.04, 64.66) : f(42.4, 76.32), tracking: c ? f(-0.51, -0.915) : f(-0.6, -1.08),
    snap: "none", hyphenate: false, balance: true, spaceAfter: bl(0.75), bindShort: true,
  });
  return {
    body: s({ family: GEORGIA, size: px(bodySize), spaceAfter: px(0), indent: px(2 * bodySize), align: "justify", minSlot: px(9 * bodySize), composer: "paragraph", hyphenateMin: 6, hyphenateCaps: false, justifyMin: px(12 * bodySize), hang: "punctuation" }),
    // the intro opens the story, on the grid.
    lede: s({ family: GEORGIA, size: px(phone ? 20 : k(22, 19)), spaceAfter: bl(1), hyphenate: false, composer: "paragraph" }),
    blockquote: s({ family: GEORGIA, italic: true, size: px(k(20, 17)), hang: "punctuation" }),
    headline,
    deck: s({ family: GEORGIA, size: c ? f(18, 21) : f(21, 25), leading: c ? f(25.2, 29.4) : f(29.4, 35), snap: "none", balance: true, hyphenate: false, spaceAfter: bl(1.5), bindShort: true }),
    pullquote: s({ family: GEORGIA, italic: true, size: c ? f(19, 24) : f(22, 28), leading: c ? f(23.75, 30) : f(27.5, 35), snap: "none", balance: true, spaceAfter: px(0), mark: "\u201c\u201d", bindShort: true }),
    cite: s({ size: px(k(17, 14)), leading: px(k(20.4, 16.8)), color: { role: "muted" } }),
    kicker: s({ family: SANS, weight: 500, size: px(k(12, 10)), leading: bl(0.5), case: "upper", tracking: px(k(1.68, 1.4)), spaceAfter: bl(1), snap: "none" }),
    byline: s({ family: SANS, weight: 500, size: px(k(14, 12)), leading: bl(0.75), spaceAfter: px(0), snap: "none" }),
    meta: s({ family: SANS, size: px(k(13, 11)), leading: bl(0.75), color: { role: "muted" }, spaceAfter: px(0), snap: "none" }),
    subhead: s({ family: SANS, weight: 600, size: px(k(18, 15)), case: "upper", tracking: px(k(1.44, 1.2)), spaceBefore: bl(1), spaceAfter: px(0), keepWithNext: true, color: { role: "accent" }, balance: true, bindShort: true }),
    "subhead-2": s({ family: SANS, weight: 700, size: px(k(20, 17)), spaceBefore: bl(1), spaceAfter: px(0), keepWithNext: true }),
    caption: s({ family: GEORGIA, italic: true, size: px(k(15, 13)), leading: px(k(21, 18.2)), color: { role: "muted" }, snap: "none" }),
    credit: s({ family: SANS, size: px(k(13, 11)), leading: px(k(18.2, 15.4)), case: "upper", tracking: px(k(0.78, 0.66)), color: { role: "muted" }, snap: "none" }),
    sidebar: s({ family: SANS, size: px(k(16, 14)), leading: px(k(24, 21)), snap: "none" }),
    // §16: as headline, in the accent. Size and leading are not used: the cap spans `lines` steps (§10.4).
    dropcap: { ...headline, weight: 700, color: { role: "accent" } },
    bio: s({ family: SANS, italic: true, size: px(k(16, 14)), leading: bl(0.75), color: { role: "muted" }, snap: "none" }),
    folio: s({ family: SANS, weight: 600, size: px(k(12, 10)), case: "upper", tracking: px(k(0.96, 0.8)) }),
  };
}

/** Grid `default` (spec §16), `margin-y` already in px. On `wide`, the base grid with max 1760px and outdent 25%. */
export function defaultGrid(bp: Bp): Grid {
  const g = { base: [12, 24, 128, 33, 4, 9, 2], wide: [12, 24, 128, 33, 4, 9, 2], compact: [12, 20, 108, 28, 4, 9, 2], tablet: [8, 20, 72, 30, 2, 7, 2], phone: [4, 16, 28, 28, 1, 4, 1.5] }[bp];
  const [cols, gutter, marginX, baseline, from, to, marginY] = g as [number, number, number, number, number, number, number];
  return {
    name: "default",
    cols,
    gutter: px(gutter),
    marginX: px(marginX),
    marginY: px(marginY * baseline),
    max: px(bp === "wide" ? 1760 : bp === "compact" ? 1224 : 1440),
    baseline,
    rows: 6,
    rowGap: px(gutter),
    body: { from, to },
    outdent: bp === "wide" ? pct(25) : px(0),
  };
}

export const DEFAULT_PALETTE: Palette = { paper: "#f6f7f8ff", ink: "#16181dff", muted: "#5f6570ff", accent: "#1f5fbfff", rule: "#dde1e6ff" };

/** §13 defaults: no animation. */
export const NO_REVEAL: Reveal = {
  enter: "none",
  exit: "none",
  enterAt: 0.15,
  durationMs: 600,
  delayMs: 0,
  ease: "standard",
  replay: false,
  motion: "reduce",
};

/** The built-in breakpoints (spec §07.4, §16) as a half-open cover. */
export const DEFAULT_BREAKPOINTS = [
  { minWidth: 0, variant: "phone" },
  { minWidth: 640, variant: "tablet" },
  { minWidth: 1024, variant: "compact" },
  { minWidth: 1800, variant: "wide" },
];

/** In the order the resolver writes variants: base, then the named breakpoints in source order. */
export const BREAKPOINTS = ["base", "wide", "compact", "tablet", "phone"] as const;
export type Bp = (typeof BREAKPOINTS)[number];

/** Keep only the style keys a variant references (G4). */
export function pick(all: Record<string, ResolvedStyle>, keys: string[]): Record<string, ResolvedStyle> {
  return Object.fromEntries(keys.map((k) => [k, all[k]!]));
}

/** Vanilla's nine spots (spec §07.7), the same at every breakpoint. */
export const DEFAULT_SPOTS: Spot[] = [
  { size: "hero", place: "top", span: { kind: "all" }, side: null },
  { size: "hero", place: "top", span: { kind: "all-but-one" }, side: null },
  { size: "wide", place: "top", span: { kind: "count", from: 2, to: 3 }, side: null },
  { size: "wide", place: "bottom", span: { kind: "count", from: 2, to: 3 }, side: null },
  { size: "column", place: "top", span: { kind: "count", from: 1, to: 1 }, side: null },
  { size: "column", place: "bottom", span: { kind: "count", from: 1, to: 1 }, side: null },
  { size: "column", place: "anchor", span: { kind: "count", from: 1, to: 1 }, side: null },
  { size: "small", place: "anchor", span: { kind: "count", from: 1, to: 1 }, side: "left" },
  { size: "small", place: "anchor", span: { kind: "count", from: 1, to: 1 }, side: "right" },
];
