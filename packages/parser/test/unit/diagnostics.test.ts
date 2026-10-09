import { describe, expect, it } from "vitest";
import { ALL_CODES, CODES } from "@wmxdsl/schema";
import { Diagnostics, editDistance, nearestMatch } from "../../src/diagnostics.js";

describe("codes", () => {
  it("covers every code listed in grammar §11", () => {
    const expected = [
      "L001", "L002", "L003", "L004", "L005", "L006",
      "P001", "P002", "P003",
      "P010", "P011", "P012", "P013", "P014", "P015", "P016",
      "P017", "P018", "P019", "P020", "P021", "P022", "P023",
      "P030", "P031", "P032", "P033", "P034", "P035", "P036",
      "P040", "P041", "P042", "P043", "P044", "P045",
    ];
    expect([...ALL_CODES].sort()).toEqual(expected.sort());
  });

  it("gives every code a non-empty message", () => {
    for (const code of ALL_CODES) {
      expect(CODES[code].message({}).length).toBeGreaterThan(0);
    }
  });
});

describe("Diagnostics", () => {
  it("sorts by position", () => {
    const d = new Diagnostics("a.wmx");
    d.add("P011", { line: 3, column: 1, length: 1 });
    d.add("P010", { line: 1, column: 5, length: 1 });
    d.add("P012", { line: 1, column: 2, length: 4 }, { name: "x" });
    expect(d.sorted().map((x) => x.code)).toEqual(["P012", "P010", "P011"]);
  });

  it("attaches the file name and keeps hints optional", () => {
    const d = new Diagnostics("a.wmx");
    d.add("P012", { line: 1, column: 1, length: 2 }, { name: "pullqoute" }, "Did you mean \\pullquote?");
    d.add("P011", { line: 2, column: 1, length: 1 });
    const [first, second] = d.sorted();
    expect(first?.file).toBe("a.wmx");
    expect(first?.hint).toBe("Did you mean \\pullquote?");
    expect(second && "hint" in second).toBe(false);
  });

  it("reports whether any error was recorded", () => {
    const d = new Diagnostics();
    expect(d.hasErrors()).toBe(false);
    d.add("P011", { line: 1, column: 1, length: 1 });
    expect(d.hasErrors()).toBe(true);
  });
});

describe("nearestMatch", () => {
  it("suggests at distance 1 and 2", () => {
    expect(nearestMatch("pullqoute", ["pullquote", "blockquote"])).toBe("pullquote");
    expect(nearestMatch("hedline", ["headline", "deck"])).toBe("headline");
  });

  it("stays silent past distance 2", () => {
    expect(nearestMatch("xyzzy", ["headline", "deck"])).toBeUndefined();
  });

  it("prefers the closer candidate", () => {
    expect(nearestMatch("framebrea", ["framebreak", "frame"])).toBe("framebreak");
  });

  it("abandons early without lying about the distance", () => {
    expect(editDistance("abc", "abc", 2)).toBe(0);
    expect(editDistance("abc", "abd", 2)).toBe(1);
    expect(editDistance("abc", "xyz", 2)).toBe(3);
    expect(editDistance("a", "aaaaaa", 2)).toBe(3);
  });
});
