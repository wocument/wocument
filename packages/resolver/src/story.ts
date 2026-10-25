/**
 * Story content to blocks (spec §09.1, §10).
 */

import type { Command, Inline, Node } from "@wocument/parser";
import type { Block, ParagraphBlock, ResolvedStyle, Story } from "@wocument/resolved-document";
import type { Value } from "@wocument/schema";
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
  /** The variant being built: an element's `key@at=` values replace its base ones (§06.3). */
  at: string;
};

/** Block-level content in source order. Objects arrive with step 2 and throw until then. */
export function storyBlocks(nodes: Node[], ctx: StoryContext): Block[] {
  const out: Block[] = [];
  let dropcap: Command | null = null;
  /** §10.3: a block quote's paragraphs and \cite share a number, counted from 1 in the story. */
  let quotes = 0;
  for (const n of nodes) {
    if (n.kind === "command" && n.name === "blockquote") {
      const quote = ++quotes;
      const style = styleAttr(n, ctx) ?? "blockquote";
      for (const child of (n.body as Node[] | null) ?? []) {
        const cite = child.kind === "command" && child.name === "cite";
        const inline = child.kind === "paragraph" ? child.runs : (child.body as Inline[]);
        const own = cite ? styleAttr(child as Command, ctx) : null;
        const { runs, links } = toRuns(inline, own ?? (cite ? `${style}+cite` : style), ctx);
        out.push({ ...paragraph(cite ? "cite" : "prose", own ?? (cite ? `${style}+cite` : style), runs, links), quote });
      }
      continue;
    }
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
      ...paragraph(element, style, runs, links),
      level: element === "subhead" ? subheadLevel(n as Command, ctx) : null,
      span: n.kind === "command" && attr(n, "span", ctx) ? "all" : "column",
    };
    if (dropcap) {
      block.dropcap = takeCap(block, dropcap, ctx);
      dropcap = null;
    }
    out.push(block);
  }
  return out;
}

/** A paragraph block with nothing set but its element, style and text. */
function paragraph(element: ParagraphBlock["element"], style: string, runs: ParagraphBlock["runs"], links: ParagraphBlock["links"]): ParagraphBlock {
  return { kind: "paragraph", element, level: null, quote: null, style, span: "column", indent: { u: "px", n: 0 }, dropcap: null, runs, links };
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

/** §07.6: a paragraph takes its style's indent unless it opens the story, follows anything but prose, starts or ends a block quote, or is a `\cite`. */
export function withIndents(story: Story, style: (k: string) => ResolvedStyle): Story {
  const blocks = story.blocks.map((b, i): Block => {
    if (b.kind !== "paragraph") return b;
    const prev = story.blocks[i - 1];
    // Not across a block quote's edge: its first paragraph, and the one after it, start flush.
    const applies = !b.dropcap && b.element !== "cite" && prev?.kind === "paragraph" && prev.element === "prose" && prev.quote === b.quote;
    return { ...b, indent: applies ? style(b.style).indent : { u: "px", n: 0 } };
  });
  return { ...story, blocks };
}

// ---------------------------------------------------------------------------

/** An element's own attributes in the variant being built (base, then `@at` values), tokens resolved. */
function own(c: Command, ctx: StoryContext): Map<string, Value> {
  const out = new Map<string, Value>();
  for (const a of c.attrs) if (a.at === null) out.set(a.key, a.value);
  for (const a of c.attrs) if (a.at === ctx.at) out.set(a.key, a.value);
  for (const [k, v] of out) out.set(k, ctx.deref(c.name, k, v));
  return out;
}

/** Whether any element in these nodes, or in their inline text, has a `key@breakpoint=` value. */
export function hasOverrides(x: unknown): boolean {
  if (Array.isArray(x)) return x.some(hasOverrides);
  if (!x || typeof x !== "object") return false;
  const attrs = (x as { attrs?: unknown }).attrs;
  if (Array.isArray(attrs) && attrs.some((a: { at: string | null }) => a.at !== null)) return true;
  return Object.values(x).some(hasOverrides);
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
