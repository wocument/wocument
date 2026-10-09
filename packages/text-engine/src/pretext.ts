/**
 * The Pretext adapter: the only file that imports @chenglou/pretext. Browser
 * only; Pretext measures through a canvas (spec §15.1).
 *
 * A paragraph in one font goes through Pretext's plain path; a paragraph that
 * mixes fonts (bold, italic, code, links) goes through its rich-inline path,
 * which returns each line as fragments tagged with their run.
 *
 * Keep it under 200 lines.
 */

import { layoutNextLine, prepareWithSegments, setLocale, type LayoutCursor, type PreparedTextWithSegments } from "@chenglou/pretext";
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  prepareRichInline,
  type PreparedRichInline,
  type RichInlineCursor,
} from "@chenglou/pretext/rich-inline";
import { cssFont, type EngineFont, type EngineRun, type LineBox, type Prepared, type TextCursor, type TextEngine } from "./index.js";

type Opaque =
  | { kind: "plain"; p: PreparedTextWithSegments }
  /** `items` are the non-empty runs; `run[i]` maps item i back to its run index. */
  | { kind: "rich"; p: PreparedRichInline; run: number[] };

export function createPretextEngine(locale = "en"): TextEngine {
  setLocale(locale);
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("text measurement needs a 2D canvas");

  return {
    prepare(runs: readonly EngineRun[], base: EngineFont): Prepared {
      let opaque: Opaque;
      // One run: the plain path. Several runs take the rich path even when they share a font,
      // because a link or a colored span still needs its own fragment.
      if (runs.length === 1) {
        const p = prepareWithSegments(runs[0]!.text, cssFont(runs[0]!.font), { letterSpacing: runs[0]!.font.tracking });
        warmPlain(p);
        opaque = { kind: "plain", p };
      } else {
        const kept = runs.map((r, i) => ({ r, i })).filter(({ r }) => r.text !== "");
        const p = prepareRichInline(kept.map(({ r }) => ({ text: r.text, font: cssFont(r.font), letterSpacing: r.font.tracking })));
        warmRich(p);
        opaque = { kind: "rich", p, run: kept.map(({ i }) => i) };
      }
      // Font metrics of the block's own font: the only other measurements prepare makes.
      ctx.font = cssFont(base);
      const m = ctx.measureText("H");
      return { runs, ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent, capHeight: m.actualBoundingBoxAscent, opaque };
    },

    nextLine(prepared: Prepared, from: TextCursor, maxWidth: number): LineBox | null {
      const o = prepared.opaque as Opaque;
      const width = Math.max(1, maxWidth);
      if (o.kind === "plain") {
        const line = layoutNextLine(o.p, { segmentIndex: from.seg, graphemeIndex: from.grapheme }, width);
        if (line === null) return null;
        const at = (c: LayoutCursor): TextCursor => ({ item: 0, seg: c.segmentIndex, grapheme: c.graphemeIndex });
        return { text: line.text, width: line.width, start: at(line.start), end: at(line.end), fragments: [{ run: 0, text: line.text }] };
      }
      // A run index back to an item index: the first kept item at or after it, so the
      // end-of-paragraph cursor (run = runs.length) maps to the end, never back to item 0.
      const itemOf = (run: number): number => {
        const i = o.run.findIndex((r) => r >= run);
        return i < 0 ? o.run.length : i;
      };
      const start: RichInlineCursor = { itemIndex: itemOf(from.item), segmentIndex: from.seg, graphemeIndex: from.grapheme };
      const range = layoutNextRichInlineLineRange(o.p, width, start);
      if (range === null) return null;
      const line = materializeRichInlineLineRange(o.p, range);
      // A fragment's gapBefore is a collapsed space between items; keep it in the text so the line reads as set.
      const fragments = line.fragments.map((f, k) => ({ run: o.run[f.itemIndex]!, text: (k > 0 && f.gapBefore > 0 ? " " : "") + f.text }));
      const first = line.fragments[0]!;
      const runOf = (item: number): number => o.run[item] ?? prepared.runs.length;
      return {
        text: fragments.map((f) => f.text).join(""),
        width: line.width,
        start: { item: runOf(first.itemIndex), seg: first.start.segmentIndex, grapheme: first.start.graphemeIndex },
        end: { item: runOf(line.end.itemIndex), seg: line.end.segmentIndex, grapheme: line.end.graphemeIndex },
        fragments,
      };
    },
  };
}

/**
 * LOAD-BEARING (spec §15.4 point 5, spike report S1). Walking the paragraph
 * once at 1px forces every segment to be measured now, so `nextLine` at any
 * later width is arithmetic over cached widths and never touches the canvas.
 * Delete these and layout silently starts measuring again.
 */
function warmPlain(p: PreparedTextWithSegments): void {
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
  for (let guard = 0; guard < 200_000; guard++) {
    const line = layoutNextLine(p, cursor, 1);
    if (line === null) break;
    if (line.end.segmentIndex === cursor.segmentIndex && line.end.graphemeIndex === cursor.graphemeIndex) break;
    cursor = line.end;
  }
}

function warmRich(p: PreparedRichInline): void {
  let cursor: RichInlineCursor = { itemIndex: 0, segmentIndex: 0, graphemeIndex: 0 };
  for (let guard = 0; guard < 200_000; guard++) {
    const range = layoutNextRichInlineLineRange(p, 1, cursor);
    if (range === null) break;
    const e = range.end;
    if (e.itemIndex === cursor.itemIndex && e.segmentIndex === cursor.segmentIndex && e.graphemeIndex === cursor.graphemeIndex) break;
    materializeRichInlineLineRange(p, range);
    cursor = e;
  }
}
