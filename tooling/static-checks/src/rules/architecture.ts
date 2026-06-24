import type { Check, CheckContext } from "../model";

const packageIndexPathPattern = /^(?:core|formats|shared|signers)\/[^/]+\/src\/index\.ts$/;

const withoutBlockComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "");

const meaningfulLine = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith("//");
};

const firstExportLineNumber = (context: CheckContext): number =>
  context.rawLines.findIndex((line) => line.trim().startsWith("export ")) + 1;

const hasOnlyReexports = (source: string): boolean => {
  const withoutComments = withoutBlockComments(source);
  const meaningfulSource = withoutComments.split(/\r?\n/).filter(meaningfulLine).join("\n");
  if (!meaningfulSource.includes("export")) {
    return false;
  }

  const withoutNamedReexports = meaningfulSource.replace(
    /export\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+["'][^"']+["'];?/g,
    "",
  );
  const withoutStarReexports = withoutNamedReexports.replace(
    /export\s+\*\s+from\s+["'][^"']+["'];?/g,
    "",
  );

  return withoutStarReexports.trim().length === 0;
};

export const architectureChecks: readonly Check[] = [
  {
    message:
      "Package index files must not be re-export-only barrels; export subpaths to the real module instead.",
    test: (context) =>
      packageIndexPathPattern.test(context.path) &&
      context.lineNumber === firstExportLineNumber(context) &&
      hasOnlyReexports(context.source),
    ignoreImportLine: false,
  },
];
