import type { Check } from "../model";

const hasTypeAssertion = (line: string): boolean => {
  for (const match of line.matchAll(/\bas\b/g)) {
    const rest = line.slice((match.index ?? 0) + match[0].length).trimLeft();
    const previous = line[(match.index ?? 0) - 1];
    if (previous === ".") {
      continue;
    }

    if (!rest) {
      continue;
    }

    if (/^\s*[,.;:)\]}]/.test(rest)) {
      continue;
    }

    if (!/^([A-Za-z_$]|\[|\{|<|\()./.test(rest)) {
      continue;
    }

    return true;
  }

  return false;
};

const hasTaggedErrorAny = (line: string): boolean =>
  /\bTaggedErrorClass\s*<[^>]*\bany\b[^>]*>/.test(line);

const hasErasedEffectAny = (line: string): boolean =>
  /\bEffect\.Effect\s*<[^>]*\bany\b[^>]*>/.test(line);

export const typeSafetyChecks: readonly Check[] = [
  {
    message: "Do not use `as` casts; validate/convert through a Schema/Effect boundary.",
    test: ({ line }) => hasTypeAssertion(line),
    ignoreImportLine: true,
  },
  {
    message: "Do not erase a tagged error with any in the error catalog.",
    test: ({ line }) => hasTaggedErrorAny(line),
    ignoreImportLine: false,
  },
  {
    message: "Avoid Any in a domain effect (`Effect.Effect<..., any, ...`).",
    test: ({ line }) => hasErasedEffectAny(line),
    ignoreImportLine: false,
  },
];
