/** Design 2026-09-22 §1-§2: page scenes are at least one screen tall; multi-column frames fill column bands. */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
// margin-y 2bl = 56px, row-gap = gutter = 24px. At 1280x800: first screen's text ends at 744, band 2 starts at 768.
const GRID = "\\grid[name=page, cols=12, gutter=24px, margin-x=48px, margin-y=2bl, baseline=28px, body=1-12]\n";
const LONG = "Stone endures where nearly everything else decays. ".repeat(100).trim();
export const VIEW = { width: 1280, height: 800 };

export function lay(src: string, viewport = VIEW) {
  const { doc } = resolve(parse(FM + GRID + src).ast as Document);
  return layout(doc, viewport, new PrepareCache(createFixedEngine()));
}

describe("a page scene", () => {
  it("is never shorter than the viewport", () => {
    const pd = lay("\\scene[height=page, grid=page]{\\frame{Two words.}}");
    expect(pd.scenes[0]!.height).toBe(800);
  });

  it("grows past the viewport when its content does", () => {
    const pd = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-4]}`);
    expect(pd.scenes[0]!.height).toBeGreaterThan(800);
  });
});

describe("column bands (§09.7)", () => {
  const pd = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`);
  const lines = pd.scenes[0]!.lines;
  const band1 = lines.filter((l) => l.y < 744);
  const band2 = lines.filter((l) => l.y >= 744);

  it("the first band runs to the bottom of the first screen, filling all three columns", () => {
    expect(new Set(band1.map((l) => l.column))).toEqual(new Set([0, 1, 2]));
    for (const l of band1) expect(l.y + l.height).toBeLessThanOrEqual(744 + 1e-6);
    // Full: the next line would not have fit.
    expect(Math.max(...band1.map((l) => l.y + l.height))).toBeGreaterThan(744 - 28);
  });

  it("the text continues in a second band one row-gap below", () => {
    expect(band2.length).toBeGreaterThan(0);
    expect(Math.min(...band2.map((l) => l.y))).toBeGreaterThanOrEqual(768 - 1e-6);
  });

  it("the last band is balanced", () => {
    const page = Math.floor(lines.at(-1)!.y / 800);
    const last = lines.filter((l) => Math.floor(l.y / 800) === page);
    const used = [...new Set(last.map((l) => l.column))];
    const bottoms = used.map((c) => Math.max(...last.filter((l) => l.column === c).map((l) => l.y + l.height)));
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(28 + 1e-6);
  });

  it("sets every word once, in order", () => {
    const words = lines
      .map((l) => l.text + (l.text.endsWith("­") ? "" : " "))
      .join("")
      .replace(/­/g, "")
      .split(/\s+/)
      .filter(Boolean);
    expect(words).toEqual(LONG.split(/\s+/));
  });

  it("a single-column frame is not banded: its lines are contiguous", () => {
    const one = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-4]}`).scenes[0]!.lines;
    for (let i = 1; i < one.length; i++) expect(one[i]!.y - one[i - 1]!.y).toBeLessThanOrEqual(28 + 1e-6);
  });

  it("a first band with less than a line of room starts on the next screen", () => {
    const late = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3, top=680px]}`);
    // Content top 56 + 680 = 736: 8px left above 744, so the text starts at the next screen's top, 800 + 56.
    expect(Math.min(...late.scenes[0]!.lines.map((l) => l.y))).toBeGreaterThanOrEqual(856 - 1e-6);
  });

  it("a second banded frame stacked under a long one starts its first band on its own screen, not screen 1 (regression)", () => {
    // Story s runs long enough to span several screens; story t is stacked (top=auto) right below it
    // in the same page scene. Bug: the first band's limit was always measured against screen 1's
    // bottom, which goes negative once the content top is past screen 1 -- pushing `at` up to a fixed
    // "screen 2 start" regardless of how deep the frame actually is, overlapping story s.
    const pd = lay(
      `\\story[name=s]{${LONG}}\n\\story[name=t]{${LONG}}\n` +
        "\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]\n\\frame[story=t, cols=1-12, columns=3]}",
    );
    const lines = pd.scenes[0]!.lines;
    const sLines = lines.filter((l) => l.story === "s");
    const tLines = lines.filter((l) => l.story === "t");
    expect(sLines.length).toBeGreaterThan(0);
    expect(tLines.length).toBeGreaterThan(0);
    const sMaxBottom = Math.max(...sLines.map((l) => l.y + l.height));
    const tMinTop = Math.min(...tLines.map((l) => l.y));
    // No cross-frame overlap: every line of t is below every line of s.
    expect(tMinTop).toBeGreaterThanOrEqual(sMaxBottom - 1e-6);

    // t's first band ends at the bottom of the screen its content top is on (not screen 1's).
    const marginY = 56;
    const k = Math.floor(tMinTop / VIEW.height);
    const screenBottom = (k + 1) * VIEW.height - marginY;
    expect(screenBottom).toBeGreaterThan(VIEW.height - marginY); // sanity: t really starts past screen 1
    const band1 = tLines.filter((l) => l.y < screenBottom - 1e-6);
    const band2 = tLines.filter((l) => l.y >= screenBottom - 1e-6);
    expect(band1.length).toBeGreaterThan(0);
    expect(band2.length).toBeGreaterThan(0);
    expect(Math.max(...band1.map((l) => l.y + l.height))).toBeLessThanOrEqual(screenBottom + 1e-6);
    expect(Math.min(...band2.map((l) => l.y))).toBeGreaterThan(screenBottom);
  });
});

describe("column rules (design §4)", () => {
  const src = (rule: string, text: string) =>
    `\\story[name=s]{${text}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3, ${rule}]}`;

  it("draws one line mid-gap between each pair of columns with text, per band, as tall as the band's tallest column", () => {
    const s = lay(src("column-rule=rule", LONG)).scenes[0]!;
    // Content 1184px wide from x=48; columns (1184 - 2*24) / 3 = 378.667 wide. Gaps centred at 438.667 and 841.333.
    const xs = [...new Set(s.columnRules.map((r) => Math.round(r.x * 1000) / 1000))].sort((a, b) => a - b);
    expect(xs).toEqual([438.667, 841.333]);
    // One rule per gap between columns with text, on every band.
    const pages = new Set(s.lines.map((l) => Math.floor(l.y / 800)));
    const gaps = [...pages].reduce((n, k) => n + new Set(s.lines.filter((l) => Math.floor(l.y / 800) === k).map((l) => l.column)).size - 1, 0);
    expect(s.columnRules).toHaveLength(gaps);
    for (const r of s.columnRules) {
      const inBand = s.lines.filter((l) => l.y >= r.y - 1e-6 && l.y < r.y + r.height);
      expect(r.y + r.height).toBeCloseTo(Math.max(...inBand.map((l) => l.y + l.height)), 6);
    }
  });

  it("draws nothing between columns that hold no text, and nothing without column-rule", () => {
    expect(lay(src("column-rule=rule", "A short paragraph.")).scenes[0]!.columnRules).toEqual([]);
    expect(lay(src("column-rule=none", LONG)).scenes[0]!.columnRules).toEqual([]);
  });

  it("is not inflated by a column that finishes with a moved bottom but no lines (regression)", () => {
    // A paragraph that exhausts itself in columns 1-2 can leave column 3 a "phantom" continuation:
    // fillColumn discovers there is no text left only after its epilogue (space-after) has already
    // moved its bottom, so that column reports a bottom with zero lines in it. A large space-after
    // makes that phantom bottom taller than the real text above it, so the rule must ignore it.
    const text = "Stone endures where nearly everything else decays. ".repeat(6).trim();
    const withBigSpaceAfter = `\\style[name=body, space-after=3bl]\n${src("column-rule=rule", text)}`;
    const s = lay(withBigSpaceAfter).scenes[0]!;
    expect(s.columnRules.length).toBeGreaterThan(0);
    for (const r of s.columnRules) {
      const inBand = s.lines.filter((l) => l.y >= r.y - 1e-6 && l.y < r.y + r.height);
      expect(r.y + r.height).toBeCloseTo(Math.max(...inBand.map((l) => l.y + l.height)), 6);
    }
  });
});

describe("a paragraph that ends exactly at a column's foot", () => {
  it("adds no space at the top of the next column (regression: its empty remainder did)", () => {
    // 580px columns in the fixed engine take 61 characters: this paragraph is exactly two lines,
    // and a 3bl frame holds two snapped lines but not three.
    const A = "Stone endures where nearly everything else decays. ".repeat(2).trim();
    const lines = lay(`\\story[name=s, overset=clip]{${A}\n\nNext paragraph.}\n\\scene[grid=page]{\\frame[story=s, cols=1-12, columns=2, height=3bl]}`).scenes[0]!.lines;
    expect(lines.filter((l) => l.column === 0)).toHaveLength(2);
    const next = lines.find((l) => l.column === 1)!;
    expect(next.text.trim()).toBe("Next paragraph.");
    expect(next.y).toBe(lines[0]!.y);
  });
});

describe("style balance (§07.6)", () => {
  it("breaks a headline into even lines instead of leaving one word alone", () => {
    const head = (bal: string) =>
      lay(`\\style[name=hl, size=40px, leading=48px, snap=none, ${bal}]\n\\scene[grid=page]{\\frame[cols=1-6]{\\headline[style=hl]{The keeper of the northern light stays on}}}`).scenes[0]!.lines.map((l) => l.text.trim());
    const greedy = head("balance=false");
    const even = head("balance=true");
    expect(even).toHaveLength(greedy.length);
    const spread = (ls: string[]) => Math.max(...ls.map((l) => l.length)) - Math.min(...ls.map((l) => l.length));
    expect(spread(even)).toBeLessThan(spread(greedy));
  });
});

describe("a drop cap beside an object on the column's left edge", () => {
  it("is set where the first line starts, not under the object", () => {
    const s = lay(`\\story[name=s]{\\sidebar[side=left, width=40%]{Facts about the light.}\n\n\\dropcap[lines=3]\n${LONG}}\n\\scene[grid=page]{\\frame[story=s, cols=1-6]}`).scenes[0]!;
    const box = s.objects.find((o) => o.name.startsWith("sidebar"))!.box;
    const cap = s.caps[0]!;
    expect(cap.x).toBeGreaterThanOrEqual(box.x + box.width);
    const first = s.lines.find((l) => l.story === "s")!;
    expect(first.x).toBeGreaterThanOrEqual(cap.x + cap.width);
  });
});

describe("grid outdent (§07.5)", () => {
  it("an object on the grid's outer edge reaches into the margin; text never does", () => {
    const src = `\\grid[name=page, outdent=24px]\n\\story[name=s]{\\sidebar[side=full]{Facts.}\n\n${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`;
    const s = lay(src).scenes[0]!;
    const box = s.objects.find((o) => o.name.startsWith("sidebar"))!.box;
    expect(box.x).toBeCloseTo(48 - 24, 6); // margin-x 48
    for (const l of s.lines.filter((x) => x.story === "s")) expect(l.x).toBeGreaterThanOrEqual(48 - 1e-6);
  });

  it("an inline frame on the outer edge reaches into the margin; a story frame does not (design 2026-09-29 rule 8)", () => {
    const s = lay(`\\grid[name=page, outdent=50%]\n\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\frame[cols=1-8]{\\headline{Head}}\\frame[story=s, cols=all, columns=3]}`).scenes[0]!;
    expect(Math.min(...s.lines.filter((l) => l.style === "headline").map((l) => l.x))).toBeCloseTo(24, 6);
    expect(Math.min(...s.lines.filter((l) => l.story === "s").map((l) => l.x))).toBeCloseTo(48, 6);
  });

  it("a percentage is of the side margin", () => {
    const src = `\\grid[name=page, outdent=50%]\n\\story[name=s]{\\sidebar[side=full]{Facts.}\n\n${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`;
    const box = lay(src).scenes[0]!.objects.find((o) => o.name.startsWith("sidebar"))!.box;
    expect(box.x).toBeCloseTo(24, 6); // halfway into a 48px margin
  });
});

describe("screen pages (design 2026-09-29)", () => {
  it("bands after the first start on a screen boundary, and the page is whole screens", () => {
    const s = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`).scenes[0]!;
    expect(s.height % 800).toBe(0);
    expect(s.paged).toBe(true);
    const screens = [...new Set(s.lines.map((l) => Math.floor(l.y / 800)))];
    for (const k of screens.slice(1)) {
      const top = Math.min(...s.lines.filter((l) => Math.floor(l.y / 800) === k).map((l) => l.y));
      expect(top - k * 800 - 56).toBeGreaterThanOrEqual(0); // margin-y 2bl = 56
      expect(top - k * 800 - 56).toBeLessThan(28); // the first baseline within a step
    }
  });

  it("a page scene with no column bands (one column, as on a phone) is not paged: it scrolls freely", () => {
    const s = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12]}`).scenes[0]!;
    expect(s.paged).toBe(false);
    expect(s.height % 800).not.toBe(0);
  });

  it("no band that the story carries on from ends its last column at a soft hyphen", () => {
    // Irregular text full of hyphenatable words and many screen heights, so band ends fall on hyphen breaks.
    const words = ["ex\u00adtra\u00adordi\u00adnarily", "light\u00adhouse", "keep\u00ader", "dis\u00adinte\u00adgrates", "the", "of", "stone", "every\u00adthing", "win\u00adter", "a", "night", "count\u00ading", "and"];
    const hy = Array.from({ length: 1500 }, (_, i) => words[(i * 7 + ((i * i) % 11)) % words.length]).join(" ");
    for (let height = 600; height <= 900; height += 10) {
      const s = lay(`\\story[name=s]{${hy}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`, { width: 1280, height }).scenes[0]!;
      for (const c of s.continues) {
        const k = Math.floor(c.y / height);
        const last = s.lines.filter((l) => l.column === 2 && Math.floor(l.y / height) === k).at(-1)!;
        expect(last.text.endsWith("\u00ad"), `${height}: ${last.text}`).toBe(false);
      }
    }
  });

  it("marks every band but the last with a continuation", () => {
    const s = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`).scenes[0]!;
    expect(s.continues).toHaveLength(s.height / 800 - 1);
    for (const c of s.continues) expect(c.x).toBeCloseTo(48 + 1184, 6); // the last column's right edge
  });

  it("never leaves a page holding nothing but objects: one waiting at the end of the text opens its own column", () => {
    // Pull quotes anchored near the very end, at many text lengths, so some anchors fall part-way down
    // the last column of the last band, where waiting for the next column would mean a page of its own.
    for (let n = 600; n <= 5000; n += 100) {
      const src = `\\story[name=s]{${LONG.slice(0, n)}\n\n\\pullquote{Stone keeps what water gives it.}\n\nThe end.}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`;
      const s = lay(src).scenes[0]!;
      const pages = Math.round(s.height / 800);
      for (let k = 0; k < pages; k++) {
        const on = (y: number) => y >= k * 800 && y < (k + 1) * 800;
        const text = s.lines.filter((l) => l.story === "s" && on(l.y));
        const objects = s.objects.filter((o) => on(o.box.y));
        if (objects.length) expect(text.length, `${n} characters: page ${k + 1} holds only objects`).toBeGreaterThan(0);
      }
    }
  });

  it("every page but the last ends its columns together: never more than a line apart, nearly always level (2026-09-30)", () => {
    // Subheads (kept with their text) and paragraphs of every length at 41 screen heights, so some
    // columns would end a line or three short where a subhead or a paragraph's first lines move on.
    // Vanilla's paragraphs and subheads: an indent and no space between paragraphs; a subhead is
    // one line of space and its own line. Every line is on the grid. Without the search: 66 of 171
    // pages level, 37 two lines apart or more.
    const words = LONG.split(" ");
    const blocks = Array.from({ length: 40 }, (_, i) => (i % 5 === 4 ? `\\subhead{Part ${i}}` : words.slice(0, 20 + ((i * 37) % 60)).join(" ")));
    const src = `\\style[name=body, space-after=0, indent=1em]\n\\style[name=subhead, leading=1bl, space-before=1bl, space-after=0]\n\\story[name=s]{${blocks.join("\n\n")}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`;
    let level = 0;
    let all = 0;
    for (let height = 600; height <= 1000; height += 10) {
      const s = lay(src, { width: 1280, height }).scenes[0]!;
      for (let k = 0; k < Math.round(s.height / height) - 1; k++) {
        const on = s.lines.filter((l) => l.story === "s" && l.y >= k * height && l.y < (k + 1) * height);
        const feet = [0, 1, 2].map((c) => Math.max(...on.filter((l) => l.column === c).map((l) => l.y + l.height)));
        const apart = Math.round((Math.max(...feet) - Math.min(...feet)) / 28);
        expect(apart, `${height}px, page ${k + 1}`).toBeLessThanOrEqual(1);
        level += apart === 0 ? 1 : 0;
        all++;
      }
    }
    expect(level / all).toBeGreaterThanOrEqual(0.9);
  });

  it("an object anchored mid-column opens the next column", () => {
    const s = lay(`\\story[name=s]{${LONG.slice(0, 600)}\n\n\\sidebar{Facts.}\n\n${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`).scenes[0]!;
    const box = s.objects.find((o) => o.name.startsWith("sidebar"))!.box;
    const colTop = Math.min(...s.lines.filter((l) => l.story === "s").map((l) => l.y));
    expect(box.y).toBeLessThanOrEqual(colTop + 1);
  });
});

describe("an automatic top (§09.2)", () => {
  it("is below every earlier sibling on its columns, not just the last: a short box beside a tall heading", () => {
    const head = "\\frame[cols=1-8]{\\headline{A headline long enough to take three or four lines in eight columns of this grid}}";
    const s = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{${head}\\sidebar[cols=9-12, top=0]{Short.}\\frame[story=s, cols=all, columns=3]}`).scenes[0]!;
    const headBottom = Math.max(...s.lines.filter((l) => l.style === "headline").map((l) => l.y + l.height));
    const first = Math.min(...s.lines.filter((l) => l.story === "s").map((l) => l.y));
    expect(first).toBeGreaterThanOrEqual(headBottom);
  });
});

describe("a portrait sidebar (§11.10)", () => {
  it("narrows until it is taller than wide, keeping its right edge", () => {
    const facts = "First lit in 1844. The tower is 42 metres tall, with 140 steps. ".repeat(3).trim();
    const s = lay(`\\story[name=s]{\\sidebar[side=right, width=100%, portrait]{${facts}}\n\n${LONG}}\n\\scene[grid=page]{\\frame[story=s, cols=1-6]}`).scenes[0]!;
    const box = s.objects.find((o) => o.name.startsWith("sidebar"))!.box;
    expect(box.height).toBeGreaterThanOrEqual(box.width);
    expect(box.width).toBeLessThan(580); // the 6-column slot
    expect(box.x + box.width).toBeCloseTo(48 + 580, 6);
  });
});

describe("a non-snapping block (§07.6 snap=none)", () => {
  it("rounds up to the grid only before text that snaps, not between display lines (the heading block, 2026-09-30)", () => {
    const src = `\\style[name=deck, snap=none, leading=20px, space-after=0]\n\\style[name=lede, snap=none, leading=20px, space-after=0]\n\\scene[grid=page]{\\frame[cols=1-6]{\\deck{One line.}\n\\lede{Another.}\n\nBody text on the grid.}}`;
    const lines = lay(src).scenes[0]!.lines;
    const [deck, lede, body] = [lines.find((l) => l.style === "deck")!, lines.find((l) => l.style === "lede")!, lines.find((l) => l.style === "body")!];
    expect(lede.y - deck.y).toBeCloseTo(20, 6); // the deck's own line, no round-up
    expect(Math.round(body.baseline) % 28).toBe(0); // the body's baseline back on the 28px grid
    expect(body.y).toBeGreaterThanOrEqual(lede.y + 20);
  });
});

describe("a cols= picture taller than a page (2026-10-07)", () => {
  it("never leaves a page with no text: the picture moves to the next page's top, and every word is set", () => {
    // A tall picture across both columns, anchored part-way down the first: it waits for the second
    // column's top, where its columns reach back over text already set in the first.
    const src = `\\story[name=s]{${LONG.slice(0, 900)}\n\n\\figure[src=/a.jpg, alt="A tall picture", cols=1-12, ratio=1:2]\n\n${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=2]}`;
    // Missing files on purpose: the placeholder size from ratio= stands in.
    const here = fileURLToPath(new URL(".", import.meta.url));
    const { doc } = resolve(parse(FM + GRID + src).ast as Document, { assets: createAssetHost({ publicDir: here, sourceDir: here }) });
    const pd = layout(doc, VIEW, new PrepareCache(createFixedEngine()));
    layoutInvariants(doc, pd, { standoff: false });
  });
});

describe("an object after a paragraph (§12.1 wrap-offset, 2026-10-07)", () => {
  it("starts at least its standoff below the line above, with no space between paragraphs", () => {
    const src = `\\style[name=body, space-after=0]\n\\story[name=s]{${LONG.slice(0, 300)}\n\n\\pullquote[side=right, width=50%, wrap=rect, wrap-offset=1bl]{Stone keeps what water gives it.}\n\n${LONG.slice(0, 600)}}\n\\scene[grid=page]{\\frame[story=s, cols=1-6]}`;
    const s = lay(src).scenes[0]!;
    const pq = s.objects.find((o) => o.name.startsWith("pullquote"))!;
    // The paragraph before the quote (block 0); text after it may wrap beside the quote from above its top.
    const above = s.lines.filter((l) => l.story === "s" && l.block === 0).at(-1)!;
    expect(pq.box.y - (above.y + above.height)).toBeGreaterThanOrEqual(28 - 1e-6);
  });
});

describe("min-slot (§07.6, 2026-10-07)", () => {
  // A fact box 60% of a 4-column frame's 580px leaves a gap of about 220px beside it: 11em of 20px text.
  const src = (slot: string) =>
    `\\style[name=body, size=20px${slot}]\n\\story[name=s]{\\sidebar[side=right, width=62%]{${"Facts and figures. ".repeat(30)}}\n\n${LONG}}\n\\scene[grid=page]{\\frame[story=s, cols=1-6]}`;
  const beside = (slot: string) => {
    const s = lay(src(slot)).scenes[0]!;
    const box = s.objects.find((o) => o.name.startsWith("sidebar"))!.box;
    return s.lines.filter((l) => l.story === "s" && l.y < box.y + box.height && l.y + l.height > box.y);
  };
  it("defaults to 6em: text runs in the strip beside the box", () => {
    expect(beside("").length).toBeGreaterThan(0);
  });
  it("a wider minimum leaves the strip empty, and the text goes below the box", () => {
    expect(beside(", min-slot=12em")).toEqual([]);
  });
});

describe("a pull quote's mark (§07.6)", () => {
  it("takes room above the quote's text and is reported for the renderer", () => {
    const s = lay(`\\style[name=pullquote, size=20px, mark="“"]\n\\story[name=s]{\\pullquote{Stone keeps what water gives it.}\n\n${LONG}}\n\\scene[grid=page]{\\frame[story=s, cols=1-6]}`).scenes[0]!;
    const pq = s.objects.find((o) => o.name.startsWith("pullquote"))!;
    expect(pq.mark).toEqual({ text: "“", size: 60 });
    const first = s.lines.find((l) => l.story !== "s")!;
    expect(first.y).toBeGreaterThanOrEqual(pq.box.y + 27); // 0.45 of the 60px mark
  });
});

describe("a two-character pull quote mark (design 2026-09-29)", () => {
  it("closes the quote after its last word, as large as the opening mark, level with the last line's capitals", () => {
    const s = lay(`\\style[name=pullquote, size=20px, mark="“”"]\n\\story[name=s]{\\pullquote{Stone keeps what water gives it.}\n\n${LONG}}\n\\scene[grid=page]{\\frame[story=s, cols=1-6]}`).scenes[0]!;
    const pq = s.objects.find((o) => o.name.startsWith("pullquote"))!;
    const last = s.lines.filter((l) => l.story !== "s").at(-1)!;
    expect(pq.mark!.close).toMatchObject({ text: "”", y: last.baseline - 14, size: 60 }); // cap height 0.7 of 20px
    expect(pq.mark!.close!.x).toBeGreaterThan(last.x + last.measured);
  });

  it("sets the quote narrower when the closing mark would not fit after a full last line", () => {
    const full = "Stone keeps what water gave"; // one full line at the fixed engine's 10px a character
    const s = lay(`\\style[name=pullquote, size=20px, mark="“”", balance=false]\n\\story[name=s]{\\pullquote[width=100%]{${full}}\n\n${LONG}}\n\\scene[grid=page]{\\frame[story=s, cols=1-3]}`).scenes[0]!;
    const pq = s.objects.find((o) => o.name.startsWith("pullquote"))!;
    expect(pq.mark!.close!.x + 0.45 * 60).toBeLessThanOrEqual(pq.box.x + pq.box.width + 1e-6);
  });
});

describe("balancing a short remainder", () => {
  it("does not split three lines one per column (a lone line breaks widows and orphans)", () => {
    // Three lines at the fixed engine's 40 characters a line in 379px columns.
    const three = "Stone endures where nearly everything else decays. ".repeat(2).trim();
    const s = lay(`\\story[name=s]{${three}}\n\\scene[grid=page]{\\frame[story=s, cols=1-12, columns=3]}`).scenes[0]!;
    expect(s.lines.map((l) => l.column)).toEqual([0, 0, 0]);
  });
});

describe("a frame with wrap=rect (§09.2)", () => {
  it("cuts into the frames set after it: columns under it start below, the rest at the top", () => {
    const head = "\\frame[cols=1-8, wrap=rect, wrap-offset=1bl]{\\headline{The keeper of the northern light, a long headline over two columns}}";
    const s = lay(`\\story[name=s]{${LONG}}\n\\scene[height=page, grid=page]{${head}\\frame[story=s, cols=all, top=0, columns=3]}`).scenes[0]!;
    const headBottom = Math.max(...s.lines.filter((l) => l.style === "headline").map((l) => l.y + l.height));
    const first = (c: number) => Math.min(...s.lines.filter((l) => l.story === "s" && l.column === c).map((l) => l.y));
    expect(first(2)).toBeLessThan(headBottom); // beside the heading, from the top
    expect(first(0)).toBeGreaterThanOrEqual(headBottom + 28 - 1e-6); // under it, a baseline step away
    expect(first(1)).toBeGreaterThanOrEqual(headBottom + 28 - 1e-6);
    // Beside it, the column keeps its own left edge: the offset is below the frame, not at its sides.
    const col2 = s.lines.filter((l) => l.story === "s" && l.column === 2);
    expect(new Set(col2.map((l) => l.x)).size).toBe(1);
  });
});

describe("objects waiting for the next column", () => {
  it("only the first is set whatever its height; the rest never run past a band's foot over text (regression)", () => {
    // Two objects close together near a column's foot both wait for the next column. Forcing the
    // second in below the first once ran it past the band's foot, over the next band's first lines.
    const P = "Stone endures where nearly everything else decays. ".repeat(6).trim();
    const QUOTE = "Stone keeps what water gives it, and gives back nothing it has kept.";
    const src = `\\story[name=s]{${P}\n\n${P}\n\n\\pullquote{${QUOTE} ${QUOTE}}\n\n\\sidebar[side=full]{${P}}\n\n${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`;
    for (let height = 560; height <= 1000; height += 20) {
      const s = lay(src, { width: 1280, height }).scenes[0]!;
      for (const o of s.objects)
        for (const l of s.lines.filter((x) => x.story === "s")) {
          const b = o.box;
          const hit = l.x < b.x + b.width - 1 && l.x + l.width > b.x + 1 && l.y < b.y + b.height - 1 && l.y + l.height > b.y + 1;
          expect(hit, `${o.name} over "${l.text}" at height ${height}`).toBe(false);
        }
    }
  });
});

describe("fitted text (design §5)", () => {
  // A 6-column frame at 1280: 6 * 76.667 + 5 * 24 = 580px.
  const W = 580;
  const HEAD = "The tide tables are wrong";
  const fitted = (styleAttrs: string) =>
    lay(`\\style[name=hl, size=20px, leading=28px, snap=none, fit=width, ${styleAttrs}]\n\\scene[height=page, grid=page]{\\frame[cols=1-6]{\\headline[style=hl]{${HEAD}}}}`)
      .scenes[0]!.lines;
  /** Greedy wrap in the fixed engine: the line count at a size, or Infinity when a word overflows. */
  const linesAt = (size: number): number => {
    const words = HEAD.split(" ").map((w) => w.length * 0.5 * size);
    const space = 0.5 * size;
    let n = 1;
    let x = 0;
    for (const w of words) {
      if (w > W) return Number.POSITIVE_INFINITY;
      if (x > 0 && x + space + w > W) (n++, (x = w));
      else x += (x > 0 ? space : 0) + w;
    }
    return n;
  };

  it("grows to the largest size at which no word overflows, within fit-max", () => {
    const lines = fitted("fit-max=400px");
    // Longest word "tables" is 6 characters: 6 * 0.5 * s <= 580, so s = 193.
    expect(lines.every((l) => l.size === 193)).toBe(true);
    expect(linesAt(193)).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(linesAt(194)).toBe(Number.POSITIVE_INFINITY);
  });

  it("stops at fit-max", () => {
    expect(fitted("fit-max=60px").every((l) => l.size === 60)).toBe(true);
  });

  it("stays under fit-height, and one pixel more would not", () => {
    const lines = fitted("fit-max=400px, fit-height=200px");
    const size = lines[0]!.size!;
    const leading = (28 * size) / 20;
    expect(lines.length * leading).toBeLessThanOrEqual(200 + 1e-6);
    expect(linesAt(size + 1) * ((28 * (size + 1)) / 20)).toBeGreaterThan(200);
    for (const l of lines) expect(l.height).toBeCloseTo(leading, 6);
  });

  it("an unfitted style sets no size", () => {
    const lines = lay("\\scene[height=page, grid=page]{\\frame[cols=1-6]{\\headline{Plain}}}").scenes[0]!.lines;
    expect(lines[0]!.size).toBeUndefined();
  });
});

describe("an anchored object taller than a band (§09.7 rule 5, W043)", () => {
  // A band is viewport.height - 2*margin-y = 800 - 112 = 688px. A full-width sidebar at the top
  // of the story, with enough text, is taller than that -- layout has no diagnostics channel, so
  // there is no W043 to assert (see the limit note at the band code); what must hold is that
  // layout still terminates, places the sidebar once, and sets every word of the story once.
  const SIDEBAR = "Sidebar filler sentence that takes some room. ".repeat(30).trim();

  it("terminates, places the object once at the band's top, and sets every word once", () => {
    const src =
      `\\story[name=s]{\\sidebar[side=full]{${SIDEBAR}}\n\n${LONG}}\n` + "\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}";
    const { doc } = resolve(parse(FM + GRID + src).ast as Document);
    const pd = layout(doc, VIEW, new PrepareCache(createFixedEngine()));

    const sidebars = pd.scenes[0]!.objects.filter((o) => o.name === "sidebar-1");
    expect(sidebars).toHaveLength(1);
    expect(sidebars[0]!.box.height).toBeGreaterThan(688); // taller than a band
    expect(sidebars[0]!.box.y).toBe(56); // set at the band's top (content top of the frame)

    layoutInvariants(doc, pd);
  });
});

describe("an anchored object that crosses into the next band", () => {
  it("keeps cutting that band's text: its exclusion carries over (§09.7, §12)", () => {
    // Two paragraphs push the anchor near the bottom of band 1; the tall rect sidebar in the
    // middle columns hangs into band 2, where the text must still go around it.
    const para = "Stone endures where nearly everything else decays. ".repeat(24).trim();
    const tall = "\\sidebar[cols=5-8, wrap=rect, wrap-side=both]{" + Array.from({ length: 30 }, (_, i) => `Line ${i}.`).join("\n\n") + "}";
    const pd = lay(`\\story[name=s]{${para}\n\n${para}\n\n${tall}\n\n${LONG}}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`);
    const s = pd.scenes[0]!;
    const box = s.objects.find((o) => o.name === "sidebar-1")!.box;
    expect(box.y + box.height).toBeGreaterThan(768); // it reaches into band 2
    for (const l of s.lines.filter((l) => l.story === "s" && l.y < box.y + box.height && l.y + l.height > box.y))
      expect(l.x + l.width <= box.x + 1e-6 || l.x >= box.x + box.width - 1e-6, `"${l.text}" at y=${l.y}`).toBe(true);
  });
});

describe("an anchored object that does not fit (§11.3)", () => {
  it("moves to the top of the next column, and the text after it continues without a gap", () => {
    const para = "Stone endures where nearly everything else decays. ".repeat(30).trim();
    const tall = "\\sidebar{" + Array.from({ length: 12 }, (_, i) => `Line ${i}.`).join("\n\n") + "}";
    const pd = lay(`\\story[name=s]{${para}\n\n${tall}\n\nThe tail paragraph continues here.}\n\\scene[height=page, grid=page]{\\frame[story=s, cols=1-12, columns=3]}`);
    const s = pd.scenes[0]!;
    const main = s.lines.filter((l) => l.story === "s");
    const beforeAnchor = main.filter((l) => l.block === 0);
    const tail = main.find((l) => l.text.startsWith("The tail"))!;
    const side = s.objects.find((o) => o.name === "sidebar-1")!;
    const lastBefore = beforeAnchor.at(-1)!;
    // The tail stays in the column where the paragraph ended, right below it.
    expect(tail.column).toBe(lastBefore.column);
    expect(tail.y).toBeGreaterThan(lastBefore.y);
    expect(tail.y - (lastBefore.y + lastBefore.height)).toBeLessThanOrEqual(28 * 2 + 1e-6);
    // The sidebar opens the next column, at the band's top.
    const nextCol = main.filter((l) => l.column === lastBefore.column + 1);
    expect(side.box.x).toBeGreaterThan(lastBefore.x + lastBefore.width);
    expect(side.box.y).toBeLessThanOrEqual(Math.min(...main.map((l) => l.y)) + 28);
    expect(nextCol.every((l) => l.y >= side.box.y + side.box.height - 1e-6)).toBe(true);
  });
});
