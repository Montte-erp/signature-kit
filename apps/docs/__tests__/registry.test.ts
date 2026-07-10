import * as ts from "typescript";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

const RegistryCatalogItemSchema = Schema.Struct({
  dependencies: Schema.optional(Schema.Array(Schema.String)),
});

const PackageJsonSchema = Schema.Struct({
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

type ImportDeclarationSummary = {
  specifier: string;
  namedImports: ReadonlyArray<string>;
};

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const componentPath = resolve(
  docsRoot,
  "registry/default/signature-pdf-viewer/signature-pdf-viewer.tsx",
);
const itemPath = resolve(docsRoot, "public/r/signature-pdf-viewer.json");
const packagePath = resolve(docsRoot, "package.json");
const buildRegistryPath = resolve(docsRoot, "scripts/build-registry.ts");

const isExternal = (specifier: string): boolean =>
  !specifier.startsWith(".") &&
  !specifier.startsWith("@/") &&
  !specifier.startsWith("#") &&
  !specifier.startsWith("/");

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
    const match = /^(@[^/]+\/[^@/]+)/.exec(dependency);
    if (match === null) return dependency;
    return match[1];
  }

  const index = dependency.indexOf("@");
  return index === -1 ? dependency : dependency.slice(0, index);
};

const normalizeSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const uniq = new Set(values);
  return Array.from(uniq).sort();
};

const extractImports = (source: string): ReadonlyArray<ImportDeclarationSummary> => {
  const sourceFile = ts.createSourceFile(
    "signature-pdf-viewer.tsx",
    source,
    ts.ScriptTarget.ESNext,
    false,
    ts.ScriptKind.TSX,
  );

  const entries: ImportDeclarationSummary[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteralLike(moduleSpecifier)) continue;

    const namedImports: string[] = [];
    const named = statement.importClause?.namedBindings;

    if (named !== undefined && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        namedImports.push(element.name.getText(sourceFile));
      }
    }

    entries.push({
      specifier: moduleSpecifier.text,
      namedImports,
    });
  }

  return entries;
};

const normalizeText = (expression: ts.Expression | undefined): string | undefined => {
  if (expression === undefined) return undefined;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    return expression.text;
  return undefined;
};

const propertyName = (node: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  return undefined;
};

const extractObjectProperty = (
  node: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined => {
  for (const child of node.properties) {
    if (!ts.isPropertyAssignment(child)) continue;
    if (propertyName(child.name) === name) return child.initializer;
  }

  return undefined;
};

const unwrapExpression = (node: ts.Expression): ts.Expression => {
  if (ts.isSatisfiesExpression(node)) return node.expression;
  if (ts.isAsExpression(node)) return node.expression;
  if (ts.isTypeAssertionExpression(node)) return node.expression;
  if (ts.isParenthesizedExpression(node)) return node.expression;
  return node;
};

const extractBuildRegistryDependencies = (source: string): ReadonlyArray<string> => {
  const sourceFile = ts.createSourceFile(
    "build-registry.ts",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "registry") continue;
      if (declaration.initializer === undefined) continue;

      const initializer = unwrapExpression(declaration.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) continue;

      const items = extractObjectProperty(initializer, "items");
      if (items === undefined || !ts.isArrayLiteralExpression(items)) continue;

      for (const item of items.elements) {
        if (!ts.isObjectLiteralExpression(item)) continue;

        const name = normalizeText(extractObjectProperty(item, "name"));
        if (name !== "signature-pdf-viewer") continue;

        const dependenciesExpression = extractObjectProperty(item, "dependencies");
        if (
          dependenciesExpression === undefined ||
          !ts.isArrayLiteralExpression(dependenciesExpression)
        )
          return [];

        const deps: string[] = [];
        for (const dep of dependenciesExpression.elements) {
          const text = normalizeText(dep);
          if (text === undefined) continue;
          deps.push(text);
        }
        return deps;
      }
    }
  }

  return [];
};

describe("registry dependency assertions for signature-pdf-viewer", () => {
  it("imports pdfjs only from react-pdf and not from pdfjs-dist", async () => {
    const source = await readFile(componentPath, "utf8");
    const imports = extractImports(source);

    const reactPdfImport = imports.find((entry) => entry.specifier === "react-pdf");
    expect(reactPdfImport, "signature-pdf-viewer must import from react-pdf").toBeDefined();
    if (reactPdfImport === undefined) return;

    expect(reactPdfImport.namedImports.includes("pdfjs"), "pdfjs must come from react-pdf").toBe(
      true,
    );
    expect(
      imports.some(
        (entry) => entry.specifier === "pdfjs-dist" || entry.specifier.startsWith("pdfjs-dist/"),
      ),
      "pdfjs-dist should never be imported from a package specifier",
    ).toBe(false);
  });

  it("declares dependency metadata from imported package names and pins effect", async () => {
    const [itemRaw, packageRaw, sourceRaw] = await Promise.all([
      readFile(itemPath, "utf8"),
      readFile(packagePath, "utf8"),
      readFile(componentPath, "utf8"),
    ]);

    const item = await Effect.runPromise(
      Schema.decodeUnknownEffect(RegistryCatalogItemSchema)(JSON.parse(itemRaw)),
    );
    const packageJson = await Effect.runPromise(
      Schema.decodeUnknownEffect(PackageJsonSchema)(JSON.parse(packageRaw)),
    );
    const imports = extractImports(sourceRaw);

    const importedPackages = normalizeSorted(
      imports
        .map((entry) => entry.specifier)
        .filter(isExternal)
        .filter((specifier) => packageNameFromImport(specifier) !== "react")
        .map(packageNameFromImport),
    );

    const declaredDependencies = normalizeSorted(
      (item.dependencies ?? []).map((dependency) => dependencyPackageName(dependency)),
    );

    expect(declaredDependencies).toEqual(importedPackages);

    const effectVersion = packageJson.dependencies?.effect;
    expect(effectVersion, "apps/docs must declare effect in package dependencies").toBeTypeOf(
      "string",
    );

    const effectEntry = (item.dependencies ?? []).find(
      (dependency) => dependencyPackageName(dependency) === "effect",
    );
    expect(effectEntry, "registry metadata must include effect").toBeDefined();
    if (effectVersion === "workspace:*") {
      expect(effectEntry).toBe("effect@workspace:*");
    } else {
      expect(effectEntry).toBe(`effect@${effectVersion}`);
    }
  });

  it("build-registry script keeps signature-pdf-viewer effect pinned", async () => {
    const [scriptRaw, packageRaw] = await Promise.all([
      readFile(buildRegistryPath, "utf8"),
      readFile(packagePath, "utf8"),
    ]);
    const packageJson = await Effect.runPromise(
      Schema.decodeUnknownEffect(PackageJsonSchema)(JSON.parse(packageRaw)),
    );
    const scriptDependencies = extractBuildRegistryDependencies(scriptRaw);
    const effectVersion = packageJson.dependencies?.effect;

    expect(effectVersion, "apps/docs must declare effect in package dependencies").toBeTypeOf(
      "string",
    );
    const effectDep = scriptDependencies.find(
      (dependency) => dependencyPackageName(dependency) === "effect",
    );
    expect(effectDep, "build-registry metadata must include effect").toBeDefined();

    if (effectVersion === "workspace:*") {
      expect(effectDep).toBe("effect@workspace:*");
    } else {
      expect(effectDep).toBe(`effect@${effectVersion}`);
    }
  });
});
