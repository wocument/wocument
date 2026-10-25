/** The layout invariants for one laid-out document, as expectations. */

import { expect } from "vitest";
import type { ParagraphBlock, Placement, ResolvedDocument } from "@wocument/resolved-document";
import { bandExtent, type PositionedDocument } from "../src/index.js";

const SHY = /­/g;
// Lowercased: styles may transform case (a kicker is uppercase).
const words = (s: string): string[] => s.replace(SHY, "").toLowerCase().split(/\s+/).filter(Boolean);

function wordsOf(rd: ResolvedDocument, bp: string, story: string): string[] {
  return words(
    rd.variants[bp]!.stories[story]!.blocks.filter((b): b is ParagraphBlock => b.kind === "paragraph")
      .map((b) => (b.dropcap ? rd.strings[b.dropcap.s] : "") + b.runs.map((r) => (r.kind === "break" ? " " : rd.strings[r.s])).join(""))
      .join(" "),
  );
}

function setWords(rd: ResolvedDocument, pd: PositionedDocument, story: string): string[] {
  const v = rd.variants[pd.breakpoint]!;
  const lines = pd.scenes.flatMap((s) => s.lines).filter((l) => l.story === story);
  return words(
    lines
      .map((l) => {
        const b = v.stories[story]!.blocks[l.block] as ParagraphBlock;
        const cap = l.paragraphStart && b.dropcap ? rd.strings[b.dropcap.s] : "";
        return (l.paragraphStart ? " " : "") + cap + l.text + (l.text.endsWith("­") ? "" : " ");
      })
      .join(""),
  );
}

/**
 * `standoff: false` measures lines against each object's bare shape instead of its `wrap-offset`
 * standoff: the one to use for a document where a line sits a few
 * pixels inside an object's breathing room without touching the object.
 */
export function layoutInvariants(rd: ResolvedDocument, pd: PositionedDocument, { standoff = true } = {}): void {
  const v = rd.variants[pd.breakpoint]!;
  // Every word of every threaded story, once, in order. A story with `overset=clip` may stop early
  // (spec §09.5): what it sets must still be its opening words, in order, each once.
  for (const story of Object.keys(v.threads)) {
    const set = setWords(rd, pd, story);
    const all = wordsOf(rd, pd.breakpoint, story);
    expect(set, story).toEqual(v.stories[story]!.overset === "clip" ? all.slice(0, set.length) : all);
  }
  // No two lines of one column overlap.
  const lines = pd.scenes.flatMap((s) => s.lines);
  const byCol = new Map<string, typeof lines>();
  for (const l of lines) byCol.set(`${l.frame}:${l.column}`, [...(byCol.get(`${l.frame}:${l.column}`) ?? []), l]);
  for (const ls of byCol.values()) {
    const bands = [...new Set(ls.map((l) => l.y))].sort((a, b) => a - b);
    const h = Math.min(...ls.map((l) => l.height));
    for (let i = 1; i < bands.length; i++) expect(bands[i]! - bands[i - 1]!).toBeGreaterThanOrEqual(h - 1e-6);
  }
  // Snapped baselines share one grid per screen. A flow scene's counts from the scene's top; a page
  // scene's counts up from each screen's bottom line (2026-10-17), so only "one grid" is checked here.
  for (const s of pd.scenes) {
    const residue = (y: number) => (((y % s.grid.baseline) + s.grid.baseline) % s.grid.baseline);
    const grids = new Map<number, number>();
    for (const l of s.lines.filter((x) => x.snapped)) {
      // The screen the baseline is on: a line a plain frame runs over a screen's edge snaps there.
      const page = Math.floor((l.baseline - s.y) / pd.viewport.height);
      const r = residue(l.baseline);
      const first = grids.get(page) ?? r;
      grids.set(page, first);
      const d = Math.abs(r - first);
      expect(Math.min(d, s.grid.baseline - d), `${s.name} page ${page + 1}: ${l.text}`).toBeLessThan(1e-6);
    }
  }
  // No line inside a wrapping object's shape: a frame's line, or another object's (a pull quote's
  // text). 2026-10-20: every object counts, a scene's own cut-out too (it was left out, and a pull
  // quote floated under one went unseen).
  const inside = (l: { frame: string }, o: { name: string }): boolean => {
    for (let id: string | undefined = l.frame; id; ) {
      if (id === o.name) return true;
      const p: Placement | undefined = v.objects[id]?.placement;
      id = p?.mode === "contained" ? p.container : undefined;
    }
    return false;
  };
  for (const s of pd.scenes)
    for (const o of s.objects.filter((o) => o.exclusion && !o.exclusion.jump))
      for (const l of s.lines.filter((l) => (v.frames[l.frame] || v.objects[l.frame]) && !inside(l, o))) {
        // Another object's line keeps off the object itself (its outline, or its box), not its standoff.
        const e = v.frames[l.frame] ? (standoff ? o.exclusion! : { ...o.exclusion!, offset: 0 }) : { ...o.exclusion!, offset: 0, ...(o.exclusion!.shape.kind === "rect" ? { box: o.box } : {}) };
        const ext = bandExtent(e, l.y, l.y + l.height);
        if (ext) expect(l.x + l.width <= ext[0] + 1e-6 || l.x >= ext[1] - 1e-6, `${o.name} vs "${l.text}"`).toBe(true);
      }
  // No two lines of different text frames overlap in both x and y, within one scene.
  for (const s of pd.scenes) {
    const frameLines = s.lines.filter((l) => v.frames[l.frame]);
    for (let i = 0; i < frameLines.length; i++)
      for (let j = i + 1; j < frameLines.length; j++) {
        const a = frameLines[i]!;
        const b = frameLines[j]!;
        if (a.frame === b.frame) continue;
        const xOverlap = a.x < b.x + b.width - 1e-6 && b.x < a.x + a.width - 1e-6;
        const yOverlap = a.y < b.y + b.height - 1e-6 && b.y < a.y + a.height - 1e-6;
        expect(xOverlap && yOverlap, `"${a.text}" (${a.frame}) vs "${b.text}" (${b.frame})`).toBe(false);
      }
  }
  // Every visible anchored object placed once; in a story that clips (spec §09.5), an object anchored
  // in text that was cut off is cut off with it, so at most once.
  const placed = pd.scenes.flatMap((s) => s.objects.map((o) => o.name));
  for (const o of Object.values(v.objects).filter((o) => o.placement.mode === "anchored" && !o.hidden && v.threads[o.placement.story])) {
    const n = placed.filter((x) => x === o.id).length;
    if (o.placement.mode === "anchored" && v.stories[o.placement.story]!.overset === "clip") expect(n, o.id).toBeLessThanOrEqual(1);
    else expect(n, o.id).toBe(1);
  }
  // Picture composition (2026-10-17): in a scene of screen pages, a floating object is on its anchor's
  // screen, the screen before or the screen after; at most one hero a screen.
  expect(windowBreaks(rd, pd)).toEqual([]);
  for (const s of pd.scenes.filter((s) => s.paged)) {
    const screen = (y: number) => Math.floor((y - s.y + 1e-6) / pd.viewport.height);
    const heroes = new Map<number, number>();
    for (const p of s.objects) {
      const o = v.objects[p.name];
      if (o?.placement.mode === "anchored" && o.placement.size === "hero") heroes.set(screen(p.box.y), (heroes.get(screen(p.box.y)) ?? 0) + 1);
    }
    for (const [k, n] of heroes) expect(n, `${s.name} screen ${k + 1}: heroes`).toBeLessThanOrEqual(1);
  }
}

/**
 * The floating objects (anchored, `place` other than `here`) of paged scenes outside their window: more
 * than one screen from their anchor. The window yields only to overflow (rulings 2026-10-17): an object
 * may land further after its anchor only when every screen after its anchor's screen, to the one before
 * its own, already holds a floating object set earlier in story order. The anchor's own screen does not
 * count (its first band can be too short to hold any picture).
 */
export function windowBreaks(rd: ResolvedDocument, pd: PositionedDocument): string[] {
  const v = rd.variants[pd.breakpoint]!;
  const out: string[] = [];
  for (const s of pd.scenes.filter((s) => s.paged)) {
    const screen = (y: number) => Math.floor((y - s.y + 1e-6) / pd.viewport.height);
    const floats = s.objects.flatMap((p) => {
      const o = v.objects[p.name];
      return o?.placement.mode === "anchored" && o.placement.place !== "here" && p.anchoredAt !== null
        ? [{ name: p.name, story: o.placement.story, block: o.placement.block, at: screen(p.box.y), anchor: screen(p.anchoredAt) }]
        : [];
    });
    for (const f of floats) {
      if (Math.abs(f.at - f.anchor) <= 1) continue;
      const full = (k: number) => floats.some((e) => e.story === f.story && e.block < f.block && e.at === k);
      const overflow = f.at > f.anchor && Array.from({ length: f.at - f.anchor - 1 }, (_, i) => f.anchor + 1 + i).every(full);
      if (!overflow) out.push(`${f.name} window: screen ${f.at + 1}, anchor on ${f.anchor + 1}`);
    }
  }
  return out;
}

/**
 * 2026-10-20: empty room inside the columns of a frame set in column bands, next to a box or beside
 * one, taller than `limit`: text that stops short of a box under it, or a strip beside a box that
 * holds no text. A box counts with its standoff. Each as "scene screen n frame:column: height at y".
 * `last: false` leaves out each frame's last screen.
 */
export function columnHoles(rd: ResolvedDocument, pd: PositionedDocument, limit: number, { last = true } = {}): string[] {
  const v = rd.variants[pd.breakpoint]!;
  const out: string[] = [];
  for (const s of pd.scenes.filter((s) => s.paged)) {
    const screen = (y: number) => Math.floor((y - s.y + 1e-6) / pd.viewport.height);
    const own = s.objects.filter((o) => v.objects[o.name] && v.objects[o.name]!.placement.mode !== "contained");
    const lines = s.lines.filter((l) => v.frames[l.frame]);
    const groups = new Map<string, typeof lines>();
    for (const l of lines) groups.set(`${l.frame}:${l.column}@${screen(l.y)}`, [...(groups.get(`${l.frame}:${l.column}@${screen(l.y)}`) ?? []), l]);
    for (const [key, ls] of groups) {
      // Frames of one column are not set in bands.
      if (new Set(lines.filter((l) => l.frame === ls[0]!.frame).map((l) => l.column)).size < 2) continue;
      const k = screen(ls[0]!.y);
      if (!last && k === Math.max(...lines.filter((l) => l.frame === ls[0]!.frame).map((l) => screen(l.y)))) continue;
      const [left, right] = [Math.min(...ls.map((l) => l.x)), Math.max(...ls.map((l) => l.x + l.width))];
      const boxes = own
        .filter((o) => o.box.x < right - 1 && left < o.box.x + o.box.width - 1 && (screen(o.box.y) === k || screen(o.box.y + o.box.height - 1) === k))
        .map((o) => {
          const e = o.exclusion?.box ?? o.box;
          const off = o.exclusion?.offset ?? 0;
          return { top: e.y - off, bottom: e.y + e.height + off, box: true, full: e.x - off <= left + 1 && e.x + e.width + off >= right - 1 };
        });
      const spans = [...ls.map((l) => ({ top: l.y, bottom: l.y + l.height, box: false })), ...boxes.filter((b) => b.full)].sort((a, b) => a.top - b.top);
      let { bottom, box } = spans[0]!;
      for (const sp of spans.slice(1)) {
        const gap = sp.top - bottom;
        if (gap > limit + 1e-6 && (box || sp.box || boxes.some((b) => b.top < sp.top - 1 && b.bottom > bottom + 1)))
          out.push(`${s.name} screen ${k + 1} ${key.split("@")[0]}: ${Math.round(gap)}px at ${Math.round(bottom - s.y - k * pd.viewport.height)}`);
        if (sp.bottom > bottom) ({ bottom, box } = sp);
      }
    }
  }
  return out;
}
