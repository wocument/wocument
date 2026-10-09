/**
 * The five fixture articles, extracted verbatim from the documents:
 *   - spec §18, the complete example and the minimum valid file
 *   - stress test §01, §02 and §03
 *
 * Each must parse with zero diagnostics. The warnings those documents mention
 * (missing `alt`, linearize, `snap=hard` on a flow scene) are resolve
 * warnings, not parser ones.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import type { Command, Document, Node } from "../../src/ast.js";

const here = dirname(fileURLToPath(import.meta.url));

const FIXTURES = [
  "stone-and-strategy.wmx",
  "minimum.wmx",
  "white-desert.wmx",
  "the-last-signalman.wmx",
  "forty-questions.wmx",
] as const;

const read = (name: string): string => readFileSync(join(here, name), "utf8");

describe("fixtures", () => {
  it("has exactly the five expected files", () => {
    const found = readdirSync(here).filter((f) => f.endsWith(".wmx")).sort();
    expect(found).toEqual([...FIXTURES].sort());
  });

  for (const name of FIXTURES) {
    it(`${name} parses with zero diagnostics`, () => {
      const r = parse(read(name), { file: name });
      const shown = r.diagnostics.map((d) => `${d.code} ${d.pos.line}:${d.pos.column} ${d.message}`);
      expect(shown).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.ast).not.toBeNull();
    });

    it(`${name} has a snapshot-stable AST`, () => {
      const a = JSON.stringify(parse(read(name)).ast);
      const b = JSON.stringify(parse(read(name)).ast);
      expect(a).toBe(b);
      expect(JSON.parse(a)).toMatchSnapshot();
    });
  }
});

describe("what the fixtures prove", () => {
  const doc = (name: string): Document => parse(read(name)).ast as Document;

  it("the minimum valid file is implicit form", () => {
    const d = doc("minimum.wmx");
    expect(d.form).toBe("implicit");
    expect(d.scenes).toHaveLength(0);
    expect(d.implicitContent.map((n) => (n.kind === "paragraph" ? "p" : n.name))).toEqual(["headline", "p"]);
  });

  it("Stone & Strategy threads one story through four scenes", () => {
    const d = doc("stone-and-strategy.wmx");
    expect(d.form).toBe("explicit");
    expect(d.stories.map((s) => attr(s, "name"))).toEqual(["main"]);
    expect(d.scenes.map((s) => attr(s, "name"))).toEqual(["opener", "part-one", "breath", "part-two"]);
    expect(d.folio).not.toBeNull();
    expect(d.definitions.map((c) => c.name)).toEqual([
      "font", "font", "font", "token", "palette", "grid", "grid", "grid", "style", "style", "parent",
    ]);
  });

  it("keeps breakpoint overrides as separate attributes", () => {
    const d = doc("stone-and-strategy.wmx");
    const opener = d.scenes[0] as Command;
    const frame = (opener.body as Node[]).find(
      (n): n is Command => n.kind === "command" && n.name === "frame",
    );
    expect(frame?.attrs.filter((a) => a.key === "cols").map((a) => a.at)).toEqual([null, "tablet", "phone"]);
  });

  it("White Desert uses a parent for every plate and a strip gallery", () => {
    const d = doc("white-desert.wmx");
    expect(d.definitions.filter((c) => c.name === "parent")).toHaveLength(1);
    const strip = d.scenes.flatMap((s) => (s.body as Node[]))
      .find((n): n is Command => n.kind === "command" && n.name === "gallery");
    expect(strip).toBeDefined();
    expect((strip?.body as Node[]).map((n) => (n as Command).name)).toEqual([
      "figure", "figure", "figure", "figure", "figure", "caption",
    ]);
  });

  it("The Last Signalman carries links inside an inline body", () => {
    const d = doc("the-last-signalman.wmx");
    const opener = d.scenes.find((s) => attr(s, "name") === "opener") as Command;
    const frame = (opener.body as Node[]).find(
      (n): n is Command => n.kind === "command" && n.name === "frame",
    ) as Command;
    const meta = (frame.body as Node[]).find(
      (n): n is Command => n.kind === "command" && n.name === "meta",
    ) as Command;
    const links = (meta.body as { type: string; href?: string }[]).filter((r) => r.type === "link");
    expect(links.map((l) => l.href)).toEqual(["#two", "#three"]);
  });

  it("Forty Questions keeps \\span inline inside paragraphs", () => {
    const d = doc("forty-questions.wmx");
    const story = d.stories[0] as Command;
    const withSpan = (story.body as Node[]).filter(
      (n) => n.kind === "paragraph" && n.runs.some((r) => r.type === "command" && r.node.name === "span"),
    );
    expect(withSpan.length).toBeGreaterThan(4);
  });

  it("records scene forms across all fixtures without desugaring", () => {
    for (const name of FIXTURES) {
      for (const scene of doc(name).scenes) {
        expect(scene.sceneForm, `${name} ${attr(scene, "name") ?? "?"}`).toMatch(/^(explicit|shorthand)$/);
        // The default frame is never synthesized: shorthand scenes hold their
        // content directly, exactly as written.
        if (scene.sceneForm === "shorthand") {
          expect((scene.body as Node[]).some((n) => n.kind === "command" && n.name === "frame")).toBe(false);
        }
      }
    }
  });
});

function attr(cmd: Command, key: string): string | undefined {
  const a = cmd.attrs.find((x) => x.key === key && x.at === null);
  if (a === undefined) return undefined;
  return a.value.t === "ident" || a.value.t === "enum" ? a.value.id : a.value.raw;
}
