import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  optimizeDeps: {
    exclude: [
      "@aws-sdk/credential-provider-web-identity",
      "@aws-sdk/credential-providers",
      "@distilled.cloud/aws",
      "alchemy",
    ],
  },
  test: {
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
