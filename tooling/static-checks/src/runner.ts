import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import * as ts from "typescript";
import { requiredEffectSpanFiles, roots } from "./config";
import { walk } from "./filesystem";
import type { Check } from "./model";
import { hasRequiredSpanCall } from "./observability";
import { runWorkspaceLayerChecks } from "./layers";
import { checks } from "./rule-set";
import { errorHandlingChecks } from "./rules/error-handling";
import { typeSafetyChecks } from "./rules/type-safety";
import { createCheckContexts, parseSourceFile } from "./source-context";

const normalizePath = (path: string): string => path.replaceAll("\\", "/");

export const importDeclarationLineMap = (
  rawLines: readonly string[],
  sourceFile = parseSourceFile("fixture.ts", rawLines.join("\n")),
): readonly boolean[] => {
  const lines = rawLines.map(() => false);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    const start = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line;
    const end = sourceFile.getLineAndCharacterOfPosition(statement.end).line;
    for (let index = start; index <= end && index < lines.length; index += 1) {
      lines[index] = true;
    }
  }
  return lines;
};

const checksForPath = (path: string): readonly Check[] => {
  const isTestFile = /(?:^|\/)__tests__\/|(?:\.test|\.spec)\.[^./]+$/.test(path);
  return isTestFile
    ? checks.filter(
        (check) => typeSafetyChecks.includes(check) || errorHandlingChecks.includes(check),
      )
    : path.startsWith("apps/docs/")
      ? checks.filter((check) => check.message.startsWith("Do not apply Effect/Layer provide"))
      : checks;
};

export const runFileDeclarativeChecks = (
  file: string,
  source: string,
  rootDirectory = process.cwd(),
): boolean => {
  const displayPath = normalizePath(relative(rootDirectory, file));
  const contexts = createCheckContexts(displayPath, source);
  const sourceFile = contexts[0]?.sourceFile ?? parseSourceFile(displayPath, source);
  const importLines = importDeclarationLineMap(
    contexts.map((context) => context.rawLine),
    sourceFile,
  );
  const activeChecks = checksForPath(displayPath);
  let failed = false;

  for (const [index, context] of contexts.entries()) {
    if (!context.line || context.line.startsWith("*") || context.line.startsWith("//")) {
      continue;
    }

    for (const check of activeChecks) {
      if (check.ignoreImportLine && importLines[index] === true) {
        continue;
      }
      if (!check.test(context)) {
        continue;
      }

      console.error(`${displayPath}:${context.lineNumber}: ${context.line}`);
      console.error(`Declarative error handling check failed. ${check.message}`);
      failed = true;
      break;
    }
  }
  return failed;
};

export const runDeclarativeChecks = (
  rootDirectory = process.cwd(),
  selectedRoots: readonly string[] = roots,
): boolean => {
  let failed = runWorkspaceLayerChecks(rootDirectory);
  for (const configuredRoot of selectedRoots) {
    const root = resolve(rootDirectory, configuredRoot);
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8");
      const displayPath = normalizePath(relative(rootDirectory, file));
      const requiredSpans = requiredEffectSpanFiles[displayPath];
      if (requiredSpans !== undefined) {
        for (const span of requiredSpans) {
          if (hasRequiredSpanCall(source, span)) {
            continue;
          }
          console.error(`${displayPath}:1: ${span.name}`);
          console.error(
            "Declarative error handling check failed. Flows must keep real Effect.withSpan calls from the observability catalog.",
          );
          failed = true;
        }
      }
      if (runFileDeclarativeChecks(file, source, rootDirectory)) {
        failed = true;
      }
    }
  }
  return failed;
};
