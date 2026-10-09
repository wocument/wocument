/**
 * @wmxdsl/renderer -- Positioned Document + Resolved Document -> DOM
 * (spec §15.1 stage 5).
 *
 * The Positioned Document carries geometry; everything else (palette, element
 * kind, style, reveal) is looked up in the Resolved Document by the ids it
 * carries.
 *
 * Rules that make the text real text (spec §14):
 *   - DOM order is story order: lines are emitted in array order, never sorted.
 *   - One absolutely positioned span per line, inside a semantic wrapper.
 *   - `white-space: pre` and a trailing space on every line, or copy and paste
 *     welds the last word of one line to the first of the next (spike Q4).
 *   - Soft hyphens are stripped from the DOM. A line that breaks at one shows
 *     its hyphen through ::after, which is never copied, so a copied word stays
 *     whole. A drop cap is emitted just before its paragraph's first line, so
 *     the copied word is whole there too.
 *
 * Reveals use opacity and transform only and never move layout (spec §13).
 */

import { type EvalContext, type PositionedDocument, type PositionedLine, engineFont, px } from "@wmxdsl/layout";
import type { Color, Folio, ObjectElement, ParagraphBlock, ResolvedDocument, ResolvedStyle, Reveal, RuleBlock } from "@wmxdsl/resolved-document";
import { cssFont } from "@wmxdsl/text-engine";
import { continuingLines, installPages, snapStops } from "./pages.js";
import { soundtrack } from "./music.js";
import { READ_ASSIST_CSS, readAssist } from "./read-assist.js";

const SHY = "\u00ad";

const CSS = `
.wmx-doc { position: relative; overflow-x: clip; }
.wmx-scene { position: absolute; left: 0; width: 100%; scroll-snap-align: none; }
.wmx-scene[data-snap] { scroll-snap-align: start; }
.wmx-scene[data-snap="hard"] { scroll-snap-stop: always; }
.wmx-frame { position: absolute; inset: 0; margin: 0; pointer-events: none; }
.wmx-frame * { pointer-events: auto; }
/* A nested (anchored-object) wrapper covers the scene too; only its content takes the pointer. */
.wmx-frame .wmx-frame { pointer-events: none; }
.wmx-block { margin: 0; font-size: inherit; font-weight: inherit; }
.wmx-line, .wmx-cap { position: absolute; white-space: pre; }
.wmx-line.wmx-hy::after { content: "-"; }
.wmx-rule { position: absolute; }
.wmx-column-rule { position: absolute; width: 0; border-left: 1px solid var(--wmx-rule); }
.wmx-gallery { overflow: hidden; }
.wmx-gallery[data-layout="strip"] { overflow-x: auto; overscroll-behavior-x: contain; }
.wmx-facade { border: 0; padding: 0; cursor: pointer; background: #000 center / cover no-repeat; }
.wmx-facade::after { content: ""; position: absolute; left: 50%; top: 50%; width: 68px; height: 48px; margin: -24px 0 0 -34px; border-radius: 12px; background: rgba(0,0,0,.7) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 68 48'%3E%3Cpath d='M27 15v18l16-9z' fill='%23fff'/%3E%3C/svg%3E"); }
.wmx-facade:focus-visible::after, .wmx-facade:hover::after { background-color: #c00; }
.wmx-embed { border: 0; }
.wmx-reveal { transition-property: opacity, transform, mask-position, -webkit-mask-position; will-change: opacity, transform; }
/* Enter: the start state until .wmx-in. Exit: the end state while .wmx-out (left through the top). */
.wmx-reveal:not(.wmx-in), .wmx-reveal.wmx-out { opacity: 0; }
.wmx-reveal[data-enter="rise"]:not(.wmx-in), .wmx-reveal[data-exit="rise"].wmx-out { transform: translateY(24px); }
.wmx-reveal[data-enter="drop"]:not(.wmx-in), .wmx-reveal[data-exit="drop"].wmx-out { transform: translateY(-24px); }
.wmx-reveal[data-enter="slide-left"]:not(.wmx-in), .wmx-reveal[data-exit="slide-left"].wmx-out { transform: translateX(32px); }
.wmx-reveal[data-enter="slide-right"]:not(.wmx-in), .wmx-reveal[data-exit="slide-right"].wmx-out { transform: translateX(-32px); }
.wmx-reveal[data-enter="zoom"]:not(.wmx-in), .wmx-reveal[data-exit="zoom"].wmx-out { transform: scale(0.96); }
/* A wipe uncovers left to right. A mask, not clip-path: a clipped target never intersects, so its reveal would never fire. */
.wmx-reveal[data-enter="wipe"], .wmx-reveal[data-exit="wipe"] {
  -webkit-mask-image: linear-gradient(90deg, #000 50%, transparent 50%); mask-image: linear-gradient(90deg, #000 50%, transparent 50%);
  -webkit-mask-size: 200% 100%; mask-size: 200% 100%; -webkit-mask-position: 0 0; mask-position: 0 0;
}
.wmx-reveal[data-enter="wipe"]:not(.wmx-in), .wmx-reveal[data-exit="wipe"].wmx-out { opacity: 1; -webkit-mask-position: 100% 0; mask-position: 100% 0; }
.wmx-turn { position: absolute; inset: 0; pointer-events: none; }
.wmx-scene.wmx-away > .wmx-turn { opacity: 0; }
.wmx-scene[data-turn="slide"].wmx-away[data-from="below"] > .wmx-turn { transform: translateY(8vh); }
.wmx-scene[data-turn="slide"].wmx-away[data-from="above"] > .wmx-turn { transform: translateY(-8vh); }
.wmx-folio { position: absolute; z-index: 10; pointer-events: none; white-space: nowrap; }
.wmx-progress { position: fixed; top: 0; left: 0; height: 2px; z-index: 11; transform-origin: 0 0; }
.wmx-sound { position: relative; display: block; width: 28px; height: 28px;
  margin: 0; padding: 0; border: 0; border-radius: 50%; background: none; color: #5f6570; opacity: 0.55; cursor: pointer;
  transition: opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), color 400ms ease; -webkit-tap-highlight-color: transparent; }
.wmx-sound::before { content: ""; position: absolute; inset: -8px; border-radius: 50%; }
.wmx-sound:hover, .wmx-sound[aria-pressed="true"] { opacity: 1; }
.wmx-sound:focus-visible { outline: 1px solid currentColor; outline-offset: 3px; }
.wmx-sound svg { display: block; overflow: visible; }
.wmx-sound circle { fill: none; stroke: currentColor; stroke-width: 1; opacity: 0.45; }
.wmx-sound rect { fill: currentColor; transform-box: fill-box; transform-origin: 50% 50%; transform: scaleY(0.35); transition: transform 500ms cubic-bezier(0.16, 1, 0.3, 1); }
.wmx-sound rect:nth-of-type(2) { transform: scaleY(0.65); }
.wmx-sound rect:nth-of-type(3) { transform: scaleY(0.5); }
.wmx-sound rect:nth-of-type(4) { transform: scaleY(0.3); }
.wmx-sound[aria-pressed="true"] rect { animation: wmx-sound 1.1s ease-in-out infinite alternate; }
.wmx-sound[aria-pressed="true"] rect:nth-of-type(2) { animation-delay: -0.35s; animation-duration: 0.9s; }
.wmx-sound[aria-pressed="true"] rect:nth-of-type(3) { animation-delay: -0.7s; animation-duration: 1.3s; }
.wmx-sound[aria-pressed="true"] rect:nth-of-type(4) { animation-delay: -0.2s; animation-duration: 1s; }
@keyframes wmx-sound { from { transform: scaleY(0.25); } to { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) {
  .wmx-sound[aria-pressed="true"] rect { animation: none; transform: scaleY(0.6); }
  .wmx-sound[aria-pressed="true"] rect:nth-of-type(2n) { transform: scaleY(1); }
}
${READ_ASSIST_CSS}`;

const EASE: Record<Reveal["ease"], string> = { standard: "cubic-bezier(.2,.7,.2,1)", in: "ease-in", out: "ease-out", linear: "linear" };

export { renderStatic } from "./static.js";
export { continuingLines, currentPage, pageStep, screenPoints, snapStops } from "./pages.js";
export { cuePositions, currentCue } from "./music.js";
export { type AssistMode } from "./read-assist.js";

export type RenderHandle = { destroy(): void };

export type RenderOptions = {
  /** Overrides the reader's `prefers-reduced-motion` setting (spec §13 rule 3); for previews and tests. */
  reduceMotion?: boolean;
};

/**
 * Registers every `\font` (spec §07.1) and waits until each has loaded or
 * failed. Layout MUST NOT run before this resolves. A face that fails to load
 * is left out, so text falls back to the style's next family, the same one the
 * canvas measures with.
 */
export async function loadFonts(rd: ResolvedDocument, doc: Document = document): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  await Promise.all(
    rd.fonts.map(async (f) => {
      const weight = f.weight.min === f.weight.max ? String(f.weight.min) : `${f.weight.min} ${f.weight.max}`;
      const face = new FontFace(f.family, `url(${JSON.stringify(f.src)})`, { weight, style: f.italic ? "italic" : "normal" });
      try {
        // FontFaceSet.add is universally supported but missing from this TypeScript DOM lib.
        (doc.fonts as unknown as { add(face: FontFace): void }).add(await face.load());
      } catch {
        failed.push(f.src);
      }
    }),
  );
  await doc.fonts.ready;
  return { failed };
}

export function render(root: HTMLElement, pd: PositionedDocument, rd: ResolvedDocument, options: RenderOptions = {}): RenderHandle {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  installCss(doc);
  // Limit: read once; a reader who changes the setting sees it on the next render (resize or reload).
  const reduce = options.reduceMotion ?? win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const v = rd.variants[pd.breakpoint]!;
  root.textContent = "";
  root.className = "wmx-doc";
  root.style.height = `${pd.height}px`;
  root.lang = rd.meta.lang;

  const reveals: { el: HTMLElement; reveal: Reveal }[] = [];
  /** Videos with play=visible: they play while in the viewport and pause outside it (§11.5). */
  const videos: HTMLVideoElement[] = [];
  /** Page sections with turn effects. */
  const turns: HTMLElement[] = [];
  let anySnap: "none" | "soft" | "hard" = "none";

  for (const ps of pd.scenes) {
    const scene = v.scenes.find((s) => s.id === ps.name)!;
    const section = doc.createElement("section");
    section.id = scene.id;
    section.className = "wmx-scene";
    section.style.top = `${ps.y}px`;
    section.style.height = `${ps.height}px`;
    for (const [role, hex] of Object.entries(scene.palette)) section.style.setProperty(`--wmx-${role}`, hex);
    section.style.background = color(scene.bg);
    section.style.color = "var(--wmx-ink)";
    // Design §3 turn: the page's layers sit in one wrapper that the turn moves; the section's paper stays put.
    // §13 rule 3: none under reduced motion.
    const turn = scene.turn && !reduce ? scene.turn : null;
    const layer = turn ? section.appendChild(doc.createElement("div")) : section;
    if (turn) {
      layer.className = "wmx-turn";
      section.dataset.turn = turn.effect;
      layer.style.transition = ["opacity", "transform"].map((p) => `${p} ${turn.durationMs}ms ${EASE[turn.ease]}`).join(", ");
      turns.push(section);
    }
    // §08.3: soft is proximity, hard is mandatory (already downgraded on flow scenes by the resolver).
    if (scene.snap !== "none") {
      section.dataset.snap = scene.snap;
      if (anySnap !== "hard") anySnap = scene.snap;
    }

    const ctx: EvalContext = { viewport: pd.viewport, grid: ps.grid, pctOf: pd.viewport.width };
    const boxes = new Map(ps.objects.map((o) => [o.name, o]));
    const frames = new Map<string, HTMLElement>();
    /** A gallery's item layer, where its items' wrappers go. */
    const inners = new Map<string, HTMLElement>();
    /** The wrapper of the frame whose text was emitted last: an anchored object's host. */
    let host: HTMLElement | null = null;
    // One wrapper per frame or object, created when its first content appears. An anchored
    // object's wrapper goes inside its host frame's wrapper at that point, so DOM order is
    // story order (§14): the pull quote is read where its anchor is, not after the story.
    const frameEl = (id: string): HTMLElement => {
      let el = frames.get(id);
      if (!el) {
        const obj = v.objects[id];
        // A figure or video is a real <figure>, so its caption is its <figcaption> (§14).
        el = doc.createElement(obj && FIGURES.has(obj.kind) ? "figure" : "div");
        el.className = "wmx-frame";
        // Paint order by layer (§11.2): background beneath text, overlay above it.
        el.style.zIndex = obj?.layer === "background" ? "0" : obj?.layer === "overlay" ? "2" : "1";
        el.dataset.frame = id;
        const reveal = v.frames[id]?.reveal ?? v.objects[id]?.reveal;
        // §13 rule 3: under reduced motion every reveal is none, unless the author forced it.
        const moves = reveal && (reveal.enter !== "none" || reveal.exit !== "none");
        if (moves && (!reduce || reveal.motion === "always")) reveals.push({ el, reveal });
        const box = boxes.get(id);
        if (box) {
          const b = el.appendChild(objectBox(doc, obj!, box, ps.y, rd, reduce, videos));
          if (obj!.kind === "gallery") {
            // Items keep scene coordinates: this layer undoes the gallery box's offset.
            const inner = b.appendChild(doc.createElement("div"));
            inner.style.cssText = `position:absolute;left:${-box.media!.x}px;top:${-(box.media!.y - ps.y)}px;`;
            inners.set(id, inner);
          }
        }
        frames.set(id, el);
        const at = obj?.placement;
        const parent =
          // A gallery keeps an inner layer for its items; a group has no box of its own, so its children go in its wrapper.
          at?.mode === "contained" ? (frameEl(at.container), inners.get(at.container) ?? frames.get(at.container)!) : at?.mode === "anchored" && host ? host : layer;
        parent.appendChild(el);
      }
      if (!v.objects[id]) host = el;
      return el;
    };

    // Lines, grouped into semantic elements, in story order.
    const groups = paragraphs(ps.lines);
    // Lines that carry on a word hyphenated at the end of the line before (§07.6 hyphen-mark).
    const continuing = continuingLines(ps.lines);
    // A paragraph split across frames or columns is several groups; only the last one ends it.
    const endsIn = new Map<string, number>();
    groups.forEach((g, i) => endsIn.set(`${g[0]!.story}\u0000${g[0]!.block}`, i));
    for (const [gi, group] of groups.entries()) {
      const first = group[0]!;
      const ends = endsIn.get(`${first.story}\u0000${first.block}`) === gi;
      const block = v.stories[first.story]!.blocks[first.block] as ParagraphBlock;
      const style = v.styles[first.style]!;
      const wrapper = doc.createElement(tagFor(block));
      wrapper.className = "wmx-block";
      wrapper.dataset.story = first.story;
      wrapper.dataset.block = String(first.block);
      // Running text, which read assist marks (read-assist.ts).
      if (block.element === "prose" || block.element === "lede") wrapper.dataset.text = "";
      applyStyle(wrapper, style, ctx);
      const cap = first.paragraphStart ? ps.caps.find((c) => c.story === first.story && c.block === first.block) : undefined;
      if (cap && block.dropcap) {
        const el = doc.createElement("span");
        el.className = "wmx-cap";
        applyStyle(el, v.styles[block.dropcap.style]!, ctx);
        el.style.fontSize = `${cap.size}px`;
        el.style.left = `${cap.x}px`;
        el.style.top = `${cap.y - ps.y}px`;
        el.style.lineHeight = `${cap.height}px`;
        el.textContent = rd.strings[block.dropcap.s]!;
        wrapper.appendChild(el);
      }
      for (const [li, l] of group.entries()) {
        // §07.6 justify: every line but the one that ends the paragraph is spread to the slot.
        // §07.6 justify-min: a line narrower than it (a strip beside a picture, a narrow column) stays ragged.
        const stretch = style.align === "justify" && !(ends && li === group.length - 1) && !(style.justifyMin && l.width < px(style.justifyMin, ctx) - 0.5);
        const el = wrapper.appendChild(lineElement(doc, l, ps.y, block, v.styles, style, ctx, stretch));
        if (continuing.has(l) && style.hyphenMark === "both") {
          // The word's second hyphen, hanging before the line; decoration, not text.
          const hy = doc.createElement("span");
          hy.className = "wmx-hy-lead";
          hy.setAttribute("aria-hidden", "true");
          hy.textContent = "-";
          hy.style.cssText = "position:absolute;right:100%;margin-right:0.06em;user-select:none;";
          el.appendChild(hy);
        }
      }
      frameEl(first.frame).appendChild(wrapper);
    }
    for (const o of ps.objects) frameEl(o.name); // objects with no text of their own still get their box

    for (const r of ps.rules) {
      const block = v.stories[r.story]!.blocks[r.block] as RuleBlock;
      const el = doc.createElement("hr");
      el.className = "wmx-rule";
      el.style.cssText += `left:${r.x}px;top:${r.y - ps.y - r.weight / 2}px;width:${r.width}px;height:0;margin:0;border:0;border-top:${r.weight}px solid ${color(block.rule.color)};`;
      frameEl(r.frame).appendChild(el);
    }
    for (const r of ps.columnRules) {
      const el = doc.createElement("div");
      el.className = "wmx-column-rule";
      el.setAttribute("aria-hidden", "true");
      el.style.cssText += `left:${r.x - 0.5}px;top:${r.y - ps.y}px;height:${r.height}px;`;
      frameEl(r.frame).appendChild(el);
    }
    // Where the story carries on elsewhere (layout's `continues`): a small arrow under the column's
    // last line, against its right edge. Decoration: the reading order is the DOM's.
    for (const c of ps.continues ?? []) {
      const el = doc.createElement("div");
      el.className = "wmx-continues";
      el.setAttribute("aria-hidden", "true");
      el.textContent = "→";
      el.style.cssText += `position:absolute;left:${c.x}px;top:${c.y - ps.y + 4}px;transform:translateX(-100%);font:600 18px/1 system-ui,sans-serif;color:var(--wmx-accent);`;
      frameEl(c.frame).appendChild(el);
    }
    root.appendChild(section);
  }

  // §08.3 snap. The page always uses proximity: `mandatory` applies to the whole scroll
  // container, so one hard scene would trap every flow scene between snap points
  //. A hard scene instead gets scroll-snap-stop: always, so a
  // fling cannot skip past it.
  doc.documentElement.style.scrollSnapType = anySnap === "none" ? "" : "y proximity";

  // §13 reveals: fire once the element is `enterAt` inside the viewport.
  const observers = reveals.map(({ el, reveal }) => {
    el.classList.add("wmx-reveal");
    el.dataset.enter = reveal.enter;
    el.dataset.exit = reveal.exit;
    // Nothing to enter: it starts in place, and only its exit moves it.
    if (reveal.enter === "none") el.classList.add("wmx-in");
    el.style.transitionDuration = `${reveal.durationMs}ms`;
    el.style.transitionDelay = `${reveal.delayMs}ms`;
    el.style.transitionTimingFunction = EASE[reveal.ease];
    const io = new win.IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          el.classList.add("wmx-in");
          if (!reveal.replay) io.disconnect();
        } else if (reveal.replay) el.classList.remove("wmx-in");
      },
      { threshold: Math.min(1, Math.max(0, reveal.enterAt)) },
    );
    // The frame box is the whole scene and paragraph wrappers have no height (their lines are
    // positioned), so observe the first line: the threshold then means the content. An object's
    // `.wmx-frame` has no `.wmx-line` (it holds its box directly as `el`'s first child, also
    // scene-sized via inset:0), so fall back to that box rather than the whole-scene wrapper --
    // otherwise both its enter and exit observers watch the whole scene and exit never visibly plays.
    const target = el.querySelector(".wmx-line") ?? el.firstElementChild ?? el;
    if (reveal.enter !== "none") io.observe(target);
    if (reveal.exit === "none") return [io];
    // §13 exit: plays when the element leaves through the top of the viewport, and undoes when it comes back.
    const out = new win.IntersectionObserver(([e]) => {
      if (e) el.classList.toggle("wmx-out", !e.isIntersecting && e.boundingClientRect.bottom <= 0);
    });
    out.observe(target);
    return [io, out];
  }).flat();

  const playing = videos.map((video) => {
    const io = new win.IntersectionObserver(([e]) => {
      if (e?.isIntersecting) void video.play().catch(() => {});
      else video.pause();
    });
    io.observe(video);
    return io;
  });

  // Design §3: a page away from the viewport waits in its start state, on the side the reader will
  // meet it from; entering plays the turn. The first callback (on observe) sets pages already off-screen.
  const turning = turns.map((section) => {
    const io = new win.IntersectionObserver(([e]) => {
      if (!e) return;
      if (e.isIntersecting) section.classList.remove("wmx-away");
      else {
        section.dataset.from = e.boundingClientRect.top > 0 ? "below" : "above";
        section.classList.add("wmx-away");
      }
    });
    io.observe(section);
    return io;
  });

  const folio = renderFolio(doc, win, pd, rd);
  // Smooth scrolling everywhere; Space glides a page (2026-10-09); a dot for every page screen.
  const kinds = pd.scenes.map((s) => ({ y: s.y, height: s.height, page: s.paged }));
  // Screen pages only where a scene has column bands; then every scene is a stop and has a dot.
  const pages = installPages(win, root, kinds.some((k) => k.page) ? snapStops(kinds, pd.viewport.height) : [], reduce);
  // §10.6: the soundtrack lives across renders, so a resize never restarts the music.
  soundtrack(root, rd, pd);
  // The reader's read assist (2026-10-09): lives across renders like the soundtrack.
  readAssist(root);
  return {
    destroy() {
      for (const io of [...observers, ...playing, ...turning]) io.disconnect();
      folio.destroy();
      pages.destroy();
    },
  };
}

/**
 * §10.5: the running head, in the margin of every scene that shows one, aligned with its grid and
 * scrolling with the page, in the scene's palette; and an optional progress bar fixed to the viewport.
 */
function renderFolio(doc: Document, win: Window, pd: PositionedDocument, rd: ResolvedDocument): RenderHandle {
  doc.querySelectorAll(".wmx-folio, .wmx-progress").forEach((e) => e.remove());
  const v = rd.variants[pd.breakpoint]!;
  const labels: HTMLElement[] = [];
  let progress = false;
  for (const ps of pd.scenes) {
    const scene = v.scenes.find((s) => s.id === ps.name)!;
    // Each scene carries the folio shown over it: a parent's own, or the document's (§10.5).
    const f = scene.folio;
    const section = doc.getElementById(scene.id);
    if (!f || !section) continue;
    progress ||= f.progress;
    // A paged scene repeats it on every screen page, in the same place, so every page has the same
    // head (2026-10-07); any other scene shows it once, at its top or foot.
    const pages = ps.paged ? Math.max(1, Math.round(ps.height / pd.viewport.height)) : 1;
    for (let k = 0; k < pages; k++) {
      const label = doc.createElement("div");
      label.className = "wmx-folio";
      label.setAttribute("aria-hidden", "true");
      label.dataset.pos = f.position;
      const block = v.stories[f.story]!.blocks[0] as ParagraphBlock;
      applyStyle(label, v.styles[block.style]!, { viewport: pd.viewport, grid: ps.grid, pctOf: pd.viewport.width });
      label.textContent = block.runs.map((r) => (r.kind === "break" ? " " : rd.strings[r.s])).join("");
      label.style.color = scene.palette.muted;
      const [vert, side] = f.position.split("-") as ["top" | "bottom" | "margin", "left" | "right"];
      const pageTop = k * pd.viewport.height;
      const pageBottom = ps.paged ? (k + 1) * pd.viewport.height : ps.height;
      // Centred in the top margin (or the bottom one), on the grid's outer edge; `margin` positions
      // sit at the screen's own edge rather than the grid's, a gutter in.
      label.style.top = `${vert === "bottom" ? pageBottom - ps.grid.marginY / 2 : pageTop + ps.grid.marginY / 2}px`;
      label.style.transform = "translateY(-50%)";
      label.style[side] = `${vert === "margin" ? ps.grid.gutter : ps.grid.originX}px`;
      section.appendChild(label);
      labels.push(label);
    }
  }
  const bar = progress ? doc.createElement("div") : null;
  if (!bar) return { destroy: () => labels.forEach((l) => l.remove()) };
  bar.className = "wmx-progress";
  bar.style.width = "100%";
  doc.body.appendChild(bar);
  const update = (): void => {
    const y = win.scrollY + 24;
    const i = pd.scenes.findIndex((s) => y >= s.y && y < s.y + s.height);
    const scene = v.scenes.find((s) => s.id === pd.scenes[Math.max(0, i)]!.name)!;
    bar.style.background = scene.palette.accent;
    bar.style.transform = `scaleX(${Math.min(1, win.scrollY / Math.max(1, pd.height - win.innerHeight))})`;
  };
  update();
  win.addEventListener("scroll", update, { passive: true });
  return {
    destroy() {
      win.removeEventListener("scroll", update);
      labels.forEach((l) => l.remove());
      bar.remove();
    },
  };
}

function lineElement(
  doc: Document,
  l: PositionedLine,
  sceneY: number,
  block: ParagraphBlock,
  styles: Record<string, ResolvedStyle>,
  blockStyle: ResolvedStyle,
  ctx: EvalContext,
  stretch = false,
): HTMLElement {
  const el = doc.createElement("span");
  el.className = "wmx-line";
  // §07.6 hang: hanging punctuation sits outside the slot; the line is justified to the wider box.
  const hung = l.hang ? { ...l, x: l.x - l.hang.left, width: l.width + l.hang.left + l.hang.right } : l;
  el.style.left = `${hung.x}px`;
  el.style.top = `${l.y - sceneY}px`;
  el.style.width = `${hung.width}px`;
  el.style.height = `${l.height}px`;
  el.style.lineHeight = `${l.height}px`;
  // Design §5: a fitted line is set at its fitted size; every run in it scales by the same factor.
  const k = l.size ? l.size / px(blockStyle.size, ctx) : 1;
  const sized = (s: ResolvedStyle): ResolvedStyle => (k === 1 ? s : { ...s, size: { u: "px", n: px(s.size, ctx) * k } });
  // Only the size changes for a fitted line: the `font` shorthand would reset line-height (and
  // font-variant-caps/kerning), already set above.
  if (k !== 1) el.style.fontSize = `${l.size}px`;
  const spacing = stretch ? justifySpacing(hung, l.size ?? px(blockStyle.size, ctx)) : 0;
  if (spacing > 0) el.style.wordSpacing = `${spacing}px`;
  const breaksAtShy = l.text.endsWith(SHY);
  if (breaksAtShy) el.classList.add("wmx-hy"); // the word continues on the next line: no trailing space
  for (const f of l.fragments) el.appendChild(fragmentNode(doc, f.text.replaceAll(SHY, ""), block.runs[f.run], block, styles, blockStyle, ctx, sized));
  if (!breaksAtShy && !/\s$/.test(l.text)) el.appendChild(doc.createTextNode(" "));
  return el;
}

/**
 * One fragment of a line: plain text when it is set in the block's own style
 * with no semantics, otherwise its run's style inside `<strong>`, `<em>`,
 * `<code>` and `<a>` as its marks and link say (§10.2).
 */
function fragmentNode(
  doc: Document,
  text: string,
  run: ParagraphBlock["runs"][number] | undefined,
  block: ParagraphBlock,
  styles: Record<string, ResolvedStyle>,
  blockStyle: ResolvedStyle,
  ctx: EvalContext,
  sized: (s: ResolvedStyle) => ResolvedStyle = (s) => s,
): Node {
  if (!run || run.kind === "break" || (run.kind === "text" && run.style === block.style && run.marks.length === 0 && run.link === null)) {
    return doc.createTextNode(text);
  }
  // A link's underline starts at its first word: spaces at its edges (a line's justified gap) stay
  // outside it, as plain text around the run (2026-10-08).
  if (run.kind === "text" && run.link !== null && /^\s|\s$/.test(text) && text.trim()) {
    const lead = /^\s*/.exec(text)![0];
    const tail = /\s*$/.exec(text)![0];
    const f = doc.createDocumentFragment();
    if (lead) f.appendChild(doc.createTextNode(lead));
    f.appendChild(fragmentNode(doc, text.trim(), run, block, styles, blockStyle, ctx, sized));
    if (tail) f.appendChild(doc.createTextNode(tail));
    return f;
  }
  const inner = doc.createElement("span");
  const style = styles[run.style] ?? blockStyle;
  applyStyle(inner, sized(style), ctx);
  // Layout fixed the line box; a run in a bigger size (a large quote mark, say) must not grow it.
  // The `font` shorthand above reset line-height to normal, which would.
  inner.style.lineHeight = "0";
  inner.textContent = text;
  if (run.kind === "endmark") return inner;
  let node: HTMLElement = inner;
  for (const m of [...run.marks].reverse()) {
    const wrap = doc.createElement(m);
    wrap.appendChild(node);
    node = wrap;
  }
  if (run.link !== null) {
    const a = doc.createElement("a");
    a.href = block.links[run.link]!.href;
    a.style.color = "inherit";
    a.style.textDecoration = "inherit";
    a.appendChild(node);
    node = a;
  }
  return node;
}

/**
 * The visible part of an object: a sidebar's background and border (§11.10),
 * or a figure's image and a video's player placed in the media area, fitted
 * and focused (§11.4, §11.5) and clipped to its shape when `clip` is set.
 * Text (captions included) is set as lines.
 */
function objectBox(
  doc: Document,
  o: ObjectElement,
  placed: { box: { x: number; y: number; width: number; height: number }; media: { x: number; y: number; width: number; height: number } | null; mark?: { text: string; size: number; close?: { text: string; x: number; y: number; size: number } } },
  sceneY: number,
  rd: ResolvedDocument,
  reduce: boolean,
  videos: HTMLVideoElement[],
): HTMLElement {
  const r = placed.media ?? placed.box;
  const place = (el: HTMLElement): HTMLElement => {
    el.style.cssText += `position:absolute;left:${r.x}px;top:${r.y - sceneY}px;width:${r.width}px;height:${r.height}px;`;
    return el;
  };
  if (o.kind === "audio") {
    const el = Object.assign(doc.createElement("audio"), { controls: true, preload: "none" });
    const asset = rd.assets[o.audio];
    if (asset?.kind === "audio") for (const s of asset.sources) el.appendChild(Object.assign(doc.createElement("source"), { src: s.url, type: s.type }));
    const track = o.captions ? rd.assets[o.captions] : undefined;
    if (track?.kind === "file") el.appendChild(Object.assign(doc.createElement("track"), { kind: "captions", src: track.url, default: true }));
    if (o.title !== null) el.setAttribute("aria-label", o.title);
    el.className = "wmx-media";
    return place(el);
  }
  if (o.kind === "embed") {
    const s = o.source;
    const url =
      "url" in s
        ? s.url
        : s.provider === "youtube"
          ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(s.id)}`
          : `https://player.vimeo.com/video/${encodeURIComponent(s.id)}`;
    const frame = (autoplay: boolean): HTMLElement => {
      const f = Object.assign(doc.createElement("iframe"), {
        src: autoplay && s.provider !== "iframe" ? `${url}?autoplay=1` : url,
        title: o.title ?? "",
        loading: "lazy",
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
        allowFullscreen: true,
      });
      f.className = "wmx-embed";
      return place(f);
    };
    if (!o.facade) return frame(false);
    // §11.6 facade: a poster and a play button; the provider's page loads only when asked for.
    const btn = Object.assign(doc.createElement("button"), { type: "button" });
    btn.className = "wmx-facade";
    btn.setAttribute("aria-label", o.title ? `Play: ${o.title}` : "Play");
    const poster = o.poster && ("url" in o.poster ? o.poster.url : (rd.assets[o.poster.asset] as { fallback?: string } | undefined)?.fallback);
    if (poster) btn.style.backgroundImage = `url("${poster}")`;
    btn.addEventListener("click", () => btn.replaceWith(frame(true)), { once: true });
    return place(btn);
  }
  if (o.kind === "gallery") {
    const el = doc.createElement("div");
    el.className = "wmx-gallery";
    el.dataset.layout = o.layout;
    if (o.layout === "strip") el.tabIndex = 0; // a scroll region is reachable by keyboard
    return place(el);
  }
  if (o.kind === "figure" || o.kind === "video") {
    const m = o.media;
    const el =
      o.kind === "figure"
        ? Object.assign(doc.createElement("img"), { loading: o.loading, decoding: "async" })
        : doc.createElement("video");
    const asset = rd.assets[o.kind === "figure" ? o.image : o.video];
    if (el instanceof HTMLImageElement && asset?.kind === "image") {
      el.src = asset.fallback;
      // §13 rule 3 (and §11.4): under reduced motion an animated GIF shows a still.
      if (asset.animated && reduce && o.reveal.motion !== "always") el.addEventListener("load", () => el.replaceWith(still(doc, el)), { once: true });
    }
    if (el instanceof HTMLVideoElement && asset?.kind === "video") {
      for (const s of asset.sources) el.appendChild(Object.assign(doc.createElement("source"), { src: s.url, type: s.type }));
      if (o.kind === "video") {
        const poster = o.poster ? rd.assets[o.poster] : undefined;
        if (poster?.kind === "image") el.poster = poster.fallback;
        el.muted = o.muted;
        el.loop = o.loop;
        el.playsInline = true;
        el.preload = "metadata";
        // §13 rule 3: under reduced motion nothing plays by itself, unless the author forced it.
        const play = reduce && o.reveal.motion !== "always" ? "manual" : o.play;
        el.controls = o.controls || play === "manual";
        if (play === "auto") el.autoplay = true;
        if (play === "visible") videos.push(el);
      }
    }
    // alt: "" marks a decorative image; null means it was missing (a build warning), so none is set.
    if (o.alt !== null) el.setAttribute(el instanceof HTMLImageElement ? "alt" : "aria-label", o.alt);
    if (o.alt === "" && el instanceof HTMLVideoElement) el.setAttribute("aria-hidden", "true");
    el.className = "wmx-media";
    el.style.objectFit = m.fit;
    el.style.objectPosition = `${m.focus.x * 100}% ${m.focus.y * 100}%`;
    if (m.clip) el.style.clipPath = clipFor(m.shape, rd);
    return place(el);
  }
  const el = doc.createElement("div");
  el.className = `wmx-object wmx-${o.kind}`;
  el.dataset.object = o.id;
  if (o.kind === "sidebar") {
    if (o.bg) el.style.background = color(o.bg);
    if (o.border === "rule") el.style.border = "1px solid var(--wmx-rule)";
  }
  if (o.kind === "pullquote") el.setAttribute("role", "note");
  if (placed.mark) {
    // §07.6 mark: decoration only, in the pull quote's first style's face, bold, in the accent.
    const m = doc.createElement("span");
    m.className = "wmx-mark";
    m.setAttribute("aria-hidden", "true");
    m.textContent = placed.mark.text;
    m.style.cssText = `position:absolute;left:-0.04em;top:-0.18em;font-size:${placed.mark.size}px;line-height:1;font-weight:700;color:var(--wmx-accent);`;
    const style = rd.variants[Object.keys(rd.variants)[0]!]?.styles;
    const first = o.kind === "pullquote" ? Object.values(rd.variants).map((v) => v.stories[o.story]?.blocks[0]).find(Boolean) : undefined;
    const family = first?.kind === "paragraph" ? style?.[first.style]?.family : undefined;
    if (family) m.style.fontFamily = family.map((f) => (/^[a-z-]+$/.test(f) ? f : JSON.stringify(f))).join(", ");
    el.appendChild(m);
    const c = placed.mark.close;
    if (c) {
      // The closing mark after the last word, as large as the opening one: layout gives the top of
      // its glyph (level with the last line's capitals), which sits about 0.16em into its line box.
      const closing = m.cloneNode() as HTMLElement;
      closing.textContent = c.text;
      closing.style.left = `${c.x - placed.box.x}px`;
      closing.style.top = `${c.y - placed.box.y - 0.16 * c.size}px`;
      el.appendChild(closing);
    }
  }
  return place(el);
}

/**
 * The frame of an image showing when it loaded (a GIF's first), as a canvas in
 * its place, keeping its box, fit and accessible name.
 */
function still(doc: Document, img: HTMLImageElement): HTMLCanvasElement {
  const c = Object.assign(doc.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
  c.getContext("2d")?.drawImage(img, 0, 0);
  c.className = img.className;
  c.style.cssText = img.style.cssText;
  const alt = img.getAttribute("alt");
  if (alt) c.setAttribute("role", "img"), c.setAttribute("aria-label", alt);
  else c.setAttribute("aria-hidden", "true");
  return c;
}

/** Objects rendered as a <figure>, so a caption is its <figcaption> (§14). */
const FIGURES = new Set(["figure", "video", "embed", "audio", "gallery"]);

/** A CSS clip-path for an object's shape (§12.2); polygons are normalized to the media box. */
function clipFor(shape: Extract<ObjectElement, { media: unknown }>["media"]["shape"], rd: ResolvedDocument): string {
  if (shape.kind === "circle") return "circle(50%)";
  if (shape.kind === "ellipse") return "ellipse(50% 50% at 50% 50%)";
  if (shape.kind === "polygon") {
    const a = rd.assets[shape.polygon];
    if (a?.kind === "polygon") return `polygon(${a.points.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(", ")})`;
  }
  return "none";
}

/**
 * §07.6 `justify`: how much to add to each space so the line fills its slot. The slack is what
 * layout measured the line without; `white-space: pre` stops the browser justifying on its own, so
 * the renderer does the arithmetic itself. Zero when there is no slack or nowhere to put it (a
 * single long word, or a line already at its slot's width). Given the text's `size`, a line that
 * would open its spaces by more than half an em is set flush left instead (2026-09-30: a sliver
 * beside a picture, two words to a line, justified into rivers). A line a little longer than its
 * slot (the paragraph composer's, §07.6 composer=paragraph) closes its spaces instead, by up to a
 * twentieth of an em each (about a fifth of a space); a line longer than that is left alone.
 */
export function justifySpacing(l: Pick<PositionedLine, "text" | "width" | "measured">, size = Number.POSITIVE_INFINITY): number {
  const spaces = (l.text.trimEnd().match(/ /g) ?? []).length;
  const slack = l.width - l.measured;
  const each = spaces > 0 ? slack / spaces : 0;
  if (each < 0) return -each <= SHRINK * size + 0.01 ? each : 0;
  return each > size / 2 ? 0 : each;
}

/** The most a justified line's spaces close, in em: a fifth of Georgia's space (0.24em). Layout's composer uses the same. */
export const SHRINK = 0.05;

/** Consecutive lines of the same block in the same frame form one semantic element. */
function paragraphs(lines: readonly PositionedLine[]): PositionedLine[][] {
  const out: PositionedLine[][] = [];
  for (const l of lines) {
    const cur = out.at(-1);
    const prev = cur?.at(-1);
    if (cur && prev && prev.story === l.story && prev.block === l.block && prev.frame === l.frame) cur.push(l);
    else out.push([l]);
  }
  return out;
}

/** Spec §14: headline is h1, subhead h2/h3, cite is cite; everything else is a paragraph. */
function tagFor(b: ParagraphBlock): string {
  if (b.element === "headline") return "h1";
  if (b.element === "caption") return "figcaption";
  if (b.element === "subhead") return b.level === 2 ? "h3" : "h2";
  return "p";
}

function applyStyle(el: HTMLElement, s: ResolvedStyle, ctx: EvalContext): void {
  el.style.font = cssFont(engineFont(s, ctx));
  el.style.letterSpacing = `${px(s.tracking, ctx)}px`;
  el.style.color = color(s.color);
  // `justify` is done per line in `lineElement` (the browser cannot justify a `white-space: pre` line).
  el.style.textAlign = s.align === "justify" ? "left" : s.align;
  el.style.fontFeatureSettings = s.features.map((f) => `"${f}" 1`).join(", ") || "normal";
  // Laid-out lines are already case-transformed by layout (they were measured that way); this
  // covers text the renderer sets itself, such as the folio.
  if (s.case === "upper" || s.case === "lower") el.style.textTransform = s.case === "upper" ? "uppercase" : "lowercase";
  if (s.case === "small-caps") el.style.fontVariantCaps = "small-caps";
  if (s.underline) el.style.textDecoration = "underline";
}

const color = (c: Color): string => ("role" in c ? `var(--wmx-${c.role})` : c.hex);

function installCss(doc: Document): void {
  if (doc.getElementById("wmx-css")) return;
  const style = doc.createElement("style");
  style.id = "wmx-css";
  style.textContent = CSS;
  doc.head.appendChild(style);
}
