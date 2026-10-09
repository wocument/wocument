/**
 * Scrolling (2026-10-09). Lenis eases the wheel
 * everywhere; nothing snaps. The space bar and Page Down glide to the next page's top, Shift +
 * space and Page Up to the one before, instead of the browser's jump: a page is each screen of a page
 * scene and each other scene's top (snapStops); a document without pages moves a screen at a time.
 * A vertical line of dots at the right edge shows the pages, the current one larger; a dot glides to
 * its page. Under reduced motion there is no easing and no glide: the browser's own scrolling.
 * (Settling on every screen, by proximity, from 2026-09-29 to 2026-10-09.)
 */

import Lenis from "lenis";
import type { PositionedLine } from "@wmxdsl/layout";

const SHY = "­";

/** Where scrolling settles: the top of every screen of every page scene. */
export function screenPoints(scenes: readonly { y: number; height: number; page: boolean }[], viewportHeight: number): number[] {
  return scenes.flatMap((s) => (s.page ? Array.from({ length: Math.max(1, Math.round(s.height / viewportHeight)) }, (_, k) => s.y + k * viewportHeight) : []));
}

/** Where scrolling may settle: every page screen (screenPoints), the top of every other scene, and the end. */
export function snapStops(scenes: readonly { y: number; height: number; page: boolean }[], viewportHeight: number): number[] {
  const last = scenes.at(-1);
  const end = last ? Math.max(0, last.y + last.height - viewportHeight) : 0;
  const stops = [...screenPoints(scenes, viewportHeight), ...scenes.filter((s) => !s.page).map((s) => s.y), end];
  return [...new Set(stops.map((y) => Math.min(y, end)))].sort((a, b) => a - b);
}

/** The page whose point is nearest the scroll position. */
export function currentPage(scrollY: number, points: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < points.length; i++) if (Math.abs(points[i]! - scrollY) < Math.abs(points[best]! - scrollY)) best = i;
  return best;
}

/** Lines that carry on a word hyphenated at the end of the line before, in the same story and block (§07.6 hyphen-mark). */
export function continuingLines(lines: readonly PositionedLine[]): Set<PositionedLine> {
  const out = new Set<PositionedLine>();
  const lastIn = new Map<string, PositionedLine>();
  for (const l of lines) {
    const before = lastIn.get(l.story);
    if (before?.block === l.block && before.text.endsWith(SHY)) out.add(l);
    lastIn.set(l.story, l);
  }
  return out;
}

const CSS = `
.wmx-dots { position: fixed; right: 20px; top: 50%; transform: translateY(-50%); z-index: 20; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.wmx-dots button { all: unset; cursor: pointer; width: 6px; height: 6px; border-radius: 50%; background: var(--dot); opacity: 0.35; transition: width 200ms, height 200ms, opacity 200ms; }
.wmx-dots button[aria-current="true"] { width: 10px; height: 10px; opacity: 1; }`;

/** Where Space (dir 1) or Shift + Space (dir -1) goes from `y`: the next page's top, or a screen on. */
export function pageStep(y: number, dir: 1 | -1, stops: readonly number[], viewportHeight: number, max: number): number {
  const near = 4;
  const next = dir > 0 ? stops.find((s) => s > y + near) : [...stops].reverse().find((s) => s < y - near);
  return Math.min(max, Math.max(0, next ?? y + dir * viewportHeight * 0.9));
}

/** easeInOutCubic: a page glide that starts and lands softly. */
const glide = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Smooth scrolling, the page step on the keyboard, and a dot for each of `stops` when there are two
 * or more. `reduce`: none of it but the dots. Returns a handle that removes everything it added.
 */
export function installPages(win: Window, _root: HTMLElement, stops: readonly number[], reduce: boolean): { destroy(): void } {
  const points = stops;
  const doc = win.document;
  const css = doc.createElement("style");
  css.textContent = CSS;
  doc.head.append(css);

  const lenis = reduce ? null : new Lenis({ autoRaf: true });
  const to = (y: number): void => (lenis ? lenis.scrollTo(y, { duration: 1.1, easing: glide }) : win.scrollTo({ top: y }));

  const bar = doc.createElement("nav");
  bar.className = "wmx-dots";
  bar.setAttribute("aria-hidden", "true");
  if (points.length >= 2) {
    for (const y of points) {
      const dot = doc.createElement("button");
      dot.addEventListener("click", () => to(y));
      bar.append(dot);
    }
    doc.body.append(bar);
  }

  const update = (): void => {
    if (points.length < 2) return;
    const now = currentPage(win.scrollY, points);
    Array.from(bar.children).forEach((d, i) => d.setAttribute("aria-current", String(i === now)));
    // The dots take the accent of the scene under the middle of the screen.
    const under = doc.elementsFromPoint(win.innerWidth / 2, win.innerHeight / 2).find((e) => e.classList.contains("wmx-scene"));
    if (under) bar.style.setProperty("--dot", getComputedStyle(under).getPropertyValue("--wmx-accent"));
  };

  // Space and Page Down glide a page on, Shift + Space and Page Up a page back. Keys meant for a
  // control or a text field, or pressed with a modifier, are left to the browser.
  const keys = (e: KeyboardEvent): void => {
    if (!lenis || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
    const dir = e.key === "PageDown" || (e.key === " " && !e.shiftKey) ? 1 : e.key === "PageUp" || (e.key === " " && e.shiftKey) ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const from = lenis.isScrolling ? lenis.targetScroll : win.scrollY;
    to(pageStep(from, dir, points, win.innerHeight, doc.documentElement.scrollHeight - win.innerHeight));
  };
  win.addEventListener("keydown", keys);
  lenis?.on("scroll", update);
  win.addEventListener("scroll", update, { passive: true });
  update();

  return {
    destroy() {
      win.removeEventListener("scroll", update);
      win.removeEventListener("keydown", keys);
      lenis?.destroy();
      bar.remove();
      css.remove();
    },
  };
}
