/** Pictures served as WebP (2026-10-09). */

import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "../src/index.js";

async function setup() {
  const pub = mkdtempSync(join(tmpdir(), "wmx-webp-"));
  const frame = (r: number) => sharp({ create: { width: 40, height: 30, channels: 4, background: { r, g: 90, b: 200, alpha: 1 } } }).png().toBuffer();
  writeFileSync(join(pub, "photo.png"), await frame(10));
  // An animated GIF of three frames, stacked as pages.
  const pages = await Promise.all([10, 120, 240].map((r) => sharp({ create: { width: 40, height: 30, channels: 3, background: { r, g: 0, b: 0 } } }).raw().toBuffer()));
  writeFileSync(join(pub, "loop.gif"), await sharp(Buffer.concat(pages), { raw: { width: 40, height: 90, channels: 3, pageHeight: 30 } }).gif({ loop: 0 }).toBuffer());
  writeFileSync(join(pub, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  return { pub, out: join(pub, "_webp") };
}

describe("webp", () => {
  it("serves the original until converted, then the WebP; sizes stay the original's", async () => {
    const { pub, out } = await setup();
    const host = createAssetHost({ publicDir: pub, sourceDir: pub, webp: { dir: out, url: "/_webp" } });
    expect(host.image("/photo.png")).toMatchObject({ url: "/photo.png", type: "image/png" });
    expect(await host.convert()).toBe(1);
    const after = host.image("/photo.png")!;
    expect(after.type).toBe("image/webp");
    expect(after.url).toMatch(/^\/_webp\/photo-[0-9a-f]{10}\.webp$/);
    expect([after.width, after.height]).toEqual([40, 30]);
    expect(await host.convert()).toBe(0);
  });

  it("an animated GIF stays animated as WebP", async () => {
    const { pub, out } = await setup();
    const host = createAssetHost({ publicDir: pub, sourceDir: pub, webp: { dir: out, url: "/_webp" } });
    expect(host.image("/loop.gif")!.animated).toBe(true);
    await host.convert();
    const info = host.image("/loop.gif")!;
    expect(info.type).toBe("image/webp");
    expect(info.animated).toBe(true);
    expect((await sharp(join(out, readdirSync(out)[0]!), { animated: true }).metadata()).pages).toBe(3);
  });

  it("leaves SVG alone, and converts nothing without the option", async () => {
    const { pub, out } = await setup();
    const host = createAssetHost({ publicDir: pub, sourceDir: pub, webp: { dir: out, url: "/_webp" } });
    expect(host.image("/icon.svg")!.type).toBe("image/svg+xml");
    expect(await host.convert()).toBe(0);
    const plain = createAssetHost({ publicDir: pub, sourceDir: pub });
    plain.image("/photo.png");
    expect(await plain.convert()).toBe(0);
  });
});
