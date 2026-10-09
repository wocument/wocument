/**
 * Definitions and the cascade (spec §02.1, §07), and tokens
 * (spec §07.2).
 *
 * Three levels, lowest first: the built-in theme, the theme file, the document.
 * For a given breakpoint, each level applies its base definition and then its
 * own `at=` redefinition before the next level. Attribute-level `key@bp`
 * overrides are applied last, over everything. Beneath all three sit the
 * schema's defaults, which are the spec's default columns.
 */

import { parse, type Command, type Document, type Node, type SourceKind, type Theme } from "@wmxdsl/parser";
import { COMMANDS, type Value } from "@wmxdsl/schema";

export type Attrs = Map<string, Value>;

/** The name a definition defines, for commands that have one. */
const nameOf = (c: Command): string | null => {
  const a = c.attrs.find((x) => x.key === "name" && x.at === null)?.value;
  return a && a.t === "ident" ? a.id : c.name === "grid" ? "default" : null;
};

const atOf = (c: Command): string | null => {
  const a = c.attrs.find((x) => x.key === "at" && x.at === null)?.value;
  return a && a.t === "ident" ? a.id : null;
};

export class Definitions {
  /** levels[i] = definition commands of level i, in source order. */
  constructor(private readonly levels: readonly (readonly Command[])[]) {}

  /** Every name defined for a command, in first-definition order. */
  names(command: string): string[] {
    const out: string[] = [];
    for (const level of this.levels)
      for (const c of level) {
        const n = c.name === command ? nameOf(c) : null;
        if (n !== null && !out.includes(n)) out.push(n);
      }
    return out;
  }

  /** Every definition of a command, in cascade order. */
  all(command: string): Command[] {
    return this.levels.flat().filter((c) => c.name === command);
  }

  has(command: string, name: string): boolean {
    return this.names(command).includes(name);
  }

  /** The definitions of `command` named `name` that apply at `bp`, in cascade order. */
  private applying(command: string, name: string, bp: string): Command[] {
    const out: Command[] = [];
    const matching = (c: Command): boolean => c.name === command && nameOf(c) === name;
    for (const level of this.levels) {
      for (const c of level) if (matching(c) && atOf(c) === null) out.push(c);
      for (const c of level) if (matching(c) && atOf(c) === bp) out.push(c);
    }
    return out;
  }

  /**
   * The attributes explicitly set for `command` named `name` at variant `bp`,
   * after the cascade, tokens substituted. Keys a definition does not set are
   * absent, so the caller can tell "set" from "default" (needed for `extends`).
   */
  attrs(command: string, name: string, bp: string): Attrs {
    const out: Attrs = new Map();
    const defs = this.applying(command, name, bp);
    for (const c of defs) for (const a of c.attrs) if (a.at === null && a.key !== "name" && a.key !== "at") out.set(a.key, a.value);
    for (const c of defs) for (const a of c.attrs) if (a.at === bp) out.set(a.key, a.value);
    for (const [k, v] of out) out.set(k, this.deref(command, k, v));
    return out;
  }

  /** A definition's body at `bp`: that of the last applying definition that has one (for `\parent`). */
  body(command: string, name: string, bp: string): Node[] {
    const withBody = this.applying(command, name, bp).filter((c) => Array.isArray(c.body));
    return (withBody.at(-1)?.body as Node[] | undefined) ?? [];
  }

  /** The definition command that carries a name, for source positions in diagnostics. */
  first(command: string, name: string): Command | null {
    for (const level of this.levels) for (const c of level) if (c.name === command && nameOf(c) === name) return c;
    return null;
  }

  /**
   * Replaces a token reference by the token's value, typed as attribute `key`
   * of `command` would type it (spec §07.2). A token may refer to another token;
   * a cycle or an unknown token is an error.
   */
  deref(command: string, key: string, v: Value, seen: string[] = []): Value {
    if (v.t !== "tokenref") return v;
    if (seen.includes(v.name)) throw new Error(`token cycle: ${[...seen, v.name].map((n) => `$${n}`).join(" -> ")}`);
    if (!this.has("token", v.name)) throw new Error(`unknown token $${v.name}`);
    const raw = this.attrs("token", v.name, "base").get("value")?.raw;
    if (raw === undefined) throw new Error(`token $${v.name} has no value`);
    return this.deref(command, key, typeRaw(command, key, raw), [...seen, v.name]);
  }
}

// ---------------------------------------------------------------------------
// Typing source spellings: schema defaults and token values
// ---------------------------------------------------------------------------

const defaultsCache = new Map<string, Attrs>();

/**
 * The schema's default for every attribute of `command` that has one, typed.
 * Defaults live in the schema as source spellings ("19px", "1bl"); rather than
 * keep a second copy here, they are typed by parsing them, so the spec's
 * default columns have exactly one home.
 */
export function schemaDefaults(command: string): Attrs {
  const hit = defaultsCache.get(command);
  if (hit) return hit;
  const schema = COMMANDS.get(command);
  if (!schema) throw new Error(`unknown command ${command}`);
  const pairs = Object.entries(schema.attrs)
    .filter(([, a]) => a.default !== undefined)
    .map(([k, a]) => `${k}=${a.default}`);
  const out: Attrs = new Map();
  for (const a of parseOne(command, pairs).attrs) if (a.key !== "name") out.set(a.key, a.value);
  defaultsCache.set(command, out);
  return out;
}

/** Types a raw source spelling as attribute `key` of `command` (used for token values). */
export function typeRaw(command: string, key: string, raw: string): Value {
  const v = parseOne(command, [`${key}=${raw}`]).attrs.find((a) => a.key === key)?.value;
  if (!v) throw new Error(`cannot type ${raw} as ${command} ${key}`);
  return v;
}

/**
 * Parses one command with the given attribute pairs. Commands are legal in
 * different places (a theme, a scene, a frame body, the top level), so each
 * context is tried in turn and the first that parses cleanly wins.
 */
function parseOne(command: string, pairs: string[]): Command {
  const schema = COMMANDS.get(command)!;
  const required = Object.entries(schema.attrs)
    .filter(([k, a]) => a.required && !pairs.some((p) => p.startsWith(`${k}=`)))
    // A placeholder the attribute's type accepts: the first enum value, else an identifier.
    .map(([k, a]) => `${k}=${a.enum?.[0] ?? "x"}`);
  const body = schema.arity === "required" ? (schema.kind === "scene" ? "{\\rule}" : "{x}") : "";
  const cmd = `\\${command}[${[...required, ...pairs].join(", ")}]${body}`;
  const FM = "---\nwmxdsl: 1\ntitle: x\n---\n";
  const contexts: [string, SourceKind][] = [
    [cmd, "theme"],
    [`${FM}\\scene{${cmd}}`, "document"],
    [`${FM}\\scene{\\frame{${cmd}\n\nx}}`, "document"],
    [`${FM}${cmd}\n\\scene{\\rule}`, "document"],
  ];
  for (const [src, kind] of contexts) {
    const r = parse(src, { kind });
    const found = r.ast ? findCommand(r.ast, command) : null;
    // Cross-field rules (an embed's provider wanting an id) do not matter here: accept the
    // parse when every requested attribute came back typed.
    const keys = pairs.map((p) => p.slice(0, p.indexOf("=")));
    if (found && keys.every((k) => found.attrs.some((a) => a.key === k))) return found;
  }
  throw new Error(`\\${command}[${pairs.join(", ")}] does not parse in any context`);
}

function findCommand(ast: Document | Theme, name: string): Command | null {
  const roots: Node[] = "form" in ast ? [...ast.definitions, ...(ast.folio ? [ast.folio] : []), ...ast.stories, ...ast.scenes] : ast.definitions;
  const walk = (nodes: readonly Node[]): Command | null => {
    for (const n of nodes) {
      if (n.kind !== "command") continue;
      if (n.name === name) return n;
      if (Array.isArray(n.body)) {
        const hit = walk(n.body as Node[]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(roots);
}
