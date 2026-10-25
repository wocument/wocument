/**
 * A page that shows a Resolved Document (spec §15.1 stages 4-5): wait for the
 * fonts, prepare, lay out, render; lay out again when the window resizes. This
 * is what a built page, the dev server and the editor's preview all run.
 *
 * The viewport is the root's document width without a vertical scrollbar
 * (so the grid never causes horizontal scroll) by the small viewport height
 * (spec §06.3: `vh` means `svh`), read from a probe element.
 */

import { layout, type PositionedDocument } from "@wocument/layout";
import type { ResolvedDocument } from "@wocument/resolved-document";
import { PrepareCache, createPretextEngine } from "@wocument/text-engine";
import { type RenderHandle, type RenderOptions, loadFonts, render } from "./index.js";

export type MountOptions = RenderOptions & {
  /** Lay out with the decision log (`PositionedDocument.explain`), for a debugger such as the visor. */
  explain?: boolean;
  /** After every layout and render: a new document, a resize, `relayout()`. */
  onLayout?(pd: PositionedDocument, rd: ResolvedDocument): void;
  /** An error from a layout that a resize started; `show()` and `relayout()` throw instead. */
  onError?(e: unknown): void;
  /** Runs each phase; a host can time or count it. The default runs it. */
  phase?<T>(name: "prepare" | "layout", run: () => T): T;
};

export type Mounted = {
  /** Shows a document: waits for its fonts, then lays it out and renders it. */
  show(rd: ResolvedDocument): Promise<void>;
  /** Lays out and renders the current document again. */
  relayout(): void;
  /** Turns the decision log on or off, and lays out again. */
  setExplain(on: boolean): void;
  /** Removes the page, the probe and the listeners. */
  destroy(): void;
};

export function mount(root: HTMLElement, options: MountOptions = {}): Mounted {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const phase = options.phase ?? (<T>(_: string, run: () => T): T => run());
  const probe = doc.body.appendChild(doc.createElement("div"));
  probe.style.cssText = "position:fixed;top:0;height:100svh;width:0;visibility:hidden;pointer-events:none";

  let rd: ResolvedDocument | null = null;
  // Limit: one cache per language for the page's life; a long editing session grows it by one entry per edited paragraph.
  let cache: PrepareCache | null = null;
  let lang = "";
  let handle: RenderHandle | null = null;
  let explain = options.explain ?? false;

  const relayout = (): void => {
    if (!rd || !cache) return;
    const viewport = { width: doc.documentElement.clientWidth, height: probe.getBoundingClientRect().height };
    const pd = phase("layout", () => layout(rd!, viewport, cache!, { explain }));
    handle?.destroy();
    handle = render(root, pd, rd, { reduceMotion: options.reduceMotion });
    options.onLayout?.(pd, rd);
  };

  let frame = 0;
  const resize = (): void => {
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => {
      try {
        relayout();
      } catch (e) {
        if (options.onError) options.onError(e);
        else throw e;
      }
    });
  };
  win.addEventListener("resize", resize);

  return {
    async show(next) {
      // §07.1: layout MUST NOT run before the fonts it uses have loaded (or failed, and fallen back).
      const fonts = await loadFonts(next, doc);
      if (fonts.failed.length) console.warn(`fonts not found, falling back: ${fonts.failed.join(", ")}`);
      if (next.meta.lang !== lang) {
        // Prepare runs lazily inside layout (through the cache), so it is marked as its own phase.
        const engine = createPretextEngine(next.meta.lang);
        cache = new PrepareCache({ ...engine, prepare: (t, f) => phase("prepare", () => engine.prepare(t, f)) });
        lang = next.meta.lang;
      }
      rd = next;
      relayout();
    },
    relayout,
    setExplain(on) {
      if (on === explain) return;
      explain = on;
      relayout();
    },
    destroy() {
      win.cancelAnimationFrame(frame);
      win.removeEventListener("resize", resize);
      handle?.destroy();
      handle = null;
      probe.remove();
      root.textContent = "";
    },
  };
}
