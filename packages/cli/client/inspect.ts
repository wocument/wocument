/**
 * What a laid-out page says about itself, for tools such as the skill's render check
 * (`page.html?doc=name&inspect`): per screen, the holes inside columns and the layout decisions
 * worth a look, in the visor's words. Read from the Positioned Document and its decision log only.
 */
import type { Decision, PositionedDocument } from "@wocument/layout";
import { buildModel, cardOf } from "@wocument/visor";

export type Finding = { scene: string; screen: number | null; kind: string; reason: string; title: string; detail: string };
export type Report = { viewport: { width: number; height: number }; breakpoint: string; height: number; findings: Finding[]; counts: Record<string, number> };

/** Reasons a reader would notice: text moved, a page ending short, a picture that found no good spot, a gap. */
const NOTABLE = new Set([
  "column-end:levelled",
  "column-end:orphans",
  "column-end:widows",
  "column-end:rule-3-cut",
  "column-end:stub-folded",
  "picture:fallback-budget",
  "picture:fallback-no-spot",
  "picture:waited",
  "space:slot-too-narrow",
  "space:early-end",
  "space:cropped",
  "space:grown",
  "line:loose",
  "line:tight",
]);

export function report(pd: PositionedDocument): Report {
  const findings: Finding[] = [];
  const counts: Record<string, number> = {};
  if (pd.explain)
    for (const s of buildModel(pd, pd.explain)) {
      for (const g of s.shapes.filter((x) => x.kind === "gap"))
        findings.push({ scene: s.scene, screen: s.screen, kind: "gap", reason: "gap", title: "Empty room inside a column", detail: g.label ?? "" });
      for (const d of s.decisions as Decision[]) {
        const key = `${d.kind}:${d.reason}`;
        counts[key] = (counts[key] ?? 0) + 1;
        if (!NOTABLE.has(key)) continue;
        const card = cardOf(d);
        findings.push({ scene: s.scene, screen: s.screen, kind: d.kind, reason: d.reason, title: card.title, detail: card.body });
      }
    }
  return { viewport: pd.viewport, breakpoint: pd.breakpoint, height: pd.height, findings, counts };
}
