import type { Check } from "../model";
import { isTaggedErrorName } from "./shared";

const hasHttpClientErrorInspector = (line: string): boolean =>
  /\b(?:const|function)\s+(?:isRecord|get[A-Za-z_$][\w$]*Error[A-Za-z_$\w$]*|create[A-Za-z_$][\w$]*Error[A-Za-z_$\w$]*)\b/.test(
    line,
  );

const hasRuntimeErrorHelpers = (line: string): boolean => {
  const statementKeywords = /\b(try|catch|finally)\b\s*[{(]/g;
  for (const match of line.matchAll(statementKeywords)) {
    const start = match.index ?? 0;
    const before = start > 0 ? line[start - 1] : "";
    if (before === "." || before === "?") {
      continue;
    }

    return true;
  }

  if (/\binstanceof\b/.test(line)) {
    return true;
  }
  const throwNewMatch = /throw\s+new\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?(?:\s*<[^>]+>)?)/g;
  for (const match of line.matchAll(throwNewMatch)) {
    const candidate = match[1]?.trim() ?? "";
    if (!candidate) {
      continue;
    }

    if (!isTaggedErrorName(candidate)) {
      return true;
    }
  }

  // Throwing a non-`new` expression (re-throw a caught value, throw a pre-built
  // error or a factory call) is never Effect-native; use Effect.fail instead.
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
    /\b(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\b/.exec(line);
  if (!declarationMatch) {
    return false;
  }

  const declaration = line.slice(
    declarationMatch.index,
    declarationMatch.index + declarationMatch[0].length,
  );
  const name = declarationMatch[1] ?? "";
  if (/(?:Failure|Fault|Error)$/.test(name)) {
    if (/\bclass\b/.test(declaration) && /TaggedError/i.test(source)) {
      const start = source.indexOf(line);
      if (start !== -1) {
        const tail = source.slice(start, start + line.length + 200);
        if (/\bTaggedErrorClass\b/.test(tail) || /\bSchema\.TaggedError\b/.test(tail)) {
          return false;
        }
      }
    }

    return true;
  }

  return /\b(?:create|make|parse|build|normalize|sanitize|coerce|assert|wrap|unwrap|map)[A-Za-z_$]*(?:Error|Failure|Fault)\b/.test(
    name,
  );
};

const hasStringErrorOnlyMapping = (line: string): boolean =>
  /\b(?:reason|cause|message)\s*:\s*String\s*\(\s*(?:error|reason|cause|unknown)\s*\)/.test(line);

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
    test: ({ line }) => hasRuntimeErrorHelpers(line),
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
    message: "Do not use String(error/reason/cause) as the only preserved error data.",
    test: ({ line }) => hasStringErrorOnlyMapping(line),
    ignoreImportLine: false,
  },
  {
    message: "Do not call eventSink directly; use a safe Effect-native sink.",
    test: ({ line }) => hasDirectEventSinkCallback(line),
    ignoreImportLine: false,
  },
];
