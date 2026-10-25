/**
 * `woc build`: documents as a static site. Parse and resolve happen here, at
 * build time (spec §15.1 stages 1-3); layout and render happen in the reader's
 * browser (stages 4-5), because they depend on the screen.
 *
 *   <out>/index.html       the page (one input), or <out>/<name>.html (several)
 *   <out>/woc.<hash>.js    the page code: layout, renderer, text engine; one file for every page
 *   <out>/assets/          every file a page uses, named by content; JPEG, PNG and GIF as WebP
 *
 * A page holds the reading version (spec §13 rule 2: it works without
 * JavaScript) and the Resolved Document as JSON. When the script runs, it
 * replaces the reading version with the laid-out page.
 *
 * Limit: files from earlier builds stay in <out>; delete the folder for a clean build.
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import { createAssetHost } from "@wocument/assets";
import type { ResolvedDocument } from "@wocument/resolved-document";
import type { ResolveResult } from "@wocument/resolver";
import { renderStatic } from "@wocument/renderer";

export type BuildOptions = { out: string; public: string; webp: boolean };
export type AssetHost = ReturnType<typeof createAssetHost>;
/** Parses and resolves one file with the host; prints its diagnostics unless `quiet`; null on an error. */
export type ResolveWith = (file: string, host: AssetHost, quiet: boolean) => ResolveResult | null;

/** The page's script: lay out and render the document; on an error, show the reading version. */
const ENTRY = `
import { mount } from "@wocument/renderer";
const fail = (e) => { document.documentElement.classList.remove("woc-js"); console.error(e); };
try {
  const rd = JSON.parse(document.getElementById("woc-data").textContent);
  mount(document.getElementById("woc"), { onError: fail }).show(rd).catch(fail);
} catch (e) {
  fail(e);
}
`;

export async function buildSite(files: string[], opts: BuildOptions, resolveWith: ResolveWith): Promise<boolean> {
  const pages = files.map((file) => (files.length === 1 ? "index.html" : `${basename(file).replace(/\.woc$/, "")}.html`));
  const twice = pages.find((p, i) => pages.indexOf(p) !== i);
  if (twice) {
    console.error(`woc: two inputs would both be written to ${twice}. Rename one, or build them into different --out folders.`);
    return false;
  }

  const assets = join(opts.out, "assets");
  mkdirSync(assets, { recursive: true });
  const script = await runtime(opts.out);
  let ok = true;
  for (const [i, file] of files.entries()) {
    const host = createAssetHost({ publicDir: opts.public, sourceDir: dirname(file), copy: { url: "assets" }, ...(opts.webp ? { webp: { dir: assets, url: "assets" } } : {}) });
    // WebP conversion is asynchronous and resolving is not (assets/index.ts): resolve once to learn
    // which pictures to convert, convert them, then resolve for real.
    if (opts.webp && resolveWith(file, host, true)) await host.convert();
    const r = resolveWith(file, host, false);
    if (!r) {
      ok = false;
      continue;
    }
    const json = JSON.stringify(r.doc);
    // The host named every file it was asked about; copy the ones the page uses (not a picture served as WebP).
    for (const [url, src] of host.named()) if (json.includes(`"${url}"`)) copyFileSync(src, join(opts.out, url));
    writeFileSync(join(opts.out, pages[i]!), page(r.doc, json, script));
    console.error(`woc: built ${join(opts.out, pages[i]!)}`);
  }
  return ok;
}

/** Bundles the page script into <out>; returns its file name, named by content. */
async function runtime(out: string): Promise<string> {
  const r = await bundle({
    // Resolved from this package, so it finds @wocument/renderer wherever the CLI is installed.
    stdin: { contents: ENTRY, resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "js" },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    minify: true,
    write: false,
    logLevel: "silent",
  });
  const code = r.outputFiles[0]!.contents;
  const name = `woc.${createHash("sha1").update(code).digest("hex").slice(0, 10)}.js`;
  writeFileSync(join(out, name), code);
  return name;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(rd: ResolvedDocument, json: string, script: string): string {
  const description = rd.meta.description ? `\n<meta name="description" content="${esc(rd.meta.description)}">` : "";
  // `<` written as \u003c, so the text "</script>" in the document cannot end the data block.
  return `<!doctype html>
<html lang="${esc(rd.meta.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(rd.meta.title)}</title>${description}
<script>document.documentElement.classList.add("woc-js")</script>
<style>html, body { margin: 0; }</style>
<script type="module" src="${script}"></script>
</head>
<body>
<main id="woc">${renderStatic(rd)}</main>
<script type="application/json" id="woc-data">${json.replace(/</g, "\\u003c")}</script>
</body>
</html>
`;
}
