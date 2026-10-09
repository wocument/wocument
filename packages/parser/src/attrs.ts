/**
 * Attribute list lexing -- grammar §04.
 *
 * This is part of phase A: the surface parser cannot find the `]` that closes
 * an attribute list without it, because a quoted value may contain one. No
 * schema knowledge is used here; values stay raw and are typed in phase B by
 * `values.ts`.
 */

import type { Diagnostics } from "./diagnostics.js";
import type { PositionIndex } from "./positions.js";

export type RawValue =
  | { kind: "absent" }
  | { kind: "string"; text: string; start: number; end: number }
  | { kind: "bare"; text: string; start: number; end: number }
  | { kind: "func"; name: string; args: RawArg[]; start: number; end: number; raw: string };

export type RawArg = { atoms: string[]; start: number; end: number; raw: string };

export type RawAttr = {
  key: string;
  /** The `@breakpoint` suffix, or null. */
  at: string | null;
  /** Covers the key and its `@suffix`. */
  keyStart: number;
  keyEnd: number;
  value: RawValue;
  start: number;
  end: number;
};

export type SAttrList = {
  /** Offset of `[`. */
  start: number;
  /** Offset just past `]`. */
  end: number;
  attrs: RawAttr[];
  /** True when lexing bailed out and the list is incomplete. */
  recovered: boolean;
};

const QUOTE_HINT = "Quote the value.";

const isLower = (c: string): boolean => c >= "a" && c <= "z";
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isHSpace = (c: string): boolean => c === " " || c === "\t";
const isAws = (c: string): boolean => isHSpace(c) || c === "\n";

/** barechar ::= [A-Za-z0-9_./:#$%+~\-] */
function isBareChar(c: string): boolean {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    isDigit(c) ||
    c === "_" ||
    c === "." ||
    c === "/" ||
    c === ":" ||
    c === "#" ||
    c === "$" ||
    c === "%" ||
    c === "+" ||
    c === "~" ||
    c === "-"
  );
}

export type LexAttrsResult = { list: SAttrList; next: number };

/**
 * Lexes `[...]` beginning at `open` (which must point at `[`).
 * Returns the list and the offset just past `]` (or past the recovery point).
 */
export function lexAttrList(
  text: string,
  open: number,
  diags: Diagnostics,
  index: PositionIndex,
): LexAttrsResult {
  const len = text.length;
  const attrs: RawAttr[] = [];
  const seen = new Map<string, number>();
  let i = open + 1;
  let recovered = false;

  const skipAws = (): void => {
    while (i < len && isAws(text[i] as string)) i++;
  };

  /** Grammar §10 rule 4: skip to the first `]` followed by `{`, a newline or EOF. */
  const recover = (): number => {
    recovered = true;
    for (let j = i; j < len; j++) {
      if (text[j] !== "]") continue;
      const after = text[j + 1];
      if (after === undefined || after === "{" || after === "\n") return j + 1;
    }
    return len;
  };

  const fail = (at: number, what: string, hint?: string): LexAttrsResult => {
    diags.add("L003", index.span(at, Math.min(at + 1, len)), { what }, hint);
    const next = recover();
    return { list: { start: open, end: next, attrs, recovered: true }, next };
  };

  for (;;) {
    skipAws();
    if (i >= len) {
      diags.add("L003", index.span(open, open + 1), { what: "the file ended inside an attribute list" });
      return { list: { start: open, end: len, attrs, recovered: true }, next: len };
    }
    const c = text[i] as string;
    if (c === "]") {
      i++;
      break;
    }
    if (c === "{" || c === "}" || c === "\\") {
      return fail(i, `unexpected \`${c}\``);
    }

    // --- key -------------------------------------------------------------
    const keyStart = i;
    if (!isLower(c)) return fail(i, `unexpected \`${c}\``, QUOTE_HINT);
    while (i < len && isLower(text[i] as string)) i++;
    while (i < len && text[i] === "-" && isLower(text[i + 1] ?? "")) {
      i++;
      while (i < len && isLower(text[i] as string)) i++;
    }
    const key = text.slice(keyStart, i);

    // --- optional @breakpoint suffix --------------------------------------
    let at: string | null = null;
    if (text[i] === "@") {
      const atStart = i;
      i++;
      const identStart = i;
      if (i < len && isLower(text[i] as string)) {
        i++;
        while (i < len && (isLower(text[i] as string) || isDigit(text[i] as string))) i++;
        while (i < len && text[i] === "-" && (isLower(text[i + 1] ?? "") || isDigit(text[i + 1] ?? ""))) {
          i++;
          while (i < len && (isLower(text[i] as string) || isDigit(text[i] as string))) i++;
        }
      }
      if (i === identStart) return fail(atStart, "`@` must be followed by a breakpoint name");
      at = text.slice(identStart, i);
    }
    const keyEnd = i;

    // --- optional = value -------------------------------------------------
    const beforeEq = i;
    skipAws();
    let value: RawValue = { kind: "absent" };
    if (text[i] === "=") {
      i++;
      skipAws();
      const r = lexValue(text, i, diags, index);
      if (r === null) {
        return fail(i, `unexpected \`${text[i] ?? "end of file"}\``, QUOTE_HINT);
      }
      if (r.fatal) {
        const next = recover();
        return { list: { start: open, end: next, attrs, recovered: true }, next };
      }
      value = r.value;
      i = r.next;
    } else {
      i = beforeEq; // no `=`: the whitespace we skipped belongs to the separator
    }

    const dupKey = at === null ? key : `${key}@${at}`;
    if (seen.has(dupKey)) {
      diags.add("P014", index.span(keyStart, keyEnd), { key: dupKey });
    } else {
      seen.set(dupKey, keyStart);
    }
    attrs.push({ key, at, keyStart, keyEnd, value, start: keyStart, end: i });

    // --- separator --------------------------------------------------------
    skipAws();
    if (text[i] === ",") {
      i++;
      continue;
    }
    if (text[i] === "]") {
      i++;
      break;
    }
    if (i >= len) {
      diags.add("L003", index.span(open, open + 1), { what: "the file ended inside an attribute list" });
      return { list: { start: open, end: len, attrs, recovered: true }, next: len };
    }
    return fail(i, `expected \`,\` or \`]\`, found \`${text[i] as string}\``, QUOTE_HINT);
  }

  return { list: { start: open, end: i, attrs, recovered }, next: i };
}

type ValueResult = { value: RawValue; next: number; fatal?: false } | { fatal: true; value?: undefined; next?: undefined };

function lexValue(text: string, start: number, diags: Diagnostics, index: PositionIndex): ValueResult | null {
  const len = text.length;
  const c = text[start];
  if (c === undefined) return null;

  if (c === '"') return lexString(text, start, diags, index);

  if (!isBareChar(c)) return null;

  let i = start;
  while (i < len && isBareChar(text[i] as string)) i++;
  const word = text.slice(start, i);

  // Grammar §04 rule 1: a bare word of [a-z] directly followed by `(` is a function name.
  if (text[i] === "(" && /^[a-z]+$/.test(word)) {
    return lexFunc(text, start, i, word, diags, index);
  }
  return { value: { kind: "bare", text: word, start, end: i }, next: i };
}

function lexString(text: string, start: number, diags: Diagnostics, index: PositionIndex): ValueResult {
  const len = text.length;
  let i = start + 1;
  let out = "";
  for (;;) {
    if (i >= len) {
      diags.add("L002", index.span(start, len));
      return { fatal: true };
    }
    const ch = text[i] as string;
    if (ch === '"') {
      i++;
      return { value: { kind: "string", text: out, start, end: i }, next: i };
    }
    if (ch === "\n") {
      diags.add("L006", index.span(i, i + 1));
      return { fatal: true };
    }
    if (ch === "\\") {
      const nxt = text[i + 1];
      if (nxt === '"' || nxt === "\\") {
        out += nxt;
        i += 2;
        continue;
      }
      diags.add(
        "L003",
        index.span(i, i + 2),
        { what: "invalid escape inside a string" },
        'Only \\" and \\\\ are escapes inside a quoted value.',
      );
      return { fatal: true };
    }
    out += ch;
    i++;
  }
}

function lexFunc(
  text: string,
  start: number,
  parenAt: number,
  name: string,
  diags: Diagnostics,
  index: PositionIndex,
): ValueResult {
  const len = text.length;
  let i = parenAt + 1;
  const args: RawArg[] = [];

  const skipAws = (): void => {
    while (i < len && isAws(text[i] as string)) i++;
  };

  skipAws();
  if (text[i] === ")") {
    i++;
    return { value: { kind: "func", name, args, start, end: i, raw: text.slice(start, i) }, next: i };
  }

  for (;;) {
    skipAws();
    const argStart = i;
    const atoms: string[] = [];
    for (;;) {
      const atomStart = i;
      while (i < len && isBareChar(text[i] as string)) i++;
      if (i === atomStart) break;
      atoms.push(text.slice(atomStart, i));
      const save = i;
      while (i < len && isHSpace(text[i] as string)) i++;
      if (i === save) break;
      if (!isBareChar(text[i] ?? "")) {
        i = save;
        break;
      }
    }
    if (atoms.length === 0) {
      diags.add(
        "L003",
        index.span(i, Math.min(i + 1, len)),
        { what: `unexpected \`${text[i] ?? "end of file"}\` in a function argument` },
        QUOTE_HINT,
      );
      return { fatal: true };
    }
    args.push({ atoms, start: argStart, end: i, raw: text.slice(argStart, i) });

    skipAws();
    if (text[i] === ",") {
      i++;
      continue;
    }
    if (text[i] === ")") {
      i++;
      return { value: { kind: "func", name, args, start, end: i, raw: text.slice(start, i) }, next: i };
    }
    diags.add(
      "L003",
      index.span(Math.min(i, len - 1), Math.min(i + 1, len)),
      { what: i >= len ? "the file ended inside a function value" : `expected \`,\` or \`)\`` },
      QUOTE_HINT,
    );
    return { fatal: true };
  }
}
