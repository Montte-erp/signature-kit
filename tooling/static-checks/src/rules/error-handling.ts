import type { Check } from "../model";

const hasHttpClientErrorInspector = (line: string): boolean =>
  /\b(?:const|function)\s+(?:isRecord|get[A-Za-z_$][\w$]*Error[A-Za-z_$\w$]*|create[A-Za-z_$][\w$]*Error[A-Za-z_$\w$]*)\b/.test(
    line,
  );

const hasRuntimeErrorHelpers = (line: string, path: string): boolean => {
  const statementKeywords = /\b(try|catch|finally)\b\s*[{(]/g;
  for (const match of line.matchAll(statementKeywords)) {
    const start = match.index ?? 0;
    const before = start > 0 ? line[start - 1] : "";
    if (before === "." || before === "?") {
      continue;
    }

    return true;
  }

  if (
    /\binstanceof\s+(?:(?:[A-Za-z_$][\w$]*\.)*)(?:Error|DOMException|[A-Za-z_$][\w$]*(?:Error|Failure|Fault|Exception))\b/.test(
      line,
    )
  ) {
    return true;
  }
  if (!/(?:^|\/)__tests__\//.test(path) || !/\bthrow\s+new\s+Error\b/.test(line)) {
    if (/\bthrow\s+new\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?(?:\s*<[^>]+>)?)/.test(line)) {
      return true;
    }
  }

  for (const match of line.matchAll(/\bthrow\b\s+([^;]+)/g)) {
    const expr = (match[1] ?? "").trim();
    if (expr !== "" && !/^new\s/.test(expr)) {
      return true;
    }
  }

  if (/\b(isHTTPError|isTimeoutError|HTTPError|TimeoutError)\b(?!\s*:)/.test(line)) {
    return true;
  }

  return false;
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
    test: ({ line, path }) => hasRuntimeErrorHelpers(line, path),
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
