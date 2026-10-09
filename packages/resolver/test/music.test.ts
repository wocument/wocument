/** `\music` soundtrack cues (spec §10.6, 2026-10-09). */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { checkInvariants, type ResolvedDocument } from "@wmxdsl/resolved-document";
import { resolve, type AssetHost } from "../src/index.js";

const FM = "---\nwmxdsl: 1\ntitle: T\n---\n";
const host: AssetHost = {
  image: () => null,
  contour: () => null,
  file: (p) => (p.endsWith(".mp3") ? { url: p, type: "audio/mpeg" } : null),
};
function run(body: string): ResolvedDocument {
  const p = parse(FM + body, { file: "t.wmx" });
  expect(p.diagnostics).toEqual([]);
  const { doc } = resolve(p.ast as Document, { assets: host });
  expect(checkInvariants(doc)).toEqual([]);
  return doc;
}

describe("\\music", () => {
  it("in a story, cues before the next block, with its defaults", () => {
    const d = run("\\story[name=s]{One.\n\n\\music[src=/a.mp3]\n\nTwo.}\n\\scene{\\frame[story=s]}");
    expect(d.music).toEqual([{ at: { story: "s", block: 1 }, audio: "audio:/a.mp3", fadeMs: 2000, volume: 0.8, loop: true, enterAt: 0.5 }]);
    expect(d.assets["audio:/a.mp3"]).toEqual({ kind: "audio", sources: [{ type: "audio/mpeg", url: "/a.mp3" }] });
    // The cue is not a block: the story holds only its two paragraphs.
    expect(d.variants.base!.stories.s!.blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
  });

  it("src=none fades out; settings carry through", () => {
    const d = run("\\story[name=s]{One.\n\n\\music[src=none, fade=3s, volume=40%, loop=false, enter-at=20%]\n\nTwo.}\n\\scene{\\frame[story=s]}");
    expect(d.music).toEqual([{ at: { story: "s", block: 1 }, audio: null, fadeMs: 3000, volume: 0.4, loop: false, enterAt: 0.2 }]);
  });

  it("written straight in an explicit scene, cues at the scene's top", () => {
    const d = run("\\story[name=s]{One.}\n\\scene[name=open]{\\music[src=/b.mp3]\n\\frame[story=s]}");
    expect(d.music.map((m) => m.at)).toEqual([{ scene: "open" }]);
  });

  it("in a shorthand scene, cues in its story", () => {
    const d = run("\\scene{One.\n\n\\music[src=/c.mp3]\n\nTwo.}");
    expect(d.music).toHaveLength(1);
    expect("story" in d.music[0]!.at).toBe(true);
  });

  it("a document without cues has an empty list", () => {
    expect(run("Plain.").music).toEqual([]);
  });
});
