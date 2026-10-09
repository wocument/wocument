/**
 * Formatter -- grammar §09. Vector 37's property (`format` is a fixed point,
 * `parse(format(x))` equals `parse(x)`) lives in conformance/vectors.test.ts;
 * this file pins the individual rules and the escaping edge cases.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_SOURCE } from "../../../resolver/src/default-theme.js";
import { roundTrip } from "../helpers.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";

const body = (src: string): string => roundTrip(FM + src).slice(FM.length + 1);

describe("format: layout rules", () => {
  it("writes frontmatter in §04 order and one trailing newline (rules 1-2)", () => {
    expect(roundTrip("---\ntitle: T\nlang: en\nwmxdsl: 1\n---\nHi")).toBe("---\nwmxdsl: 1\ntitle: T\nlang: en\n---\n\nHi\n");
  });

  it("orders attributes by schema, base before overrides (rules 3-5)", () => {
    expect(body("\\scene{\\frame[hide@tablet, cols@phone=all, cols=1-8]{x}}")).toBe(
      "\\scene{\n  \\frame[cols=1-8, cols@phone=all, hide@tablet]{\n    x\n  }\n}\n",
    );
  });

  it("quotes strings and pairs, lowercases colors, writes false explicitly (rules 5-7)", () => {
    const out = body('\\palette[name=n, accent=#ABCDEF]\n\\figure[src=/a.png, alt=x]');
    expect(out).toContain("accent=#abcdef");
    expect(out).toContain('alt="x"');
    expect(out).toContain("src=/a.png");
    expect(body('\\figure[src="https://x.org/i.png?w=2", alt=""]')).toContain('src="https://x.org/i.png?w=2"');
  });

  it("fills a long attribute list to 100 columns, aligned past the `[` (rule 8)", () => {
    const out = body(
      "\\style[name=a-deliberately-long-style-name, size=fluid(18px, 22px, 360px, 1440px), leading=30px, tracking=-0.02em, weight=400]",
    );
    const lines = out.trimEnd().split("\n");
    expect(lines.length).toBe(2);
    expect(lines.every((l) => l.length <= 100)).toBe(true);
    expect(lines[1]!.startsWith(" ".repeat("\\style[".length))).toBe(true);
  });

  it("keeps the author's blank line or its absence, one at most (rule 10)", () => {
    expect(body("\\breakpoint[name=wide, min=1600px]\n\\breakpoint[name=huge, min=2400px]\n\n\n\n\\headline{Hi}\nText.")).toBe(
      "\\breakpoint[name=wide, min=1600px]\n\\breakpoint[name=huge, min=2400px]\n\n\\headline{Hi}\nText.\n",
    );
  });

  it("keeps a drop cap against its paragraph even across a blank line (rule 10)", () => {
    expect(body("\\dropcap[lines=3]\n\n\n\nStone endures.\nStill.\n\n\n\nMore.")).toBe(
      "\\dropcap[lines=3]\nStone endures. Still.\n\nMore.\n",
    );
  });

  it("keeps comments where they attach (rule 13)", () => {
    expect(body("%% lead\nA\n%% inside\nB\n\n\\headline{Hi %% tail\n}\n%% end")).toBe(
      "%% lead\nA B\n\n%% inside\n\\headline{Hi  %% tail\n}\n%% end\n",
    );
    expect(body("\\scene{ %% why\n\\frame{x}}")).toBe("\\scene{  %% why\n  \\frame{\n    x\n  }\n}\n");
  });
});

describe("format: minimal escapes (rule 12)", () => {
  const cases: [string, string][] = [
    ["40% of readers, 100%.", "40% of readers, 100%."],
    ["\\%% literal", "\\%% literal"],
    ["2 * 3 * 4", "2 * 3 * 4"],
    ["a\\*b", "a\\*b"],
    ["He said [the mayor] was wrong.", "He said [the mayor] was wrong."],
    ["[a](b c)", "[a](b c)"],
    ["x\\](y)", "x\\](y)"],
    ["a -- b --- c ---- d \\-\\- e ... f ....", "a -- b --- c ---- d -\\- e ... f ...."],
    ["en–dash—em…", "en--dash---em..."],
    ["–-", "–-"],
    ["\\.\\.\\.", ".\\.."],
    ["See [the *full* report](https://x.org/a).", "See [the *full* report](https://x.org/a)."],
    ["[a \\[b\\]](x\\)y)", "[a \\[b\\]](x\\)y)"],
    ["`\\\\frame` and `\\{\\}`", "`\\\\frame` and `\\{\\}`"],
    ["***both*** and **a *b***", "***both*** and **a *b***"],
    ["He said \\\"hi\\\" and 'bye'", "He said \\\"hi\\\" and 'bye'"],
    ["one\\br two", "one \\br two"],
    ["x \\span[style=lede]{y} z", "x \\span[style=lede]{y} z"],
  ];
  for (const [src, want] of cases) {
    it(JSON.stringify(src), () => expect(body(src)).toBe(`${want}\n`));
  }

  it("keeps an escaped quote at the start of an inline body", () => {
    expect(body('\\headline{ \\"x}')).toBe('\\headline{\\"x}\n');
  });
});

describe("format: theme files", () => {
  it("round-trips the built-in theme", () => {
    roundTrip(DEFAULT_THEME_SOURCE, "theme");
  });
});
