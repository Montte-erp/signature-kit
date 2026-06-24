import type { Check } from "../model";
import { contractSuffixes, exportContractDeclarationPattern } from "../config";
import { escapeRegex, isAdapterOrPackageFile, isFiscalCoreFile } from "./shared";

const hasManualSchemaContract = (line: string, path: string, source: string): boolean => {
  if (!isAdapterOrPackageFile(path) && !isFiscalCoreFile(path)) {
    return false;
  }

  const match = exportContractDeclarationPattern.exec(line);
  if (!match) {
    return false;
  }

  const name = match[1] ?? "";
  const escapedName = escapeRegex(name);
  const schemaName = name + "Schema";
  const camelSchemaName = (name[0]?.toLowerCase() ?? "") + name.slice(1) + "Schema";
  const schemaCandidates = new Set([schemaName, camelSchemaName]);
  for (const suffix of contractSuffixes) {
    if (!name.endsWith(suffix)) {
      continue;
    }

    const reduced = name.slice(0, -suffix.length);
    if (!reduced) {
      continue;
    }

    schemaCandidates.add(reduced + "Schema");
    schemaCandidates.add((reduced[0]?.toLowerCase() ?? "") + reduced.slice(1) + "Schema");
  }
  const schemaAlternatives = [...schemaCandidates].map(escapeRegex).join("|");
  const namedSchemaPattern = "\\b(?:const|export\\s+const)\\s+(?:" + schemaAlternatives + ")\\b";
  const schemaAnnotationPattern =
    "\\bSchema\\.(?:ConstraintDecoder|Schema)\\s*<\\s*" + escapedName + "\\b";
  const contextPattern = "\\bContext\\.Reference\\s*<\\s*" + escapedName + "\\s*>";
  const derivedTypePattern =
    "\\b(?:export\\s+)?type\\s+" +
    escapedName +
    "\\s*=\\s*(?:\\(\\s*)?typeof\\s+(?:" +
    schemaAlternatives +
    ')\\s*\\)\\s*\\["Type"\\](?:\\s*\\[\\])?(?:\\s*[&;])?';

  return !new RegExp(
    namedSchemaPattern +
      "|" +
      schemaAnnotationPattern +
      "|" +
      contextPattern +
      "|" +
      derivedTypePattern,
  ).test(source);
};

const hasAllowedSchemaLiteralSource = (line: string): boolean =>
  /\bSchema\.Literals\s*\(/.test(line) ||
  /\b(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*=\s*\(typeof\s+[A-Za-z_$][\w$]*Schema\)\["Type"\]/.test(
    line,
  );

const literalCodeArrayDeclarationPattern =
  /^\s*(?:const|let|var)\s+([A-Z][A-Z0-9_]*|[A-Za-z_$][\w$]*(?:Code|Codes|Status|Statuses|Reason|Reasons|Event|Events))\b/;

// Domain code/status/event catalogs are STRING literals. Numeric-only arrays are
// math/data tables (e.g. crypto S-boxes) and are intentionally excluded.
const literalItemPattern = /^(?:"[^"]*"|'[^']*'|`[^`]*`)$/;

const hasLiteralCodeArray = (line: string): boolean => {
  if (hasAllowedSchemaLiteralSource(line)) {
    return false;
  }

  if (!literalCodeArrayDeclarationPattern.test(line)) {
    return false;
  }

  const open = line.indexOf("[");
  const close = line.lastIndexOf("]");
  if (open === -1 || close <= open + 1) {
    return false;
  }

  const body = line.slice(open + 1, close).trim();
  const values = body
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

  if (values.length === 0) {
    return false;
  }

  if (
    !values.every((value) =>
      literalItemPattern.test(
        value
          .replace(/\s+as\s+const$/u, "")
          .replace(/\s+as\s+(?!const)\w+$/u, "")
          .trim(),
      ),
    )
  ) {
    return false;
  }
  return true;
};

export const schemaContractChecks: readonly Check[] = [
  {
    message:
      "Use a Schema-derived type for exported config/data contracts in public packages; do not duplicate the shape in a manual interface.",
    test: ({ line, path, source }) => hasManualSchemaContract(line, path, source),
    ignoreImportLine: false,
  },
  {
    message:
      "List codes/statuses/events with `Schema.Literals(...)`; do not keep raw literal domain arrays.",
    test: ({ line }) => hasLiteralCodeArray(line),
    ignoreImportLine: false,
  },
];
