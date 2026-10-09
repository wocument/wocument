/** The soundtrack's choice of track (spec §10.6): the last cue above the reading position. */

import { describe, expect, it } from "vitest";
import type { PositionedDocument } from "@wmxdsl/layout";
import type { MusicCue, ResolvedDocument } from "@wmxdsl/resolved-document";
import { cuePositions, currentCue } from "../src/music.js";

const cue = (at: MusicCue["at"], audio: string | null, enterAt = 0.5): MusicCue => ({ at, audio, fadeMs: 2000, volume: 0.8, loop: true, enterAt });
const line = (block: number, y: number) => ({ story: "s", block, y, height: 30 });
const pd = {
  scenes: [
    { name: "open", y: 0, lines: [line(0, 100), line(1, 900)] },
    { name: "two", y: 2000, lines: [line(2, 2100), line(3, 2600)] },
  ],
} as unknown as PositionedDocument;
const rd = (music: MusicCue[]) => ({ music }) as unknown as ResolvedDocument;

describe("cuePositions", () => {
  it("a story cue sits at its block's first line; a scene cue at the scene's top; sorted by position", () => {
    const placed = cuePositions(rd([cue({ story: "s", block: 3 }, "b"), cue({ scene: "two" }, "a"), cue({ story: "s", block: 1 }, "c")]), pd);
    expect(placed.map((p) => [p.y, p.cue.audio])).toEqual([[900, "c"], [2000, "a"], [2600, "b"]]);
  });
  it("a cue after the story's last block sits under its last line", () => {
    expect(cuePositions(rd([cue({ story: "s", block: 9 }, "z")]), pd)[0]!.y).toBe(2630);
  });
});

describe("currentCue", () => {
  const placed = cuePositions(rd([cue({ story: "s", block: 1 }, "c"), cue({ story: "s", block: 3 }, null)]), pd);
  it("nothing before the first cue reaches half way up the screen", () => {
    expect(currentCue(placed, 0, 1000)).toBe(null);
  });
  it("the first cue once it is half way up; scrolling back above it restores silence", () => {
    expect(currentCue(placed, 400, 1000)?.audio).toBe("c");
    expect(currentCue(placed, 399, 1000)).toBe(null);
  });
  it("a later stop cue takes over", () => {
    expect(currentCue(placed, 2100, 1000)?.audio).toBe(null);
    expect(currentCue(placed, 2099, 1000)?.audio).toBe("c");
  });
});
