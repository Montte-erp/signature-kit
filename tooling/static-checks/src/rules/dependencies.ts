import type { Check } from "../model";

const hasLegacyDependency = (line: string): boolean =>
  /\b(?:import(?:\s+(?:type\s+)?)?(?:[^;]*\bfrom\s+)?["'](?:better-result|evlog|zod|ky)["']|import\(\s*["'](?:better-result|evlog|zod|ky)["']\s*\)|require\(\s*["'](?:better-result|evlog|zod|ky)["']\s*\))/.test(
    line,
  );

const hasMandatoryOtelDependency = (line: string): boolean =>
  /"@(?:effect\/opentelemetry|opentelemetry\/[^"/]+)"\s*:/.test(line);

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
      /^(?:core|signers|formats|integrations)\/[^/]+\/package\.json$/.test(path) &&
      hasMandatoryOtelDependency(line),
    ignoreImportLine: false,
  },
];
