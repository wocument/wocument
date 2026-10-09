/**
 * The soundtrack (spec §10.6, 2026-10-09). The track playing is always the last `\music`
 * cue above the reading position, so scrolling back restores the one before. Browsers allow sound
 * only after the reader's first tap, click or key press: until then cues are armed silently, and a
 * small button offers sound. Readers who ask their device for reduced motion or reduced data are
 * never given sound by a gesture alone, only by the button.
 *
 * It outlives `render()`: layout and render run again on every resize, and the music must not
 * restart, so one soundtrack is kept per root element and given the new positions each time.
 * Volume goes through Web Audio, since iOS ignores an audio element's own volume.
 */

import type { PositionedDocument } from "@wmxdsl/layout";
import type { MusicCue, ResolvedDocument } from "@wmxdsl/resolved-document";
import { rail } from "./read-assist.js";

type Placed = { y: number; cue: MusicCue };
type Track = { src: string; el: HTMLAudioElement; gain: GainNode };

/** Where each cue sits on the page: its story block's first line, or its scene's top. */
export function cuePositions(rd: ResolvedDocument, pd: PositionedDocument): Placed[] {
  const lines = pd.scenes.flatMap((s) => s.lines);
  const placed = rd.music.flatMap((cue): Placed[] => {
    if ("scene" in cue.at) {
      const scene = pd.scenes.find((s) => s.name === (cue.at as { scene: string }).scene);
      return scene ? [{ y: scene.y, cue }] : [];
    }
    const { story, block } = cue.at;
    const own = lines.filter((l) => l.story === story);
    const next = own.find((l) => l.block >= block);
    const last = own.at(-1);
    return next ? [{ y: next.y, cue }] : last ? [{ y: last.y + last.height, cue }] : [];
  });
  return placed.sort((a, b) => a.y - b.y);
}

/** The cue in force: the last one whose position has come `enterAt` of the way up the screen. */
export function currentCue(placed: readonly Placed[], scrollY: number, viewportHeight: number): MusicCue | null {
  let current: MusicCue | null = null;
  for (const p of placed) if (p.y <= scrollY + viewportHeight * (1 - p.cue.enterAt)) current = p.cue;
  return current;
}

const tracks = new WeakMap<HTMLElement, { place(rd: ResolvedDocument, pd: PositionedDocument): void }>();

export function soundtrack(root: HTMLElement, rd: ResolvedDocument, pd: PositionedDocument): void {
  if (!rd.music.length) return;
  let st = tracks.get(root);
  if (!st) tracks.set(root, (st = create(root)));
  st.place(rd, pd);
}

function create(root: HTMLElement): { place(rd: ResolvedDocument, pd: PositionedDocument): void } {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const quiet =
    win.matchMedia("(prefers-reduced-motion: reduce)").matches || win.matchMedia("(prefers-reduced-data: reduce)").matches;
  let rd: ResolvedDocument;
  let pd: PositionedDocument;
  let placed: Placed[] = [];
  let ctx: AudioContext | null = null;
  let on = false;
  let current: Track | null = null;
  /** The reader turned sound off with the button: no gesture turns it back on. */
  let muted = false;

  // 2026-10-09: really subtle, at the top of the screen's right edge, on the line of the page
  // dots and the scroll bar; no words. A hairline circle in the page's muted colour, its four bars
  // resting when off and moving when on.
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "wmx-sound";
  button.setAttribute("aria-label", "Sound");
  // No focus from a mouse click: the space bar scrolls the page rather than pressing it again.
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.innerHTML =
    '<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="13.25"/>' +
    [8.5, 11.75, 15, 18.25].map((x) => `<rect x="${x}" y="7.5" width="1.5" height="13" rx="0.75"/>`).join("") +
    "</svg>";
  const label = () => {
    button.setAttribute("aria-pressed", String(on));
    button.title = on ? "Turn sound off" : "Turn sound on";
  };
  label();
  rail(doc).prepend(button);

  const ramp = (g: GainNode, to: number, ms: number) => {
    const now = ctx!.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(to, now + Math.max(ms, 1) / 1000);
  };

  /** The button takes the muted colour of the scene under the top of the screen, so it reads on a dark page too. */
  const tint = () => {
    const v = rd.variants[pd.breakpoint];
    const ps = pd.scenes.find((s) => win.scrollY < s.y + s.height) ?? pd.scenes.at(-1);
    const scene = v?.scenes.find((s) => s.id === ps?.name);
    if (scene) button.style.color = scene.palette.muted;
  };

  const apply = () => {
    tint();
    if (!ctx || !on) return;
    const cue = currentCue(placed, win.scrollY, win.innerHeight);
    const url = cue?.audio ? rd.assets[cue.audio] : null;
    const src = url?.kind === "audio" ? url.sources[0]!.url : null;
    if (src === (current?.src ?? null)) return;
    const fade = cue?.fadeMs ?? placed[0]?.cue.fadeMs ?? 2000;
    if (current) {
      const old = current;
      ramp(old.gain, 0, fade);
      win.setTimeout(() => old.el.pause(), fade + 50);
    }
    current = null;
    if (!src || !cue) return;
    const el = new Audio(src);
    el.loop = cue.loop;
    el.crossOrigin = "anonymous";
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
    void el.play().catch(() => {});
    ramp(gain, cue.volume, fade);
    current = { src, el, gain };
  };

  const start = () => {
    ctx ??= new AudioContext();
    void ctx.resume();
    on = true;
    label();
    apply();
  };
  const stop = () => {
    on = false;
    label();
    if (current) {
      ramp(current.gain, 0, 400);
      const old = current;
      win.setTimeout(() => old.el.pause(), 450);
      current = null;
    }
  };
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (on) stop();
    else start();
    muted = !on;
  });

  // The first tap, click or key press anywhere starts the music, unless the reader said no.
  const gesture = (e: Event) => {
    // A press on the button is the button's own business: counting it here too would turn the sound
    // on and the button's click straight back off.
    if (e.target instanceof Node && button.contains(e.target)) return;
    if (!muted && !on && !quiet) start();
    for (const t of GESTURES) win.removeEventListener(t, gesture, true);
  };
  const GESTURES = ["pointerdown", "keydown", "touchend"] as const;
  for (const t of GESTURES) win.addEventListener(t, gesture, { capture: true, passive: true });

  let frame = 0;
  win.addEventListener("scroll", () => {
    if (!frame) frame = win.requestAnimationFrame(() => ((frame = 0), apply()));
  }, { passive: true });
  // A hidden tab or a locked phone goes quiet, and the music comes back with the reader.
  doc.addEventListener("visibilitychange", () => {
    if (!ctx || !on) return;
    void (doc.hidden ? ctx.suspend() : ctx.resume());
  });

  return {
    place(next, layout) {
      rd = next;
      pd = layout;
      placed = cuePositions(next, layout);
      apply();
    },
  };
}
