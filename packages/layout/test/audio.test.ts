/** `\audio` (spec §11.8): a transcript adds a line under the player for its link. */
import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wocument/parser";
import { resolve, type AssetHost } from "@wocument/resolver";
import { PrepareCache, createFixedEngine } from "@wocument/text-engine";
import { layout } from "../src/index.js";

const fake: AssetHost = { image: () => null, contour: () => null, file: (p) => ({ url: p, type: "x" }) };
const height = (attrs: string): number => {
  const rd = resolve(parse(`---\nwocument: 1\ntitle: T\n---\nText.\n\n\\audio[src=/a.mp3, title="A"${attrs}]\n\nMore.`).ast as Document, { assets: fake }).doc;
  const pd = layout(rd, { width: 1470, height: 956 }, new PrepareCache(createFixedEngine()));
  return pd.scenes[0]!.objects.find((o) => o.kind === "audio")!.box.height;
};

describe("\\audio", () => {
  it("is one baseline step taller with a transcript", () => {
    const rd = resolve(parse(`---\nwocument: 1\ntitle: T\n---\nText.`).ast as Document).doc;
    const bl = layout(rd, { width: 1470, height: 956 }, new PrepareCache(createFixedEngine())).scenes[0]!.grid.baseline;
    expect(height(", transcript=/t.txt") - height("")).toBeCloseTo(bl);
  });
});
