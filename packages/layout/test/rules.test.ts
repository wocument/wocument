/**
 * The reading rules in layout (2026-10-07): the paragraph composer, hanging
 * punctuation and a drop cap's hung quotation mark (spec §07.6, §10.4), on the fixed-width engine.
 */
import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout, type PositionedDocument } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

/** Forty paragraphs of 20 to 59 words, so line ends fall everywhere. */
const WORDS = "the keeper wound the clock at night and counted every turn of the lens while the wind tried the glass".split(" ");
const STORY = Array.from({ length: 40 }, (_, i) => Array.from({ length: 20 + i }, (_, k) => WORDS[(i * 7 + k) % WORDS.length]).join(" ") + ".").join("\n\n");

function lay(head: string, story = STORY, width = 1440) {
  const rd = resolve(parse(`---\nwmxdsl: 1\ntitle: T\n---\n${head}\n\\story[name=main]{\n${story}\n}\n\\scene{\\frame[story=main, cols=4-9]}\n`).ast as Document).doc;
  const pd = layout(rd, { width, height: 900 }, new PrepareCache(createFixedEngine()));
  return { rd, pd };
}
const body = (pd: PositionedDocument) => pd.scenes.flatMap((s) => s.lines).filter((l) => l.style === "body");
const byBlock = (pd: PositionedDocument) => {
  const m = new Map<number, ReturnType<typeof body>>();
  for (const l of body(pd)) m.set(l.block, [...(m.get(l.block) ?? []), l]);
  return [...m.values()];
};
const runts = (pd: PositionedDocument) => byBlock(pd).filter((p) => p.length > 1 && p.at(-1)!.text.trim().split(/\s+/).length === 1).length;

describe("composer=paragraph", () => {
  it("leaves no paragraph ending on one word where the line-by-line fill leaves some", () => {
    const greedy = lay("\\style[name=body, composer=line]");
    const composed = lay("");
    expect(runts(greedy.pd)).toBeGreaterThan(0);
    expect(runts(composed.pd)).toBe(0);
    layoutInvariants(composed.rd, composed.pd);
  });

  it("hyphenates three lines in a row less often than the line-by-line fill, and hyphenates less", () => {
    const LONG = "the lighthouse keepers remembered extraordinary conversations about navigation and weather";
    const story = Array.from({ length: 30 }, (_, i) => LONG.split(" ").slice(i % 5).concat(LONG.split(" ")).join(" ") + ".").join("\n\n");
    const count = (pd: PositionedDocument) => {
      let run = 0;
      let ladders = 0;
      for (const l of body(pd)) {
        run = /\u00ad$/.test(l.text) ? run + 1 : 0;
        if (run === 3) ladders++;
      }
      return { ladders, hyphens: body(pd).filter((l) => /\u00ad$/.test(l.text)).length };
    };
    const greedy = count(lay("\\style[name=body, composer=line, hyphenate-min=5]", story).pd);
    const composed = count(lay("\\style[name=body, hyphenate-min=5]", story).pd);
    expect(composed.ladders).toBeLessThanOrEqual(greedy.ladders);
    expect(composed.ladders).toBe(0);
    expect(composed.hyphens).toBeLessThanOrEqual(greedy.hyphens);
  });

  it("keeps a closed-up line within a twentieth of an em a space", () => {
    const { pd } = lay("\\style[name=body, composer=paragraph]");
    for (const l of body(pd).filter((x) => x.measured > x.width)) {
      const spaces = (l.text.trimEnd().match(/ /g) ?? []).length;
      expect((l.measured - l.width) / spaces).toBeLessThanOrEqual(0.05 * 21 + 1e-6);
    }
  });
});

describe("hang", () => {
  const QUOTED = Array.from({ length: 12 }, () => "“Count,” she said, “and then count again, and keep counting until the morning comes.”").join(" ");

  it("an opening quotation mark at the column's edge hangs left of it; hang=none hangs nothing", () => {
    const hung = lay("\\style[name=body, hang=quotes]", QUOTED);
    const open = body(hung.pd).filter((l) => l.text.startsWith("“") && !l.paragraphStart);
    expect(open.length).toBeGreaterThan(0);
    for (const l of open) expect(l.hang?.left).toBeGreaterThan(0);
    expect(body(lay("\\style[name=body, hang=none]", QUOTED).pd).every((l) => !l.hang)).toBe(true);
    // The line box stays the slot: the mark hangs outside it, so the invariants hold.
    layoutInvariants(hung.rd, hung.pd);
  });

  it("with punctuation (the built-in body's), a justified line ending in a full stop or comma hangs it right", () => {
    const { pd } = lay("", QUOTED);
    const groups = byBlock(pd);
    const ends = groups.flatMap((p) => p.slice(0, -1)).filter((l) => /[.,]\s*$/.test(l.text));
    expect(ends.length).toBeGreaterThan(0);
    for (const l of ends) expect(l.hang?.right).toBeGreaterThan(0);
  });
});

describe("a drop cap's hung quotation mark (§10.4 quote=hang)", () => {
  it("moves the cap left by the mark's width, so the letter lines up with the text", () => {
    const story = "\\dropcap[quote=hang]\n“Nineteen lights,” he said, “and not one keeper.” " + STORY.split("\n\n")[30];
    const inside = lay("", story.replace("[quote=hang]", "[quote=inside]")).pd.scenes[0]!.caps[0]!;
    const hung = lay("", story).pd.scenes[0]!.caps[0]!;
    expect(hung.x).toBeLessThan(inside.x);
    expect(hung.width).toBe(inside.width);
  });
});

describe("balance never splits a word", () => {
  it("a balanced headline whose bound words make a wide unit still breaks between words", () => {
    // Narrow on purpose: "The keepers' great" is one unit once short words are bound.
    const rd = resolve(parse(`---\nwmxdsl: 1\ntitle: T\n---\n\\scene{\\frame[cols=all]{\\headline{The keepers' great logbooks of the northern lighthouses}}}\n`).ast as Document).doc;
    const pd = layout(rd, { width: 390, height: 844 }, new PrepareCache(createFixedEngine()));
    const heads = pd.scenes[0]!.lines.filter((l) => l.style === "headline");
    expect(heads.length).toBeGreaterThan(1);
    for (const l of heads) expect(l.measured).toBeLessThanOrEqual(l.width + 0.5);
  });
});
