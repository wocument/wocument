/**
 * Prints a specification-style attribute table for every command, so a human
 * can diff the schema data against the specification tables.
 *
 *   npm run print-tables            # every command
 *   npm run print-tables -- figure  # one command
 */

import { COMMANDS, COMMAND_NAMES } from "../src/commands/registry.js";
import type { AttrSchema, CommandSchema } from "../src/types.js";

function typeOf(a: AttrSchema): string {
  const parts = a.types.map((t) => {
    if (t === "enum") return (a.enum ?? []).join(" ");
    if (t === "pair") return `pair(${a.pairOf ?? "length"})`;
    return t;
  });
  return parts.join(" or ");
}

function row(name: string, a: AttrSchema): string {
  const def = a.required === true ? "required" : (a.default ?? "none");
  const notes: string[] = [];
  if (a.responsive === false) notes.push("not responsive");
  if (a.note !== undefined) notes.push(a.note);
  return `| \`${name}\` | ${typeOf(a)} | ${def} | ${notes.join("; ")} |`;
}

function table(c: CommandSchema): string {
  const lines: string[] = [];
  const body =
    c.arity === "none" ? "none" : `${c.arity} (${c.kind ?? "-"})`;
  lines.push(`### \\${c.name}  — spec ${c.spec}`);
  lines.push("");
  lines.push(`class: ${c.class} · body: ${body}`);
  if (c.children.length > 0) lines.push(`children: ${c.children.join(" ")}`);
  if (c.maxOnce.length > 0) lines.push(`at most once: ${c.maxOnce.join(" ")}`);
  for (const r of c.rules) lines.push(`rule (${r.code}): ${r.describe}`);
  lines.push("");
  const keys = Object.keys(c.attrs);
  if (keys.length === 0) {
    lines.push("_No attributes._");
  } else {
    lines.push("| Attribute | Type | Default | Notes |");
    lines.push("| :---- | :---- | :---- | :---- |");
    for (const k of keys) lines.push(row(k, c.attrs[k] as AttrSchema));
  }
  lines.push("");
  return lines.join("\n");
}

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : COMMAND_NAMES;
const out: string[] = ["# WMXDSL command schema", ""];
for (const n of names) {
  const c = COMMANDS.get(n);
  if (c === undefined) {
    console.error(`unknown command: ${n}`);
    process.exitCode = 1;
    continue;
  }
  out.push(table(c));
}
console.log(out.join("\n"));
