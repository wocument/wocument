/**
 * Readability warnings (2026-10-09; from the readability research, spec §15.6). Checked per
 * variant on the resolved values, so a theme or document that changes Vanilla is caught where it
 * lands: body text under 16px (W060), leading under 1.4 of its size (W061), body weight under 350
 * (W063), and text colours under 4.5:1 against their paper (W062, WCAG 2.2 AA). Line length needs
 * layout, so it is the CLI's (W064). Pure: no layout, no DOM.
 */

import type { Len, Palette, Variant } from "@wmxdsl/resolved-document";

export type Readability = { code: string; message: string; variant: string; fix: string };

/** A length in px where it can be known without a viewport: a fluid size at its smallest. */
function px(l: Len, baseline: number, size = 16): number | null {
  if (l.u === "px") return l.n;
  if (l.u === "fluid") return l.min;
  if (l.u === "bl") return l.n * baseline;
  if ((l.u as string) === "em") return (l as unknown as { n: number }).n * size;
  return null;
}

/** WCAG relative luminance of `#rrggbb` or `#rrggbbaa`, the colour laid over `under` by its alpha. */
function luminance(hex: string, under?: [number, number, number]): number {
  const [r, g, b] = rgb(hex, under);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function rgb(hex: string, under?: [number, number, number]): [number, number, number] {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return under ? (c.map((v, i) => v * a + under[i]! * (1 - a)) as [number, number, number]) : c;
}

export function contrast(fg: string, bg: string): number {
  const paper = rgb(bg);
  const [a, b] = [luminance(fg, paper), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function readability(variants: readonly (readonly [string, Variant])[]): Readability[] {
  // One warning per problem: the breakpoints (and scenes) it shows at are listed in it.
  const found = new Map<string, { code: string; detail: string; fix: string; where: string[] }>();
  const add = (code: string, detail: string, fix: string, where: string) => {
    const f = found.get(code + detail) ?? { code, detail, fix, where: [] };
    if (!f.where.includes(where)) f.where.push(where);
    found.set(code + detail, f);
  };
  for (const [bp, v] of variants) {
    const body = v.styles["body"];
    const baseline = v.scenes[0]?.grid.baseline ?? 28;
    if (body) {
      const size = px(body.size, baseline);
      const leading = px(body.leading, baseline, size ?? 16);
      if (size !== null && size < 16) add("W060", `Body text is ${round(size)}px; under 16px is hard to read on screen.`, "Set the body style's size to 16px or more.", bp);
      if (size !== null && leading !== null && leading < 1.4 * size)
        add("W061", `Body leading is ${round(leading / size, 2)} times the text size; under 1.4 makes lines hard to follow.`, "Set leading to 1.4 to 1.65 times the size (on the grid: a baseline step that large).", bp);
      if (body.weight < 350) add("W063", `Body weight is ${body.weight}; under 350 is faint at reading sizes.`, "Use a regular (400) or medium (500) weight for running text.", bp);
    }
    // Every palette a scene uses: its text roles against its paper.
    for (const scene of v.scenes) {
      const p: Palette = scene.palette;
      for (const role of ["ink", "muted", "accent"] as const) {
        const c = contrast(p[role], p.paper);
        if (c < 4.5)
          add("W062", `The ${role} colour ${p[role].slice(0, 7)} on paper ${p.paper.slice(0, 7)} has a contrast of ${round(c, 2)}:1; text needs 4.5:1.`, `Darken or lighten ${role} until it reaches 4.5:1 against paper.`, `scene ${scene.id}`);
      }
    }
  }
  return [...found.values()].map((f) => ({ code: f.code, message: f.detail.replace(";", ` (${f.where.join(", ")});`), variant: f.code === "W062" ? "" : f.where[0]!, fix: f.fix }));
}

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
