import { describe, expect, it } from "vitest";
import { PositionIndex } from "../../src/positions.js";

describe("PositionIndex", () => {
  it("is 1-based on both axes", () => {
    const ix = new PositionIndex("ab\ncd");
    expect(ix.at(0)).toEqual({ line: 1, column: 1 });
    expect(ix.at(1)).toEqual({ line: 1, column: 2 });
    expect(ix.at(3)).toEqual({ line: 2, column: 1 });
  });

  it("puts the newline itself at the end of its own line", () => {
    const ix = new PositionIndex("ab\ncd");
    expect(ix.at(2)).toEqual({ line: 1, column: 3 });
  });

  it("counts columns in code points, not UTF-16 units, before the target", () => {
    // U+1F600 is one code point and two UTF-16 units.
    const text = "\u{1F600}x";
    expect(text.length).toBe(3);
    const ix = new PositionIndex(text);
    expect(ix.at(2)).toEqual({ line: 1, column: 2 }); // 'x' is the 2nd code point
  });

  it("is unaffected by astral characters after the target", () => {
    const ix = new PositionIndex("ab\u{1F600}");
    expect(ix.at(1)).toEqual({ line: 1, column: 2 });
  });

  it("counts a run of astral characters correctly", () => {
    const text = "\u{1F600}\u{1F601}\u{1F602}z";
    const ix = new PositionIndex(text);
    expect(ix.at(6)).toEqual({ line: 1, column: 4 });
  });

  it("handles astral characters on earlier lines", () => {
    const text = "\u{1F600}\n\u{1F601}q";
    const ix = new PositionIndex(text);
    expect(ix.at(text.indexOf("q"))).toEqual({ line: 2, column: 2 });
  });

  it("measures span length in code points", () => {
    const ix = new PositionIndex("\u{1F600}\u{1F600}");
    expect(ix.span(0, 4)).toEqual({ line: 1, column: 1, length: 2 });
  });

  it("treats a lone surrogate as one code point", () => {
    const text = "\uD800x"; // unpaired high surrogate
    const ix = new PositionIndex(text);
    expect(ix.at(1)).toEqual({ line: 1, column: 2 });
  });

  it("agrees with a naive code-point count at every offset", () => {
    const text = "a\u{1F600}b\ncd\u{1F601}\n\ne";
    const ix = new PositionIndex(text);
    let line = 1;
    let col = 1;
    for (let i = 0; i < text.length; i++) {
      expect(ix.at(i)).toEqual({ line, column: col });
      const code = text.codePointAt(i) as number;
      if (code === 0x0a) {
        line++;
        col = 1;
      } else {
        col++;
        if (code > 0xffff) {
          i++; // skip the low surrogate, which is not its own position
        }
      }
    }
  });

  it("reports line starts and counts", () => {
    const ix = new PositionIndex("a\nb\nc");
    expect(ix.lineCount).toBe(3);
    expect(ix.lineStart(1)).toBe(2);
    expect(ix.lineIndexAt(4)).toBe(2);
  });
});
