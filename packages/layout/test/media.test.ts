/** Step 3: figures, captions, backgrounds and contour wrap, resolved with a fake asset host and laid out in Node. */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import { type AssetHost, resolve } from "@wmxdsl/resolver";
import { checkInvariants } from "@wmxdsl/resolved-document";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";
import { layout, type PositionedScene } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const LONG = Array.from({ length: 14 }, () => "Stone endures where nearly everything else decays.").join(" ");

/** 800x600 images; any PNG is a diamond silhouette: widest at mid-height. */
const fake: AssetHost = {
  image: (path) => ({ url: path, type: path.endsWith(".png") ? "image/png" : "image/jpeg", width: 800, height: 600, animated: false }),
  contour: (path) => (path.endsWith(".png") ? [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] : null),
  file: (path) => ({ url: path, type: "video/mp4" }),
};

function scene(body: string, name?: string, width = 1470): { s: PositionedScene; doc: ReturnType<typeof resolve>["doc"] } {
  const { doc } = resolve(parse(FM + body).ast as Document, { assets: fake });
  expect(checkInvariants(doc)).toEqual([]);
  const pd = layout(doc, { width, height: 900 }, new PrepareCache(createFixedEngine()));
  return { s: name ? pd.scenes.find((x) => x.name === name)! : pd.scenes[0]!, doc };
}

describe("a figure with a caption", () => {
  const { s, doc } = scene('\\scene{\\figure[src=/a.jpg, alt="A", cols=1-6]{\\caption{Below it.}\\credit{Someone}}}');
  const f = s.objects[0]!;

  it("resolves its ratio from the image, and its caption as its own story", () => {
    const o = doc.variants.base!.objects["figure-1"]!;
    expect(o.kind === "figure" && [o.media.ratio, o.caption?.story]).toEqual([{ w: 4, h: 3 }, "figure-1#caption"]);
  });

  it("the media takes the ratio; the caption sits below it, inside the box", () => {
    // §09.7 rule 14: the photograph crops to the nearest whole line, so the box takes whole lines.
    expect(Math.abs(f.media!.height - (f.media!.width * 600) / 800)).toBeLessThanOrEqual(s.grid.baseline / 2 + 1e-6);
    const caption = s.lines.filter((l) => l.frame === "figure-1");
    expect(caption.map((l) => l.text.trim())).toEqual(["Below it.", "SOMEONE"]);
    expect(caption[0]!.y).toBeGreaterThanOrEqual(f.media!.y + f.media!.height);
    expect(f.box.y + f.box.height).toBeGreaterThanOrEqual(caption.at(-1)!.y + caption.at(-1)!.height - 1e-6);
  });

  it("takes a whole number of baseline steps, caption included (§09.7 rule 14)", () => {
    const steps = f.box.height / s.grid.baseline;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(0.02);
  });

  it("the box ends at the caption's last line, not after its space-after", () => {
    const caption = s.lines.filter((l) => l.frame === "figure-1");
    expect(f.box.y + f.box.height).toBeCloseTo(caption.at(-1)!.y + caption.at(-1)!.height, 6);
  });
});

describe("an overlay caption", () => {
  it("keeps its space-after as padding from the media's bottom edge", () => {
    const { s } = scene('\\scene{\\figure[src=/a.jpg, alt="A", cols=1-6, caption-side=overlay]{\\caption{Over it.}}}');
    const f = s.objects[0]!;
    const last = s.lines.filter((l) => l.frame === "figure-1").at(-1)!;
    expect(f.media!.y + f.media!.height - (last.y + last.height)).toBeGreaterThan(0);
  });
});

describe("a background figure", () => {
  it("fills its scene and excludes nothing", () => {
    const { s } = scene('\\scene[height=screen]{\\figure[src=/b.jpg, alt="", layer=background]\n\\frame{Over it.}}');
    const bg = s.objects.find((o) => o.name === "figure-1")!;
    expect(bg.box).toEqual({ x: 0, y: s.y, width: 1470, height: s.height });
    expect(bg.exclusion).toBeNull();
  });
});

describe("contour wrap around an alpha silhouette (§12.2)", () => {
  const { s } = scene(
    `\\story[name=s]{\\figure[src=/t.png, alt="T", side=right, width=40%, shape=alpha, wrap=contour, wrap-side=left, wrap-offset=0px]\n\n${LONG}}\n\\scene{\\frame[story=s, cols=1-8]}`,
  );
  const f = s.objects[0]!;
  const beside = s.lines.filter((l) => l.story === "s" && l.y + l.height > f.box.y && l.y < f.box.y + f.box.height);

  it("the exclusion is the traced polygon", () => {
    expect(f.exclusion!.shape.kind).toBe("poly");
  });

  it("lines follow the silhouette: narrowest beside its widest point, wider at its tips", () => {
    const rights = beside.map((l) => l.x + l.width);
    const mid = f.box.y + f.media!.height / 2;
    const atMid = beside.reduce((a, b) => (Math.abs(b.y + b.height / 2 - mid) < Math.abs(a.y + a.height / 2 - mid) ? b : a));
    expect(atMid.x + atMid.width).toBeLessThanOrEqual(Math.min(...rights) + 1e-6);
    expect(Math.max(...rights)).toBeGreaterThan(atMid.x + atMid.width + 20);
    // Never into the diamond: at the band's widest the diamond reaches its left tip.
    for (const l of beside) expect(l.x + l.width).toBeLessThanOrEqual(f.box.x + f.box.width + 1e-6);
  });
});

describe("the real asset host", () => {
  it("reads the playground's turret PNG and traces its alpha channel", () => {
    const host = createAssetHost({ publicDir: fileURLToPath(new URL("../../playground/public", import.meta.url)), sourceDir: "." });
    const info = host.image("/img/tower.png")!;
    expect([info.width, info.height, info.type]).toEqual([700, 1000, "image/png"]);
    const poly = host.contour("/img/tower.png", { threshold: 0.5, ratio: 0.7, fit: "cover", focus: { x: 0.5, y: 0.5 } })!;
    expect(poly.length).toBeGreaterThanOrEqual(4);
    // The parapet overhangs the shaft: the silhouette is wider near the top than just below it.
    const extent = (y: number) => {
      const xs = poly.flatMap(([x1, y1], i) => {
        const [x2, y2] = poly[(i + 1) % poly.length]!;
        return (y1 - y) * (y2 - y) <= 0 && y1 !== y2 ? [x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)] : [];
      });
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(extent(0.15)).toBeGreaterThan(extent(0.3));
  });
});

describe("a gallery (§11.9)", () => {
  const kids = [1, 2, 3, 4, 5].map((i) => `\\figure[src=/g${i}.jpg, alt="${i}"]`).join("\n");

  it("grid: items in rows of per-row, forced to the gallery's ratio, inside its box", () => {
    const { s, doc } = scene(`\\scene{\\gallery[per-row=2, ratio=1:1, gap=10px, cols=1-12]{\n${kids}\n\\caption{Five.}}}`);
    const g = s.objects.find((o) => o.name === "gallery-1")!;
    const items = s.objects.filter((o) => o.name.startsWith("figure-"));
    expect(doc.variants.base!.objects["figure-1"]!.placement).toEqual({ mode: "contained", container: "gallery-1", index: 0 });
    expect(items.map((o) => [o.box.x - g.box.x, o.box.y - g.box.y])).toEqual([
      [0, 0], [items[0]!.box.width + 10, 0], [0, items[0]!.box.height + 10], [items[0]!.box.width + 10, items[0]!.box.height + 10], [0, 2 * (items[0]!.box.height + 10)],
    ]);
    for (const o of items) expect(o.box.height).toBeCloseTo(o.box.width, 6);
    expect(2 * items[0]!.box.width + 10).toBeCloseTo(g.box.width, 6);
    const caption = s.lines.find((l) => l.frame === "gallery-1")!;
    expect(caption.y).toBeGreaterThanOrEqual(items[4]!.box.y + items[4]!.box.height);
  });

  it("strip: one row that runs past the box, so it scrolls", () => {
    const { s } = scene(`\\scene{\\gallery[layout=strip, gap=8px, cols=1-12]{\n${kids}}}`);
    const g = s.objects.find((o) => o.name === "gallery-1")!;
    const items = s.objects.filter((o) => o.name.startsWith("figure-"));
    expect(new Set(items.map((o) => o.box.y)).size).toBe(1);
    expect(items.at(-1)!.box.x + items.at(-1)!.box.width).toBeGreaterThan(g.box.x + g.box.width);
  });
});

describe("audio and embed", () => {
  it("audio is a player-height box; embed takes its ratio and YouTube's thumbnail", () => {
    const { s, doc } = scene('\\scene{\\audio[src=/a.mp3, title="A", cols=1-6]\n\\embed[provider=youtube, id=xyz, title="E", cols=7-12]}');
    const [a, e] = [s.objects.find((o) => o.name === "audio-1")!, s.objects.find((o) => o.name === "embed-1")!];
    expect(a.box.height % s.grid.baseline).toBeCloseTo(0, 6);
    expect(a.box.height).toBeGreaterThanOrEqual(54);
    expect(e.box.height).toBeCloseTo((e.box.width * 9) / 16, 6);
    const o = doc.variants.base!.objects["embed-1"]!;
    expect(o.kind === "embed" && o.poster).toEqual({ url: "https://i.ytimg.com/vi/xyz/hqdefault.jpg" });
  });

  it("a missing title is warned (W033)", () => {
    const { diagnostics } = resolve(parse(FM + "\\scene{\\audio[src=/a.mp3]}").ast as Document, { assets: fake });
    expect(diagnostics.map((d) => d.code)).toContain("W033");
  });
});
