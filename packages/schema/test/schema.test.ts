import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  COMMAND_NAMES,
  DEFINITION_COMMANDS,
  INLINE_CLASS_NAMES,
  PARAGRAPH,
  ROLES,
  TOKENREF_OK,
  UNITS,
  type AttrSchema,
} from "@wmxdsl/schema";

/** Grammar §06: the complete command table. */
const GRAMMAR_TABLE: Record<string, { arity: string; kind: string | null }> = {
  font: { arity: "none", kind: null },
  token: { arity: "none", kind: null },
  palette: { arity: "none", kind: null },
  breakpoint: { arity: "none", kind: null },
  grid: { arity: "none", kind: null },
  style: { arity: "none", kind: null },
  parent: { arity: "optional", kind: "scene" },
  folio: { arity: "required", kind: "inline" },
  story: { arity: "required", kind: "block" },
  scene: { arity: "required", kind: "scene" },
  frame: { arity: "optional", kind: "block" },
  group: { arity: "required", kind: "struct" },
  kicker: { arity: "required", kind: "inline" },
  headline: { arity: "required", kind: "inline" },
  deck: { arity: "required", kind: "inline" },
  byline: { arity: "required", kind: "inline" },
  meta: { arity: "required", kind: "inline" },
  lede: { arity: "required", kind: "inline" },
  subhead: { arity: "required", kind: "inline" },
  bio: { arity: "required", kind: "inline" },
  caption: { arity: "required", kind: "inline" },
  credit: { arity: "required", kind: "inline" },
  title: { arity: "required", kind: "inline" },
  cite: { arity: "required", kind: "inline" },
  blockquote: { arity: "required", kind: "block" },
  pullquote: { arity: "required", kind: "block" },
  sidebar: { arity: "required", kind: "block" },
  figure: { arity: "optional", kind: "struct" },
  video: { arity: "optional", kind: "struct" },
  embed: { arity: "optional", kind: "struct" },
  lottie: { arity: "optional", kind: "struct" },
  audio: { arity: "optional", kind: "struct" },
  gallery: { arity: "required", kind: "struct" },
  dropcap: { arity: "none", kind: null },
  framebreak: { arity: "none", kind: null },
  rule: { arity: "none", kind: null },
  music: { arity: "none", kind: null },
  br: { arity: "none", kind: null },
  endmark: { arity: "none", kind: null },
  span: { arity: "required", kind: "inline" },
};

describe("command table (grammar §06)", () => {
  it("covers exactly the commands the grammar lists", () => {
    expect([...COMMAND_NAMES].sort()).toEqual(Object.keys(GRAMMAR_TABLE).sort());
  });

  it("matches the grammar on body arity and kind", () => {
    for (const [name, want] of Object.entries(GRAMMAR_TABLE)) {
      const c = COMMANDS.get(name);
      expect(c, name).toBeDefined();
      expect({ arity: c?.arity, kind: c?.kind ?? null }, name).toEqual(want);
    }
  });

  it("gives a body kind to every command that takes a body, and none otherwise", () => {
    for (const c of COMMANDS.values()) {
      if (c.arity === "none") expect(c.kind, c.name).toBeNull();
      else expect(c.kind, c.name).not.toBeNull();
    }
  });

  it("marks exactly \\br, \\span and \\endmark as inline-class", () => {
    const inline = [...COMMANDS.values()].filter((c) => c.class === "inline").map((c) => c.name);
    expect(inline.sort()).toEqual(["br", "endmark", "span"]);
    expect([...INLINE_CLASS_NAMES].sort()).toEqual(["br", "endmark", "span"]);
  });
});

describe("schema integrity", () => {
  it("references only child names that exist", () => {
    for (const c of COMMANDS.values()) {
      for (const child of c.children) {
        if (child === PARAGRAPH) continue;
        expect(COMMANDS.has(child), `${c.name} -> ${child}`).toBe(true);
      }
    }
  });

  it("limits to one occurrence only children it actually allows", () => {
    for (const c of COMMANDS.values()) {
      for (const child of c.maxOnce) {
        expect(c.children.includes(child), `${c.name} maxOnce ${child}`).toBe(true);
      }
    }
  });

  it("gives every attribute at least one declared type", () => {
    for (const c of COMMANDS.values()) {
      for (const [k, a] of Object.entries(c.attrs)) {
        expect(a.types.length, `${c.name}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("declares enum members exactly when the type is enum", () => {
    for (const c of COMMANDS.values()) {
      for (const [k, a] of Object.entries(c.attrs)) {
        const isEnum = a.types.includes("enum");
        expect(isEnum === (a.enum !== undefined), `${c.name}.${k}`).toBe(true);
        if (isEnum) expect((a.enum ?? []).length, `${c.name}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("declares a pair element type exactly when the type is pair", () => {
    for (const c of COMMANDS.values()) {
      for (const [k, a] of Object.entries(c.attrs)) {
        expect(a.types.includes("pair") === (a.pairOf !== undefined), `${c.name}.${k}`).toBe(true);
      }
    }
  });

  it("never marks an attribute both required and defaulted", () => {
    for (const c of COMMANDS.values()) {
      for (const [k, a] of Object.entries(c.attrs)) {
        expect(a.required === true && a.default !== undefined, `${c.name}.${k}`).toBe(false);
      }
    }
  });

  it("spells every default in a form the attribute accepts", async () => {
    const { typeValue } = await import("../../parser/src/values.js");
    const { lexAttrList } = await import("../../parser/src/attrs.js");
    const { Diagnostics } = await import("../../parser/src/diagnostics.js");
    const { PositionIndex } = await import("../../parser/src/positions.js");
    for (const c of COMMANDS.values()) {
      for (const [k, a] of Object.entries(c.attrs)) {
        if (a.default === undefined) continue;
        if (a.types.includes("any")) continue;
        const src = `[v=${a.default}]`;
        const diags = new Diagnostics();
        const lexed = lexAttrList(src, 0, diags, new PositionIndex(src));
        const attr = lexed.list.attrs[0];
        expect(attr, `${c.name}.${k} default ${a.default} did not lex`).toBeDefined();
        const r = typeValue(attr!.value, a as AttrSchema);
        expect(r.ok, `${c.name}.${k} default ${a.default}: ${r.ok ? "" : r.expected}`).toBe(true);
      }
    }
  });

  it("marks the non-responsive attributes grammar §06.1 lists", () => {
    const alwaysFixed = ["name", "at", "extends", "story", "parent", "provider"];
    for (const c of COMMANDS.values()) {
      for (const key of alwaysFixed) {
        const a = c.attrs[key];
        if (a === undefined) continue;
        expect(a.responsive, `${c.name}.${key}`).toBe(false);
      }
    }
    for (const name of ["font", "token", "breakpoint"]) {
      const c = COMMANDS.get(name);
      for (const [k, a] of Object.entries(c?.attrs ?? {})) {
        expect(a.responsive, `${name}.${k}`).toBe(false);
      }
    }
  });

  it("keeps the palette role set and the unit set closed", () => {
    expect([...ROLES]).toEqual(["paper", "ink", "muted", "accent", "rule"]);
    expect([...UNITS]).toEqual(["px", "rem", "em", "%", "vw", "vh", "col", "bl"]);
    expect([...TOKENREF_OK].sort()).toEqual(
      ["color", "integer", "length", "number", "percentage", "ratio", "string", "time"].sort(),
    );
  });

  it("treats every definition command as a definition", () => {
    expect([...DEFINITION_COMMANDS].sort()).toEqual(
      ["breakpoint", "font", "grid", "palette", "parent", "style", "token"].sort(),
    );
  });

  it("keeps \\embed rectangular", () => {
    const embed = COMMANDS.get("embed");
    expect(embed?.attrs.shape).toBeUndefined();
    expect(embed?.attrs.clip).toBeUndefined();
  });

  it("gives the shape group only to objects with pixels", () => {
    const withShape = [...COMMANDS.values()].filter((c) => c.attrs.shape !== undefined).map((c) => c.name);
    expect(withShape.sort()).toEqual(["figure", "lottie", "video"]);
  });

  it("staggers only containers", () => {
    const withStagger = [...COMMANDS.values()].filter((c) => c.attrs.stagger !== undefined).map((c) => c.name);
    expect(withStagger.sort()).toEqual(["group", "parent", "scene"]);
  });

  it("gives every object the placement, wrap and reveal groups", () => {
    const objects = ["figure", "video", "embed", "lottie", "audio", "gallery", "pullquote", "sidebar"];
    for (const name of objects) {
      const a = COMMANDS.get(name)?.attrs ?? {};
      for (const key of ["cols", "rows", "top", "height", "bleed", "layer", "z", "hide", "side", "width", "wrap", "wrap-side", "wrap-offset", "enter", "exit"]) {
        expect(a[key], `${name}.${key}`).toBeDefined();
      }
    }
  });
});

describe("child lists", () => {
  it("lists every child at most once", () => {
    for (const c of COMMANDS.values()) {
      expect(new Set(c.children).size, c.name).toBe(c.children.length);
    }
  });
});
