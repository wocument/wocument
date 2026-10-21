/**
 * The visor overlay (design 2026-10-21): draws the model over the rendered page inside `root`
 * (the renderer's `.wmx-doc`), from layout coordinates only. It builds the screens that meet the
 * window and rebuilds on scroll, once per animation frame.
 */

import type { Explanation, PositionedDocument } from "@wmxdsl/layout";
import { type Layer, type ScreenModel, type Shape, buildModel } from "./model.js";

/** One strong colour per layer, readable on light and dark scenes; tints are this colour at low alpha. */
export const PALETTE: Record<Layer, string> = { flow: "#7c3aed", pictures: "#0d9488", space: "#d97706", lines: "#e11d48" };
const ALL: Layer[] = ["flow", "pictures", "space", "lines"];
const FONT = "600 10px/1.4 system-ui, sans-serif";

export function mountVisor(root: HTMLElement, pd: PositionedDocument, explain: Explanation, options: { layers?: Layer[] } = {}): { setLayers(l: Layer[]): void; destroy(): void } {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const models = buildModel(pd, explain);
  let layers = new Set(options.layers ?? ALL);
  const overlay = doc.createElement("div");
  overlay.className = "wmx-visor";
  overlay.style.cssText = `position:absolute;left:0;top:0;width:100%;height:${pd.height}px;pointer-events:none;z-index:2147483000;`;
  root.appendChild(overlay);
  const drawn = new Map<number, HTMLElement>();

  const update = (): void => {
    // The window's span in document px: where the root sits, not where anything inside it was set.
    const top = -root.getBoundingClientRect().top;
    const bottom = top + win.innerHeight;
    models.forEach((m, i) => {
      const visible = m.top < bottom && m.top + m.height > top;
      const el = drawn.get(i);
      if (visible && !el) drawn.set(i, overlay.appendChild(drawScreen(doc, m, i, layers)));
      else if (!visible && el) el.remove(), drawn.delete(i);
    });
  };
  let frame = 0;
  const schedule = (): void => {
    if (!frame) frame = win.requestAnimationFrame(() => ((frame = 0), update()));
  };
  win.addEventListener("scroll", schedule, { capture: true, passive: true });
  win.addEventListener("resize", schedule);
  update();

  return {
    setLayers(l) {
      layers = new Set(l);
      for (const el of drawn.values()) el.remove();
      drawn.clear();
      update();
    },
    destroy() {
      if (frame) win.cancelAnimationFrame(frame);
      win.removeEventListener("scroll", schedule, { capture: true });
      win.removeEventListener("resize", schedule);
      overlay.remove();
      drawn.clear();
    },
  };
}

function drawScreen(doc: Document, m: ScreenModel, index: number, layers: Set<Layer>): HTMLElement {
  const el = doc.createElement("div");
  el.className = "wmx-visor-screen";
  el.dataset.screen = String(index);
  for (const s of m.shapes) if (layers.has(s.layer)) el.appendChild(drawShape(doc, s));
  return el;
}

function drawShape(doc: Document, s: Shape): HTMLElement {
  const c = PALETTE[s.layer];
  const el = doc.createElement("div");
  el.className = `wmx-visor-${s.kind}`;
  if (s.decision !== undefined) el.dataset.decision = String(s.decision);
  const box = `position:absolute;left:${s.x}px;top:${s.y}px;width:${s.width}px;height:${s.height}px;box-sizing:border-box;`;
  const tag = (text: string, css: string): void => {
    const t = el.appendChild(doc.createElement("span"));
    t.textContent = text;
    t.style.cssText = `position:absolute;${css}font:${FONT};color:#fff;background:${c};padding:0 4px;border-radius:3px;white-space:nowrap;`;
  };
  switch (s.kind) {
    case "column-tint":
      el.style.cssText = box + `background:${c}14;`;
      break;
    case "baseline":
      el.style.cssText = box + `height:0;border-top:1px solid ${c}55;`;
      break;
    case "bottom-line":
      el.style.cssText = box + `height:0;border-top:1px dashed ${c};`;
      break;
    case "gap":
      el.style.cssText = box + `background:${c}40;outline:1px solid ${c};`;
      if (s.label) tag(s.label, "left:50%;top:50%;transform:translate(-50%,-50%);");
      break;
    case "marker":
      el.style.cssText =
        box + (s.ringed ? `border:2px solid ${c};border-radius:50%;background:#fff;color:${c};font:${FONT};font-size:9px;line-height:${s.height - 4}px;text-align:center;` : `transform:scale(0.5);border-radius:50%;background:${c};`);
      if (s.number !== undefined) el.textContent = String(s.number);
      break;
    case "outline":
      el.style.cssText = box + `border:2px solid ${c};`;
      if (s.label) tag(s.label, "left:-2px;bottom:100%;");
      break;
    case "badge":
      el.style.cssText = box;
      if (s.label) tag(s.label, "left:4px;top:4px;");
      break;
    case "anchor-link": {
      const length = Math.hypot(s.width, s.height);
      el.style.cssText = `position:absolute;left:${s.x}px;top:${s.y}px;width:${length}px;height:0;border-top:1px solid ${c};transform-origin:0 0;transform:rotate(${Math.atan2(s.height, s.width)}rad);`;
      break;
    }
    case "line-mark":
      el.style.cssText = box + `background:${c}1f;border-left:3px solid ${c};`;
      if (s.label) tag(s.label, "left:100%;top:50%;transform:translate(4px,-50%);");
      break;
  }
  return el;
}
