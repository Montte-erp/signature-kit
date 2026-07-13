import * as ts from "typescript";
import type { Check, CheckContext } from "../model";
const hasHttpClientErrorInspector = (line: string): boolean =>
  /\b(?:const|function)\s+(?:isRecord|get[A-Za-z_$][\w$]*Error[A-Za-z_$\w$]*|create[A-Za-z_$][\w$]*Error[A-Za-z_$\w$]*)\b/.test(
    line,
  );
const runtimeErrorLines = new WeakMap<ts.SourceFile, ReadonlySet<number>>();
const assertionThrowLines = new WeakMap<ts.SourceFile, ReadonlySet<number>>();

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;

const getRuntimeErrorLines = (sourceFile: ts.SourceFile): ReadonlySet<number> => {
  const cached = runtimeErrorLines.get(sourceFile);
  if (cached !== undefined) {
    return cached;
  }
  const lines = new Set<number>();
  const assertions = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (ts.isTryStatement(node)) {
      lines.add(lineOf(sourceFile, node));
    }
    if (ts.isThrowStatement(node)) {
      const line = lineOf(sourceFile, node);
      lines.add(line);
      const expression = node.expression;
      if (
        expression !== undefined &&
        ts.isNewExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === "Error"
      ) {
        assertions.add(line);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      /(?:^|\.)(?:Error|DOMException|[A-Za-z_$][\w$]*(?:Error|Failure|Fault|Exception))$/.test(
        node.right.getText(sourceFile),
      )
    ) {
      lines.add(lineOf(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  runtimeErrorLines.set(sourceFile, lines);
  assertionThrowLines.set(sourceFile, assertions);
  return lines;
};

const hasRuntimeErrorHelpers = (context: CheckContext): boolean => {
  const runtimeLines = getRuntimeErrorLines(context.sourceFile);
  if (runtimeLines.has(context.lineNumber - 1)) {
    const isTestFile = /(?:^|\/)__tests__\/|(?:\.test|\.spec)\.[^./]+$/.test(context.path);
    if (!isTestFile || !assertionThrowLines.get(context.sourceFile)?.has(context.lineNumber - 1)) {
      return true;
    }
  }
  return /\b(?:isHTTPError|isTimeoutError|HTTPError|TimeoutError)\b(?!\s*:)/.test(context.line);
};
const hasErrorFactoryOrClassName = (line: string, _path: string, source: string): boolean => {
  if (/TaggedErrorClass/.test(line) || /Schema\.TaggedError/.test(line)) {
    return false;
  }

  const declarationMatch =
    /\b(?:export\s+)?(?:(function|class)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/.exec(
      line,
    );
  if (!declarationMatch) {
    return false;
  }

  const declarationKind = declarationMatch[1];
  const name = declarationMatch[2] ?? declarationMatch[3] ?? "";
  if (!/(?:Failure|Fault|Error)$/.test(name)) {
    return /\b(?:create|make|parse|build|normalize|sanitize|coerce|assert|wrap|unwrap|map)[A-Za-z_$]*(?:Error|Failure|Fault)\b/.test(
      name,
    );
  }

  if (
    declarationKind === undefined &&
    !/^(?:create|make|parse|build|normalize|sanitize|coerce|assert|wrap|unwrap|map)/.test(name)
  ) {
    return false;
  }
  if (declarationKind === "function" && /^expect[A-Z]/.test(name)) {
    return false;
  }

  if (declarationKind === "class" && /TaggedError/i.test(source)) {
    const start = source.indexOf(line);
    if (start !== -1) {
      const tail = source.slice(start, start + line.length + 200);
      if (/\bTaggedErrorClass\b/.test(tail) || /\bSchema\.TaggedError\b/.test(tail)) {
        return false;
      }
    }
  }

  return true;
};
const hasStringErrorOnlyMapping = (line: string): boolean =>
  /\b(?:reason|cause|message)\s*:\s*String\s*\(\s*(?:error|_error|issue|reason|cause|unknown)\s*\)/.test(
    line,
  ) ||
  /\b(?:reason|cause|message)\s*:\s*(?:error|_error|reason|cause|unknown)\.message\b/.test(line);

const hasGenericCauseMetadataWrapper = (line: string): boolean =>
  /\b(?:safe|to)[A-Za-z_$]*CauseMetadata\b|\bfirstStringField\b/.test(line);
const hasDirectEventSinkCallback = (line: string): boolean =>
  /\beventSink\?\.\s*\(|\beventSink\s*\(/.test(line) &&
  !/\b(?:readonly\s+eventSink|eventSink\s*:|type\s+.*EventSink|eventSink\s*===)/.test(line);

export const errorHandlingChecks: readonly Check[] = [
  {
    message:
      "Map HttpClient errors directly with Match.value(error.reason); do not build isRecord/get*Error*/create*Error* inspectors.",
    test: ({ line }) => hasHttpClientErrorInspector(line),
    ignoreImportLine: true,
  },
  {
    message:
      "Use a tagged Effect error at the decision point; do not `throw`, `instanceof`, or library `try/catch/finally` (adapt with Effect.try/tryPromise and explicit operation/reason/status metadata).",
    test: hasRuntimeErrorHelpers,
    ignoreImportLine: false,
  },
  {
    message:
      "Use a TaggedErrorClass/Schema.TaggedErrorClass helper at the decision point. Do not create *Failure/*Fault/*Error helpers elsewhere.",
    test: ({ line, path, source }) => hasErrorFactoryOrClassName(line, path, source),
    ignoreImportLine: true,
  },
  {
    message:
      "Do not hide unknown causes behind generic safeCauseMetadata/toCauseMetadata wrappers; use explicit typed metadata or defects.",
    test: ({ line }) => hasGenericCauseMetadataWrapper(line),
    ignoreImportLine: true,
  },
  {
    message:
      "Do not use String(error/reason/cause) or error.message as the only preserved error data.",
    test: ({ line }) => hasStringErrorOnlyMapping(line),
    ignoreImportLine: false,
  },
  {
    message: "Do not call eventSink directly; use a safe Effect-native sink.",
    test: ({ line }) => hasDirectEventSinkCallback(line),
    ignoreImportLine: false,
  },
];
