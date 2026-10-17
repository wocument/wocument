/**
 * Line length (W064, 2026-10-09): the document laid out at the spec's test widths (§15.6)
 * with a fixed-width text engine, counting the characters in full lines of body text. Node has no
 * fonts to measure with, so a character is taken as 0.46 of the text size, Georgia's average on
 * running English (measured in the browser: 59 characters in a 573px column at 21px). The count is
 * an estimate, close to a browser's for Vanilla; other faces run a few characters either way.
 */

import { activeVariant, layout, type PositionedDocument } from "@wmxdsl/layout";
import type { ResolvedDocument } from "@wmxdsl/resolved-document";
import { PrepareCache, createFixedEngine } from "@wmxdsl/text-engine";

export const TEST_WIDTHS = [360, 768, 1280, 1470, 2560];
const CHAR = 0.46;

export type LineLength = { width: number; variant: string; chars: number };

/** Characters in a full line of body text at each test width; widths with no body text are left out. */
export function lineLengths(rd: ResolvedDocument, widths = TEST_WIDTHS): LineLength[] {
  const cache = new PrepareCache(createFixedEngine(CHAR));
  return widths.flatMap((width) => {
    const chars = bodyChars(layout(rd, { width, height: 900 }, cache));
    return chars === null ? [] : [{ width, variant: activeVariant(rd, width), chars: Math.round(chars) }];
  });
}

/** The average characters in a full line of body text, or null with no body text. */
function bodyChars(pd: PositionedDocument): number | null {
  const lines = pd.scenes.flatMap((s) => s.lines).filter((l) => l.style === "body");
  if (!lines.length) return null;
  const full = Math.max(...lines.map((l) => l.width));
  const filled = lines.filter((l) => l.width > full * 0.97);
  return filled.reduce((n, l) => n + l.text.replaceAll("­", "").trim().length, 0) / filled.length;
}

/**
 * The copyfitting report (design 2026-10-17): at each test width, the screens of page scenes that
 * need a content change the engine cannot make, two lines each. A scene that scrolls has none.
 */
export function copyfit(rd: ResolvedDocument, widths = TEST_WIDTHS): string[] {
  const cache = new PrepareCache(createFixedEngine(CHAR));
  return widths.flatMap((w) => {
    const pd = layout(rd, { width: w, height: 900 }, cache);
    const reports = pd.scenes.flatMap((s) => s.screens ?? []);
    const perLine = bodyChars(pd) ?? 0;
    const objects = rd.variants[pd.breakpoint]!.objects;
    const lines = (k: number): string => `${k} line${k === 1 ? "" : "s"}`;
    return reports.flatMap((r) => [
      ...(r.short >= 1
        ? [
            `screen ${r.screen} at ${w}px: ${lines(r.short)} short of the bottom line.`,
            `  Add about ${Math.round((r.short * perLine) / 10) * 10} characters to "${r.lastParagraph}…"${r.photo ? `, or let ${r.photo} grow by ${lines(r.short)} (size=wide)` : ""}.`,
          ]
        : []),
      ...r.far.flatMap((f) => [
        `screen ${r.screen} at ${w}px: ${f.object} is ${f.screens} screens from its paragraph; it had no room nearer.`,
        `  Make it size=column, or move \\${objects[f.object]?.kind ?? "figure"} later in the story.`,
      ]),
    ]);
  });
}

/** Comfortable reading: about 45 to 75 characters a line; a phone, at least 30. */
export function tooShortOrLong(l: LineLength): boolean {
  return l.variant === "phone" ? l.chars < 30 : l.chars < 45 || l.chars > 75;
}
