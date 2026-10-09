/**
 * AST -- grammar §08 (which extends spec §15.2).
 *
 * The tree mirrors the source. The parser does not desugar: shorthand scenes
 * and the implicit document form are recorded as forms, and the resolver
 * expands them.
 */

import type { Frontmatter, Value } from "@wmxdsl/schema";
import type { Pos } from "./positions.js";

/** Unique within one parse, assigned in document order. */
export type NodeId = number;

export type Attr = {
  key: string;
  /** The `@breakpoint` suffix, or null. */
  at: string | null;
  value: Value;
  source: Pos;
};

export type Command = {
  kind: "command";
  id: NodeId;
  name: string;
  attrs: Attr[];
  body: Node[] | Inline[] | null;
  /** Scenes and parents only. */
  sceneForm?: "explicit" | "shorthand";
  source: Pos;
};

export type Paragraph = {
  kind: "paragraph";
  id: NodeId;
  runs: Inline[];
  source: Pos;
};

export type Node = Command | Paragraph;

export type Inline =
  | { type: "text"; value: string; escapedQuotes?: number[] }
  | { type: "bold" | "italic"; runs: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; runs: Inline[] }
  /** Covers \br, \span and \endmark. */
  | { type: "command"; node: Command };

export type Trivia = {
  type: "comment" | "blank";
  text: string;
  attachTo: NodeId;
  placement: "before" | "trailing" | "end-of-body";
  source: Pos;
};

export type Document = {
  version: 1;
  frontmatter: Frontmatter;
  definitions: Command[];
  folio: Command | null;
  form: "explicit" | "implicit";
  /** Explicit form. */
  stories: Command[];
  /** Explicit form. */
  scenes: Command[];
  /** Implicit form. */
  implicitContent: Node[];
  trivia: Trivia[];
};

export type Theme = {
  definitions: Command[];
  trivia: Trivia[];
};

/** The document root. Trivia at the end of the top level attaches here. */
export const ROOT_ID: NodeId = 0;

/** Hands out node ids in document order. Id 0 is reserved for the root. */
export class IdGen {
  private next = 1;
  take(): NodeId {
    return this.next++;
  }
}
