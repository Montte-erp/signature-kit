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

    expect(browserTests).toEqual([
      "apps/docs/__tests__/auto-sign.browser.test.tsx",
      "apps/docs/__tests__/formal-contract-pdf.browser.test.tsx",
      "apps/docs/__tests__/pdf-page.browser.test.tsx",
      "apps/docs/__tests__/pdf-signer.browser.test.tsx",
      "apps/docs/registry/default/signature-dialog/signature-dialog.browser.test.tsx",
      "apps/docs/registry/default/signature-dialog/signature-dialog.busy.browser.test.tsx",
      "apps/docs/registry/default/signature-pdf-viewer/signature-pdf-viewer.browser.test.tsx",
      "formats/pdf/__tests__/pdf-a1.browser.test.ts",
      "formats/react/__tests__/a1.browser.test.tsx",
      "formats/react/__tests__/a1.race.browser.test.tsx",
      "formats/react/__tests__/browser-pdf.browser.test.tsx",
      "formats/react/__tests__/sync-store.browser.test.tsx",
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

  it("includes browser runtime suites in the browser integration command", async () => {
    const packageJsonPath = resolve(process.cwd(), "package.json");
    const rootPackage = await Effect.runPromise(
      Schema.decodeUnknownEffect(PackageJsonSchema)(
        JSON.parse(readFileSync(packageJsonPath, "utf8")),
      ),
    );
    const command = rootPackage.scripts["test:integration:browser"] ?? "";

    expect(command).toContain("formats/react/__tests__/a1.browser.test.tsx");
    expect(command).toContain("formats/react/__tests__/browser-pdf.browser.test.tsx");
  });
});
