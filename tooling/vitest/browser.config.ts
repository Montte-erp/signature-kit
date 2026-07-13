import { playwright } from "@vitest/browser-playwright";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "@react-pdf/renderer",
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "color",
      "crypto-js",
      "pako",
      "node-html-better-parser",
      "warning",
      "use-sync-external-store/shim/with-selector",
    ],
    exclude: [
      "@aws-sdk/credential-provider-web-identity",
      "@aws-sdk/credential-providers",
      "@distilled.cloud/aws",
      "alchemy",
      "@llamaindex/liteparse-wasm",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../apps/docs", import.meta.url)),
      react: fileURLToPath(new URL("../../formats/react/node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(
        new URL("../../formats/react/node_modules/react-dom", import.meta.url),
      ),
    },
  },
  test: {
    include: ["**/*.browser.test.*"],
    deps: {
      optimizer: {
        client: { enabled: false },
        ssr: { enabled: false },
        web: { enabled: false },
      },
    },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
