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
    expect(ls[0]!.chars).toBeGreaterThan(45);
    expect(ls[0]!.chars).toBeLessThan(75);
    expect(tooShortOrLong({ width: 768, variant: "tablet", chars: 32 })).toBe(true);
    expect(tooShortOrLong({ width: 360, variant: "phone", chars: 34 })).toBe(false);
  });
});
