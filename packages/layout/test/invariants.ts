/** The layout invariants for one laid-out document, as expectations. */

import { expect } from "vitest";
import type { ParagraphBlock, ResolvedDocument } from "@wmxdsl/resolved-document";
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
  // Snapped baselines on the scene's grid; on a paged scene, on the grid of the page they are on
  // (counted from that page's top, 2026-10-07).
  for (const s of pd.scenes)
    for (const l of s.lines.filter((x) => x.snapped)) {
      // Frames that are not set in bands keep the scene's grid.
      const off = (origin: number) => {
        const steps = (l.baseline - origin) / s.grid.baseline;
        return Math.abs(steps - Math.round(steps));
      };
      const page = s.y + Math.floor((l.y - s.y) / pd.viewport.height) * pd.viewport.height;
      expect(Math.min(off(s.y), s.paged ? off(page) : 1)).toBeLessThan(1e-6);
    }
  // No frame line inside a wrapping object's shape.
  for (const s of pd.scenes)
    for (const o of s.objects.filter((o) => o.exclusion && !o.exclusion.jump && o.anchoredAt !== null))
      for (const l of s.lines.filter((l) => v.frames[l.frame])) {
        const ext = bandExtent(standoff ? o.exclusion! : { ...o.exclusion!, offset: 0 }, l.y, l.y + l.height);
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
}
