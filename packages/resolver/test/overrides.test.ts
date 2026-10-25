/**
 * `key@breakpoint=` on story content (spec §06.3): text elements, drop caps,
 * rules, frame breaks, inline commands and the story itself take the
 * breakpoint's value in that variant only.
 */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wocument/parser";
import { checkInvariants, type Block, type ParagraphBlock, type ResolvedDocument } from "@wocument/resolved-document";
import { resolve } from "../src/index.js";

const FM = "---\nwocument: 1\ntitle: T\n---\n";
function run(body: string): ResolvedDocument {
  const p = parse(FM + body, { file: "t.woc" });
  expect(p.diagnostics).toEqual([]);
  const { doc } = resolve(p.ast as Document);
  expect(checkInvariants(doc)).toEqual([]);
  return doc;
}
const blocks = (d: ResolvedDocument, v: string): Block[] => Object.values(d.variants[v]!.stories).flatMap((s) => s.blocks);
const paras = (d: ResolvedDocument, v: string): ParagraphBlock[] => blocks(d, v).filter((b): b is ParagraphBlock => b.kind === "paragraph");
const text = (d: ResolvedDocument, p: ParagraphBlock): string => p.runs.map((r) => (r.kind === "text" ? d.strings[r.s] : "")).join("");

describe("key@breakpoint on story content", () => {
  it("a text element's style and span", () => {
    const d = run(`\\headline[style@phone=deck, span@phone=all]{Hello}\n\nText.`);
    const head = (v: string) => paras(d, v).find((p) => p.element === "headline")!;
    expect(head("base")).toMatchObject({ style: "headline", span: "column" });
    expect(head("phone")).toMatchObject({ style: "deck", span: "all" });
    expect(head("tablet").style).toBe("headline");
  });

  it("a subhead's level", () => {
    const d = run(`Text.\n\n\\subhead[level@phone=2]{A subhead}\n\nMore.`);
    expect(paras(d, "base").find((p) => p.element === "subhead")!.level).toBe(1);
    expect(paras(d, "phone").find((p) => p.element === "subhead")!.level).toBe(2);
  });

  it("a drop cap's lines and characters", () => {
    const d = run(`\\dropcap[lines=3, lines@phone=2, chars@phone=2]\nStone endures.`);
    const cap = (v: string) => paras(d, v)[0]!.dropcap!;
    expect(cap("base")).toMatchObject({ lines: 3, chars: 1 });
    expect(d.strings[cap("base").s]).toBe("S");
    expect(cap("phone")).toMatchObject({ lines: 2, chars: 2 });
    expect(d.strings[cap("phone").s]).toBe("St");
    expect(text(d, paras(d, "phone")[0]!).replaceAll("\u00ad", "")).toBe("one endures.");
  });

  it("a rule's weight and a frame break's scope", () => {
    const d = run(`\\story[name=s]{One.\n\n\\rule[weight=1px, weight@phone=4px]\n\n\\framebreak[column@phone]\n\nTwo.}\n\\scene{\\frame[story=s]}`);
    const rule = (v: string) => blocks(d, v).find((b) => b.kind === "rule") as Extract<Block, { kind: "rule" }>;
    expect(rule("base").rule.weight).toEqual({ u: "px", n: 1 });
    expect(rule("phone").rule.weight).toEqual({ u: "px", n: 4 });
    const brk = (v: string) => blocks(d, v).find((b) => b.kind === "framebreak") as Extract<Block, { kind: "framebreak" }>;
    expect(brk("base").scope).toBe("frame");
    expect(brk("phone").scope).toBe("column");
  });

  it("an inline span's style and an end mark's glyph", () => {
    const d = run(`Some \\span[style=caption, style@phone=credit]{words} here.\\endmark[glyph@phone="◆"]`);
    const runs = (v: string) => paras(d, v)[0]!.runs;
    expect(JSON.stringify(runs("base"))).toContain("span:caption");
    expect(JSON.stringify(runs("phone"))).toContain("span:credit");
    expect(JSON.stringify(runs("base"))).not.toContain("◆");
    expect(d.strings.join("")).toContain("◆");
  });

  it("the story's overset and prose style", () => {
    const d = run(`\\story[name=s, overset@phone=clip, style@phone=lede]{Prose.}\n\\scene{\\frame[story=s]}`);
    expect(d.variants.base!.stories.s).toMatchObject({ overset: "grow" });
    expect(d.variants.phone!.stories.s).toMatchObject({ overset: "clip" });
    expect(paras(d, "base")[0]!.style).toBe("body");
    expect(paras(d, "phone")[0]!.style).toBe("lede");
  });

  it("a pull quote's style", () => {
    const d = run(`Text.\n\n\\pullquote[style@phone=lede]{Quoted.}\n\nMore.`);
    const quote = (v: string) => Object.values(d.variants[v]!.stories).find((s) => s.origin === "pullquote")!.blocks[0] as ParagraphBlock;
    expect(quote("base").style).toBe("pullquote");
    expect(quote("phone").style).toBe("lede");
  });

  it("a document without overrides keeps one build of each story", () => {
    const d = run(`\\headline{Hello}\n\nText.`);
    expect(d.variants.phone!.stories).toEqual(d.variants.base!.stories);
  });
});

describe("values that had no effect", () => {
  it("a folio takes its style=, and style@phone= on phones", () => {
    const d = run(`\\folio[style=caption, style@phone=credit]{The Folio}\n\\headline{H}\n\nText.`);
    const folio = (v: string) => Object.values(d.variants[v]!.stories).find((s) => s.origin === "folio")!.blocks[0] as ParagraphBlock;
    expect(folio("base").style).toBe("caption");
    expect(folio("phone").style).toBe("credit");
  });

  it("a subhead level other than 1 or 2 warns W035 and is set as level 1", () => {
    const p = parse(`${FM}Text.\n\n\\subhead[level=3]{A}\n\nMore.`, { file: "t.woc" });
    const r = resolve(p.ast as Document);
    expect(r.diagnostics.filter((x) => x.code === "W035").map((x) => x.line)).toEqual([7]);
    expect(paras(r.doc, "base").find((b) => b.element === "subhead")!.level).toBe(1);
  });
});

describe("grid margin", () => {
  const grid = (d: ResolvedDocument, v: string) => d.variants[v]!.scenes[0]!.grid;
  it("margin= on Vanilla's default grid sets both margins, though Vanilla sets margin-x (spec §07.5)", () => {
    const d = run(`\\grid[name=default, margin=200px]\nText.`);
    expect(grid(d, "base")).toMatchObject({ marginX: { u: "px", n: 200 }, marginY: { u: "px", n: 200 } });
  });
  it("in one definition, margin-x beats margin; at a breakpoint, margin@ applies there", () => {
    const d = run(`\\grid[name=default, margin=200px, margin-x=10px, margin@phone=30px]\nText.`);
    expect(grid(d, "base")).toMatchObject({ marginX: { u: "px", n: 10 }, marginY: { u: "px", n: 200 } });
    expect(grid(d, "phone")).toMatchObject({ marginX: { u: "px", n: 30 }, marginY: { u: "px", n: 30 } });
  });
});
