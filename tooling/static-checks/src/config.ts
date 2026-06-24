import { existsSync, statSync } from "node:fs";
import type { RequiredSpanCall } from "./model";

export const checkedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export const skippedSegments = new Set(["dist", "node_modules", "outputs", "docs", "__tests__"]);
export const skippedSuffixes = new Set([".d.ts", ".tsbuildinfo", "README.md"]);
export const roots = ["core", "signers", "formats", "shared"].filter(
  (path) => existsSync(path) && statSync(path).isDirectory(),
);

export const requiredEffectSpanFiles = new Map<string, readonly RequiredSpanCall[]>([]);

export const allowedEffectProvideSites = new Map<string, readonly string[]>([]);

export const contractSuffixes: readonly string[] = [
  "Config",
  "Options",
  "Credentials",
  "Event",
  "Header",
  "Metadata",
  "Policy",
  "Request",
  "Response",
  "Result",
  "Document",
  "Input",
  "Data",
  "Appearance",
];
export const exportContractDeclarationPattern = new RegExp(
  `^\\s*export\\s+(?:interface|type)\\s+([A-Za-z_$][\\w$]*(?:${contractSuffixes.join("|")}))\\b`,
);
export const adapterOrPackagePathPrefixes: readonly string[] = ["core/", "signers/", "formats/"];
export const fiscalCorePrefix = "core/core/";
