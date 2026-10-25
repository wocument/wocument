/**
 * `woc dev`: an editor and a live page on this machine, for the documents in
 * one folder. The editor (client/index.html) has the source on the left and
 * the page on the right; the page alone is client/page.html, for a phone. The
 * `V` key shows the visor, which explains the layout's decisions.
 *
 * Parse and resolve run here, in Node, as `woc build` runs them (without the
 * WebP step, to stay fast); layout and render run in the page. Every file a
 * document uses is served at /__woc/files/<name-hash.ext>, so relative paths
 * work and a changed picture gets a new URL. A .woc or .woct file saved by
 * another editor updates the open pages.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { createAssetHost } from "@wocument/assets";
import { format, parse, type Document, type Theme } from "@wocument/parser";
import type { ResolvedDocument } from "@wocument/resolved-document";
import { resolve } from "@wocument/resolver";

export type DevOptions = {
  /** Where site-absolute paths (`/img/a.png`) are read from. */
  public: string;
  port: number;
  /** Listen on the network too, so a phone can open the page. Saving still works from this machine only. */
  host: boolean;
  /** Open the editor in the browser. */
  open: boolean;
};

/** A problem as the editor lists it: parse errors and resolve warnings in one shape. */
type Problem = { severity: "error" | "warning"; code: string; message: string; line: number; column: number };
type Compiled = { problems: Problem[]; rd: ResolvedDocument | null; formatted: string | null };

const TEMPLATE = `---
wocument: 1
title: Untitled
---
\\headline{Untitled}

Start writing here.
`;

const CLIENT = fileURLToPath(new URL("../client", import.meta.url));
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Starts the server. `target` is a folder, or a .woc file (made from a short
 * template if it does not exist yet), whose folder holds the documents.
 */
export async function dev(target: string, opts: DevOptions): Promise<ViteDevServer> {
  let folder = resolvePath(target);
  let first: string | null = null;
  if (target.endsWith(".woc")) {
    if (!existsSync(target)) writeFileSync(target, TEMPLATE);
    folder = dirname(folder);
    first = basename(target, ".woc");
  } else if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new Error(`${target} is not a folder or a .woc file`);
  }

  const names = (): string[] => readdirSync(folder).filter((f) => f.endsWith(".woc")).map((f) => f.slice(0, -4)).sort();
  /** The file for a document name, or null. Names are checked against the folder's list, so no path can escape it. */
  const fileOf = (name: string): string | null => (names().includes(name) ? join(folder, `${name}.woc`) : null);
  /** URL to source file, for every file a compiled document used. */
  const files = new Map<string, string>();

  /** Parse and resolve, reporting problems instead of throwing. */
  const compile = (source: string): Compiled => {
    const parsed = parse(source, { file: "editor.woc" });
    const problems: Problem[] = parsed.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.hint ? `${d.message} ${d.hint}` : d.message, line: d.pos.line, column: d.pos.column }));
    if (!parsed.ok) return { problems, rd: null, formatted: null };
    const doc = parsed.ast as Document;
    const formatted = format(doc);
    try {
      let theme: Theme | null = null;
      const path = doc.frontmatter.theme;
      if (path !== undefined) {
        const t = parse(readFileSync(path.startsWith("/") ? join(opts.public, path) : join(folder, path)), { kind: "theme", file: path });
        if (!t.ok) throw new Error(`theme ${path}: ${t.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`);
        theme = t.ast as Theme;
      }
      const host = createAssetHost({ publicDir: opts.public, sourceDir: folder, copy: { url: "/__woc/files" } });
      const r = resolve(doc, { file: "editor.woc", theme, assets: host });
      for (const [url, src] of host.named()) files.set(url, src);
      for (const d of r.diagnostics) problems.push({ severity: "warning", code: d.code, message: d.fix ? `${d.message} ${d.fix}` : d.message, line: d.line, column: d.column });
      return { problems, rd: r.doc, formatted };
    } catch (e) {
      // Resolve errors throw, with no position.
      problems.push({ severity: "error", code: "resolve", message: e instanceof Error ? e.message : String(e), line: 1, column: 1 });
      return { problems, rd: null, formatted };
    }
  };

  const plugin: Plugin = {
    name: "woc-dev",
    configureServer(server) {
      const use = (path: string, local: boolean, handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): void => {
        server.middlewares.use(path, guard(local, handle));
      };
      use("/__woc/docs", false, (_req, res) => send(res, 200, names()));
      use("/__woc/source", false, (req, res) => {
        const file = fileOf(param(req, "doc"));
        if (!file) return send(res, 404, { error: "no such document" });
        send(res, 200, { source: readFileSync(file, "utf8") });
      });
      use("/__woc/document", false, (req, res) => {
        const file = fileOf(param(req, "doc"));
        if (!file) return send(res, 404, { error: "no such document" });
        send(res, 200, compile(readFileSync(file, "utf8")));
      });
      use("/__woc/compile", false, async (req, res) => {
        const { source } = JSON.parse(await body(req)) as { source: string };
        send(res, 200, compile(source));
      });
      // Writes a file, so it answers this machine only, and only for a document that already exists.
      use("/__woc/save", true, async (req, res) => {
        if (req.method !== "POST") return send(res, 405, { error: "POST only" });
        const { source, doc } = JSON.parse(await body(req)) as { source: string; doc: string };
        const file = fileOf(doc);
        if (!file) return send(res, 404, { error: "no such document" });
        writeFileSync(file, source);
        send(res, 200, { saved: relative(process.cwd(), file) || basename(file) });
      });
      // Pictures, fonts and videos load as page elements and from a phone, so no Sec-Fetch-Site check:
      // only files a compiled document used are served.
      server.middlewares.use("/__woc/files", (req, res) => {
        const src = files.get(`/__woc/files${(req.url ?? "").split("?")[0]}`);
        if (!src || !existsSync(src)) return send(res, 404, { error: "no such file" });
        serveFile(req, res, src);
      });

      // Another editor saved a file: tell the open pages which document to show again (null: all, for a theme).
      server.watcher.add(folder);
      const changed = (file: string): void => {
        if (dirname(file) !== folder) return;
        if (file.endsWith(".woc")) server.ws.send({ type: "custom", event: "woc:change", data: { doc: basename(file, ".woc") } });
        else if (file.endsWith(".woct")) server.ws.send({ type: "custom", event: "woc:change", data: { doc: null } });
      };
      server.watcher.on("change", changed);
      server.watcher.on("add", changed);
    },
  };

  const server = await createServer({
    configFile: false,
    root: CLIENT,
    publicDir: false,
    cacheDir: join(tmpdir(), "woc-dev-vite"),
    appType: "mpa",
    logLevel: "warn",
    plugins: [plugin],
    server: { port: opts.port, host: opts.host ? true : "127.0.0.1", open: opts.open ? `/?doc=${encodeURIComponent(first ?? names()[0] ?? "")}` : false },
  });
  await server.listen();
  return server;
}

/**
 * The editor endpoints answer the dev pages only: `Sec-Fetch-Site` is set by
 * the browser and another site's script cannot forge it, so a page elsewhere
 * cannot read or write documents through this server. `local` further limits
 * an endpoint to this machine.
 */
function guard(local: boolean, handle: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.headers["sec-fetch-site"] !== "same-origin") return send(res, 403, { error: "the woc dev pages only" });
    if (local && !LOOPBACK.has(req.socket.remoteAddress ?? "")) return send(res, 403, { error: "this machine only" });
    Promise.resolve(handle(req, res)).catch((e: unknown) => send(res, 500, { error: e instanceof Error ? e.message : String(e) }));
  };
}

const param = (req: IncomingMessage, key: string): string => new URL(req.url ?? "", "http://x").searchParams.get(key) ?? "";

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

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".vtt": "text/vtt",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
  ".json": "application/json", ".txt": "text/plain",
};

/** A file, with one byte range when asked: a video seeks with ranges, and Safari plays none without them. */
function serveFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  const data = readFileSync(file);
  res.setHeader("content-type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("accept-ranges", "bytes");
  // Named by content, so a URL never changes what it serves.
  res.setHeader("cache-control", "max-age=31536000, immutable");
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!m || (!m[1] && !m[2])) {
    res.end(data);
    return;
  }
  const start = m[1] ? Number(m[1]) : Math.max(0, data.length - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
  if (start > end) {
    res.statusCode = 416;
    res.setHeader("content-range", `bytes */${data.length}`);
    res.end();
    return;
  }
  res.statusCode = 206;
  res.setHeader("content-range", `bytes ${start}-${end}/${data.length}`);
  res.end(data.subarray(start, end + 1));
}
