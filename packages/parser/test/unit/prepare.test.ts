import { describe, expect, it } from "vitest";
import { Diagnostics } from "../../src/diagnostics.js";
import { normalize, prepare } from "../../src/prepare.js";

function run(src: string | Uint8Array, kind: "document" | "theme" = "document") {
  const diags = new Diagnostics("t.wmx");
  const r = prepare(src, kind, diags);
  return { ...r, codes: diags.sorted().map((d) => d.code), diags: diags.sorted() };
}

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";

describe("normalize", () => {
  it("strips exactly one BOM", () => {
    expect(normalize("﻿a")).toBe("a");
    expect(normalize("﻿﻿a")).toBe("﻿a");
  });

  it("normalizes CRLF and lone CR", () => {
    expect(normalize("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});

describe("prepare: frontmatter", () => {
  it("accepts a minimal document", () => {
    const r = run(FM + "body");
    expect(r.codes).toEqual([]);
    expect(r.frontmatter).toEqual({ wmxdsl: 1, title: "T" });
    expect(r.text.slice(r.contentStart)).toBe("body");
  });

  it("requires an opening fence", () => {
    const r = run("no fence here");
    expect(r.codes).toEqual(["P001"]);
    expect(r.fatal).toBe(true);
  });

  it("requires a closing fence", () => {
    const r = run("---\nwmxdsl: 1\n");
    expect(r.codes).toEqual(["L005"]);
    expect(r.fatal).toBe(true);
  });

  it("reports unknown fields", () => {
    const r = run("---\nwmxdsl: 1\ntitle: T\nlayout: wide\n---\n");
    expect(r.codes).toEqual(["P002"]);
    expect(r.diags[0]?.pos.line).toBe(4);
  });

  it("reports missing required fields", () => {
    const r = run("---\ntitle: T\n---\n");
    expect(r.codes).toEqual(["P003"]);
  });

  it("reports a field of the wrong type", () => {
    const r = run("---\nwmxdsl: one\ntitle: T\n---\n");
    expect(r.codes).toEqual(["P003"]);
    expect(r.diags[0]?.message).toContain("an integer");
    expect(r.diags[0]?.pos.line).toBe(2);
  });

  it("accepts author as a string or a list", () => {
    expect(run("---\nwmxdsl: 1\ntitle: T\nauthor: A\n---\n").codes).toEqual([]);
    expect(run("---\nwmxdsl: 1\ntitle: T\nauthor:\n  - A\n  - B\n---\n").codes).toEqual([]);
    expect(run("---\nwmxdsl: 1\ntitle: T\nauthor: 3\n---\n").codes).toEqual(["P003"]);
  });

  it("keeps an ISO date as a string under YAML 1.2 core", () => {
    const r = run("---\nwmxdsl: 1\ntitle: T\ndate: 2026-06-01\n---\n");
    expect(r.codes).toEqual([]);
    expect(r.frontmatter?.date).toBe("2026-06-01");
  });

  it("maps a YAML error back into the file", () => {
    const r = run('---\nwmxdsl: 1\ntitle: "unterminated\n---\n');
    expect(r.codes).toContain("P001");
    expect(r.diags[0]?.pos.line).toBeGreaterThan(1);
  });

  it("rejects a non-mapping frontmatter", () => {
    expect(run("---\n- a\n- b\n---\n").codes).toEqual(["P001"]);
  });

  it("positions are relative to normalized text", () => {
    const r = run("---\r\nwmxdsl: 1\r\ntitle: T\r\nlayout: x\r\n---\r\n");
    expect(r.diags[0]?.pos).toEqual({ line: 4, column: 1, length: 6 });
  });
});

describe("prepare: theme files", () => {
  it("takes the whole text as content", () => {
    const r = run("\\grid[cols=12]", "theme");
    expect(r.codes).toEqual([]);
    expect(r.contentStart).toBe(0);
  });

  it("rejects a leading fence", () => {
    expect(run(FM + "\\grid[cols=12]", "theme").codes).toEqual(["P045"]);
  });
});

describe("prepare: decoding", () => {
  it("accepts valid UTF-8 bytes", () => {
    const bytes = new TextEncoder().encode(FM + "café");
    const r = run(bytes);
    expect(r.codes).toEqual([]);
    expect(r.text.endsWith("café")).toBe(true);
  });

  it("reports invalid UTF-8", () => {
    const r = run(new Uint8Array([0xff, 0xfe, 0xfd]));
    expect(r.codes).toEqual(["L001"]);
    expect(r.fatal).toBe(true);
  });

  it("skips the UTF-8 check for strings", () => {
    expect(run("\uD800" + FM).codes).toEqual(["P001"]);
  });
});
