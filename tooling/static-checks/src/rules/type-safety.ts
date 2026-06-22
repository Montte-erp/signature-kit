import type { Check } from "../model";

const hasTypeAssertion = (line: string): boolean => {
  for (const match of line.matchAll(/\bas\b/g)) {
    const rest = line.slice((match.index ?? 0) + match[0].length).trimLeft();
    if (!rest) {
      continue;
    }

    // `as const` is a safe const-assertion: it narrows to literal/readonly types
    // and cannot introduce unsoundness. Allowed (matches alchemy-effect practice).
    // Only value-type casts (`as Foo`, `as any`, `as unknown as Foo`) are flagged.
    if (/^const\b/.test(rest)) {
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
    message:
      "Do not use value-type `as` casts; validate/convert through a Schema/Effect boundary. (`as const` is allowed.)",
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
