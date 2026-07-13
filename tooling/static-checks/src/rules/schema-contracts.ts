import * as ts from "typescript";
import type { Check, CheckContext } from "../model";
import { contractSuffixes } from "../config";
import { isAdapterOrPackageFile, isSignatureRuntimeFile } from "./shared";

const contractNamePattern = new RegExp(`^[A-Za-z_$][\\w$]*(?:${contractSuffixes.join("|")})$`);

const hasManualSchemaContract = (context: CheckContext): boolean => {
  if (!isAdapterOrPackageFile(context.path) && !isSignatureRuntimeFile(context.path)) {
    return false;
  }

  for (const statement of context.sourceFile.statements) {
    if (
      !(ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) ||
      !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ||
      statement.name === undefined ||
      !contractNamePattern.test(statement.name.text) ||
      context.sourceFile.getLineAndCharacterOfPosition(statement.getStart(context.sourceFile))
        .line !==
        context.lineNumber - 1
    ) {
      continue;
    }

    const name = statement.name.text;
    if (
      ts.isTypeAliasDeclaration(statement) &&
      (statement.type.getText(context.sourceFile).includes("Resource<") ||
        statement.type.getText(context.sourceFile).includes("Schema."))
    ) {
      return false;
    }

    const schemaCandidates = new Set<string>([
      `${name}Schema`,
      `${name[0]?.toLowerCase() ?? ""}${name.slice(1)}Schema`,
    ]);
    for (const suffix of contractSuffixes) {
      if (!name.endsWith(suffix)) {
        continue;
      }
      const reduced = name.slice(0, -suffix.length);
      if (reduced.length > 0) {
        schemaCandidates.add(`${reduced}Schema`);
        schemaCandidates.add(`${reduced[0]?.toLowerCase() ?? ""}${reduced.slice(1)}Schema`);
      }
    }

    let hasSchemaBinding = false;
    const visit = (node: ts.Node): void => {
      if (hasSchemaBinding) {
        return;
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        schemaCandidates.has(node.name.text)
      ) {
        const initializer = node.initializer;
        const annotation = node.type?.getText(context.sourceFile) ?? "";
        const initializerText = initializer?.getText(context.sourceFile) ?? "";
        if (
          annotation.startsWith("Schema.") ||
          /^Schema\./.test(initializerText) ||
          initializerText.startsWith("Schema.")
        ) {
          hasSchemaBinding = true;
          return;
        }
      }
      if (ts.isTypeAliasDeclaration(node) && node.name.text === name) {
        const typeText = node.type.getText(context.sourceFile);
        if ([...schemaCandidates].some((candidate) => typeText.includes(`typeof ${candidate}`))) {
          hasSchemaBinding = true;
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(context.sourceFile);
    if (context.source.includes(`Context.Reference<${name}>`)) {
      hasSchemaBinding = true;
    }
    return !hasSchemaBinding;
  }
  return false;
};

const literalCodeArrayDeclarationPattern =
  /^(?:[A-Za-z_$][\w$]*(?:Code|Codes|Status|Statuses|Reason|Reasons|Event|Events|code|codes|status|statuses|reason|reasons|event|events)|[A-Z][A-Z0-9_]*(?:CODE|CODES|STATUS|STATUSES|REASON|REASONS|EVENT|EVENTS))$/;

const literalCodeArrayLines = new WeakMap<ts.SourceFile, ReadonlySet<number>>();

const getLiteralCodeArrayLines = (sourceFile: ts.SourceFile): ReadonlySet<number> => {
  const cached = literalCodeArrayLines.get(sourceFile);
  if (cached !== undefined) {
    return cached;
  }
  const lines = new Set<number>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !literalCodeArrayDeclarationPattern.test(declaration.name.text)
      ) {
        continue;
      }
      let initializer = declaration.initializer;
      while (
        initializer !== undefined &&
        (ts.isAsExpression(initializer) ||
          ts.isParenthesizedExpression(initializer) ||
          ts.isSatisfiesExpression(initializer))
      ) {
        initializer = initializer.expression;
      }
      if (
        initializer !== undefined &&
        ts.isArrayLiteralExpression(initializer) &&
        initializer.elements.length > 0 &&
        initializer.elements.every(
          (element) => ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element),
        )
      ) {
        lines.add(sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line);
      }
    }
  }
  literalCodeArrayLines.set(sourceFile, lines);
  return lines;
};

const hasLiteralCodeArray = (context: CheckContext): boolean =>
  getLiteralCodeArrayLines(context.sourceFile).has(context.lineNumber - 1);

export const schemaContractChecks: readonly Check[] = [
  {
    message:
      "Use a Schema-derived type for exported config/data contracts in public packages; do not duplicate the shape in a manual interface.",
    test: hasManualSchemaContract,
    ignoreImportLine: false,
  },
  {
    message:
      "List codes/statuses/events with `Schema.Literals(...)`; do not keep raw literal domain arrays.",
    test: hasLiteralCodeArray,
    ignoreImportLine: false,
  },
];
