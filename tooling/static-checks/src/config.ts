import { statSync } from "node:fs";
import type { RequiredSpanCall } from "./model";

export const checkedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export const skippedSegments = new Set(["dist", "node_modules", "outputs", "docs", "__tests__"]);
export const skippedSuffixes = new Set([".d.ts", ".tsbuildinfo", "README.md"]);
export const roots = ["core", "signers", "formats", "integrations", "shared"].filter((path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
});

export const requiredEffectSpanFiles = new Map<string, readonly RequiredSpanCall[]>([]);

export const allowedEffectProvideSites = new Map<string, readonly string[]>([]);

export const contractSuffixes: readonly string[] = [
  "Config",
  "Options",
  "Credentials",
  "Event",
  "Header",
  "Response",
  "Document",
  "Input",
  "Data",
];
export const exportContractDeclarationPattern = new RegExp(
  `^\\s*export\\s+(?:interface|type)\\s+([A-Za-z_$][\\w$]*(?:${contractSuffixes.join("|")}))\\b`,
);
export const adapterOrPackagePathPrefixes: readonly string[] = [
  "core/",
  "signers/",
  "formats/",
  "integrations/",
];
export const fiscalCorePrefix = "core/core/";
