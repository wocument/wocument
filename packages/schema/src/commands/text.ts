/** Text elements and markers -- spec §10. */

import type { CommandSchema } from "../types.js";
import { COLOR_VALUE, NAME_ATTR, TEXT_ATTRS } from "./groups.js";
import { PARAGRAPH_CHILD } from "./sets.js";

/** A text element: required inline body, `style=` and `span=all`. */
const inlineEl = (name: string, spec: string, extra: CommandSchema["attrs"] = {}): CommandSchema => ({
  name,
  class: "block",
  arity: "required",
  kind: "inline",
  children: [],
  maxOnce: [],
  attrs: { ...TEXT_ATTRS, ...extra },
  rules: [],
  spec,
});

export const KICKER = inlineEl("kicker", "§10.3");
export const HEADLINE = inlineEl("headline", "§10.3");
export const DECK = inlineEl("deck", "§10.3");
export const BYLINE = inlineEl("byline", "§10.3");
export const META = inlineEl("meta", "§10.3");
export const LEDE = inlineEl("lede", "§10.3");
export const BIO = inlineEl("bio", "§10.3");
export const SUBHEAD = inlineEl("subhead", "§10.3", {
  level: { types: ["integer"], default: "1", note: "1 renders h2, 2 renders h3" },
});

/** Children of media objects; `\credit` also stands alone in story content. */
export const CAPTION = inlineEl("caption", "§10.3");
export const CREDIT = inlineEl("credit", "§10.3");
/** Sidebar heading. */
export const TITLE = inlineEl("title", "§10.3");
/** Attribution inside a pull quote or block quote. */
export const CITE = inlineEl("cite", "§10.3");

export const BLOCKQUOTE: CommandSchema = {
  name: "blockquote",
  class: "block",
  arity: "required",
  kind: "block",
  children: [PARAGRAPH_CHILD, "cite"],
  maxOnce: ["cite"],
  attrs: { ...TEXT_ATTRS },
  rules: [],
  spec: "§10.3",
};

// --- markers ---------------------------------------------------------------

const marker = (name: string, spec: string, attrs: CommandSchema["attrs"] = {}): CommandSchema => ({
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

export const DROPCAP = marker("dropcap", "§10.4", {
  lines: { types: ["integer"], default: "3" },
  chars: { types: ["integer"], default: "1" },
  quote: { types: ["enum"], enum: ["inside", "hang", "omit"], default: "hang", note: "an opening quotation mark: part of the cap, hung outside the column, or left out" },
});

export const FRAMEBREAK = marker("framebreak", "§09.3", {
  column: { types: ["boolean"], default: "false", note: "ends only the current internal column" },
});

/**
 * A rule is a block inside a frame and a grid-placed object inside a scene
 * (spec §10.4), so it carries the placement attributes it needs for the
 * second case. Whether a given use is legal is a resolver question.
 */
export const RULE = marker("rule", "§10.4", {
  ...NAME_ATTR,
  weight: { types: ["length"], default: "1px" },
  color: { types: [...COLOR_VALUE], default: "rule" },
  width: { types: ["length"], default: "100%" },
  align: { types: ["enum"], enum: ["left", "center", "right"], default: "left" },
  cols: { types: ["range"] },
  rows: { types: ["range"], default: "all" },
  top: { types: ["enum", "length"], enum: ["auto"], default: "auto" },
  "offset-x": { types: ["length"], default: "0" },
  "offset-y": { types: ["length"], default: "0" },
  z: { types: ["integer"] },
  hide: { types: ["boolean"], default: "false" },
});

// --- inline-class commands -------------------------------------------------

export const BR: CommandSchema = {
  name: "br",
  class: "inline",
  arity: "none",
  kind: null,
  children: [],
  maxOnce: [],
  attrs: {},
  rules: [],
  spec: "§10.2",
};

export const ENDMARK: CommandSchema = {
  name: "endmark",
  class: "inline",
  arity: "none",
  kind: null,
  children: [],
  maxOnce: [],
  attrs: { glyph: { types: ["string"], default: '"■"' } },
  rules: [],
  spec: "§10.4",
};

export const SPAN: CommandSchema = {
  name: "span",
  class: "inline",
  arity: "required",
  kind: "inline",
  children: [],
  maxOnce: [],
  // A span with no style does nothing, so the spec makes it required (§10.2).
  attrs: { style: { types: ["ident"], required: true } },
  rules: [],
  spec: "§10.2",
};

export const FOLIO: CommandSchema = {
  name: "folio",
  class: "block",
  arity: "required",
  kind: "inline",
  children: [],
  maxOnce: [],
  attrs: {
    position: {
      types: ["enum"],
      enum: ["top-left", "top-right", "bottom-left", "bottom-right", "margin-left", "margin-right"],
      default: "top-left",
    },
    progress: { types: ["boolean"], default: "false" },
    style: { types: ["ident"] },
  },
  rules: [],
  spec: "§10.5",
};

/**
 * A soundtrack cue (2026-10-09). When it scrolls to `at` up the screen, the music becomes
 * `src`, crossfading over `fade`; `src=none` fades it out. Nothing said, the music carries on.
 * The playing track is always the last cue above the reading position, so scrolling back restores
 * the one before. Browsers allow sound only after the reader's first tap, click or key press.
 */
export const MUSIC = marker("music", "§10.6", {
  src: { types: ["enum", "path"], enum: ["none"], required: true, note: "a sound file, or none to fade out" },
  fade: { types: ["time"], default: "2s", note: "crossfade or fade-out length" },
  volume: { types: ["percentage"], default: "80%" },
  loop: { types: ["boolean"], default: "true" },
  "enter-at": { types: ["percentage"], default: "50%", note: "how far up the screen the cue fires, from the bottom (as reveals)" },
});

export const TEXT_COMMANDS: readonly CommandSchema[] = [
  KICKER, HEADLINE, DECK, BYLINE, META, LEDE, BIO, SUBHEAD,
  CAPTION, CREDIT, TITLE, CITE, BLOCKQUOTE,
  DROPCAP, FRAMEBREAK, RULE, MUSIC, BR, ENDMARK, SPAN, FOLIO,
];
