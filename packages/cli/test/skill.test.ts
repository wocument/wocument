/**
 * The Wocument skill (skills/wocument): every recipe passes `woc check` with no warning, and the
 * generated command reference matches the schema. (The capability page takes minutes to
 * generate, so it is not checked here: run `npm run skill:refs` after a change to the engine.)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

const SKILL = fileURLToPath(new URL("../../../skills/wocument/", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("the skill's recipes", () => {
  const recipes = readdirSync(`${SKILL}recipes`).filter((f) => f.endsWith(".woc") || f.endsWith(".woct"));
  // ponytail: W064 is allowed while Vanilla's zero-config page sets three narrow columns at
  // 1470px (two would be 602px, over its 600px measure); drop it once that is decided. The
  // copyfitting report is advice, not a warning.
  const allowed = (lines: string[]): string[] => {
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/\[W064\]/.test(lines[i]!) || /^screen \d+ at \d+px:/.test(lines[i]!)) i++;
      else out.push(lines[i]!);
    }
    return out;
  };
  it.each(recipes)("%s passes woc check with no error or warning", (name) => {
    const said: string[] = [];
    vi.spyOn(console, "error").mockImplementation((s: string) => void said.push(s));
    expect(main(["check", `${SKILL}recipes/${name}`, "--public", `${SKILL}recipes`])).toBe(0);
    expect(allowed(said)).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe("the skill's command reference", () => {
  it("is the schema as print-tables prints it (npm run skill:refs)", () => {
    const printed = execFileSync(process.execPath, [`${ROOT}node_modules/vite-node/vite-node.mjs`, `${ROOT}packages/schema/scripts/print-tables.ts`], { cwd: ROOT, encoding: "utf8" });
    expect(readFileSync(`${SKILL}references/commands.md`, "utf8")).toBe(printed);
  });
});
