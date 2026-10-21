/** The visor's side panel and hover cards: what they list and say, from the model only. */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { type AssetHost, resolve } from "@wmxdsl/resolver";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { type Decision, type PositionedDocument, layout } from "@wmxdsl/layout";
import { buildModel, cardOf, currentScreen, describe as describeDecision, dotsOf, panelEntries } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const GRID = "\\grid[name=page, cols=12, gutter=24px, margin-x=48px, margin-y=2bl, baseline=28px, body=1-12]\n";
const VIEW = { width: 1280, height: 800 };
const fake: AssetHost = {
  image: (path) => ({ url: path, type: "image/jpeg", width: 800, height: 600, animated: false }),
  contour: () => null,
  file: (path) => ({ url: path, type: "video/mp4" }),
};
const para = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays.`).join(" ");
const fig = (attrs: string): string => `\\figure[src=/a.jpg, alt="A picture", ${attrs}]`;
const page = (story: string, name: string): string => `\\story[name=${name}]{${story}}\n\\scene[height=page, grid=page]{\\frame[story=${name}, cols=1-12, columns=3]}`;
function lay(src: string): PositionedDocument {
  const rd = resolve(parse(FM + GRID + src).ast as Document, { assets: fake }).doc;
  return layout(rd, VIEW, new PrepareCache(createFixedEngine()), { explain: true });
}

const pd = lay(
  `${page(`${para(80, "a")}`, "s")}\n` +
    `${page(`${para(40, "a")}\n\n${fig("size=column, ratio=4:3")}\n\n${para(30, "b")}\n\n${fig("size=column, ratio=1:1")}\n\n${para(20, "c")}`, "t")}\n` +
    `\\story[name=u]{${para(60, "u")}}\n\\scene{\\frame[story=u, cols=1-12, columns=2]}`,
);
const models = buildModel(pd, pd.explain!);
const layerOf = { "column-end": "flow", picture: "pictures", space: "space", line: "lines" } as const;

describe("the visor panel", () => {
  it("panel lists the screen's decisions in order", () => {
    expect(models.some((m) => m.decisions.length > 1)).toBe(true);
    for (const m of models) {
      const entries = panelEntries(m);
      expect(entries.map((e) => e.index)).toEqual(m.decisions.map((_, i) => i));
      expect(entries.map((e) => e.layer)).toEqual(m.decisions.map((d) => layerOf[d.kind]));
    }
  });

  it("panel entries use the dictionary wording", () => {
    for (const m of models)
      panelEntries(m).forEach((e) => {
        const card = describeDecision(m.decisions[e.index]!);
        expect(e.title).toBe(card.title);
        expect(e.detail).toBe(card.body);
      });
  });

  it("only the current screen is listed", () => {
    // The screen under the viewport's centre is the current one; its entries are its decisions only.
    models.forEach((m, i) => {
      expect(currentScreen(models, m.top + m.height / 2)).toBe(i);
      const listed = panelEntries(models[currentScreen(models, m.top + m.height / 2)]!).map((e) => m.decisions[e.index]);
      expect(listed).toEqual(m.decisions);
      for (const other of models) if (other !== m) for (const d of other.decisions) expect(listed).not.toContain(d);
    });
    // Past either end: the nearest screen.
    expect(currentScreen(models, -500)).toBe(0);
    expect(currentScreen(models, pd.height + 500)).toBe(models.length - 1);
  });

  it("hover cards round their numbers and carry the rule", () => {
    const d: Decision = {
      kind: "line", reason: "loose", screen: 1, frame: "f", column: 0, at: { x: 0, y: 0, width: 1, height: 1 },
      numbers: { ratio: 1.6666, score: 7.4321, px: 27.6 }, refs: {}, rule: "§07.6 justify",
    };
    const card = cardOf(d);
    expect(card).toMatchObject({ layer: "lines", kind: "Lines and words", title: "Loose line", rule: "§07.6 justify" });
    expect(card.numbers).toEqual([["ratio", "1.7"], ["score", "7"], ["px", "28"]]);
    expect(card.body).toContain("1.7");
  });

  it("a picture's window maps to the renderer's screen dots", () => {
    // The dots are every page screen's top, every other scene's top and the end (the renderer's snapStops).
    const screens = models.filter((m) => m.screen !== null).map((m) => m.screen!);
    expect(dotsOf(pd, screens[0]!, screens.at(-1)!)).toEqual(screens.map((_, i) => i));
    expect(dotsOf(pd, screens[1]!, screens[1]!)).toEqual([1]);
  });
});
