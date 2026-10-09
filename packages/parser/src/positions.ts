/**
 * Source positions.
 *
 * Grammar §02: `line` and `column` are 1-based and count **Unicode code
 * points**, not bytes and not UTF-16 code units. JavaScript strings are
 * UTF-16, so an astral character (an emoji, say) occupies two units but one
 * column.
 *
 * Converting offset -> {line, column} by re-counting code points from the
 * start of the line is O(line length) per lookup, which goes quadratic on a
 * pathological single-line paragraph. Instead we index the surrogate pairs
 * once and subtract them with a binary search, so every lookup is O(log n).
 */

export type Pos = { line: number; column: number; length: number };

export class PositionIndex {
  /** UTF-16 offset at which each line starts. Always begins with 0. */
  private readonly lineStarts: number[];
  /** UTF-16 offsets of every high surrogate that forms a valid pair. */
  private readonly pairStarts: number[];

  constructor(text: string) {
    const lineStarts: number[] = [0];
    const pairStarts: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const u = text.charCodeAt(i);
      if (u === 0x0a) {
        lineStarts.push(i + 1);
      } else if (u >= 0xd800 && u <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          pairStarts.push(i);
          i++; // skip the low surrogate; it can never be a line break
        }
      }
    }
    this.lineStarts = lineStarts;
    this.pairStarts = pairStarts;
  }

  /** Number of surrogate pairs starting in [from, to). */
  private pairsBetween(from: number, to: number): number {
    return upperBound(this.pairStarts, to - 1) - lowerBound(this.pairStarts, from);
  }

  /** Code points in [from, to). */
  codePointsBetween(from: number, to: number): number {
    if (to <= from) return 0;
    return to - from - this.pairsBetween(from, to);
  }

  /** 1-based line and column (in code points) for a UTF-16 offset. */
  at(offset: number): { line: number; column: number } {
    const lineIndex = upperBound(this.lineStarts, offset) - 1;
    const lineStart = this.lineStarts[lineIndex] ?? 0;
    return {
      line: lineIndex + 1,
      column: this.codePointsBetween(lineStart, offset) + 1,
    };
  }

  /** A full position for the half-open range [start, end). */
  span(start: number, end: number): Pos {
    const { line, column } = this.at(start);
    return { line, column, length: this.codePointsBetween(start, Math.max(start, end)) };
  }

  /** 0-based index of the line containing `offset`. */
  lineIndexAt(offset: number): number {
    return upperBound(this.lineStarts, offset) - 1;
  }

  /** UTF-16 offset where a 0-based line begins. */
  lineStart(lineIndex: number): number {
    return this.lineStarts[lineIndex] ?? 0;
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }
}

/** First index whose value is >= x. */
function lowerBound(a: readonly number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] as number) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose value is > x. */
function upperBound(a: readonly number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid] as number) <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
