import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeConfig } from "vitest/config";

import { contentTestServer } from "./scripts/content-test-server.ts";

import baseBrowserConfig from "../../tooling/vitest/browser.config.ts";

const docsRoot = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(baseBrowserConfig, {
  plugins: [contentTestServer],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": docsRoot,
    },
  },
});
