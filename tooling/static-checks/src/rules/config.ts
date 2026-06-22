import type { Check } from "../model";

// Match secret words as substrings (catches camelCase like apiToken / privateKeyPem);
// `certificate` stays word-bounded so the public certificate PEM is not flagged.
const hasSecretStringInInternalConfig = (line: string): boolean =>
  /(?:password|secret|token|privatekey|apikey|\bcertificate\b)/i.test(line) &&
  /\b(?:Schema\.String|Schema\.NonEmptyString|nonEmptyString|:\s*string)\b/.test(line) &&
  !/\bRedacted\b/.test(line);

export const configChecks: readonly Check[] = [
  {
    message: "Secrets in internal config must use Redacted, not a plain string.",
    test: ({ line }) => hasSecretStringInInternalConfig(line),
    ignoreImportLine: false,
  },
];
