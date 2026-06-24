import { describe, expect, it } from "vitest";
import type { Check, CheckContext } from "../src/model";
import { errorHandlingChecks } from "../src/rules/error-handling";
import { typeSafetyChecks } from "../src/rules/type-safety";
import { architectureChecks } from "../src/rules/architecture";

const context = (line: string): CheckContext => ({
  line,
  rawLine: line,
  window: line,
  path: "core/example/src/index.ts",
  source: line,
  lineNumber: 1,
  lines: [line],
  rawLines: [line],
});

const anyCheckMatches = (checks: readonly Check[], line: string): boolean =>
  checks.some((check) => check.test(context(line)));

const contextForSource = (path: string, source: string): CheckContext => ({
  line: source.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "",
  rawLine: source.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "",
  window: source,
  path,
  source,
  lineNumber: 1,
  lines: source.split(/\r?\n/),
  rawLines: source.split(/\r?\n/),
});

const anyCheckMatchesSource = (checks: readonly Check[], path: string, source: string): boolean =>
  checks.some((check) => check.test(contextForSource(path, source)));

describe("declarative smell rules", () => {
  it("rejects instanceof-based cause classification", () => {
    expect(
      anyCheckMatches(errorHandlingChecks, "if (cause instanceof Error) return cause.message;"),
    ).toBe(true);
  });

  it("rejects generic cause metadata wrappers", () => {
    expect(
      anyCheckMatches(errorHandlingChecks, "export const safeCauseMetadata = () => ({})"),
    ).toBe(true);
  });

  it("rejects all TypeScript as casts including const assertions", () => {
    expect(anyCheckMatches(typeSafetyChecks, "const codes = ['A'] as const;")).toBe(true);
  });

  it("rejects re-export-only package index barrels", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "formats/pdf/src/index.ts",
        'export { signPdf } from "./sign";\nexport type { PdfSigningRequest } from "./config";',
      ),
    ).toBe(true);
  });

  it("allows real package entry modules", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/docusign/src/index.ts",
        'import { Effect } from "effect";\nexport const docusign = () => Effect.void;',
      ),
    ).toBe(false);
  });
});
