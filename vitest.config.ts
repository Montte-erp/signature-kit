import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/docs", import.meta.url)),
    },
  },
  test: {
    setupFiles: ["./tooling/vitest/load-env.ts"],
  },
});
