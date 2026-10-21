/**
 * The visor overlay (design 2026-10-21): draws the model over the rendered page inside `root`
 * (the renderer's `.wmx-doc`), from layout coordinates only. It builds the screens that meet the
 * window and rebuilds on scroll, once per animation frame. Decision shapes take the pointer: hover
 * shows a card, a click selects the decision in the side panel, which lists the screen nearest the
 * window's centre. Everything else lets the pointer through to the page.
 */

import type { Decision, Explanation, PositionedDocument } from "@wmxdsl/layout";
import { DEFAULT_LAYERS, type Layer, type ScreenModel, type Shape, buildModel } from "./model.js";
import { cardOf, currentScreen, dotsOf, LAYER_NAME, panelEntries } from "./panel.js";

/** One strong colour per layer, readable on light and dark scenes; tints are this colour at low alpha. */
export const PALETTE: Record<Layer, string> = { flow: "#7c3aed", pictures: "#0d9488", space: "#d97706", lines: "#e11d48" };
const FONT = "600 10px/1.4 system-ui, sans-serif";

/** The panel and the cards: a quiet surface with hairline borders, light or dark with the system. */
const CSS = `
.wmx-visor-ui { --vs-bg: #fff; --vs-fg: #1c1c1e; --vs-muted: #6b6b70; --vs-line: rgba(0,0,0,.14); --vs-sel: rgba(0,0,0,.06);
  --vs-flow: ${PALETTE.flow}; --vs-pictures: ${PALETTE.pictures}; --vs-space: ${PALETTE.space}; --vs-lines: ${PALETTE.lines};
  position: fixed; inset: 0; pointer-events: none; z-index: 2147483001; font: 12px/1.45 system-ui, sans-serif; color: var(--vs-fg); }
@media (prefers-color-scheme: dark) { .wmx-visor-ui { --vs-bg: #1c1c1e; --vs-fg: #f2f2f2; --vs-muted: #a0a0a6; --vs-line: rgba(255,255,255,.16); --vs-sel: rgba(255,255,255,.08);
  --vs-flow: #a78bfa; --vs-pictures: #2dd4bf; --vs-space: #fbbf24; --vs-lines: #fb7185; } }
.wmx-visor-ui button { all: unset; box-sizing: border-box; cursor: pointer; }
.wmx-visor-ui button:focus-visible { outline: 2px solid var(--vs-fg); outline-offset: 1px; }
.wmx-visor-panel { position: fixed; top: 12px; right: 40px; bottom: 12px; width: 280px; display: flex; flex-direction: column; pointer-events: auto;
  background: var(--vs-bg); border: 1px solid var(--vs-line); border-radius: 6px; overflow: hidden; }
.wmx-visor-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--vs-line); font-weight: 600; }
.wmx-visor-small { padding: 2px 8px; border: 1px solid var(--vs-line); border-radius: 4px; font-weight: 400; color: var(--vs-muted); }
.wmx-visor-open { position: fixed; top: 12px; right: 40px; pointer-events: auto; background: var(--vs-bg); color: var(--vs-fg); }
.wmx-visor-list { list-style: none; margin: 0; padding: 4px; overflow: auto; flex: 1; }
.wmx-visor-entry { display: block; width: 100%; padding: 6px; border-radius: 4px; }
.wmx-visor-entry:hover, .wmx-visor-entry[aria-pressed="true"] { background: var(--vs-sel); }
.wmx-visor-kind { display: block; font-size: 10px; font-weight: 600; letter-spacing: .02em; }
.wmx-visor-title { display: block; font-weight: 600; }
.wmx-visor-detail, .wmx-visor-rule, .wmx-visor-none { display: block; color: var(--vs-muted); }
.wmx-visor-none { padding: 6px; }
.wmx-visor-card { position: fixed; max-width: 260px; padding: 8px 10px; background: var(--vs-bg); border: 1px solid var(--vs-line); border-radius: 4px; }
.wmx-visor-card dl { display: grid; grid-template-columns: auto 1fr; gap: 0 8px; margin: 4px 0; font-variant-numeric: tabular-nums; }
.wmx-visor-card dt { color: var(--vs-muted); } .wmx-visor-card dd { margin: 0; }
.wmx-visor-on { outline: 2px solid var(--c); outline-offset: 3px; }
.wmx-visor-dot { position: fixed; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; background: ${PALETTE.pictures}55; border: 1px solid ${PALETTE.pictures}; box-sizing: border-box; }
`;

export function mountVisor(root: HTMLElement, pd: PositionedDocument, explain: Explanation, options: { layers?: Layer[] } = {}): { setLayers(l: Layer[]): void; destroy(): void } {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const models = buildModel(pd, explain);
  let layers = new Set(options.layers ?? DEFAULT_LAYERS);
  const overlay = doc.createElement("div");
  overlay.className = "wmx-visor";
  overlay.style.cssText = `position:absolute;left:0;top:0;width:100%;height:${pd.height}px;pointer-events:none;z-index:2147483000;`;
  root.appendChild(overlay);
  const drawn = new Map<number, HTMLElement>();

  // The panel, the hover card and the dot marks: fixed to the window, removed with the overlay.
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
    const e = parent.appendChild(doc.createElement(tag));
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const ui = el("div", "wmx-visor-ui", root);
  el("style", "", ui, CSS);
  const panel = el("aside", "wmx-visor-panel", ui);
  panel.setAttribute("aria-label", "Layout decisions");
  const head = el("div", "wmx-visor-head", panel);
  const heading = el("span", "", head);
  const hide = el("button", "wmx-visor-small", head, "Hide");
  const list = el("ol", "wmx-visor-list", panel);
  const open = el("button", "wmx-visor-open wmx-visor-small", ui, "Decisions");
  open.style.display = "none";
  hide.addEventListener("click", () => ((panel.style.display = "none"), (open.style.display = "")));
  open.addEventListener("click", () => ((panel.style.display = ""), (open.style.display = "none")));
  const card = el("div", "wmx-visor-card", ui);
  card.style.display = "none";
  const dots = el("div", "", ui);

  let shown = -1; // the screen the panel lists
  let selected: { screen: number; decision: number } | null = null;

  const renderPanel = (): void => {
    const m = models[shown]!;
    heading.textContent = `${m.screen === null ? `Scene ${m.scene}` : `Screen ${m.screen}`} · ${m.decisions.length} decision${m.decisions.length === 1 ? "" : "s"}`;
    list.replaceChildren();
    if (m.decisions.length === 0) el("li", "wmx-visor-none", list, "No decisions on this screen.");
    for (const e of panelEntries(m)) {
      const b = el("button", "wmx-visor-entry", el("li", "", list));
      b.dataset.decision = String(e.index);
      el("span", "wmx-visor-kind", b, LAYER_NAME[e.layer]).style.color = `var(--vs-${e.layer})`;
      el("span", "wmx-visor-title", b, e.title);
      el("span", "wmx-visor-detail", b, e.detail);
      b.addEventListener("click", () => select(shown, e.index, true));
    }
    markEntry();
  };
  const markEntry = (): void => {
    list.querySelectorAll<HTMLElement>(".wmx-visor-entry").forEach((b) => b.setAttribute("aria-pressed", String(selected?.screen === shown && b.dataset.decision === String(selected.decision))));
  };
  const shapesOf = (s: { screen: number; decision: number }): HTMLElement[] => Array.from(drawn.get(s.screen)?.querySelectorAll<HTMLElement>(`[data-decision="${s.decision}"]`) ?? []);
  /** The selection on the page, and a picture's window in the renderer's screen dots. */
  const showSelection = (): void => {
    overlay.querySelectorAll(".wmx-visor-on").forEach((e) => e.classList.remove("wmx-visor-on"));
    if (selected) for (const e of shapesOf(selected)) e.classList.add("wmx-visor-on");
    dots.replaceChildren();
    const d = selected && models[selected.screen]!.decisions[selected.decision];
    if (d?.kind !== "picture" || d.numbers.windowFrom === undefined) return;
    const buttons = doc.querySelectorAll(".wmx-dots button");
    for (const i of dotsOf(pd, d.numbers.windowFrom, d.numbers.windowTo ?? d.numbers.windowFrom)) {
      const r = buttons[i]?.getBoundingClientRect();
      if (r) el("div", "wmx-visor-dot", dots).style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;`;
    }
  };
  const select = (screen: number, decision: number, fromPanel: boolean): void => {
    selected = selected?.screen === screen && selected.decision === decision ? null : { screen, decision };
    if (screen !== shown) (shown = screen), renderPanel();
    else markEntry();
    showSelection();
    if (!selected) return;
    if (fromPanel) shapesOf(selected)[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
    else list.querySelector(`[data-decision="${decision}"]`)?.scrollIntoView({ block: "nearest" });
  };

  // Hover cards and clicks on the decision shapes.
  const target = (e: Event): { screen: number; decision: number; el: HTMLElement } | null => {
    const s = (e.target as Element | null)?.closest?.<HTMLElement>("[data-decision]");
    const screen = s?.closest<HTMLElement>("[data-screen]");
    return s && screen ? { screen: Number(screen.dataset.screen), decision: Number(s.dataset.decision), el: s } : null;
  };
  const over = (e: PointerEvent): void => {
    const t = target(e);
    if (t) showCard(models[t.screen]!.decisions[t.decision]!);
  };
  const move = (e: PointerEvent): void => {
    if (card.style.display === "none") return;
    const x = Math.min(e.clientX + 14, win.innerWidth - card.offsetWidth - 8);
    const y = e.clientY + 14 + card.offsetHeight > win.innerHeight ? e.clientY - 14 - card.offsetHeight : e.clientY + 14;
    card.style.left = `${Math.max(8, x)}px`;
    card.style.top = `${Math.max(8, y)}px`;
  };
  const out = (e: PointerEvent): void => {
    const t = target(e);
    if (t && !t.el.contains(e.relatedTarget as Node | null)) card.style.display = "none";
  };
  const click = (e: MouseEvent): void => {
    const t = target(e);
    if (t) select(t.screen, t.decision, false);
  };
  const showCard = (d: Decision): void => {
    const c = cardOf(d);
    card.replaceChildren();
    el("span", "wmx-visor-kind", card, c.kind).style.color = `var(--vs-${c.layer})`;
    el("span", "wmx-visor-title", card, c.title);
    el("span", "", card, c.body);
    if (c.numbers.length) {
      const dl = el("dl", "", card);
      for (const [k, v] of c.numbers) el("dt", "", dl, k), el("dd", "", dl, v);
    }
    el("span", "wmx-visor-rule", card, c.rule);
    card.style.display = "";
  };
  overlay.addEventListener("pointerover", over);
  overlay.addEventListener("pointerout", out);
  overlay.addEventListener("click", click);
  win.addEventListener("pointermove", move, { passive: true });

  const update = (): void => {
    // The window's span in document px: where the root sits, not where anything inside it was set.
    const top = -root.getBoundingClientRect().top;
    const bottom = top + win.innerHeight;
    models.forEach((m, i) => {
      const visible = m.top < bottom && m.top + m.height > top;
      const on = drawn.get(i);
      if (visible && !on) drawn.set(i, overlay.appendChild(drawScreen(doc, m, i, layers)));
      else if (!visible && on) on.remove(), drawn.delete(i);
    });
    const now = currentScreen(models, top + win.innerHeight / 2);
    if (now !== shown) (shown = now), renderPanel();
    showSelection();
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
      card.style.display = "none";
      update();
    },
    destroy() {
      if (frame) win.cancelAnimationFrame(frame);
      win.removeEventListener("scroll", schedule, { capture: true });
      win.removeEventListener("resize", schedule);
      win.removeEventListener("pointermove", move);
      overlay.remove();
      ui.remove();
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
      // A faint wash over the line and a small dot just outside its left edge.
      el.style.cssText = box + `background:${c}14;`;
      el.appendChild(doc.createElement("span")).style.cssText = `position:absolute;left:-8px;top:50%;width:4px;height:4px;margin-top:-2px;border-radius:50%;background:${c};`;
      if (s.label) tag(s.label, "left:100%;top:50%;transform:translate(4px,-50%);");
      break;
  }
  // Decision shapes take the pointer for the card and the panel; the rest lets it through.
  if (s.decision !== undefined) el.style.pointerEvents = "auto";
  el.style.setProperty("--c", c);
  return el;
}
