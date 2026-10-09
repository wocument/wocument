/** Step 2 in the resolver: composed run styles, links, and text-bearing objects. */

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
const base = (d: ResolvedDocument) => d.variants.base!;
const firstPara = (d: ResolvedDocument, story?: string) =>
  Object.values(base(d).stories).find((s) => !story || s.id === story)!.blocks.find((b) => b.kind === "paragraph") as ParagraphBlock;

describe("composed run styles", () => {
  it("bold is 700, or 900 inside text already 700; italic flips", () => {
    // The built-in headline is regular weight: set it bold here to test the 900 step.
    const d = run("\\style[name=headline, weight=700]\\style[name=deck, italic]\nPlain **bold** and *italic*.\n\n\\headline{Big **bolder**}\n\n\\deck{Slanted *upright*}");
    const s = base(d).styles;
    expect(s["body+strong"]!.weight).toBe(700);
    expect(s["body+em"]!.italic).toBe(true);
    expect(s["headline+strong"]!.weight).toBe(900);
    expect(s["deck+em"]!.italic).toBe(false);
  });

  it("a link takes the link style's color and is underlined; code is monospace at 0.9em of its paragraph", () => {
    const d = run("See [the source](https://example.org) and `code`.");
    const s = base(d).styles;
    expect([s["body+link"]!.color, s["body+link"]!.underline]).toEqual([{ role: "accent" }, true]);
    expect(s["body+code"]!.family).toEqual(["monospace"]);
    expect(s["body+code"]!.size).toEqual({ u: "px", n: 18.9 }); // 0.9 x 21px
  });

  it("runs carry marks and a link index; nested marks compose once each", () => {
    const d = run("A [**bold link**](https://x.org) here.");
    const p = firstPara(d);
    const link = p.runs.find((r) => r.kind === "text" && r.link !== null)!;
    expect(link.kind === "text" && [link.style, link.marks, p.links[link.link!]!.href]).toEqual(["body+strong+link", ["strong"], "https://x.org"]);
  });
});

describe("objects (§11, §12.1 wrap defaults)", () => {
  const doc = run(
    [
      "\\story[name=s]{Before.\n\n\\pullquote[side=right, width=40%]{Side.}\n\nMiddle.\n\n\\pullquote{Full.}\n\nAfter.}",
      "\\scene{\\frame[story=s, cols=1-8]\n\\sidebar[cols=9-12, bg=rule, inset=1bl]{\\title{Box}\nText.}}",
    ].join("\n"),
  );
  const o = (id: string) => base(doc).objects[id]!;

  it("anchored side object: rect wrap, width as given; full: jump; grid-placed: none", () => {
    expect([o("pullquote-1").placement.mode, o("pullquote-1").wrap.mode]).toEqual(["anchored", "rect"]);
    expect(o("pullquote-1").placement).toMatchObject({ horizontal: { mode: "side", side: "right", width: { u: "pct", n: 40 } } });
    expect(o("pullquote-2").wrap.mode).toBe("jump");
    expect([o("sidebar-1").placement.mode, o("sidebar-1").wrap.mode]).toEqual(["grid", "none"]);
  });

  it("the anchor is a block of the story, and each object has its own story", () => {
    const blocks = base(doc).stories.s!.blocks.map((b) => (b.kind === "object" ? b.object : b.kind));
    expect(blocks).toEqual(["paragraph", "pullquote-1", "paragraph", "pullquote-2", "paragraph"]);
    const sb = o("sidebar-1");
    expect(sb.kind === "sidebar" && [sb.story, sb.bg, sb.inset]).toEqual(["sidebar-1#text", { role: "rule" }, { u: "bl", n: 1 }]);
    expect((base(doc).stories["sidebar-1#text"]!.blocks[0] as ParagraphBlock).style).toBe("title");
  });

  it("a scene child that is an object is listed as one", () => {
    expect(base(doc).scenes[0]!.children).toEqual([
      { kind: "frame", id: "frame-1" },
      { kind: "object", id: "sidebar-1" },
    ]);
  });
});

describe("objects in the implicit form (spec §02.2)", () => {
  it("a sidebar and a pull quote written straight into the document get ids", () => {
    const d = run("Text.\n\n\\sidebar{S}\n\n\\pullquote{Q}\n\nMore.");
    expect(Object.keys(base(d).objects).sort()).toEqual(["pullquote-1", "sidebar-1"]);
  });
});

describe("the end mark (§10.4)", () => {
  it("keeps to the story's last word: the space before it does not break", () => {
    const d = run("The last words. \\endmark");
    const p = firstPara(d);
    const text = p.runs.find((r) => r.kind === "text")!;
    expect(d.strings[(text as { s: number }).s]).toBe("The last words. ");
  });
});

describe("pull quote styles (design 2026-09-29)", () => {
  it("a cite style sets the attribution over its container", () => {
    const d = run("\\style[name=cite, size=15px, color=muted]\n\\pullquote{Q \\cite{A}}");
    const s = base(d).styles["pullquote+cite"]!;
    expect([s.size, s.color, s.italic]).toEqual([{ u: "px", n: 15 }, { role: "muted" }, false]);
  });

  it("the built-in cite style sets the attribution: smaller, upright, muted", () => {
    const s = base(run("\\pullquote{Q \\cite{A}}")).styles["pullquote+cite"]!;
    expect([s.size, s.italic, s.color]).toEqual([{ u: "px", n: 17 }, false, { role: "muted" }]);
  });

  it("hyphen-mark resolves, `end` by default", () => {
    expect(base(run("Text.")).styles.body!.hyphenMark).toBe("end");
    expect(base(run("\\style[name=body, hyphen-mark=both]\nText.")).styles.body!.hyphenMark).toBe("both");
  });
});
