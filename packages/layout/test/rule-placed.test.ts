/** A `\rule` written in a scene or a group (spec §08.4, §10.4): placed like an object. */
import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wocument/parser";
import { resolve } from "@wocument/resolver";
import { PrepareCache, createFixedEngine } from "@wocument/text-engine";
import { layout } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const lay = (body: string) => {
  const p = parse(`---\nwocument: 1\ntitle: T\n---\n\\story[name=s]{Text of the story.}\n${body}`);
  expect(p.diagnostics).toEqual([]);
  const rd = resolve(p.ast as Document).doc;
  const pd = layout(rd, { width: 1470, height: 956 }, new PrepareCache(createFixedEngine()));
  layoutInvariants(rd, pd);
  return { rd, pd, rule: pd.scenes.flatMap((s) => s.objects).find((o) => o.kind === "rule")! };
};

describe("a rule placed in a scene", () => {
  it("spans its columns, as high as its weight", () => {
    const { pd, rule } = lay(`\\scene{\\frame[story=s, cols=1-12]\n\\rule[cols=2-5, weight=3px]}`);
    const g = pd.scenes[0]!.grid;
    expect(rule.box.x).toBeCloseTo(g.originX + g.colWidth + g.gutter);
    expect(rule.box.width).toBeCloseTo(4 * g.colWidth + 3 * g.gutter);
    expect(rule.box.height).toBe(3);
  });

  it("width= shortens it and align= places it in its columns", () => {
    const whole = lay(`\\scene{\\frame[story=s]\n\\rule[cols=1-12]}`).rule.box;
    const half = lay(`\\scene{\\frame[story=s]\n\\rule[cols=1-12, width=50%, align=center]}`).rule.box;
    expect(half.width).toBeCloseTo(whole.width / 2);
    expect(half.x).toBeCloseTo(whole.x + whole.width / 4);
  });

  it("resolves to a rule object with its colour", () => {
    const { rd } = lay(`\\scene{\\frame[story=s]\n\\rule[cols=1-12, color=accent]}`);
    expect(Object.values(rd.variants.base!.objects).find((o) => o.kind === "rule")).toMatchObject({ kind: "rule", rule: { color: { role: "accent" } } });
  });

  it("in a group, among its children", () => {
    const { rule } = lay(`\\scene{\\group[cols=1-12]{\\rule\n\\frame[story=s]}}`);
    expect(rule.box.width).toBeGreaterThan(100);
  });
});
