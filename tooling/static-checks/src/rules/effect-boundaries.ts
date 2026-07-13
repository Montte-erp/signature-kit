import * as ts from "typescript";
import type { Check, CheckContext } from "../model";
import { allowedEffectProvideSites } from "../config";

const librarySourcePathPattern =
  /^(?:core|shared|signers|formats|validators)\/[^/]+\/src\/(?!__tests__\/).+\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const effectCallLines = new WeakMap<ts.SourceFile, ReadonlySet<string>>();
const forbiddenEffectLines = new WeakMap<ts.SourceFile, ReadonlySet<number>>();
const dynamicImportLines = new WeakMap<ts.SourceFile, ReadonlySet<number>>();
const directNodeImportLines = new WeakMap<ts.SourceFile, ReadonlySet<number>>();
const namedEffectEscapeLines = new WeakMap<ts.SourceFile, ReadonlySet<number>>();

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;

const getEffectCallLines = (sourceFile: ts.SourceFile): ReadonlySet<string> => {
  const cached = effectCallLines.get(sourceFile);
  if (cached !== undefined) {
    return cached;
  }
  const lines = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const expression = node.expression.expression;
      if (ts.isIdentifier(expression)) {
        lines.add(`${expression.text}.${node.expression.name.text}:${lineOf(sourceFile, node)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  effectCallLines.set(sourceFile, lines);
  return lines;
};

const getForbiddenEffectLines = (sourceFile: ts.SourceFile): ReadonlySet<number> => {
  const cached = forbiddenEffectLines.get(sourceFile);
  if (cached !== undefined) {
    return cached;
  }
  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Effect" &&
        (node.expression.name.text === "either" || node.expression.name.text === "effect")
      ) {
        lines.add(lineOf(sourceFile, node));
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "Either") {
        lines.add(lineOf(sourceFile, node));
      }
    }
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === "Either"
    ) {
      lines.add(lineOf(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  forbiddenEffectLines.set(sourceFile, lines);
  return lines;
};

const hasForbiddenEffectConstruct = (context: CheckContext): boolean =>
  getForbiddenEffectLines(context.sourceFile).has(context.lineNumber - 1);

const getDynamicImportLines = (sourceFile: ts.SourceFile): ReadonlySet<number> => {
  const cached = dynamicImportLines.get(sourceFile);
  if (cached !== undefined) {
    return cached;
  }
  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    const argument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      argument !== undefined &&
      ts.isStringLiteral(argument) &&
      /^(?:\.{1,2}\/|node:|effect(?:\/|$)|@effect\/|@signature-kit\/)/.test(argument.text)
    ) {
      lines.add(lineOf(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  dynamicImportLines.set(sourceFile, lines);
  return lines;
};

const hasKnownDynamicImport = (context: CheckContext): boolean =>
  librarySourcePathPattern.test(context.path) &&
  getDynamicImportLines(context.sourceFile).has(context.lineNumber - 1);

const getDirectNodeImportLines = (sourceFile: ts.SourceFile): ReadonlySet<number> => {
  const cached = directNodeImportLines.get(sourceFile);
  if (cached !== undefined) {
    return cached;
  }
  const lines = new Set<number>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /^(?:node:|@effect\/platform-node(?:\/|$))/.test(statement.moduleSpecifier.text)
    ) {
      lines.add(lineOf(sourceFile, statement));
    }
  }
  directNodeImportLines.set(sourceFile, lines);
  return lines;
};

const hasDirectNodeOrPlatformImport = (context: CheckContext): boolean =>
  librarySourcePathPattern.test(context.path) &&
  getDirectNodeImportLines(context.sourceFile).has(context.lineNumber - 1);

const hasLocalEffectRunBoundary = (context: CheckContext): boolean => {
  if (!context.path.startsWith("formats/react/src/") && !context.path.startsWith("apps/docs/")) {
    return false;
  }
  const current = context.rawLine;
  const previous = context.rawLines[context.lineNumber - 2] ?? "";
  const boundaryPattern = /\/\/\s*effect-boundary:\s*\S[\s\S]*\[allow-run:\s*[^\]]+\]/;
  return boundaryPattern.test(current) || boundaryPattern.test(previous);
};

const effectMethodCallOnLine = (
  context: CheckContext,
  objectName: string,
  methodNames: readonly string[],
): boolean => {
  const lines = getEffectCallLines(context.sourceFile);
  return methodNames.some((methodName) =>
    lines.has(`${objectName}.${methodName}:${context.lineNumber - 1}`),
  );
};

const getNamedEffectEscapeLines = (sourceFile: ts.SourceFile): ReadonlySet<number> => {
  const cached = namedEffectEscapeLines.get(sourceFile);
  if (cached !== undefined) {
    return cached;
  }
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !(
        statement.moduleSpecifier.text === "effect" ||
        statement.moduleSpecifier.text.startsWith("effect/")
      ) ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (
        [
          "runSync",
          "runPromise",
          "runFork",
          "runCallback",
          "decodeUnknownSync",
          "decodeSync",
          "decodeUnknownPromise",
          "decodePromise",
        ].includes(imported)
      ) {
        names.add(element.name.text);
      }
    }
  }
  const lines = new Set<number>();
  if (names.size > 0) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        names.has(node.expression.text)
      ) {
        lines.add(lineOf(sourceFile, node));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  namedEffectEscapeLines.set(sourceFile, lines);
  return lines;
};

const hasNamedEffectEscape = (context: CheckContext): boolean =>
  librarySourcePathPattern.test(context.path) &&
  !hasLocalEffectRunBoundary(context) &&
  getNamedEffectEscapeLines(context.sourceFile).has(context.lineNumber - 1);

const hasEscapedEffectBoundary = (context: CheckContext): boolean =>
  !hasLocalEffectRunBoundary(context) &&
  (effectMethodCallOnLine(context, "Effect", [
    "runSync",
    "runPromise",
    "runFork",
    "runCallback",
    "runSyncExit",
    "runPromiseExit",
    "runForkExit",
    "runCallbackExit",
  ]) ||
    effectMethodCallOnLine(context, "Schema", [
      "decodeSync",
      "decodePromise",
      "decodeUnknownSync",
      "decodeUnknownPromise",
      "encodeSync",
      "encodePromise",
      "encodeUnknownSync",
      "encodeUnknownPromise",
    ]));

const hasLegacyEffectServiceApi = (line: string): boolean =>
  /\b(?:Context\.(?:Reference|Tag|GenericTag)|Effect\.(?:Tag|Service))\s*[<(]/.test(line);

const hasLocalEffectBoundary = (context: CheckContext): boolean => {
  const previous = context.rawLines[context.lineNumber - 2] ?? "";
  const boundaryPattern = /\/\/\s*effect-boundary:\s*\S[\s\S]*\[allow-provide:\s*[^\]]+\]/;
  return boundaryPattern.test(previous);
};

const hasEffectProvideCall = (context: CheckContext): boolean =>
  effectMethodCallOnLine(context, "Effect", [
    "provide",
    "provideService",
    "provideLayer",
    "provideMerge",
  ]) || effectMethodCallOnLine(context, "Layer", ["provide", "provideMerge", "provideLayer"]);

const hasAllowedEffectProvideSite = (context: CheckContext): boolean => {
  const allowedArguments = allowedEffectProvideSites[context.path];
  if (allowedArguments === undefined) {
    return false;
  }
  return allowedArguments.some((argument) => context.source.includes(argument));
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
