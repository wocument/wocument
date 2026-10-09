/** Slice 2: explicit scenes, stories, parents, tokens, linearize, reveals, folios. */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { checkInvariants, type ParagraphBlock, type ResolvedDocument } from "@wmxdsl/resolved-document";
import { resolve } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";

function run(body: string) {
  const p = parse(FM + body, { file: "t.wmx" });
  expect(p.diagnostics).toEqual([]);
  const r = resolve(p.ast as Document, { file: "t.wmx" });
  expect(checkInvariants(r.doc)).toEqual([]);
  return r;
}
const base = (doc: ResolvedDocument) => doc.variants.base!;

describe("scenes, stories and threads", () => {
  it("threads a story through frames in scene order, skipping hidden frames per breakpoint", () => {
    const { doc } = run(
      "\\story[name=s]{One.\n\n\\framebreak\n\nTwo.}\n\\scene[name=a]{\\frame[story=s]}\n\\scene[name=b]{\\frame[story=s, hide@phone]\n\\frame[story=s]}",
    );
    expect(base(doc).threads.s).toEqual(["frame-1", "frame-2", "frame-3"]);
    expect(doc.variants.phone!.threads.s).toEqual(["frame-1", "frame-3"]);
    expect(doc.variants.phone!.frames["frame-2"]!.hidden).toBe(true);
  });

  it("a shorthand scene gets a default frame on the grid's body columns", () => {
    const { doc } = run("\\scene[name=x]{Hello.}");
    expect(base(doc).scenes[0]!.children).toEqual([{ kind: "frame", id: "x/frame" }]);
    expect(base(doc).frames["x/frame"]!.cols).toEqual({ from: 4, to: 9 });
    expect(base(doc).frames["x/frame"]!.story).toBe("x/frame#text");
  });

  it("a story with no visible frame at a breakpoint is an error (§09.3)", () => {
    const p = parse(FM + "\\story[name=s]{x}\n\\scene{\\frame[story=s, hide@phone]}", { file: "t.wmx" });
    expect(() => resolve(p.ast as Document)).toThrow(/no visible frame on phone/);
  });
});

describe("parents (§08.4) and tokens (§07.2)", () => {
  it("a scene inherits its parent's attributes, its own override, and a token reaches the palette", () => {
    const { doc } = run(
      "\\token[name=hot, value=#ff0000]\n\\palette[name=p, accent=$hot]\n\\parent[name=m, height=screen, palette=p, snap=hard]\n\\scene[parent=m, snap=soft]{\\frame{x}}",
    );
    const s = base(doc).scenes[0]!;
    expect([s.height, s.snap, s.parent, s.palette.accent]).toEqual(["screen", "soft", "m", "#ff0000ff"]);
    expect(s.palette.paper).toBe("#f6f7f8ff"); // unset roles fall back to the default palette
  });

  it("a scene that declares frames does not inherit its parent's", () => {
    const { doc } = run("\\parent[name=m]{\\frame{from parent}}\n\\scene[parent=m]{\\frame{own}}");
    expect(base(doc).scenes[0]!.children.map((c) => c.id)).toEqual(["frame-2"]);
  });

  // The other half needs a scene with only objects, which arrive with objects.
  it.todo("a scene with only objects inherits its parent's frames, as <scene>/<frame>");

  it("a parent's folio replaces the document's for its scenes", () => {
    const { doc } = run("\\parent[name=m]{\\folio{Interlude}}\n\\folio{Main}\n\\scene[name=a]{\\frame{x}}\n\\scene[name=b, parent=m]{\\frame{y}}\n\\scene[name=c, folio=hide]{\\frame{z}}");
    const folios = base(doc).scenes.map((s) => s.folio?.story ?? null);
    expect(folios).toEqual(["folio#text", "m#folio", null]);
  });
});

describe("linearize (§07.5)", () => {
  it("a frame that does not fit linearizes its scene at that breakpoint, with W031", () => {
    const { doc, diagnostics } = run("\\scene[name=s]{\\frame[cols=9-12]{x}}");
    expect(doc.variants.phone!.scenes[0]!.linearized).toBe(true);
    expect(doc.variants.phone!.frames["frame-1"]!.cols).toEqual({ from: 1, to: 4 });
    expect(base(doc).scenes[0]!.linearized).toBe(false);
    expect(diagnostics.map((d) => [d.code, d.variant])).toEqual([["W031", "tablet"], ["W031", "phone"]]);
  });

  it("a hidden frame does not trigger it", () => {
    const { doc, diagnostics } = run("\\scene{\\frame[cols=1-4]{x}\n\\frame[cols=9-12, hide@tablet, hide@phone]{y}}");
    expect(doc.variants.phone!.scenes[0]!.linearized).toBe(false);
    expect(diagnostics).toEqual([]);
  });

  it("in a screen scene, linearized frames take flow placement", () => {
    const { doc } = run("\\scene[height=screen]{\\frame[cols=9-12, rows=2-3]{x}}");
    expect(doc.variants.phone!.frames["frame-1"]!.vertical).toEqual({ mode: "flow", top: "auto", height: "auto" });
    expect(base(doc).frames["frame-1"]!.vertical).toEqual({ mode: "rows", rows: { from: 2, to: 3 } });
  });

  it("snap=hard on a flow scene becomes soft, with W030", () => {
    const { doc, diagnostics } = run("\\scene[snap=hard]{\\frame{x}}");
    expect(base(doc).scenes[0]!.snap).toBe("soft");
    expect(diagnostics.map((d) => d.code)).toEqual(["W030"]);
  });
});

describe("story content", () => {
  it("a drop cap takes its graphemes, and an opening quote, out of the paragraph", () => {
    const { doc } = run('\\story[name=s]{\\dropcap[lines=2]\n"Stone endures."}\n\\scene{\\frame[story=s]}');
    const b = base(doc).stories.s!.blocks[0] as ParagraphBlock;
    expect(doc.strings[b.dropcap!.s]).toBe("\u201cS");
    expect(b.runs[0]!.kind === "text" && doc.strings[b.runs[0]!.s]!.replace(/\u00ad/g, "")).toBe("tone endures.\u201d");
    expect(b.dropcap!.lines).toBe(2);
  });

  it("stagger: children without their own enter take the scene's, one step apart", () => {
    const { doc } = run("\\scene[enter=fade, stagger=100ms]{\\frame{a}\n\\frame[enter=rise]{b}\n\\frame{c}}");
    const r = (id: string) => base(doc).frames[id]!.reveal;
    expect([r("frame-1").enter, r("frame-1").delayMs]).toEqual(["fade", 0]);
    expect([r("frame-2").enter, r("frame-2").delayMs]).toEqual(["rise", 0]);
    expect([r("frame-3").enter, r("frame-3").delayMs]).toEqual(["fade", 100]);
  });
});

describe("motion=always (§13 rule 3)", () => {
  it("is a warning, W034, wherever it appears", () => {
    const src = '---\nwmxdsl: 1\ntitle: T\n---\n\\scene{\\frame[enter=fade, motion=always]{Moving.}}';
    const { diagnostics } = resolve(parse(src).ast as Document);
    expect(diagnostics.filter((d) => d.code === "W034")).toHaveLength(1);
  });
});

describe("page scenes (design 2026-09-22 §1, §3)", () => {
  const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
  const scene = (attrs: string) => resolve(parse(`${FM}\\scene[${attrs}]{\\frame{Text.}}`).ast as Document);

  it("height=page resolves, does not snap by default (2026-10-09), and keeps flow placements", () => {
    const { doc } = scene("height=page");
    const s = doc.variants.base!.scenes[0]!;
    expect([s.height, s.snap, s.turn]).toEqual(["page", "none", null]);
    expect(doc.variants.base!.frames["frame-1"]!.vertical.mode).toBe("flow");
  });

  it("an explicit snap on a page scene is kept, and hard is not downgraded", () => {
    const none = scene("height=page, snap=none");
    expect(none.doc.variants.base!.scenes[0]!.snap).toBe("none");
    const hard = scene("height=page, snap=hard");
    expect(hard.doc.variants.base!.scenes[0]!.snap).toBe("hard");
    expect(hard.diagnostics.filter((d) => d.code === "W030")).toEqual([]);
  });

  it("turn takes the scene's duration and ease", () => {
    const { doc } = scene("height=page, turn=slide, duration=450ms, ease=out");
    expect(doc.variants.base!.scenes[0]!.turn).toEqual({ effect: "slide", durationMs: 450, ease: "out" });
  });

  it("a snap@wide override applies at wide only; base keeps no snap", () => {
    const { doc } = resolve(
      parse(`${FM}\\breakpoint[name=wide, min=1920px]\n\\scene[height=page, snap@wide=hard]{\\frame{Text.}}`).ast as Document,
    );
    expect(doc.variants.base!.scenes[0]!.snap).toBe("none");
    expect(doc.variants.wide!.scenes[0]!.snap).toBe("hard");
  });
});
