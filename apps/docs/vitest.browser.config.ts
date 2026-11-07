import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

import baseBrowserConfig from "../../tooling/vitest/browser.config";
import { feedbackBfcache } from "./foldkit/feedback-bfcache-command";
import { feedbackBrowserServer } from "./foldkit/feedback-browser-server";
import { homeBrowserServer } from "./foldkit/home-browser-server";

const docsRoot = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(baseBrowserConfig, {
  plugins: [feedbackBrowserServer(docsRoot), homeBrowserServer()],
  test: {
    browser: {
      commands: { feedbackBfcache },
      provider: playwright({
        launchOptions: { channel: "chromium", ignoreDefaultArgs: ["--disable-back-forward-cache"] },
        contextOptions: { permissions: ["clipboard-read", "clipboard-write"] },
      }),
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": docsRoot,
    },
  },
});
