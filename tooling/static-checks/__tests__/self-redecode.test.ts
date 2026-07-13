import * as ts from "typescript";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hasDecodeCall = (source: string, schemaName: string): boolean => {
  const sourceFile = ts.createSourceFile(
    "fixture.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "decodeUnknownEffect" &&
      node.arguments.length > 0 &&
      node.arguments[0]?.getText(sourceFile) === schemaName
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

describe("typed report construction", () => {
  it("does not re-decode reports built inside trusted ITI and CMS internals", () => {
    expect(
      hasDecodeCall(
        readFileSync("validators/iti/src/conformance.ts", "utf8"),
        "ItiConformanceReportSchema",
      ),
    ).toBe(false);
    expect(
      hasDecodeCall(
        readFileSync("validators/iti/src/remote.ts", "utf8"),
        "ItiRemoteValidationReportSchema",
      ),
    ).toBe(false);
    expect(
      hasDecodeCall(
        readFileSync("shared/cms/src/inspect.ts", "utf8"),
        "CmsSignedDataInspectionSchema",
      ),
    ).toBe(false);
  });
});
