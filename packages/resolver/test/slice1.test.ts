/** Rules slice 1 implements that the minimum golden file does not exercise. */

import { describe, expect, it } from "vitest";
import { parse, type Document, type Theme } from "@wmxdsl/parser";
import { checkInvariants, type ParagraphBlock, type ResolvedDocument } from "@wmxdsl/resolved-document";
import { resolve } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";

function run(body: string, theme?: string): ResolvedDocument {
  const p = parse(FM + body, { file: "t.wmx" });
  expect(p.diagnostics).toEqual([]);
  const t = theme === undefined ? null : (parse(theme, { kind: "theme" }).ast as Theme);
  const { doc } = resolve(p.ast as Document, { theme: t });
  expect(checkInvariants(doc)).toEqual([]);
  return doc;
}

/** The i-th block across the document's stories, in order (a bare document's heading has a story of its own). */
const para = (doc: ResolvedDocument, bp: string, i: number): ParagraphBlock =>
  Object.values(doc.variants[bp]!.stories).flatMap((st) => st.blocks)[i] as ParagraphBlock;
const text = (doc: ResolvedDocument, bp: string, i: number): string =>
  para(doc, bp, i).runs.map((r) => (r.kind === "text" ? doc.strings[r.s] : "\n")).join("");

describe("cascade, level by level", () => {
  it("a document's base style beats the theme's phone override", () => {
    const doc = run("\\style[name=body, size=20px]\nHello.");
    expect(doc.variants.phone!.styles.body!.size).toEqual({ u: "px", n: 20 });
  });

  it("the theme's phone override still applies when the document is silent", () => {
    const doc = run("Hello.");
    expect(doc.variants.phone!.styles.body!.size).toEqual({ u: "px", n: 18 });
    expect(doc.variants.base!.styles.body!.size).toEqual({ u: "px", n: 21 });
  });

  it("a theme file sits between the built-in theme and the document", () => {
    const doc = run("Hello.", "\\style[name=body, size=16px, color=accent]");
    expect(doc.variants.base!.styles.body!.size).toEqual({ u: "px", n: 16 });
    expect(doc.variants.base!.styles.body!.color).toEqual({ role: "accent" });
    // The built-in phone override (18px) is level 1; the theme file's base (level 2) beats it.
    expect(doc.variants.phone!.styles.body!.size).toEqual({ u: "px", n: 16 });
  });

  it("an attribute-level override wins over everything", () => {
    const doc = run("\\style[name=body, size=20px, size@phone=15px]\nHello.");
    expect(doc.variants.phone!.styles.body!.size).toEqual({ u: "px", n: 15 });
    expect(doc.variants.tablet!.styles.body!.size).toEqual({ u: "px", n: 20 });
  });

  it("an at= grid inherits what it does not set from the base definition", () => {
    const doc = run("\\grid[name=default, max=1200px]\n\\grid[name=default, at=tablet, cols=6]\nHello.");
    const g = doc.variants.tablet!.scenes[0]!.grid;
    expect(g.cols).toBe(6);
    expect(g.max).toEqual({ u: "px", n: 1200 });
  });
});

describe("lengths (D0)", () => {
  it("em of a fluid size is a scaled fluid, rounded to 4 places", () => {
    const doc = run("\\headline{Hi}");
    expect(doc.variants.base!.styles.headline!.leading).toEqual({ u: "fluid", min: 42.4, max: 76.32, from: 360, to: 1440 });
  });

  it("fluid() ends at the default grid's max", () => {
    const doc = run("\\grid[name=default, max=1200px]\n\\headline{Hi}");
    expect(doc.variants.base!.styles.headline!.size).toEqual({ u: "fluid", min: 40, max: 72, from: 360, to: 1200 });
  });

  it("bl in a style stays symbolic; bl in a grid becomes px", () => {
    const doc = run("Hello.");
    expect(doc.variants.base!.styles.body!.leading).toEqual({ u: "bl", n: 1 });
    expect(doc.variants.base!.scenes[0]!.grid.marginY).toEqual({ u: "px", n: 66 }); // 2bl of 33px
  });
});

describe("breakpoint cover", () => {
  it("custom ranges with a gap get explicit base entries", () => {
    const doc = run("\\breakpoint[name=phone, max=500px]\n\\breakpoint[name=tablet, min=800px, max=1000px]\nHello.");
    expect(doc.breakpoints).toEqual([
      { minWidth: 0, variant: "phone" },
      { minWidth: 501, variant: "base" },
      { minWidth: 800, variant: "tablet" },
      { minWidth: 1001, variant: "base" },
      { minWidth: 1024, variant: "compact" }, // the built-in theme's compact and wide breakpoints stay
      { minWidth: 1420, variant: "base" },
      { minWidth: 1800, variant: "wide" },
    ]);
  });
});

describe("text", () => {
  it("curls quotes across the paragraph and leaves escaped ones straight", () => {
    const doc = run(`She said "no" and it's 5\\" wide.`);
    expect(text(doc, "base", 0).replace(/\u00ad/g, "")).toBe("She said \u201cno\u201d and it\u2019s 5\" wide.");
  });

  it("hyphenates styles that hyphenate and leaves headlines alone", () => {
    // Lower case: the built-in body never hyphenates a capitalised word.
    const doc = run("\\headline{Fortifications}\n\nfortifications.");
    expect(text(doc, "base", 0)).toBe("Fortifications");
    expect(text(doc, "base", 1)).toBe("for\u00adti\u00adfi\u00adca\u00adtions.");
  });

  it("indents a prose paragraph that follows prose, not the first one", () => {
    const doc = run("\\style[name=body, indent=1em]\nOne.\n\nTwo.");
    expect(para(doc, "base", 0).indent).toEqual({ u: "px", n: 0 });
    expect(para(doc, "base", 1).indent).toEqual({ u: "px", n: 21 });
    expect(para(doc, "phone", 1).indent).toEqual({ u: "px", n: 18 });
  });

  it("\\br becomes a break run", () => {
    const doc = run("\\headline{Stone \\br & Strategy}");
    expect(para(doc, "base", 0).runs.map((r) => r.kind)).toEqual(["text", "break", "text"]);
  });
});

describe("not yet", () => {
  it("objects throw instead of resolving half-right", () => {
    const p = parse(FM + '\\scene{\\lottie[src=/a.json, alt="A loop"]}', { file: "t.wmx" });
    expect(() => resolve(p.ast as Document)).toThrow(/not resolved yet/);
  });
});

describe("the implicit form as a magazine page (spec §02.2, 2026-10-07)", () => {
  it("sets the leading heading elements in a heading frame and the rest in columns, on a page scene", () => {
    const doc = run("\\kicker{K}\n\\headline{Title}\n\\deck{Deck.}\n\\byline{By A}\n\nOne.\n\nTwo.");
    const v = doc.variants.base!;
    expect(v.scenes).toHaveLength(1);
    expect(v.scenes[0]!.height).toBe("page");
    const [heading, story] = v.scenes[0]!.children.map((c) => v.frames[c.id]!);
    expect(heading!.cols).toEqual({ from: 1, to: 8 });
    expect(v.stories[heading!.story]!.blocks.map((b) => (b.kind === "paragraph" ? b.element : b.kind))).toEqual(["kicker", "headline", "deck", "byline"]);
    expect(story!.cols).toEqual({ from: 1, to: 12 });
    expect([story!.columns, doc.variants.wide!.frames[story!.id]!.columns, doc.variants.tablet!.frames[story!.id]!.columns, doc.variants.phone!.frames[story!.id]!.columns]).toEqual(["auto", 4, 1, "auto"]);
    expect(story!.measure).toEqual({ u: "px", n: 600 });
    expect(doc.variants.phone!.frames[heading!.id]!.cols).toEqual({ from: 1, to: 4 });
    expect(checkInvariants(doc)).toEqual([]);
  });

  it("a document with no heading elements gets the story frame alone", () => {
    const v = run("One.\n\nTwo.").variants.base!;
    expect(v.scenes[0]!.children).toHaveLength(1);
    expect(v.frames[v.scenes[0]!.children[0]!.id]!.columns).toBe("auto");
  });
});
