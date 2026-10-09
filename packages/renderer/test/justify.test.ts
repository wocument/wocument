/** §07.6 `align=justify`: the slack goes into the line's spaces (the renderer, not the browser). */

import { describe, expect, it } from "vitest";
import { parse, type Document } from "@wmxdsl/parser";
import { resolve } from "@wmxdsl/resolver";
import { justifySpacing, renderStatic } from "../src/index.js";

describe("justifySpacing", () => {
  it("spreads the slack over the line's spaces", () => {
    expect(justifySpacing({ text: "one two three", width: 130, measured: 100 })).toBe(15);
  });

  it("ignores a trailing space: the last word ends at the slot's edge", () => {
    expect(justifySpacing({ text: "one two three ", width: 130, measured: 100 })).toBe(15);
  });

  it("sets a line flush left rather than open gaps wider than half an em (a sliver beside a picture)", () => {
    // 20px text: 10px extra a space at most.
    expect(justifySpacing({ text: "one two three", width: 120, measured: 100 }, 20)).toBe(10);
    expect(justifySpacing({ text: "lies living", width: 240, measured: 90 }, 20)).toBe(0);
  });

  it("leaves a line alone when it has no slack", () => {
    expect(justifySpacing({ text: "one two", width: 100, measured: 100 })).toBe(0);
  });

  it("closes the spaces of a line a little longer than its slot (the paragraph composer's), but no further", () => {
    // 20px text: a space closes by 1px at most.
    expect(justifySpacing({ text: "one two three", width: 98, measured: 100 }, 20)).toBe(-1);
    expect(justifySpacing({ text: "one two", width: 90, measured: 100 }, 20)).toBe(0);
  });

  it("leaves a single long word alone rather than dividing by zero", () => {
    expect(justifySpacing({ text: "incomprehensibilities", width: 300, measured: 100 })).toBe(0);
  });
});

describe("the reading version", () => {
  it("hands justification to the browser, which can break the lines itself", () => {
    const src = '---\nwmxdsl: 1\ntitle: T\n---\n\\style[name=body, align=justify]\n\\scene{\\frame{Set solid.}}';
    expect(renderStatic(resolve(parse(src).ast as Document).doc)).toContain("text-align: justify");
  });
});
