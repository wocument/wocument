import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseSurface } from "../../src/surface.js";
import { PositionIndex } from "../../src/positions.js";

/** Characters that actually exercise the surface grammar's decision points. */
const SPICY = ["\\", "{", "}", "[", "]", "(", ")", "%", "*", "`", "-", ".", '"', "'", "\n", " ", "\t", "a", "z", "1", "\u{1F600}", ",", "=", "@", "$", "#", ":", "/"];

const spicyString = fc.array(fc.constantFrom(...SPICY), { maxLength: 400 }).map((a) => a.join(""));

describe("phase A never throws and always terminates", () => {
  it("survives arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (s) => {
        const r = parseSurface(s);
        expect(Array.isArray(r.nodes)).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it("survives strings made of the characters that matter", () => {
    fc.assert(
      fc.property(spicyString, (s) => {
        const r = parseSurface(s);
        expect(Array.isArray(r.nodes)).toBe(true);
      }),
      { numRuns: 1500 },
    );
  });

  it("survives arbitrary bytes decoded as text", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        expect(() => parseSurface(s)).not.toThrow();
      }),
      { numRuns: 400 },
    );
  });

  it("keeps every diagnostic inside the file and sorted", () => {
    fc.assert(
      fc.property(spicyString, (s) => {
        const ix = new PositionIndex(s);
        const r = parseSurface(s);
        let prev = { line: 0, column: 0 };
        for (const d of r.diagnostics) {
          expect(d.pos.line).toBeGreaterThanOrEqual(1);
          expect(d.pos.line).toBeLessThanOrEqual(ix.lineCount);
          expect(d.pos.column).toBeGreaterThanOrEqual(1);
          expect(d.pos.length).toBeGreaterThanOrEqual(0);
          const ordered = d.pos.line > prev.line || (d.pos.line === prev.line && d.pos.column >= prev.column);
          expect(ordered).toBe(true);
          prev = { line: d.pos.line, column: d.pos.column };
        }
      }),
      { numRuns: 800 },
    );
  });

  it("covers the source exactly once, in order", () => {
    fc.assert(
      fc.property(spicyString, (s) => {
        const r = parseSurface(s);
        let last = 0;
        const walk = (nodes: ReturnType<typeof parseSurface>["nodes"]): void => {
          for (const n of nodes) {
            expect(n.start).toBeGreaterThanOrEqual(last);
            expect(n.end).toBeGreaterThanOrEqual(n.start);
            if (n.kind === "command" && n.body !== null) {
              last = n.bodyStart;
              walk(n.body);
            } else {
              last = n.end;
            }
          }
        };
        walk(r.nodes);
      }),
      { numRuns: 800 },
    );
  });
});

describe("phase A nesting", () => {
  it("handles 1000 levels of nested bodies without overflowing", () => {
    const depth = 1000;
    const src = "\\sidebar{".repeat(depth) + "x" + "}".repeat(depth);
    const r = parseSurface(src);
    expect(r.diagnostics).toEqual([]);
    let node = r.nodes[0];
    let levels = 0;
    while (node !== undefined && node.kind === "command" && node.body !== null) {
      levels++;
      node = node.body[0];
    }
    expect(levels).toBe(depth);
  });

  it("reports every unclosed body without throwing", () => {
    const src = "\\sidebar{".repeat(500);
    const r = parseSurface(src);
    expect(r.diagnostics.every((d) => d.code === "P010")).toBe(true);
    expect(r.diagnostics.length).toBe(500);
  });
});
