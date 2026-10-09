/**
 * Formatter -- grammar §09 canonical form.
 *
 * AST in, canonical source out. Pure. The AST must come from a parse with no
 * errors: a tree with dropped nodes would format into a different document.
 *
 * `parse(format(ast))` equals `ast` apart from positions, value spellings
 * (`raw`, which rule 7 and friends rewrite by design), the length of blank runs
 * and blank lines at the edges of a body (rule 10 collapses and drops them), and
 * attribute order (rule 3 decides it).
 */

import { COMMANDS, FRONTMATTER_FIELDS, type AttrSchema, type Value } from "@wmxdsl/schema";
import { stringify } from "yaml";
import { ROOT_ID, type Attr, type Command, type Document, type Inline, type Node, type NodeId, type Theme, type Trivia } from "./ast.js";
import { typeValue } from "./values.js";

const MAX_COLUMNS = 100;

/**
 * Rule 3's "breakpoint declaration order": the built-in theme declares these
 * first (resolver `default-theme.ts`), then the file's own `\breakpoint`s.
 * Limit: a theme file's breakpoints are not read, so their overrides keep
 * source order after these; pass the theme in if that ever matters.
 */
const BUILTIN_BREAKPOINTS = ["phone", "tablet"];

export function format(ast: Document | Theme): string {
  const f = new Formatter(ast);
  const content = f.body(rootNodes(ast), 0, ROOT_ID, []);
  const head = "version" in ast ? frontmatter(ast) : "";
  const text = head + content.join("\n");
  return text.endsWith("\n") ? text : text + "\n";
}

function rootNodes(ast: Document | Theme): Node[] {
  if (!("version" in ast)) return ast.definitions;
  const all: Node[] = [...ast.definitions, ...(ast.folio ? [ast.folio] : []), ...ast.stories, ...ast.scenes, ...ast.implicitContent];
  // Ids are handed out in document order, so they restore the interleaving phase C split apart.
  return all.sort((a, b) => a.id - b.id);
}

function frontmatter(doc: Document): string {
  const ordered: Record<string, unknown> = {};
  const fm = doc.frontmatter as Record<string, unknown>;
  for (const field of FRONTMATTER_FIELDS) if (field.name in fm) ordered[field.name] = fm[field.name];
  return `---\n${stringify(ordered, { version: "1.2", lineWidth: 0 })}---\n\n`;
}

class Formatter {
  private readonly comments = new Map<NodeId, Trivia[]>();
  /** Nodes the author set off from the node before with a blank line (rule 10). */
  private readonly blankBefore = new Set<NodeId>();
  private readonly breakpoints: string[];

  constructor(ast: Document | Theme) {
    for (const t of ast.trivia) {
      if (t.type === "blank" && t.placement === "before") this.blankBefore.add(t.attachTo);
      if (t.type !== "comment") continue;
      const list = this.comments.get(t.attachTo) ?? [];
      list.push(t);
      this.comments.set(t.attachTo, list);
    }
    const declared = ast.definitions
      .filter((d) => d.name === "breakpoint")
      .map((d) => d.attrs.find((a) => a.key === "name")?.value)
      .map((v) => (v !== undefined && "id" in v ? v.id : ""));
    this.breakpoints = [...BUILTIN_BREAKPOINTS, ...declared];
  }

  /**
   * A block or struct body: rule 9 indentation, rule 10 blank lines, rule 13
   * comments. Appends to `lines`, whose last line is the opener, so a first
   * child's trailing comment can sit there.
   */
  body(nodes: readonly Node[], depth: number, owner: NodeId, lines: string[]): string[] {
    const pad = "  ".repeat(depth);
    nodes.forEach((node, i) => {
      const mine = (this.comments.get(node.id) ?? []).filter((c) => c.placement !== "end-of-body");
      let k = 0;
      // A trailing comment rides on the line before the node it attaches to.
      // Limit: only the first one can; any other becomes a whole-line comment.
      if (mine[0]?.placement === "trailing" && lines.length > 0) {
        lines[lines.length - 1] += `  ${mine[0].text}`;
        k = 1;
      }
      const prev = nodes[i - 1];
      const dropcapLead = prev?.kind === "command" && prev.name === "dropcap" && node.kind === "paragraph";
      // Two paragraphs always had a blank line between them, or they would be one.
      const blank = this.blankBefore.has(node.id) || (prev?.kind === "paragraph" && node.kind === "paragraph");
      if (prev !== undefined && blank && !dropcapLead) lines.push("");
      for (; k < mine.length; k++) lines.push(pad + (mine[k] as Trivia).text);
      if (node.kind === "paragraph") lines.push(pad + this.inline(node.runs));
      else lines.push(...this.command(node, depth));
    });
    for (const c of this.comments.get(owner) ?? []) {
      if (c.placement === "end-of-body") lines.push(pad + c.text);
    }
    return lines;
  }

  private command(cmd: Command, depth: number): string[] {
    const pad = "  ".repeat(depth);
    const schema = COMMANDS.get(cmd.name);
    const head = this.head(cmd, pad);
    if (cmd.body === null || schema === undefined) return head;

    if (schema.kind === "inline") {
      const ends = (this.comments.get(cmd.id) ?? []).filter((c) => c.placement === "end-of-body");
      head[head.length - 1] += `{${this.inline(cmd.body as Inline[])}`;
      if (ends.length === 0) {
        head[head.length - 1] += "}";
        return head;
      }
      // A comment inside an inline body forces the `}` onto its own line.
      head[head.length - 1] += `  ${(ends[0] as Trivia).text}`;
      for (const c of ends.slice(1)) head.push(`${pad}  ${c.text}`);
      head.push(`${pad}}`);
      return head;
    }

    head[head.length - 1] += "{";
    this.body(cmd.body as Node[], depth + 1, cmd.id, head);
    head.push(`${pad}}`);
    return head;
  }

  /** `\name[attrs]`, filled to 100 columns and broken after commas (rule 8). */
  private head(cmd: Command, pad: string): string[] {
    const parts = this.attrs(cmd);
    const name = `\\${cmd.name}`;
    if (parts.length === 0) return [pad + name];
    const cont = " ".repeat(pad.length + name.length + 1);
    const lines = [`${pad}${name}[${parts[0]}`];
    for (const p of parts.slice(1)) {
      const last = lines.length - 1;
      // +1 for the `,` or `]` that ends the line.
      if (`${lines[last]}, ${p}`.length + 1 <= MAX_COLUMNS) lines[last] += `, ${p}`;
      else {
        lines[last] += ",";
        lines.push(cont + p);
      }
    }
    lines[lines.length - 1] += "]";
    return lines;
  }

  private attrs(cmd: Command): string[] {
    const schema = COMMANDS.get(cmd.name);
    const keys = Object.keys(schema?.attrs ?? {});
    const rank = (a: Attr): number => {
      if (a.at === null) return -1;
      const i = this.breakpoints.indexOf(a.at);
      return i === -1 ? this.breakpoints.length : i;
    };
    const sorted = [...cmd.attrs].sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key) || rank(a) - rank(b));
    return sorted.map((a) => {
      const key = a.at === null ? a.key : `${a.key}@${a.at}`;
      const decl = schema?.attrs[a.key] ?? { types: [] };
      if (a.value.t === "boolean") return a.value.b ? key : `${key}=false`;
      return `${key}=${valueText(a.value, decl)}`;
    });
  }

  /** An inline sequence on one line. */
  inline(runs: readonly Inline[], inLink = false): string {
    let out = "";
    runs.forEach((run, i) => {
      switch (run.type) {
        case "text":
          out += escapeText(run.value, new Set(run.escapedQuotes ?? []), inLink);
          break;
        case "bold":
          out += `**${this.inline(run.runs, inLink)}**`;
          break;
        case "italic":
          out += `*${this.inline(run.runs, inLink)}*`;
          break;
        case "code":
          out += "`" + escapeCode(run.value) + "`";
          break;
        case "link":
          out += `[${this.inline(run.runs, true)}](${escapeHref(run.href)})`;
          break;
        case "command": {
          const cmd = run.node;
          if (cmd.name === "br" && i > 0) out += " ";
          out += this.command(cmd, 0).join("\n");
          const next = runs[i + 1];
          if (next === undefined || cmd.body !== null) break;
          // `\br` swallows the whitespace around it; anything else needs `[]` to end its name.
          if (cmd.name === "br") out += " ";
          else if (cmd.attrs.length === 0 && next.type === "text" && /^[a-z[]/.test(next.value)) out += "[]";
          break;
        }
      }
    });
    return out;
  }
}

// ---------------------------------------------------------------------------
// Values (rules 5-7)
// ---------------------------------------------------------------------------

function quote(s: string): string {
  return `"${s.replace(/[\\"]/g, "\\$&")}"`;
}

const BARE = /^[A-Za-z0-9_./:#$%+~-]+$/;

function valueText(v: Value, decl: AttrSchema): string {
  switch (v.t) {
    case "string":
      return quote(v.s);
    case "path": {
      // Bare only when it would read back as the same path, not a token, keyword or other type.
      const back = BARE.test(v.s) ? typeValue({ kind: "bare", text: v.s, start: 0, end: 0 }, decl) : null;
      return back?.ok === true && back.value.t === "path" ? v.s : quote(v.s);
    }
    case "pair":
      return quote(`${valueText(v.a, decl)} ${valueText(v.b, decl)}`);
    case "color":
      return v.raw.toLowerCase();
    case "fluid":
      return `fluid(${[v.min, v.max, v.from, v.to]
        .filter((x): x is Value => x !== undefined)
        .map((x) => x.raw)
        .join(", ")})`;
    case "poly":
      return `poly(${v.raw
        .slice(v.raw.indexOf("(") + 1, v.raw.lastIndexOf(")"))
        .split(",")
        .map((p) => p.trim().split(/\s+/).join(" "))
        .join(", ")})`;
    case "any":
      return v.raw.startsWith('"') ? quote(JSON.parse(v.raw) as string) : v.raw;
    default:
      return v.raw;
  }
}

// ---------------------------------------------------------------------------
// Text (rules 11-12): escape only what would otherwise be misread
// ---------------------------------------------------------------------------

const ALWAYS = new Set(["\\", "{", "}", "`"]);
const DASHES = new Set(["-", "–", "—"]);
const DOTS = new Set([".", "…"]);

function escapeText(v: string, quotes: ReadonlySet<number>, inLink: boolean): string {
  let out = "";
  let i = 0;
  while (i < v.length) {
    const c = v[i] as string;
    const prev = v[i - 1] ?? "";
    const next = v[i + 1] ?? "";

    if (quotes.has(i) || ALWAYS.has(c) || (c === "%" && next === "%")) {
      out += `\\${c}`;
      i++;
      continue;
    }
    if (c === "[" || c === "]") {
      // Outside a link, a bracket is literal unless `](` could close a link.
      out += inLink || (c === "]" && next === "(" && !/^\(\)|^\([^()\s]*[(\s]/.test(v.slice(i + 1))) ? `\\${c}` : c;
      i++;
      continue;
    }
    if (c === "*" || c === "-" || c === ".") {
      let j = i;
      while (v[j] === c) j++;
      const n = j - i;
      const run = v.slice(i, j);
      if (c === "*") {
        // Literal only between spaces, and never four or more (P034).
        const loose = n <= 3 && prev === " " && v[j] === " ";
        out += loose ? run : run.replace(/\*/g, "\\*");
      } else if ((c === "-" && (n === 2 || n === 3)) || (c === "." && n === 3)) {
        // Break the run so it cannot become a dash or an ellipsis: `-\-`, `-\--`, `.\..`.
        out += [...run].map((ch, k) => (k % 2 === 1 ? `\\${ch}` : ch)).join("");
      } else {
        out += run;
      }
      i = j;
      continue;
    }
    // Typographic characters go back to the ASCII the author most likely typed,
    // unless a neighbour would merge into the run.
    if (c === "–" && !DASHES.has(prev) && !DASHES.has(next)) out += "--";
    else if (c === "—" && !DASHES.has(prev) && !DASHES.has(next)) out += "---";
    else if (c === "…" && !DOTS.has(prev) && !DOTS.has(next)) out += "...";
    else out += c;
    i++;
  }
  return out;
}

function escapeCode(v: string): string {
  return v.replace(/[\\{}`]|%(?=%)/g, "\\$&");
}

function escapeHref(v: string): string {
  return v.replace(/[\\{}`()[\]]|%(?=%)/g, "\\$&");
}
