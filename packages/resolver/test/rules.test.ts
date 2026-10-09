/**
 * The reading rules (2026-10-07): hyphenation limits, short words bound in display
 * text, and where a drop cap's opening quotation mark goes (spec §07.6, §10.4).
 */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { checkInvariants, type ParagraphBlock, type ResolvedDocument } from "@wmxdsl/resolved-document";
import { resolve } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
function run(body: string): ResolvedDocument {
  const p = parse(FM + body, { file: "t.wmx" });
  expect(p.diagnostics).toEqual([]);
  const { doc } = resolve(p.ast as Document);
  expect(checkInvariants(doc)).toEqual([]);
  return doc;
}
const paras = (d: ResolvedDocument): ParagraphBlock[] =>
  Object.values(d.variants.base!.stories).flatMap((s) => s.blocks.filter((b): b is ParagraphBlock => b.kind === "paragraph"));
const text = (d: ResolvedDocument, p: ParagraphBlock): string => p.runs.map((r) => (r.kind === "text" ? d.strings[r.s] : "")).join("");
const SHY = "­";

const WORDS = "Duncan walked to Glenmore in November with extraordinary patience.";

describe("hyphenate-min and hyphenate-caps", () => {
  it("the built-in body keeps names whole; hyphenate-caps=true and hyphenate-min=5 break them", () => {
    expect(text(run(WORDS), paras(run(WORDS))[0]!)).toContain("Duncan walked");
    const d = run(`\\style[name=body, hyphenate-caps=true, hyphenate-min=5]\n${WORDS}`);
    const t = text(d, paras(d)[0]!);
    expect(t).toContain(`Dun${SHY}can`);
    expect(t).toContain(`No${SHY}vem${SHY}ber`);
  });

  it("hyphenate-caps=false leaves every word that starts with a capital whole", () => {
    const d = run(`\\style[name=body, hyphenate-caps=false]\n${WORDS}`);
    const words = text(d, paras(d)[0]!).split(" ");
    expect(words.filter((w) => /^[A-Z]/.test(w)).every((w) => !w.includes(SHY))).toBe(true);
    expect(words.find((w) => w.startsWith("ex"))).toContain(SHY);
  });

  it("hyphenate-min sets the shortest word that breaks", () => {
    const d = run(`\\style[name=body, hyphenate-min=9]\nA patient walker, extraordinary.`);
    const t = text(d, paras(d)[0]!);
    expect(t).toContain("patient walker");
    expect(t).toContain(SHY);
  });
});

describe("bind-short", () => {
  it("binds each short word to the next with a no-break space, in the styles that ask", () => {
    const d = run("\\style[name=headline, bind-short]\n\\headline{A walk to the end of the wall}\n\nA walk to the end.");
    const [head, body] = paras(d);
    expect(text(d, head!)).toBe("A walk to the end of the wall");
    expect(text(d, body!)).not.toContain(" ");
  });
});

describe("a drop cap's opening quotation mark (§10.4 quote)", () => {
  const cap = (quote: string) => {
    const d = run(`\\story[name=s]{\n\\dropcap${quote ? `[quote=${quote}]` : ""}\n“Nineteen lights,” he said.\n}\n\\scene{\\frame[story=s]}`);
    const p = paras(d)[0]!;
    return { cap: d.strings[p.dropcap!.s], hang: p.dropcap!.hang, rest: text(d, p) };
  };

  it("inside sets the mark in the cap with the letter", () => {
    expect(cap("inside")).toEqual({ cap: "“N", hang: false, rest: expect.stringMatching(/^ine/) });
  });

  it("hang (the default) keeps the mark in the cap, to hang outside the column", () => {
    expect(cap("")).toMatchObject({ cap: "“N", hang: true });
    expect(cap("hang")).toMatchObject({ cap: "“N", hang: true });
  });

  it("omit leaves the mark out of the cap and the text", () => {
    const c = cap("omit");
    expect(c.cap).toBe("N");
    expect(c.rest.startsWith("“")).toBe(false);
  });
});
