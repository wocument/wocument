/**
 * Diagnostic construction and collection.
 *
 * The parser never throws on bad input (brief ground rule 4): every problem
 * becomes a Diagnostic. `Diagnostics` accumulates them so a phase can report
 * everything it finds rather than stopping at the first error.
 */

import { CODES, type DiagnosticCode, type Severity } from "@wmxdsl/schema";
import type { Pos } from "./positions.js";

export type Diagnostic = {
  code: string;
  severity: Severity;
  message: string;
  hint?: string;
  file?: string;
  pos: Pos;
};

export type DiagnosticParams = Readonly<Record<string, string>>;

export class Diagnostics {
  private readonly items: Diagnostic[] = [];

  constructor(private readonly file?: string) {}

  add(code: DiagnosticCode, pos: Pos, params: DiagnosticParams = {}, hint?: string): void {
    const spec = CODES[code];
    const d: Diagnostic = {
      code: spec.code,
      severity: spec.severity,
      message: spec.message(params),
      pos,
    };
    if (hint !== undefined) d.hint = hint;
    if (this.file !== undefined) d.file = this.file;
    this.items.push(d);
  }

  get length(): number {
    return this.items.length;
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }

  /** Sorted by position, then by code, so output is deterministic. */
  sorted(): Diagnostic[] {
    return [...this.items].sort(
      (a, b) =>
        a.pos.line - b.pos.line ||
        a.pos.column - b.pos.column ||
        a.pos.length - b.pos.length ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    );
  }
}

/**
 * Levenshtein distance, abandoned as soon as it cannot come in at or under
 * `max`. Suggestions are only offered at distance 2 or less (grammar §05.3),
 * so the cutoff keeps this cheap over the whole command table.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let best = curr[0] as number;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        (prev[j] as number) + 1,
        (curr[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      curr[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length] as number;
}

/** Closest candidate within edit distance 2, or undefined. */
export function nearestMatch(word: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const c of candidates) {
    const d = editDistance(word, c, 2);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return bestDistance <= 2 ? best : undefined;
}

export function didYouMean(
  word: string,
  candidates: Iterable<string>,
  prefix = "\\",
  suffix = "",
): string | undefined {
  const m = nearestMatch(word, candidates);
  return m === undefined ? undefined : `Did you mean ${prefix}${m}${suffix}?`;
}
