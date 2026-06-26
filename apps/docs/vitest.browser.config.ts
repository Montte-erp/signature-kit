import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeConfig } from "vitest/config";

import baseBrowserConfig from "../../tooling/vitest/browser.config";

// Docs-scoped browser config: the shared Playwright/Chromium browser setup PLUS
// the `@` path alias the docs components use (e.g. `@/paraglide/messages` inside
// components/pdf-page.tsx). Run the docs browser test with an explicit file:
//   vitest run --config apps/docs/vitest.browser.config.ts \
//     apps/docs/__tests__/pdf-page.browser.test.tsx
const docsRoot = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(baseBrowserConfig, {
  resolve: {
    alias: {
      "@": docsRoot,
    },
  },
});
