import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const skippedDirectories = new Set([".git", ".cache", "dist", "node_modules"]);

const collectFiles = (directory: string): readonly string[] =>
  existsSync(directory)
    ? readdirSync(directory).flatMap((entry) => {
        if (skippedDirectories.has(entry)) {
          return [];
        }

        const path = join(directory, entry);
        const stats = statSync(path);
        if (stats.isDirectory()) {
          return collectFiles(path);
        }
        return [path];
      })
    : [];

describe("browser integration test placement", () => {
  it("keeps browser runtime coverage in packages that own browser-facing APIs", () => {
    const browserTests = collectFiles(process.cwd())
      .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
      .filter((path) => path.endsWith(".browser.test.ts"))
      .sort();

    expect(browserTests).toEqual([
      "formats/pdf/__tests__/pdf-a1.browser.test.ts",
      "signers/a1/__tests__/a1.browser.test.ts",
    ]);
  });

  it("keeps package behavior tests out of apps/web", () => {
    const webTests = collectFiles(join(process.cwd(), "apps", "web"))
      .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
      .filter((path) => path.includes("/__tests__/"))
      .sort();

    expect(webTests).toEqual([]);
  });
});
