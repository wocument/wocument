/**
 * Read assist (2026-10-09). A reader's own aid for keeping their place, off until they turn
 * it on: a circle on the screen's right edge, under the sound control, that fans out three choices
 * on hover. Only where a pointer can hover; nothing moves or resizes text.
 *
 * `accent`, `wash` and `focus` mark the line under the pointer (2026-10-09). Where
 * reading jumps, the line on the other side of the jump is marked with it, from either side: a
 * paragraph's last line with the next paragraph's first, and a column's last line with the next
 * column's first (2026-10-10), so the reader sees where to go on and, having gone on, where they came
 * from. `accent` sets the lines in the page's accent, `wash` lays a faint accent band behind them
 * (beside a drop cap, from the text itself, so the cap stays clear), `focus` fades all other running
 * text to 40%. (A turn arrow in the margin was a fourth choice, 2026-10-09; removed 2026-10-10.)
 *
 * The pointer is followed by line: lines fill their whole line height and touch, so moving between
 * lines never drops the mark, and scrolling under a still pointer moves it with the text. It fades
 * only after the pointer has left the running text for a moment. The controls take no focus from a
 * mouse click, so the space bar keeps scrolling the page. The choice is the reader's, kept in this
 * browser for every article.
 */

export type AssistMode = "off" | "accent" | "wash" | "focus";

const MODES: readonly Exclude<AssistMode, "off">[] = ["accent", "wash", "focus"];
const LABEL: Record<Exclude<AssistMode, "off">, string> = {
  accent: "Highlight lines in colour",
  wash: "Soft highlight behind lines",
  focus: "Fade the other lines",
};
const KEY = "wmx-read-assist";
/** How long the mark waits after the pointer leaves running text before it fades. */
const LINGER = 600;

// Icons on a 28-unit circle: three lines of text, the middle one carrying the effect.
const LINES = (mid: string, outer = "") =>
  `<line x1="8.5" y1="10" x2="19.5" y2="10" ${outer}/><line x1="8.5" y1="14" x2="19.5" y2="14" ${mid}/><line x1="8.5" y1="18" x2="16" y2="18" ${outer}/>`;
const ICON: Record<AssistMode, string> = {
  off: `${LINES("")}<path d="M5.5 12.2 7.3 14 5.5 15.8" class="ra-acc"/>`,
  accent: LINES('class="ra-acc"'),
  wash: `<rect x="6.5" y="11.6" width="15" height="4.8" rx="1.4" class="ra-iband"/>${LINES("")}`,
  focus: LINES("", 'class="ra-faint"'),
};
const svg = (m: AssistMode) => `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="13.25" class="ra-ring"/>${ICON[m]}</svg>`;

export const READ_ASSIST_CSS = `
.wmx-rail { position: fixed; z-index: 21; top: max(14px, env(safe-area-inset-top)); right: 11px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.wmx-assist { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.wmx-assist button { display: block; width: 28px; height: 28px; margin: 0; padding: 0; border: 0; border-radius: 50%; background: none; color: #5f6570; cursor: pointer;
  opacity: 0.55; transition: opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), color 400ms ease; -webkit-tap-highlight-color: transparent; }
.wmx-assist button:hover, .wmx-assist button[aria-pressed="true"], .wmx-assist button[aria-expanded="true"] { opacity: 1; }
.wmx-assist button:focus-visible { outline: 1px solid currentColor; outline-offset: 3px; }
.wmx-assist svg { display: block; overflow: visible; }
.wmx-assist .ra-ring { fill: none; stroke: currentColor; stroke-width: 1; opacity: 0.45; }
.wmx-assist button[aria-pressed="true"] .ra-ring { stroke: var(--ra-accent, #1f5fbf); opacity: 0.9; }
.wmx-assist line, .wmx-assist path { stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; fill: none; }
.wmx-assist .ra-acc { stroke: var(--ra-accent, #1f5fbf); stroke-width: 1.6; }
.wmx-assist .ra-faint { opacity: 0.3; }
.wmx-assist .ra-iband { fill: var(--ra-accent, #1f5fbf); opacity: 0.22; stroke: none; }
.wmx-assist .ra-dot { position: absolute; top: 1px; right: 1px; width: 6px; height: 6px; border-radius: 50%; background: var(--ra-accent, #1f5fbf); opacity: 0; transition: opacity 200ms; pointer-events: none; }
.wmx-assist.on .ra-dot { opacity: 1; }
.wmx-assist .ra-menu { display: flex; flex-direction: column; gap: 8px; }
.wmx-assist .ra-menu button { opacity: 0; transform: translateY(-6px); pointer-events: none;
  transition: opacity 220ms cubic-bezier(0.16, 1, 0.3, 1), transform 260ms cubic-bezier(0.16, 1, 0.3, 1); }
.wmx-assist.open .ra-menu button { opacity: 0.6; transform: none; pointer-events: auto; }
.wmx-assist.open .ra-menu button:hover, .wmx-assist.open .ra-menu button[aria-pressed="true"] { opacity: 1; }
.wmx-assist.open .ra-menu button:nth-child(2) { transition-delay: 30ms; }
.wmx-assist.open .ra-menu button:nth-child(3) { transition-delay: 60ms; }
.wmx-doc[data-assist] .wmx-block[data-text] .wmx-line { transition: color 200ms ease; }
.wmx-doc[data-assist="accent"] .wmx-line.ra-on { color: var(--wmx-accent); }
.wmx-doc[data-assist="focus"].ra-focusing .wmx-block[data-text] .wmx-line:not(.ra-on) { color: color-mix(in srgb, currentColor 40%, transparent); }
.ra-band { position: absolute; z-index: 0; background: color-mix(in srgb, var(--wmx-accent) 10%, transparent); pointer-events: none;
  opacity: 0; transition: opacity 200ms ease; }
.ra-band.on { opacity: 1; }
.ra-band.ra-first { border-top-left-radius: 4px; border-top-right-radius: 4px; }
.ra-band.ra-last { border-bottom-left-radius: 4px; border-bottom-right-radius: 4px; }
@media (prefers-reduced-motion: reduce) {
  .wmx-assist button, .wmx-assist .ra-menu button, .wmx-doc[data-assist] .wmx-line, .ra-band { transition: none !important; animation: none !important; }
}
`;

/** The fixed column on the screen's right edge that the sound and read-assist controls share. */
export function rail(doc: Document): HTMLElement {
  let r = doc.querySelector<HTMLElement>(".wmx-rail");
  if (!r) {
    r = doc.createElement("div");
    r.className = "wmx-rail";
    doc.body.appendChild(r);
  }
  return r;
}

const store = {
  get(): AssistMode {
    try {
      const m = localStorage.getItem(KEY);
      return MODES.includes(m as never) ? (m as AssistMode) : "off";
    } catch {
      return "off";
    }
  },
  set(m: AssistMode): void {
    try {
      if (m === "off") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, m);
    } catch {
      /* private window or blocked storage: the choice lasts this page only */
    }
  },
};

type State = { mode: AssistMode; control: HTMLElement; teardown: () => void; apply: () => void; tint: () => void };
const states = new WeakMap<HTMLElement, State>();

/** Installs the control once per root, and the passages for this render's DOM. */
export function readAssist(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  if (!win.matchMedia("(hover: hover)").matches) return;
  let st = states.get(root);
  if (!st) {
    const s: State = { mode: store.get(), control: null as unknown as HTMLElement, teardown: () => {}, apply: () => {}, tint: () => {} };
    s.control = control(doc, s, () => s.apply());
    rail(doc).appendChild(s.control);
    // The accent of the page under the top of the screen colours the control.
    s.tint = () => {
      const scene = doc.elementsFromPoint(win.innerWidth / 2, 40).find((e) => e.classList.contains("wmx-scene")) as HTMLElement | undefined;
      if (scene) s.control.style.setProperty("--ra-accent", getComputedStyle(scene).getPropertyValue("--wmx-accent").trim() || "#1f5fbf");
    };
    win.addEventListener("scroll", s.tint, { passive: true });
    states.set(root, s);
    st = s;
  }
  st.teardown();
  const s = st;
  st.apply = () => {
    s.teardown();
    s.teardown = install(root, s.mode);
    s.control.classList.toggle("on", s.mode !== "off");
    for (const b of Array.from(s.control.querySelectorAll<HTMLButtonElement>(".ra-menu button"))) b.setAttribute("aria-pressed", String(b.dataset.mode === s.mode));
  };
  st.apply();
  st.tint();
}

function control(doc: Document, st: State, changed: () => void): HTMLElement {
  const wrap = doc.createElement("div");
  wrap.className = "wmx-assist";
  const main = doc.createElement("button");
  main.type = "button";
  main.setAttribute("aria-label", "Read assist");
  // A mouse click leaves no focus behind, so the space bar keeps scrolling the page instead of
  // pressing the button again; the keyboard still reaches every control with Tab.
  wrap.addEventListener("mousedown", (e) => e.preventDefault());
  main.setAttribute("aria-expanded", "false");
  main.innerHTML = svg("off");
  const dot = doc.createElement("span");
  dot.className = "ra-dot";
  const menu = doc.createElement("div");
  menu.className = "ra-menu";
  for (const m of MODES) {
    const b = doc.createElement("button");
    b.type = "button";
    b.dataset.mode = m;
    b.setAttribute("aria-label", LABEL[m]);
    b.setAttribute("aria-pressed", String(st.mode === m));
    b.innerHTML = svg(m);
    b.addEventListener("click", () => {
      st.mode = st.mode === m ? "off" : m;
      store.set(st.mode);
      changed();
    });
    menu.appendChild(b);
  }
  wrap.append(main, dot, menu);
  let timer = 0;
  const open = (yes: boolean) => {
    wrap.classList.toggle("open", yes);
    main.setAttribute("aria-expanded", String(yes));
  };
  wrap.addEventListener("mouseenter", () => (clearTimeout(timer), open(true)));
  wrap.addEventListener("mouseleave", () => (timer = window.setTimeout(() => open(false), 260)));
  wrap.addEventListener("focusin", () => open(true));
  wrap.addEventListener("focusout", (e) => {
    if (!wrap.contains(e.relatedTarget as Node | null)) open(false);
  });
  main.addEventListener("click", () => open(!wrap.classList.contains("open")));
  return wrap;
}

/** Turns a mode on for this render's DOM and listens for the pointer; returns the teardown. */
function install(root: HTMLElement, mode: AssistMode): () => void {
  root.classList.remove("ra-focusing");
  if (mode === "off") {
    delete root.dataset.assist;
    return () => {};
  }
  root.dataset.assist = mode;
  return lineMarks(root, mode);
}

/** Every line of running text, in reading order. */
const runningLines = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(".wmx-block[data-text] .wmx-line"));

/**
 * Follows the pointer by line: `on(line, x)` when it is over a line of running text, `off()` once
 * it has been away from them for LINGER ms. Coalesced to one call a frame.
 */
function follow(root: HTMLElement, on: (line: HTMLElement, x: number) => void, off: () => void): () => void {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  let frame = 0;
  let timer = 0;
  let at: { x: number; y: number } | null = null;
  const tick = () => {
    frame = 0;
    // What is under the pointer now: after a move, or after the page scrolled under a still pointer.
    const hit = at ? doc.elementFromPoint(at.x, at.y) : null;
    const line = hit?.closest<HTMLElement>(".wmx-block[data-text] .wmx-line");
    if (line && root.contains(line)) {
      win.clearTimeout(timer);
      timer = 0;
      on(line, at!.x);
    } else if (!timer) timer = win.setTimeout(() => ((timer = 0), off()), LINGER);
  };
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(tick);
  };
  const move = (e: MouseEvent) => {
    at = { x: e.clientX, y: e.clientY };
    schedule();
  };
  const leave = () => {
    at = null;
    if (!timer) timer = win.setTimeout(() => ((timer = 0), off()), LINGER);
  };
  root.addEventListener("mousemove", move, { passive: true });
  root.addEventListener("mouseleave", leave);
  win.addEventListener("scroll", schedule, { passive: true });
  return () => {
    root.removeEventListener("mousemove", move);
    root.removeEventListener("mouseleave", leave);
    win.removeEventListener("scroll", schedule);
    win.cancelAnimationFrame(frame);
    win.clearTimeout(timer);
  };
}

/**
 * `accent`, `wash`, `focus`: the line under the pointer, and where reading jumps, the line on the
 * other side of the jump, from either side: a paragraph's last line with the next paragraph's first,
 * a column's (or page's) last line with the next column's first (2026-10-10).
 * Only what changes is touched: a line that stays marked keeps its mark and its band, so moving from
 * line to line never flickers; a line leaving fades out, a line arriving fades in.
 */
function lineMarks(root: HTMLElement, mode: AssistMode): () => void {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const lines = runningLines(root);
  const index = new Map(lines.map((l, i) => [l, i] as const));
  const para = (l: HTMLElement) => {
    const w = l.closest<HTMLElement>(".wmx-block")!;
    return `${w.dataset.story}\u0000${w.dataset.block}`;
  };
  /** Reading jumps from `a` to the line after it, `b`: a new paragraph, or a new column or page. */
  const jumps = (a: HTMLElement, b: HTMLElement) => {
    if (para(a) !== para(b)) return true;
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.top < ra.bottom - 1 || rb.top > ra.bottom + ra.height || Math.abs(rb.left - ra.left) > 120;
  };
  const bands = new Map<HTMLElement, HTMLElement>();
  let marked = new Set<HTMLElement>();
  let current: HTMLElement | null = null;
  const show = (want: HTMLElement[]) => {
    const next = new Set(want);
    for (const l of marked)
      if (!next.has(l)) {
        l.classList.remove("ra-on");
        const b = bands.get(l);
        if (b) {
          bands.delete(l);
          b.classList.remove("on");
          win.setTimeout(() => b.remove(), 220);
        }
      }
    for (const l of next)
      if (!marked.has(l)) {
        l.classList.add("ra-on");
        if (mode === "wash") {
          const b = band(doc, l);
          bands.set(l, b);
          win.requestAnimationFrame(() => b.classList.add("on"));
        }
      }
    marked = next;
    // A band's corners: rounded only where its run of lines starts and ends.
    for (const [l, b] of bands) {
      const i = index.get(l)!;
      b.classList.toggle("ra-first", !touching(lines[i - 1], l, next));
      b.classList.toggle("ra-last", !touching(l, lines[i + 1], next));
    }
    root.classList.toggle("ra-focusing", next.size > 0);
  };
  const stop = follow(
    root,
    (line) => {
      if (line === current) return;
      current = line;
      const i = index.get(line) ?? -1;
      const prev = lines[i - 1];
      const next = lines[i + 1];
      show([...(prev && jumps(prev, line) ? [prev] : []), line, ...(next && jumps(line, next) ? [next] : [])]);
    },
    () => {
      current = null;
      show([]);
    },
  );
  return () => {
    stop();
    for (const l of marked) l.classList.remove("ra-on");
    for (const b of bands.values()) b.remove();
    root.classList.remove("ra-focusing");
  };
}

/** Whether `a` and the line after it, `b`, are both marked and sit one directly above the other. */
function touching(a: HTMLElement | undefined, b: HTMLElement | undefined, marked: ReadonlySet<HTMLElement>): boolean {
  if (!a || !b || !marked.has(a) || !marked.has(b) || a.offsetParent !== b.offsetParent) return false;
  return Math.abs(a.getBoundingClientRect().bottom - b.getBoundingClientRect().top) < 1.5;
}

/** A wash band behind one line, in the line's own box; beside a drop cap it starts at the text, so the cap stays clear. */
function band(doc: Document, line: HTMLElement): HTMLElement {
  const parent = line.offsetParent as HTMLElement;
  const box = parent.getBoundingClientRect();
  const lr = line.getBoundingClientRect();
  const cap = line.closest(".wmx-block")?.querySelector(".wmx-cap")?.getBoundingClientRect();
  const byCap = cap !== undefined && lr.top < cap.bottom && lr.left >= cap.right;
  const left = lr.left - (byCap ? 0 : 6);
  const b = doc.createElement("div");
  b.className = "ra-band";
  b.style.left = `${left - box.left}px`;
  b.style.top = `${lr.top - box.top}px`;
  b.style.width = `${lr.right + 6 - left}px`;
  b.style.height = `${lr.height}px`;
  parent.insertBefore(b, parent.firstChild);
  return b;
}
