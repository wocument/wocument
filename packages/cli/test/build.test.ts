/**
 * `woc build`. Reads the built @wocument/renderer (dist), as the bundler does: run `npm run build` first.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

let dir: string;
let said: string[];
const out = (): string => join(dir, "dist");
const build = async (...args: string[]): Promise<number> => main(["build", "--out", out(), "--public", join(dir, "public"), ...args]);
const data = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="woc-data">(.*?)<\/script>/s)![1]!);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "woc-build-"));
  mkdirSync(join(dir, "public", "img"), { recursive: true });
  const png = new PNG({ width: 30, height: 20 });
  png.data.fill(200);
  writeFileSync(join(dir, "public", "img", "a.png"), PNG.sync.write(png));
  writeFileSync(join(dir, "face.woff2"), "not really a font");
  said = [];
  vi.spyOn(console, "error").mockImplementation((s: string) => void said.push(s));
});

const DOC = `---
wocument: 1
title: A <Test> Page
description: Short.
---
\\font[family="Face", src=./face.woff2, weight=400]
\\headline{Hello}

Some text, and a closing </script> that must stay text.

\\figure[src=/img/a.png, alt="A grey box"]
`;

describe("woc build", () => {
  it("writes the page, its script and its files; pictures as WebP, fonts copied", async () => {
    writeFileSync(join(dir, "a.woc"), DOC);
    expect(await build(join(dir, "a.woc"))).toBe(0);

    const html = readFileSync(join(out(), "index.html"), "utf8");
    expect(html).toContain("<title>A &lt;Test&gt; Page</title>");
    expect(html).toContain('<meta name="description" content="Short.">');
    // The reading version is in the page, for a reader without JavaScript.
    expect(html).toContain("woc-static");
    expect(html).toContain("Hello");
    const script = html.match(/src="(woc\.[0-9a-f]{10}\.js)"/)![1]!;
    expect(existsSync(join(out(), script))).toBe(true);

    const rd = data(html);
    expect(rd.format).toBe("wocument-resolved");
    expect(JSON.stringify(rd)).toContain("</script> that must stay text");
    const picture = Object.values(rd.assets as Record<string, { kind: string; fallback?: string }>).find((a) => a.kind === "image")!;
    expect(picture.fallback).toMatch(/^assets\/a-[0-9a-f]{10}\.webp$/);
    expect(existsSync(join(out(), picture.fallback!))).toBe(true);
    expect(rd.fonts[0].src).toMatch(/^assets\/face-[0-9a-f]{10}\.woff2$/);
    expect(existsSync(join(out(), rd.fonts[0].src))).toBe(true);
    // The PNG is served as WebP, so it is not copied.
    expect(readdirSync(join(out(), "assets")).filter((f) => f.endsWith(".png"))).toEqual([]);
  });

  it("--no-webp copies the picture as it is", async () => {
    writeFileSync(join(dir, "a.woc"), DOC);
    expect(await build("--no-webp", join(dir, "a.woc"))).toBe(0);
    const rd = data(readFileSync(join(out(), "index.html"), "utf8"));
    const picture = Object.values(rd.assets as Record<string, { kind: string; fallback?: string }>).find((a) => a.kind === "image")!;
    expect(picture.fallback).toMatch(/^assets\/a-[0-9a-f]{10}\.png$/);
    expect(existsSync(join(out(), picture.fallback!))).toBe(true);
  });

  it("gives the same files when nothing changed", async () => {
    writeFileSync(join(dir, "a.woc"), DOC);
    await build(join(dir, "a.woc"));
    const first = readFileSync(join(out(), "index.html"), "utf8");
    await build(join(dir, "a.woc"));
    expect(readFileSync(join(out(), "index.html"), "utf8")).toBe(first);
  });

  it("several inputs give one page each", async () => {
    writeFileSync(join(dir, "a.woc"), DOC);
    writeFileSync(join(dir, "b.woc"), "---\nwocument: 1\ntitle: B\n---\n\\headline{B}\n");
    expect(await build(join(dir, "a.woc"), join(dir, "b.woc"))).toBe(0);
    expect(existsSync(join(out(), "a.html"))).toBe(true);
    expect(existsSync(join(out(), "b.html"))).toBe(true);
    expect(readdirSync(out()).filter((f) => f.endsWith(".js"))).toHaveLength(1);
  });

  it("a missing picture is a warning: the page is still built", async () => {
    writeFileSync(join(dir, "a.woc"), DOC.replace("/img/a.png", "/img/gone.png"));
    expect(await build(join(dir, "a.woc"))).toBe(0);
    expect(said.join("\n")).toMatch(/W050[\s\S]*Missing file \/img\/gone\.png/);
    expect(existsSync(join(out(), "index.html"))).toBe(true);
  });

  it("a parse error fails the build, says where, and writes no page", async () => {
    writeFileSync(join(dir, "a.woc"), "---\nwocument: 1\ntitle: T\n---\n\\headlin{Hi}\n");
    expect(await build(join(dir, "a.woc"))).toBe(1);
    expect(said.join("\n")).toMatch(/woc: parse error \[P\d+\] at .*a\.woc:5:1/);
    expect(existsSync(join(out(), "index.html"))).toBe(false);
  });

  it("a missing input or theme is an error, not a crash", async () => {
    expect(await build(join(dir, "nothing.woc"))).toBe(1);
    expect(said.join("\n")).toContain("cannot read");
    writeFileSync(join(dir, "a.woc"), "---\nwocument: 1\ntitle: T\ntheme: ./gone.woct\n---\nText.\n");
    expect(await build(join(dir, "a.woc"))).toBe(1);
    expect(said.join("\n")).toContain("cannot read the theme ./gone.woct");
  });

  it("two inputs with the same name are refused", async () => {
    mkdirSync(join(dir, "x"));
    writeFileSync(join(dir, "a.woc"), DOC);
    writeFileSync(join(dir, "x", "a.woc"), DOC);
    writeFileSync(join(dir, "b.woc"), DOC);
    expect(await build(join(dir, "a.woc"), join(dir, "x", "a.woc"), join(dir, "b.woc"))).toBe(1);
    expect(said.join("\n")).toContain("both be written to a.html");
  });
});
