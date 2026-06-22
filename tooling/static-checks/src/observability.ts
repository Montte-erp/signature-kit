import type { RequiredSpanCall } from "./model";
import { stripSourceComments } from "./normalize";

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const hasRequiredSpanCall = (source: string, span: RequiredSpanCall): boolean => {
  const withoutComments = stripSourceComments(source);
  const literalPattern = new RegExp(
    `\\bEffect\\.withSpan\\s*\\(\\s*["']${escapeRegex(span.name)}["']`,
  );
  const catalogPattern = new RegExp(
    `\\bEffect\\.withSpan\\s*\\(\\s*${escapeRegex(span.expression)}\\b`,
  );
  return literalPattern.test(withoutComments) || catalogPattern.test(withoutComments);
};
