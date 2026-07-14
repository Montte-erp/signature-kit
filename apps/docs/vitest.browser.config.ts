import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeConfig } from "vitest/config";

import baseBrowserConfig from "../../tooling/vitest/browser.config";

const docsRoot = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(baseBrowserConfig, {
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": docsRoot,
    },
  },
});
