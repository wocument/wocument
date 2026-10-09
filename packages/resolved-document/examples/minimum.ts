/**
 * Example 1: the resolved form of the minimum valid file (spec §18).
 *
 *   ---
 *   wmxdsl: 1
 *   title: A Brief Note
 *   ---
 *   \headline{A Brief Note}
 *
 *   This is the entire article.
 *
 * Implicit form (spec §02.2, a magazine page since 2026-10-07): one page scene
 * `scene-1` on grid `default`; the leading headline in a heading frame
 * `frame-1` over columns 1-8 (all columns on tablet and phone); the rest in a
 * story frame `frame-2` across the grid, its columns following the width
 * (`columns=auto`, at most 600px each; 4 wide). Each frame holds its own anonymous story. Soft hyphens are Liang
 * en-US points with 2/3 minimums; `headline` does not hyphenate (§16).
 */

import type { Frame, ResolvedDocument, Variant } from "../src/resolved-document.js";
import { type Bp, DEFAULT_BREAKPOINTS, DEFAULT_PALETTE, NO_REVEAL, defaultGrid, pick, px, themeStyles } from "./default-theme.js";

const SCENE = "scene-1";
const HEADING = "frame-1";
const STORY = "frame-2";

function variant(bp: Bp): Variant {
  const grid = defaultGrid(bp);
  const all = { from: 1, to: grid.cols };
  const frame = (id: string, cols: Frame["cols"], columns: Frame["columns"], z: number, measure: Frame["measure"] = null): Frame => ({
    id,
    scene: SCENE,
    story: `${id}#text`,
    cols,
    vertical: { mode: "flow", top: "auto", height: "auto" },
    columns,
    columnGap: grid.gutter,
    balance: true,
    columnRule: "none",
    valign: "top",
    measure,
    inset: px(0),
    bg: null,
    z, // source order (§09.2)
    hidden: false,
    wrap: null,
    reveal: NO_REVEAL,
  });
  const para = (element: "headline" | "prose", style: string, s: number) => ({
    kind: "paragraph" as const,
    element,
    level: null,
    quote: null,
    style,
    span: "column" as const,
    indent: px(0),
    dropcap: null,
    runs: [{ kind: "text" as const, s, style, marks: [], link: null }],
    links: [],
  });
  const story = (id: string, blocks: ReturnType<typeof para>[]) => ({ id: `${id}#text`, origin: "frame" as const, owner: id, overset: "grow" as const, blocks });
  return {
    name: bp,
    styles: pick(themeStyles(bp), ["headline", "body"]),
    stories: {
      [`${HEADING}#text`]: story(HEADING, [para("headline", "headline", 0)]),
      [`${STORY}#text`]: story(STORY, [para("prose", "body", 1)]),
    },
    scenes: [
      {
        id: SCENE,
        parent: null,
        grid,
        palette: DEFAULT_PALETTE,
        height: "page",
        snap: "none", // a page scene's default since 2026-10-09 (§08.3)
        turn: null,
        bg: { role: "paper" },
        linearized: false,
        folio: null,
        children: [
          { kind: "frame", id: HEADING },
          { kind: "frame", id: STORY },
        ],
      },
    ],
    frames: {
      [HEADING]: frame(HEADING, bp === "base" || bp === "wide" || bp === "compact" ? { from: 1, to: 8 } : all, 1, 0),
      // as many columns as keep each within 600px; 4 on wide screens; 1 on a tablet.
      [STORY]: frame(STORY, all, bp === "wide" ? 4 : bp === "tablet" ? 1 : "auto", 1, px(600)),
    },
    objects: {},
    threads: { [`${HEADING}#text`]: [HEADING], [`${STORY}#text`]: [STORY] },
  };
}

const doc: ResolvedDocument = {
  format: "wmxdsl-resolved",
  version: 1,
  meta: {
    wmxdsl: 1,
    title: "A Brief Note",
    lang: "en",
    description: null,
    authors: [],
    date: null,
    section: null,
    socialImage: null,
    theme: null,
  },
  breakpoints: DEFAULT_BREAKPOINTS,
  fonts: [],
  // The headline binds its short words: "A" stays with "Brief".
  strings: ["A\u00a0Brief Note", "This is the en\u00adtire ar\u00adti\u00adcle."],
  assets: {},
  variants: { base: variant("base"), wide: variant("wide"), compact: variant("compact"), tablet: variant("tablet"), phone: variant("phone") },
  music: [],
  diagnostics: [],
};

export default doc;
