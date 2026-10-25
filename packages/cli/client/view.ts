/**
 * The renderer's page (`mount`) with the visor on top: the `V` key turns it
 * on and off, and it mounts on the page after every layout. Shared by the
 * editor's preview and the page view.
 */
import { mount } from "@wocument/renderer";
import type { ResolvedDocument } from "@wocument/resolved-document";
import { type Layer, mountVisor } from "@wocument/visor";

export type View = { show(rd: ResolvedDocument): Promise<void> };

/** Typing in a field never toggles the visor. */
const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function createView(root: HTMLElement, options: { reduceMotion?: boolean; onError(e: unknown): void }): View {
  let visorOn = false;
  let visor: { destroy(): void } | null = null;
  // The visor's layers and panel survive the remount after every layout.
  let visorState: { layers?: Layer[]; open?: boolean } = {};

  const page = mount(root, {
    reduceMotion: options.reduceMotion,
    onError: options.onError,
    // The visor draws one layout's coordinates, so every layout destroys it and mounts a fresh one.
    onLayout(pd) {
      visor?.destroy();
      visor = visorOn && pd.explain ? mountVisor(root, pd, pd.explain, { ...visorState, onChange: (st) => (visorState = st) }) : null;
    },
  });

  addEventListener("keydown", (e) => {
    // toLowerCase: with Caps Lock on, the key is "V" without Shift.
    if (e.key.toLowerCase() !== "v" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || typing(e.target)) return;
    try {
      visorOn = !visorOn;
      // With the visor off, layout runs without the decision log and nothing is mounted: no cost.
      page.setExplain(visorOn);
    } catch (err) {
      options.onError(err);
    }
  });

  return { show: page.show };
}
