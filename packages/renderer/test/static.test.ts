/**
 * The no-JavaScript reading version (spec §13 rule 2, §14): the whole document as
 * plain semantic HTML in story order, built from the Resolved Document in Node.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAssetHost } from "@wmxdsl/assets";
import { parse, type Document } from "@wmxdsl/parser";
import type { ParagraphBlock, ResolvedDocument } from "@wmxdsl/resolved-document";
import { resolve } from "@wmxdsl/resolver";
import { renderStatic } from "../src/static.js";

const here = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const load = (path: string): ResolvedDocument => {
  const assets = createAssetHost({ publicDir: here("playground/public"), sourceDir: here(path.replace(/[^/]+$/, "")) });
  return resolve(parse(readFileSync(here(path), "utf8")).ast as Document, { assets }).doc;
};

/** The visible text of an HTML string, as lowercase words. */
function textWords(html: string): string[] {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<\/?(span|strong|em|code|a)\b[^>]*>/g, "") // inline tags sit inside words
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\u00ad/g, "");
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/** A story's words, as the resolver holds them. */
function storyWords(rd: ResolvedDocument, story: string): string[] {
  const blocks = rd.variants.base!.stories[story]!.blocks.filter((b): b is ParagraphBlock => b.kind === "paragraph");
  const text = blocks
    .map((b) => (b.dropcap ? rd.strings[b.dropcap.s] : "") + b.runs.map((r) => (r.kind === "break" ? " " : rd.strings[r.s])).join(""))
    .join(" ");
  return text.replace(/\u00ad/g, "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** Sample articles kept outside the repository run only where they are. */
const present = (p: string): boolean => existsSync(here(p));
const DOCS = [
  ...["playground/docs/magazine.wmx", "playground/docs/showcase.wmx"].filter(present),
  "parser/test/fixtures/minimum.wmx",
  "parser/test/fixtures/stone-and-strategy.wmx",
  "parser/test/fixtures/the-last-signalman.wmx",
  "parser/test/fixtures/white-desert.wmx",
  "parser/test/fixtures/forty-questions.wmx",
];

describe.each(DOCS)("%s", (path) => {
  const rd = load(path);
  const html = renderStatic(rd);
  const words = textWords(html);
  const joined = ` ${words.join(" ")} `;

  it("holds every threaded story's text, in order, exactly once", () => {
    for (const story of Object.keys(rd.variants.base!.threads)) {
      const want = storyWords(rd, story);
      // In order: the story's words are a subsequence of the page's (anchored objects sit between them, §14).
      let i = 0;
      for (const w of words) if (i < want.length && w === want[i]) i++;
      expect(i, `${story}: stopped at "${want[i]}"`).toBe(want.length);
      // Once: its opening phrase appears a single time.
      const opening = ` ${want.slice(0, 8).join(" ")} `;
      expect(joined.indexOf(opening), story).toBe(joined.lastIndexOf(opening));
    }
  });

  it("is well-formed enough: every opened element closes", () => {
    const body = html.replace(/<style[\s\S]*?<\/style>/g, "");
    const opened = [...body.matchAll(/<([a-z0-9]+)[\s>]/g)].map((m) => m[1]).filter((t) => !["img", "br", "hr", "source", "meta"].includes(t!));
    const closed = [...body.matchAll(/<\/([a-z0-9]+)>/g)].map((m) => m[1]);
    expect(closed.length).toBe(opened.length);
  });
});

describe.skipIf(!present("playground/docs/magazine.wmx"))("element mapping (§14)", () => {
  // Soft hyphens (kept in the output for the browser's hyphenation) removed for matching, and the
  // no-break spaces that bind short words in display text (§07.6 bind-short) read as spaces.
  const html = present("playground/docs/magazine.wmx") ? renderStatic(load("playground/docs/magazine.wmx")).replace(/\u00ad/g, "").replace(/\u00a0|&nbsp;/g, " ") : "";

  it("headline is h1, subheads are h2, scenes are sections", () => {
    expect(html).toMatch(/<h1[^>]*>The tide tables are wrong, and the fishermen know it<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>Twenty minutes on a spring tide<\/h2>/);
    expect((html.match(/<section /g) ?? []).length).toBe(3);
  });

  it("a figure is a figure with its image and alt text; a pull quote is a blockquote", () => {
    expect(html).toMatch(/<figure[^>]*><img [^>]*src="\/img\/keep-cutout\.png"[^>]*alt="A lighthouse keeper&#39;s tower in silhouette"/);
    expect(html).toMatch(/<blockquote[^>]*>[\s\S]*The light never went out on his watch/);
  });

  it("the first scene's story comes before the second's (story order)", () => {
    expect(html.indexOf("For a hundred and forty years")).toBeLessThan(html.indexOf("The light on the Bass Rock"));
  });

  it("hides itself only when the page says JavaScript is running", () => {
    expect(html).toContain(".wmx-js .wmx-static");
  });
});

describe("escaping", () => {
  it("text and attributes are escaped", () => {
    const src = '---\nwmxdsl: 1\ntitle: T\n---\n\\scene{\\frame{Fish & chips <b>not bold</b> "quoted"}}';
    const html = renderStatic(resolve(parse(src).ast as Document).doc);
    expect(html).toContain("Fish &amp; chips &lt;b&gt;not bold&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
});
