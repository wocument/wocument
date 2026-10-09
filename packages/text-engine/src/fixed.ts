/**
 * A deterministic engine for tests that run in plain Node, where Pretext
 * cannot (it needs a canvas). Every character is `ratio` em of its run's font
 * wide; lines break at spaces and at U+00AD, which then shows as a hyphen.
 * Not for rendering.
 */

import type { EngineFont, EngineRun, Fragment, LineBox, Prepared, TextCursor, TextEngine } from "./index.js";

const SHY = "\u00ad";

/** A word piece (split further at soft hyphens) or a single space, tagged with its run. */
type Segment = { run: number; text: string; space: boolean; shy: boolean };

export function createFixedEngine(ratio = 0.5): TextEngine {
  const charW = (f: EngineFont): number => f.size * ratio + f.tracking;

  return {
    prepare(runs: readonly EngineRun[], base: EngineFont): Prepared {
      const segs: Segment[] = [];
      runs.forEach((r, run) => {
        for (const part of r.text.split(/( )/)) {
          if (part === "") continue;
          if (part === " ") segs.push({ run, text: " ", space: true, shy: false });
          else {
            const pieces = part.split(SHY);
            pieces.forEach((p, i) => segs.push({ run, text: p, space: false, shy: i < pieces.length - 1 }));
          }
        }
      });
      return { runs, ascent: base.size * 0.8, descent: base.size * 0.2, capHeight: base.size * 0.7, opaque: segs };
    },

    nextLine(prepared: Prepared, from: TextCursor, maxWidth: number): LineBox | null {
      const segs = prepared.opaque as Segment[];
      const width = (ss: readonly Segment[], hyphen: boolean): number => {
        const shown = [...ss];
        while (shown.at(-1)?.space) shown.pop();
        let w = 0;
        for (const s of shown) w += [...s.text].length * charW(prepared.runs[s.run]!.font);
        const last = shown.at(-1);
        return hyphen && last ? w + charW(prepared.runs[last.run]!.font) : w;
      };
      let i = from.seg;
      while (i < segs.length && segs[i]!.space) i++; // a line never starts with a space
      if (i >= segs.length) return null;
      const start = i;
      let lastBreak: { end: number; hyphen: boolean } | null = null;
      for (; i < segs.length; i++) {
        const s = segs[i]!;
        if (width(segs.slice(start, i + 1), s.shy) > maxWidth && i > start) break;
        if (s.space) lastBreak = { end: i + 1, hyphen: false };
        else if (s.shy) lastBreak = { end: i + 1, hyphen: true };
      }
      const cut = i < segs.length && lastBreak ? lastBreak : { end: i, hyphen: false };
      const line = segs.slice(start, cut.end);
      const fragments: Fragment[] = [];
      for (const s of line) {
        const f = fragments.at(-1);
        if (f && f.run === s.run) f.text += s.text;
        else fragments.push({ run: s.run, text: s.text });
      }
      if (cut.hyphen) fragments.at(-1)!.text += "-";
      const text = fragments.map((f) => f.text).join("");
      const at = (k: number): TextCursor => ({ item: segs[k]?.run ?? prepared.runs.length, seg: k, grapheme: 0 });
      return { text, width: width(line, cut.hyphen), start: at(start), end: at(cut.end), fragments };
    },
  };
}
