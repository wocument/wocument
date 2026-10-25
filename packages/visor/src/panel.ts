/**
 * The visor's side panel and hover cards (design 2026-10-21): what they list and say, from the
 * model only. Pure: no DOM.
 */

import type { Decision, PositionedDocument } from "@wocument/layout";
import { screenPoints, snapStops } from "@wocument/renderer";
import { describe, round } from "./dictionary.js";
import type { Layer, ScreenModel } from "./model.js";

export const LAYER_OF: Record<Decision["kind"], Layer> = { "column-end": "flow", picture: "pictures", space: "space", line: "lines" };
export const LAYER_NAME: Record<Layer, string> = { flow: "Text flow", pictures: "Pictures", space: "Grid and space", lines: "Lines and words" };

/** The screen's decisions in the layers that are on, in the order the engine made them. */
export function panelEntries(s: ScreenModel, layers?: ReadonlySet<Layer>): { index: number; layer: Layer; title: string; detail: string }[] {
  return s.decisions.flatMap((d, index) => {
    const layer = LAYER_OF[d.kind];
    if (layers && !layers.has(layer)) return [];
    const { title, body } = describe(d);
    return [{ index, layer, title, detail: body }];
  });
}

/** A hover card: the layer, what happened and why, the numbers (rounded) and the spec rule. */
export function cardOf(d: Decision): { layer: Layer; kind: string; title: string; body: string; numbers: [string, string][]; rule: string } {
  const layer = LAYER_OF[d.kind];
  return { layer, kind: LAYER_NAME[layer], ...describe(d), numbers: Object.entries(d.numbers).map(([k, v]) => [k, String(round(k, v))]) };
}

/** The index of the screen that holds document y `y` (the viewport's centre), or the nearest one. */
export function currentScreen(models: readonly ScreenModel[], y: number): number {
  const inside = models.findIndex((m) => y >= m.top && y < m.top + m.height);
  if (inside >= 0) return inside;
  let best = 0;
  let far = Infinity;
  models.forEach((m, i) => {
    const d = Math.min(Math.abs(y - m.top), Math.abs(y - (m.top + m.height)));
    if (d < far) (far = d), (best = i);
  });
  return best;
}

/** The renderer's screen dots that stand for screens `from`–`to` (1-based across the document), as the renderer builds them. */
export function dotsOf(pd: PositionedDocument, from: number, to: number): number[] {
  const vh = pd.viewport.height;
  const kinds = pd.scenes.map((s) => ({ y: s.y, height: s.height, page: s.paged }));
  const stops = snapStops(kinds, vh);
  const end = stops.at(-1) ?? 0;
  const out = new Set<number>();
  for (const top of screenPoints(kinds, vh)) {
    const n = Math.floor((top + 1e-6) / vh) + 1;
    if (n >= from && n <= to) out.add(stops.indexOf(Math.min(top, end)));
  }
  return [...out].sort((a, b) => a - b);
}
