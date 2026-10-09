/** Step 2 in layout: anchored objects, rectangular wrap and slots (§09.6, §11.3, §12), fragments. */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout, type PositionedScene } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const LONG = Array.from({ length: 12 }, () => "Stone endures where nearly everything else decays.").join(" ");

function scene(body: string, width = 1470): PositionedScene {
  const { doc } = resolve(parse(FM + body).ast as Document);
  return layout(doc, { width, height: 900 }, new PrepareCache(createFixedEngine())).scenes[0]!;
}

describe("an anchored side object with rect wrap", () => {
  const s = scene(`\\story[name=s]{\\pullquote[side=right, width=40%]{Quoted.}\n\n${LONG}}\n\\scene{\\frame[story=s, cols=1-8]}`);
  const pq = s.objects.find((o) => o.name === "pullquote-1")!;
  const beside = s.lines.filter((l) => l.story === "s" && l.y < pq.box.y + pq.box.height && l.y + l.height > pq.box.y);
  const below = s.lines.filter((l) => l.story === "s" && l.y >= pq.box.y + pq.box.height + pq.exclusion!.offset);

  it("sits at the right of the column, anchored where the story put it", () => {
    expect(pq.anchoredAt).toBe(pq.box.y);
    expect(pq.box.x + pq.box.width).toBeCloseTo(Math.max(...s.lines.filter((l) => l.story === "s").map((l) => l.x + l.width)), 6);
  });

  it("lines beside it stop at its left edge less the standoff", () => {
    expect(beside.length).toBeGreaterThan(0);
    for (const l of beside) expect(l.x + l.width).toBeLessThanOrEqual(pq.box.x - pq.exclusion!.offset + 1e-6);
  });

  it("lines below it take the full column again", () => {
    expect(below.length).toBeGreaterThan(0);
    expect(Math.max(...below.map((l) => l.width))).toBeGreaterThan(Math.max(...beside.map((l) => l.width)));
  });

  it("its own text is laid out inside its box, framed by its id", () => {
    const own = s.lines.filter((l) => l.frame === "pullquote-1");
    expect(own.map((l) => l.text.trim())).toEqual(["Quoted."]);
    expect(own[0]!.x).toBeGreaterThanOrEqual(pq.box.x - 1e-6);
  });
});

describe("a full-width anchored object jumps the text", () => {
  it("no line overlaps it; the text resumes below it", () => {
    const s = scene(`\\story[name=s]{First.\n\n\\pullquote{Quoted.}\n\n${LONG}}\n\\scene{\\frame[story=s, cols=1-8]}`);
    const pq = s.objects[0]!;
    for (const l of s.lines.filter((x) => x.story === "s")) {
      const overlaps = l.y < pq.box.y + pq.box.height && l.y + l.height > pq.box.y;
      expect(overlaps).toBe(false);
    }
  });
});

describe("wrap-side=both sets two lines on one band", () => {
  it("a narrow centred object leaves slots on both sides", () => {
    const s = scene(
      `\\story[name=s]{${LONG}}\n\\scene{\\frame[story=s, cols=1-12]\n\\sidebar[cols=6-7, top=0, wrap=rect, wrap-side=both]{X}}`,
    );
    const byY = new Map<number, number>();
    for (const l of s.lines.filter((x) => x.story === "s")) byY.set(l.y, (byY.get(l.y) ?? 0) + 1);
    expect([...byY.values()].some((n) => n === 2)).toBe(true);
  });
});

describe("mixed-style lines carry fragments", () => {
  it("fragments join to the line's text and name the block's runs", () => {
    const s = scene("\\scene{\\frame{Plain text, *italic words*, **bold words** and plain again.}}");
    const l = s.lines[0]!;
    expect(l.fragments.map((f) => f.text).join("")).toBe(l.text);
    expect(new Set(l.fragments.map((f) => f.run)).size).toBeGreaterThan(2);
  });
});

describe("a forced line break (\\br)", () => {
  it("puts the next piece on the very next line, with no blank line between", () => {
    const s = scene("\\scene{\\frame{\\headline{Stone \\br & Strategy}}}");
    const [a, b] = s.lines;
    expect([a!.text.trim(), b!.text.trim()]).toEqual(["Stone", "& Strategy"]);
    expect(b!.y).toBeCloseTo(a!.y + a!.height, 6);
  });
});

describe("found by the stress-test articles", () => {
  const lay = (src: string, width = 1470) => {
    const { doc, diagnostics } = resolve(parse(FM + src).ast as Document);
    return { pd: layout(doc, { width, height: 900 }, new PrepareCache(createFixedEngine())), diagnostics };
  };

  it("a \\framebreak in the thread's last frame is ignored; the text after it is still set", () => {
    const { pd } = lay("\\story[name=s]{Before the break.\n\n\\framebreak\n\nAfter the break.}\n\\scene{\\frame[story=s]}");
    expect(pd.scenes[0]!.lines.map((l) => l.text.trim())).toEqual(["Before the break.", "After the break."]);
  });

  /** Lines of frames that run into a wrapping object's box. */
  const intrusions = (pd: ReturnType<typeof lay>["pd"]) =>
    pd.scenes.flatMap((sc) =>
      sc.objects.flatMap((o) =>
        sc.lines.filter((l) => {
          const b = o.exclusion?.box;
          if (!b || l.frame === o.name || l.y >= b.y + b.height - 1e-6 || l.y + l.height <= b.y + 1e-6) return false;
          return !(l.x + l.width <= b.x + 1e-6 || l.x >= b.x + b.width - 1e-6);
        }),
      ),
    );
  const quote = "\\pullquote[cols=5-8, wrap=rect, wrap-side=both]{Across both columns.}";

  it("pin and reflow (§11.3): an object anchored in column 2 that reaches back into column 1 is pinned and the frame set again", () => {
    const { pd } = lay(`\\story[name=s]{${LONG}\n\n${LONG}\n\n${quote}\n\n${LONG}}\n\\scene{\\frame[story=s, cols=1-12, columns=2, balance=true]}`);
    expect(pd.scenes[0]!.lines.some((l) => l.column === 1 && l.y < pd.scenes[0]!.objects[0]!.box.y)).toBe(true); // anchored in column 2
    expect(intrusions(pd)).toEqual([]);
  });

  it("an object anchored in column 1 cuts into column 2 too", () => {
    const { pd } = lay(`\\story[name=s]{${LONG}\n\n${quote}\n\n${LONG}\n\n\\framebreak[column]\n\n${LONG}\n\n${LONG}}\n\\scene{\\frame[story=s, cols=1-12, columns=2]}`);
    expect(intrusions(pd)).toEqual([]);
  });

  it("an anchored cols=all fits the grid and does not linearize", () => {
    const { diagnostics } = lay(`\\story[name=s]{${LONG}\n\n\\sidebar[cols=all]{Box.}}\n\\scene{\\frame[story=s]}`);
    expect(diagnostics.filter((d) => d.code === "W031")).toEqual([]);
  });
});

describe("widows and orphans (§07.6)", () => {
  it("a paragraph split between frames leaves at least two lines on each side, at every frame height", () => {
    const para = "The work is mostly waiting, and then it is not. ".repeat(5);
    const src = `\\story[name=s]{${[1, 2, 3, 4].map(() => para).join("\n\n")}}\n`;
    for (let h = 3; h <= 20; h++) {
      const { doc } = resolve(parse(`${FM}${src}\\scene{\\frame[story=s, height=${h}bl]\n\\frame[story=s]}`).ast as Document);
      const pd = layout(doc, { width: 1470, height: 900 }, new PrepareCache(createFixedEngine()));
      const lines = pd.scenes[0]!.lines;
      for (const block of new Set(lines.map((l) => l.block))) {
        const parts = ["frame-1", "frame-2"].map((f) => lines.filter((l) => l.block === block && l.frame === f).length);
        if (parts[0]! > 0 && parts[1]! > 0) expect(Math.min(...parts), `height ${h}bl, block ${block}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("side=center (2026-10-09)", () => {
  const story = (w: string) => `\\story[name=s]{\\pullquote[side=center, width=${w}]{Quoted.}\n\n${LONG}}\n`;

  it("sits centred in its column, with text on both sides where the gaps are wide enough", () => {
    const s = scene(story("30%") + "\\scene{\\frame[story=s, cols=1-12]}");
    const pq = s.objects.find((o) => o.name === "pullquote-1")!;
    const text = s.lines.filter((l) => l.story === "s");
    const left = Math.min(...text.map((l) => l.x));
    const right = Math.max(...text.map((l) => l.x + l.width));
    expect(pq.box.x - left).toBeCloseTo(right - (pq.box.x + pq.box.width), 6);
    const beside = text.filter((l) => l.y < pq.box.y + pq.box.height && l.y + l.height > pq.box.y);
    expect(beside.some((l) => l.x + l.width <= pq.box.x)).toBe(true);
    expect(beside.some((l) => l.x >= pq.box.x + pq.box.width)).toBe(true);
  });

  it("where the gaps are too narrow for text, the text goes above and below it instead", () => {
    const s = scene(story("80%") + "\\scene{\\frame[story=s, cols=1-6]}");
    const pq = s.objects.find((o) => o.name === "pullquote-1")!;
    const beside = s.lines.filter((l) => l.story === "s" && l.y < pq.box.y + pq.box.height && l.y + l.height > pq.box.y);
    expect(beside).toEqual([]);
    expect(s.lines.filter((l) => l.story === "s" && l.y >= pq.box.y + pq.box.height).length).toBeGreaterThan(0);
  });

  it("in a frame of two columns, it sits across the middle gutter and both columns wrap it", () => {
    const s = scene(`\\story[name=s]{\\pullquote[side=center, width=60%]{Quoted.}\n\n${LONG} ${LONG}}\n\\scene{\\frame[story=s, cols=1-12, columns=2]}`);
    const pq = s.objects.find((o) => o.name === "pullquote-1")!;
    const text = s.lines.filter((l) => l.story === "s");
    const left = Math.min(...text.map((l) => l.x));
    const right = Math.max(...text.map((l) => l.x + l.width));
    expect(pq.box.x + pq.box.width / 2).toBeCloseTo((left + right) / 2, 0);
    const beside = text.filter((l) => l.y < pq.box.y + pq.box.height && l.y + l.height > pq.box.y);
    expect(beside.some((l) => l.x + l.width <= pq.box.x && l.x < (left + right) / 2)).toBe(true);
    expect(beside.some((l) => l.x >= pq.box.x + pq.box.width)).toBe(true);
    for (const l of beside) expect(l.x + l.width <= pq.box.x + 1e-6 || l.x >= pq.box.x + pq.box.width - 1e-6).toBe(true);
  });
});
