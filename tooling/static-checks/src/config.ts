import { existsSync } from "node:fs";
import type { RequiredSpanCall } from "./model";

export const checkedExtensions: Record<string, true> = {
  ".cjs": true,
  ".js": true,
  ".json": true,
  ".jsx": true,
  ".mjs": true,
  ".mdx": true,
  ".ts": true,
  ".tsx": true,
};

export const skippedSegments: Record<string, true> = {
  ".next": true,
  __tests__: true,
  dist: true,
  node_modules: true,
  outputs: true,
};
export const skippedSuffixes: readonly string[] = [".d.ts", ".tsbuildinfo", "README.md"];
export const roots = [
  "core",
  "signers",
  "formats",
  "shared",
  "apps/docs/components/sections/providers-showcase.tsx",
  "apps/docs/content/docs/providers",
].filter((path) => existsSync(path));

export const requiredEffectSpanFiles: Record<string, readonly RequiredSpanCall[]> = {};

export const allowedEffectProvideSites: Record<string, readonly string[]> = {
  "signers/assinafy/src/index.ts": [
    "AssinafySignatureRequestProvider()",
    "assinafyCredentialsLayer(options)",
  ],
  "signers/clicksign/src/index.ts": [
    "ClicksignSignatureRequestProvider()",
    "clicksignCredentialsLayer(options)",
  ],
  "signers/documenso/src/index.ts": [
    "DocumensoSignatureRequestProvider()",
    "documensoCredentialsLayer(options)",
  ],
  "signers/docuseal/src/index.ts": [
    "DocuSealSignatureRequestProvider()",
    "docuSealCredentialsLayer(options)",
  ],
  "signers/zapsign/src/index.ts": [
    "ZapSignSignatureRequestProvider()",
    "zapSignCredentialsLayer(options)",
  ],
};

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
