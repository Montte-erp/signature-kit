import type { Check, CheckContext } from "../model";

const hasLocalPlainSecretBoundary = (context: CheckContext): boolean => {
  if (!context.path.startsWith("formats/react/src/") && !context.path.startsWith("apps/docs/")) {
    return false;
  }
  const current = context.rawLine;
  const previous = context.rawLines[context.lineNumber - 2] ?? "";
  const boundaryPattern = /\/\/\s*secret-boundary:\s*\S[\s\S]*\[allow-string-secret:\s*[^\]]+\]/;
  return boundaryPattern.test(current) || boundaryPattern.test(previous);
};

const hasSecretStringInInternalConfig = (context: CheckContext): boolean =>
  !hasLocalPlainSecretBoundary(context) &&
  /(?:password|secret|token|privatekey|apikey|\bcertificate\b)/i.test(context.line) &&
  /\b(?:Schema\.String|Schema\.NonEmptyString|nonEmptyString|:\s*string)\b/.test(context.line) &&
  !/\bRedacted\b/.test(context.line);

export const configChecks: readonly Check[] = [
  {
    message: "Secrets in internal config must use Redacted, not a plain string.",
    test: hasSecretStringInInternalConfig,
    ignoreImportLine: false,
  },
];
