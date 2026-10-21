import { configDefaults, defineConfig } from "vitest/config";
import baseConfig from "../../vitest.config.ts";

export default defineConfig({
  ...baseConfig,
  test: {
    include: ["signers/**/*.live.test.ts", "validators/**/*.integration.test.ts"],
    exclude: configDefaults.exclude,
    setupFiles: ["./tooling/vitest/load-env.ts"],
  },
});
