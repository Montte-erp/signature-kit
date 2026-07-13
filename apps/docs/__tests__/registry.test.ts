import type * as TypeScript from "typescript";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { buildRegistry, registry } from "../scripts/build-registry";

const RegistryFileSchema = Schema.Struct({
  path: Schema.String,
  type: Schema.String,
  target: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
});

const RegistryItemSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  title: Schema.String,
  description: Schema.String,
  registryDependencies: Schema.optional(Schema.Array(Schema.String)),
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  files: Schema.Array(RegistryFileSchema),
  docs: Schema.optional(Schema.String),
});

const RegistryCatalogSchema = Schema.Struct({
  $schema: Schema.String,
  name: Schema.String,
  homepage: Schema.String,
  items: Schema.Array(RegistryItemSchema),
});

const PackageJsonSchema = Schema.Struct({
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

type ModuleReferenceSummary = {
  readonly specifier: string;
  readonly namedImports: ReadonlyArray<string>;
  readonly exportedNames: ReadonlyArray<string>;
};

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = resolve(docsRoot, "package.json");
const requiredTypescript = createRequire(import.meta.url)("typescript");
const typescript: typeof TypeScript = requiredTypescript.default ?? requiredTypescript;

const parseSourceFile = (fileName: string, source: string): TypeScript.SourceFile =>
  typescript.createSourceFile(
    fileName,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TSX,
  );

const moduleSpecifierText = (node: TypeScript.Expression | undefined): string | undefined =>
  node !== undefined && typescript.isStringLiteralLike(node) ? node.text : undefined;

const extractModuleReferences = (
  fileName: string,
  source: string,
): ReadonlyArray<ModuleReferenceSummary> => {
  const sourceFile = parseSourceFile(fileName, source);
  const entries: ModuleReferenceSummary[] = [];

  for (const statement of sourceFile.statements) {
    if (typescript.isImportDeclaration(statement)) {
      const specifier = moduleSpecifierText(statement.moduleSpecifier);
      if (specifier === undefined) continue;

      const namedImports: string[] = [];
      const importClause = statement.importClause;
      if (importClause?.name !== undefined) namedImports.push("default");

      const namedBindings = importClause?.namedBindings;
      if (namedBindings !== undefined && typescript.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          namedImports.push(element.propertyName?.text ?? element.name.text);
        }
      } else if (namedBindings !== undefined && typescript.isNamespaceImport(namedBindings)) {
        namedImports.push("*");
      }

      entries.push({ specifier, namedImports, exportedNames: [] });
      continue;
    }

    if (!typescript.isExportDeclaration(statement)) continue;
    const specifier = moduleSpecifierText(statement.moduleSpecifier);
    if (specifier === undefined) continue;

    const namedImports: string[] = [];
    const exportedNames: string[] = [];
    const exportClause = statement.exportClause;
    if (exportClause === undefined) {
      namedImports.push("*");
    } else if (typescript.isNamedExports(exportClause)) {
      for (const element of exportClause.elements) {
        namedImports.push(element.propertyName?.text ?? element.name.text);
        exportedNames.push(element.name.text);
      }
    } else if (typescript.isNamespaceExport(exportClause)) {
      exportedNames.push(exportClause.name.text);
    }

    entries.push({ specifier, namedImports, exportedNames });
  }

  return entries;
};

const isExternal = (specifier: string): boolean =>
  !specifier.startsWith(".") &&
  !specifier.startsWith("@/") &&
  !specifier.startsWith("#") &&
  !specifier.startsWith("/");
const consumerHostPackages: Record<string, true> = {
  react: true,
  "react-dom": true,
};

const packageNameFromImport = (specifier: string): string => {
  if (specifier.startsWith("@")) {
    const match = /^(@[^/]+\/[^/]+)/.exec(specifier);
    if (match === null) return specifier;
    return match[1];
  }

  return specifier.split("/")[0];
};

const dependencyPackageName = (dependency: string): string => {
  if (dependency.startsWith("@")) {
    const separator = dependency.indexOf("@", 1);
    return separator === -1 ? dependency : dependency.slice(0, separator);
  }

  const separator = dependency.indexOf("@");
  return separator === -1 ? dependency : dependency.slice(0, separator);
};

const dependencyVersion = (dependency: string): string | undefined => {
  const packageName = dependencyPackageName(dependency);
  const prefix = `${packageName}@`;
  return dependency.startsWith(prefix) ? dependency.slice(prefix.length) : undefined;
};

const normalizeSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.from(new Set(values)).sort();

const decodeJson = async <A>(schema: Schema.ConstraintDecoder<A>, path: string): Promise<A> =>
  Effect.runPromise(Schema.decodeUnknownEffect(schema)(JSON.parse(await readFile(path, "utf8"))));

describe("registry metadata", () => {
  it("uses the stable TypeScript parser for aliases, re-exports, and defaults", () => {
    const references = extractModuleReferences(
      "fixture.tsx",
      [
        'import primary, { default as importedDefault, value as importedValue } from "@scope/source";',
        'export { importedValue as renamed, importedDefault as default } from "@scope/reexport";',
        'export * from "plain-package";',
        'export * as namespace from "namespace-package";',
        "export default primary;",
      ].join("\n"),
    );

    expect(references).toEqual([
      {
        specifier: "@scope/source",
        namedImports: ["default", "default", "value"],
        exportedNames: [],
      },
      {
        specifier: "@scope/reexport",
        namedImports: ["importedValue", "importedDefault"],
        exportedNames: ["renamed", "default"],
      },
      {
        specifier: "plain-package",
        namedImports: ["*"],
        exportedNames: [],
      },
      {
        specifier: "namespace-package",
        namedImports: [],
        exportedNames: ["namespace"],
      },
    ]);
  });

  it("validates every generated item, source file, dependency, and pinned version", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "signature-kit-registry-"));
    const outputPath = join(fixtureRoot, "public", "r");

    try {
      await mkdir(outputPath, { recursive: true });
      await writeFile(join(outputPath, "sentinel.json"), "{}\n");
      await buildRegistry(outputPath);

      const generatedFiles = (await readdir(outputPath)).sort();
      const expectedFiles = [
        "registry.json",
        ...registry.items.map((item) => `${item.name}.json`),
      ].sort();
      expect(generatedFiles).toEqual(expectedFiles);

      const catalog = await decodeJson(RegistryCatalogSchema, join(outputPath, "registry.json"));
      const packageJson = await decodeJson(PackageJsonSchema, packagePath);
      const expectedNames = registry.items.map((item) => item.name).sort();
      expect(catalog.name).toBe("signature-kit");
      expect(catalog.items.map((item) => item.name).sort()).toEqual(expectedNames);
      expect(new Set(catalog.items.map((item) => item.name)).size).toBe(catalog.items.length);

      const targets = catalog.items.flatMap((item) => item.files.map((file) => file.target ?? ""));
      expect(new Set(targets).size).toBe(targets.length);
      expect(targets.every((target) => target.startsWith("@components/signature-kit/"))).toBe(true);

      for (const item of catalog.items) {
        const generatedItem = await decodeJson(
          Schema.Struct({
            $schema: Schema.String,
            ...RegistryItemSchema.fields,
          }),
          join(outputPath, `${item.name}.json`),
        );
        const declaredDependencies = normalizeSorted(
          (item.dependencies ?? []).map(dependencyPackageName),
        );
        const sourceReferences = (
          await Promise.all(
            item.files.map(async (file) => ({
              file,
              source: await readFile(resolve(docsRoot, file.path), "utf8"),
            })),
          )
        ).flatMap(({ file, source }) => {
          const references = extractModuleReferences(file.path, source);
          return references
            .filter((reference) => isExternal(reference.specifier))
            .map((reference) => packageNameFromImport(reference.specifier))
            .filter((packageName) => consumerHostPackages[packageName] !== true);
        });

        expect(declaredDependencies).toEqual(normalizeSorted(sourceReferences));

        const generatedFileTargets = generatedItem.files.map((file) => file.target ?? "");
        expect(generatedFileTargets).toEqual(item.files.map((file) => file.target ?? ""));
        for (const [index, file] of item.files.entries()) {
          const generatedFile = generatedItem.files[index];
          const source = await readFile(resolve(docsRoot, file.path), "utf8");
          expect(generatedFile.content).toBe(source);
        }

        for (const dependency of item.dependencies ?? []) {
          const pinnedVersion = dependencyVersion(dependency);
          if (pinnedVersion === undefined) continue;
          const packageName = dependencyPackageName(dependency);
          expect(packageJson.dependencies?.[packageName]).toBe(pinnedVersion);
        }
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("keeps the pdf viewer pdfjs import contract", async () => {
    const item = registry.items.find((candidate) => candidate.name === "signature-pdf-viewer");
    expect(item).toBeDefined();
    if (item === undefined) return;

    const file = item.files[0];
    const source = await readFile(resolve(docsRoot, file.path), "utf8");
    const imports = extractModuleReferences(file.path, source);
    const reactPdfImport = imports.find((entry) => entry.specifier === "react-pdf");

    expect(reactPdfImport, "signature-pdf-viewer must import from react-pdf").toBeDefined();
    if (reactPdfImport === undefined) return;
    expect(reactPdfImport.namedImports.includes("pdfjs")).toBe(true);
    expect(
      imports.some(
        (entry) => entry.specifier === "pdfjs-dist" || entry.specifier.startsWith("pdfjs-dist/"),
      ),
    ).toBe(false);
  });
});
