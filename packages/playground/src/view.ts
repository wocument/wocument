/**
 * The renderer's page (`mount`) with the playground's tools on top: the `V` key
 * toggles the visor, which mounts on the page after every layout, and the
 * purity counter times prepare and layout. Shared by the playground page and
 * the editor's live preview.
 */
import { counter } from "./purity.js";
import { mount } from "@wocument/renderer";
import type { ResolvedDocument } from "@wocument/resolved-document";
import { type Layer, mountVisor } from "@wocument/visor";

export type View = { show(rd: ResolvedDocument): Promise<void>; setVisor(on: boolean): void };

/** Typing in a field never toggles the visor. */
const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** `_svh` is unused: the page measures the small viewport height itself. Kept until the playground becomes `woc dev`. */
export function createView(root: HTMLElement, _svh: HTMLElement, options: { reduceMotion?: boolean; onError(e: unknown): void }): View {
  let visorOn = false;
  let visor: { destroy(): void } | null = null;
  // The visor's layers and panel survive the remount after every layout.
  let visorState: { layers?: Layer[]; open?: boolean } = {};

  const page = mount(root, {
    reduceMotion: options.reduceMotion,
    onError: options.onError,
    phase: (name, run) => counter.during(name, run),
    // The visor draws one layout's coordinates, so every layout destroys it and mounts a fresh one.
    onLayout(pd, rd) {
      visor?.destroy();
      visor = visorOn && pd.explain ? mountVisor(root, pd, pd.explain, { ...visorState, onChange: (st) => (visorState = st) }) : null;
      Object.assign(window, { __woc: { rd, pd, counter, run: page.relayout, visor: visorOn, setVisor } });
    },
  });

  const setVisor = (on: boolean): void => {
    if (on === visorOn) return;
    visorOn = on;
    // With the visor off, layout runs without `explain` and nothing is mounted: no cost.
    page.setExplain(on);
  };

  addEventListener("keydown", (e) => {
    if (e.key !== "v" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || typing(e.target)) return;
    try {
      setVisor(!visorOn);
    } catch (err) {
      options.onError(err);
    }
  });

  return { show: page.show, setVisor };
}
