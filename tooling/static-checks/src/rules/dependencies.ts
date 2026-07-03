import type { Check } from "../model";

const hasLegacyDependency = (line: string): boolean =>
  /\b(?:import(?:\s+(?:type\s+)?)?(?:[^;]*\bfrom\s+)?["'](?:better-result|evlog|zod|ky)["']|import\(\s*["'](?:better-result|evlog|zod|ky)["']\s*\)|require\(\s*["'](?:better-result|evlog|zod|ky)["']\s*\))/.test(
    line,
  );

const hasMandatoryOtelDependency = (line: string): boolean =>
  /"@(?:effect\/opentelemetry|opentelemetry\/[^"/]+)"\s*:/.test(line);

const importsSignerPackage = (line: string): boolean =>
  /\bfrom\s+["']@signature-kit\/(?:a1|assinafy|clicksign|documenso|docuseal|zapsign)(?:\/[^"']*)?["']/.test(
    line,
  );

export const dependencyChecks: readonly Check[] = [
  {
    message: "Replace legacy dependencies with modern alternatives: better-result, evlog, zod, ky.",
    test: ({ line }) => hasLegacyDependency(line),
    ignoreImportLine: false,
  },
  {
    message:
      "OpenTelemetry must be optional for the consumer; do not add @effect/opentelemetry or @opentelemetry/* to package dependencies.",
    test: ({ line, path }) =>
      /^(?:core|signers|formats)\/[^/]+\/package\.json$/.test(path) &&
      hasMandatoryOtelDependency(line),
    ignoreImportLine: false,
  },
  {
    message:
      "Core packages must not import signer packages; dependency direction is core <- signers.",
    test: ({ line, path }) => path.startsWith("core/") && importsSignerPackage(line),
    ignoreImportLine: false,
  },
];
