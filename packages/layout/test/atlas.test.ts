/**
 * Regression: Field Atlas (packages/playground/docs/atlas.wmx and its theme,
 * atlas.wmxt), the document that uses every construct the language has. It
 * parses, resolves with only its expected warnings, keeps every Resolved
 * Document invariant, and lays out at 33 viewport sizes with every layout
 * invariant, against objects' bare shapes.
 *
 * The last block pins what the engine does not build yet, so each shows up
 * here the day it starts working.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { format, parse, type Document, type Theme } from "@wmxdsl/parser";
import { checkInvariants } from "@wmxdsl/resolved-document";
import { resolve } from "@wmxdsl/resolver";
import { renderStatic } from "@wmxdsl/renderer";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
/** The cut-out photographs these tests are tuned to are not in the repository; without them the tests skip. */
const cutouts = existsSync(here("playground/public/img/middle.png")) && existsSync(here("playground/public/img/right.png"));
const FILE = here("playground/docs/atlas.wmx");
const THEME_SRC = readFileSync(here("playground/docs/atlas.wmxt"), "utf8");
const SRC = readFileSync(FILE, "utf8");
const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: dirname(FILE) });

const themeParse = parse(THEME_SRC, { kind: "theme" });
const docParse = parse(SRC);
const theme = themeParse.ast as Theme;
const { doc: rd, diagnostics } = resolve(docParse.ast as Document, { theme, assets });

describe("Field Atlas: build", () => {
  it("parses, theme and document, with no diagnostics at all", () => {
    expect(themeParse.diagnostics).toEqual([]);
    expect(docParse.diagnostics).toEqual([]);
  });

  it("resolves with only the warnings it asks for", () => {
    // Media and font files that are not in the repository (W050), one motion=always (W034), and its
    // accent and one muted colour just under 4.5:1 against their paper (W062, 2026-10-09).
    expect([...new Set(diagnostics.map((d) => d.code))].sort()).toEqual(["W034", "W050", "W062"]);
    expect(diagnostics.filter((d) => d.code === "W062")).toHaveLength(2);
    expect(diagnostics.filter((d) => d.code === "W034")).toHaveLength(1);
    expect(checkInvariants(rd)).toEqual([]);
  });

  it("uses every object kind it can, every scene height, and a social image", () => {
    const kinds = new Set(Object.values(rd.variants.base!.objects).map((o) => o.kind));
    expect([...kinds].sort()).toEqual(["audio", "embed", "figure", "gallery", "group", "pullquote", "sidebar", "video"]);
    expect(new Set(rd.variants.base!.scenes.map((s) => s.height))).toEqual(new Set(["flow", "screen", "page"]));
    expect(rd.meta.socialImage).toBe("image:/salt/pans-aerial.jpg");
  });

  it("formats the theme file to a fixed point (the document is covered by vector 37)", () => {
    const once = format(theme);
    expect(format(parse(once, { kind: "theme" }).ast as Theme)).toBe(once);
  });

  it("the no-script reading version carries every story's text", () => {
    // Soft hyphens (hyphenation) and HTML escaping aside.
    const html = renderStatic(rd).replace(/\u00ad/g, "").replace(/\u00a0/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    for (const phrase of ["the only crop you harvest by waiting", "Where the emptiness stopped", "forty-two levers", "salt -- misc"])
      expect(html.replace(/–/g, "--")).toContain(phrase);
  });
});

describe("Field Atlas: layout", () => {
  for (const height of [700, 900, 1440])
    it.each([360, 390, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560, 3440])(`holds every invariant at %ipx x ${height}`, (width) => {
      layoutInvariants(rd, layout(rd, { width, height }, new PrepareCache(createFixedEngine())), { standoff: false });
    });

  it("sets an object deferred past a keep-with-next subhead once (it was set twice at 1600x1440)", () => {
    const pd = layout(rd, { width: 1600, height: 1440 }, new PrepareCache(createFixedEngine()));
    const names = pd.scenes.flatMap((s) => s.objects.map((o) => o.name));
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});

describe("Field Atlas: what the engine does not build yet", () => {
  const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
  const attempt = (src: string) => () => resolve(parse(FM + src).ast as Document, { assets });
  it.each([
    ["\\lottie", '\\scene{\\lottie[src=/a.json, alt="A", cols=1-4]}'],
    ["\\blockquote", "\\story[name=s]{\\blockquote{Quoted.}}\n\\scene{\\frame[story=s]}"],
    ["\\rule in a scene", "\\scene{\\rule[cols=1-4]}"],
    ["\\rule in a group", "\\scene{\\group[cols=all]{\\rule}}"],
    ["a breakpoint override on a text element", "\\story[name=s]{\\headline[style@phone=deck]{Hi}}\n\\scene{\\frame[story=s]}"],
  ])("%s is not resolved yet", (_, src) => {
    expect(attempt(src)).toThrow(/not resolved yet/);
  });
  it.todo("a text element with span=all spans every column of a multi-column frame (resolved, not laid out)");
  it.todo("a group anchored in a story");
});

describe("Field Atlas: a viewport narrower than its margins", () => {
  it("finishes, with a finite height (row groups once divided by a zero column pitch)", () => {
    for (const width of [0, 8, 20, 24, 40]) expect(Number.isFinite(layout(rd, { width, height: 800 }, new PrepareCache(createFixedEngine())).height)).toBe(true);
  });
});

describe.skipIf(!cutouts)("a cut-out that spans a whole column", () => {
  it("sends that column's text above and below it; the columns it only cuts into wrap its outline", () => {
    const text = "Stone endures where nearly everything else decays. ".repeat(120).trim();
    const src = `---\nwmxdsl: 1\ntitle: T\n---\n\\story[name=s]{${text.slice(0, 900)}\n\n\\figure[src=/img/middle.png, alt="A portrait", cols=4-9, max-width=540px, shape=alpha, wrap=contour]\n\n${text}}\n\\scene[height=page]{\\frame[story=s, cols=all, columns=3]}`;
    const doc = resolve(parse(src).ast as Document, { assets }).doc;
    const s = layout(doc, { width: 1440, height: 900 }, new PrepareCache(createFixedEngine())).scenes[0]!;
    const box = s.objects.find((o) => o.name.startsWith("figure"))!.box;
    const beside = (c: number) => s.lines.filter((l) => l.column === c && l.y < box.y + box.height && l.y + l.height > box.y);
    expect(beside(1)).toEqual([]); // the middle column: nothing beside the portrait
    expect(beside(0).length + beside(2).length).toBeGreaterThan(0); // the outer columns wrap it
  });
});

describe.skipIf(!cutouts)("cut-outs in a banded frame (design 2026-09-29 rules 4-5)", () => {
  const text = "Stone endures where nearly everything else decays. ".repeat(120).trim();
  const src = `---\nwmxdsl: 1\ntitle: T\n---\n\\story[name=s]{${text.slice(0, 400)}\n\n\\figure[src=/img/middle.png, alt="A portrait", shape=alpha, wrap=contour]\n\n${text}}\n\\scene[height=page]{\\frame[story=s, cols=all, columns=3]}`;
  const s = layout(resolve(parse(src).ast as Document, { assets }).doc, { width: 1440, height: 900 }, new PrepareCache(createFixedEngine())).scenes[0]!;
  const fig = s.objects.find((o) => o.name.startsWith("figure"))!;
  const col = (1440 - 128 - 2 * 24) / 3;

  it("reaches into the next column, no taller than 85% of a band", () => {
    expect(fig.box.width).toBeGreaterThan(col);
    expect(fig.box.height).toBeLessThanOrEqual(0.85 * (900 - 2 * s.grid.marginY) + 1);
  });

  it("opens a column: nothing in its column above it", () => {
    const screenTop = Math.floor(fig.box.y / 900) * 900;
    const above = s.lines.filter((l) => l.story === "s" && Math.abs(l.x - fig.box.x) < 1 && l.y >= screenTop && l.y < fig.box.y);
    expect(above).toEqual([]);
  });

  it("sets no text in a gap under 6em", () => {
    for (const l of s.lines.filter((x) => x.story === "s")) expect(l.width).toBeGreaterThanOrEqual(6 * 19 - 1e-6);
  });
});

describe.skipIf(!cutouts)("a subhead beside a cut-out at a column's top (2026-09-30)", () => {
  it("drops its space above, so its column starts level with the others", () => {
    const text = "Stone endures where nearly everything else decays. ".repeat(160).trim();
    const src = `---\nwmxdsl: 1\ntitle: T\n---\n\\story[name=s]{\\figure[src=/img/right.png, alt="A lighthouse", shape=alpha, wrap=contour]\n\n\\subhead{Three families on a rock}\n\n${text}}\n\\scene[height=page]{\\frame[story=s, cols=all, columns=3]}`;
    const s = layout(resolve(parse(src).ast as Document, { assets }).doc, { width: 1440, height: 900 }, new PrepareCache(createFixedEngine())).scenes[0]!;
    const first = (c: number) => Math.min(...s.lines.filter((l) => l.story === "s" && l.column === c && l.y < 900).map((l) => l.baseline));
    expect(first(0)).toBeCloseTo(first(1), 6);
  });
});

describe("a picture taller than a band (design 2026-09-29 rule 8, extended 2026-09-30)", () => {
  // A 9:16 photograph in a 405px column is 720px tall before its caption: more than a band at 1440x900.
  const text = "Stone endures where nearly everything else decays. ".repeat(160).trim();
  it.each([[1280, 800], [1440, 900], [1920, 1080]])("narrows to 85%% of the band at %ix%i, and stays on its page", (width, height) => {
    const src = `---\nwmxdsl: 1\ntitle: T\n---\n\\story[name=s]{${text.slice(0, 300)}\n\n\\figure[src=/salt/s1.jpg, alt="A tall picture", ratio=9:16]{\\caption{A squall crossing the bay.}}\n\n\\figure[src=/salt/s2.jpg, alt="Another", ratio=4:5]\n\n${text}}\n\\scene[height=page]{\\frame[story=s, cols=all, columns=3]}`;
    const s = layout(resolve(parse(src).ast as Document, { assets }).doc, { width, height }, new PrepareCache(createFixedEngine())).scenes[0]!;
    const band = height - 2 * s.grid.marginY;
    for (const o of s.objects) {
      expect(o.box.height, o.name).toBeLessThanOrEqual(0.85 * band + 1);
      expect(Math.floor((o.box.y + o.box.height - 1) / height), o.name).toBe(Math.floor(o.box.y / height));
    }
  });
});

describe.skipIf(!cutouts)("the continuation arrow beside a cut-out (design 2026-09-29 rule 10)", () => {
  // A lighthouse cut-out in the last column: the column's last line is a short one beside the tower,
  // and the picture runs on below it.
  const text = "Stone endures where nearly everything else decays. ".repeat(160).trim();
  // At these heights the picture and its caption fill the column's foot (at 1440 wide it opens the third column).
  it.each([840, 860, 900])("sits at the column's right edge, below the picture, at 1440x%i", (height) => {
    const src = `---\nwmxdsl: 1\ntitle: T\n---\n\\story[name=s]{${text.slice(0, 1000)}\n\n\\figure[src=/img/right.png, alt="A lighthouse", shape=alpha, wrap=contour]{\\caption{Rubha Glas, the last station on the coast to be automated.}}\n\n${text}}\n\\scene[height=page]{\\frame[story=s, cols=all, columns=3]}`;
    const s = layout(resolve(parse(src).ast as Document, { assets }).doc, { width: 1440, height }, new PrepareCache(createFixedEngine())).scenes[0]!;
    const right = 1440 - 128; // the last column's right edge
    for (const c of s.continues) {
      expect(c.x).toBeCloseTo(right, 6);
      const screen = Math.floor(c.y / height);
      for (const o of s.objects.filter((x) => Math.floor(x.box.y / height) === screen && x.box.x + x.box.width > right - 1))
        expect(c.y, o.name).toBeGreaterThanOrEqual(o.box.y + o.box.height - 1e-6);
    }
  });
});
