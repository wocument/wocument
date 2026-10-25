/**
 * The reason dictionary (design 2026-10-21): a title and a sentence for every reason code layout
 * logs, with its spec rule. Pure. Each code has one wording per voice; only the engineer's voice
 * exists so far, and an author's wording can go beside it without engine changes.
 */

import type { ColumnEndReason, Decision, LineReason, PictureReason, SpaceReason } from "@wocument/layout";

export type Voice = "engineer";
type N = Record<string, number>;
export type Entry = { title: string; body: (n: N) => string };

const lines = (k: number | undefined): string => `${k ?? 0} line${k === 1 ? "" : "s"}`;
const px = (k: number | undefined): string => `${Math.round(k ?? 0)}px`;

const COLUMN_END: Record<ColumnEndReason, Record<Voice, Entry>> = {
  "bottom-line": { engineer: { title: "Full to the bottom line", body: () => "The column reached the screen's locked bottom line." } },
  levelled: { engineer: { title: "Levelled", body: (n) => `The column was set ${lines(n.lines)} short so the page's columns end on the same line.` } },
  "rule-3-cut": { engineer: { title: "Cut to go on with the pictures", body: (n) => `The column was shortened by ${lines(n.lines)} so the text goes on to the next screen with its pictures.` } },
  "keep-with-next": { engineer: { title: "Kept with the next paragraph", body: () => "A subhead moved on to the next column with its paragraph." } },
  orphans: { engineer: { title: "Orphans", body: (n) => `${lines(n.lines)} moved on to protect the first lines of a paragraph.` } },
  widows: { engineer: { title: "Widows", body: (n) => `${lines(n.lines)} moved on to protect the last lines of a paragraph.` } },
  "hyphen-avoided": { engineer: { title: "Hyphen avoided", body: () => "The column's last line may not end in a hyphen, so the word carried over whole." } },
  "frame-break": { engineer: { title: "Frame break", body: () => "The author's frame break ends the column here." } },
  "column-break": { engineer: { title: "Column break", body: () => "The author's column break ends the column here." } },
  "story-end": { engineer: { title: "End of the story", body: () => "The story ended here." } },
  "balanced-last-page": { engineer: { title: "Balanced last page", body: (n) => `The last page holds whole paragraphs at the smallest height that fits (${px(n.height)}).` } },
  "stub-folded": { engineer: { title: "Short last page folded back", body: (n) => `A short last page of ${lines(n.lines)} was folded back into this one.` } },
  "picture-at-foot": { engineer: { title: "The column ends with a picture or quote", body: () => "A picture or quote at the column's foot ends it." } },
};

const PICTURE: Record<PictureReason, Record<Voice, Entry>> = {
  chosen: { engineer: { title: "Best spot", body: (n) => `This spot had the best score of the spots tried (${n.score ?? 0}, lower is better).` } },
  "fallback-budget": { engineer: { title: "Fallback: search budget", body: () => "The search ran out of trials or the picture was past its window, so it took the fallback spot." } },
  "fallback-no-spot": { engineer: { title: "Fallback: no spot", body: () => "No spot within the picture's window could hold it, so it took the fallback spot." } },
  waited: { engineer: { title: "Waited", body: (n) => `The picture had no room on its anchor's screen and was set on a later one (score ${n.score ?? 0}).` } },
  here: { engineer: { title: "Set where it is anchored", body: () => "The object does not float; it is set at its place in the text." } },
};

const SPACE: Record<SpaceReason, Record<Voice, Entry>> = {
  "slot-too-narrow": { engineer: { title: "Strip too narrow", body: (n) => `The strip beside the object is ${px(n.width)} wide, under the ${px(n.min)} minimum, so it was left empty.` } },
  cropped: { engineer: { title: "Photograph cropped", body: (n) => `The photograph was trimmed by ${px(n.px)} so the page ends on the bottom line.` } },
  grown: { engineer: { title: "Photograph grown", body: (n) => `The photograph was extended by ${px(n.px)} so the page ends on the bottom line.` } },
  "early-end": { engineer: { title: "Screen ends short", body: (n) => `The screen ends ${lines(n.lines)} short of the bottom line.` } },
};

const LINE: Record<LineReason, Record<Voice, Entry>> = {
  ragged: { engineer: { title: "Ragged line", body: (n) => (n.reasonCode === 2 ? "The line is narrower than the justify minimum, so it is set ragged." : "The paragraph's last line is set ragged.") } },
  hung: { engineer: { title: "Hung punctuation", body: (n) => `Punctuation hangs outside the edge (${px(n.left)} left, ${px(n.right)} right).` } },
  hyphenated: { engineer: { title: "Hyphenated", body: () => "The line ends in a hyphen break." } },
  loose: { engineer: { title: "Loose line", body: (n) => `The spaces are stretched to ${n.ratio ?? 0} of a normal space.` } },
  tight: { engineer: { title: "Tight line", body: (n) => `The spaces are closed to ${n.ratio ?? 0} of a normal space.` } },
};

export const DICTIONARY: Record<Decision["kind"], Record<string, Record<Voice, Entry>>> = { "column-end": COLUMN_END, picture: PICTURE, space: SPACE, line: LINE };

export function describe(d: Decision, voice: Voice = "engineer"): { title: string; body: string; rule: string } {
  const entry = DICTIONARY[d.kind]?.[d.reason]?.[voice];
  if (!entry) return { title: d.reason, body: `No wording for the ${d.kind} code "${d.reason}".`, rule: d.rule };
  return { title: entry.title, body: entry.body(rounded(d.numbers)), rule: d.rule };
}

/** A number as the visor shows it: whole, or to one decimal for a ratio. */
export const round = (key: string, v: number): number => (/ratio/i.test(key) ? Math.round(v * 10) / 10 : Math.round(v));
const rounded = (n: N): N => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, round(k, v)]));
