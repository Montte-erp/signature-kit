import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { requiredEffectSpanFiles, roots } from "./config";
import { walk } from "./filesystem";
import type { CheckContext } from "./model";
import { normalizeLine } from "./normalize";
import { hasRequiredSpanCall } from "./observability";
import { runWorkspaceLayerChecks } from "./layers";
import { checks } from "./rule-set";

const isImportLine = (line: string): boolean => /^\s*import\b/.test(line);

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
    const activeChecks = file.startsWith("apps/docs/")
      ? checks.filter((check) => check.message.startsWith("Do not apply Effect/Layer provide"))
      : checks;

    for (const [index, rawLine] of rawLines.entries()) {
      const line = lines[index] ?? "";
      const normalizedLine = line.trim();
      const isImport = isImportLine(normalizedLine);

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
