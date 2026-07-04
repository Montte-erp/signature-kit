import type { Check } from "../model";

const hasLegacyDependency = (line: string): boolean =>
  /\b(?:import(?:\s+(?:type\s+)?)?(?:[^;]*\bfrom\s+)?["'](?:better-result|evlog|zod|ky)["']|import\(\s*["'](?:better-result|evlog|zod|ky)["']\s*\)|require\(\s*["'](?:better-result|evlog|zod|ky)["']\s*\))/.test(
    line,
  );

const hasMandatoryOtelDependency = (line: string): boolean =>
  /"@(?:effect\/opentelemetry|opentelemetry\/[^"/]+)"\s*:/.test(line);

const hasSignerManifestDependency = (line: string): boolean =>
  /"@signature-kit\/(?:a1|assinafy|clicksign|documenso|docuseal|zapsign)"\s*:/.test(line);
const hasFormatManifestDependency = (line: string): boolean =>
  /"@signature-kit\/(?:xml|pdf)"\s*:/.test(line);
const hasValidatorManifestDependency = (line: string): boolean =>
  /"@signature-kit\/iti"\s*:/.test(line);
const hasProductManifestDependency = (line: string): boolean =>
  hasSignerManifestDependency(line) ||
  hasFormatManifestDependency(line) ||
  hasValidatorManifestDependency(line);

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
      /^(?:core|signers|formats|validators)\/[^/]+\/package\.json$/.test(path) &&
      hasMandatoryOtelDependency(line),
    ignoreImportLine: false,
  },
  {
    message:
      "Core package manifests must not declare signer, format, or validator package dependencies; dependency direction is core <- product packages.",
    test: ({ line, path }) =>
      /^core\/[^/]+\/package\.json$/.test(path) && hasProductManifestDependency(line),
    ignoreImportLine: false,
  },
  {
    message:
      "Validator package manifests must not declare signer package dependencies; dependency direction is signers <- validators is forbidden.",
    test: ({ line, path }) =>
      /^validators\/[^/]+\/package\.json$/.test(path) && hasSignerManifestDependency(line),
    ignoreImportLine: false,
  },
  {
    message:
      "Non-validator packages must not depend on validator packages; validators are leaf product surfaces.",
    test: ({ line, path }) =>
      !path.startsWith("validators/") &&
      /^(?:core|signers|formats|shared)\/[^/]+\/package\.json$/.test(path) &&
      hasValidatorManifestDependency(line),
    ignoreImportLine: false,
  },
];
