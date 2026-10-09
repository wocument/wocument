/**
 * Step 8: property tests, performance budget and the pathological inputs the
 * brief calls out. The link lookahead (grammar §05.4 rule 3) is the one place
 * a naive implementation goes quadratic.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import { PositionIndex } from "../../src/positions.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";

const SPICY = [
  "\\", "{", "}", "[", "]", "(", ")", "%", "*", "`", "-", ".", '"', "'",
  "\n", " ", "\t", "a", "z", "1", "\u{1F600}", ",", "=", "@", "$", "#", ":", "/",
];
const spicy = fc.array(fc.constantFrom(...SPICY), { maxLength: 300 }).map((a) => a.join(""));

/** A realistic document of roughly `words` words with links, emphasis and commands. */
function generateDocument(words: number): string {
  const lex = ["stone", "wall", "valley", "keep", "rampart", "tower", "siege", "moat", "gate", "arrow"];
  const out: string[] = [FM.trimEnd(), ""];
  out.push("\\grid[name=feature, cols=12, gutter=24px, baseline=28px, body=4-9]");
  out.push("\\style[name=body, size=19px, leading=1bl]");
  out.push("\\story[name=main]{");

  let written = 0;
  let para: string[] = [];
  let commandCount = 0;
  let i = 0;
  while (written < words) {
    const w = lex[i % lex.length] as string;
    // Sprinkle inline formatting through the prose.
    if (i % 37 === 0) para.push(`**${w}**`);
    else if (i % 23 === 0) para.push(`*${w}*`);
    else if (i % 53 === 0) para.push(`[${w}](https://example.org/${w})`);
    else if (i % 71 === 0) para.push(`\`${w}\``);
    else para.push(w);
    written++;
    i++;

    if (written % 60 === 0) {
      out.push(para.join(" ") + ".");
      out.push("");
      para = [];
      if (commandCount < 240) {
        out.push(`\\subhead{Chapter ${commandCount}}`);
        out.push("");
        out.push(`\\figure[src=/img/p${commandCount}.jpg, alt="Plate ${commandCount}", cols=1-6]{`);
        out.push(`  \\caption{Plate ${commandCount}.}`);
        out.push("}");
        out.push("");
        commandCount += 3;
      }
    }
  }
  if (para.length > 0) out.push(para.join(" ") + ".");
  out.push("}");
  out.push("");
  out.push("\\scene[name=one, grid=feature]{\\frame[story=main, cols=1-8]}");
  return out.join("\n");
}

describe("properties", () => {
  it("never throws and always returns diagnostics", () => {
    fc.assert(
      fc.property(spicy, (s) => {
        const r = parse(FM + s, { file: "t.wmx" });
        expect(Array.isArray(r.diagnostics)).toBe(true);
        expect(typeof r.ok).toBe("boolean");
      }),
      { numRuns: 1200 },
    );
  });

  it("survives arbitrary bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(() => parse(bytes)).not.toThrow();
      }),
      { numRuns: 400 },
    );
  });

  it("keeps every position inside the file and the list sorted", () => {
    fc.assert(
      fc.property(spicy, (s) => {
        const src = FM + s;
        const ix = new PositionIndex(src);
        const r = parse(src);
        let prevLine = 0;
        let prevCol = 0;
        for (const d of r.diagnostics) {
          expect(d.pos.line).toBeGreaterThanOrEqual(1);
          expect(d.pos.line).toBeLessThanOrEqual(ix.lineCount);
          expect(d.pos.column).toBeGreaterThanOrEqual(1);
          expect(d.pos.length).toBeGreaterThanOrEqual(0);
          const ordered = d.pos.line > prevLine || (d.pos.line === prevLine && d.pos.column >= prevCol);
          expect(ordered).toBe(true);
          prevLine = d.pos.line;
          prevCol = d.pos.column;
        }
      }),
      { numRuns: 800 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(spicy, (s) => {
        const a = parse(FM + s);
        const b = parse(FM + s);
        expect(JSON.stringify(a.ast)).toBe(JSON.stringify(b.ast));
        expect(a.diagnostics).toEqual(b.diagnostics);
      }),
      { numRuns: 300 },
    );
  });

  it("reports ok exactly when there are no errors", () => {
    fc.assert(
      fc.property(spicy, (s) => {
        const r = parse(FM + s);
        expect(r.ok).toBe(!r.diagnostics.some((d) => d.severity === "error"));
      }),
      { numRuns: 400 },
    );
  });
});

describe("performance", () => {
  it("parses a 10,000-word document in under 50 ms", () => {
    const src = generateDocument(10_000);
    expect(src.split(/\s+/).length).toBeGreaterThan(10_000);
    expect((src.match(/\\[a-z]+/g) ?? []).length).toBeGreaterThan(200);

    parse(src); // warm up
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const r = parse(src);
      runs.push(performance.now() - t0);
      expect(r.diagnostics).toEqual([]);
    }
    runs.sort((a, b) => a - b);
    const median = runs[2] as number;
    expect(median, `median ${median.toFixed(1)} ms over ${runs.map((x) => x.toFixed(1)).join(", ")}`).toBeLessThan(50);
  });

  it("stays linear on a paragraph of 50,000 open brackets", () => {
    const src = FM + "[".repeat(50_000);
    const t0 = performance.now();
    const r = parse(src);
    const ms = performance.now() - t0;
    expect(r.ast).not.toBeNull();
    expect(ms, `${ms.toFixed(1)} ms`).toBeLessThan(1000);
  });

  it("stays linear on 50,000 bracket pairs", () => {
    const src = FM + "[a]".repeat(16_000);
    const t0 = performance.now();
    parse(src);
    const ms = performance.now() - t0;
    expect(ms, `${ms.toFixed(1)} ms`).toBeLessThan(1000);
  });

  it("stays linear on asterisks separated by spaces", () => {
    const src = FM + "* ".repeat(25_000);
    const t0 = performance.now();
    const r = parse(src);
    const ms = performance.now() - t0;
    // Whitespace on both sides means every run is literal (vector 15).
    expect(r.diagnostics).toEqual([]);
    expect(ms, `${ms.toFixed(1)} ms`).toBeLessThan(1000);
  });

  it("stays linear on one 50,000-character word", () => {
    const src = FM + "a".repeat(50_000);
    const t0 = performance.now();
    parse(src);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("nesting", () => {
  it("parses 1000 levels of nested bodies", () => {
    const depth = 1000;
    const src = FM + "\\sidebar{".repeat(depth) + "x" + "}".repeat(depth);
    const r = parse(src);
    // Deeply nested sidebars are not legal children of one another, so P020 is
    // expected. What matters is that it terminates and does not overflow.
    expect(r.ast).not.toBeNull();
    expect(r.diagnostics.every((d) => d.code === "P020")).toBe(true);
  });

  it("parses 1000 levels of a legal nesting without diagnostics", () => {
    const depth = 1000;
    const src = FM + "\\span[style=s]{".repeat(depth) + "x" + "}".repeat(depth);
    const r = parse(src);
    expect(r.diagnostics).toEqual([]);
  });

  it("reports 2000 unclosed bodies without throwing", () => {
    const src = FM + "\\sidebar{".repeat(2000);
    const r = parse(src);
    expect(r.diagnostics.filter((d) => d.code === "P010")).toHaveLength(2000);
  });
});
