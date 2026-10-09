/**
 * Example 2: the resolved form of "Stone & Strategy" (spec §18), all three
 * variants in full.
 *
 * Hand-resolved. Two simplifications, both
 * marked: soft hyphens are omitted from body text (the resolver's pass would
 * insert them), and asset dimensions and generated widths are illustrative,
 * since the files do not exist.
 *
 * Source line numbers in `diagnostics` count from the `---` fence as line 1.
 *
 * What resolving it exposed, all since ruled and folded into the spec:
 *   - `breath` LINEARIZES ON TABLET. Its frame is `cols=3-10` with only a
 *     `cols@phone` override, and tablet's feature grid has 8 columns (W031).
 *   - The sidebar's `cols=9-12` does not fit tablet either. It is hidden there,
 *     and hidden elements do not trigger linearize.
 *   - The contour figure is anchored, so its scene is not known when resolving.
 *     It linearizes by itself on phone; no scene does.
 *   - `\title` and `\endmark` had no default style in §16.
 */

import type { Block, FigureObject, Frame, ObjectElement, ResolvedDocument, ResolvedStyle, Scene, Story, Variant } from "../src/resolved-document.js";
import { type Bp, DEFAULT_BREAKPOINTS, DEFAULT_PALETTE, NO_REVEAL, bl, fluid, pct, pick, px, themeStyles } from "./default-theme.js";

// ---------------------------------------------------------------------------
// strings: every piece of text once
// ---------------------------------------------------------------------------

const S = {
  cap: 0,
  p1: 1,
  p2: 2,
  pq1: 3,
  subhead: 4,
  p3: 5,
  caption: 6,
  credit: 7,
  p4: 8,
  endmark: 9,
  kicker: 10,
  hl1: 11,
  hl2: 12,
  deck: 13,
  byline: 14,
  meta: 15,
  title: 16,
  side1: 17,
  side2: 18,
  pq2: 19,
  bio: 20,
  folio: 21,
} as const;

const strings = [
  "S",
  "tone endures where nearly everything else decays. Long after the commanders who ordered their construction have been forgotten, the great fortifications of medieval Europe continue to impose their presence on the landscapes they were built to dominate.",
  "The history of European fortification is a history of problem and response.",
  "Stone remembers even when the stone-cutter does not.",
  "Landscape as defence",
  "What the builders understood above all was the relationship between landscape and defence. The most formidable fortifications were never merely strong in themselves.",
  "The keep at Carcassonne, restored in 1853 by Viollet-le-Duc.",
  "Jean-Pierre Dalbéra / CC BY 2.0",
  "By the fourteenth century the logic had inverted. Walls grew lower and thicker as artillery made height a liability. ",
  "■",
  "Essay · Heritage",
  "Stone",
  "& Strategy",
  "How the great fortifications of medieval Europe shaped a continent.",
  "Dr. Helena Müller",
  "June 2026 · 11 min read",
  "By the numbers",
  "1,200+ surviving castles in France alone.",
  "150 years: average construction time.",
  "The wall was never the defence. The valley was.",
  "Dr. Helena Müller teaches architectural history at Heidelberg.",
  "Architecture Today · Heritage",
];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function styles(bp: Bp): Record<string, ResolvedStyle> {
  const t = themeStyles(bp);
  const all: Record<string, ResolvedStyle> = {
    ...t,
    // \style[name=body, family="Tiempos Text, serif", features="liga kern onum"],
    // layered over the theme's body for this breakpoint.
    body: { ...t.body!, family: ["Tiempos Text", "serif"], features: ["liga", "kern", "onum"] },
    // extends=headline, family, size=fluid(44px, 104px), tracking=-0.02em;
    // leading 1.06em (the built-in headline's) rescaled against the new size.
    // fluid() runs to the default grid's max at this breakpoint: 1760px on wide.
    "headline-xl": {
      ...t.headline!,
      family: ["Tiempos Headline", "serif"],
      size: fluid(44, 104, bp === "wide" ? 1760 : 1440),
      leading: fluid(46.64, 110.24, bp === "wide" ? 1760 : 1440),
      tracking: fluid(-0.88, -2.08, bp === "wide" ? 1760 : 1440),
    },
    // `title` is the sidebar style at weight 700; the theme also sets it unhyphenated.
    title: { ...t.sidebar!, weight: 700, hyphenate: false },
    // the end mark is its paragraph's style in the accent color, so its key is composed.
    "body+endmark": { ...t.body!, family: ["Tiempos Text", "serif"], features: ["liga", "kern", "onum"], color: { role: "accent" } },
  };
  return pick(all, [
    "body",
    "dropcap",
    "pullquote",
    "subhead",
    "body+endmark",
    "caption",
    "credit",
    "kicker",
    "headline-xl",
    "deck",
    "byline",
    "meta",
    "title",
    "sidebar",
    "bio",
    "folio",
  ]);
}

// ---------------------------------------------------------------------------
// Stories (identical in every variant: bodies never vary by breakpoint)
// ---------------------------------------------------------------------------

type P = Extract<Block, { kind: "paragraph" }>;
const para = (element: P["element"], style: string, s: number, over: Partial<P> = {}): P => ({
  kind: "paragraph",
  element,
  level: null,
  quote: null,
  style,
  span: "column",
  indent: px(0),
  dropcap: null,
  runs: [{ kind: "text", s, style, marks: [], link: null }],
  links: [],
  ...over,
});

const story = (id: string, origin: Story["origin"], owner: string | null, blocks: Block[]): Story => ({
  id,
  origin,
  owner,
  overset: "grow",
  blocks,
});

/** Stories per breakpoint: only the body's first-line indent (2em of its size) varies (§07.6). */
const stories = (bp: Bp): Record<string, Story> => ({
  main: story("main", "named", null, [
    para("prose", "body", S.p1, { dropcap: { lines: 3, chars: 1, s: S.cap, style: "dropcap", hang: false } }),
    // Prose after prose: indented. After a subhead or an object it is not (§07.6).
    para("prose", "body", S.p2, { indent: px(2 * { base: 21, wide: 21, compact: 20, tablet: 19, phone: 18 }[bp]) }),
    { kind: "object", object: "pullquote-1" },
    para("subhead", "subhead", S.subhead, { level: 1 }),
    para("prose", "body", S.p3),
    { kind: "framebreak", scope: "frame" },
    { kind: "object", object: "figure-1" },
    para("prose", "body", S.p4, {
      runs: [
        { kind: "text", s: S.p4, style: "body", marks: [], link: null },
        { kind: "endmark", s: S.endmark, style: "body+endmark" },
      ],
    }),
  ]),
  "pullquote-1#text": story("pullquote-1#text", "pullquote", "pullquote-1", [para("prose", "pullquote", S.pq1)]),
  "figure-1#caption": story("figure-1#caption", "caption", "figure-1", [
    para("caption", "caption", S.caption),
    para("credit", "credit", S.credit),
  ]),
  "frame-1#text": story("frame-1#text", "frame", "frame-1", [
    para("kicker", "kicker", S.kicker),
    para("headline", "headline-xl", S.hl1, {
      runs: [
        { kind: "text", s: S.hl1, style: "headline-xl", marks: [], link: null },
        { kind: "break" },
        { kind: "text", s: S.hl2, style: "headline-xl", marks: [], link: null },
      ],
    }),
    para("deck", "deck", S.deck),
    para("byline", "byline", S.byline),
    para("meta", "meta", S.meta),
  ]),
  "sidebar-1#text": story("sidebar-1#text", "sidebar", "sidebar-1", [
    para("title", "title", S.title),
    para("prose", "sidebar", S.side1),
    para("prose", "sidebar", S.side2),
  ]),
  "frame-3#text": story("frame-3#text", "frame", "frame-3", [{ kind: "object", object: "pullquote-2" }]),
  "pullquote-2#text": story("pullquote-2#text", "pullquote", "pullquote-2", [para("prose", "pullquote", S.pq2)]),
  "frame-5#text": story("frame-5#text", "frame", "frame-5", [
    { kind: "rule", rule: { weight: px(1), color: { role: "rule" }, width: pct(100), align: "left" } },
    para("bio", "bio", S.bio),
  ]),
  "folio#text": story("folio#text", "folio", null, [para("prose", "folio", S.folio)]),
});

// ---------------------------------------------------------------------------
// Grid `feature`, palettes
// ---------------------------------------------------------------------------

/** an `at=` grid is layered over the same grid's base definition, so `max` and `rows` carry over. */
function feature(bp: Bp): Scene["grid"] {
  const [cols, gutter, marginX, baseline, from, to] = (
    // `feature` has no wide or compact definition, so both are its base.
    { base: [12, 24, 64, 28, 4, 9], wide: [12, 24, 64, 28, 4, 9], compact: [12, 24, 64, 28, 4, 9], tablet: [8, 20, 40, 27, 2, 7], phone: [4, 16, 20, 26, 1, 4] } as const
  )[bp];
  return {
    name: "feature",
    cols,
    gutter: px(gutter),
    marginX: px(marginX),
    marginY: px(4 * baseline),
    max: px(1440),
    baseline,
    rows: 6,
    rowGap: px(gutter),
    body: { from, to },
    outdent: px(0),
  };
}

// \token[name=ember, value=#e0563a] resolved into the palette.
const NIGHT = { paper: "#0d0d0fff", ink: "#f2efe9ff", muted: "#9a968eff", accent: "#e0563aff", rule: "#2a2a2eff" };

const reveal = (enter: "fade" | "rise", delayMs = 0) => ({ ...NO_REVEAL, enter, delayMs });

// ---------------------------------------------------------------------------
// One variant
// ---------------------------------------------------------------------------

function variant(bp: Bp): Variant {
  const g = feature(bp);
  const all = { from: 1, to: g.cols };
  const flowAuto = { mode: "flow", top: "auto", height: "auto" } as const;
  const breathLinearized = bp === "tablet"; // cols=3-10 does not fit 8 columns (W031)
  const wideOrBase = bp === "base" || bp === "wide" || bp === "compact"; // no @wide or @compact overrides: both take base values
  const figureLinearized = bp === "phone"; // cols=7-12 does not fit 4 columns

  const frame = (id: string, scene: string, storyId: string, z: number, over: Partial<Frame>): Frame => ({
    id,
    scene,
    story: storyId,
    cols: all,
    vertical: flowAuto,
    columns: 1,
    columnGap: g.gutter,
    balance: true,
    columnRule: "none",
    valign: "top",
    measure: null,
    inset: px(0),
    bg: null,
    z,
    hidden: false,
    wrap: null,
    reveal: NO_REVEAL,
    ...over,
  });

  const frames: Record<string, Frame> = {
    // opener: \frame[cols=1-8, rows=4-6, cols@tablet=1-7, cols@phone=all, valign=bottom, enter=rise]
    "frame-1": frame("frame-1", "opener", "frame-1#text", 1, {
      cols: { base: { from: 1, to: 8 }, wide: { from: 1, to: 8 }, compact: { from: 1, to: 8 }, tablet: { from: 1, to: 7 }, phone: all }[bp],
      vertical: { mode: "rows", rows: { from: 4, to: 6 } },
      valign: "bottom",
      reveal: reveal("rise"), // has its own enter, so the scene's stagger does not apply
    }),
    // part-one: \frame[story=main, cols=1-8, columns=2, cols@tablet=all, cols@phone=all, columns@phone=1]
    "frame-2": frame("frame-2", "part-one", "main", 0, {
      cols: wideOrBase ? { from: 1, to: 8 } : all,
      columns: bp === "phone" ? 1 : 2,
    }),
    // breath: \frame[cols=3-10, rows=3-4, cols@phone=all]; the parent's enter=fade, stagger 80ms default
    "frame-3": frame("frame-3", "breath", "frame-3#text", 1, {
      cols: wideOrBase ? { from: 3, to: 10 } : all,
      // a linearized screen scene stacks its elements as flow.
      vertical: breathLinearized ? flowAuto : { mode: "rows", rows: { from: 3, to: 4 } },
      reveal: reveal("fade", 80),
    }),
    // part-two: \frame[story=main, cols=1-10, cols@tablet=all, cols@phone=all]
    "frame-4": frame("frame-4", "part-two", "main", 0, { cols: wideOrBase ? { from: 1, to: 10 } : all }),
    // part-two: \frame[cols=1-6, cols@phone=all]
    "frame-5": frame("frame-5", "part-two", "frame-5#text", 1, { cols: bp === "phone" ? all : { from: 1, to: 6 } }),
  };

  const common = {
    z: 0,
    bleed: "none",
    maxWidth: null,
    offsetX: px(0),
    offsetY: px(0),
    wrap: { mode: "none" },
    reveal: NO_REVEAL,
    hidden: false,
    layer: "content",
  } as const;

  const figure1: FigureObject = {
    ...common,
    id: "figure-1",
    kind: "figure",
    placement: {
      mode: "anchored",
      story: "main",
      block: 6,
      horizontal: figureLinearized ? { mode: "full" } : { mode: "cols", cols: bp === "tablet" ? { from: 5, to: 8 } : { from: 7, to: 12 } },
      height: "auto",
    },
    wrap: figureLinearized ? { mode: "jump", offset: px(16) } : { mode: "contour", side: "left", offset: px(16) },
    reveal: reveal("fade"),
    image: "img:keep-cutout",
    motionVideo: null,
    alt: "The keep at Carcassonne, cut out against white",
    media: {
      ratio: { w: 3, h: 4 },
      fit: "cover",
      focus: { x: 0.5, y: 0.5 },
      shape: { kind: "polygon", polygon: "poly:keep-cutout", source: "alpha" },
      clip: false,
    },
    loading: "lazy",
    caption: { story: "figure-1#caption", side: "below" },
  };

  const objects: Record<string, ObjectElement> = {
    // \pullquote[side=right, width=50%, wrap=rect, wrap-offset=1bl, enter=rise]
    "pullquote-1": {
      ...common,
      id: "pullquote-1",
      kind: "pullquote",
      placement: { mode: "anchored", story: "main", block: 2, horizontal: { mode: "side", side: "right", width: pct(50) }, height: "auto" },
      wrap: { mode: "rect", side: "largest", offset: bl(1) },
      reveal: reveal("rise"),
      story: "pullquote-1#text",
    },
    "figure-1": figure1,
    // opener: \video[..., layer=background, fit=cover, focus="50% 70%", play=visible, loop, muted]
    "video-1": {
      ...common,
      id: "video-1",
      kind: "video",
      layer: "background",
      placement: { mode: "background", scene: "opener" },
      video: "video:ramparts",
      poster: "img:ramparts",
      alt: "",
      captions: null,
      play: "visible",
      loop: true,
      muted: true,
      controls: false,
      media: { ratio: { w: 16, h: 9 }, fit: "cover", focus: { x: 0.5, y: 0.7 }, shape: { kind: "rect" }, clip: false },
      caption: null,
    },
    // part-one: \sidebar[cols=9-12, top=0, bg=rule, inset=1bl, hide@tablet, hide@phone, enter=fade]
    "sidebar-1": {
      ...common,
      id: "sidebar-1",
      kind: "sidebar",
      z: 1,
      // Hidden on tablet and phone, so written as authored even though 9-12 does not fit there.
      placement: { mode: "grid", scene: "part-one", cols: { from: 9, to: 12 }, vertical: { mode: "flow", top: px(0), height: "auto" } },
      reveal: reveal("fade"),
      hidden: !wideOrBase,
      story: "sidebar-1#text",
      bg: { role: "rule" },
      inset: bl(1),
      border: "none",
      portrait: false,
    },
    // breath: \figure[src=/img/valley.jpg, ..., layer=background, focus="30% 60%", src@phone=/img/valley-portrait.jpg]
    "figure-2": {
      ...common,
      id: "figure-2",
      kind: "figure",
      layer: "background",
      placement: { mode: "background", scene: "breath" },
      reveal: reveal("fade", 0),
      image: bp === "phone" ? "img:valley-portrait" : "img:valley",
      motionVideo: null,
      alt: "Fog over the Aude valley at dawn",
      media: {
        ratio: bp === "phone" ? { w: 2, h: 3 } : { w: 3, h: 2 },
        fit: "cover",
        focus: { x: 0.3, y: 0.6 },
        shape: { kind: "rect" },
        clip: false,
      },
      loading: "lazy",
      caption: null,
    },
    // breath frame: \pullquote{...}, anchored, side=full by default, so wrap defaults to jump
    "pullquote-2": {
      ...common,
      id: "pullquote-2",
      kind: "pullquote",
      placement: { mode: "anchored", story: "frame-3#text", block: 0, horizontal: { mode: "full" }, height: "auto" },
      wrap: { mode: "jump", offset: bl(1) },
      story: "pullquote-2#text",
    },
  };

  const scene = (id: string, over: Partial<Scene>): Scene => ({
    id,
    parent: null,
    grid: g,
    palette: DEFAULT_PALETTE,
    height: "flow",
    snap: "none",
    turn: null,
    bg: { role: "paper" },
    linearized: false,
    folio: { story: "folio#text", position: "top-left", progress: true },
    children: [],
    ...over,
  });

  const scenes: Scene[] = [
    scene("opener", {
      palette: NIGHT,
      height: "screen",
      snap: "hard",
      turn: null,
      children: [
        { kind: "object", id: "video-1" },
        { kind: "frame", id: "frame-1" },
      ],
    }),
    scene("part-one", {
      children: [
        { kind: "frame", id: "frame-2" },
        { kind: "object", id: "sidebar-1" },
      ],
    }),
    scene("breath", {
      parent: "interlude",
      palette: NIGHT,
      height: "screen",
      snap: "hard",
      turn: null,
      linearized: breathLinearized,
      children: [
        { kind: "object", id: "figure-2" },
        { kind: "frame", id: "frame-3" },
      ],
    }),
    scene("part-two", {
      children: [
        { kind: "frame", id: "frame-4" },
        { kind: "frame", id: "frame-5" },
      ],
    }),
  ];

  return {
    name: bp,
    styles: styles(bp),
    stories: stories(bp),
    scenes,
    frames,
    objects,
    threads: {
      main: ["frame-2", "frame-4"],
      "frame-1#text": ["frame-1"],
      "frame-3#text": ["frame-3"],
      "frame-5#text": ["frame-5"],
    },
  };
}

// ---------------------------------------------------------------------------
// Assets (dimensions and generated widths illustrative)
// ---------------------------------------------------------------------------

const imageSet = (name: string, w: number, h: number, fallbackExt: string, alpha = false) => ({
  kind: "image" as const,
  width: w,
  height: h,
  animated: false,
  sources: [
    { type: "image/avif", srcset: [800, 1600].map((width) => ({ url: `/_wmx/${name}-${width}.avif`, width })) },
    { type: "image/webp", srcset: [800, 1600].map((width) => ({ url: `/_wmx/${name}-${width}.webp`, width })) },
  ],
  fallback: `/_wmx/${name}-1600.${alpha ? "png" : fallbackExt}`,
});

const doc: ResolvedDocument = {
  format: "wmxdsl-resolved",
  version: 1,
  meta: {
    wmxdsl: 1,
    title: "Stone & Strategy",
    lang: "en",
    description: null,
    authors: [],
    date: null,
    section: null,
    socialImage: null,
    theme: null,
  },
  breakpoints: DEFAULT_BREAKPOINTS,
  fonts: [
    { family: "Tiempos Text", src: "/fonts/tiempos-text.woff2", weight: { min: 400, max: 400 }, italic: false },
    { family: "Tiempos Text", src: "/fonts/tiempos-text-italic.woff2", weight: { min: 400, max: 400 }, italic: true },
    { family: "Tiempos Headline", src: "/fonts/tiempos-headline.woff2", weight: { min: 700, max: 700 }, italic: false },
  ],
  strings,
  assets: {
    "video:ramparts": { kind: "video", width: 1920, height: 1080, sources: [{ type: "video/mp4", url: "/video/ramparts.mp4" }] },
    "img:ramparts": imageSet("ramparts", 1920, 1080, "jpg"),
    "img:keep-cutout": imageSet("keep-cutout", 1200, 1600, "png", true),
    // Traced from the alpha channel at 50% (alpha-threshold default), simplified. Illustrative.
    "poly:keep-cutout": {
      kind: "polygon",
      points: [
        [0.38, 0.02], [0.62, 0.02], [0.64, 0.18], [0.72, 0.2], [0.74, 0.46], [0.9, 0.5],
        [0.94, 0.98], [0.06, 0.98], [0.1, 0.5], [0.26, 0.46], [0.28, 0.2], [0.36, 0.18],
      ],
    },
    "img:valley": imageSet("valley", 3000, 2000, "jpg"),
    "img:valley-portrait": imageSet("valley-portrait", 1600, 2400, "jpg"),
  },
  variants: { base: variant("base"), wide: variant("wide"), compact: variant("compact"), tablet: variant("tablet"), phone: variant("phone") },
  music: [],
  diagnostics: [
    {
      code: "W031",
      category: "resolve-warning",
      message: 'Scene "breath" will linearize on tablet: frame-3 cols=3-10 does not fit the 8-column grid.',
      file: "stone-and-strategy.wmx",
      line: 88,
      column: 3,
      fix: "Add cols@tablet=... or linearize@tablet=true.",
      variant: "tablet",
    },
    {
      code: "W031",
      category: "resolve-warning",
      message: 'Anchored figure-1 will linearize on phone: cols=7-12 does not fit the 4-column grid.',
      file: "stone-and-strategy.wmx",
      line: 49,
      column: 3,
      fix: "Add cols@phone=... to the figure.",
      variant: "phone",
    },
  ],
};

export default doc;
