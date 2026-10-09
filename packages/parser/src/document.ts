/**
 * Phase C: document checks -- grammar §07.
 *
 * The root has already been shaped as a `block` body. This phase decides the
 * document form, enforces definition ordering and the theme-file rule, and
 * assembles the Document or Theme node.
 *
 * Name resolution is deliberately absent: whether grid `feature` exists, or
 * whether breakpoints overlap, is the resolve stage's job.
 */

import { DEFINITION_COMMANDS } from "@wmxdsl/schema";
import type { Command, Document, Node, Theme, Trivia } from "./ast.js";
import type { Diagnostics } from "./diagnostics.js";
import type { Frontmatter } from "@wmxdsl/schema";

export type DocumentInput = {
  nodes: Node[];
  trivia: Trivia[];
  frontmatter: Frontmatter | null;
  diags: Diagnostics;
};

/** Not a type predicate: negating one would narrow Node to Paragraph. */
const isDefinition = (n: Node): boolean =>
  n.kind === "command" && DEFINITION_COMMANDS.has(n.name);

export function buildDocument(input: DocumentInput): Document {
  const { nodes, diags } = input;

  // Rule 1: at least one \scene makes the document explicit.
  const form: "explicit" | "implicit" = nodes.some((n) => n.kind === "command" && n.name === "scene")
    ? "explicit"
    : "implicit";

  const definitions: Command[] = [];
  const stories: Command[] = [];
  const scenes: Command[] = [];
  const implicitContent: Node[] = [];
  let folio: Command | null = null;
  let sawNonDefinition = false;

  for (const n of nodes) {
    if (n.kind === "command" && isDefinition(n)) {
      // Rule 4: a definition after the first non-definition node.
      if (sawNonDefinition) {
        diags.add("P040", n.source, { name: n.name }, "Move every definition above the first story, scene or content.");
      }
      definitions.push(n);
      continue;
    }

    sawNonDefinition = true;

    if (n.kind === "command" && n.name === "folio") {
      // Rule 5.
      if (folio !== null) diags.add("P043", n.source);
      else folio = n;
      continue;
    }

    if (n.kind === "command" && n.name === "scene") {
      scenes.push(n);
      continue;
    }

    if (n.kind === "command" && n.name === "story") {
      if (form === "implicit") {
        diags.add("P020", n.source, { name: n.name, parent: "the document" }, "Add a \\scene.");
      } else {
        stories.push(n);
      }
      continue;
    }

    if (n.kind === "command" && (n.name === "frame" || n.name === "group")) {
      // Rule 2 for explicit form, rule 3 for implicit form -- P020 either way.
      diags.add(
        "P020",
        n.source,
        { name: n.name, parent: "the document" },
        form === "implicit" ? "Add a \\scene." : "Put it inside a \\scene.",
      );
      continue;
    }

    // Paragraphs, text elements, markers and objects at the root.
    if (form === "explicit") {
      diags.add("P041", n.source, {}, "Move it into a \\scene, or remove the scenes.");
      continue;
    }
    implicitContent.push(n);
  }

  return {
    version: 1,
    frontmatter: input.frontmatter ?? ({ wmxdsl: 1, title: "" } as Frontmatter),
    definitions,
    folio,
    form,
    stories,
    scenes,
    implicitContent,
    trivia: input.trivia,
  };
}

export function buildTheme(input: Omit<DocumentInput, "frontmatter">): Theme {
  const { nodes, diags } = input;
  const definitions: Command[] = [];
  for (const n of nodes) {
    if (n.kind === "command" && isDefinition(n)) {
      definitions.push(n);
      continue;
    }
    // Rule 6: theme files contain definitions only.
    diags.add("P045", n.source, {
      what: n.kind === "paragraph" ? "a paragraph" : `\\${n.name}`,
    });
  }
  return { definitions, trivia: input.trivia };
}
