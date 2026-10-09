/**
 * Inline grammar -- grammar §05.4.
 *
 * Input is a sequence of text characters, opaque escaped literals and opaque
 * inline command nodes. The six recognition rules are implemented exactly.
 *
 * Everything is linear. Code spans and bracket pairs are matched in two
 * up-front passes, so a paragraph of 50,000 `[` characters cannot make the
 * link lookahead quadratic.
 */

import type { Command, Inline } from "./ast.js";
import type { Diagnostics } from "./diagnostics.js";
import type { PositionIndex } from "./positions.js";

export type InlineItem =
  | { kind: "text"; start: number; end: number }
  | { kind: "escape"; start: number; end: number; char: string }
  | { kind: "command"; node: Command; start: number; end: number };

const isWs = (c: string): boolean => c === " " || c === "\t" || c === "\n";

/** Placeholder occupying one slot for an opaque inline command. */
const CMD = "￼";

const EN_DASH = "–";
const EM_DASH = "—";
const ELLIPSIS = "…";

type Prepared = {
  s: string;
  opaque: Uint8Array;
  src: Int32Array;
  cmds: Map<number, Command>;
  /** Index -> 1 when the character came from an escape. */
  escaped: Uint8Array;
};

function prepareItems(text: string, items: readonly InlineItem[]): Prepared {
  let size = 0;
  for (const it of items) size += it.kind === "text" ? it.end - it.start : 1;

  const chars = new Array<string>(size);
  const opaque = new Uint8Array(size);
  const escaped = new Uint8Array(size);
  const src = new Int32Array(size);
  const cmds = new Map<number, Command>();

  let k = 0;
  for (const it of items) {
    if (it.kind === "text") {
      for (let o = it.start; o < it.end; o++) {
        chars[k] = text[o] as string;
        src[k] = o;
        k++;
      }
    } else if (it.kind === "escape") {
      chars[k] = it.char;
      opaque[k] = 1;
      escaped[k] = 1;
      src[k] = it.start;
      k++;
    } else {
      chars[k] = CMD;
      opaque[k] = 1;
      src[k] = it.start;
      cmds.set(k, it.node);
      k++;
    }
  }
  return { s: chars.join(""), opaque, src, cmds, escaped };
}

/** Pass 1: code span extents, so delimiters inside them are inert. */
function codeMaskOf(p: Prepared): { mask: Uint8Array; closeOf: Map<number, number> } {
  const { s, opaque } = p;
  const mask = new Uint8Array(s.length);
  const closeOf = new Map<number, number>();
  for (let i = 0; i < s.length; i++) {
    if (opaque[i] === 1 || s[i] !== "`") continue;
    let j = i + 1;
    while (j < s.length && !(opaque[j] === 0 && s[j] === "`")) j++;
    if (j >= s.length) break; // unclosed; the main scan reports it
    for (let m = i; m <= j; m++) mask[m] = 1;
    closeOf.set(i, j);
    i = j;
  }
  return { mask, closeOf };
}

/** Pass 2: bracket pairs outside code spans, for the link lookahead. */
function bracketMatches(p: Prepared, mask: Uint8Array): Map<number, number> {
  const { s, opaque } = p;
  const match = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (opaque[i] === 1 || mask[i] === 1) continue;
    if (s[i] === "[") stack.push(i);
    else if (s[i] === "]") {
      const open = stack.pop();
      if (open !== undefined) match.set(open, i);
    }
  }
  return match;
}

/** Collects text, collapsing whitespace runs and tracking escaped quotes. */
class TextBuilder {
  private buf = "";
  private quotes: number[] = [];
  private pendingSpace = false;

  push(ch: string, isEscaped: boolean): void {
    if (!isEscaped && isWs(ch)) {
      // Always held, even with an empty buffer: a run of whitespace between
      // two spans is one space, and trimEnds strips it at the sequence edges.
      this.pendingSpace = true;
      return;
    }
    if (this.pendingSpace) {
      this.buf += " ";
      this.pendingSpace = false;
    }
    if (isEscaped && (ch === '"' || ch === "'")) this.quotes.push(this.buf.length);
    this.buf += ch;
  }

  dropPendingSpace(): void {
    this.pendingSpace = false;
  }

  take(): Inline | null {
    const value = this.buf + (this.pendingSpace ? " " : "");
    const quotes = this.quotes;
    this.buf = "";
    this.quotes = [];
    this.pendingSpace = false;
    if (value.length === 0) return null;
    const node: Inline = { type: "text", value };
    if (quotes.length > 0) node.escapedQuotes = quotes;
    return node;
  }
}

type Frame = { kind: "root" | "bold" | "italic"; runs: Inline[]; open: number };

export function parseInline(
  text: string,
  items: readonly InlineItem[],
  diags: Diagnostics,
  index: PositionIndex,
): Inline[] {
  const p = prepareItems(text, items);
  const { mask, closeOf } = codeMaskOf(p);
  const match = bracketMatches(p, mask);
  return trimEnds(scan(p, mask, closeOf, match, 0, p.s.length, false, diags, index));
}

function scan(
  p: Prepared,
  mask: Uint8Array,
  closeOf: Map<number, number>,
  match: Map<number, number>,
  lo: number,
  hi: number,
  inLink: boolean,
  diags: Diagnostics,
  index: PositionIndex,
): Inline[] {
  const { s, opaque, escaped, src, cmds } = p;
  const root: Frame = { kind: "root", runs: [], open: -1 };
  const stack: Frame[] = [root];
  const tb = new TextBuilder();

  const top = (): Frame => stack[stack.length - 1] as Frame;
  const flush = (): void => {
    const t = tb.take();
    if (t !== null) top().runs.push(t);
  };
  const emit = (node: Inline): void => {
    flush();
    top().runs.push(node);
  };
  const posAt = (a: number, b: number) => {
    const from = src[Math.max(0, Math.min(a, s.length - 1))] ?? 0;
    const to = src[Math.max(0, Math.min(b, s.length - 1))] ?? from;
    return index.span(from, to + 1);
  };

  const isOpen = (kind: "bold" | "italic"): boolean => stack.some((f) => f.kind === kind);

  const openSpan = (kind: "bold" | "italic", at: number): void => {
    flush();
    stack.push({ kind, runs: [], open: at });
  };

  /** Returns false when the close did not match the innermost open span. */
  const closeSpan = (kind: "bold" | "italic", at: number): boolean => {
    if (top().kind !== kind) {
      diags.add("P031", posAt(at, at), { what: kind === "bold" ? "Bold" : "Italic" });
      return false;
    }
    flush();
    const frame = stack.pop() as Frame;
    top().runs.push({ type: frame.kind as "bold" | "italic", runs: frame.runs });
    return true;
  };

  const literalStars = (n: number): void => {
    for (let k = 0; k < n; k++) tb.push("*", false);
  };

  let i = lo;
  while (i < hi) {
    // --- opaque items ------------------------------------------------------
    if (opaque[i] === 1) {
      const cmd = cmds.get(i);
      if (cmd !== undefined) {
        // Rule 5: whitespace either side of a forced break is dropped.
        if (cmd.name === "br") tb.dropPendingSpace();
        emit({ type: "command", node: cmd });
        if (cmd.name === "br") {
          while (i + 1 < hi && opaque[i + 1] === 0 && isWs(s[i + 1] as string)) i++;
        }
      } else {
        tb.push(s[i] as string, escaped[i] === 1);
      }
      i++;
      continue;
    }

    const c = s[i] as string;

    // --- code spans (rule 2) ----------------------------------------------
    if (c === "`") {
      const close = closeOf.get(i);
      if (close === undefined || close >= hi) {
        diags.add("P032", posAt(i, i));
        tb.push(c, false);
        i++;
        continue;
      }
      if (close === i + 1) {
        diags.add("P036", posAt(i, close));
        emit({ type: "code", value: "" });
        i = close + 1;
        continue;
      }
      let value = "";
      for (let k = i + 1; k < close; k++) {
        const inner = cmds.get(k);
        if (inner !== undefined) {
          diags.add(
            "P033",
            posAt(k, k),
            { name: inner.name },
            "Escape the backslash: write `\\\\` inside a code span.",
          );
          continue;
        }
        value += s[k] as string;
      }
      emit({ type: "code", value });
      i = close + 1;
      continue;
    }

    // --- links (rule 3) ----------------------------------------------------
    if (c === "[") {
      const close = match.get(i);
      if (close !== undefined && close < hi) {
        const url = readUrl(p, close + 1, hi);
        if (url !== null) {
          if (inLink) diags.add("P035", posAt(i, i));
          const inner = scan(p, mask, closeOf, match, i + 1, close, true, diags, index);
          emit({ type: "link", href: url.href, runs: trimEnds(inner) });
          i = url.next;
          continue;
        }
      }
      tb.push(c, false); // a lone bracket is literal (vector 12)
      i++;
      continue;
    }

    // --- emphasis (rule 1) -------------------------------------------------
    if (c === "*") {
      let j = i;
      while (j < hi && opaque[j] === 0 && s[j] === "*") j++;
      const run = j - i;
      if (run >= 4) {
        diags.add("P034", posAt(i, j - 1));
        literalStars(run);
        i = j;
        continue;
      }
      const closing = i > lo && !(opaque[i - 1] === 0 && isWs(s[i - 1] as string));
      const opening = j < hi && !(opaque[j] === 0 && isWs(s[j] as string));

      if (!closing && !opening) {
        literalStars(run);
        i = j;
        continue;
      }

      const toggle = (kind: "bold" | "italic", width: number): void => {
        if (isOpen(kind) && closing) {
          if (!closeSpan(kind, i)) literalStars(width);
        } else if (opening) {
          openSpan(kind, i);
        } else {
          literalStars(width);
        }
      };

      if (run === 1) {
        toggle("italic", 1);
      } else if (run === 2) {
        toggle("bold", 2);
      } else {
        const boldOpen = isOpen("bold");
        const italicOpen = isOpen("italic");
        if (boldOpen && italicOpen) {
          // Close both, innermost first.
          if (top().kind === "italic") {
            closeSpan("italic", i);
            closeSpan("bold", i);
          } else {
            closeSpan("bold", i);
            closeSpan("italic", i);
          }
        } else if (!boldOpen && !italicOpen) {
          openSpan("bold", i);
          openSpan("italic", i);
        } else if (boldOpen) {
          closeSpan("bold", i);
          openSpan("italic", i);
        } else {
          closeSpan("italic", i);
          openSpan("bold", i);
        }
      }
      i = j;
      continue;
    }

    // --- dash and dot runs (rule 4) ---------------------------------------
    if (c === "-" || c === ".") {
      let j = i;
      while (j < hi && opaque[j] === 0 && s[j] === c) j++;
      const run = j - i;
      if (c === "-" && run === 2) tb.push(EN_DASH, false);
      else if (c === "-" && run === 3) tb.push(EM_DASH, false);
      else if (c === "." && run === 3) tb.push(ELLIPSIS, false);
      else for (let k = i; k < j; k++) tb.push(c, false);
      i = j;
      continue;
    }

    tb.push(c, false);
    i++;
  }

  flush();

  // Anything still open at the end of the sequence never closed (rule 1).
  while (stack.length > 1) {
    const frame = stack.pop() as Frame;
    diags.add("P030", posAt(frame.open, frame.open), {
      what: frame.kind === "bold" ? "Bold" : "Italic",
    });
    top().runs.push(...frame.runs);
  }

  return root.runs;
}

/** `](url)` immediately after the link text, with no whitespace or bare parens. */
function readUrl(p: Prepared, at: number, hi: number): { href: string; next: number } | null {
  const { s, opaque, cmds } = p;
  if (at >= hi || opaque[at] === 1 || s[at] !== "(") return null;
  let href = "";
  let k = at + 1;
  while (k < hi) {
    if (opaque[k] === 0 && s[k] === ")") {
      return href.length > 0 ? { href, next: k + 1 } : null;
    }
    if (cmds.has(k)) return null;
    const ch = s[k] as string;
    if (opaque[k] === 0 && (isWs(ch) || ch === "(")) return null;
    href += ch;
    k++;
  }
  return null;
}

/** Rule 5: trim the leading and trailing whitespace of the whole sequence. */
function trimEnds(runs: Inline[]): Inline[] {
  const out = [...runs];
  const first = out[0];
  if (first !== undefined && first.type === "text") {
    const value = first.value.replace(/^ +/, "");
    const cut = first.value.length - value.length;
    if (value.length === 0) out.shift();
    else if (first.escapedQuotes === undefined) out[0] = { ...first, value };
    // Escaped-quote offsets index the value, so they move with the trim.
    else out[0] = { ...first, value, escapedQuotes: first.escapedQuotes.map((q) => q - cut) };
  }
  const last = out[out.length - 1];
  if (last !== undefined && last.type === "text") {
    const value = last.value.replace(/ +$/, "");
    if (value.length === 0) out.pop();
    else out[out.length - 1] = { ...last, value };
  }
  return out;
}
