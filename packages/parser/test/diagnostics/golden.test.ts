/**
 * One golden test per diagnostic code in grammar §11, asserting the code, its
 * position and its hint. A code with no test here is a code nothing can
 * produce, so the final case checks the table is fully covered.
 */
import { describe, expect, it } from "vitest";
import { ALL_CODES } from "@wmxdsl/schema";
import { parse, type Diagnostic } from "../../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";

type Case = {
  code: string;
  /** Source. A string starting with `---` is used as-is; otherwise FM is prepended. */
  src: string | Uint8Array;
  kind?: "document" | "theme";
  /** Source is complete as given; do not prepend frontmatter. */
  raw?: true;
  /** Expected 1-based line and column of the first diagnostic with this code. */
  at: [number, number];
  hint?: string;
  message?: RegExp;
};

const CASES: Case[] = [
  {
    code: "L001",
    src: new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe]),
    at: [1, 1],
    message: /Invalid UTF-8/,
  },
  {
    code: "L002",
    src: '\\scene{\\figure[alt="abc]}',
    at: [5, 20],
    message: /Unterminated string/,
  },
  {
    code: "L003",
    src: "\\scene{\\figure[src=/a.png?w=2]}",
    at: [5, 26],
    hint: "Quote the value.",
  },
  {
    code: "L004",
    src: "Text with \\1 in it.",
    at: [5, 11],
    hint: "Write `\\\\` for a literal backslash.",
  },
  {
    code: "L005",
    src: "---\nwmxdsl: 1\ntitle: T\n",
    raw: true,
    at: [1, 1],
    message: /Unterminated frontmatter/,
  },
  {
    code: "L006",
    src: '\\scene{\\figure[alt="a\nb"]}',
    at: [5, 22],
    message: /Newline inside a string/,
  },
  {
    code: "P001",
    src: "no frontmatter at all",
    raw: true,
    at: [1, 1],
    hint: "A document must begin with a `---` fence.",
  },
  {
    code: "P002",
    src: "---\nwmxdsl: 1\ntitle: T\nlayout: wide\n---\n",
    raw: true,
    at: [4, 1],
    message: /Unknown frontmatter field `layout`/,
  },
  {
    code: "P003",
    src: "---\ntitle: T\n---\n",
    raw: true,
    at: [2, 1],
    message: /Required frontmatter field `wmxdsl` is missing/,
  },
  {
    code: "P010",
    src: "\\headline {Hi}",
    at: [5, 11],
    hint: "Remove the whitespace before `{`.",
  },
  {
    code: "P011",
    src: "Closing } brace.",
    at: [5, 9],
    message: /closes nothing/,
  },
  {
    code: "P012",
    src: "\\pullqoute{x}",
    at: [5, 1],
    hint: "Did you mean \\pullquote?",
  },
  {
    code: "P013",
    src: "\\scene{\\frame[colls=1-8]}",
    at: [5, 15],
    hint: "Did you mean `cols`?",
  },
  {
    code: "P014",
    src: "\\scene{\\frame[cols=1-8, cols=2-4]}",
    at: [5, 25],
    message: /Duplicate attribute `cols`/,
  },
  {
    code: "P015",
    src: "\\scene{\\frame[cols=8-1]}",
    at: [5, 20],
    message: /`cols` expects a range/,
  },
  {
    code: "P016",
    src: '\\scene{\\figure[alt="x"]}',
    at: [5, 8],
    message: /\\figure requires the attribute `src`/,
  },
  {
    code: "P017",
    src: "\\scene{\\frame{\\dropcap{x}}}",
    at: [5, 15],
    message: /\\dropcap takes no body/,
  },
  {
    code: "P018",
    src: "\\scene{\\frame{\\headline}}",
    at: [5, 15],
    message: /\\headline requires a body/,
  },
  {
    code: "P019",
    src: "\\scene{\\frame{\\headline{}}}",
    at: [5, 15],
    message: /\\headline has an empty body/,
  },
  {
    code: "P020",
    src: "\\scene{\\gallery{\\sidebar{x}}}",
    at: [5, 17],
    message: /\\sidebar is not allowed inside \\gallery/,
  },
  {
    code: "P021",
    src: "\\scene{\\gallery{loose text}}",
    at: [5, 17],
    message: /Text is not allowed inside \\gallery/,
  },
  {
    code: "P022",
    src: "\\headline{A\n\nB}",
    at: [5, 12],
    message: /Paragraph break inside \\headline/,
  },
  {
    code: "P023",
    src: "\\headline{A \\figure[src=/a.png] B}",
    at: [5, 13],
    message: /\\figure is a block command/,
  },
  {
    code: "P030",
    src: "An *unclosed run.",
    at: [5, 4],
    message: /never closed/,
  },
  {
    code: "P031",
    src: "**a *b** c*",
    at: [5, 7],
    message: /wrong order/,
  },
  {
    code: "P032",
    src: "An `unclosed code span.",
    at: [5, 4],
    message: /Code span is never closed/,
  },
  {
    code: "P033",
    src: "`\\frame`",
    at: [5, 2],
    hint: "Escape the backslash: write `\\\\` inside a code span.",
  },
  {
    code: "P034",
    src: "Four ****stars.",
    at: [5, 6],
    message: /four or more asterisks/,
  },
  {
    code: "P035",
    src: "[outer [inner](a) text](b)",
    at: [5, 8],
    message: /cannot contain another link/,
  },
  {
    code: "P036",
    src: "An empty `` span.",
    at: [5, 10],
    message: /Empty code span/,
  },
  {
    code: "P040",
    src: "\\story[name=main]{x}\n\\grid[cols=12]\n\\scene{\\frame[story=main]}",
    at: [6, 1],
    hint: "Move every definition above the first story, scene or content.",
  },
  {
    code: "P041",
    src: "\\scene{\\frame}\n\nA root paragraph.",
    at: [7, 1],
    hint: "Move it into a \\scene, or remove the scenes.",
  },
  {
    code: "P042",
    src: "\\scene{\n\\frame\n\nA paragraph.\n}",
    at: [8, 1],
    hint: "Move this content into a \\frame, or remove the frames and groups.",
  },
  {
    code: "P043",
    src: "\\folio{A}\n\\folio{B}\n\\scene{\\frame}",
    at: [6, 1],
    message: /More than one document-level \\folio/,
  },
  {
    code: "P044",
    src: "\\story[name=main]{x}\n\\scene{\\frame[story=main]{text}}",
    at: [6, 15],
    message: /both `story=` and a body/,
  },
  {
    code: "P045",
    src: "\\grid[cols=12]\n\nProse is not allowed.",
    kind: "theme",
    at: [3, 1],
    message: /definitions only/,
  },
];

function run(c: Case): Diagnostic[] {
  const bare =
    typeof c.src === "string" &&
    c.raw !== true &&
    (c.kind ?? "document") === "document" &&
    !c.src.startsWith("---");
  return parse(bare ? FM + (c.src as string) : c.src, {
    file: "t.wmx",
    kind: c.kind ?? "document",
  }).diagnostics;
}

describe("golden diagnostics", () => {
  for (const c of CASES) {
    it(`${c.code} at ${c.at[0]}:${c.at[1]}`, () => {
      const all = run(c);
      const hit = all.find((d) => d.code === c.code);
      expect(hit, `expected ${c.code}, got [${all.map((d) => d.code).join(", ")}]`).toBeDefined();
      expect([hit!.pos.line, hit!.pos.column]).toEqual(c.at);
      expect(hit!.severity).toBe("error");
      expect(hit!.file).toBe("t.wmx");
      if (c.hint !== undefined) expect(hit!.hint).toBe(c.hint);
      if (c.message !== undefined) expect(hit!.message).toMatch(c.message);
    });
  }

  it("covers every code in grammar §11", () => {
    const tested = new Set(CASES.map((c) => c.code));
    const missing = ALL_CODES.filter((c) => !tested.has(c));
    expect(missing).toEqual([]);
  });

  it("never throws, whatever the input", () => {
    for (const c of CASES) {
      expect(() => run(c)).not.toThrow();
    }
  });
});
