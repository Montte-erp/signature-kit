import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

const skippedDirectories = new Set([".git", ".cache", "dist", "node_modules"]);

const PackageJsonSchema = Schema.Struct({
  scripts: Schema.Record(Schema.String, Schema.String),
});

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
      .filter((path) => path.endsWith(".browser.test.ts") || path.endsWith(".browser.test.tsx"))
      .sort();
    const allowedRoots = [
      "apps/docs/",
      "formats/pdf/__tests__/",
      "formats/react/__tests__/",
      "signers/a1/__tests__/",
    ];

    expect(browserTests.length).toBeGreaterThan(0);
    expect(browserTests.every((path) => allowedRoots.some((root) => path.startsWith(root)))).toBe(
      true,
    );
    expect(browserTests.some((path) => path.startsWith("apps/web/"))).toBe(false);
  });

  it("keeps package behavior tests out of apps/web", () => {
    const webTests = collectFiles(join(process.cwd(), "apps", "web"))
      .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
      .filter((path) => path.includes("/__tests__/"))
      .sort();

    expect(webTests).toEqual([]);
  });

  it("includes browser runtime suites in the browser integration command", async () => {
    const packageJsonPath = resolve(process.cwd(), "package.json");
    const rootPackage = await Effect.runPromise(
      Schema.decodeUnknownEffect(PackageJsonSchema)(
        JSON.parse(readFileSync(packageJsonPath, "utf8")),
      ),
    );
    const command = rootPackage.scripts["test:integration:browser"] ?? "";

    expect(command).toContain("tooling/vitest/browser.config.ts signers formats");
    expect(command).toContain("apps/docs/vitest.browser.config.ts apps/docs");
    expect(command).not.toContain(".browser.test.");
  });
});
