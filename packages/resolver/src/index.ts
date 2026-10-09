/**
 * @wmxdsl/resolver -- AST to Resolved Document (spec §15.1 stage 3).
 *
 * Pure: no DOM, no file system, no network, no clocks. The caller parses the
 * theme file, if any, and passes its AST.
 *
 * Covered: both document forms, stories, scenes (explicit and shorthand),
 * parents, frames (inline and threaded), tokens, the design-head cascade,
 * text elements, drop caps, frame breaks, rules, linearize, reveals with
 * stagger, threads and folios. Objects and inline formatting come next and
 * throw "not resolved yet" rather than resolving to something half-right.
 */

import { parse, type Command, type Document, type Node, type Theme } from "@wmxdsl/parser";
import type {
  AnchorHorizontal,
  Asset,
  Caption,
  MusicCue,
  MediaFit,
  ObjectCommon,
  Diagnostic,
  ObjectElement,
  Placement,
  Wrap,
  Folio,
  Frame,
  GroupObject,
  Meta,
  Reveal,
  ResolvedDocument,
  ResolvedStyle,
  Scene,
  SceneTurn,
  Story,
  Variant,
  Variants,
  Vertical,
} from "@wmxdsl/resolved-document";
import type { Value } from "@wmxdsl/schema";
import { DEFAULT_THEME_SOURCE } from "./default-theme.js";
import { readability } from "./readability.js";
export { contrast } from "./readability.js";
import { type Attrs, Definitions, schemaDefaults } from "./definitions.js";
import { BASE, Design } from "./design.js";
import { Ids } from "./ids.js";
import { OBJECTS, type StoryContext, notYet, storyBlocks, withIndents } from "./story.js";
import { toLen } from "./units.js";

/** What the asset host knows about an image file. */
export type ImageInfo = { url: string; type: string; width: number; height: number; animated: boolean };

/** How a contour is traced: the alpha threshold and the box the image is fitted into (spec §12.2). */
export type ContourRequest = { threshold: number; ratio: number; fit: string; focus: { x: number; y: number } };

/**
 * The build-time side of media (spec §11.4-§11.9, §12.2): reading files,
 * dimensions and alpha channels. The resolver stays pure and asks this
 * interface; `@wmxdsl/assets` implements it for Node.
 */
export type AssetHost = {
  /** null when the file does not exist: an asset warning, not an error (spec §15.6). */
  image(path: string): ImageInfo | null;
  /** The silhouette in box coordinates, or null when the image has no transparency there (or is missing). */
  contour(path: string, req: ContourRequest): [number, number][] | null;
  /** null when the file does not exist. */
  file(path: string): { url: string; type: string } | null;
};

export type ResolveOptions = {
  /** Used in diagnostics. */
  file?: string;
  /** Reads media for `\figure`, `\video` and friends. Without one, media is an error. */
  assets?: AssetHost;
  /** The parsed theme file named in frontmatter `theme:`, if any (spec §07.8). */
  theme?: Theme | null;
};

export type ResolveResult = {
  doc: ResolvedDocument;
  /** Resolve warnings (spec §15.6), also in `doc.diagnostics`. Errors throw. */
  diagnostics: Diagnostic[];
};

let builtin: Theme | null = null;
function builtinTheme(): Theme {
  if (builtin) return builtin;
  const r = parse(DEFAULT_THEME_SOURCE, { kind: "theme", file: "default.wmxt" });
  if (!r.ok) throw new Error(`built-in theme does not parse: ${JSON.stringify(r.diagnostics)}`);
  builtin = r.ast as Theme;
  return builtin;
}

/** One scene's source: an explicit `\scene`, or the implicit form's single scene (spec §02.2). */
type SceneSource = { id: string; cmd: Command | null; content: Node[] };

/** Where an object sits: in a scene on its grid, or at a block of a story. */
type ObjectWhere =
  | { mode: "grid"; scene: string; grid: Scene["grid"]; height: Scene["height"] }
  | { mode: "anchored"; story: string; block: number; lastCol: number }
  | { mode: "contained"; container: string; index: number };

/** The heading elements a bare document's heading frame takes, as long as they lead the content. */
// 2026-10-07: the intro opens the story, so it is not a heading element.
const HEADING = new Set(["kicker", "headline", "deck", "byline", "meta"]);
/** Ids for nodes this file makes, clear of any one parse's own (they are numbered from 0). */
const SYNTHETIC = 1_000_000_000;

/**
 * Spec §02.2 (2026-10-07): the implicit form is a magazine page. Its leading heading
 * elements go in a heading frame over 8 columns, the rest in a story frame whose columns follow the
 * width: as few as keep each within 600px (2 below about 1300px, 3 above, 2 on a
 * tablet, 1 on a phone), and 4 on wide screens; a document with no heading elements gets the story
 * frame alone. Built
 * as the explicit form it stands for, from a parsed template whose node ids are moved clear of the
 * document's.
 */
function magazineForm(ast: Document): Document {
  if (ast.form !== "implicit") return ast;
  const content = ast.implicitContent;
  let k = 0;
  while (k < content.length && content[k]!.kind === "command" && HEADING.has((content[k] as Command).name)) k++;
  const heading = content.slice(0, k);
  const rest = content.slice(k);
  const frames = [
    ...(heading.length ? ["\\frame[cols=1-8, cols@tablet=all, cols@phone=all]{x}"] : []),
    ...(rest.length || !heading.length ? ["\\frame[cols=all, columns=auto, columns@wide=4, columns@tablet=1, measure=600px]{x}"] : []),
  ];
  const r = parse(`---\nwmxdsl: 1\ntitle: T\n---\n\\scene[height=page]{\n${frames.join("\n")}\n}\n`, { file: "implicit-form.wmx" });
  if (!r.ok) throw new Error(`implicit form template does not parse: ${JSON.stringify(r.diagnostics)}`);
  const scene = (r.ast as Document).scenes[0]!;
  const renumber = (n: Node): void => {
    n.id += SYNTHETIC;
    if (n.kind === "command" && Array.isArray(n.body)) for (const c of n.body as Node[]) if (c.kind === "command" || c.kind === "paragraph") renumber(c);
  };
  renumber(scene);
  const bodies = [...(heading.length ? [heading] : []), ...(rest.length || !heading.length ? [rest] : [])];
  (scene.body as Command[]).forEach((f, i) => (f.body = bodies[i]!));
  return { ...ast, form: "explicit", scenes: [scene], implicitContent: [] };
}

export function resolve(source: Document, options: ResolveOptions = {}): ResolveResult {
  const ast = magazineForm(source);
  const file = options.file ?? "document.wmx";
  const defs = new Definitions([builtinTheme().definitions, options.theme?.definitions ?? [], ast.definitions]);
  const design = new Design(defs);
  const variants = design.variants();
  const lang = ast.frontmatter.lang ?? "en";
  const ids = new Ids([...ast.definitions, ...(ast.folio ? [ast.folio] : []), ...ast.stories, ...ast.scenes], ast.implicitContent);
  const diagnostics: Diagnostic[] = [];
  /** `at` is null for the implicit form's synthesized scene and frame, which have no source of their own. */
  const warn = (
    code: string,
    message: string,
    at: Command | null,
    variant: string | null,
    fix: string | null,
    category: Diagnostic["category"] = "resolve-warning",
  ): void => {
    const pos = at?.source ?? { line: 1, column: 1 };
    diagnostics.push({ code, category, message, file, line: pos.line, column: pos.column, fix, variant });
  };

  // ---- text ---------------------------------------------------------------
  const strings: string[] = [];
  const index = new Map<string, number>();
  const intern = (s: string): number => {
    let i = index.get(s);
    if (i === undefined) {
      i = strings.push(s) - 1;
      index.set(s, i);
    }
    return i;
  };
  const deref = (command: string, key: string, v: Value): Value => defs.deref(command, key, v);
  /** Media files and traced polygons, shared by every variant. */
  const assets: Record<string, Asset> = {};

  /** §10.6 soundtrack cues, in document order. */
  const music: MusicCue[] = [];
  const cue = (c: Command, at: MusicCue["at"]): void => {
    const a: Attrs = new Map([...schemaDefaults("music"), ...elementAttrs(c, BASE, "music", deref)]);
    const src = a.get("src")!;
    let audio: string | null = null;
    if (src.t === "path") {
      if (!options.assets) throw new Error(`\\music needs an asset host (ResolveOptions.assets) to read ${src.s}`);
      const f = options.assets.file(src.s);
      if (!f) warn("W050", `Missing file ${src.s}`, c, null, "Check the music path, or add the file.", "asset-warning");
      audio = `audio:${src.s}`;
      assets[audio] ??= { kind: "audio", sources: [{ type: f?.type ?? "audio/mpeg", url: f?.url ?? src.s }] };
    }
    const pct = (k: string) => (a.get(k) as { n: number }).n / 100;
    music.push({ at, audio, fadeMs: (a.get("fade") as { ms: number }).ms, volume: pct("volume"), loop: bool(a.get("loop")), enterAt: pct("enter-at") });
  };

  /** Anchored objects, registered while stories are built. */
  const anchored: { cmd: Command; story: string; block: number }[] = [];
  const storyCtx = (proseStyle: string, storyId: string): StoryContext => ({
    object: (c, block) => {
      anchored.push({ cmd: c, story: storyId, block });
      return ids.of(c);
    },
    music: (c, block) => cue(c, { story: storyId, block }),
    lang,
    strings,
    intern,
    deref,
    proseStyle,
    hyphenates: (style) => {
      const s = variants.map((bp) => design.styleKey(style, bp)).find((x) => x.hyphenate);
      return s ? { min: s.hyphenateMin, caps: s.hyphenateCaps } : null;
    },
    binds: (style) => variants.some((bp) => design.styleKey(style, bp).bindShort),
    inlineAttr: (c, key) => {
      const v = c.attrs.find((a) => a.key === key && a.at === null)?.value;
      const d = v ? defs.deref(c.name, key, v) : undefined;
      return d?.t === "ident" ? d.id : d?.t === "string" ? d.s : null;
    },
  });

  /** Stories are built once, in first-use order, so the string table is deterministic. */
  const stories = new Map<string, Story>();
  const story = (id: string, origin: Story["origin"], owner: string | null, content: Node[], cmd: Command | null, prose = "body"): Story => {
    const hit = stories.get(id);
    if (hit) return hit;
    const a = cmd ? elementAttrs(cmd, BASE, "story", deref) : new Map<string, Value>();
    const s: Story = {
      id,
      origin,
      owner,
      overset: (enumId(a.get("overset")) || "grow") as Story["overset"],
      blocks: storyBlocks(content, storyCtx(ident(a.get("style")) || prose, id)),
    };
    stories.set(id, s);
    return s;
  };
  for (const s of ast.stories) story(ident(s.attrs.find((a) => a.key === "name")?.value), "named", null, s.body as Node[], s);

  // ---- scenes -------------------------------------------------------------
  const sources: SceneSource[] =
    ast.form === "implicit"
      ? [{ id: "scene-1", cmd: null, content: ast.implicitContent }]
      : ast.scenes.map((c) => ({ id: ids.of(c), cmd: c, content: c.body as Node[] }));
  // §10.6: a \music written straight in an explicit scene cues at the scene's top; in a shorthand
  // scene it is story content, cued by its story.
  for (const s of sources)
    if (s.content.some((n) => n.kind === "command" && (n.name === "frame" || n.name === "group")))
      for (const n of s.content) if (n.kind === "command" && n.name === "music") cue(n, { scene: s.id });

  const variant = (bp: string): Variant => {
    const frames: Record<string, Frame> = {};
    const objects: Record<string, ObjectElement> = {};
    const range = (v: Value | undefined, max: number, fallback: { from: number; to: number }) =>
      v?.t === "range" ? { from: v.from, to: v.to === "end" ? max : v.to } : fallback;

    /**
     * `\figure` and `\video` (spec §11.4, §11.5): the media asset, the box's
     * ratio (`auto` is the media's own), fit, focus, shape and clip. `shape=alpha`
     * traces the image's alpha channel with the fit/focus crop applied first
     * (§12.2); an opaque image falls back to `rect` with a warning.
     */
    const hostOf = (cmd: Command, id: string): AssetHost => {
      if (!options.assets) throw new Error(`\\${cmd.name} "${id}" needs an asset host (ResolveOptions.assets) to read its files`);
      return options.assets;
    };
    const strOf = (oa: Attrs, k: string): string | null => {
      const v = oa.get(k);
      return v?.t === "path" || v?.t === "string" ? v.s : null;
    };
    /** A missing file is an asset warning (§15.6); the page still builds and the box keeps its ratio or 3:2. */
    const missing = (cmd: Command, path: string): void => {
      if (bp === BASE) warn("W050", `Missing file ${path}`, cmd, null, "Check the path, or add the file.", "asset-warning");
    };
    const imageAsset = (cmd: Command, oa: Attrs, path: string): { asset: string; info: ImageInfo } => {
      const found = hostOf(cmd, path).image(path);
      if (!found) missing(cmd, path);
      const r0 = oa.get("ratio");
      const info = found ?? {
        url: path,
        type: "application/octet-stream",
        width: r0?.t === "ratio" && !r0.auto ? r0.w * 100 : 1500,
        height: r0?.t === "ratio" && !r0.auto ? r0.h * 100 : 1000,
        animated: false,
      };
      const asset = `image:${path}`;
      assets[asset] ??= { kind: "image", width: info.width, height: info.height, animated: info.animated, sources: [], fallback: info.url };
      return { asset, info };
    };
    /** A file served as-is; `null` for an absent attribute. */
    const fileOf = (cmd: Command, path: string, fallbackType: string): { url: string; type: string } => {
      const found = hostOf(cmd, path).file(path);
      if (!found) missing(cmd, path);
      return found ?? { url: path, type: fallbackType };
    };
    const fileAsset = (cmd: Command, path: string | null): string | null => {
      if (!path) return null;
      const f = fileOf(cmd, path, "application/octet-stream");
      const asset = `file:${path}`;
      assets[asset] ??= { kind: "file", url: f.url, type: f.type };
      return asset;
    };
    const captionOf = (cmd: Command, id: string, side: Caption["side"]): Caption | null => {
      const body = (cmd.body as Node[] | null) ?? [];
      const nodes = body.filter((n) => n.kind === "command" && (n.name === "caption" || n.name === "credit"));
      return nodes.length ? { story: story(`${id}#caption`, "caption", id, nodes, null, "caption").id, side } : null;
    };
    /** §15.6: a missing `alt` or `title` is a resolve warning; `""` is decorative and silent. */
    const needs = (cmd: Command, id: string, oa: Attrs, key: "alt" | "title"): void => {
      if (bp === BASE && !oa.has(key)) warn("W033", `\\${cmd.name} "${id}" has no ${key}.`, cmd, null, `Add ${key}="..." (${key}="" if decorative).`);
    };

    const media = (cmd: Command, id: string, oa: Attrs, common: ObjectCommon): ObjectElement => {
      const str = (k: string) => strOf(oa, k);
      const src = str("src")!;
      const poster = cmd.name === "video" ? str("poster") : null;
      const picture = cmd.name === "figure" ? imageAsset(cmd, oa, src) : poster ? imageAsset(cmd, oa, poster) : null;
      // `ratio=auto` is the media's own; a video without a poster has no size we can read, so 16:9.
      const r = oa.get("ratio");
      const raw = r?.t === "ratio" && !r.auto ? { w: r.w, h: r.h } : picture ? { w: picture.info.width, h: picture.info.height } : { w: 16, h: 9 };
      // An intrinsic ratio reads better reduced: 1600x1000 is 8:5.
      const g = gcd(raw.w, raw.h);
      const ratio = { w: raw.w / g, h: raw.h / g };
      const fit = enumId(oa.get("fit")) as MediaFit["fit"];
      const f = oa.get("focus");
      const focus = f?.t === "pair" ? { x: pct01(f.a), y: pct01(f.b) } : { x: 0.5, y: 0.5 };
      const s = oa.get("shape");
      let shape: MediaFit["shape"] = { kind: "rect" };
      if (s?.t === "poly") {
        const asset = `polygon:${id}`;
        assets[asset] = { kind: "polygon", points: s.points.map(([x, y]) => [x, y] as [number, number]) };
        shape = { kind: "polygon", polygon: asset, source: "poly" };
      } else if (s?.t === "enum" && (s.id === "circle" || s.id === "ellipse")) shape = { kind: s.id };
      else if (s?.t === "enum" && s.id === "alpha") {
        const threshold = pct01(oa.get("alpha-threshold")) || 0.5;
        const traced = picture ? hostOf(cmd, id).contour(cmd.name === "figure" ? src : poster!, { threshold, ratio: ratio.w / ratio.h, fit, focus }) : null;
        if (traced) {
          const asset = `polygon:${cmd.name === "figure" ? src : poster}@${(ratio.w / ratio.h).toFixed(4)},${fit},${focus.x},${focus.y},${threshold}`;
          assets[asset] = { kind: "polygon", points: traced };
          shape = { kind: "polygon", polygon: asset, source: "alpha" };
        } else if (bp === BASE) {
          // This warning has no code in the spec yet.
          warn("W032", `shape=alpha on "${id}", but the image has no transparency; using rect.`, cmd, null, "Use a PNG with an alpha channel, or shape=rect.");
        }
      }
      const mediaFit: MediaFit = { ratio, fit, focus, shape, clip: bool(oa.get("clip")) };
      const alt = oa.has("alt") ? (str("alt") ?? "") : null;
      if (common.placement.mode !== "background") needs(cmd, id, oa, "alt");
      const caption = captionOf(cmd, id, (enumId(oa.get("caption-side")) || "below") as Caption["side"]);
      if (cmd.name === "figure") {
        return { ...common, kind: "figure", image: picture!.asset, motionVideo: null, alt, media: mediaFit, loading: enumId(oa.get("loading")) as "lazy", caption };
      }
      const video = fileOf(cmd, src, "video/mp4");
      const asset = `video:${src}`;
      assets[asset] ??= {
        kind: "video",
        // Limit: video dimensions need a container parser; the poster's, else the box ratio at 1000px.
        width: picture?.info.width ?? Math.round((1000 * ratio.w) / ratio.h),
        height: picture?.info.height ?? 1000,
        sources: [{ type: video.type, url: video.url }],
      };
      const background = common.layer === "background";
      return {
        ...common,
        kind: "video",
        video: asset,
        poster: picture?.asset ?? null,
        alt,
        captions: fileAsset(cmd, str("captions")),
        play: enumId(oa.get("play")) as "manual",
        loop: bool(oa.get("loop")),
        muted: bool(oa.get("muted")),
        // §11.5: controls default to false on the background layer.
        controls: cmd.attrs.some((a) => a.key === "controls") ? bool(oa.get("controls")) : !background,
        media: mediaFit,
        caption,
      };
    };

    /** An object at `bp` (spec §11). `where` is its scene (grid-placed) or its anchor (anchored). */
    const objectOf = (cmd: Command, id: string, where: ObjectWhere, reveal: Reveal, z: number): ObjectElement => {
      const oa: Attrs = new Map([...schemaDefaults(cmd.name), ...elementAttrs(cmd, bp, cmd.name, deref)]);
      const layer = enumId(oa.get("layer")) as ObjectElement["layer"];
      let placement: Placement;
      if (where.mode === "contained") placement = where;
      else if (where.mode === "anchored") {
        const side = enumId(oa.get("side"));
        const horizontal: AnchorHorizontal = oa.has("cols")
          ? { mode: "cols", cols: range(oa.get("cols"), where.lastCol, { from: 1, to: 1 }) }
          : side === "left" || side === "right" || side === "center"
            ? // Limit: §11.3 states no default width for a side object; §11.10's "typical" 50%.
              { mode: "side", side, width: oa.has("width") ? len(oa.get("width")!) : { u: "pct", n: 50 } }
            : { mode: "full" };
        placement = { mode: "anchored", story: where.story, block: where.block, horizontal, height: lenOrAuto(oa.get("height")) };
      } else if (layer === "background") placement = { mode: "background", scene: where.scene };
      else
        placement = {
          mode: "grid",
          scene: where.scene,
          cols: range(oa.get("cols"), where.grid.cols, where.grid.body),
          vertical:
            where.height === "screen"
              ? { mode: "rows", rows: range(oa.get("rows"), where.grid.rows, { from: 1, to: where.grid.rows }) }
              : { mode: "flow", top: lenOrAuto(oa.get("top")), height: lenOrAuto(oa.get("height")) },
        };
      // §12.1: the default wrap depends on how the object is placed; only the content layer wraps.
      const h = placement.mode === "anchored" ? placement.horizontal.mode : null;
      const explicit = cmd.attrs.some((x) => x.key === "wrap");
      const mode = explicit ? enumId(oa.get("wrap")) : h === "side" || h === "cols" ? "rect" : h === "full" ? "jump" : "none";
      const offset = len(oa.get("wrap-offset")!);
      const wrap: Wrap =
        layer !== "content" || mode === "none" || where.mode === "contained"
          ? { mode: "none" }
          : mode === "jump"
            ? { mode: "jump", offset }
            : {
                mode: mode as "rect" | "contour",
                // side=center (2026-10-09): text on both sides unless the author picks one.
                side: (placement.mode === "anchored" && placement.horizontal.mode === "side" && placement.horizontal.side === "center" && !cmd.attrs.some((x) => x.key === "wrap-side")
                  ? "both"
                  : enumId(oa.get("wrap-side"))) as "largest",
                offset,
              };
      const common = {
        id,
        placement,
        layer,
        z: oa.has("z") ? num(oa.get("z")) : z,
        // §11.9, §11.11: a contained child ignores its own placement attributes.
        bleed: where.mode === "contained" ? "none" : (enumId(oa.get("bleed")) as ObjectElement["bleed"]),
        // §11.9, §11.11: a contained child takes its width from its container.
        maxWidth: where.mode === "contained" || !oa.has("max-width") ? null : len(oa.get("max-width")!),
        offsetX: where.mode === "contained" ? ({ u: "px", n: 0 } as const) : len(oa.get("offset-x")!),
        offsetY: where.mode === "contained" ? ({ u: "px", n: 0 } as const) : len(oa.get("offset-y")!),
        wrap,
        reveal,
        hidden: bool(oa.get("hide")),
      };
      const body = (cmd.body as Node[] | null) ?? [];
      const prose = ident(oa.get("style"));
      if (cmd.name === "pullquote") {
        return { ...common, kind: "pullquote", story: story(`${id}#text`, "pullquote", id, body, null, prose || "pullquote").id };
      }
      if (cmd.name === "sidebar") {
        return {
          ...common,
          kind: "sidebar",
          story: story(`${id}#text`, "sidebar", id, body, null, prose || "sidebar").id,
          bg: colorOf(oa.get("bg")),
          inset: len(oa.get("inset")!),
          border: enumId(oa.get("border")) as "none",
          portrait: bool(oa.get("portrait")),
        };
      }
      if (cmd.name === "figure" || cmd.name === "video") return media(cmd, id, oa, common);
      const str = (k: string) => strOf(oa, k);
      if (cmd.name === "audio") {
        needs(cmd, id, oa, "title");
        const src = str("src")!;
        const f = fileOf(cmd, src, "audio/mpeg");
        const asset = `audio:${src}`;
        assets[asset] ??= { kind: "audio", sources: [{ type: f.type, url: f.url }] };
        return {
          ...common,
          kind: "audio",
          audio: asset,
          title: str("title"),
          captions: fileAsset(cmd, str("captions")),
          transcript: fileAsset(cmd, str("transcript")),
          caption: captionOf(cmd, id, "below"),
        };
      }
      if (cmd.name === "embed") {
        needs(cmd, id, oa, "title");
        const provider = enumId(oa.get("provider")) as "youtube" | "vimeo" | "iframe";
        const source = provider === "iframe" ? { provider, url: str("url") ?? "" } : { provider, id: str("id") ?? "" };
        const r = oa.get("ratio");
        const poster = str("poster");
        return {
          ...common,
          kind: "embed",
          source,
          title: str("title"),
          ratio: r?.t === "ratio" && !r.auto ? { w: r.w, h: r.h } : { w: 16, h: 9 },
          // §11.6 "provider thumbnail": YouTube's is a fixed URL; Vimeo and iframes have none without a network call.
          poster: poster
            ? { asset: imageAsset(cmd, oa, poster).asset }
            : source.provider === "youtube"
              ? { url: `https://i.ytimg.com/vi/${source.id}/hqdefault.jpg` }
              : null,
          facade: bool(oa.get("facade")),
          caption: captionOf(cmd, id, (enumId(oa.get("caption-side")) || "below") as Caption["side"]),
        };
      }
      if (cmd.name === "gallery") {
        const r = oa.get("ratio");
        const ratio = r?.t === "ratio" && !r.auto ? { w: r.w, h: r.h } : null;
        const kids = body.filter((n): n is Command => n.kind === "command" && (n.name === "figure" || n.name === "video"));
        const items = kids.map((c, index) => {
          const cid = ids.of(c);
          const child = objectOf(c, cid, { mode: "contained", container: id, index }, revealOf(new Map(), 0), index);
          // §11.9: the gallery's ratio is forced on every child.
          if (ratio && "media" in child) child.media = { ...child.media, ratio };
          objects[cid] = child;
          return cid;
        });
        return {
          ...common,
          kind: "gallery",
          layout: enumId(oa.get("layout")) as "grid" | "strip",
          perRow: num(oa.get("per-row")),
          // Limit: an anchored gallery takes the default grid's gutter; the scene's needs the anchor's scene here.
          gap: oa.has("gap") ? len(oa.get("gap")!) : (where.mode === "grid" ? where.grid : design.grid("default", bp)).gutter,
          ratio,
          items,
          caption: captionOf(cmd, id, (enumId(oa.get("caption-side")) || "below") as Caption["side"]),
        };
      }
      if (cmd.name === "group") {
        // Children are filled in by the scene, which knows the grid their frames need (groupChildren).
        return {
          ...common,
          kind: "group",
          layout: enumId(oa.get("layout")) as GroupObject["layout"],
          gap: len(oa.get("gap")!),
          valign: enumId(oa.get("valign")) as GroupObject["valign"],
          children: [],
        };
      }
      return notYet(cmd, `\\${cmd.name}`);
    };

    const scenes: Scene[] = sources.map((src) => {
      const parentName = src.cmd ? ident(elementAttrs(src.cmd, bp, "scene", deref).get("parent")) || null : null;
      if (parentName && !defs.has("parent", parentName)) throw new Error(`unknown parent ${parentName} (line ${src.cmd!.source.line})`);
      const a: Attrs = new Map([
        ...schemaDefaults("scene"),
        ...(parentName ? defs.attrs("parent", parentName, bp) : []),
        ...(src.cmd ? elementAttrs(src.cmd, bp, "scene", deref) : []),
      ]);
      const grid = design.grid(ident(a.get("grid")), bp);
      const height = enumId(a.get("height")) as Scene["height"];
      // 2026-10-09: page scenes no longer snap by default (until then soft); smooth scrolling
      // and a smooth page step on the space bar replace it. An author's own `snap` still applies.
      let snap = enumId(a.get("snap")) as Scene["snap"];
      if (snap === "hard" && height === "flow") {
        snap = "soft";
        if (bp === BASE) warn("W030", `snap=hard on flow scene "${src.id}" becomes soft`, src.cmd, null, "Use height=screen, or snap=soft.");
      }
      const effect = enumId(a.get("turn")) as "none" | SceneTurn["effect"];
      const turn: SceneTurn | null =
        effect === "none" ? null : { effect, durationMs: (a.get("duration") as { ms: number }).ms, ease: enumId(a.get("ease")) as SceneTurn["ease"] };

      // Children: the parent's beneath the scene's own (§08.4). Parent frames only when the scene declares none.
      const shorthand = src.cmd === null || src.cmd.sceneForm === "shorthand";
      const ownNodes = shorthand ? [] : (src.content.filter((n) => n.kind === "command" && n.name !== "music") as Command[]);
      const declaresFrames = shorthand || ownNodes.some((c) => c.name === "frame");
      const parentNodes = parentName
        ? (defs.body("parent", parentName, bp).filter((n) => n.kind === "command" && n.name !== "folio") as Command[]).filter(
            (c) => !(declaresFrames && c.name === "frame"),
          )
        : [];
      const children: { cmd: Command | null; id: string }[] = [
        ...parentNodes.map((c) => ({ cmd: c, id: `${src.id}/${ids.of(c)}` })),
        ...(shorthand ? [{ cmd: null, id: `${src.id}/frame` }] : ownNodes.map((c) => ({ cmd: c, id: ids.of(c) }))),
      ];

      // Reveals: a child without its own enter takes the scene's, staggered (§13).
      const stagger = (a.get("stagger") as { ms: number } | undefined)?.ms ?? 80;
      let staggered = 0;
      const revealFor = (cmd: Command | null, own: Attrs): Reveal =>
        cmd?.attrs.some((x) => x.key === "enter")
          ? revealOf(own, 0)
          : revealOf(a, enumId(a.get("enter")) === "none" ? 0 : stagger * staggered++);

      const sceneFrames: Frame[] = [];
      const sceneObjects: ObjectElement[] = [];
      /** A frame at `bp` (spec §09.2). One inside a group keeps its record, but the group decides where it goes. */
      const frameOf = (cmd: Command | null, id: string, z: number, reveal: Reveal, fa: Attrs): Frame => {
        const storyId = cmd && fa.has("story") ? ident(fa.get("story")) : `${id}#text`;
        if (!(cmd && fa.has("story"))) story(storyId, "frame", id, cmd ? ((cmd.body as Node[] | null) ?? []) : src.content, null);
        else if (!stories.has(storyId)) throw new Error(`frame "${id}" shows unknown story "${storyId}"`);
        return {
          id,
          scene: src.id,
          story: storyId,
          cols: range(fa.get("cols"), grid.cols, grid.body),
          vertical:
            height === "screen"
              ? { mode: "rows", rows: range(fa.get("rows"), grid.rows, { from: 1, to: grid.rows }) }
              : { mode: "flow", top: lenOrAuto(fa.get("top")), height: lenOrAuto(fa.get("height")) },
          columns: fa.get("columns")?.t === "enum" ? "auto" : num(fa.get("columns")),
          columnGap: fa.has("column-gap") ? len(fa.get("column-gap")!) : grid.gutter,
          balance: bool(fa.get("balance")),
          columnRule: enumId(fa.get("column-rule")) as Frame["columnRule"],
          valign: enumId(fa.get("valign")) as Frame["valign"],
          measure: fa.get("measure")?.t === "enum" ? null : len(fa.get("measure")!),
          inset: len(fa.get("inset")!),
          bg: colorOf(fa.get("bg")),
          z: fa.has("z") ? num(fa.get("z")) : z,
          hidden: bool(fa.get("hide")),
          wrap: enumId(fa.get("wrap")) === "rect" ? { offset: len(fa.get("wrap-offset")!) } : null,
          reveal,
        };
      };
      /**
       * A group's children (§11.11, design 2026-09-26), recursively. The reveal
       * the group was given, its own or its scene's or its container's, passes
       * to each child without its own `enter`, staggered by the group's
       * `stagger`. The group's own record does not animate, so nothing reveals
       * twice.
       */
      const groupChildren = (g: GroupObject, cmd: Command, prefix: string): void => {
        const ga: Attrs = new Map([...schemaDefaults("group"), ...elementAttrs(cmd, bp, "group", deref)]);
        const step = (ga.get("stagger") as { ms: number } | undefined)?.ms ?? 80;
        const given = g.reveal;
        let k = 0;
        const revealIn = (c: Command, ca: Attrs): Reveal =>
          c.attrs.some((x) => x.key === "enter") ? revealOf(ca, 0) : given.enter === "none" ? given : { ...given, delayMs: given.delayMs + step * k++ };
        g.reveal = { ...given, enter: "none", exit: "none" };
        const kids = ((cmd.body as Node[] | null) ?? []).filter((n): n is Command => n.kind === "command");
        g.children = kids.map((c, index) => {
          const cid = `${prefix}${ids.of(c)}`;
          const ca: Attrs = new Map([...schemaDefaults(c.name), ...elementAttrs(c, bp, c.name, deref)]);
          const sizing = {
            width: !ca.has("width") ? null : ca.get("width")!.t === "enum" ? ("fit" as const) : len(ca.get("width")!),
            minWidth: ca.has("min-width") ? len(ca.get("min-width")!) : null,
            maxWidth: ca.has("max-width") ? len(ca.get("max-width")!) : null,
          };
          // The schema allows a rule among a group's children; the resolver has no scene-level rule yet.
          if (c.name === "rule") notYet(c, "\\rule in a group");
          if (c.name === "frame") {
            frames[cid] = frameOf(c, cid, index, revealIn(c, ca), ca);
            return { kind: "frame" as const, id: cid, ...sizing };
          }
          const child = objectOf(c, cid, { mode: "contained", container: g.id, index }, revealIn(c, ca), index);
          objects[cid] = child;
          if (child.kind === "group") groupChildren(child, c, prefix);
          return { kind: "object" as const, id: cid, ...sizing };
        });
      };
      children.forEach(({ cmd, id }, z) => {
        // Groups are placed in scenes only; one anchored in a story is not resolved yet.
        if (cmd && (OBJECTS.has(cmd.name) || cmd.name === "group")) {
          const oa: Attrs = new Map([...schemaDefaults(cmd.name), ...elementAttrs(cmd, bp, cmd.name, deref)]);
          const o = objectOf(cmd, id, { mode: "grid", scene: src.id, grid, height }, revealFor(cmd, oa), z);
          objects[id] = o;
          sceneObjects.push(o);
          if (o.kind === "group") groupChildren(o, cmd, id.includes("/") ? id.slice(0, id.lastIndexOf("/") + 1) : "");
          return;
        }
        if (cmd && cmd.name !== "frame") notYet(cmd, `\\${cmd.name} in a scene`);
        const fa: Attrs = new Map([...schemaDefaults("frame"), ...(cmd ? elementAttrs(cmd, bp, "frame", deref) : [])]);
        const frame = frameOf(cmd, id, z, revealFor(cmd, fa), fa);
        frames[id] = frame;
        sceneFrames.push(frame);
      });

      // Linearize (§07.5): a visible frame or grid object whose columns do not fit.
      const fits = (c: { from: number; to: number }): boolean => c.to <= grid.cols && c.from <= grid.cols;
      const misfit =
        sceneFrames.find((f) => !f.hidden && !fits(f.cols))?.id ??
        sceneObjects.find((o) => !o.hidden && o.placement.mode === "grid" && !fits(o.placement.cols))?.id;
      const asked = bool(a.get("linearize"));
      const linearized = asked || misfit !== undefined;
      if (misfit && !asked) {
        const at = children.find((c) => c.id === misfit)?.cmd ?? src.cmd;
        warn(
          "W031",
          `Scene "${src.id}" will linearize on ${bp}: ${misfit} does not fit the ${grid.cols}-column grid.`,
          at,
          bp,
          `Add cols@${bp}=... or linearize@${bp}=true.`,
        );
      }
      if (linearized) {
        const all = { from: 1, to: grid.cols };
        const stacked = { mode: "flow" as const, top: "auto" as const, height: "auto" as const };
        for (const f of sceneFrames) Object.assign(f, { cols: all, columns: 1, vertical: stacked });
        for (const o of sceneObjects) {
          if (o.placement.mode === "grid") o.placement = { ...o.placement, cols: all, vertical: stacked };
          if (o.wrap.mode !== "none") o.wrap = { mode: "jump", offset: o.wrap.offset };
        }
      }

      return {
        id: src.id,
        parent: parentName,
        grid,
        palette: design.palette(ident(a.get("palette")), bp),
        height,
        snap,
        turn,
        bg: colorOf(a.get("bg")) ?? { role: "paper" },
        linearized,
        folio: enumId(a.get("folio")) === "hide" ? null : folioFor(parentName, bp),
        children: children.map((c) => ({ kind: frames[c.id] ? ("frame" as const) : ("object" as const), id: c.id })),
      };
    });

    // Anchored objects, where their story put them (§11.3). one whose cols do not
    // fit a breakpoint's grid linearizes alone, since its scene is known only to layout.
    // Limit: `end` in an anchored `cols=` is the narrowest grid among the scenes showing its story; per-scene needs layout to resolve it.
    const lastColOf = (sid: string): number =>
      Math.min(...Object.values(frames).filter((f) => f.story === sid).map((f) => scenes.find((s) => s.id === f.scene)!.grid.cols), ...(Object.values(frames).some((f) => f.story === sid) ? [] : scenes.map((s) => s.grid.cols)));
    for (const { cmd, story: sid, block } of anchored) {
      const narrowest = lastColOf(sid);
      const id = ids.of(cmd);
      const oa: Attrs = new Map([...schemaDefaults(cmd.name), ...elementAttrs(cmd, bp, cmd.name, deref)]);
      const reveal = cmd.attrs.some((x) => x.key === "enter") ? revealOf(oa, 0) : revealOf(schemaDefaults("scene"), 0);
      const o = objectOf(cmd, id, { mode: "anchored", story: sid, block, lastCol: narrowest }, reveal, 0);
      if (!o.hidden && o.placement.mode === "anchored" && o.placement.horizontal.mode === "cols" && o.placement.horizontal.cols.to > narrowest) {
        warn("W031", `Anchored ${id} will linearize on ${bp}: its columns do not fit the grid.`, cmd, bp, `Add cols@${bp}=... to it.`);
        o.placement = { ...o.placement, horizontal: { mode: "full" } };
        if (o.wrap.mode !== "none") o.wrap = { mode: "jump", offset: o.wrap.offset };
      }
      objects[id] = o;
    }

    // Threads (§09.3): visible frames per story, scene order then source order, into groups depth first.
    const threads: Record<string, string[]> = {};
    const thread = (c: { kind: "frame" | "object"; id: string }): void => {
      const f = c.kind === "frame" ? frames[c.id] : undefined;
      if (f && !f.hidden) (threads[f.story] ??= []).push(f.id);
      const o = c.kind === "object" ? objects[c.id] : undefined;
      if (o?.kind === "group") o.children.forEach(thread);
    };
    for (const s of scenes) s.children.forEach(thread);
    for (const s of ast.stories) {
      const name = ident(s.attrs.find((a) => a.key === "name")?.value);
      if (!threads[name]) throw new Error(`story "${name}" has no visible frame on ${bp} (spec §09.3)`);
    }

    const styleAt = (k: string): ResolvedStyle => design.styleKey(k, bp);
    const storyTable = Object.fromEntries([...stories.values()].map((s) => [s.id, withIndents(s, styleAt)]));
    return { name: bp, styles: styleTable([...stories.values()], styleAt), stories: storyTable, scenes, frames, objects, threads };
  };

  /** The folio over a scene: its parent's if the parent declares one, else the document's (§10.5). */
  const folioFor = (parentName: string | null, bp: string): Folio | null => {
    const fromParent = parentName ? defs.body("parent", parentName, bp).find((n): n is Command => n.kind === "command" && n.name === "folio") : undefined;
    const cmd = fromParent ?? ast.folio;
    if (!cmd) return null;
    const id = fromParent ? `${parentName}#folio` : "folio#text";
    story(id, "folio", null, [{ kind: "paragraph", id: cmd.id, runs: cmd.body as never, source: cmd.source }], null, "folio");
    const a = new Map([...schemaDefaults("folio"), ...elementAttrs(cmd, bp, "folio", deref)]);
    return { story: id, position: enumId(a.get("position")) as Folio["position"], progress: bool(a.get("progress")) };
  };

  // Anonymous stories are created while variants are built, and a parent's
  // `at=` children can add some in one variant only. Every variant must carry
  // every story (G6), so one pass discovers them and a second pass builds.
  // Warnings from the first pass are discarded.
  for (const bp of variants) variant(bp);
  diagnostics.length = 0;
  const built = variants.map((bp) => [bp, variant(bp)] as const);
  // Readability (2026-10-09): body size, leading and weight, and text contrast, per variant.
  for (const r of readability(built)) warn(r.code, r.message, null, r.variant || null, r.fix);

  // §13: `motion=always` overrides the reader's reduced-motion setting, so it is always a warning.
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.kind !== "command") continue;
      if (n.attrs.some((x) => x.key === "motion"))
        warn("W034", `\\${n.name} keeps its motion under reduced motion (motion=always).`, n, null, "Remove motion=always unless the motion carries meaning.");
      if (Array.isArray(n.body)) walk(n.body as Node[]);
    }
  };
  walk([...ast.definitions, ...ast.stories, ...ast.scenes, ...ast.implicitContent]);

  // §07.1: a font that fails to load falls back to the style's next family, with an asset warning.
  if (options.assets)
    for (const c of defs.all("font")) {
      const src = c.attrs.find((a) => a.key === "src")?.value;
      if (src?.t === "path" && !options.assets.file(src.s))
        warn("W050", `Missing font file ${src.s}: text falls back to the style's next family`, c, null, "Add the file.", "asset-warning");
    }

  // Frontmatter `social-image` (spec §04): an image asset like a figure's, for the page's social card.
  let socialImage: string | null = null;
  const social = ast.frontmatter["social-image"];
  if (social !== undefined) {
    if (!options.assets) throw new Error("frontmatter social-image needs an asset host (ResolveOptions.assets) to read its file");
    const info = options.assets.image(social);
    if (!info) warn("W050", `Missing file ${social}`, null, null, "Check the social-image path, or add the file.", "asset-warning");
    socialImage = `image:${social}`;
    // A card is 1200x630 by convention; a missing file keeps that size.
    assets[socialImage] ??= { kind: "image", width: info?.width ?? 1200, height: info?.height ?? 630, animated: info?.animated ?? false, sources: [], fallback: info?.url ?? social };
  }

  const doc: ResolvedDocument = {
    format: "wmxdsl-resolved",
    version: 1,
    meta: meta(ast.frontmatter, lang, socialImage),
    breakpoints: design.breakpoints(),
    fonts: fonts(defs),
    strings,
    assets,
    variants: Object.fromEntries(built) as Variants,
    music,
    diagnostics,
  };
  return { doc, diagnostics: doc.diagnostics };
}

// ---------------------------------------------------------------------------

/**
 * An element's own attributes at `bp`: base values, then `key@bp` overrides,
 * tokens resolved. Defaults are the caller's to merge beneath.
 */
function elementAttrs(c: Command, bp: string, command: string, deref: (c: string, k: string, v: Value) => Value): Attrs {
  const out: Attrs = new Map();
  for (const a of c.attrs) if (a.at === null && a.key !== "name") out.set(a.key, a.value);
  for (const a of c.attrs) if (a.at === bp) out.set(a.key, a.value);
  for (const [k, v] of out) out.set(k, deref(command, k, v));
  return out;
}

function meta(fm: Document["frontmatter"], lang: string, socialImage: string | null): Meta {
  return {
    wmxdsl: 1,
    title: fm.title,
    lang,
    description: fm.description ?? null,
    authors: fm.author === undefined ? [] : Array.isArray(fm.author) ? fm.author : [fm.author],
    date: fm.date ?? null,
    section: fm.section ?? null,
    socialImage,
    theme: fm.theme ?? null,
  };
}

function fonts(defs: Definitions): ResolvedDocument["fonts"] {
  const out: ResolvedDocument["fonts"] = [];
  // \font has no name; every definition registers a face.
  for (const c of defs.all("font")) {
    const a = new Map([...schemaDefaults("font"), ...c.attrs.map((x) => [x.key, x.value] as const)]);
    const w = a.get("weight")!;
    out.push({
      family: (a.get("family") as { s: string }).s,
      src: (a.get("src") as { s: string }).s,
      weight: w.t === "range" ? { min: w.from, max: w.to === "end" ? w.from : w.to } : { min: num(w), max: num(w) },
      italic: bool(a.get("italic")),
    });
  }
  return out;
}

/** Style keys in order of first reference, each flattened. */
function styleTable(stories: Story[], style: (k: string) => ResolvedStyle): Record<string, ResolvedStyle> {
  const out: Record<string, ResolvedStyle> = {};
  const use = (k: string): void => {
    if (!(k in out)) out[k] = style(k);
  };
  for (const s of stories)
    for (const b of s.blocks)
      if (b.kind === "paragraph") {
        use(b.style);
        if (b.dropcap) use(b.dropcap.style);
        for (const r of b.runs) if (r.kind !== "break") use(r.style);
      }
  return out;
}

function revealOf(a: Attrs, delay: number): Reveal {
  const ms = (v: Value | undefined): number => (v?.t === "time" ? v.ms : 0);
  const enterAt = a.get("enter-at");
  return {
    enter: enumId(a.get("enter")) as Reveal["enter"],
    exit: enumId(a.get("exit")) as Reveal["exit"],
    enterAt: enterAt?.t === "percentage" ? enterAt.n / 100 : 0.15,
    durationMs: ms(a.get("duration")),
    delayMs: ms(a.get("delay")) + delay,
    ease: enumId(a.get("ease")) as Reveal["ease"],
    replay: bool(a.get("replay")),
    motion: a.get("motion") ? "always" : "reduce",
  };
}

const lenCtx = { em: null, baseline: null, fluidTo: 0 };
const len = (v: Value) => toLen(v, lenCtx);
const lenOrAuto = (v: Value | undefined) => (!v || v.t === "enum" ? ("auto" as const) : len(v));
const colorOf = (v: Value | undefined): Scene["bg"] | null =>
  !v ? null : v.t === "role" ? { role: v.id as "paper" } : v.t === "color" ? { hex: `#${v.hex}` } : null;
const ident = (v: Value | undefined): string => (v?.t === "ident" || v?.t === "role" || v?.t === "enum" ? v.id : "");
const enumId = ident;
const bool = (v: Value | undefined): boolean => v?.t === "boolean" && v.b;
const num = (v: Value | undefined): number => (v?.t === "integer" || v?.t === "number" ? v.n : NaN);

const gcd = (a: number, b: number): number => (Number.isInteger(a) && Number.isInteger(b) ? (b === 0 ? a : gcd(b, a % b)) : 1);

/** A percentage value as a 0..1 fraction. */
function pct01(v: Value | undefined): number {
  return v?.t === "percentage" ? v.n / 100 : 0;
}
