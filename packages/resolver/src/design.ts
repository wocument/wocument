/**
 * The design head resolved per breakpoint: breakpoints, grids, palettes and
 * styles (spec §07). Everything here reads the cascade through `Definitions`
 * and falls back to the schema's defaults, never to a table of its own.
 */

import type { BreakpointRange, Grid, Len, Palette, ResolvedStyle } from "@wmxdsl/resolved-document";
import type { Value } from "@wmxdsl/schema";
import { type Attrs, Definitions, schemaDefaults } from "./definitions.js";
import { type LenContext, toLen, toPx } from "./units.js";

export const BASE = "base";

// An intersection, not Extract: some variants are tagged `t: "integer" | "number"`.
const need = <T extends Value["t"]>(v: Value | undefined, t: T, what: string): Value & { t: T } => {
  if (!v || v.t !== t) throw new Error(`${what}: expected ${t}, got ${v ? v.raw : "nothing"}`);
  return v as Value & { t: T };
};

export class Design {
  private readonly styles = new Map<string, ResolvedStyle>();

  constructor(readonly defs: Definitions) {}

  // -------------------------------------------------------------------------
  // Breakpoints (spec §07.4)
  // -------------------------------------------------------------------------

  private named(): { name: string; min: number; max: number | null }[] {
    const ctx: LenContext = { em: null, baseline: null, fluidTo: 0 };
    return this.defs
      .names("breakpoint")
      .map((name) => {
        const a = this.defs.attrs("breakpoint", name, BASE);
        return {
          name,
          min: a.has("min") ? toPx(a.get("min")!, ctx) : 0,
          max: a.has("max") ? toPx(a.get("max")!, ctx) : null,
        };
      })
      .sort((x, y) => x.min - y.min);
  }

  /** Total half-open cover from 0: a named range runs to the next range's start; gaps are base. */
  breakpoints(): BreakpointRange[] {
    const out: BreakpointRange[] = [];
    const push = (minWidth: number, variant: string): void => {
      if (out.at(-1)?.variant !== variant) out.push({ minWidth, variant });
    };
    let cursor = 0;
    for (const b of this.named()) {
      if (b.min > cursor) push(cursor, BASE);
      push(b.min, b.name);
      cursor = b.max === null ? Number.POSITIVE_INFINITY : b.max + 1;
    }
    if (cursor !== Number.POSITIVE_INFINITY) push(cursor, BASE);
    if (out[0]?.minWidth !== 0) out.unshift({ minWidth: 0, variant: BASE });
    return out;
  }

  /** `base`, then named breakpoints from widest to narrowest. */
  variants(): string[] {
    return [BASE, ...this.named().reverse().map((b) => b.name)];
  }

  // -------------------------------------------------------------------------
  // Grids (spec §07.5)
  // -------------------------------------------------------------------------

  grid(name: string, bp: string): Grid {
    if (!this.defs.has("grid", name)) throw new Error(`unknown grid ${name}`);
    const a = withDefaults(this.defs.attrs("grid", name, bp), schemaDefaults("grid"));
    const baseline = toPx(a.get("baseline")!, { em: null, baseline: null, fluidTo: 0 });
    const ctx: LenContext = { em: null, baseline, fluidTo: this.fluidTo(bp) };
    const cols = need(a.get("cols"), "integer", "grid cols").n;
    const margin = a.get("margin");
    const len = (k: string): Len => toLen(a.get(k)!, ctx);
    const body = need(a.get("body"), "range", "grid body");
    const gutter = len("gutter");
    return {
      name,
      cols,
      gutter,
      marginX: margin && !this.setsOwn("grid", name, bp, "margin-x") ? toLen(margin, ctx) : len("margin-x"),
      marginY: margin && !this.setsOwn("grid", name, bp, "margin-y") ? toLen(margin, ctx) : len("margin-y"),
      max: len("max"),
      baseline,
      rows: need(a.get("rows"), "integer", "grid rows").n,
      rowGap: a.has("row-gap") ? len("row-gap") : gutter,
      body: { from: body.from, to: body.to === "end" ? cols : body.to },
      outdent: len("outdent"),
    };
  }

  private setsOwn(command: string, name: string, bp: string, key: string): boolean {
    return this.defs.attrs(command, name, bp).has(key);
  }

  /** Upper end of two-argument fluid(): grid `default`'s max at this breakpoint. */
  fluidTo(bp: string): number {
    const a = withDefaults(this.defs.attrs("grid", "default", bp), schemaDefaults("grid"));
    return toPx(a.get("max")!, { em: null, baseline: null, fluidTo: 0 });
  }

  // -------------------------------------------------------------------------
  // Palettes (spec §07.3)
  // -------------------------------------------------------------------------

  palette(name: string, bp: string): Palette {
    if (!this.defs.has("palette", name)) throw new Error(`unknown palette ${name}`);
    const own = this.defs.attrs("palette", name, bp);
    const fallback = this.defs.attrs("palette", "default", bp);
    const role = (r: keyof Palette): string => `#${need(own.get(r) ?? fallback.get(r), "color", `palette ${name} ${r}`).hex}`;
    return { paper: role("paper"), ink: role("ink"), muted: role("muted"), accent: role("accent"), rule: role("rule") };
  }

  // -------------------------------------------------------------------------
  // Styles (spec §07.6)
  // -------------------------------------------------------------------------

  /** Properties a style sets, with `extends` flattened in (own properties win). */
  private styleAttrs(name: string, bp: string, seen: string[] = []): Attrs {
    if (seen.includes(name)) throw new Error(`style extends cycle: ${[...seen, name].join(" -> ")}`);
    if (!this.defs.has("style", name)) throw new Error(`unknown style ${name}`);
    const own = this.defs.attrs("style", name, bp);
    const parent = own.get("extends");
    if (!parent || parent.t !== "ident") return own;
    return new Map([...this.styleAttrs(parent.id, bp, [...seen, name]), ...own]);
  }

  /** A block style, flattened. */
  style(name: string, bp: string): ResolvedStyle {
    const key = `${bp}|${name}`;
    const hit = this.styles.get(key);
    if (hit) return hit;
    const a = withDefaults(this.styleAttrs(name, bp), schemaDefaults("style"));
    const style = flatten(a, this.fluidTo(bp), null);
    this.styles.set(key, style);
    return style;
  }

  /**
   * Any style key: a style name, or a composed run key such as
   * `body+strong+em+link` or `pullquote+cite`. Modifiers apply in key order:
   *   strong   weight 700, or 900 when already 700 or heavier
   *   em       italic flips: upright inside an italic style
   *   code, link, span:<name>
   *            the character style's own properties, `em` relative to the text
   *            it sits in; `link` is also underlined (§16)
   *   cite     upright
   *   endmark  the accent color
   */
  styleKey(key: string, bp: string): ResolvedStyle {
    const cacheKey = `${bp}|${key}`;
    const hit = this.styles.get(cacheKey);
    if (hit) return hit;
    const [base, ...mods] = key.split("+");
    let s = this.style(base!, bp);
    for (const m of mods) {
      if (m === "strong") s = { ...s, weight: s.weight >= 700 ? 900 : 700 };
      else if (m === "em") s = { ...s, italic: !s.italic };
      // §07.6 (2026-09-29): a `cite` style, where a theme defines one, sets the attribution over its container.
      else if (m === "cite") s = this.defs.has("style", "cite") ? flatten(this.styleAttrs("cite", bp), this.fluidTo(bp), { ...s, italic: false }) : { ...s, italic: false };
      else if (m === "endmark") s = { ...s, color: { role: "accent" } };
      else {
        const name = m.startsWith("span:") ? m.slice(5) : m;
        s = flatten(this.styleAttrs(name, bp), this.fluidTo(bp), s);
        if (m === "link") s = { ...s, underline: true };
      }
    }
    this.styles.set(cacheKey, s);
    return s;
  }
}

function withDefaults(own: Attrs, defaults: Attrs): Attrs {
  return new Map([...defaults, ...own]);
}

/**
 * The flat style. With no `base`, `a` holds every property (defaults merged in).
 * With a `base`, `a` holds only what a character style sets, laid over the base,
 * and `em` in its size is relative to the base's size. `size` comes first
 * because `em` in every other length is relative to it.
 */
function flatten(a: Attrs, fluidTo: number, base: ResolvedStyle | null): ResolvedStyle {
  const size = a.has("size") ? toLen(a.get("size")!, { em: base?.size ?? null, baseline: null, fluidTo }) : base!.size;
  const ctx: LenContext = { em: size, baseline: null, fluidTo };
  const pick = <K extends keyof ResolvedStyle>(k: string, field: K, f: (v: Value) => ResolvedStyle[K]): ResolvedStyle[K] =>
    a.has(k) ? f(a.get(k)!) : base![field];
  const len = (v: Value): Len => toLen(v, ctx);
  const enumOf = (v: Value) => need(v, "enum", "enum").id as never;
  const bool = (v: Value): boolean => need(v, "boolean", "boolean").b;
  const int = (v: Value): number => need(v, "integer", "integer").n;
  return {
    // No family anywhere: the generic serif, as §16's body uses.
    family: a.has("family") ? splitList(need(a.get("family"), "string", "family").s) : (base?.family ?? ["serif"]),
    weight: pick("weight", "weight", int),
    italic: pick("italic", "italic", bool),
    size,
    leading: pick("leading", "leading", len),
    tracking: pick("tracking", "tracking", len),
    case: pick("case", "case", enumOf),
    align: pick("align", "align", enumOf),
    color: pick("color", "color", (c) => (c.t === "role" ? { role: c.id as "ink" } : { hex: `#${need(c, "color", "color").hex}` })),
    underline: base?.underline ?? false,
    indent: pick("indent", "indent", len),
    spaceBefore: pick("space-before", "spaceBefore", len),
    spaceAfter: pick("space-after", "spaceAfter", len),
    hyphenate: pick("hyphenate", "hyphenate", bool),
    widows: pick("widows", "widows", int),
    orphans: pick("orphans", "orphans", int),
    keepWithNext: pick("keep-with-next", "keepWithNext", bool),
    balance: pick("balance", "balance", bool),
    hyphenMark: pick("hyphen-mark", "hyphenMark", enumOf),
    composer: pick("composer", "composer", enumOf),
    hyphenateMin: pick("hyphenate-min", "hyphenateMin", int),
    hyphenateCaps: pick("hyphenate-caps", "hyphenateCaps", bool),
    hang: pick("hang", "hang", enumOf),
    bindShort: pick("bind-short", "bindShort", bool),
    justifyMin: a.has("justify-min") ? len(a.get("justify-min")!) : (base?.justifyMin ?? null),
    minSlot: a.has("min-slot") ? len(a.get("min-slot")!) : (base?.minSlot ?? null),
    mark: a.has("mark") ? need(a.get("mark"), "string", "mark").s : (base?.mark ?? null),
    features: pick("features", "features", (v) => need(v, "string", "features").s.split(/\s+/).filter(Boolean)),
    snap: pick("snap", "snap", enumOf),
    fit: a.has("fit")
      ? enumOf(a.get("fit")!) === "width"
        ? { max: a.has("fit-max") ? len(a.get("fit-max")!) : null, height: a.has("fit-height") ? len(a.get("fit-height")!) : null }
        : null
      : (base?.fit ?? null),
  };
}

/** A CSS-style family list: `"Tiempos Text", serif` -> ["Tiempos Text", "serif"]. */
function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}
