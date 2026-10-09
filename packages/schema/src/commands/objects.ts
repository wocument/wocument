/** Objects and media -- spec §11. */

import type { CommandSchema, CrossFieldRule } from "../types.js";
import { CAPTION_SIDE, COLOR_VALUE, OBJECT_BASE, SHAPE, STAGGER } from "./groups.js";
import { OBJECT, PARAGRAPH_CHILD } from "./sets.js";

const obj = (
  name: string,
  spec: string,
  arity: CommandSchema["arity"],
  kind: CommandSchema["kind"],
  children: readonly string[],
  maxOnce: readonly string[],
  attrs: CommandSchema["attrs"],
  rules: readonly CrossFieldRule[] = [],
): CommandSchema => ({ name, class: "block", arity, kind, children, maxOnce, attrs, rules, spec });

const MEDIA_CHILDREN = ["caption", "credit"] as const;

export const FIGURE = obj(
  "figure",
  "§11.4",
  "optional",
  "struct",
  MEDIA_CHILDREN,
  MEDIA_CHILDREN,
  {
    ...OBJECT_BASE,
    ...SHAPE,
    ...CAPTION_SIDE,
    src: { types: ["path"], required: true, note: "give the highest resolution available" },
    alt: { types: ["string"], note: "missing alt is a resolve warning; alt=\"\" is decorative" },
    ratio: { types: ["ratio"], default: "auto" },
    fit: { types: ["enum"], enum: ["cover", "contain", "fill", "none"], default: "cover" },
    focus: { types: ["pair"], pairOf: "percentage", default: '"50% 50%"' },
    loading: { types: ["enum"], enum: ["lazy", "eager"], default: "lazy" },
  },
);

export const VIDEO = obj(
  "video",
  "§11.5",
  "optional",
  "struct",
  MEDIA_CHILDREN,
  MEDIA_CHILDREN,
  {
    ...OBJECT_BASE,
    ...SHAPE,
    ...CAPTION_SIDE,
    src: { types: ["path"], required: true },
    poster: { types: ["path"], note: "missing poster on a non-background video is a warning" },
    alt: { types: ["string"] },
    captions: { types: ["path"], note: ".vtt" },
    play: { types: ["enum"], enum: ["manual", "visible", "auto"], default: "manual" },
    loop: { types: ["boolean"], default: "false" },
    muted: { types: ["boolean"], default: "false" },
    controls: { types: ["boolean"], default: "true", note: "defaults to false when layer=background" },
    ratio: { types: ["ratio"], default: "auto" },
    fit: { types: ["enum"], enum: ["cover", "contain", "fill", "none"], default: "cover" },
    focus: { types: ["pair"], pairOf: "percentage", default: '"50% 50%"' },
  },
);

/** Embeds are always rectangular: `shape` and `clip` are not accepted (spec §11.6). */
const EMBED_RULES: readonly CrossFieldRule[] = [
  {
    code: "P016",
    describe: "provider=youtube|vimeo requires id; provider=iframe requires url",
    check: ({ keys, enumValue }) => {
      const provider = enumValue("provider");
      if (provider === "youtube" || provider === "vimeo") {
        return keys.has("id") ? null : { key: "id", message: `provider=${provider} requires \`id\`.` };
      }
      if (provider === "iframe") {
        return keys.has("url") ? null : { key: "url", message: "provider=iframe requires `url`." };
      }
      return null;
    },
  },
];

export const EMBED = obj(
  "embed",
  "§11.6",
  "optional",
  "struct",
  MEDIA_CHILDREN,
  MEDIA_CHILDREN,
  {
    ...OBJECT_BASE,
    ...CAPTION_SIDE,
    provider: { types: ["enum"], enum: ["youtube", "vimeo", "iframe"], required: true, responsive: false },
    id: { types: ["string"], note: "for youtube and vimeo" },
    url: { types: ["path"], note: "for iframe" },
    title: { types: ["string"], note: "accessible name; missing is a warning" },
    ratio: { types: ["ratio"], default: "16:9" },
    poster: { types: ["path"], note: "defaults to the provider thumbnail" },
    facade: { types: ["boolean"], default: "true" },
  },
  EMBED_RULES,
);

export const LOTTIE = obj(
  "lottie",
  "§11.7",
  "optional",
  "struct",
  MEDIA_CHILDREN,
  MEDIA_CHILDREN,
  {
    ...OBJECT_BASE,
    ...SHAPE,
    ...CAPTION_SIDE,
    src: { types: ["path"], required: true, note: ".json or .lottie" },
    alt: { types: ["string"] },
    play: { types: ["enum"], enum: ["manual", "visible", "auto"], default: "visible" },
    loop: { types: ["boolean"], default: "true" },
    ratio: { types: ["ratio"], note: "defaults to the ratio in the file" },
  },
);

export const AUDIO = obj(
  "audio",
  "§11.8",
  "optional",
  "struct",
  MEDIA_CHILDREN,
  MEDIA_CHILDREN,
  {
    ...OBJECT_BASE,
    src: { types: ["path"], required: true },
    title: { types: ["string"], note: "missing is a warning" },
    captions: { types: ["path"] },
    transcript: { types: ["path"] },
  },
);

export const GALLERY = obj(
  "gallery",
  "§11.9",
  "required",
  "struct",
  ["figure", "video", "caption", "credit"],
  ["caption", "credit"],
  {
    ...OBJECT_BASE,
    ...CAPTION_SIDE,
    layout: { types: ["enum"], enum: ["grid", "strip"], default: "grid" },
    "per-row": { types: ["integer"], default: "3", note: "grid layout only" },
    gap: { types: ["length"], note: "defaults to the grid's gutter" },
    ratio: { types: ["ratio"], default: "auto", note: "forced on every child when set" },
  },
);

export const PULLQUOTE = obj(
  "pullquote",
  "§11.10",
  "required",
  "block",
  [PARAGRAPH_CHILD, "cite"],
  ["cite"],
  { ...OBJECT_BASE, style: { types: ["ident"] } },
);

export const SIDEBAR = obj(
  "sidebar",
  "§11.10",
  "required",
  "block",
  [PARAGRAPH_CHILD, "title", "figure"],
  ["title"],
  {
    ...OBJECT_BASE,
    style: { types: ["ident"] },
    bg: { types: [...COLOR_VALUE] },
    inset: { types: ["length"], default: "0" },
    border: { types: ["enum"], enum: ["none", "rule"], default: "none" },
    portrait: { types: ["boolean"], default: "false", note: "the widest box, up to its slot, that stays taller than wide" },
  },
);

export const GROUP: CommandSchema = {
  name: "group",
  class: "block",
  arity: "required",
  kind: "struct",
  // Groups nest, as Figma auto layout frames do: a stack inside a row keeps a photo with its headline.
  children: ["frame", "rule", ...OBJECT, "group"],
  maxOnce: [],
  attrs: {
    ...OBJECT_BASE,
    ...STAGGER,
    layout: { types: ["enum"], enum: ["stack", "row"], default: "stack", note: "row: children pack into rows that wrap (design 2026-09-26)" },
    gap: { types: ["length"], default: "1bl", note: "between children in a stack, between rows in a row group" },
    valign: { types: ["enum"], enum: ["top", "center", "bottom", "stretch", "text"], default: "top", note: "row groups: how a child shorter than its row sits in it; text: the row is as tall as its text, media cropped to it" },
  },
  rules: [],
  spec: "§11.11",
};

export const OBJECT_COMMANDS: readonly CommandSchema[] = [
  FIGURE, VIDEO, EMBED, LOTTIE, AUDIO, GALLERY, PULLQUOTE, SIDEBAR, GROUP,
];
