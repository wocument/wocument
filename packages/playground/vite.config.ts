/**
 * The build half of the pipeline (spec §15.1 stages 1-3) as a Vite plugin:
 * importing a `.wmx` file parses and resolves it in Node and hands the browser
 * the Resolved Document as JSON. Layout and rendering run in the page.
 *
 * Reads the workspace packages' compiled dist/, so `npm run dev` builds first.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { createAssetHost } from "@wmxdsl/assets";
import { format, parse, type Document, type Theme } from "@wmxdsl/parser";
import type { ResolvedDocument } from "@wmxdsl/resolved-document";
import { resolve } from "@wmxdsl/resolver";
import { renderStatic } from "@wmxdsl/renderer";

const publicDir = fileURLToPath(new URL("./public", import.meta.url));
/** Where `?doc=name` is looked up, as in src/main.ts: local sample articles, where present, and the parser fixtures. */
const docDirs = [fileURLToPath(new URL("./docs", import.meta.url)), fileURLToPath(new URL("../parser/test/fixtures", import.meta.url))].filter((d) => existsSync(d));

/** A saved document, parsed and resolved exactly as the editor's compile step does it: theme included. */
function resolveFile(id: string): ResolvedDocument {
  const { problems, rd } = compile(readFileSync(id, "utf8"), dirname(id));
  if (!rd) throw new Error(problems.filter((p) => p.severity === "error").map((p) => `${p.code} ${p.message}`).join("\n"));
  return rd;
}

/** A problem as the editor lists it: parse errors and resolve warnings in one shape. */
type Problem = { severity: "error" | "warning"; code: string; message: string; line: number; column: number };
type Compiled = { problems: Problem[]; rd: ResolvedDocument | null; formatted: string | null };

/**
 * The editor's compile step: the same parse and resolve as `resolveFile`, but
 * from unsaved text, and reporting problems instead of throwing. `dir` is where
 * relative paths (and the frontmatter theme) resolve from.
 */
function compile(source: string, dir: string): Compiled {
  const parsed = parse(source, { file: "editor.wmx" });
  const problems: Problem[] = parsed.diagnostics.map((d) => ({
    severity: d.severity,
    code: d.code,
    message: d.hint ? `${d.message} ${d.hint}` : d.message,
    line: d.pos.line,
    column: d.pos.column,
  }));
  if (!parsed.ok) return { problems, rd: null, formatted: null };
  const doc = parsed.ast as Document;
  const formatted = format(doc);
  try {
    let theme: Theme | null = null;
    const path = doc.frontmatter.theme;
    if (path !== undefined) {
      const t = parse(readFileSync(path.startsWith("/") ? join(publicDir, path) : join(dir, path)), { kind: "theme", file: path });
      if (!t.ok) throw new Error(`theme ${path}: ${t.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`);
      theme = t.ast as Theme;
    }
    const r = resolve(doc, { file: "editor.wmx", theme, assets: createAssetHost({ publicDir, sourceDir: dir }) });
    for (const d of r.diagnostics) {
      problems.push({ severity: "warning", code: d.code, message: d.fix ? `${d.message} ${d.fix}` : d.message, line: d.line, column: d.column });
    }
    return { problems, rd: r.doc, formatted };
  } catch (e) {
    // Resolve errors throw, with no position (QUESTIONS R23).
    problems.push({ severity: "error", code: "resolve", message: e instanceof Error ? e.message : String(e), line: 1, column: 1 });
    return { problems, rd: null, formatted };
  }
}

/** Every document the editor can open: `?doc=` names in the playground docs and the parser fixtures. */
function docNames(): string[] {
  return [...new Set(docDirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".wmx")).map((f) => f.slice(0, -4))))].sort();
}

/** The file for a document name, or null. Names are checked against the list, so no path can escape the doc folders. */
function docFile(name: string): string | null {
  if (!docNames().includes(name)) return null;
  return docDirs.map((d) => join(d, `${name}.wmx`)).find((f) => existsSync(f)) ?? null;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * The server listens on every interface (`--host`, so a phone can load pages),
 * so the editor endpoints check who is asking. Only the editor page may call
 * them: `Sec-Fetch-Site` is set by the browser and cannot be forged by another
 * site's script, so a page elsewhere cannot read or write documents through
 * this server. `local` further limits an endpoint to this machine.
 */
function guard(local: boolean, handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.headers["sec-fetch-site"] !== "same-origin") return send(res, 403, { error: "editor page only" });
    if (local && !LOOPBACK.has(req.socket.remoteAddress ?? "")) return send(res, 403, { error: "this machine only" });
    Promise.resolve(handle(req, res)).catch((e: unknown) => send(res, 500, { error: e instanceof Error ? e.message : String(e) }));
  };
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (text += chunk));
    req.on("end", () => ok(text));
    req.on("error", fail);
  });
}

function wmx(): Plugin {
  return {
    name: "wmx",
    // The editor page (editor.html): list, read, compile and save documents.
    configureServer(server) {
      server.middlewares.use("/__wmx/docs", guard(false, (_req, res) => send(res, 200, docNames())));
      server.middlewares.use("/__wmx/source", guard(false, (req, res) => {
        const file = docFile(new URL(req.url ?? "", "http://x").searchParams.get("doc") ?? "");
        if (!file) return send(res, 404, { error: "no such document" });
        send(res, 200, { source: readFileSync(file, "utf8") });
      }));
      server.middlewares.use("/__wmx/compile", guard(false, async (req, res) => {
        const { source, doc } = JSON.parse(await body(req)) as { source: string; doc: string };
        send(res, 200, compile(source, dirname(docFile(doc) ?? join(docDirs[0]!, "x.wmx"))));
      }));
      // Writes a file, so it answers this machine only, and only for a document that already exists.
      server.middlewares.use("/__wmx/save", guard(true, async (req, res) => {
        if (req.method !== "POST") return send(res, 405, { error: "POST only" });
        const { source, doc } = JSON.parse(await body(req)) as { source: string; doc: string };
        const file = docFile(doc);
        if (!file) return send(res, 404, { error: "no such document" });
        writeFileSync(file, source);
        send(res, 200, { saved: file.slice(file.indexOf("packages/")) });
      }));
    },
    load(id) {
      if (!id.endsWith(".wmx")) return null;
      return `export default ${JSON.stringify(resolveFile(id))};`;
    },
    // Spec §13 rule 2: the page is served with the document's text already in it, as a plain
    // reading version; the script lays the real page out over it. Errors are left to the script.
    transformIndexHtml(html, ctx) {
      const name = new URL(ctx.originalUrl ?? "/", "http://localhost").searchParams.get("doc") ?? "showcase";
      const file = docDirs.map((d) => join(d, `${name}.wmx`)).find((f) => existsSync(f));
      if (!file) return html;
      try {
        return html.replace('<main id="page"></main>', `<main id="page">${renderStatic(resolveFile(file))}</main>`);
      } catch {
        return html;
      }
    },
  };
}

export default defineConfig({
  plugins: [wmx()],
  // Port 5188 is the spike's; the playground gets its own.
  server: { port: 5190 },
});
