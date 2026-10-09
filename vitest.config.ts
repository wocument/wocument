import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Regression tests that lay out sample articles kept outside the repository; they run where the articles are. */
const articleTests: Record<string, string> = {
  "packages/layout/test/atlas.test.ts": "atlas.wmx",
  "packages/layout/test/magazine.test.ts": "magazine.wmx",
  "packages/layout/test/showcase.test.ts": "showcase.wmx",
  "packages/layout/test/spread.test.ts": "spread.wmx",
  "packages/layout/test/stress.test.ts": "stress-coast.wmx",
};
const missing = Object.entries(articleTests)
  .filter(([, doc]) => !existsSync(r(`./packages/playground/docs/${doc}`)))
  .map(([test]) => test);

export default defineConfig({
  resolve: {
    alias: {
      "@wmxdsl/schema": r("./packages/schema/src/index.ts"),
      "@wmxdsl/parser": r("./packages/parser/src/index.ts"),
      "@wmxdsl/resolved-document": r("./packages/resolved-document/src/index.ts"),
      "@wmxdsl/resolver": r("./packages/resolver/src/index.ts"),
      "@wmxdsl/assets": r("./packages/assets/src/index.ts"),
      "@wmxdsl/text-engine": r("./packages/text-engine/src/index.ts"),
      "@wmxdsl/layout": r("./packages/layout/src/index.ts"),
      "@wmxdsl/renderer": r("./packages/renderer/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", ...missing],
    testTimeout: 30000,
  },
});
