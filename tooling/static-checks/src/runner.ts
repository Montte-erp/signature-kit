import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { requiredEffectSpanFiles, roots } from "./config";
import { walk } from "./filesystem";
import type { CheckContext } from "./model";
import { normalizeLine } from "./normalize";
import { hasRequiredSpanCall } from "./observability";
import { runWorkspaceLayerChecks } from "./layers";
import { checks } from "./rule-set";
import { errorHandlingChecks } from "./rules/error-handling";
import { typeSafetyChecks } from "./rules/type-safety";

export const importDeclarationLineMap = (rawLines: readonly string[]): readonly boolean[] => {
  let importDeclarationOpen = false;
  return rawLines.map((rawLine) => {
    if (!importDeclarationOpen) {
      importDeclarationOpen = /^\s*import(?:\s+type)?(?:\s|["'{*])/.test(rawLine);
    }

    const isImportLine = importDeclarationOpen;
    if (
      importDeclarationOpen &&
      (rawLine.includes(";") ||
        /(?:\bfrom\s*|^\s*import\s*)["'][^"']+["']\s*(?:(?:\/\/.*)?)$/.test(rawLine))
    ) {
      importDeclarationOpen = false;
    }
    return isImportLine;
  });
};

export const runDeclarativeChecks = (): boolean => {
  let failed = runWorkspaceLayerChecks();
  for (const file of roots.flatMap((root) => [...walk(root)])) {
    const source = readFileSync(file, "utf8");
    const requiredSpans = requiredEffectSpanFiles[file];
    if (requiredSpans !== undefined) {
      for (const span of requiredSpans) {
        if (!hasRequiredSpanCall(source, span)) {
          console.error(`${relative(process.cwd(), file)}:1: ${span.name}`);
          console.error(
            "Declarative error handling check failed. Flows must keep real Effect.withSpan calls from the observability catalog.",
          );
          failed = true;
        }
      }
    }
    const rawLines = source.split(/\r?\n/);
    const lines = rawLines.map(normalizeLine);
    const isTestFile = /(?:^|\/)__tests__\/|(?:\.test|\.spec)\.[^./]+$/.test(file);
    const activeChecks = isTestFile
      ? checks.filter(
          (check) => typeSafetyChecks.includes(check) || errorHandlingChecks.includes(check),
        )
      : file.startsWith("apps/docs/")
        ? checks.filter((check) => check.message.startsWith("Do not apply Effect/Layer provide"))
        : checks;

    const importLines = importDeclarationLineMap(rawLines);
    for (const [index, rawLine] of rawLines.entries()) {
      const line = lines[index] ?? "";
      const normalizedLine = line.trim();
      const isImport = importLines[index] === true;

      if (!normalizedLine || normalizedLine.startsWith("*") || normalizedLine.startsWith("//")) {
        continue;
      }

      const context: CheckContext = {
        line: normalizedLine,
        rawLine,
        window: lines
          .slice(index, index + 3)
          .join(" ")
          .trim(),
        path: file,
        source,
        lineNumber: index + 1,
        lines,
        rawLines,
      };
      for (const check of activeChecks) {
        if (check.ignoreImportLine && isImport) {
          continue;
        }

        if (!check.test(context)) {
          continue;
        }

        console.error(`${relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`);
        console.error(`Declarative error handling check failed. ${check.message}`);
        failed = true;
        break;
      }
    }
  }

  return failed;
};
