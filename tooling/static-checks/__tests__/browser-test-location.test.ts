import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const skippedDirectories = new Set([".git", ".cache", "dist", "node_modules"]);

const collectFiles = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((entry) => {
    if (skippedDirectories.has(entry)) {
      return [];
    }

    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      return collectFiles(path);
    }
    return [path];
  });

describe("browser integration test placement", () => {
  it("keeps browser runtime coverage owned by the A1 signer package", () => {
    const browserTests = collectFiles(process.cwd())
      .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
      .filter((path) => path.endsWith(".browser.test.ts"))
      .sort();

    expect(browserTests).toEqual(["signers/a1/__tests__/a1.browser.test.ts"]);
  });
});
