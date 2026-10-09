/**
 * Story content to blocks (spec §09.1, §10).
 */

import type { Command, Inline, Node } from "@wmxdsl/parser";
import type { Block, ParagraphBlock, ResolvedStyle, Story } from "@wmxdsl/resolved-document";
import type { Value } from "@wmxdsl/schema";
import { schemaDefaults } from "./definitions.js";
import { type RunContext, toRuns } from "./text.js";
import { toLen } from "./units.js";

/** Text elements of spec §10.3 that become paragraph blocks. */
export const TEXT_ELEMENTS = new Set([
  "kicker", "headline", "deck", "byline", "meta", "lede", "subhead", "bio", "caption", "credit", "title", "cite",
]);

/** Objects that may sit in a story and travel with its text (spec §11.3). */
export const OBJECTS = new Set(["figure", "video", "embed", "lottie", "audio", "gallery", "pullquote", "sidebar"]);

export type StoryContext = RunContext & {
  /** Registers an anchored object at a block index and returns its id. */
  object: (c: Command, block: number) => string;
  /** Resolves a token reference inside an element's attribute. */
  deref: (command: string, key: string, v: Value) => Value;
  /** Registers a `\music` cue placed before the block at this index (§10.6). */
  music: (c: Command, block: number) => void;
  /** Used as the default paragraph style of bare prose (spec §09.1 `style`). */
  proseStyle: string;
};

/** Block-level content in source order. Objects arrive with step 2 and throw until then. */
export function storyBlocks(nodes: Node[], ctx: StoryContext): Block[] {
  const out: Block[] = [];
  let dropcap: Command | null = null;
  for (const n of nodes) {
    if (n.kind === "command" && n.name === "dropcap") {
      dropcap = n;
      continue;
    }
    if (n.kind === "command" && n.name === "music") {
      ctx.music(n, out.length);
      continue;
    }
    if (n.kind === "command" && n.name === "framebreak") {
      out.push({ kind: "framebreak", scope: attr(n, "column", ctx)?.t === "boolean" && (attr(n, "column", ctx) as { b: boolean }).b ? "column" : "frame" });
      continue;
    }
    if (n.kind === "command" && OBJECTS.has(n.name)) {
      out.push({ kind: "object", object: ctx.object(n, out.length) });
      continue;
    }
    if (n.kind === "command" && n.name === "rule") {
      out.push({ kind: "rule", rule: rule(n, ctx) });
      continue;
    }
    const element: ParagraphBlock["element"] =
      n.kind === "paragraph" ? "prose" : TEXT_ELEMENTS.has(n.name) ? (n.name as ParagraphBlock["element"]) : notYet(n);
    // §10.3: prose takes the story's style, an element its own name; `\cite` is its container upright.
    const style =
      n.kind === "paragraph" ? ctx.proseStyle : styleAttr(n, ctx) ?? (n.name === "cite" ? `${ctx.proseStyle}+cite` : n.name);
    const inline = n.kind === "paragraph" ? n.runs : (n.body as Inline[]);
    const { runs, links } = toRuns(inline, style, ctx);
    const block: ParagraphBlock = {
      kind: "paragraph",
      element,
      level: element === "subhead" ? subheadLevel(n as Command, ctx) : null,
      quote: null,
      style,
      span: n.kind === "command" && attr(n, "span", ctx) ? "all" : "column",
      indent: { u: "px", n: 0 }, // set per variant (withIndents)
      dropcap: null,
      runs,
      links,
    };
    if (dropcap) {
      block.dropcap = takeCap(block, dropcap, ctx);
      dropcap = null;
    }
    out.push(block);
  }
  return out;
}

/**
 * §10.4: the cap is the first `chars` graphemes of the paragraph, plus any
 * opening quotation mark before them. They leave the runs and live in the
 * drop cap, so the text engine lays out only the rest.
 */
function takeCap(block: ParagraphBlock, marker: Command, ctx: StoryContext): ParagraphBlock["dropcap"] {
  const d = new Map([...schemaDefaults("dropcap"), ...own(marker, ctx)]);
  const lines = num(d.get("lines"));
  const chars = num(d.get("chars"));
  const first = block.runs[0];
  if (first?.kind !== "text") throw new Error(`a drop cap needs text to start its paragraph (line ${marker.source.line})`);
  const text = ctx.strings[first.s]!;
  const graphemes = [...new Intl.Segmenter(ctx.lang, { granularity: "grapheme" }).segment(text)].map((g) => g.segment);
  let take = 0;
  while (take < graphemes.length && /^[“‘"'«„‚]$/.test(graphemes[take]!)) take++;
  // quote=omit leaves an opening quotation mark out of the cap and the text; hang keeps it
  // in the cap, hung outside the column.
  const quote = (d.get("quote") as { id: string }).id;
  const from = quote === "omit" ? take : 0;
  const hang = quote === "hang" && take > 0;
  take += chars;
  const cap = graphemes.slice(from, take).join("").replaceAll("\u00ad", "");
  first.s = ctx.intern(graphemes.slice(take).join(""));
  return { lines, chars, s: ctx.intern(cap), style: "dropcap", hang };
}

function rule(n: Command, ctx: StoryContext): Extract<Block, { kind: "rule" }>["rule"] {
  const a = new Map([...schemaDefaults("rule"), ...own(n, ctx)]);
  const len = (k: string) => toLen(a.get(k)!, { em: null, baseline: null, fluidTo: 0 });
  const c = a.get("color")!;
  return {
    weight: len("weight"),
    color: c.t === "role" ? { role: c.id as "rule" } : { hex: `#${(c as { hex: string }).hex}` },
    width: len("width"),
    align: ((a.get("align") as { id: string }).id ?? "left") as "left",
  };
}

/** §07.6: a paragraph takes its style's indent unless it opens the story or follows anything but prose. */
export function withIndents(story: Story, style: (k: string) => ResolvedStyle): Story {
  const blocks = story.blocks.map((b, i): Block => {
    if (b.kind !== "paragraph") return b;
    const prev = story.blocks[i - 1];
    const applies = !b.dropcap && prev?.kind === "paragraph" && prev.element === "prose";
    return { ...b, indent: applies ? style(b.style).indent : { u: "px", n: 0 } };
  });
  return { ...story, blocks };
}

// ---------------------------------------------------------------------------

/** An element's own base attributes, tokens resolved. Limit: `@bp` overrides on text elements come with per-variant blocks. */
function own(c: Command, ctx: StoryContext): Map<string, Value> {
  if (c.attrs.some((a) => a.at !== null)) notYet(c, "breakpoint overrides on story content");
  return new Map(c.attrs.map((a) => [a.key, ctx.deref(c.name, a.key, a.value)]));
}

const attr = (c: Command, key: string, ctx: StoryContext): Value | undefined => own(c, ctx).get(key);
const styleAttr = (c: Command, ctx: StoryContext): string | null => {
  const v = attr(c, "style", ctx);
  return v?.t === "ident" ? v.id : null;
};
const subheadLevel = (c: Command, ctx: StoryContext): 1 | 2 => {
  const v = attr(c, "level", ctx);
  return v?.t === "integer" && v.n === 2 ? 2 : 1;
};
const num = (v: Value | undefined): number => (v?.t === "integer" || v?.t === "number" ? v.n : NaN);

export function notYet(n: Node, what?: string): never {
  const name = n.kind === "paragraph" ? "paragraph" : `\\${n.name}`;
  throw new Error(`${what ?? name} is not resolved yet (line ${n.source.line})`);
}
