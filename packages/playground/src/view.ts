/**
 * The browser half (spec §15.1 stages 4-5) as something to show documents in:
 * wait for fonts, prepare, lay out, render; lay out again on resize. Shared by
 * the playground page and the editor's live preview.
 */
import { counter } from "./purity.js";
import { layout } from "@wmxdsl/layout";
import { type RenderHandle, loadFonts, render } from "@wmxdsl/renderer";
import type { ResolvedDocument } from "@wmxdsl/resolved-document";
import { PrepareCache, createPretextEngine } from "@wmxdsl/text-engine";

export type View = { show(rd: ResolvedDocument): Promise<void> };

export function createView(root: HTMLElement, svh: HTMLElement, options: { reduceMotion?: boolean; onError(e: unknown): void }): View {
  let rd: ResolvedDocument | null = null;
  // Limit: one cache for the page's life; a long editing session grows it by one entry per edited paragraph.
  let cache: PrepareCache | null = null;
  let lang = "";
  let handle: RenderHandle | null = null;

  const run = (): void => {
    if (!rd || !cache) return;
    // clientWidth excludes a vertical scrollbar, so the grid never causes horizontal scroll.
    const viewport = { width: document.documentElement.clientWidth, height: svh.getBoundingClientRect().height };
    const pd = counter.during("layout", () => layout(rd!, viewport, cache!));
    handle?.destroy();
    handle = render(root, pd, rd, { reduceMotion: options.reduceMotion });
    Object.assign(window, { __wmx: { rd, pd, cache, counter, run } });
  };

  let frame = 0;
  addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      try {
        run();
      } catch (e) {
        options.onError(e);
      }
    });
  });

  return {
    async show(next) {
      // §07.1: layout MUST NOT run before the fonts it uses have loaded (or failed, and fallen back).
      const fonts = await loadFonts(next);
      if (fonts.failed.length) console.warn(`fonts not found, falling back: ${fonts.failed.join(", ")}`);
      if (next.meta.lang !== lang) {
        // Prepare runs lazily inside layout (through the cache), so it is marked as its own phase.
        const engine = createPretextEngine(next.meta.lang);
        cache = new PrepareCache({ ...engine, prepare: (t, f) => counter.during("prepare", () => engine.prepare(t, f)) });
        lang = next.meta.lang;
      }
      rd = next;
      run();
    },
  };
}
