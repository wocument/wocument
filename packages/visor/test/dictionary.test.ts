/** The visor's reason dictionary: a sentence and a rule for every reason code layout can log. */

import { describe, expect, it } from "vitest";
import { COLUMN_END_REASONS, LINE_REASONS, PICTURE_REASONS, SPACE_REASONS, type Decision } from "@wmxdsl/layout";
import { DICTIONARY, describe as describeDecision } from "../src/index.js";

const lists = { "column-end": COLUMN_END_REASONS, picture: PICTURE_REASONS, space: SPACE_REASONS, line: LINE_REASONS } as const;
const decision = (kind: Decision["kind"], reason: string, numbers: Record<string, number> = {}): Decision => ({
  kind, reason, screen: 1, frame: "f", column: 0, at: { x: 0, y: 0, width: 10, height: 10 }, numbers, refs: {}, rule: "§09.7 rule 11",
});

describe("the reason dictionary", () => {
  it("every reason code has an entry", () => {
    for (const [kind, codes] of Object.entries(lists) as [Decision["kind"], readonly string[]][]) {
      expect(Object.keys(DICTIONARY[kind]).sort()).toEqual([...codes].sort());
      for (const code of codes) {
        const card = describeDecision(decision(kind, code, { lines: 3, height: 280, score: 7, px: 28, width: 44, min: 162, left: 4, right: 5, ratio: 1.6, reasonCode: 1 }));
        expect(card.title.length, `${kind}/${code}`).toBeGreaterThan(0);
        expect(card.body).toMatch(/\.$/);
        expect(card.body).not.toContain("undefined");
        expect(card.rule).toBe("§09.7 rule 11");
      }
    }
  });

  it("reads the numbers into the sentence", () => {
    expect(describeDecision(decision("column-end", "levelled", { lines: 2 })).body).toContain("2 lines");
    expect(describeDecision(decision("column-end", "picture-at-foot")).title).toBe("The column ends with a picture or quote");
  });
});
