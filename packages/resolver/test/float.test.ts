/** Floating placement and the spot menu in the Resolved Document (spec §07.7, §11.3). */

import { describe, expect, it } from "vitest";
import { parse, type Document, type Theme } from "@wmxdsl/parser";
import { checkInvariants, type ObjectElement, type ResolvedDocument } from "@wmxdsl/resolved-document";
import { resolve, type AssetHost } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";

const HOST: AssetHost = {
  image: () => ({ width: 800, height: 600, url: "/a.jpg", animated: false, type: "image/jpeg" }),
  contour: () => [[0, 0], [1, 0], [1, 1]],
  file: () => ({ url: "/a.jpg", type: "image/jpeg" }),
};

function run(body: string, theme?: string): ResolvedDocument {
  const p = parse(FM + body, { file: "t.wmx" });
  expect(p.diagnostics).toEqual([]);
  const t = theme === undefined ? null : (parse(theme, { kind: "theme" }).ast as Theme);
  const { doc } = resolve(p.ast as Document, {
    theme: t,
    assets: HOST,
  });
  expect(checkInvariants(doc)).toEqual([]);
  return doc;
}

const fig = (doc: ResolvedDocument, bp = "base"): ObjectElement => {
  const o = Object.values(doc.variants[bp]!.objects).find((x) => x.placement.mode === "anchored");
  if (!o) throw new Error("no anchored object");
  return o;
};
const placed = (o: ObjectElement) => {
  if (o.placement.mode !== "anchored") throw new Error("not anchored");
  return { size: o.placement.size, place: o.placement.place };
};

describe("the spot menu", () => {
  it("Vanilla's menu has nine spots", () => {
    const spots = run("Hello.").variants.base!.spots;
    expect(spots).toHaveLength(9);
    expect(spots[0]).toEqual({ size: "hero", place: "top", span: { kind: "all" }, side: null });
  });

  it("a theme's spots replace Vanilla's for the sizes they name", () => {
    const spots = run("Hello.", "\\spot[size=wide, place=top, span=3]").variants.base!.spots;
    const count = (s: string) => spots.filter((x) => x.size === s).length;
    expect([count("hero"), count("wide"), count("column"), count("small")]).toEqual([2, 1, 3, 2]);
    expect(spots.find((x) => x.size === "wide")!.span).toEqual({ kind: "count", from: 3, to: 3 });
  });
});

describe("floating placement", () => {
  const FIG = '\\figure[src=/a.jpg, alt=""';
  it("a plain figure floats at auto size", () => {
    expect(placed(fig(run(`Text.\n\n${FIG}]\n\nMore.`)))).toEqual({ size: "auto", place: "float" });
  });

  it("side= keeps today's placement", () => {
    expect(placed(fig(run(`Text.\n\n${FIG}, side=right, width=40%]\n\nMore.`)))).toEqual({ size: "small", place: "here" });
  });

  it("a cut-out keeps its reach", () => {
    expect(placed(fig(run(`Text.\n\n${FIG}, shape=alpha]\n\nMore.`))).place).toBe("here");
  });

  it("a cols= object never floats", () => {
    expect(placed(fig(run(`Text.\n\n${FIG}, cols=3-6]\n\nMore.`)))).toEqual({ size: "auto", place: "here" });
  });

  it("an explicit size wins over the mapping", () => {
    expect(placed(fig(run(`Text.\n\n${FIG}, side=right, size=hero, place=top]\n\nMore.`)))).toEqual({ size: "hero", place: "top" });
  });

  it("size takes breakpoint suffixes", () => {
    const doc = run(`Text.\n\n${FIG}, size=column, size@wide=hero]\n\nMore.`);
    expect(placed(fig(doc, "base")).size).toBe("column");
    expect(placed(fig(doc, "wide")).size).toBe("hero");
  });
});
