/** Definition commands -- spec §07. All bodiless except \parent (see structure.ts). */

import type { CommandSchema } from "../types.js";
import { COLOR_VALUE } from "./groups.js";

const def = (
  name: string,
  spec: string,
  attrs: CommandSchema["attrs"],
): CommandSchema => ({
  name,
  class: "block",
  arity: "none",
  kind: null,
  children: [],
  maxOnce: [],
  attrs,
  rules: [],
  spec,
});

/** Every attribute of \font, \token and \breakpoint is non-responsive (grammar §06.1). */
const FIXED = { responsive: false } as const;

export const FONT = def("font", "§07.1", {
  family: { types: ["string"], required: true, ...FIXED },
  src: { types: ["path"], required: true, ...FIXED },
  weight: { types: ["integer", "range"], default: "400", note: "a range for a variable font", ...FIXED },
  italic: { types: ["boolean"], default: "false", ...FIXED },
});

export const TOKEN = def("token", "§07.2", {
  name: { types: ["ident"], required: true, ...FIXED },
  // Typed at each point of use, not here (grammar §04.1 rule 3).
  value: { types: ["any"], required: true, ...FIXED },
});

export const PALETTE = def("palette", "§07.3", {
  name: { types: ["ident"], required: true, responsive: false },
  paper: { types: [...COLOR_VALUE] },
  ink: { types: [...COLOR_VALUE] },
  muted: { types: [...COLOR_VALUE] },
  accent: { types: [...COLOR_VALUE] },
  rule: { types: [...COLOR_VALUE] },
});

export const BREAKPOINT = def("breakpoint", "§07.4", {
  name: { types: ["ident"], required: true, ...FIXED },
  min: { types: ["length"], ...FIXED },
  max: { types: ["length"], ...FIXED },
});

export const GRID = def("grid", "§07.5", {
  name: { types: ["ident"], default: "default", responsive: false },
  at: { types: ["ident"], responsive: false, note: "redefines this grid for one breakpoint" },
  cols: { types: ["integer"], default: "12" },
  gutter: { types: ["length"], default: "24px" },
  "margin-x": { types: ["length"], default: "64px" },
  "margin-y": { types: ["length"], default: "4bl" },
  margin: { types: ["length"], note: "shorthand for margin-x and margin-y" },
  max: { types: ["length"], default: "1440px" },
  baseline: { types: ["length"], default: "28px", note: "defines the bl unit" },
  rows: { types: ["integer"], default: "6", note: "screen-height scenes only" },
  "row-gap": { types: ["length"], note: "defaults to gutter" },
  body: { types: ["range"], default: "4-9", note: "columns used by the default frame" },
  outdent: { types: ["length"], default: "0", note: "how far an object on the grid's outer edge reaches into the margin" },
});

export const STYLE = def("style", "§07.6", {
  name: { types: ["ident"], required: true, responsive: false },
  extends: { types: ["ident"], responsive: false },
  at: { types: ["ident"], responsive: false },
  family: { types: ["string"], note: "CSS-style fallback list" },
  weight: { types: ["integer"], default: "400" },
  italic: { types: ["boolean"], default: "false" },
  size: { types: ["fluid", "length"], default: "19px" },
  leading: { types: ["length"], default: "1bl" },
  tracking: { types: ["length"], default: "0em" },
  case: { types: ["enum"], enum: ["none", "upper", "lower", "small-caps"], default: "none" },
  align: { types: ["enum"], enum: ["left", "right", "center", "justify"], default: "left" },
  color: { types: [...COLOR_VALUE], default: "ink" },
  indent: { types: ["length"], default: "0" },
  "space-before": { types: ["length"], default: "0" },
  "space-after": { types: ["length"], default: "1bl" },
  hyphenate: { types: ["boolean"], default: "true" },
  widows: { types: ["integer"], default: "2" },
  orphans: { types: ["integer"], default: "2" },
  "keep-with-next": { types: ["boolean"], default: "false" },
  balance: { types: ["boolean"], default: "false", note: "even lines: the narrowest width that takes no more lines" },
  "hyphen-mark": { types: ["enum"], enum: ["end", "both"], default: "end", note: "both: a hyphenated word also shows a hyphen where it continues, hanging before the next line" },
  mark: { types: ["string"], note: "a pull quote's decorative mark, set large and bold in the accent above its text" },
  composer: { types: ["enum"], enum: ["line", "paragraph"], default: "line", note: "paragraph: each line's break is chosen for the whole paragraph, evening the spacing and keeping a word from standing alone on the last line" },
  "hyphenate-min": { types: ["integer"], default: "5", note: "the shortest word, in letters, that hyphenates" },
  "hyphenate-caps": { types: ["boolean"], default: "true", note: "false: a word that starts with a capital never hyphenates" },
  hang: { types: ["enum"], enum: ["none", "quotes", "punctuation"], default: "none", note: "quotation marks (and with punctuation, hyphens, full stops and commas) at a line's edge hang outside the column" },
  "bind-short": { types: ["boolean"], default: "false", note: "a short word (a, the, of, to...) never ends a line: it stays with the word after it" },
  "justify-min": { types: ["length"], note: "with align=justify: a line narrower than this is set ragged right instead. Unset: every line justifies" },
  "min-slot": { types: ["length"], note: "the narrowest gap beside an object that text is set in; a narrower one stays empty. Unset: 6em of the style's size" },
  features: { types: ["string"], default: '"liga kern"' },
  snap: { types: ["enum"], enum: ["baseline", "none"], default: "baseline" },
  fit: { types: ["enum"], enum: ["none", "width"], default: "none", note: "design 2026-09-22 §5" },
  "fit-max": { types: ["length"], note: "largest fitted size; defaults to three times size" },
  "fit-height": { types: ["length"], note: "tallest the fitted paragraph may be" },
});

export const DEFINITIONS: readonly CommandSchema[] = [FONT, TOKEN, PALETTE, BREAKPOINT, GRID, STYLE];

/** Names that may only appear in the design head or a theme file (grammar §07). */
export const DEFINITION_NAMES: readonly string[] = [...DEFINITIONS.map((d) => d.name), "parent"];
