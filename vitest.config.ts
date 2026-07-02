import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tooling/vitest/load-env.ts"],
  },
});
