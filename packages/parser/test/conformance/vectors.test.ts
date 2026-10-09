/**
 * The 37 conformance vectors of grammar §13, end to end through parse().
 *
 * "Input (content only)" in the table means the body of a document, so each
 * vector is wrapped in minimal frontmatter unless it tests frontmatter itself.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import { roundTrip } from "../helpers.js";
import type { Command, Document, Inline, Node, Paragraph } from "../../src/ast.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";

type Parsed = {
  doc: Document;
  codes: string[];
  hints: (string | undefined)[];
  content: Node[];
};

/** Parses `src` as the content of an implicit-form document. */
function content(src: string): Parsed {
  const r = parse(FM + src, { file: "t.wmx" });
  const doc = r.ast as Document;
  return {
    doc,
    codes: r.diagnostics.map((d) => d.code),
    hints: r.diagnostics.map((d) => d.hint),
    content: doc.form === "implicit" ? doc.implicitContent : [],
  };
}

function whole(src: string) {
  const r = parse(FM + src, { file: "t.wmx" });
  return { doc: r.ast as Document, codes: r.diagnostics.map((d) => d.code), ok: r.ok, diagnostics: r.diagnostics };
}

const paras = (nodes: Node[]): Paragraph[] => nodes.filter((n): n is Paragraph => n.kind === "paragraph");
const cmds = (nodes: Node[]): Command[] => nodes.filter((n): n is Command => n.kind === "command");

/** Flattens an inline sequence to a compact description. */
function flat(runs: Inline[]): unknown[] {
  return runs.map((r) => {
    switch (r.type) {
      case "text":
        return r.value;
      case "bold":
        return { b: flat(r.runs) };
      case "italic":
        return { i: flat(r.runs) };
      case "code":
        return { code: r.value };
      case "link":
        return { link: r.href, runs: flat(r.runs) };
      case "command":
        return { cmd: r.node.name };
    }
  });
}

const textOf = (nodes: Node[]): unknown[] => flat(paras(nodes)[0]?.runs ?? []);

describe("conformance vectors 1-10", () => {
  it("1. a single % is literal", () => {
    const r = content("40% of readers, 100%.");
    expect(r.codes).toEqual([]);
    expect(paras(r.content)).toHaveLength(1);
    expect(textOf(r.content)).toEqual(["40% of readers, 100%."]);
  });

  it("2. a trailing comment leaves one paragraph plus trivia", () => {
    const r = content("Done. %% note");
    expect(r.codes).toEqual([]);
    expect(textOf(r.content)).toEqual(["Done."]);
    expect(r.doc.trivia.filter((t) => t.type === "comment")).toHaveLength(1);
    expect(r.doc.trivia[0]?.text).toBe("%% note");
  });

  it("3. a whole-line comment joins the paragraph", () => {
    const r = content("A\n%% c\nB");
    expect(paras(r.content)).toHaveLength(1);
    expect(textOf(r.content)).toEqual(["A B"]);
  });

  it("4. blank lines around a comment split the paragraph", () => {
    const r = content("A\n\n%% c\n\nB");
    expect(paras(r.content)).toHaveLength(2);
  });

  it("5. \\%% is a literal %%", () => {
    const r = content("\\%% literal");
    expect(r.codes).toEqual([]);
    expect(textOf(r.content)).toEqual(["%% literal"]);
  });

  it("6. \\frame [x] inside a scene is P042", () => {
    const r = whole("\\scene{\n\\frame [x]\n}");
    expect(r.codes).toContain("P042");
  });

  it("7. \\headline {Hi} is P018 and P010 with the whitespace hint", () => {
    const r = whole("\\headline {Hi}");
    expect(r.codes.sort()).toEqual(["P010", "P018"]);
    const p010 = r.diagnostics.find((d) => d.code === "P010");
    expect(p010?.hint).toBe("Remove the whitespace before `{`.");
  });

  it("8. \\dropcap then a paragraph, with no blank line", () => {
    const r = content("\\dropcap[lines=3]\nStone endures.");
    expect(r.codes).toEqual([]);
    expect(cmds(r.content).map((c) => c.name)).toEqual(["dropcap"]);
    expect(paras(r.content)).toHaveLength(1);
    expect(textOf(r.content)).toEqual(["Stone endures."]);
  });

  it("9. a block command splits the surrounding text into two paragraphs", () => {
    const r = content('Text \\figure[src=/a.png, alt=""] more.');
    expect(r.codes).toEqual([]);
    expect(r.content.map((n) => (n.kind === "paragraph" ? "p" : n.name))).toEqual(["p", "figure", "p"]);
    expect(flat(paras(r.content)[0]!.runs)).toEqual(["Text"]);
    expect(flat(paras(r.content)[1]!.runs)).toEqual(["more."]);
  });

  it("10. a pull quote holds a paragraph and a cite", () => {
    const r = content("\\pullquote{Short. \\cite{A. Name}}");
    expect(r.codes).toEqual([]);
    const pq = cmds(r.content)[0];
    expect(pq?.name).toBe("pullquote");
    const body = pq?.body as Node[];
    expect(body.map((n) => (n.kind === "paragraph" ? "p" : n.name))).toEqual(["p", "cite"]);
    expect(flat((body[0] as Paragraph).runs)).toEqual(["Short."]);
  });
});

describe("conformance vectors 11-20", () => {
  it("11. a blank line inside an inline body is P022", () => {
    expect(whole("\\headline{A\n\nB}").codes).toContain("P022");
  });

  it("12. brackets in prose are literal", () => {
    const r = content("He said [the mayor] was wrong.");
    expect(r.codes).toEqual([]);
    expect(textOf(r.content)).toEqual(["He said [the mayor] was wrong."]);
  });

  it("13. a link with emphasis inside its text", () => {
    const r = content("See [the *full* report](https://x.org/a).");
    expect(r.codes).toEqual([]);
    expect(textOf(r.content)).toEqual([
      "See ",
      { link: "https://x.org/a", runs: ["the ", { i: ["full"] }, " report"] },
      ".",
    ]);
  });

  it("14. a space in the URL means it is not a link", () => {
    const r = content("[a](b c)");
    expect(r.codes).toEqual([]);
    expect(textOf(r.content)).toEqual(["[a](b c)"]);
  });

  it("15. asterisks with whitespace on both sides are literal", () => {
    const r = content("2 * 3 * 4");
    expect(r.codes).toEqual([]);
    expect(textOf(r.content)).toEqual(["2 * 3 * 4"]);
  });

  it("16. *** opens bold then italic and closes both", () => {
    const r = content("***both***");
    expect(r.codes).toEqual([]);
    expect(textOf(r.content)).toEqual([{ b: [{ i: ["both"] }] }]);
  });

  it("17. closing in the wrong order is P031", () => {
    expect(content("**a *b** c*").codes).toContain("P031");
  });

  it("18. dash and dot runs convert only at exactly 2 or 3", () => {
    const r = content("a -- b --- c ---- d \\-\\- e ... f ....");
    expect(r.codes).toEqual([]);
    expect(textOf(r.content)).toEqual(["a – b — c ---- d -- e … f ...."]);
  });

  it("19. a code span is not raw: \\\\ is a literal backslash", () => {
    const r = content("`\\\\frame`");
    expect(r.codes).toEqual([]);
    expect(textOf(r.content)).toEqual([{ code: "\\frame" }]);
  });

  it("20. a command inside a code span is P033", () => {
    const r = content("`\\frame`");
    expect(r.codes).toContain("P033");
    expect(r.hints.some((h) => h?.includes("Escape the backslash"))).toBe(true);
  });
});

describe("conformance vectors 21-31", () => {
  it("21. base value, breakpoint override and a bare boolean", () => {
    const r = whole("\\scene{\\frame[cols=1-8, cols@phone=all, hide@tablet]}");
    expect(r.codes).toEqual([]);
    const frame = (r.doc.scenes[0]?.body as Node[])[0] as Command;
    expect(frame.attrs.map((a) => [a.key, a.at, a.value])).toEqual([
      ["cols", null, { t: "range", from: 1, to: 8, raw: "1-8" }],
      ["cols", "phone", { t: "range", from: 1, to: "end", raw: "all" }],
      ["hide", "tablet", { t: "boolean", b: true, raw: "" }],
    ]);
  });

  it("22. duplicate attribute is P014", () => {
    expect(whole("\\scene{\\frame[cols=1-8, cols=2-4]}").codes).toContain("P014");
  });

  it("23. a reversed range is P015", () => {
    expect(whole("\\scene{\\frame[cols=8-1]}").codes).toContain("P015");
  });

  it("24. fluid and a negative em length", () => {
    expect(whole("\\style[name=x, size=fluid(18px, 22px), tracking=-0.02em]\n\\scene{\\frame}").codes).toEqual([]);
  });

  it("25. an unquoted URL with a query string is L003", () => {
    const r = whole('\\scene{\\figure[src=https://x.org/i.png?w=2, alt=""]}');
    expect(r.codes).toContain("L003");
  });

  it("26. quoting it makes it valid", () => {
    const r = whole('\\scene{\\figure[src="https://x.org/i.png?w=2", alt=""]}');
    expect(r.codes).toEqual([]);
  });

  it("27. poly with three points", () => {
    const r = whole('\\scene{\\figure[src=/a.png, shape=poly(0 0, 1 0, 0.5 1), alt="x"]}');
    expect(r.codes).toEqual([]);
  });

  it("28. a token reference is accepted for a colour", () => {
    expect(whole("\\palette[name=n, accent=$ember]\n\\scene{\\frame}").codes).toEqual([]);
  });

  it("29. a token reference is rejected for an ident", () => {
    const r = whole("\\scene[grid=$g]{\\frame}");
    expect(r.codes).toContain("P015");
  });

  it("30. an @ suffix on a non-responsive attribute is P013", () => {
    const r = whole("\\scene[name@phone=x]{\\frame}");
    expect(r.codes).toContain("P013");
    const d = r.diagnostics.find((x) => x.code === "P013");
    expect(d?.hint).toBe("This attribute cannot vary by breakpoint.");
  });

  it("31. an unknown command is P012 with a suggestion", () => {
    const r = whole("\\pullqoute{x}");
    expect(r.codes).toContain("P012");
    expect(r.diagnostics.find((d) => d.code === "P012")?.hint).toBe("Did you mean \\pullquote?");
  });
});

describe("conformance vectors 32-37", () => {
  it("32. a frame and a bare paragraph in one scene is P042", () => {
    const r = whole("\\story[name=main]{x}\n\\scene{\n\\frame[story=main]\n\nA paragraph.\n}");
    expect(r.codes).toContain("P042");
  });

  it("33. root-level content in a document with scenes is P041", () => {
    const r = whole("\\scene{\\frame}\n\nA root paragraph.");
    expect(r.codes).toContain("P041");
  });

  it("34. no scene means implicit form with two nodes", () => {
    const r = whole("\\headline{Hi}\n\nSome prose.");
    expect(r.codes).toEqual([]);
    expect(r.doc.form).toBe("implicit");
    expect(r.doc.implicitContent).toHaveLength(2);
    expect(r.doc.implicitContent[0]).toMatchObject({ kind: "command", name: "headline" });
    expect(r.doc.implicitContent[1]).toMatchObject({ kind: "paragraph" });
  });

  it("35. a definition after a story is P040", () => {
    const r = whole("\\story[name=main]{x}\n\\grid[cols=12]\n\\scene{\\frame[story=main]}");
    expect(r.codes).toContain("P040");
  });

  it("36. a frame with both story= and a body is P044", () => {
    const r = whole("\\story[name=main]{x}\n\\scene{\\frame[story=main]{text}}");
    expect(r.codes).toContain("P044");
  });

  it("38. a comment line that collapses onto a blank line still splits", () => {
    // The comment vanishes with its newline, leaving `A\n\nB`.
    const r = content("A\n%% c\n\nB");
    expect(r.codes).toEqual([]);
    expect(paras(r.content)).toHaveLength(2);
    expect(flat(paras(r.content)[0]!.runs)).toEqual(["A"]);
    expect(flat(paras(r.content)[1]!.runs)).toEqual(["B"]);
  });

  it("39. two adjacent backticks are P036", () => {
    const r = content("An empty `` span.");
    expect(r.codes).toContain("P036");
  });

  it("40. \\span without a style is P016", () => {
    const r = content("A \\span{x} b");
    expect(r.codes).toContain("P016");
    expect(content("A \\span[style=lead]{x} b").codes).toEqual([]);
  });

  it("41. focus takes percentages, not lengths", () => {
    expect(whole('\\scene{\\figure[src=/a.png, alt="", focus="40px 20px"]}').codes).toContain("P015");
    expect(whole('\\scene{\\figure[src=/a.png, alt="", focus="40% 20%"]}').codes).toEqual([]);
  });

  it("42. trailing trivia attaches to the enclosing command, not a missing node", () => {
    const r = whole("\\story[name=s]{Text %% c\n}\n\\scene{\\frame[story=s]}");
    expect(r.codes).toEqual([]);
    const story = r.doc.stories[0] as Command;
    const comment = r.doc.trivia.find((t) => t.type === "comment" && t.text === "%% c");
    expect(comment).toBeDefined();
    expect(comment?.attachTo).toBe(story.id);
    expect(comment?.placement).toBe("end-of-body");
  });

  it("42b. every attachTo names a node that exists", () => {
    const src = [
      "%% leading comment",
      "\\grid[name=g, cols=12]  %% trailing on a definition",
      "",
      "\\story[name=s]{",
      "  %% before the paragraph",
      "  First. %% trailing inside",
      "",
      "  \\subhead{Head}",
      "  %% end of the story body",
      "}",
      "",
      "\\scene[name=one, grid=g]{\\frame[story=s]}",
      "%% end of the document",
    ].join("\n");
    const r = whole(src);
    expect(r.codes).toEqual([]);
    const ids = new Set<number>([0]); // the document root
    const walk = (nodes: Node[]): void => {
      for (const n of nodes) {
        ids.add(n.id);
        if (n.kind === "command" && Array.isArray(n.body)) {
          walk((n.body as Node[]).filter((x): x is Node => typeof x === "object" && "kind" in x));
        }
      }
    };
    walk([...r.doc.definitions, ...r.doc.stories, ...r.doc.scenes]);
    expect(r.doc.trivia.length).toBeGreaterThan(4);
    for (const t of r.doc.trivia) {
      expect(ids.has(t.attachTo), `${t.type} ${JSON.stringify(t.text)} -> ${t.attachTo}`).toBe(true);
    }
    const atRoot = r.doc.trivia.filter((t) => t.attachTo === 0);
    expect(atRoot.some((t) => t.text === "%% end of the document")).toBe(true);
  });

  it("frame accepts measure (spec §09.2)", () => {
    expect(whole("\\scene{\\frame[measure=34em]{x}}").codes).toEqual([]);
    expect(whole("\\scene{\\frame[measure=none]{x}}").codes).toEqual([]);
  });

  it("43. \\folio is allowed once inside a \\parent, never inside a \\scene", () => {
    const ok = whole("\\parent[name=p, height=screen]{\\folio{Interlude}}\n\\scene[parent=p]{\\frame{x}}");
    expect(ok.codes).toEqual([]);
    const parent = ok.doc.definitions.find((d) => d.name === "parent") as Command;
    expect(parent.sceneForm).toBe("explicit");
    // Beside frames it is not story content, so no P042.
    expect(whole("\\parent[name=p]{\\frame{x}\n\\folio{A}}\n\\scene[parent=p]{\\frame{y}}").codes).toEqual([]);
    expect(whole("\\parent[name=p]{\\folio{A}\n\\folio{B}}\n\\scene[parent=p]{\\frame{y}}").codes).toContain("P020");
    expect(whole("\\scene{\\folio{A}\n\\frame{x}}").codes).toContain("P020");
  });

  // "Any valid file": every document in the repository. The rules themselves are in unit/format.test.ts.
  for (const dir of ["packages/parser/test/fixtures", "packages/playground/docs"].filter((d) => existsSync(d))) {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".wmx"))) {
      it(`37. format is a fixed point and parse round-trips: ${name}`, () => {
        roundTrip(readFileSync(`${dir}/${name}`, "utf8"));
      });
    }
  }
});

describe("phase B and C details", () => {
  it("allows \\credit as story content and as a media child", () => {
    expect(whole("\\scene{\\figure[src=/a.png, alt=\"\"]{\\credit{X}}}").codes).toEqual([]);
    expect(whole("Prose.\n\n\\credit{Photographs: A}").codes).toEqual([]);
  });

  it("rejects a second \\cite in a pull quote", () => {
    expect(content("\\pullquote{A \\cite{One} \\cite{Two}}").codes).toContain("P020");
  });

  it("rejects text directly inside a struct body", () => {
    expect(whole("\\scene{\\gallery{loose text}}").codes).toContain("P021");
  });

  it("rejects a block command inside an inline body", () => {
    expect(whole("\\headline{A \\figure[src=/a.png] B}").codes).toContain("P023");
  });

  it("rejects an empty inline body", () => {
    expect(whole("\\headline{}").codes).toContain("P019");
  });

  it("rejects a body on a bodiless command", () => {
    expect(whole("\\scene{\\frame{\\dropcap{x}}}").codes).toContain("P017");
  });

  it("rejects a child the parent does not allow", () => {
    const r = whole("\\scene{\\gallery{\\sidebar{x}}}");
    expect(r.codes).toContain("P020");
    expect(r.diagnostics.find((d) => d.code === "P020")?.hint).toContain("figure, video, caption, credit");
  });

  it("reports more than one document-level folio", () => {
    expect(whole("\\folio{A}\n\\folio{B}\n\\scene{\\frame}").codes).toContain("P043");
  });

  it("reports a missing required attribute", () => {
    expect(whole("\\scene{\\figure[alt=\"x\"]}").codes).toContain("P016");
  });

  it("reports an embed missing the id its provider needs", () => {
    expect(whole('\\scene{\\embed[provider=youtube, title="t"]}').codes).toContain("P016");
    expect(whole('\\scene{\\embed[provider=youtube, id=abc, title="t"]}').codes).toEqual([]);
    expect(whole('\\scene{\\embed[provider=iframe, title="t"]}').codes).toContain("P016");
  });

  it("classifies scene forms without desugaring", () => {
    const explicit = whole("\\scene{\\frame}").doc.scenes[0];
    expect(explicit?.sceneForm).toBe("explicit");
    const shorthand = whole("\\scene{\\headline{Hi}\n\nProse.}").doc.scenes[0];
    expect(shorthand?.sceneForm).toBe("shorthand");
    const objectsOnly = whole('\\scene{\\figure[src=/a.png, alt=""]}').doc.scenes[0];
    expect(objectsOnly?.sceneForm).toBe("explicit");
  });

  it("keeps \\story out of an implicit document", () => {
    const r = whole("\\story[name=main]{x}");
    expect(r.codes).toContain("P020");
    expect(r.diagnostics.find((d) => d.code === "P020")?.hint).toBe("Add a \\scene.");
  });

  it("reports every error in a phase, not just the first", () => {
    const r = whole("\\scene{\\frame[nope=1, alsonope=2]}");
    expect(r.codes.filter((c) => c === "P013")).toHaveLength(2);
  });

  it("parses a theme file as definitions only", () => {
    const ok = parse("\\grid[name=g, cols=12]\n\\style[name=body, size=19px]", { kind: "theme" });
    expect(ok.diagnostics).toEqual([]);
    expect((ok.ast as { definitions: Command[] }).definitions.map((d) => d.name)).toEqual(["grid", "style"]);
    const bad = parse("\\grid[cols=12]\n\nProse is not allowed.", { kind: "theme" });
    expect(bad.diagnostics.map((d) => d.code)).toContain("P045");
  });

  it("records escaped quotes so the resolver leaves them straight", () => {
    const r = content('He is 6\\\' 2\\" tall.');
    expect(r.codes).toEqual([]);
    const run = paras(r.content)[0]?.runs[0];
    expect(run).toMatchObject({ type: "text" });
    expect((run as { escapedQuotes?: number[] }).escapedQuotes).toHaveLength(2);
  });

  it("drops the whitespace around a forced line break", () => {
    const r = content("\\headline{Stone \\br & Strategy}");
    const headline = cmds(r.content)[0];
    expect(flat(headline?.body as Inline[])).toEqual(["Stone", { cmd: "br" }, "& Strategy"]);
  });
});
