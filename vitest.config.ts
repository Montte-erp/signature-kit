import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/docs", import.meta.url)),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "**/*.live.test.*"],
  },
});
