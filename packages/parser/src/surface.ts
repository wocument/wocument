/**
 * Phase A: surface parse -- grammar §03.
 *
 * Knows nothing about command names. Produces commands, attribute lists,
 * bodies, raw text, escaped literals, blank marks and comments. Syntax
 * highlighters and the formatter use this layer directly.
 *
 * Body nesting is handled with an explicit stack rather than recursion, so a
 * pathologically deep document cannot overflow.
 */

import { lexAttrList, type SAttrList } from "./attrs.js";
import { Diagnostics, type Diagnostic } from "./diagnostics.js";
import { PositionIndex } from "./positions.js";

export type SurfaceNode = SCommand | SText | SEscape | SBlank | SComment;

export type SCommand = {
  kind: "command";
  name: string;
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  attrs: SAttrList | null;
  body: SurfaceNode[] | null;
  /** Offset just past `{`, or -1. */
  bodyStart: number;
  /** Offset of `}`, or -1 when the body was never closed. */
  bodyEnd: number;
};

export type SText = { kind: "text"; start: number; end: number };
/** An escaped literal. Opaque: never a delimiter, a dash run or a bracket. */
export type SEscape = { kind: "escape"; start: number; end: number; char: string };
export type SBlank = { kind: "blank"; start: number; end: number };
export type SComment = { kind: "comment"; whole: boolean; start: number; end: number };

export type SurfaceResult = {
  nodes: SurfaceNode[];
  diagnostics: Diagnostic[];
};

/** escchar ::= [\\{}\[\]()%*`\-."'] -- grammar §03.1 */
const ESCAPABLE = new Set([
  "\\", "{", "}", "[", "]", "(", ")", "%", "*", "`", "-", ".", '"', "'",
]);

const isLower = (c: string): boolean => c >= "a" && c <= "z";
const isHSpace = (c: string): boolean => c === " " || c === "\t";

/** Public entry point for tools that need the surface tree only. */
export function parseSurface(text: string): SurfaceResult {
  const diags = new Diagnostics();
  const index = new PositionIndex(text);
  const nodes = scanSurface(text, 0, text.length, diags, index);
  return { nodes, diagnostics: diags.sorted() };
}

/**
 * Scans `text` in [from, to) into a surface tree.
 * `index` must have been built over the whole normalized text.
 */
export function scanSurface(
  text: string,
  from: number,
  to: number,
  diags: Diagnostics,
  index: PositionIndex,
): SurfaceNode[] {
  const root: SurfaceNode[] = [];
  const stack: { cmd: SCommand; parent: SurfaceNode[] }[] = [];
  let nodes = root;
  let i = from;

  /** Start of the text run being accumulated, or -1. */
  let textStart = -1;
  /**
   * Stray `{` that produced a P010. The matching `}` is then swallowed
   * silently instead of raising a second, redundant P011.
   */
  let strayOpens = 0;

  const flushText = (end: number): void => {
    if (textStart >= 0 && end > textStart) nodes.push({ kind: "text", start: textStart, end });
    textStart = -1;
  };

  /** Offset where the line containing `at` begins. */
  const lineStartOf = (at: number): number => index.lineStart(index.lineIndexAt(at));

  while (i < to) {
    const c = text[i] as string;

    // --- comments ---------------------------------------------------------
    if (c === "%" && text[i + 1] === "%") {
      const ls = lineStartOf(i);
      let hs = i;
      while (hs > ls && isHSpace(text[hs - 1] as string)) hs--;
      const whole = hs === ls;
      let eol = text.indexOf("\n", i);
      if (eol === -1 || eol > to) eol = to;
      // A whole-line comment takes its leading whitespace and its newline with
      // it; a trailing comment takes only the whitespace before it.
      flushText(whole ? ls : hs);
      nodes.push({ kind: "comment", whole, start: i, end: eol });
      i = whole ? Math.min(eol + 1, to) : eol;
      continue;
    }

    // --- blank marks ------------------------------------------------------
    if (c === "\n") {
      const blank = scanBlank(text, i, to);
      if (blank !== null) {
        flushText(i);
        for (const cm of blank.comments) nodes.push(cm);
        nodes.push({ kind: "blank", start: i, end: blank.end });
        i = blank.end;
        continue;
      }
      // A lone newline is ordinary text; it becomes a space in phase B.
      if (textStart < 0) textStart = i;
      i++;
      continue;
    }

    // --- commands and escapes --------------------------------------------
    if (c === "\\") {
      const next = text[i + 1];
      if (next !== undefined && isLower(next)) {
        flushText(i);
        i = scanCommand(i);
        continue;
      }
      if (next !== undefined && ESCAPABLE.has(next)) {
        flushText(i);
        nodes.push({ kind: "escape", start: i, end: i + 2, char: next });
        i += 2;
        continue;
      }
      diags.add(
        "L004",
        index.span(i, Math.min(i + 2, to)),
        { char: next ?? "" },
        "Write `\\\\` for a literal backslash.",
      );
      i += next === undefined ? 1 : 2;
      continue;
    }

    // --- braces -----------------------------------------------------------
    if (c === "{") {
      // Asked before flushText, which would append the whitespace text node
      // and hide the command that precedes it.
      const hint = whitespaceBeforeBrace(i) ? "Remove the whitespace before `{`." : undefined;
      flushText(i);
      diags.add("P010", index.span(i, i + 1), { why: "stray" }, hint);
      strayOpens++;
      i++;
      continue;
    }
    if (c === "}") {
      flushText(i);
      const frame = stack.pop();
      if (frame !== undefined) {
        frame.cmd.bodyEnd = i;
        frame.cmd.end = i + 1;
        nodes = frame.parent;
        i++;
        continue;
      }
      if (strayOpens > 0) {
        strayOpens--; // closes a `{` already reported as P010
        i++;
        continue;
      }
      diags.add("P011", index.span(i, i + 1));
      i++;
      continue;
    }

    // --- text -------------------------------------------------------------
    if (textStart < 0) textStart = i;
    let j = i;
    while (j < to) {
      const ch = text[j] as string;
      if (ch === "\\" || ch === "{" || ch === "}" || ch === "\n") break;
      if (ch === "%" && text[j + 1] === "%") break;
      j++;
    }
    i = j === i ? i + 1 : j;
  }

  flushText(to);

  // Anything still open at the end never closed.
  while (stack.length > 0) {
    const frame = stack.pop() as { cmd: SCommand; parent: SurfaceNode[] };
    const open = frame.cmd.bodyStart - 1;
    diags.add("P010", index.span(open, open + 1), { why: "unclosed" });
    frame.cmd.bodyEnd = -1;
    frame.cmd.end = to;
  }

  return root;

  // -------------------------------------------------------------------------

  function scanCommand(at: number): number {
    const nameStart = at + 1;
    let j = nameStart;
    while (j < to && isLower(text[j] as string)) j++;
    const name = text.slice(nameStart, j);
    const nameEnd = j;

    // Adjacency: `[` opens attrs only as the very next character.
    let attrs: SAttrList | null = null;
    if (text[j] === "[" && j < to) {
      const r = lexAttrList(text, j, diags, index);
      attrs = r.list;
      j = r.next;
    }

    // Adjacency: `{` opens a body only right after the name or the `]`.
    if (text[j] === "{" && j < to) {
      const cmd: SCommand = {
        kind: "command",
        name,
        start: at,
        end: -1,
        nameStart,
        nameEnd,
        attrs,
        body: [],
        bodyStart: j + 1,
        bodyEnd: -1,
      };
      nodes.push(cmd);
      stack.push({ cmd, parent: nodes });
      nodes = cmd.body as SurfaceNode[];
      return j + 1;
    }

    nodes.push({
      kind: "command",
      name,
      start: at,
      end: j,
      nameStart,
      nameEnd,
      attrs,
      body: null,
      bodyStart: -1,
      bodyEnd: -1,
    });
    return j;
  }

  /** True when only whitespace separates this `{` from a preceding command. */
  function whitespaceBeforeBrace(at: number): boolean {
    let k = at - 1;
    while (k >= from && (isHSpace(text[k] as string) || text[k] === "\n")) k--;
    if (k === at - 1) return false; // no whitespace at all
    const last = nodes[nodes.length - 1];
    return last !== undefined && last.kind === "command" && last.end === k + 1;
  }
}

/**
 * A blank mark is `NL (hspace* NL)+`. Whole-line comments vanish with their
 * newline before the decision is made (grammar §03.2 rule 6), so they are
 * skipped here and handed back to be emitted alongside the blank.
 */
function scanBlank(
  text: string,
  at: number,
  to: number,
): { end: number; comments: SComment[] } | null {
  let j = at + 1;
  let newlines = 1;
  const comments: SComment[] = [];

  for (;;) {
    let k = j;
    while (k < to && isHSpace(text[k] as string)) k++;
    if (k < to && text[k] === "%" && text[k + 1] === "%") {
      let eol = text.indexOf("\n", k);
      if (eol === -1 || eol > to) eol = to;
      comments.push({ kind: "comment", whole: true, start: k, end: eol });
      j = Math.min(eol + 1, to);
      if (eol >= to) break;
      continue;
    }
    if (k < to && text[k] === "\n") {
      newlines++;
      j = k + 1;
      continue;
    }
    break;
  }

  return newlines >= 2 ? { end: j, comments } : null;
}
