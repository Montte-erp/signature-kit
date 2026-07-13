import * as ts from "typescript";
import type { Check, CheckContext } from "../model";

const hasTypeAssertion = (line: string): boolean => {
  for (const match of line.matchAll(/\bas\b/g)) {
    const rest = line.slice((match.index ?? 0) + match[0].length).trimLeft();
    const previous = line[(match.index ?? 0) - 1];
    if (previous === ".") {
      continue;
    }

    if (!rest || /^\s*[,.;:)\]}]/.test(rest) || !/^([A-Za-z_$]|\[|\{|<|\()./.test(rest)) {
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

const hasInlineImportType = (context: CheckContext): boolean => {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (
      ts.isImportTypeNode(node) &&
      context.sourceFile.getLineAndCharacterOfPosition(node.getStart(context.sourceFile)).line ===
        context.lineNumber - 1
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
  return found;
};

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
    message: "Avoid Any in a domain effect (`Effect.Effect<..., any, ...>`).",
    test: ({ line }) => hasErasedEffectAny(line),
    ignoreImportLine: false,
  },
  {
    message: "Use a top-level import type declaration instead of an inline import type annotation.",
    test: hasInlineImportType,
    ignoreImportLine: true,
  },
];
