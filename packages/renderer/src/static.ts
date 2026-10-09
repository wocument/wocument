/**
 * The no-JavaScript reading version (spec §13 rule 2): the whole document as
 * plain semantic HTML in story order (§14), built from the Resolved Document
 * alone -- no DOM, no layout, no measurement -- so a build can put it in the
 * page it serves. Scenes become sections; each story appears once, at its
 * first frame; anchored objects appear at their anchor; grid-placed objects in
 * source order. A small stylesheet sets one readable column in the document's
 * own type and palettes.
 *
 * When the page's script runs, `render()` replaces it with the laid-out page.
 * To avoid a visible swap, the page marks itself as scripted before the body
 * is parsed -- `<script>document.documentElement.classList.add("wmx-js")</script>`
 * in the head -- and the reading version stays hidden while that class is set.
 *
 * Limit: built from the `base` variant; breakpoint overrides (hide@phone and
 * the like) apply only in the laid-out page.
 */

import type {
  Block,
  Color,
  Len,
  ObjectElement,
  ParagraphBlock,
  ResolvedDocument,
  ResolvedStyle,
  Variant,
} from "@wmxdsl/resolved-document";

const CSS = `
.wmx-js .wmx-static { visibility: hidden; }
.wmx-static { font: 19px/1.55 serif; }
.wmx-static section { padding: 3rem max(1.25rem, calc((100% - 40rem) / 2)); }
.wmx-static h1, .wmx-static h2, .wmx-static h3, .wmx-static p { margin: 0 0 0.75em; }
.wmx-static h1 { line-height: 1.1; }
.wmx-static h2, .wmx-static h3 { margin-top: 1.5em; line-height: 1.25; }
.wmx-static figure { margin: 2rem 0; }
.wmx-static img, .wmx-static video { display: block; max-width: 100%; height: auto; }
.wmx-static figcaption { margin-top: 0.5rem; }
.wmx-static blockquote { margin: 2rem 0; padding-left: 1.25rem; border-left: 3px solid var(--wmx-accent); }
.wmx-static aside { margin: 2rem 0; padding: 1rem 1.25rem; border: 1px solid var(--wmx-rule); }
.wmx-static hr { border: 0; border-top: 1px solid var(--wmx-rule); margin: 1.5rem 0; }
.wmx-static a { color: var(--wmx-accent); }
`;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const color = (c: Color): string => ("role" in c ? `var(--wmx-${c.role})` : c.hex);

/** A length as CSS, where it has a meaning without a grid; `null` for grid units and percentages. */
function cssLen(l: Len): string | null {
  if (l.u === "px") return `${l.n}px`;
  if (l.u === "vw" || l.u === "vh") return `${l.n}${l.u}`;
  if (l.u === "fluid") return `clamp(${l.min}px, calc(${l.min}px + ${l.max - l.min} * (100vw - ${l.from}px) / ${l.to - l.from}), ${l.max}px)`;
  return null;
}

/** One style as CSS declarations: the type, not the layout (no leading from the grid, no measure). */
function cssStyle(s: ResolvedStyle): string {
  const out = [
    `font-family: ${s.family.map((f) => (/^[a-z-]+$/.test(f) ? f : JSON.stringify(f))).join(", ")}`,
    `font-weight: ${s.weight}`,
    `font-style: ${s.italic ? "italic" : "normal"}`,
    `color: ${color(s.color)}`,
    `text-align: ${s.align}`,
  ];
  const size = cssLen(s.size);
  if (size) out.push(`font-size: ${size}`);
  const leading = cssLen(s.leading);
  if (leading) out.push(`line-height: ${leading}`);
  if (s.case === "upper" || s.case === "lower") out.push(`text-transform: ${s.case === "upper" ? "uppercase" : "lowercase"}`);
  if (s.case === "small-caps") out.push("font-variant-caps: small-caps");
  if (s.underline) out.push("text-decoration: underline");
  return out.join("; ");
}

/** Spec §14: headline is h1, subhead h2/h3, a caption inside its figure's figcaption is a paragraph there. */
function tagOf(b: ParagraphBlock): string {
  if (b.element === "headline") return "h1";
  if (b.element === "subhead") return b.level === 2 ? "h3" : "h2";
  return "p";
}

export function renderStatic(rd: ResolvedDocument): string {
  const v: Variant = rd.variants.base!;
  const classes = new Map<string, string>();
  /** A class for a style key, registered on first use so the stylesheet holds only what is used. */
  const cls = (key: string): string => {
    let c = classes.get(key);
    if (!c) classes.set(key, (c = `wmx-s${classes.size}`));
    return c;
  };
  const emitted = new Set<string>();

  const runs = (b: ParagraphBlock): string => {
    let html = b.dropcap ? esc(rd.strings[b.dropcap.s]!) : "";
    for (const r of b.runs) {
      if (r.kind === "break") {
        html += "<br>";
        continue;
      }
      let t = esc(rd.strings[r.s]!);
      if (r.kind === "endmark") {
        html += `<span class="${cls(r.style)}" aria-hidden="true">${t}</span>`;
        continue;
      }
      if (r.marks.includes("code")) t = `<code>${t}</code>`;
      if (r.marks.includes("em")) t = `<em>${t}</em>`;
      if (r.marks.includes("strong")) t = `<strong>${t}</strong>`;
      if (r.style !== b.style) t = `<span class="${cls(r.style)}">${t}</span>`;
      if (r.link !== null) t = `<a href="${esc(b.links[r.link]!.href)}">${t}</a>`;
      html += t;
    }
    return html;
  };

  const blocks = (list: Block[]): string => {
    let html = "";
    let quote: number | null = null;
    for (const b of list) {
      const q = b.kind === "paragraph" ? b.quote : null;
      if (q !== quote) {
        if (quote !== null) html += "</blockquote>";
        if (q !== null) html += "<blockquote>";
        quote = q;
      }
      if (b.kind === "paragraph") {
        const tag = tagOf(b);
        html += `<${tag} class="${cls(b.style)}">${runs(b)}</${tag}>`;
      } else if (b.kind === "rule") html += "<hr>";
      else if (b.kind === "object") html += object(v.objects[b.object]!);
    }
    if (quote !== null) html += "</blockquote>";
    return html;
  };

  const story = (id: string): string => {
    if (emitted.has(id)) return "";
    emitted.add(id);
    return blocks(v.stories[id]?.blocks ?? []);
  };

  const caption = (o: { caption: { story: string } | null }): string =>
    o.caption ? `<figcaption>${story(o.caption.story)}</figcaption>` : "";

  const image = (asset: string, alt: string | null): string => {
    const a = rd.assets[asset];
    if (a?.kind !== "image") return "";
    return `<img src="${esc(a.fallback)}" width="${a.width}" height="${a.height}" alt="${esc(alt ?? "")}" loading="lazy">`;
  };

  function object(o: ObjectElement): string {
    if (o.hidden) return "";
    switch (o.kind) {
      case "figure":
        return `<figure class="wmx-figure">${image(o.image, o.alt)}${caption(o)}</figure>`;
      case "video": {
        const a = rd.assets[o.video];
        const poster = o.poster ? rd.assets[o.poster] : undefined;
        const sources = a?.kind === "video" ? a.sources.map((s) => `<source src="${esc(s.url)}" type="${esc(s.type)}">`).join("") : "";
        const posterAttr = poster?.kind === "image" ? ` poster="${esc(poster.fallback)}"` : "";
        const label = o.alt ? ` aria-label="${esc(o.alt)}"` : "";
        return `<figure class="wmx-video"><video controls preload="none"${posterAttr}${label}>${sources}</video>${caption(o)}</figure>`;
      }
      case "audio": {
        const a = rd.assets[o.audio];
        const sources = a?.kind === "audio" ? a.sources.map((s) => `<source src="${esc(s.url)}" type="${esc(s.type)}">`).join("") : "";
        const label = o.title ? ` aria-label="${esc(o.title)}"` : "";
        return `<figure class="wmx-audio"><audio controls preload="none"${label}>${sources}</audio>${caption(o)}</figure>`;
      }
      case "embed": {
        // Without a script there is no facade: a link to the provider's page stands in for the player.
        const s = o.source;
        const href =
          "url" in s ? s.url : s.provider === "youtube" ? `https://www.youtube.com/watch?v=${encodeURIComponent(s.id)}` : `https://vimeo.com/${encodeURIComponent(s.id)}`;
        return `<figure class="wmx-embed"><p><a href="${esc(href)}">${esc(o.title ?? href)}</a></p>${caption(o)}</figure>`;
      }
      case "gallery":
        return `<figure class="wmx-gallery">${o.items.map((id) => object(v.objects[id]!)).join("")}${caption(o)}</figure>`;
      case "group":
        // Source order, which is also reading order: a stacked photo and its headline stay together.
        return o.children
          .map((c) => (c.kind === "frame" ? (v.frames[c.id]!.hidden ? "" : story(v.frames[c.id]!.story)) : object(v.objects[c.id]!)))
          .join("");
      case "pullquote":
        return `<blockquote class="wmx-pullquote">${story(o.story)}</blockquote>`;
      case "sidebar":
        return `<aside class="wmx-sidebar">${story(o.story)}</aside>`;
      case "rule":
        return "<hr>";
      default:
        // \lottie and \group are not resolved yet (the resolver throws before this is reached).
        return "";
    }
  }

  const sections = v.scenes.map((scene) => {
    const vars = Object.entries(scene.palette)
      .map(([role, hex]) => `--wmx-${role}: ${hex}`)
      .join("; ");
    let body = "";
    for (const c of scene.children) {
      if (c.kind === "frame") {
        const f = v.frames[c.id]!;
        if (!f.hidden) body += story(f.story);
        continue;
      }
      const o = v.objects[c.id]!;
      // A background with no description is decoration; one with alt text is content.
      if (o.placement.mode === "background" && !("alt" in o && o.alt)) continue;
      body += object(o);
    }
    return `<section id="${esc(scene.id)}" style="${vars}; background: ${color(scene.bg)}; color: var(--wmx-ink)">${body}</section>`;
  });

  const styles = [...classes].map(([key, c]) => `.wmx-static .${c} { ${cssStyle(v.styles[key]!)} }`).join("\n");
  return `<div class="wmx-static" lang="${esc(rd.meta.lang)}"><style>${CSS}${styles}</style>${sections.join("")}</div>`;
}

