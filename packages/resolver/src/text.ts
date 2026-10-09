/**
 * Inline content to flat runs (spec §10.2).
 *
 * Each run carries a composed style key (what the engine measures with) and
 * semantic marks and a link index (what the renderer emits). Quotes are curled
 * per `lang` across the whole paragraph, never inside code; soft hyphens go
 * into runs whose style hyphenates in at least one variant.
 */

import type { Command, Inline } from "@wmxdsl/parser";
import type { Link, Run } from "@wmxdsl/resolved-document";
import enUs from "hyphen/en-us/index.js";

type Mark = "strong" | "em" | "code";

/** One piece of paragraph text before it becomes a run. */
type Piece =
  | { kind: "text"; text: string; escaped: Set<number>; marks: Mark[]; link: number | null; spans: string[]; code: boolean }
  | { kind: "break" }
  | { kind: "endmark"; glyph: string };

/** Flattens an inline tree, tracking the marks, link and spans in force. */
function pieces(runs: Inline[], links: Link[], attr: (c: Command, key: string) => string | null): Piece[] {
  const out: Piece[] = [];
  const walk = (items: Inline[], marks: Mark[], link: number | null, spans: string[]): void => {
    for (const r of items) {
      switch (r.type) {
        case "text":
          out.push({ kind: "text", text: r.value, escaped: new Set(r.escapedQuotes ?? []), marks, link, spans, code: false });
          break;
        case "bold":
          walk(r.runs, [...marks, "strong"], link, spans);
          break;
        case "italic":
          walk(r.runs, [...marks, "em"], link, spans);
          break;
        case "code":
          out.push({ kind: "text", text: r.value, escaped: new Set(), marks: [...marks, "code"], link, spans, code: true });
          break;
        case "link":
          walk(r.runs, marks, links.push({ href: r.href }) - 1, spans);
          break;
        case "command":
          if (r.node.name === "br") out.push({ kind: "break" });
          else if (r.node.name === "endmark") out.push({ kind: "endmark", glyph: attr(r.node, "glyph") ?? "■" });
          else if (r.node.name === "span") walk(r.node.body as Inline[], marks, link, [...spans, attr(r.node, "style")!]);
          else throw new Error(`inline \\${r.node.name} is not resolved yet`);
          break;
      }
    }
  };
  walk(runs, [], null, []);
  return out;
}

/**
 * The composed style key: the block key, then `+strong`, `+em`,
 * `+code`, `+link` in that order when present, then `+span:<name>` outermost
 * first. Bold and italic apply once each however deeply they nest.
 */
export function composeKey(block: string, marks: readonly Mark[], link: boolean, spans: readonly string[]): string {
  let key = block;
  for (const m of ["strong", "em", "code"] as const) if (marks.includes(m)) key += `+${m}`;
  if (link) key += "+link";
  for (const s of spans) key += `+span:${s}`;
  return key;
}

// ---------------------------------------------------------------------------
// Quotes (spec §10.2)
// ---------------------------------------------------------------------------

/** Opening and closing marks per language. Limit: English only; add languages as documents need them. */
const QUOTES: Record<string, { d: [string, string]; s: [string, string] }> = {
  en: { d: ["“", "”"], s: ["‘", "’"] },
};

/** A quote opens after the start, whitespace, an opening bracket or a dash; otherwise it closes (or is an apostrophe). */
const opensAfter = (prev: string): boolean => prev === "" || /[\s([{—–“‘]/.test(prev);

function curl(pieces: Piece[], lang: string): void {
  const q = QUOTES[lang.split("-")[0]!.toLowerCase()] ?? QUOTES.en!;
  let prev = "";
  for (const p of pieces) {
    if (p.kind !== "text") {
      if (p.kind === "break") prev = " ";
      continue;
    }
    if (p.code) {
      prev = p.text.at(-1) ?? prev; // code is literal
      continue;
    }
    // UTF-16 units, because the parser records escaped-quote positions as
    // UTF-16 offsets. Quotes are single units; surrogate pairs pass through.
    let out = "";
    for (let i = 0; i < p.text.length; i++) {
      const ch = p.text[i]!;
      if ((ch === '"' || ch === "'") && !p.escaped.has(i)) {
        const pair = ch === '"' ? q.d : q.s;
        out += opensAfter(prev) ? pair[0] : pair[1];
      } else out += ch;
      prev = ch;
    }
    p.text = out;
  }
}

// ---------------------------------------------------------------------------
// Hyphenation (spec §15.4 point 4)
// ---------------------------------------------------------------------------

/** A style's hyphenation settings (spec §07.6 `hyphenate-min`, `hyphenate-caps`). */
export type Hyphenation = { min: number; caps: boolean };

/** Soft-hyphenators per language. Limit: en-US patterns only; other languages get none until needed. */
const HYPHENATORS: Record<string, (s: string, min: number) => string> = {
  en: (s, min) => enUs.hyphenateSync(s, { minWordLength: min }),
};

/** A word that starts with a capital, soft hyphens and all. */
const CAPITALISED = /(?<![\p{L}\u00ad])\p{Lu}[\p{L}\u00ad]*/gu;

export const hyphenatorFor = (lang: string): ((s: string, h?: Hyphenation) => string) | null => {
  const hyph = HYPHENATORS[lang.split("-")[0]!.toLowerCase()];
  if (!hyph) return null;
  return (s, h = { min: 5, caps: true }) => {
    const out = hyph(s, h.min);
    return h.caps ? out : out.replace(CAPITALISED, (w) => w.replaceAll("\u00ad", ""));
  };
};

/** Words that never end a line under `bind-short` (spec §07.6), per language. Limit: English only. */
const SHORT: Record<string, RegExp> = {
  en: /(?<=(?:^|[\s(“‘"])(?:a|an|the|of|to|in|on|at|by|for|and|or|but|nor|as|if|is|with|from|into|via|I)) /giu,
};

/** Each space after a short word becomes a no-break space, so the word stays with the next one. */
export const bindShort = (s: string, lang: string): string => {
  const re = SHORT[lang.split("-")[0]!.toLowerCase()];
  return re ? s.replace(re, "\u00a0") : s;
};

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export type RunContext = {
  lang: string;
  /** The document's string table, for reading back what was interned. */
  strings: readonly string[];
  /** Adds a string to the document's table and returns its index. */
  intern: (s: string) => number;
  /** How a style key hyphenates, from the first variant that does; `null` when none does. */
  hyphenates: (style: string) => Hyphenation | null;
  /** Whether a style key binds short words to the next (`bind-short`) in at least one variant. */
  binds: (style: string) => boolean;
  /** An inline command's attribute, as an identifier or string, tokens resolved. */
  inlineAttr: (c: Command, key: string) => string | null;
};

type Draft = { kind: "text"; text: string; style: string; marks: Mark[]; link: number | null } | Exclude<Run, { kind: "text" }>;

/** A paragraph's inline content as runs and links. Adjacent pieces that agree on style, marks and link merge. */
export function toRuns(inline: Inline[], style: string, ctx: RunContext): { runs: Run[]; links: Link[] } {
  const links: Link[] = [];
  const ps = pieces(inline, links, ctx.inlineAttr);
  curl(ps, ctx.lang);
  const drafts: Draft[] = [];
  for (const p of ps) {
    if (p.kind === "break") drafts.push({ kind: "break" });
    else if (p.kind === "endmark") {
      // The end mark keeps to the story's last word: the space before it does not break.
      const prev = drafts.at(-1);
      if (prev?.kind === "text") prev.text = prev.text.replace(/\s+$/, "\u00a0");
      drafts.push({ kind: "endmark", s: ctx.intern(p.glyph), style: `${style}+endmark` });
    }
    else {
      const key = composeKey(style, p.marks, p.link !== null, p.spans);
      const prev = drafts.at(-1);
      if (prev?.kind === "text" && prev.style === key && prev.link === p.link && prev.marks.join() === p.marks.join()) prev.text += p.text;
      else drafts.push({ kind: "text", text: p.text, style: key, marks: p.marks, link: p.link });
    }
  }
  // Hyphenate whole merged runs, so a word split across two pieces of one run is still one word.
  const hyph = hyphenatorFor(ctx.lang);
  const runs = drafts.map((d): Run => {
    if (d.kind !== "text") return d;
    const h = d.marks.includes("code") ? null : ctx.hyphenates(d.style);
    const bound = ctx.binds(d.style) ? bindShort(d.text, ctx.lang) : d.text;
    const text = hyph && h ? hyph(bound, h) : bound;
    return { kind: "text", s: ctx.intern(text), style: d.style, marks: d.marks, link: d.link };
  });
  return { runs, links };
}
