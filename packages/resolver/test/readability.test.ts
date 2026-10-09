/** Readability warnings W060-W063 (spec §15.6, 2026-10-09). */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { contrast, resolve } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const codes = (head: string) => {
  const { diagnostics } = resolve(parse(FM + head + "\nHello.").ast as Document);
  return diagnostics.filter((d) => /^W06/.test(d.code)).map((d) => d.code);
};

describe("readability warnings", () => {
  it("Vanilla raises none", () => {
    expect(codes("")).toEqual([]);
  });
  it("small body text, tight leading and a light weight each warn once, whatever the breakpoints", () => {
    expect(codes("\\style[name=body, size=14px]").filter((c) => c === "W060")).toEqual(["W060"]);
    expect(codes("\\style[name=body, size=21px, leading=24px]\n\\grid[name=default, baseline=24px]")).toContain("W061");
    expect(codes("\\style[name=body, weight=300]")).toEqual(["W063"]);
  });
  it("a text colour under 4.5:1 against its paper warns", () => {
    expect(codes("\\palette[name=default, muted=#9a9a9a]")).toEqual(["W062"]);
  });
  it("contrast follows WCAG: black on white is 21, Vanilla's ink on paper about 17", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#16181dff", "#f6f7f8ff")).toBeGreaterThan(16);
  });
});
