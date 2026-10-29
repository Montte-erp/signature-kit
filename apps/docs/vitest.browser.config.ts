import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

import { contentTestServer } from "./scripts/content-test-server.ts";

import baseBrowserConfig from "../../tooling/vitest/browser.config.ts";

const docsRoot = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(baseBrowserConfig, {
  test: {
    browser: {
      provider: playwright({
        contextOptions: { permissions: ["clipboard-read", "clipboard-write"] },
      }),
    },
  },
  plugins: [contentTestServer()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": docsRoot,
    },
  },
});
