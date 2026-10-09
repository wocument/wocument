/** Structure: \scene, \parent, \story, \frame -- spec §08 and §09. */

import type { Attrs } from "./groups.js";
import type { CommandSchema, CrossFieldRule } from "../types.js";
import { COLOR_VALUE, NAME_ATTR, REVEAL, ROW_SIZING, STAGGER } from "./groups.js";
import { MARKER, OBJECT, STORY_CONTENT, TEXT_EL } from "./sets.js";

/**
 * A scene body is either frames/groups/objects (explicit) or story content
 * (shorthand). Phase B classifies the form and rejects the mixture with P042,
 * so both sets are legal children here.
 */
const SCENE_CHILDREN: readonly string[] = [
  ...new Set(["frame", "group", ...OBJECT, ...STORY_CONTENT]),
];

const SCENE_ATTRS: Attrs = {
  grid: { types: ["ident"], default: "default" },
  parent: { types: ["ident"], responsive: false },
  palette: { types: ["ident"], default: "default" },
  height: { types: ["enum"], enum: ["flow", "screen", "page"], default: "flow" },
  snap: { types: ["enum"], enum: ["none", "soft", "hard"], default: "none" },
  turn: { types: ["enum"], enum: ["none", "fade", "slide"], default: "none", note: "page turn, design 2026-09-22 §3" },
  bg: { types: [...COLOR_VALUE], default: "paper" },
  linearize: { types: ["boolean"], default: "false" },
  folio: { types: ["enum"], enum: ["show", "hide"], default: "show" },
  ...REVEAL,
  ...STAGGER,
};

export const SCENE: CommandSchema = {
  name: "scene",
  class: "block",
  arity: "required",
  kind: "scene",
  children: SCENE_CHILDREN,
  maxOnce: [],
  attrs: { ...NAME_ATTR, ...SCENE_ATTRS },
  rules: [],
  spec: "§08.1",
};

/** A scene template. Same attributes and body, plus a required name and `at`. */
export const PARENT: CommandSchema = {
  name: "parent",
  class: "block",
  arity: "optional",
  kind: "scene",
  // A parent may carry its own folio for the scenes built from it (§10.5).
  children: [...SCENE_CHILDREN, "folio"],
  maxOnce: ["folio"],
  attrs: {
    name: { types: ["ident"], required: true, responsive: false },
    at: { types: ["ident"], responsive: false },
    ...SCENE_ATTRS,
  },
  rules: [],
  spec: "§08.4",
};

export const STORY: CommandSchema = {
  name: "story",
  class: "block",
  arity: "required",
  kind: "block",
  children: STORY_CONTENT,
  maxOnce: [],
  attrs: {
    name: { types: ["ident"], required: true, responsive: false },
    overset: { types: ["enum"], enum: ["grow", "clip", "error"], default: "grow" },
    style: { types: ["ident"], default: "body" },
  },
  rules: [],
  spec: "§09.1",
};

const FRAME_RULES: readonly CrossFieldRule[] = [
  {
    code: "P044",
    describe: "a frame with story= takes no body",
    check: ({ keys, hasBody }) =>
      keys.has("story") && hasBody
        ? { key: "story", message: "\\frame has both `story=` and a body." }
        : null,
  },
];

export const FRAME: CommandSchema = {
  name: "frame",
  class: "block",
  arity: "optional",
  kind: "block",
  children: STORY_CONTENT,
  maxOnce: [],
  attrs: {
    ...NAME_ATTR,
    story: { types: ["ident"], responsive: false, note: "when set, the frame takes no body" },
    cols: { types: ["range"], note: "defaults to the grid's body range" },
    rows: { types: ["range"], default: "all", note: "screen scenes only" },
    top: { types: ["enum", "length"], enum: ["auto"], default: "auto", note: "flow scenes only" },
    height: { types: ["enum", "length"], enum: ["auto"], default: "auto", note: "flow scenes only" },
    columns: {
      types: ["integer", "enum"],
      enum: ["auto"],
      default: "1",
      note: "internal columns; auto fits them to the measure",
    },
    "column-gap": { types: ["length"], note: "defaults to the grid's gutter" },
    balance: { types: ["boolean"], default: "true" },
    "column-rule": { types: ["enum"], enum: ["none", "rule"], default: "none", note: "design 2026-09-22 §4" },
    valign: { types: ["enum"], enum: ["top", "center", "bottom"], default: "top" },
    measure: { types: ["enum", "fluid", "length"], enum: ["none"], default: "none", note: "caps every line's width" },
    inset: { types: ["length"], default: "0" },
    bg: { types: [...COLOR_VALUE] },
    z: { types: ["integer"], note: "defaults to source order" },
    hide: { types: ["boolean"], default: "false" },
    wrap: { types: ["enum"], enum: ["none", "rect"], default: "none", note: "rect: the frame's box cuts into frames set after it, like an object's (§09.2)" },
    "wrap-offset": { types: ["length"], default: "1bl" },
    ...ROW_SIZING,
    ...REVEAL,
  },
  rules: FRAME_RULES,
  spec: "§09.2",
};

export const STRUCTURE_COMMANDS: readonly CommandSchema[] = [SCENE, PARENT, STORY, FRAME];

/** Re-exported for phase C, which needs to know what may sit at the root. */
export const ROOT_CONTENT: readonly string[] = [...TEXT_EL, ...MARKER, ...OBJECT];
