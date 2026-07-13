import type { Check } from "../model";

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

const publicPackageManifestPattern =
  /^(?:core|formats|shared|signers|validators)\/[^/]+\/package\.json$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasManifestDependency = (
  context: Parameters<Check["test"]>[0],
  matcher: (line: string) => boolean,
): boolean => {
  if (!matcher(context.rawLine)) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(context.source);
    if (!isRecord(parsed) || !isRecord(parsed.dependencies)) {
      return false;
    }
    return Object.keys(parsed.dependencies).some((name) => matcher(`"${name}":`));
  } catch {
    return true;
  }
};

const hasManualTypeScriptScript = (context: Parameters<Check["test"]>[0]): boolean => {
  const scriptName = context.rawLine.match(/^\s*"(build|typecheck)"\s*:/)?.[1];
  if (scriptName === undefined) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(context.source);
    return (
      isRecord(parsed) && isRecord(parsed.scripts) && typeof parsed.scripts[scriptName] === "string"
    );
  } catch {
    return true;
  }
};

export const dependencyChecks: readonly Check[] = [
  {
    message:
      "Public packages must use @nx/js/typescript inferred build and typecheck targets; do not shadow them with package scripts.",
    test: (context) =>
      publicPackageManifestPattern.test(context.path) && hasManualTypeScriptScript(context),
    ignoreImportLine: false,
  },
  {
    message:
      "OpenTelemetry must be optional for the consumer; do not add @effect/opentelemetry or @opentelemetry/* to package dependencies.",
    test: (context) =>
      /^(?:core|signers|formats|validators)\/[^/]+\/package\.json$/.test(context.path) &&
      hasManifestDependency(context, hasMandatoryOtelDependency),
    ignoreImportLine: false,
  },
  {
    message:
      "Core package manifests must not declare signer, format, or validator package dependencies; dependency direction is core <- product packages.",
    test: (context) =>
      /^core\/[^/]+\/package\.json$/.test(context.path) &&
      hasManifestDependency(context, hasProductManifestDependency),
    ignoreImportLine: false,
  },
  {
    message:
      "Validator package manifests must not declare signer package dependencies; dependency direction is signers <- validators is forbidden.",
    test: (context) =>
      /^validators\/[^/]+\/package\.json$/.test(context.path) &&
      hasManifestDependency(context, hasSignerManifestDependency),
    ignoreImportLine: false,
  },
  {
    message:
      "Non-validator packages must not depend on validator packages; validators are leaf product surfaces.",
    test: (context) =>
      !context.path.startsWith("validators/") &&
      /^(?:core|signers|formats|shared)\/[^/]+\/package\.json$/.test(context.path) &&
      hasManifestDependency(context, hasValidatorManifestDependency),
    ignoreImportLine: false,
  },
];
