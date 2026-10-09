import { expect } from "vitest";
import type { Document, Theme } from "../src/ast.js";
import { format, parse } from "../src/index.js";
import { parseSurface, type SurfaceNode } from "../src/surface.js";

/** A compact, readable rendering of a surface tree for assertions. */
export function sketch(text: string, nodes: SurfaceNode[]): string[] {
  const out: string[] = [];
  const walk = (list: SurfaceNode[], depth: number): void => {
    for (const n of list) {
      const pad = "  ".repeat(depth);
      switch (n.kind) {
        case "text":
          out.push(`${pad}text ${JSON.stringify(text.slice(n.start, n.end))}`);
          break;
        case "escape":
          out.push(`${pad}escape ${JSON.stringify(n.char)}`);
          break;
        case "blank":
          out.push(`${pad}blank`);
          break;
        case "comment":
          out.push(`${pad}comment${n.whole ? "(line)" : "(trail)"} ${JSON.stringify(text.slice(n.start, n.end))}`);
          break;
        case "command": {
          const attrs = n.attrs === null ? "" : `[${n.attrs.attrs.map((a) => a.key + (a.at ? "@" + a.at : "")).join(",")}]`;
          out.push(`${pad}\\${n.name}${attrs}${n.body === null ? "" : " {"}`);
          if (n.body !== null) {
            walk(n.body, depth + 1);
            out.push(`${pad}}`);
          }
          break;
        }
      }
    }
  };
  walk(nodes, 0);
  return out;
}

export function surface(text: string): { sketch: string[]; codes: string[]; nodes: SurfaceNode[] } {
  const r = parseSurface(text);
  return { sketch: sketch(text, r.nodes), codes: r.diagnostics.map((d) => d.code), nodes: r.nodes };
}

/** The AST with what the formatter may legitimately change taken out (see format.ts). */
function comparable(ast: Document | Theme): unknown {
  return JSON.parse(
    JSON.stringify(
      { ...ast, trivia: ast.trivia.filter((t) => t.type === "comment") },
      (key, value: unknown) => {
        if (key === "source") return undefined;
        if (key === "raw" && typeof value === "string") return undefined;
        if (key === "attrs" && Array.isArray(value)) {
          return [...value].sort((a: { key: string; at: string | null }, b: { key: string; at: string | null }) =>
            `${a.key}@${a.at ?? ""}` < `${b.key}@${b.at ?? ""}` ? -1 : 1,
          );
        }
        return value;
      },
    ),
  );
}

/** Asserts vector 37 for one source and returns the canonical text. */
export function roundTrip(src: string, kind: "document" | "theme" = "document"): string {
  const first = parse(src, { kind });
  expect(first.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const out = format(first.ast as Document | Theme);
  const second = parse(out, { kind });
  expect(second.diagnostics.filter((d) => d.severity === "error"), out).toEqual([]);
  expect(comparable(second.ast as Document | Theme), out).toEqual(comparable(first.ast as Document | Theme));
  expect(format(second.ast as Document | Theme)).toBe(out);
  return out;
}
