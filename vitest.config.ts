import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Regression tests that lay out sample articles kept outside the repository; they run where the articles are. */
const articleTests: Record<string, string> = {
  "packages/layout/test/atlas.test.ts": "atlas.woc",
  "packages/layout/test/magazine.test.ts": "magazine.woc",
  "packages/layout/test/showcase.test.ts": "showcase.woc",
  "packages/layout/test/spread.test.ts": "spread.woc",
  "packages/layout/test/stress.test.ts": "stress-coast.woc",
};
const missing = Object.entries(articleTests)
  .filter(([, doc]) => !existsSync(r(`./packages/playground/docs/${doc}`)))
  .map(([test]) => test);

// A clone without the local articles runs fewer tests. Say so, so a green run is not read as the whole suite.
if (missing.length)
  console.warn(
    `\n[woc] Local sample articles are missing (packages/playground/docs is not in git).\n` +
      `[woc] Not run: ${missing.join(", ")}.\n` +
      `[woc] Tests that read one of those articles show as "skipped" in the summary.\n`,
  );

export default defineConfig({
  resolve: {
    alias: {
      "@wocument/schema": r("./packages/schema/src/index.ts"),
      "@wocument/parser": r("./packages/parser/src/index.ts"),
      "@wocument/resolved-document": r("./packages/resolved-document/src/index.ts"),
      "@wocument/resolver": r("./packages/resolver/src/index.ts"),
      "@wocument/assets": r("./packages/assets/src/index.ts"),
      "@wocument/text-engine": r("./packages/text-engine/src/index.ts"),
      "@wocument/layout": r("./packages/layout/src/index.ts"),
      "@wocument/renderer": r("./packages/renderer/src/index.ts"),
      "@wocument/visor": r("./packages/visor/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", ...missing],
    testTimeout: 30000,
  },
});
