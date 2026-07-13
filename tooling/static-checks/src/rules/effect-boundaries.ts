import type { Check, CheckContext } from "../model";
import { allowedEffectProvideSites } from "../config";

const librarySourcePathPattern =
  /^(?:core|shared|signers|formats|validators)\/[^/]+\/src\/(?!__tests__\/).+\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

const hasForbiddenEffectConstruct = (context: CheckContext): boolean =>
  /\b(?:Effect\.(?:either|effect)|Either(?:\s*[.(<{\s,}]))/.test(context.line);

const hasKnownDynamicImport = (context: CheckContext): boolean =>
  librarySourcePathPattern.test(context.path) &&
  /\bimport\(\s*["'](?:\.{1,2}\/[^"']+|node:[^"']+|effect(?:\/[^"']+)?|@effect\/[^"']+|@signature-kit\/[^"']+)["']\s*\)/.test(
    context.line,
  );
const hasDirectNodeOrPlatformImport = (context: CheckContext): boolean =>
  librarySourcePathPattern.test(context.path) &&
  /\b(?:from\s*)?["'](?:node:|@effect\/platform-node(?:\/|["']))/.test(context.rawLine);

const hasLocalEffectRunBoundary = (context: CheckContext): boolean => {
  if (!context.path.startsWith("formats/react/src/") && !context.path.startsWith("apps/docs/")) {
    return false;
  }
  const current = context.rawLine;
  const previous = context.rawLines[context.lineNumber - 2] ?? "";
  const boundaryPattern = /\/\/\s*effect-boundary:\s*\S[\s\S]*\[allow-run:\s*[^\]]+\]/;
  return boundaryPattern.test(current) || boundaryPattern.test(previous);
};

const hasNamedEffectEscape = (context: CheckContext): boolean => {
  if (!librarySourcePathPattern.test(context.path) || hasLocalEffectRunBoundary(context)) {
    return false;
  }
  if (
    !/\b(?:runSync|runPromise|runFork|runCallback|decodeUnknownSync|decodeSync|decodeUnknownPromise|decodePromise)\s*\(/.test(
      context.line,
    )
  ) {
    return false;
  }
  return /import\s*\{[\s\S]*\b(?:runSync|runPromise|runFork|runCallback|decodeUnknownSync|decodeSync|decodeUnknownPromise|decodePromise)\b[\s\S]*\}\s*from\s*["']effect(?:\/[^"']+)?["']/.test(
    context.source,
  );
};

const hasEscapedEffectBoundary = (context: CheckContext): boolean =>
  !hasLocalEffectRunBoundary(context) &&
  (/\bEffect\.(runSync|runPromise|runFork|runCallback)(?:Exit)?\b/.test(context.line) ||
    /\bSchema\.(?:decode|encode)(?:Unknown)?(?:Sync|Promise)\b/.test(context.line));

const hasLegacyEffectServiceApi = (line: string): boolean =>
  /\b(?:Context\.(?:Reference|Tag|GenericTag)|Effect\.(?:Tag|Service))\s*[<(]/.test(line);

const hasLocalEffectBoundary = (context: CheckContext): boolean => {
  const previous = context.rawLines[context.lineNumber - 2] ?? "";
  const boundaryPattern = /\/\/\s*effect-boundary:\s*\S[\s\S]*\[allow-provide:\s*[^\]]+\]/;
  return boundaryPattern.test(previous);
};

const hasEffectProvideCall = (context: CheckContext): boolean =>
  /\bprovide(?:Service|Layer|Merge)?\b/.test(context.line) &&
  /\b(?:Effect|Layer)\s*\.\s*provide(?:Service|Layer|Merge)?\s*\(/.test(context.window);

const hasAllowedEffectProvideSite = (context: CheckContext): boolean => {
  const allowedArguments = allowedEffectProvideSites[context.path];
  if (allowedArguments === undefined) {
    return false;
  }
  return allowedArguments.some((argument) => context.window.includes(argument));
};

const hasHiddenEffectProvide = (context: CheckContext): boolean =>
  hasEffectProvideCall(context) &&
  !/\.(?:test|spec)\.tsx?$/.test(context.path) &&
  !hasLocalEffectBoundary(context) &&
  !hasAllowedEffectProvideSite(context);

export const effectBoundaryChecks: readonly Check[] = [
  {
    message:
      "Do not escape the Effect error channel with runSync/runPromise/runFork or Schema.decodeUnknownSync.",
    test: hasEscapedEffectBoundary,
    ignoreImportLine: false,
  },
  {
    message:
      "Use Effect error channels directly; do not use Effect.either, Effect.effect, or Either in library modules.",
    test: hasForbiddenEffectConstruct,
    ignoreImportLine: false,
  },
  {
    message:
      "Library modules must not dynamically import known dependencies or relative modules; use static imports or an explicit runtime plugin boundary.",
    test: hasKnownDynamicImport,
    ignoreImportLine: false,
  },
  {
    message:
      "Library modules must use portable platform services; direct node or @effect/platform-node imports belong at application or test boundaries.",
    test: hasDirectNodeOrPlatformImport,
    ignoreImportLine: false,
  },
  {
    message:
      "Do not escape the Effect error channel through named run/decode imports; use an Effect boundary with explicit documentation.",
    test: hasNamedEffectEscape,
    ignoreImportLine: false,
  },
  {
    message: "Use Context.Service/Layer v4; do not use Context.Reference/Context.Tag/Effect.Tag.",
    test: ({ line }) => hasLegacyEffectServiceApi(line),
    ignoreImportLine: true,
  },
  {
    message:
      "Do not apply Effect/Layer provide inside the library without an adjacent `[allow-provide: reason]` boundary marker or allowlist entry.",
    test: hasHiddenEffectProvide,
    ignoreImportLine: true,
  },
];
