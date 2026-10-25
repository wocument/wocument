/**
 * What the engine does with every command and attribute: a probe for each.
 *
 *   npx vite-node scripts/capabilities.ts > capabilities.json
 *   npx vite-node scripts/capabilities.ts --md > docs/capabilities.md
 *
 * For every command in the schema, small documents hold it where it may stand
 * (an object both in the text and placed in a scene). For every attribute,
 * every value other than its default is tried (one value per declared type;
 * for an enum, each value), and one value at a breakpoint (`key@phone=`).
 * An attribute that only acts with another (`exit` needs `enter`, `wrap-side`
 * needs `wrap`) is tried with that one set, in the probe and in what it is
 * compared with. Each probe is parsed, resolved and laid out with the
 * fixed-width engine at 1470x956 and 390x844, and compared with the same
 * document without the attribute:
 *
 *   rejected    the parser refuses it (a diagnostic code)
 *   throws      the resolver or layout throws (not built yet, or a bug)
 *   no-effect   resolves and lays out exactly as without it
 *   resolved    changes the Resolved Document, not the layout: read at render time
 *               (the fields that changed are listed, and those the renderer's source names)
 *   layout      changes the layout
 *
 * Warnings that the attribute adds are listed with each result. Of several
 * hosts, the strongest outcome counts (layout > resolved > no-effect > throws > rejected).
 *
 * Limits: the asset host is a stand-in (every file exists; pictures are
 * 1600x1000 and opaque, so `shape=alpha` cannot trace); render-time effects
 * are inferred from the renderer's source, not seen in a browser.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse, type Document } from "@wocument/parser";
import { COMMANDS, type AttrSchema, type CommandSchema } from "@wocument/schema";
import { resolve, type AssetHost } from "@wocument/resolver";
import { layout } from "@wocument/layout";
import { PrepareCache, createFixedEngine } from "@wocument/text-engine";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// ---- documents --------------------------------------------------------------------------

const P = (n: number, tag: string): string =>
  Array.from({ length: n }, (_, i) => `Stone ${tag}${i} endures where nearly everything else decays, and the keepers wrote down what they saw from the wall each evening.`).join(" ");
const TEXT = [P(6, "a"), P(5, "b"), P(7, "c"), P(4, "d"), P(6, "e"), `“Nineteen lights,” he said. ${P(5, "f")}`];
const FRONT = "---\nwocument: 1\ntitle: Probe\n---\n";
/** Names an ident attribute can point at: always defined, harmless when unused. */
const DEFS = [
  `\\grid[name=g2, cols=6, gutter=20px]`,
  `\\palette[name=p2, paper=#202020, ink=#f0f0f0, muted=#a0a0a0, accent=#e05030, rule=#404040]`,
  `\\style[name=probe, size=30px, leading=2bl]`,
  `\\parent[name=pp, height=screen, palette=p2]`,
].join("\n");

/** An implicit-form document with `x` after the second paragraph. */
const implicit = (x: string, head = ""): string => `${FRONT}${DEFS}\n${head}\\headline{A Probe}\n\n${TEXT[0]}\n\n${TEXT[1]}\n\n${x}\n\n${TEXT[2]}\n\n${TEXT[3]}\n\n${TEXT[4]}\n`;
/** An explicit document: one story in one frame of one scene; `x` in the story, `sceneBody` beside the frame. */
const explicit = (o: { story?: string; scene?: string; frame?: string; x?: string; defs?: string; sceneBody?: string } = {}): string =>
  `${FRONT}${DEFS}\n${o.defs ?? ""}\n\\story[name=s${o.story ?? ""}]{\n${TEXT[0]}\n\n${TEXT[1]}\n\n${o.x ?? ""}\n\n${TEXT[2]}\n\n${TEXT[3]}\n\n${TEXT[4]}\n}\n\\scene[name=one${o.scene ?? ""}]{\n\\frame[story=s${o.frame ?? ""}]\n${o.sceneBody ?? ""}}\n`;
const after = (a: string): string => (a ? `, ${a}` : "");

/** Where a command stands. With several, the attribute is tried in each and the strongest outcome counts. */
type Host = { label: string; base?: Record<string, string>; doc: (attrs: string) => string };

/** An object anchored in the text, and placed in a scene (where `cols`, `rows` and `top` apply). */
const object = (name: string, base: Record<string, string>, body = ""): Host[] => [
  { label: "in text", base, doc: (a) => implicit(`\\${name}[${a}]${body}`) },
  { label: "in a scene", base: { ...base, cols: "1-6" }, doc: (a) => explicit({ sceneBody: `\\${name}[${a}]${body}\n`, frame: ", cols=7-12" }) },
  { label: "in a screen scene", base: { ...base, cols: "1-6" }, doc: (a) => explicit({ sceneBody: `\\${name}[${a}]${body}\n`, frame: ", cols=7-12", scene: ", height=screen" }) },
  { label: "in a row group", base, doc: (a) => explicit({ sceneBody: `\\group[layout=row, cols=all]{\\${name}[${a}]${body}\n\\frame{${P(3, "g")}}}\n`, frame: ", cols=1-12" }) },
];
const text = (t: string): Host => ({ label: "in text", doc: (a) => implicit(`\\${t}[${a}]{Some words in a ${t}}`) });

const HOSTS: Record<string, Host[]> = {
  font: [{ label: "", base: { family: `"Probe Face"`, src: "/face.woff2" }, doc: (a) => `${FRONT}\\font[${a}]\n\\style[name=body, family="Probe Face"]\n${TEXT[0]}\n` }],
  token: [{ label: "", base: { name: "t", value: "30px" }, doc: (a) => `${FRONT}\\token[${a}]\n\\style[name=body, size=$t]\n${TEXT[0]}\n\n${TEXT[1]}\n` }],
  palette: [{ label: "", base: { name: "default" }, doc: (a) => `${FRONT}\\palette[${a}]\n${TEXT[0]}\n` }],
  breakpoint: [{ label: "", base: { name: "phone" }, doc: (a) => `${FRONT}\\breakpoint[${a}]\n${TEXT[0]}\n\n${TEXT[1]}\n` }],
  grid: [{ label: "", base: { name: "default" }, doc: (a) => `${FRONT}\\grid[${a}]\n${TEXT.join("\n\n")}\n` }],
  // A style of its own, on the story, so the probe compares with the §07.6 defaults rather than with Vanilla's body.
  style: [{ label: "", base: { name: "own" }, doc: (a) => explicit({ defs: `\\style[${a}]`, story: ", style=own", x: "\\subhead{A subhead in the story}" }) }],
  spot: [
    {
      label: "",
      base: { size: "wide", place: "bottom" },
      doc: (a) => `${FRONT}\\spot[${a}]\n\\story[name=s]{\n${TEXT[0]}\n\n\\figure[src=/w.jpg, alt="w", size=wide]\n\n${TEXT.slice(1).join("\n\n")}\n}\n\\scene[height=page]{\\frame[story=s, columns=3]}\n`,
    },
  ],
  scene: [{ label: "", doc: (a) => `${FRONT}${DEFS}\n\\folio{A Folio}\n\\story[name=s]{\n${TEXT.slice(0, 4).join("\n\n")}\n}\n\\scene[${a || "name=one"}]{\n\\frame[story=s, cols=1-6]\n\\frame[cols=7-12]{${P(2, "x")}}\n}\n\\scene[name=two]{\\frame{${TEXT[4]}}}\n` }],
  parent: [{ label: "", base: { name: "pq" }, doc: (a) => explicit({ defs: `\\parent[${a}]{\\folio{Parent folio}}`, scene: ", parent=pq", frame: ", cols=1-6", sceneBody: `\\frame[cols=7-12]{${P(2, "x")}}\n` }) }],
  story: [{ label: "", doc: (a) => explicit({ story: after(a) }) }],
  frame: [
    { label: "in a flow scene", doc: (a) => explicit({ frame: after(a) }) },
    { label: "in a screen scene", doc: (a) => explicit({ frame: after(a), scene: ", height=screen" }) },
    { label: "in a row group", doc: (a) => explicit({ x: "", frame: "", sceneBody: `\\group[layout=row, cols=all]{\\frame[${a || "name=f2"}]{${P(4, "r")}}\n\\figure[src=/r.jpg, alt="r"]}\n` }) },
  ],
  framebreak: [{ label: "", doc: (a) => explicit({ x: `\\framebreak[${a}]`, frame: ", columns=2" }) }],
  dropcap: [{ label: "", doc: (a) => implicit(`\\dropcap[${a}]\n${TEXT[5]}`) }],
  rule: [
    { label: "in text", doc: (a) => implicit(`\\rule[${a}]`) },
    { label: "in a scene", doc: (a) => explicit({ sceneBody: `\\rule[${a || "cols=1-6"}]\n`, frame: ", cols=7-12" }) },
  ],
  music: [{ label: "", base: { src: "/a.mp3" }, doc: (a) => implicit(`\\music[${a}]`) }],
  br: [{ label: "", doc: () => implicit(`One line\\br the next line.`) }],
  endmark: [{ label: "", doc: (a) => implicit(`The last words.\\endmark[${a}]`) }],
  span: [{ label: "", base: { style: "caption" }, doc: (a) => implicit(`Some \\span[${a}]{words in a span} here.`) }],
  folio: [{ label: "", doc: (a) => `${FRONT}${DEFS}\n\\folio[${a}]{A Folio}\n\\headline{A Probe}\n\n${TEXT.join("\n\n")}\n` }],
  caption: [{ label: "", doc: (a) => implicit(`\\figure[src=/f.jpg, alt="f"]{\\caption[${a}]{A caption.}\\credit{A credit}}`) }],
  credit: [{ label: "", doc: (a) => implicit(`\\figure[src=/f.jpg, alt="f"]{\\caption{A caption.}\\credit[${a}]{A credit}}`) }],
  title: [{ label: "", doc: (a) => implicit(`\\sidebar{\\title[${a}]{A title}\n${P(2, "s")}}`) }],
  cite: [{ label: "", doc: (a) => implicit(`\\pullquote{Quoted words. \\cite[${a}]{A Name}}`) }],
  blockquote: [{ label: "", doc: (a) => implicit(`\\blockquote[${a}]{${P(1, "q")}}`) }],
  figure: object("figure", { src: "/f.jpg", alt: `"f"` }, `{\\caption{A caption.}}`),
  video: object("video", { src: "/v.mp4", poster: "/v.jpg", alt: `"v"` }, `{\\caption{A caption.}}`),
  embed: object("embed", { provider: "youtube", id: "a1B2c3D4e5F", title: `"e"` }, `{\\caption{A caption.}}`),
  lottie: object("lottie", { src: "/a.json", alt: `"l"` }),
  audio: object("audio", { src: "/a.mp3", title: `"a"` }),
  gallery: object("gallery", {}, `{\\figure[src=/g1.jpg, alt="1"]\n\\figure[src=/g2.jpg, alt="2"]\n\\figure[src=/g3.jpg, alt="3"]\n\\caption{A caption.}}`),
  pullquote: object("pullquote", {}, `{Quoted words, long enough to wrap. \\cite{A Name}}`),
  sidebar: object("sidebar", {}, `{\\title{A title}\n${P(2, "s")}}`),
  group: [{ label: "in a scene", base: { cols: "1-6" }, doc: (a) => explicit({ sceneBody: `\\group[${a}]{\\figure[src=/g1.jpg, alt="1"]\n\\figure[src=/g2.jpg, alt="2"]}\n`, frame: ", cols=7-12" }) }],
};
for (const t of ["kicker", "headline", "deck", "byline", "meta", "lede", "bio", "subhead"]) HOSTS[t] = [text(t)];

/** Attributes that only act with another set: tried with it, and compared with a document that has it too. */
const NEEDS: Record<string, Record<string, string>> = {
  ...Object.fromEntries(["exit", "enter-at", "duration", "delay", "ease", "replay", "stagger", "motion"].map((k) => [k, { enter: "fade" }])),
  "wrap-side": { wrap: "rect" },
  "wrap-offset": { wrap: "rect" },
  "alpha-threshold": { shape: "alpha" },
  "fit-max": { fit: "width" },
  "fit-height": { fit: "width" },
  "column-gap": { columns: "2" },
  "column-rule": { columns: "2" },
  url: { provider: "iframe" },
  "per-row": { layout: "grid" },
  "hyphenate-min": { hyphenate: "true" },
};
/** Structural: a definition's own name and breakpoint, which the probes cannot vary on their own. */
const SKIP = new Set(["font.family", "token.name", "palette.name", "breakpoint.name", "grid.name", "grid.at", "style.name", "style.at", "parent.name", "parent.at", "story.name"]);

// ---- values -----------------------------------------------------------------------------

/** Ident values that exist in every probe document. */
const IDENTS: Record<string, string> = { style: "probe", extends: "caption", grid: "g2", palette: "p2", parent: "pp", at: "phone", story: "s", name: "probe-name" };
/** Integers whose valid range is small. */
const INTS: Record<string, string> = { level: "2" };
const PATHS: Record<string, string> = { captions: "/c.vtt", poster: "/p2.jpg", url: "https://example.com/x", transcript: "/t.txt" };

/** One sample per declared type, never the default or the host's own value; every value for an enum. */
function samples(key: string, s: AttrSchema, own?: string): string[] {
  const out: string[] = [];
  const d = s.default;
  const other = (a: string, b: string): string => (d === a || own === a ? b : a);
  for (const t of s.types) {
    if (t === "enum") out.push(...(s.enum ?? []));
    else if (t === "boolean") out.push(d === "true" ? "false" : "true");
    else if (t === "integer") out.push(INTS[key] ?? other("3", "4"));
    else if (t === "number") out.push("1.5");
    else if (t === "length") out.push(d?.endsWith("bl") ? other("2bl", "3bl") : d?.endsWith("%") ? "60%" : d?.endsWith("em") ? "0.1em" : other("40px", "48px"));
    else if (t === "percentage") out.push(other("60%", "70%"));
    else if (t === "time") out.push(other("1200ms", "900ms"));
    else if (t === "range") out.push(other("2-5", "3-6"));
    else if (t === "ratio") out.push(other("1:1", "4:5"));
    else if (t === "color") out.push("#aa3355");
    else if (t === "role") out.push(other("accent", "muted"));
    else if (t === "ident") out.push(IDENTS[key] ?? "probe");
    else if (t === "string") out.push(`"Probe words"`);
    else if (t === "path") out.push(PATHS[key] ?? "/other.jpg");
    else if (t === "pair") out.push(`"30% 70%"`);
    else if (t === "fluid") out.push("fluid(20px, 40px)");
    else if (t === "poly") out.push("poly(0 0, 1 0, 0.5 1)");
    else if (t === "any") out.push("40px");
  }
  return [...new Set(out)].filter((v) => v !== d && v !== own);
}

// ---- running a probe --------------------------------------------------------------------

const fake: AssetHost = {
  image: (path) => ({ url: path, type: "image/jpeg", width: 1600, height: 1000, animated: false }),
  contour: () => null,
  file: (path) => ({ url: path, type: "application/octet-stream" }),
};
const VIEWS = [{ width: 1470, height: 956 }, { width: 390, height: 844 }];

type Run = { parse: string[]; error?: string; warnings: string[]; rd?: string; pd?: string[] };

const runs = new Map<string, Run>();
function run(source: string): Run {
  let r = runs.get(source);
  if (r) return r;
  const parsed = parse(source, { file: "probe.woc" });
  const codes = parsed.diagnostics.map((d) => d.code);
  if (!parsed.ok) r = { parse: codes, warnings: [] };
  else
    try {
      const res = resolve(parsed.ast as Document, { file: "probe.woc", assets: fake });
      const pd = VIEWS.map((v) => JSON.stringify(layout(res.doc, v, new PrepareCache(createFixedEngine()))));
      r = { parse: codes, warnings: res.diagnostics.map((d) => d.code), rd: JSON.stringify(res.doc), pd };
    } catch (e) {
      r = { parse: codes, error: (e instanceof Error ? e.message : String(e)).split("\n")[0], warnings: [] };
    }
  runs.set(source, r);
  return r;
}

/** The leaf paths where two JSON values differ, array indices dropped. */
function changed(a: unknown, b: unknown, path = "", out = new Set<string>()): Set<string> {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = Array.isArray(a) ? path : path ? `${path}.${k}` : k;
      changed((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], p, out);
    }
  } else out.add(path);
  return out;
}

const source = (pkg: string): string => readdirSync(`${ROOT}packages/${pkg}/src`).map((f) => readFileSync(`${ROOT}packages/${pkg}/src/${f}`, "utf8")).join("\n");
const RENDERER = source("renderer");
const LAYOUT = source("layout");

type Outcome = "rejected" | "throws" | "no-effect" | "resolved" | "layout";
const RANK: Outcome[] = ["rejected", "throws", "no-effect", "resolved", "layout"];
type Result = { value: string; at?: "phone"; outcome: Outcome; elsewhere?: string[]; host?: string; with?: string; detail?: string; fields?: string[]; renderer?: string[]; layout?: string[]; warnings?: string[] };

const list = (o: Record<string, string>): string => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(", ");

function tryIn(host: Host, key: string, value: string, at: "phone" | undefined, needs: Record<string, string>): Result {
  const base = { ...(host.base ?? {}), ...needs };
  const before = run(host.doc(list(base)));
  const k = at ? `${key}@${at}` : key;
  const after = run(host.doc(list(at ? { ...base, [k]: value } : { ...base, [key]: value })));
  const res: Result = { value, ...(at ? { at } : {}), outcome: "no-effect", ...(host.label ? { host: host.label } : {}), ...(Object.keys(needs).length ? { with: list(needs) } : {}) };
  const warnings = after.warnings.filter((w) => !before.warnings.includes(w));
  if (warnings.length) res.warnings = warnings;
  if (!after.rd && !after.error) return { ...res, outcome: "rejected", detail: after.parse.join(" ") };
  if (after.error) return { ...res, outcome: "throws", detail: after.error };
  if (!before.rd) return { ...res, outcome: "throws", detail: `the document without it fails: ${before.error ?? before.parse.join(" ")}` };
  if (after.pd!.some((p, i) => p !== before.pd![i])) return { ...res, outcome: "layout" };
  if (after.rd !== before.rd) {
    const fields = [...changed(JSON.parse(before.rd), JSON.parse(after.rd!))].map((p) => p.split(".").slice(-2).join("."));
    const names = [...new Set(fields.map((f) => f.split(".").pop()!))];
    const named = (src: string): string[] => names.filter((n) => new RegExp(`\\b${n}\\b`).test(src));
    return { ...res, outcome: "resolved", fields: [...new Set(fields)].slice(0, 6), renderer: named(RENDERER), layout: named(LAYOUT) };
  }
  return res;
}

function probe(c: CommandSchema): { command: string; base: string; attrs: Record<string, Result[]> } {
  const hosts = HOSTS[c.name];
  if (!hosts) throw new Error(`no host for \\${c.name}`);
  const first = run(hosts[0]!.doc(list(hosts[0]!.base ?? {})));
  const base = first.error ? `throws: ${first.error}` : first.rd ? "ok" : `rejected: ${first.parse.join(" ")}`;
  const out: Record<string, Result[]> = {};
  for (const [key, s] of Object.entries(c.attrs)) {
    if (SKIP.has(`${c.name}.${key}`)) continue;
    const needs = Object.fromEntries(Object.entries(NEEDS[key] ?? {}).filter(([k]) => k in c.attrs && k !== key));
    const values = samples(key, s, hosts[0]!.base?.[key]);
    const strongest = (value: string, at?: "phone"): Result => {
      const all = hosts.map((h) => tryIn(h, key, value, at, needs));
      const best = all.reduce((b, r) => (RANK.indexOf(r.outcome) > RANK.indexOf(b.outcome) ? r : b));
      // Where it fails in another place, say so: the strongest outcome alone would hide it.
      const fails = all.filter((r) => r !== best && r.outcome === "throws").map((r) => `${r.host}: fails (${r.detail!.replace(/^the document without it fails: /, "").replace(/ \(line \d+\)/, "")})`);
      return fails.length && best.outcome !== "throws" ? { ...best, elsewhere: fails } : best;
    };
    const plain = values.map((v) => strongest(v));
    // At a breakpoint: with the value that did most without one.
    const pick = plain.reduce<Result | undefined>((b, r) => (!b || RANK.indexOf(r.outcome) > RANK.indexOf(b.outcome) ? r : b), undefined);
    out[key] = s.responsive !== false && pick ? [...plain, strongest(pick.value, "phone")] : plain;
  }
  return { command: c.name, base, attrs: out };
}


// ---- the reference page -----------------------------------------------------------------

/** What the probes cannot show, written by hand. */
const NOTES: Record<string, string> = Object.fromEntries([
  ...["figure", "video", "lottie"].map((o) => [`${o}.alpha-threshold`, "acts on a picture with transparency; the probe's pictures are opaque"]),
  ["style.hyphenate-min", "used when the resolver hyphenates long words; the probe's words are short"],
  ["style.hyphenate-caps", "used when the resolver hyphenates long words; the probe's words are short"],
  ["embed.url", "with provider=iframe, which also needs a url, so the probe cannot try one without the other"],
  ["frame.story", "the probe's frame already names its story"],
  ...["side", "width"].map((k) => [`group.${k}`, "for an anchored object; a group is not anchored in this version (§11.11)"]),
  ["group.min-width", "for a group inside a row group (§11.11)"],
]);

const EFFECT: Record<Outcome, string> = { layout: "changes the layout", resolved: "read when the page renders", "no-effect": "no effect seen", throws: "fails", rejected: "refused by the parser" };

function markdown(results: ReturnType<typeof probe>[]): string {
  const out = [
    "# What the engine does with each command and attribute",
    "",
    "Generated by `scripts/capabilities.ts`: do not edit by hand. Run `npx vite-node scripts/capabilities.ts --md > docs/capabilities.md` after a change to the schema, the resolver or the layout.",
    "",
    "Every attribute was tried with each value other than its default, in a small document, and at one breakpoint (`@phone`). The result is compared with the same document without the attribute, parsed, resolved and laid out at 1470x956 and 390x844:",
    "",
    "- **changes the layout**: the positions of text or objects change.",
    "- **read when the page renders**: the Resolved Document changes, the layout does not. The renderer reads it (colour, motion, playback). The field names are listed; a field the renderer's source does not name is marked *(not read?)*.",
    "- **no effect seen**: nothing changed in these documents. Some attributes only act in a situation the probe does not build (named in the notes); the rest are ignored.",
    "- **fails**: the resolver or the layout throws. Usually a feature that is not built yet.",
    "- **refused by the parser**: a diagnostic code; usually a rule the attribute breaks without another one.",
    "- **At a breakpoint**: the same value as `key@phone=` (phone, 390px wide). *ignored* means the phone layout did not change. An object or group placed with columns that do not fit the phone's grid falls back into the text there (W031), so its placement attributes (`cols`, `rows`, `top`, `height`, `wrap-side`) read *ignored* at phone.",
    "",
    "Limits: pictures are stand-ins (1600x1000, opaque), so `shape=alpha` cannot trace and `alpha-threshold` shows nothing; render-time effects are read from the renderer's source, not seen in a browser.",
    "",
  ];
  const fails = results.filter((c) => c.base !== "ok");
  if (fails.length) out.push("## Not built", "", ...fails.map((c) => `- \`\\${c.command}\`: ${c.base.replace(/ \(line \d+\)/, "")}`), "");
  for (const c of results) {
    if (c.base !== "ok" || !Object.keys(c.attrs).length) continue;
    out.push(`## \\${c.command}`, "", "| Attribute | Values tried | Effect | At a breakpoint | Notes |", "| :-- | :-- | :-- | :-- | :-- |");
    for (const [key, rows] of Object.entries(c.attrs)) {
      const plain = rows.filter((r) => !r.at);
      const at = rows.find((r) => r.at);
      const best = plain.reduce<Result | undefined>((b, r) => (!b || RANK.indexOf(r.outcome) > RANK.indexOf(b.outcome) ? r : b), undefined);
      const odd = plain.filter((r) => best && r.outcome !== best.outcome).map((r) => `\`${r.value}\`: ${EFFECT[r.outcome]}${r.detail ? ` (${r.detail.replace(/ \(line \d+\)/, "")})` : ""}`);
      const notes = [
        ...(best?.with ? [`with \`${best.with}\``] : []),
        ...(best?.host ? [best.host] : []),
        ...odd,
        ...(best?.outcome === "resolved"
          ? [`fields: ${best.fields!.map((f) => `\`${f}\``).join(", ")}${best.renderer!.length ? "" : best.layout!.length ? " (a layout input: no change in these documents)" : " *(not read?)*"}`]
          : []),
        ...[...new Set(plain.flatMap((r) => r.elsewhere ?? []))],
        ...(NOTES[`${c.command}.${key}`] ? [NOTES[`${c.command}.${key}`]!] : []),
        ...(best?.outcome === "throws" || best?.outcome === "rejected" ? [best.detail!.replace(/ \(line \d+\)/, "")] : []),
        ...[...new Set(plain.flatMap((r) => r.warnings ?? []))].map((w) => `warns ${w}`),
      ];
      const atText = !at ? "not allowed" : at.outcome === "throws" ? `fails: ${at.detail!.replace(/ \(line \d+\)/, "")}` : at.outcome === "no-effect" ? "**ignored**" : "yes";
      out.push(`| \`${key}\` | ${plain.map((r) => `\`${r.value}\``).join(" ")} | ${best ? EFFECT[best.outcome] : "–"} | ${atText} | ${notes.join("; ").replace(/\|/g, "\\|")} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

const results = [...COMMANDS.values()].map(probe);
console.log(process.argv.includes("--md") ? markdown(results) : JSON.stringify(results, null, 1));
