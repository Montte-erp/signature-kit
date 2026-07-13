import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export type WorkspaceLayer = "shared" | "core" | "signers" | "formats" | "validators" | "apps";

type JsonObject = { readonly [key: string]: unknown };

type WorkspacePackage = {
  readonly directory: string;
  readonly name: string;
  readonly layer: WorkspaceLayer;
  readonly dependencies: readonly string[];
  readonly devDependencies: readonly string[];
  readonly tsconfigReferences: readonly string[];
};

type WorkspaceExport = {
  readonly specifier: string;
  readonly sourcePath: string;
};

export type WorkspaceLayerDiagnostic = {
  readonly path: string;
  readonly message: string;
};

const workspaceRoots: readonly string[] = [
  "shared",
  "core",
  "signers",
  "formats",
  "validators",
  "apps",
];

const allowedDependencyLayers: Record<WorkspaceLayer, readonly WorkspaceLayer[]> = {
  shared: ["shared"],
  core: ["shared", "core"],
  signers: ["shared", "core", "signers"],
  formats: ["shared", "core", "formats"],
  validators: ["shared", "core", "formats", "validators"],
  apps: ["shared", "core", "signers", "formats", "apps"],
};
const allowedCrossLayerPackageDependencies: Record<string, readonly string[]> = {
  "@signature-kit/react": ["@signature-kit/a1"],
};

const hasAllowedCrossLayerPackageDependency = (
  workspacePackage: WorkspacePackage,
  dependency: WorkspacePackage,
): boolean =>
  allowedCrossLayerPackageDependencies[workspacePackage.name]?.includes(dependency.name) ?? false;

const sourceExtensions: Record<string, true> = {
  ".ts": true,
  ".tsx": true,
  ".js": true,
  ".jsx": true,
  ".mjs": true,
  ".cjs": true,
};

const isJsonObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const normalizePath = (path: string): string => path.replaceAll("\\", "/");

const layerForDirectory = (directory: string): WorkspaceLayer | undefined => {
  const segment = normalizePath(directory).split("/")[0];
  switch (segment) {
    case "shared":
    case "core":
    case "signers":
    case "formats":
    case "apps":
    case "validators":
      return segment;
    default:
      return undefined;
  }
};

const readJsonObject = (path: string): JsonObject | undefined => {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return isJsonObject(parsed) ? parsed : undefined;
};

const workspaceDependencyNames = (value: unknown): readonly string[] =>
  isJsonObject(value)
    ? Object.keys(value).filter((name) => name.startsWith("@signature-kit/"))
    : [];

const tsconfigReferences = (rootDirectory: string, packageDirectory: string): readonly string[] => {
  const tsconfigPath = `${rootDirectory}/${packageDirectory}/tsconfig.json`;
  if (!existsSync(tsconfigPath)) {
    return [];
  }

  const tsconfig = readJsonObject(tsconfigPath);
  const references = tsconfig?.references;
  if (!Array.isArray(references)) {
    return [];
  }

  return references.flatMap((entry) => {
    if (!isJsonObject(entry) || typeof entry.path !== "string") {
      return [];
    }
    return [
      normalizePath(relative(rootDirectory, resolve(rootDirectory, packageDirectory, entry.path))),
    ];
  });
};

const compilerPathAliases = (rootDirectory: string): ReadonlyMap<string, readonly string[]> => {
  const tsconfigPath = `${rootDirectory}/tooling/typescript/base.json`;
  const tsconfigDirectory = dirname(tsconfigPath);
  if (!existsSync(tsconfigPath)) {
    return new Map();
  }
  const tsconfig = readJsonObject(tsconfigPath);
  if (tsconfig === undefined) {
    return new Map();
  }
  const compilerOptions = tsconfig.compilerOptions;
  if (!isJsonObject(compilerOptions)) {
    return new Map();
  }
  const paths = compilerOptions.paths;
  if (!isJsonObject(paths)) {
    return new Map();
  }

  const aliases = new Map<string, readonly string[]>();
  for (const [specifier, value] of Object.entries(paths)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const targets = value.filter((target): target is string => typeof target === "string");
    if (targets.length === value.length) {
      aliases.set(
        specifier,
        targets.map((target) =>
          normalizePath(relative(rootDirectory, resolve(tsconfigDirectory, target))),
        ),
      );
    }
  }
  return aliases;
};

const exportedImportPath = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (!isJsonObject(value)) {
    return undefined;
  }
  return typeof value.import === "string" ? value.import : undefined;
};

const sourceExtensionsForPath: readonly string[] = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const sourcePathFromDistImport = (
  rootDirectory: string,
  packageDirectory: string,
  importPath: string,
): string | undefined => {
  const match = /^\.\/dist\/(.+)\.(?:js|mjs|cjs)$/.exec(importPath);
  if (match === null) {
    return undefined;
  }
  const sourceBase = `${packageDirectory}/src/${match[1]}`;
  const extension = sourceExtensionsForPath.find((candidate) =>
    existsSync(`${rootDirectory}/${sourceBase}${candidate}`),
  );
  return extension === undefined ? `${sourceBase}.ts` : `${sourceBase}${extension}`;
};

const exportedSourcePaths = (
  rootDirectory: string,
  workspacePackage: WorkspacePackage,
): readonly WorkspaceExport[] => {
  const packageJson = readJsonObject(`${rootDirectory}/${workspacePackage.directory}/package.json`);
  if (packageJson === undefined || !isJsonObject(packageJson.exports)) {
    return [];
  }

  return Object.entries(packageJson.exports).flatMap(([subpath, value]) => {
    const importPath = exportedImportPath(value);
    if (importPath === undefined) {
      return [];
    }
    const sourcePath = sourcePathFromDistImport(
      rootDirectory,
      workspacePackage.directory,
      importPath,
    );
    if (sourcePath === undefined) {
      return [];
    }
    return [
      {
        specifier:
          subpath === "."
            ? workspacePackage.name
            : `${workspacePackage.name}/${subpath.replace(/^\.\//, "")}`,
        sourcePath,
      },
    ];
  });
};

const exportPathDiagnostics = (
  rootDirectory: string,
  workspacePackage: WorkspacePackage,
  aliases: ReadonlyMap<string, readonly string[]>,
): readonly WorkspaceLayerDiagnostic[] =>
  exportedSourcePaths(rootDirectory, workspacePackage).flatMap((entry) => {
    const targets = aliases.get(entry.specifier);
    return targets?.includes(entry.sourcePath) === true
      ? []
      : [
          {
            path: "tooling/typescript/base.json",
            message: `${entry.specifier} is exported by ${workspacePackage.name} but does not resolve to ${entry.sourcePath} in tooling/typescript/base.json.`,
          },
        ];
  });
const aliasPathDiagnostics = (
  rootDirectory: string,
  workspacePackage: WorkspacePackage,
  aliases: ReadonlyMap<string, readonly string[]>,
): readonly WorkspaceLayerDiagnostic[] => {
  const exportedSpecifiers = new Set(
    exportedSourcePaths(rootDirectory, workspacePackage).map((entry) => entry.specifier),
  );
  return [...aliases].flatMap(([specifier]) => {
    if (specifier !== workspacePackage.name && !specifier.startsWith(`${workspacePackage.name}/`)) {
      return [];
    }
    return exportedSpecifiers.has(specifier)
      ? []
      : [
          {
            path: "tooling/typescript/base.json",
            message: `${specifier} is configured as a path alias but is not exported by ${workspacePackage.name}.`,
          },
        ];
  });
};

const distJavaScriptFiles = (directory: string): readonly string[] => {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return [];
  }
  return readdirSync(directory).flatMap((entry) => {
    const path = `${directory}/${entry}`;
    const stats = statSync(path);
    if (stats.isDirectory()) {
      return distJavaScriptFiles(path);
    }
    return stats.isFile() && entry.endsWith(".js") ? [path] : [];
  });
};

const hasSourceForDistFile = (distPath: string): boolean => {
  const sourceBase = distPath.replace("/dist/", "/src/").slice(0, -".js".length);
  return [".ts", ".tsx", ".js", ".jsx"].some((extension) =>
    existsSync(`${sourceBase}${extension}`),
  );
};

const distParityDiagnostics = (
  rootDirectory: string,
  workspacePackage: WorkspacePackage,
): readonly WorkspaceLayerDiagnostic[] =>
  distJavaScriptFiles(`${rootDirectory}/${workspacePackage.directory}/dist`).flatMap((distPath) => {
    if (hasSourceForDistFile(distPath)) {
      return [];
    }
    const relativePath = normalizePath(relative(rootDirectory, distPath));
    return [
      {
        path: relativePath,
        message: `${relativePath} is committed generated output without a matching source module.`,
      },
    ];
  });

const sourceFilePaths = (directory: string): readonly string[] => {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const path = `${directory}/${entry}`;
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (
        entry === "dist" ||
        entry === "node_modules" ||
        entry === ".cache" ||
        entry === ".next" ||
        entry === ".source" ||
        entry === "paraglide"
      ) {
        return [];
      }
      return sourceFilePaths(path);
    }
    if (!stats.isFile()) {
      return [];
    }
    const dot = entry.lastIndexOf(".");
    const extension = dot === -1 ? "" : entry.slice(dot);
    return sourceExtensions[extension] === true ? [path] : [];
  });
};

const importSpecifiers = (source: string): readonly string[] => {
  const pattern =
    /(?:^|[\r\n])\s*import\s*["']([^"']+)["']|\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;
  const specifiers: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
};

const packageForRelativePath = (
  packages: readonly WorkspacePackage[],
  path: string,
): WorkspacePackage | undefined =>
  packages.find(
    (workspacePackage) =>
      path === workspacePackage.directory || path.startsWith(`${workspacePackage.directory}/`),
  );
const librarySourcePathPattern =
  /^(?:core|shared|signers|formats|validators)\/[^/]+\/src\/.+\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

const hasPublishedModuleExtension = (specifier: string): boolean => {
  const extension = /\.([A-Za-z0-9]+)$/.exec(specifier)?.[1]?.toLowerCase();
  return extension !== undefined && extension !== "ts" && extension !== "tsx";
};

const packageDirectories = (rootDirectory: string): readonly string[] =>
  workspaceRoots.flatMap((root) => {
    const rootPath = `${rootDirectory}/${root}`;
    if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
      return [];
    }
    return readdirSync(rootPath).flatMap((entry) => {
      const packageDirectory = `${rootPath}/${entry}`;
      const packageJsonPath = `${packageDirectory}/package.json`;
      return existsSync(packageJsonPath) && statSync(packageDirectory).isDirectory()
        ? [normalizePath(relative(rootDirectory, packageDirectory))]
        : [];
    });
  });

export const collectWorkspacePackages = (
  rootDirectory = process.cwd(),
): readonly WorkspacePackage[] =>
  packageDirectories(rootDirectory).flatMap((directory) => {
    const layer = layerForDirectory(directory);
    if (layer === undefined) {
      return [];
    }

    const packageJson = readJsonObject(`${rootDirectory}/${directory}/package.json`);
    if (packageJson === undefined || typeof packageJson.name !== "string") {
      return [];
    }

    return [
      {
        directory,
        name: packageJson.name,
        layer,
        dependencies: workspaceDependencyNames(packageJson.dependencies),
        devDependencies: workspaceDependencyNames(packageJson.devDependencies),
        tsconfigReferences: tsconfigReferences(rootDirectory, directory),
      },
    ];
  });

const dependencyDiagnostics = (
  workspacePackage: WorkspacePackage,
  packagesByName: ReadonlyMap<string, WorkspacePackage>,
): readonly WorkspaceLayerDiagnostic[] =>
  workspacePackage.dependencies.flatMap((dependencyName) => {
    const dependency = packagesByName.get(dependencyName);
    if (dependency === undefined) {
      return [];
    }

    if (
      allowedDependencyLayers[workspacePackage.layer].includes(dependency.layer) ||
      hasAllowedCrossLayerPackageDependency(workspacePackage, dependency)
    ) {
      return [];
    }

    return [
      {
        path: `${workspacePackage.directory}/package.json`,
        message: `${workspacePackage.name} is a ${workspacePackage.layer} package and cannot depend on ${dependency.name} (${dependency.layer}).`,
      },
    ];
  });

const referenceDiagnostics = (
  workspacePackage: WorkspacePackage,
  packagesByName: ReadonlyMap<string, WorkspacePackage>,
  packagesByDirectory: ReadonlyMap<string, WorkspacePackage>,
): readonly WorkspaceLayerDiagnostic[] => {
  const internalDependencyNames = new Set(
    workspacePackage.dependencies.filter((dependencyName) => packagesByName.has(dependencyName)),
  );
  const referenceNames = new Set(
    workspacePackage.tsconfigReferences.flatMap((directory) => {
      const referencedPackage = packagesByDirectory.get(directory);
      return referencedPackage === undefined ? [] : [referencedPackage.name];
    }),
  );

  const missingReferences = [...internalDependencyNames].flatMap((dependencyName) =>
    referenceNames.has(dependencyName)
      ? []
      : [
          {
            path: `${workspacePackage.directory}/tsconfig.json`,
            message: `${workspacePackage.name} depends on ${dependencyName} but does not reference its tsconfig project.`,
          },
        ],
  );

  const undeclaredReferences = [...referenceNames].flatMap((dependencyName) =>
    internalDependencyNames.has(dependencyName)
      ? []
      : [
          {
            path: `${workspacePackage.directory}/tsconfig.json`,
            message: `${workspacePackage.name} references ${dependencyName} but does not declare it in package.json.`,
          },
        ],
  );

  return [...missingReferences, ...undeclaredReferences];
};

const packageForImportSpecifier = (
  packagesByName: ReadonlyMap<string, WorkspacePackage>,
  specifier: string,
): WorkspacePackage | undefined => {
  const exact = packagesByName.get(specifier);
  if (exact !== undefined) return exact;
  for (const [name, workspacePackage] of packagesByName) {
    if (specifier.startsWith(`${name}/`)) return workspacePackage;
  }
  return undefined;
};

const packageImportDiagnostics = (
  workspacePackage: WorkspacePackage,
  packagesByName: ReadonlyMap<string, WorkspacePackage>,
  sourcePath: string,
  specifier: string,
): readonly WorkspaceLayerDiagnostic[] => {
  if (!specifier.startsWith("@signature-kit/")) {
    return [];
  }

  const importedPackage = packageForImportSpecifier(packagesByName, specifier);
  if (importedPackage === undefined || importedPackage.name === workspacePackage.name) {
    return [];
  }

  const allowedDependencyNames = sourcePath.includes("/__tests__/")
    ? [...workspacePackage.dependencies, ...workspacePackage.devDependencies]
    : workspacePackage.dependencies;
  const diagnostics: WorkspaceLayerDiagnostic[] = [];
  if (!allowedDependencyNames.includes(importedPackage.name)) {
    diagnostics.push({
      path: sourcePath,
      message: `${workspacePackage.name} imports ${importedPackage.name} without declaring it in package.json.`,
    });
  }
  if (
    !sourcePath.includes("/__tests__/") &&
    !allowedDependencyLayers[workspacePackage.layer].includes(importedPackage.layer) &&
    !hasAllowedCrossLayerPackageDependency(workspacePackage, importedPackage)
  ) {
    diagnostics.push({
      path: sourcePath,
      message: `${workspacePackage.name} is a ${workspacePackage.layer} package and cannot import ${importedPackage.name} (${importedPackage.layer}).`,
    });
  }
  return diagnostics;
};

const relativeImportDiagnostics = (
  rootDirectory: string,
  workspacePackage: WorkspacePackage,
  packages: readonly WorkspacePackage[],
  sourcePath: string,
  specifier: string,
): readonly WorkspaceLayerDiagnostic[] => {
  if (!specifier.startsWith(".")) {
    return [];
  }

  const diagnostics: WorkspaceLayerDiagnostic[] = [];
  if (librarySourcePathPattern.test(sourcePath) && !hasPublishedModuleExtension(specifier)) {
    diagnostics.push({
      path: sourcePath,
      message: `${sourcePath} uses extensionless relative import ${specifier}; emitted library modules must use an explicit .js, .mjs, .cjs, .json, or asset extension.`,
    });
  }

  const resolvedImport = normalizePath(
    relative(rootDirectory, resolve(rootDirectory, dirname(sourcePath), specifier)),
  );
  const importedPackage = packageForRelativePath(packages, resolvedImport);
  if (importedPackage === undefined || importedPackage.name === workspacePackage.name) {
    return diagnostics;
  }

  diagnostics.push({
    path: sourcePath,
    message: `${workspacePackage.name} reaches into ${importedPackage.name} through a relative import; import the package entry point instead.`,
  });
  return diagnostics;
};

const importDiagnostics = (
  rootDirectory: string,
  workspacePackage: WorkspacePackage,
  packages: readonly WorkspacePackage[],
  packagesByName: ReadonlyMap<string, WorkspacePackage>,
): readonly WorkspaceLayerDiagnostic[] =>
  sourceFilePaths(`${rootDirectory}/${workspacePackage.directory}`).flatMap(
    (absoluteSourcePath) => {
      const sourcePath = normalizePath(relative(rootDirectory, absoluteSourcePath));
      const source = readFileSync(absoluteSourcePath, "utf8");
      return importSpecifiers(source).flatMap((specifier) => [
        ...packageImportDiagnostics(workspacePackage, packagesByName, sourcePath, specifier),
        ...relativeImportDiagnostics(
          rootDirectory,
          workspacePackage,
          packages,
          sourcePath,
          specifier,
        ),
      ]);
    },
  );

const remoteSignerPascalNames: ReadonlyMap<string, string> = new Map([
  ["docuseal", "DocuSeal"],
  ["zapsign", "ZapSign"],
]);

const toPascalCase = (value: string): string =>
  value
    .split(/[-_]/)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");

const remoteSignerSurfaceDiagnostics = (
  rootDirectory: string,
  workspacePackage: WorkspacePackage,
): readonly WorkspaceLayerDiagnostic[] => {
  if (workspacePackage.layer !== "signers") {
    return [];
  }
  const packageName = workspacePackage.directory.split("/")[1];
  if (packageName === undefined || packageName === "a1") {
    return [];
  }
  const sourcePath = `${rootDirectory}/${workspacePackage.directory}/src/index.ts`;
  if (!existsSync(sourcePath)) {
    return [
      {
        path: normalizePath(relative(rootDirectory, sourcePath)),
        message: `${workspacePackage.name} remote signer must expose its uniform provider surface from src/index.ts.`,
      },
    ];
  }
  const source = readFileSync(sourcePath, "utf8");
  const pascalName = remoteSignerPascalNames.get(packageName) ?? toPascalCase(packageName);
  const valueExports = [
    `${pascalName}ProviderId`,
    `${pascalName}ProviderOptionsSchema`,
    `${pascalName}SignatureRequest`,
    "providers",
    `get${pascalName}SignatureRequest`,
    `list${pascalName}SignatureRequests`,
    `delete${pascalName}SignatureRequest`,
    `download${pascalName}SignedDocument`,
  ];
  const typeExports = [`${pascalName}ProviderOptions`, `${pascalName}SignatureRequest`];
  const hasExport = (name: string, typeOnly: boolean): boolean => {
    const exportPrefix = typeOnly ? "type\\s+" : "(?:(?:const|function|class|let|var)\\s+)?";
    return new RegExp(`\\bexport\\s+${exportPrefix}(?:${name}\\b|\\{[^}]*\\b${name}\\b)`, "s").test(
      source,
    );
  };
  return [...valueExports, ...typeExports].flatMap((name) => {
    const typeOnly = typeExports.includes(name);
    return hasExport(name, typeOnly)
      ? []
      : [
          {
            path: normalizePath(relative(rootDirectory, sourcePath)),
            message: `${workspacePackage.name} remote signer index must export ${typeOnly ? "type " : ""}${name}.`,
          },
        ];
  });
};

export const collectWorkspaceLayerDiagnostics = (
  rootDirectory = process.cwd(),
): readonly WorkspaceLayerDiagnostic[] => {
  const packages = collectWorkspacePackages(rootDirectory);
  const byName = new Map(
    packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  );
  const byDirectory = new Map(
    packages.map((workspacePackage) => [workspacePackage.directory, workspacePackage]),
  );

  const pathAliases = compilerPathAliases(rootDirectory);

  return packages.flatMap((workspacePackage) => [
    ...dependencyDiagnostics(workspacePackage, byName),
    ...(workspacePackage.layer === "apps"
      ? []
      : [
          ...referenceDiagnostics(workspacePackage, byName, byDirectory),
          ...remoteSignerSurfaceDiagnostics(rootDirectory, workspacePackage),
          ...exportPathDiagnostics(rootDirectory, workspacePackage, pathAliases),
          ...aliasPathDiagnostics(rootDirectory, workspacePackage, pathAliases),
          ...distParityDiagnostics(rootDirectory, workspacePackage),
        ]),
    ...importDiagnostics(rootDirectory, workspacePackage, packages, byName),
  ]);
};

export const runWorkspaceLayerChecks = (rootDirectory = process.cwd()): boolean => {
  const diagnostics = collectWorkspaceLayerDiagnostics(rootDirectory);
  for (const diagnostic of diagnostics) {
    console.error(`${diagnostic.path}:1: ${diagnostic.message}`);
    console.error(
      "Workspace layer check failed. Keep package dependencies aligned with the monorepo layer graph.",
    );
  }
  return diagnostics.length > 0;
};
