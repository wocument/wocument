/**
 * @wmxdsl/parser -- public API.
 *
 * Pure: no DOM, no file system, no network, no clocks, no randomness. The
 * same source always gives the same result, in Node and in a browser worker.
 *
 * The parser never throws on bad input. Every problem is a Diagnostic.
 */

import { IdGen, type Document, type Node, type Theme, type Trivia } from "./ast.js";
import { Diagnostics, type Diagnostic } from "./diagnostics.js";
import { buildDocument, buildTheme } from "./document.js";
import { prepare, type SourceKind } from "./prepare.js";
import { shapeRoot, type ShapeContext } from "./shape.js";
import { scanSurface } from "./surface.js";

export type ParseOptions = {
  /** Used in diagnostics only. */
  file?: string;
  /** Default "document". */
  kind?: SourceKind;
};

export type ParseResult = {
  /** null when phase A0 or phase A could not produce a tree. */
  ast: Document | Theme | null;
  /** Sorted by position. */
  diagnostics: Diagnostic[];
  /** True when there are no errors. Warnings are allowed. */
  ok: boolean;
};

export function parse(input: string | Uint8Array, options: ParseOptions = {}): ParseResult {
  const kind: SourceKind = options.kind ?? "document";
  const diags = new Diagnostics(options.file);

  const prepared = prepare(input, kind, diags);
  if (prepared.fatal) {
    return { ast: null, diagnostics: diags.sorted(), ok: false };
  }

  const surface = scanSurface(prepared.text, prepared.contentStart, prepared.text.length, diags, prepared.index);

  const trivia: Trivia[] = [];
  const ctx: ShapeContext = {
    text: prepared.text,
    index: prepared.index,
    diags,
    ids: new IdGen(),
    trivia,
  };
  const nodes: Node[] = shapeRoot(ctx, surface);

  const ast: Document | Theme =
    kind === "theme"
      ? buildTheme({ nodes, trivia, diags })
      : buildDocument({ nodes, trivia, frontmatter: prepared.frontmatter, diags });

  const diagnostics = diags.sorted();
  return { ast, diagnostics, ok: !diagnostics.some((d) => d.severity === "error") };
}

export { format } from "./format.js";
export { parseSurface } from "./surface.js";
export type { SurfaceNode, SurfaceResult, SCommand, SText, SEscape, SBlank, SComment } from "./surface.js";
export type { Attr, Command, Document, Inline, Node, NodeId, Paragraph, Theme, Trivia } from "./ast.js";
export type { Diagnostic } from "./diagnostics.js";
export type { Pos } from "./positions.js";
export type { SourceKind } from "./prepare.js";
