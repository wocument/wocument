/**
 * The visor's side panel and hover cards (design 2026-10-21): what they list and say, from the
 * model only. Pure: no DOM.
 */

import type { Decision, PositionedDocument } from "@wmxdsl/layout";
import { describe, round } from "./dictionary.js";
import type { Layer, ScreenModel } from "./model.js";

export const LAYER_OF: Record<Decision["kind"], Layer> = { "column-end": "flow", picture: "pictures", space: "space", line: "lines" };
export const LAYER_NAME: Record<Layer, string> = { flow: "Text flow", pictures: "Pictures", space: "Grid and space", lines: "Lines and words" };

/** The screen's decisions, in the order the engine made them. */
export function panelEntries(s: ScreenModel): { index: number; layer: Layer; title: string; detail: string }[] {
  return s.decisions.map((d, index) => {
    const { title, body } = describe(d);
    return { index, layer: LAYER_OF[d.kind], title, detail: body };
  });
}

/** A hover card: the layer, what happened and why, the numbers (rounded) and the spec rule. */
export function cardOf(d: Decision): { layer: Layer; kind: string; title: string; body: string; numbers: [string, string][]; rule: string } {
  const layer = LAYER_OF[d.kind];
  return { layer, kind: LAYER_NAME[layer], ...describe(d), numbers: Object.entries(d.numbers).map(([k, v]) => [k, String(round(k, v))]) };
}

/** The index of the screen that holds document y `y` (the viewport's centre), or the nearest one. */
export function currentScreen(models: readonly ScreenModel[], y: number): number {
  let best = 0;
  let far = Infinity;
  models.forEach((m, i) => {
    const d = y < m.top ? m.top - y : y >= m.top + m.height ? y - (m.top + m.height) : 0;
    if (d < far) (far = d), (best = i);
  });
  return best;
}

/**
 * The renderer's screen dots that stand for screens `from`–`to` (1-based across the document).
 * ponytail: mirrors the renderer's snapStops (every page screen's top, every other scene's top, the
 * end) so the visor needs no renderer import; if snapStops changes, change this too.
 */
export function dotsOf(pd: PositionedDocument, from: number, to: number): number[] {
  const vh = pd.viewport.height;
  const last = pd.scenes.at(-1);
  const end = last ? Math.max(0, last.y + last.height - vh) : 0;
  const tops = pd.scenes.flatMap((s) => (s.paged ? Array.from({ length: Math.max(1, Math.round(s.height / vh)) }, (_, k) => s.y + k * vh) : []));
  const stops = [...new Set([...tops, ...pd.scenes.filter((s) => !s.paged).map((s) => s.y), end].map((y) => Math.min(y, end)))].sort((a, b) => a - b);
  const out = new Set<number>();
  for (const top of tops) {
    const n = Math.floor((top + 1e-6) / vh) + 1;
    if (n >= from && n <= to) out.add(stops.indexOf(Math.min(top, end)));
  }
  return [...out].sort((a, b) => a - b);
}
