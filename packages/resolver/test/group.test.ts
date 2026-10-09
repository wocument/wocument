/**
 * `\group` (spec §11.11, design 2026-09-26): stacks and row groups resolve
 * with their children contained, frames keep their own records, and threads
 * run through groups in document order.
 */
import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { checkInvariants, type GroupObject } from "@wmxdsl/resolved-document";
import { resolve } from "../src/index.js";

const SRC = `---
wmxdsl: 1
title: Groups
---
\\story[name=main]{
  One. Two. Three.
}

\\scene[name=s]{
  \\group[layout=row, cols=all, valign=stretch, enter=fade, stagger=100ms]{
    \\group[min-width=7col, min-width@phone=4col]{
      \\pullquote{A quote.}
      \\frame[story=main]
    }
    \\pullquote[min-width=4col, max-width=5col, enter=rise]{Beside.}
    \\frame[width=3col]{Inline text.}
  }
  \\frame[story=main, cols=all]
}
`;

describe("\\group", () => {
  const parsed = parse(SRC);
  const { doc } = resolve(parsed.ast as Document);

  it("parses and resolves with every invariant held", () => {
    expect(parsed.diagnostics).toEqual([]);
    expect(checkInvariants(doc)).toEqual([]);
  });

  it("records layout, valign and each child's sizing, per breakpoint", () => {
    const v = doc.variants.base!;
    const row = v.objects["group-1"] as GroupObject;
    expect(row.layout).toBe("row");
    expect(row.valign).toBe("stretch");
    expect(row.children.map((c) => `${c.kind}:${c.id}`)).toEqual(["object:group-2", "object:pullquote-2", "frame:frame-2"]);
    expect(row.children[0]!.minWidth).toEqual({ u: "col", n: 7 });
    expect(row.children[1]!.maxWidth).toEqual({ u: "col", n: 5 });
    expect(row.children[2]!.width).toEqual({ u: "col", n: 3 });
    expect((doc.variants.phone!.objects["group-1"] as GroupObject).children[0]!.minWidth).toEqual({ u: "col", n: 4 });
    const stack = v.objects["group-2"] as GroupObject;
    expect(stack.layout).toBe("stack");
    expect(v.objects["group-2"]!.placement).toEqual({ mode: "contained", container: "group-1", index: 0 });
  });

  it("threads frames inside groups in document order", () => {
    expect(doc.variants.base!.threads.main).toEqual(["frame-1", "frame-3"]);
  });

  it("staggers the group's enter over children without their own, and keeps the group itself still", () => {
    const v = doc.variants.base!;
    expect(v.objects["group-1"]!.reveal.enter).toBe("none");
    expect(v.objects["group-2"]!.reveal.enter).toBe("none");
    // group-2 took group-1's fade at delay 0 and passes it on, staggered by the default 80ms.
    expect([v.objects["pullquote-1"]!.reveal.enter, v.objects["pullquote-1"]!.reveal.delayMs]).toEqual(["fade", 0]);
    expect([v.frames["frame-1"]!.reveal.enter, v.frames["frame-1"]!.reveal.delayMs]).toEqual(["fade", 80]);
    expect(v.objects["pullquote-2"]!.reveal.enter).toBe("rise");
    expect([v.frames["frame-2"]!.reveal.enter, v.frames["frame-2"]!.reveal.delayMs]).toEqual(["fade", 100]);
  });
});
