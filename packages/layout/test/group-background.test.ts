/** A `\group` on the background layer (spec §11.2, §11.11): its children beneath the text, cutting into none of it. */
import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wocument/parser";
import { resolve, type AssetHost } from "@wocument/resolver";
import { PrepareCache, createFixedEngine } from "@wocument/text-engine";
import { layout } from "../src/index.js";
import { layoutInvariants } from "./invariants.js";

const fake: AssetHost = { image: (p) => ({ url: p, type: "image/jpeg", width: 1600, height: 1000, animated: false }), contour: () => null, file: (p) => ({ url: p, type: "x" }) };
const TEXT = Array.from({ length: 30 }, (_, i) => `Stone a${i} endures where nearly everything else decays.`).join(" ");
const lay = (group: string) => {
  const p = parse(`---\nwocument: 1\ntitle: T\n---\n\\story[name=s]{${TEXT}}\n\\scene{${group}\n\\frame[story=s, cols=1-12]}`);
  expect(p.diagnostics).toEqual([]);
  const rd = resolve(p.ast as Document, { assets: fake }).doc;
  const pd = layout(rd, { width: 1470, height: 956 }, new PrepareCache(createFixedEngine()));
  layoutInvariants(rd, pd);
  return { rd, pd };
};

describe("a group on the background layer", () => {
  it("sets its children across the columns, beneath the text, and the text does not move", () => {
    const plain = lay("").pd.scenes[0]!.lines.map((l) => [l.x, l.y]);
    const { rd, pd } = lay(`\\group[layer=background, layout=row]{\\figure[src=/a.jpg, alt="a"]\n\\figure[src=/b.jpg, alt="b"]}`);
    const s = pd.scenes[0]!;
    expect(s.lines.map((l) => [l.x, l.y])).toEqual(plain);
    const figs = s.objects.filter((o) => o.kind === "figure");
    expect(figs).toHaveLength(2);
    // Painted first: before anything of the content layer.
    expect(s.objects.indexOf(figs[0]!)).toBe(0);
    for (const f of figs) expect(rd.variants.base!.objects[f.name]!.layer).toBe("background");
  });
});
