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

import type { Grid, Len, Palette, Reveal, ResolvedStyle } from "../src/resolved-document.js";

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
  const to = bp === "wide" ? 1760 : 1440;
  const f = (min: number, max: number): Len => ({ u: "fluid", min, max, from: 360, to });
  const bodySize = phone ? 18 : tablet ? 19 : bp === "compact" ? 20 : 21;
  const headline = s({
    // regular weight, a touch larger.
    family: GEORGIA, weight: 400, size: f(40, 72), leading: f(42.4, 76.32), tracking: f(-0.6, -1.08),
    snap: "none", hyphenate: false, balance: true, spaceAfter: bl(0.75), bindShort: true,
  });
  return {
    body: s({ family: GEORGIA, size: px(bodySize), spaceAfter: px(0), indent: px(2 * bodySize), align: "justify", minSlot: px(9 * bodySize), composer: "paragraph", hyphenateMin: 6, hyphenateCaps: false, justifyMin: px(12 * bodySize), hang: "punctuation" }),
    // the intro opens the story, on the grid.
    lede: s({ family: GEORGIA, size: px(phone ? 20 : bp === "compact" ? 21 : 22), spaceAfter: bl(1), hyphenate: false, composer: "paragraph" }),
    blockquote: s({ family: GEORGIA, italic: true, size: px(20), hang: "punctuation" }),
    headline,
    deck: s({ family: GEORGIA, size: f(21, 25), leading: f(29.4, 35), snap: "none", balance: true, hyphenate: false, spaceAfter: bl(1.5), bindShort: true }),
    pullquote: s({ family: GEORGIA, italic: true, size: f(22, 28), leading: f(27.5, 35), snap: "none", balance: true, spaceAfter: px(0), mark: "\u201c\u201d", bindShort: true }),
    cite: s({ size: px(17), leading: px(20.4), color: { role: "muted" } }),
    kicker: s({ family: SANS, weight: 500, size: px(12), leading: bl(0.5), case: "upper", tracking: px(1.68), spaceAfter: bl(1), snap: "none" }),
    byline: s({ family: SANS, weight: 500, size: px(14), leading: bl(0.75), spaceAfter: px(0), snap: "none" }),
    meta: s({ family: SANS, size: px(13), leading: bl(0.75), color: { role: "muted" }, spaceAfter: px(0), snap: "none" }),
    subhead: s({ family: SANS, weight: 600, size: px(18), case: "upper", tracking: px(1.44), spaceBefore: bl(1), spaceAfter: px(0), keepWithNext: true, color: { role: "accent" }, balance: true, bindShort: true }),
    "subhead-2": s({ family: SANS, weight: 700, size: px(20), spaceBefore: bl(1), spaceAfter: px(0), keepWithNext: true }),
    caption: s({ family: GEORGIA, italic: true, size: px(15), leading: px(21), color: { role: "muted" }, snap: "none" }),
    credit: s({ family: SANS, size: px(13), leading: px(18.2), case: "upper", tracking: px(0.78), color: { role: "muted" }, snap: "none" }),
    sidebar: s({ family: SANS, size: px(16), leading: px(24), snap: "none" }),
    // §16: as headline, in the accent. Size and leading are not used: the cap spans `lines` steps (§10.4).
    dropcap: { ...headline, weight: 700, color: { role: "accent" } },
    bio: s({ family: SANS, italic: true, size: px(16), leading: bl(0.75), color: { role: "muted" }, snap: "none" }),
    folio: s({ family: SANS, weight: 600, size: px(12), case: "upper", tracking: px(0.96) }),
  };
}

/** Grid `default` (spec §16), `margin-y` already in px. On `wide`, the base grid with max 1760px and outdent 25%. */
export function defaultGrid(bp: Bp): Grid {
  const g = { base: [12, 24, 128, 33, 4, 9, 2], wide: [12, 24, 128, 33, 4, 9, 2], compact: [12, 24, 128, 31, 4, 9, 2], tablet: [8, 20, 72, 30, 2, 7, 2], phone: [4, 16, 28, 28, 1, 4, 1.5] }[bp];
  const [cols, gutter, marginX, baseline, from, to, marginY] = g as [number, number, number, number, number, number, number];
  return {
    name: "default",
    cols,
    gutter: px(gutter),
    marginX: px(marginX),
    marginY: px(marginY * baseline),
    max: px(bp === "wide" ? 1760 : 1440),
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
  { minWidth: 1420, variant: "base" },
  { minWidth: 1800, variant: "wide" },
];

/** In the order the resolver writes variants: base, then the named breakpoints in source order. */
export const BREAKPOINTS = ["base", "wide", "compact", "tablet", "phone"] as const;
export type Bp = (typeof BREAKPOINTS)[number];

/** Keep only the style keys a variant references (G4). */
export function pick(all: Record<string, ResolvedStyle>, keys: string[]): Record<string, ResolvedStyle> {
  return Object.fromEntries(keys.map((k) => [k, all[k]!]));
}
