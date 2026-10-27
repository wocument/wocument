#!/usr/bin/env node
/**
 * Render check: lays a Wocument document out in a real browser at several widths, saves a
 * screenshot of every screen, and reports what a reader would notice.
 *
 *   node skills/wocument/scripts/render-check.mjs article.woc [--public public] [--widths 390,1280,1920] [--out .woc-check]
 *
 * Needs @wocument/cli (the woc command) and Playwright with Chromium where it runs:
 *   npm install -D playwright && npx playwright install chromium
 *
 * It runs `woc check` (diagnostics and copyfitting advice), then starts `woc dev` on the
 * document's folder and opens `page.html?doc=<name>&inspect` at each width with reduced motion
 * (reveals off, so nothing is hidden), scrolls through so lazy pictures load, and reads the
 * page's own report (holes in columns, text moved by widow and orphan control, pictures that
 * found no good spot, loose lines) with errors, failed loads and sideways overflow.
 * Writes <out>/<name>/report.json, <out>/<name>/report.md and <out>/<name>/w<width>-s<NN>.png.
 * Exit status 1 when the page has errors (a broken document, a missing file, a script error,
 * sideways overflow); findings alone are advice and exit 0.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    public: { type: "string", default: "public" },
    widths: { type: "string", default: "390,1280,1920" },
    out: { type: "string", default: ".woc-check" },
    screens: { type: "string", default: "12" },
  },
});
const file = positionals[0];
if (!file || !file.endsWith(".woc")) {
  console.error("usage: render-check.mjs article.woc [--public dir] [--widths 390,1280,1920] [--out dir] [--screens 12]");
  process.exit(2);
}
const name = basename(file, ".woc");
const out = resolve(values.out, name);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The woc command and Playwright, from where the check runs.
const require = createRequire(join(process.cwd(), "noop.js"));
const cliDir = dirname(require.resolve("@wocument/cli/package.json"));
const playwright = await import(require.resolve("playwright"));
const chromium = playwright.chromium ?? playwright.default.chromium;
const { dev } = await import(join(cliDir, "dist", "dev.js"));

/** A width's window height: a phone, a laptop, a desktop. */
const heightOf = (w) => (w < 600 ? 844 : w < 1100 ? 1024 : w < 1600 ? 800 : 1080);
const widths = values.widths.split(",").map(Number).filter((w) => w > 0);
const maxScreens = Number(values.screens);

// 1. Diagnostics and copyfitting advice.
const check = spawnSync(process.execPath, [join(cliDir, "dist", "cli.js"), "check", file, "--public", values.public], { encoding: "utf8" });
const diagnostics = (check.stderr ?? "").trim();
const broken = check.status !== 0;

// 2. The page at each width.
const server = await dev(resolve(file), { public: resolve(values.public), port: 0, host: false, open: false });
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
const results = [];
try {
  for (const width of widths) {
    const height = heightOf(width);
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const errors = [];
    // A failed load is reported once, with its path, by the response handler.
    page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(`console: ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`script: ${e.message}`));
    page.on("response", (r) => r.status() >= 400 && errors.push(`failed to load (${r.status()}): ${new URL(r.url()).pathname}`));
    await page.goto(`${base}/page.html?doc=${encodeURIComponent(name)}&inspect`);
    const laidOut = await page.waitForSelector("html[data-woc-layouts]", { timeout: 20000 }).then(() => true, () => false);
    const failed = await page.evaluate(() => document.querySelector("#woc > pre")?.textContent ?? null);
    if (!laidOut || failed) {
      results.push({ width, height, error: failed ?? "the page did not lay out within 20s", errors });
      await page.close();
      continue;
    }
    // Scroll through so lazy pictures load, then wait for the network to settle.
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += height) await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForLoadState("networkidle").catch(() => {});
    const page_ = await page.evaluate(() => ({
      report: window.__woc.report,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")),
    }));
    if (page_.overflow) errors.push("the page scrolls sideways: something is wider than the screen");
    for (const src of page_.brokenImages) errors.push(`picture did not load: ${src}`);
    const screens = Math.min(maxScreens, Math.ceil(page_.report.height / height));
    const shots = [];
    for (let s = 0; s < screens; s++) {
      await page.evaluate((top) => window.scrollTo(0, top), s * height);
      await page.waitForTimeout(80);
      const path = join(out, `w${width}-s${String(s + 1).padStart(2, "0")}.png`);
      await page.screenshot({ path });
      shots.push(path);
    }
    results.push({ width, height, breakpoint: page_.report.breakpoint, pageHeight: Math.round(page_.report.height), screens: Math.ceil(page_.report.height / height), shots, findings: page_.report.findings, counts: page_.report.counts, errors });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

// 3. The report.
const failing = broken || results.some((r) => r.error || r.errors.length);
writeFileSync(join(out, "report.json"), JSON.stringify({ file, diagnostics, results }, null, 2));
const md = [`# Render check: ${file}`, "", failing ? "**Errors: fix them first.**" : "No errors.", "", "## woc check", "", "```", diagnostics || "(nothing)", "```", ""];
for (const r of results) {
  md.push(`## ${r.width}x${r.height}${r.breakpoint ? ` (${r.breakpoint})` : ""}`, "");
  if (r.error) md.push(`- **The page did not lay out:** ${r.error}`);
  for (const e of r.errors) md.push(`- **Error:** ${e}`);
  if (r.shots) {
    md.push(`- ${r.screens} screen${r.screens === 1 ? "" : "s"}, ${r.pageHeight}px. Screenshots: ${r.shots.map((p) => basename(p)).join(", ")}${r.screens > r.shots.length ? ` (first ${r.shots.length})` : ""}`);
    // The same finding on many screens is one line, with where it is; loose and tight lines are counted.
    const grouped = new Map();
    const lines = new Map();
    for (const f of r.findings.filter((x) => x.kind === "line")) {
      const where = f.screen === null ? f.scene : `${f.scene} screen ${f.screen}`;
      const k = `${f.title}|${where}`;
      const stretch = Number(/([0-9.]+) of a normal space/.exec(f.detail)?.[1] ?? 0);
      const was = lines.get(k) ?? { title: f.title, where, n: 0, worst: 0 };
      lines.set(k, { ...was, n: was.n + 1, worst: Math.max(was.worst, stretch) });
    }
    for (const l of lines.values()) md.push(`- ${l.title}: ${l.n}${l.worst ? `, the worst at ${l.worst} of a normal space` : ""} (${l.where})`);
    // A strip too narrow for text is both a gap and a decision; the decision says more.
    for (const f of r.findings.filter((x) => x.kind !== "line" && !(x.kind === "gap" && x.detail.includes("<")))) {
      const key = `${f.title}: ${f.detail}`;
      const where = f.screen === null ? f.scene : `${f.scene} screen ${f.screen}`;
      grouped.set(key, [...(grouped.get(key) ?? []), where]);
    }
    for (const [what, where] of grouped) md.push(`- ${what} (${[...new Set(where)].join(", ")})`);
    if (!r.findings.length) md.push("- Nothing notable in the layout's decisions.");
  }
  md.push("");
}
writeFileSync(join(out, "report.md"), md.join("\n"));
console.log(md.join("\n"));
console.log(`\nReport and screenshots: ${out}`);
process.exit(failing ? 1 : 0);
