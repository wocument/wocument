import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

describe("wmxdsl format", () => {
  it("--check fails until --write makes the file canonical, and refuses a file with errors", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "wmx-"));
    const file = join(dir, "a.wmx");
    writeFileSync(file, "---\ntitle: T\nwmxdsl: 1\n---\n\\headline{Hi}\nOne\ntwo.\n");
    expect(main(["format", "--check", file])).toBe(1);
    expect(main(["format", "--write", file])).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("---\nwmxdsl: 1\ntitle: T\n---\n\n\\headline{Hi}\nOne two.\n");
    expect(main(["format", "--check", file])).toBe(0);

    writeFileSync(file, "---\nwmxdsl: 1\ntitle: T\n---\n\\headlin{Hi}\n");
    expect(main(["format", "--write", file])).toBe(1);
    expect(readFileSync(file, "utf8")).toContain("\\headlin{Hi}");
  });
});

describe("line length (W064)", () => {
  it("counts characters in full body lines per test width, and flags lines outside 45 to 75", async () => {
    const { parse } = await import("@wmxdsl/parser");
    const { resolve } = await import("@wmxdsl/resolver");
    const { lineLengths, tooShortOrLong } = await import("../src/measure.js");
    const text = Array.from({ length: 40 }, () => "Stone endures where nearly everything else decays, and the keepers wrote it down.").join(" ");
    const { doc } = resolve(parse(`---\nwmxdsl: 1\ntitle: T\n---\n${text}`).ast as import("@wmxdsl/parser").Document);
    const ls = lineLengths(doc, [1470]);
    expect(ls).toHaveLength(1);
    expect(ls[0]!.chars).toBeGreaterThanOrEqual(45); // a laptop, 2026-10-11: 45, the base page at 85% zoom
    expect(ls[0]!.chars).toBeLessThan(75);
    expect(tooShortOrLong({ width: 768, variant: "tablet", chars: 32 })).toBe(true);
    expect(tooShortOrLong({ width: 360, variant: "phone", chars: 34 })).toBe(false);
  });
});

describe("copyfitting report", () => {
  const para = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays.`).join(" ");
  // At 1470x900, each column of screen 1 holds 25 of its 28 lines before a column break.
  const SHORT = `---\nwmxdsl: 1\ntitle: T\n---\n\\story[name=s]{${para(14, "a")} Stone endures where nearly.\n\n\\framebreak[column]\n\n${para(14, "b")} Stone endures where nearly.\n\n\\framebreak[column]\n\n${para(60, "c")}}\n\\scene[height=page]{\\frame[story=s, columns=2]}\n`;
  const doc = async (src: string) => {
    const { parse } = await import("@wmxdsl/parser");
    const { resolve } = await import("@wmxdsl/resolver");
    return resolve(parse(src).ast as import("@wmxdsl/parser").Document).doc;
  };

  it("copyfit names a short screen", async () => {
    const { copyfit } = await import("../src/measure.js");
    const out = copyfit(await doc(SHORT), [1470]);
    expect(out).toContain("screen 1 at 1470px: 3 lines short of the bottom line.");
    const i = out.indexOf("screen 1 at 1470px: 3 lines short of the bottom line.");
    expect(out[i + 1]).toMatch(/^ {2}Add about \d+0 characters to "Stone b0 endures where nearly…"\.$/);
  });

  it("copyfit is silent on a page that fits", async () => {
    const { copyfit } = await import("../src/measure.js");
    const long = "Stone endures where nearly everything else decays. ".repeat(100).trim();
    expect(copyfit(await doc(`---\nwmxdsl: 1\ntitle: T\n---\n\\story[name=s]{${long}}\n\\scene[height=page]{\\frame[story=s, columns=2]}\n`))).toEqual([]);
  });

  it("wmx check prints the report", () => {
    const said: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((s: string) => void said.push(s));
    const dir = mkdtempSync(join(tmpdir(), "wmx-"));
    const file = join(dir, "a.wmx");
    writeFileSync(file, SHORT);
    expect(main(["check", file])).toBe(0);
    spy.mockRestore();
    const at = said.indexOf("screen 1 at 1470px: 3 lines short of the bottom line.");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(said[at + 1]).toMatch(/^ {2}Add about/);
    // After the diagnostics: no diagnostic line follows the report.
    expect(said.slice(at).some((s) => s.startsWith("wmxdsl:"))).toBe(false);
  });
});
