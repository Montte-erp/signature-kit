import * as ts from "typescript";
import type { CheckContext } from "./model";
import { normalizeSource } from "./normalize";

export const parseSourceFile = (path: string, source: string): ts.SourceFile =>
  ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") || path.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

export const createCheckContexts = (path: string, source: string): readonly CheckContext[] => {
  const rawLines = source.split(/\r?\n/);
  const lines = normalizeSource(source).split(/\r?\n/);
  const sourceFile = parseSourceFile(path, source);
  let manifest: unknown = undefined;
  if (path.endsWith("package.json")) {
    try {
      manifest = JSON.parse(source);
    } catch {
      manifest = undefined;
    }
  }
  return rawLines.map((rawLine, index) => ({
    line: (lines[index] ?? "").trim(),
    rawLine,
    window: lines
      .slice(index, index + 3)
      .join(" ")
      .trim(),
    path,
    source,
    sourceFile,
    parsedJson: manifest,
    lineNumber: index + 1,
    lines,
    rawLines,
  }));
};
