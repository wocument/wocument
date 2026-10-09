#!/usr/bin/env node
/**
 * wmxdsl -- the command line: parse, resolve, format, check.
 *
 * Diagnostics go to stderr in spec §15.6's shape:
 *
 *   wmxdsl: parse error [P012] at castle.wmx:14:8
 *     Unknown command \pullqoute. Did you mean \pullquote?
 *
 * Exit status is 1 when anything reported an error (or, for `format --check`,
 * when a file is not in canonical form).
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createAssetHost } from "@wmxdsl/assets";
import { format, parse, type Diagnostic, type Document, type ParseResult, type Theme } from "@wmxdsl/parser";
import { resolve, type ResolveResult } from "@wmxdsl/resolver";
import { lineLengths, tooShortOrLong } from "./measure.js";

const USAGE = `usage: wmxdsl <command> [options] <file...>

  parse <file>       print the AST as JSON
  resolve <file>     print the Resolved Document as JSON
  format <file...>   print canonical source (grammar §09)
      --write        rewrite the files in place instead
      --check        print nothing; exit 1 if any file is not canonical
  check <file...>    parse and resolve, report every diagnostic

  --public <dir>     where site-absolute paths (/img/a.png) live (default: ./public)

A .wmxt file is read as a theme.`;

type Options = { public: string; write: boolean; check: boolean };

export function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      public: { type: "string", default: "public" },
      write: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...files] = positionals;
  if (values.help || command === undefined || files.length === 0) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }
  const opts: Options = { public: values.public as string, write: values.write as boolean, check: values.check as boolean };

  switch (command) {
    case "parse":
      return one(files, (file) => {
        const r = parseFile(file);
        if (r.ast) console.log(JSON.stringify(r.ast, null, 2));
        return r.ok;
      });
    case "resolve":
      return one(files, (file) => {
        const r = resolveFile(file, opts);
        if (r) console.log(JSON.stringify(r.doc, null, 2));
        return r !== null;
      });
    case "format":
      return each(files, (file) => formatFile(file, opts));
    case "check":
      return each(files, (file) => {
        if (file.endsWith(".wmxt")) return parseFile(file).ok;
        const r = resolveFile(file, opts);
        if (r) checkLineLength(file, r);
        return r !== null;
      });
    default:
      console.error(`wmxdsl: unknown command \`${command}\`\n\n${USAGE}`);
      return 2;
  }
}

function one(files: string[], run: (file: string) => boolean): number {
  if (files.length > 1) {
    console.error("wmxdsl: this command takes one file");
    return 2;
  }
  return run(files[0] as string) ? 0 : 1;
}

/** Every file runs even after one fails, so one invocation reports everything. */
function each(files: string[], run: (file: string) => boolean): number {
  let ok = true;
  for (const file of files) ok = run(file) && ok;
  return ok ? 0 : 1;
}

function parseFile(file: string): ParseResult {
  const r = parse(readFileSync(file), { file, kind: file.endsWith(".wmxt") ? "theme" : "document" });
  for (const d of r.diagnostics) report(d);
  return r;
}

function resolveFile(file: string, opts: Options): ResolveResult | null {
  const parsed = parseFile(file);
  if (!parsed.ok) return null;
  const doc = parsed.ast as Document;
  const sourceDir = dirname(file);

  let theme: Theme | null = null;
  if (doc.frontmatter.theme !== undefined) {
    const path = doc.frontmatter.theme;
    const themeFile = path.startsWith("/") ? join(opts.public, path) : resolvePath(sourceDir, path);
    const t = parseFile(themeFile);
    if (!t.ok) return null;
    theme = t.ast as Theme;
  }

  try {
    const r = resolve(doc, { file, theme, assets: createAssetHost({ publicDir: opts.public, sourceDir }) });
    for (const d of r.diagnostics) {
      console.error(`wmxdsl: ${d.category.replace("-", " ")} [${d.code}] at ${d.file}:${d.line}:${d.column}`);
      console.error(`  ${sentence(d.message)}${d.fix ? ` ${d.fix}` : ""}`);
    }
    return r;
  } catch (err) {
    // Resolve errors throw (spec §15.6).
    console.error(`wmxdsl: resolve error at ${file}\n  ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** W064 (a layout warning): body lines outside about 45 to 75 characters at a test width. */
function checkLineLength(file: string, r: ResolveResult): void {
  const off = lineLengths(r.doc).filter(tooShortOrLong);
  if (!off.length) return;
  const at = off.map((l) => `about ${l.chars} at ${l.width}px (${l.variant})`).join(", ");
  console.error(`wmxdsl: layout warning [W064] at ${file}:1:1`);
  console.error(`  Body lines hold ${at}; comfortable reading is about 45 to 75 characters a line (on a phone, 30 or more). Change the frame's columns or measure, or the text size, at those breakpoints.`);
}

function formatFile(file: string, opts: Options): boolean {
  const source = readFileSync(file, "utf8");
  const r = parseFile(file);
  // A tree with errors has lost nodes; formatting it would delete source.
  if (!r.ok || r.ast === null) return false;
  const out = format(r.ast as Document | Theme);
  if (opts.check) {
    if (out === source) return true;
    console.error(`${file}: not formatted`);
    return false;
  }
  if (opts.write) {
    if (out !== source) writeFileSync(file, out);
  } else {
    process.stdout.write(out);
  }
  return true;
}

function report(d: Diagnostic): void {
  const stage = d.code.startsWith("L") ? "lex" : "parse";
  console.error(`wmxdsl: ${stage} ${d.severity} [${d.code}] at ${d.file ?? "<input>"}:${d.pos.line}:${d.pos.column}`);
  console.error(`  ${sentence(d.message)}${d.hint ? ` ${d.hint}` : ""}`);
}

const sentence = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);

// Run only as a program, so tests can import `main`. argv[1] may be the npm bin symlink.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
