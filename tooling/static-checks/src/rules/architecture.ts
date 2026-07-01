import type { Check, CheckContext } from "../model";

const packageIndexPathPattern = /^(?:core|formats|shared|signers)\/[^/]+\/src\/index\.ts$/;
const alchemyProviderPathPattern = /^signers\/[^/]+\/src\/index\.ts$/;

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

const hasRetainedAlchemyResource = (source: string): boolean =>
  /defaultRemovalPolicy\s*:\s*["']retain["']/.test(source);

const hasAlchemyProviderService = (line: string): boolean => /\.Provider\.of\(\{/.test(line);

const lacksProviderDiff = (source: string): boolean => !/\bdiff\s*:/.test(source);

const isInsideDeleteHandler = (context: CheckContext): boolean => {
  const before = context.lines
    .slice(Math.max(0, context.lineNumber - 12), context.lineNumber)
    .join(" ");
  return /\bdelete\s*:\s*Effect\.fn/.test(before);
};

const hasUndefinedOutputBranch = (line: string): boolean =>
  /\bif\s*\(\s*output\s*={2,3}\s*undefined\s*\)/.test(line);

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
  {
    message:
      "Retained Alchemy resources must declare a provider diff hook so changed props do not imply an update or replacement.",
    test: (context) =>
      alchemyProviderPathPattern.test(context.path) &&
      hasRetainedAlchemyResource(context.source) &&
      hasAlchemyProviderService(context.line) &&
      lacksProviderDiff(context.source),
    ignoreImportLine: false,
  },
  {
    message:
      "Retained Alchemy provider delete handlers must not branch on missing output and enumerate account-wide resources.",
    test: (context) =>
      alchemyProviderPathPattern.test(context.path) &&
      hasRetainedAlchemyResource(context.source) &&
      isInsideDeleteHandler(context) &&
      hasUndefinedOutputBranch(context.line),
    ignoreImportLine: false,
  },
  {
    message:
      "Remote signer packages must not read ambient NODE_ENV; base URL selection belongs in explicit provider options.",
    test: (context) =>
      alchemyProviderPathPattern.test(context.path) &&
      /\bprocess\.env\.NODE_ENV\b/.test(context.line),
    ignoreImportLine: false,
  },
  {
    message:
      "Remote signer providers must not hide signatureHttpClientLive; expose SignatureHttpClient as a layer requirement.",
    test: (context) =>
      alchemyProviderPathPattern.test(context.path) &&
      /\bLayer\.provide\(\s*signatureHttpClientLive\s*\)/.test(context.line),
    ignoreImportLine: false,
  },
  {
    message:
      "Remote signer provider options must be decoded inline at the layer or public API boundary; do not hide schema failures behind decode*ProviderOptions wrappers.",
    test: (context) =>
      alchemyProviderPathPattern.test(context.path) &&
      /\bconst\s+decode[A-Z][A-Za-z0-9]*ProviderOptions\b/.test(context.line),
    ignoreImportLine: false,
  },
  {
    message:
      "Remote signer provider list handlers must not clone request arrays just to satisfy Alchemy types.",
    test: (context) =>
      alchemyProviderPathPattern.test(context.path) &&
      /\bArray\.from\(\s*requests\s*\)/.test(context.line),
    ignoreImportLine: false,
  },
];
