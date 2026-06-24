import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export type WorkspaceLayer = "shared" | "core" | "signers" | "formats" | "apps";

type JsonObject = { readonly [key: string]: unknown };

type WorkspacePackage = {
  readonly directory: string;
  readonly name: string;
  readonly layer: WorkspaceLayer;
  readonly dependencies: readonly string[];
  readonly devDependencies: readonly string[];
  readonly tsconfigReferences: readonly string[];
};

export type WorkspaceLayerDiagnostic = {
  readonly path: string;
  readonly message: string;
};

const workspaceRoots: readonly string[] = ["shared", "core", "signers", "formats"];

const allowedDependencyLayers: Record<WorkspaceLayer, readonly WorkspaceLayer[]> = {
  shared: ["shared"],
  core: ["shared", "core"],
  signers: ["shared", "core", "signers"],
  formats: ["shared", "core", "formats"],
  apps: ["shared", "core", "signers", "formats", "apps"],
};

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

const sourceFilePaths = (directory: string): readonly string[] => {
  const entries = readdirSync(directory);
  return entries.flatMap((entry) => {
    const path = `${directory}/${entry}`;
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (entry === "dist" || entry === "node_modules" || entry === ".cache") {
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
    /\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;
  const specifiers: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
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

    if (allowedDependencyLayers[workspacePackage.layer].includes(dependency.layer)) {
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

const packageImportDiagnostics = (
  workspacePackage: WorkspacePackage,
  packagesByName: ReadonlyMap<string, WorkspacePackage>,
  sourcePath: string,
  specifier: string,
): readonly WorkspaceLayerDiagnostic[] => {
  if (!specifier.startsWith("@signature-kit/")) {
    return [];
  }

  const importedPackage = packagesByName.get(specifier);
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
    !allowedDependencyLayers[workspacePackage.layer].includes(importedPackage.layer)
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

  const resolvedImport = normalizePath(
    relative(rootDirectory, resolve(rootDirectory, dirname(sourcePath), specifier)),
  );
  const importedPackage = packageForRelativePath(packages, resolvedImport);
  if (importedPackage === undefined || importedPackage.name === workspacePackage.name) {
    return [];
  }

  return [
    {
      path: sourcePath,
      message: `${workspacePackage.name} reaches into ${importedPackage.name} through a relative import; import the package entry point instead.`,
    },
  ];
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

  return packages.flatMap((workspacePackage) => [
    ...dependencyDiagnostics(workspacePackage, byName),
    ...referenceDiagnostics(workspacePackage, byName, byDirectory),
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
