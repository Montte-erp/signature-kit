import { describe, expect, it } from "vitest";
import type { Check, CheckContext } from "../src/model";
import { checks } from "../src/rule-set";
import { schemaContractChecks } from "../src/rules/schema-contracts";
import { errorHandlingChecks } from "../src/rules/error-handling";
import { typeSafetyChecks } from "../src/rules/type-safety";
import { architectureChecks } from "../src/rules/architecture";
import { effectBoundaryChecks } from "../src/rules/effect-boundaries";
import { observabilityCatalogChecks } from "../src/rules/observability-catalogs";
import { configChecks } from "../src/rules/config";
import { dependencyChecks } from "../src/rules/dependencies";
import { hasCheckedExtension } from "../src/filesystem";

const expectedChecks = [
  ...schemaContractChecks,
  ...errorHandlingChecks,
  ...typeSafetyChecks,
  ...effectBoundaryChecks,
  ...observabilityCatalogChecks,
  ...configChecks,
  ...dependencyChecks,
  ...architectureChecks,
];
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

const anyCheckMatchesSource = (checks: readonly Check[], path: string, source: string): boolean => {
  const rawLines = source.split(/\r?\n/);
  const lines = rawLines.map((line) => line.trim());
  return rawLines.some((rawLine, index) =>
    checks.some((check) =>
      check.test({
        line: lines[index] ?? "",
        rawLine,
        window: lines
          .slice(index, index + 3)
          .join(" ")
          .trim(),
        path,
        source,
        lineNumber: index + 1,
        lines,
        rawLines,
      }),
    ),
  );
};

describe("declarative smell rules", () => {
  it("registers every authored check in the composed rule set", () => {
    expect(checks.map((check) => check.message)).toEqual(
      expectedChecks.map((check) => check.message),
    );
  });

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

  it("rejects schema issue string laundering", () => {
    expect(anyCheckMatches(errorHandlingChecks, "reason: String(issue),")).toBe(true);
  });

  it("rejects message-only error laundering", () => {
    expect(anyCheckMatches(errorHandlingChecks, "reason: error.message,")).toBe(true);
    expect(anyCheckMatches(errorHandlingChecks, "cause: cause.message,")).toBe(true);
    expect(anyCheckMatches(errorHandlingChecks, "message: unknown.message,")).toBe(true);
    expect(anyCheckMatches(errorHandlingChecks, "issueMessage: String(issue),")).toBe(false);
    expect(anyCheckMatches(errorHandlingChecks, "reason: error.reason ?? error.message,")).toBe(
      false,
    );
  });

  it("rejects all TypeScript as casts including const assertions", () => {
    expect(anyCheckMatches(typeSafetyChecks, "const codes = ['A'] as const;")).toBe(true);
  });

  it("allows Effect.as because it is a method call, not a TypeScript cast", () => {
    expect(anyCheckMatches(typeSafetyChecks, "Effect.as({ ok: true })")).toBe(false);
  });

  it("allows real package entry modules", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/clicksign/src/index.ts",
        'import { Effect } from "effect";\nexport const clicksign = () => Effect.void;',
      ),
    ).toBe(false);
  });

  const inlineImportType =
    "const verify = (SignedXml: typeof " + "imp" + 'ort("xmldsigjs").SignedXml) => true;';

  it("rejects inline import type annotations", () => {
    expect(
      anyCheckMatchesSource(architectureChecks, "formats/xml/src/verify.ts", inlineImportType),
    ).toBe(true);
  });

  it("requires reasoned Effect run escapes in allowed React or docs paths", () => {
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "formats/react/src/a1.ts",
        `
// effect-boundary: React hook event action [allow-run: hook event-action boundary]
const result = await Effect.runPromise(program);
`,
      ),
    ).toBe(false);
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "formats/react/src/a1.ts",
        `
// effect-boundary: React hook event action [allow-run]
const result = await Effect.runPromise(program);
`,
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "core/signatures/src/signatures.ts",
        `
// effect-boundary: React hook event action [allow-run: hook event-action boundary]
const result = await Effect.runPromise(program);
`,
      ),
    ).toBe(true);
  });

  it("requires reasoned secret escapes in allowed React or docs paths", () => {
    expect(
      anyCheckMatchesSource(
        configChecks,
        "formats/react/src/config.ts",
        `
const CredentialsSchema = Schema.Struct({
  // secret-boundary: UI password import boundary [allow-string-secret: hook event-action boundary]
  password: Schema.String,
});
`,
      ),
    ).toBe(false);
    expect(
      anyCheckMatchesSource(
        configChecks,
        "formats/react/src/config.ts",
        `
const CredentialsSchema = Schema.Struct({
  // secret-boundary: UI password import boundary [allow-string-secret]
  password: Schema.String,
});
`,
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        configChecks,
        "core/signatures/src/signatures.ts",
        `
const CredentialsSchema = Schema.Struct({
  // secret-boundary: UI password import boundary [allow-string-secret: hook event-action boundary]
  password: Schema.String,
});
`,
      ),
    ).toBe(true);
  });
  it("scans package manifests so dependency checks are live", () => {
    expect(hasCheckedExtension("core/signatures/package.json")).toBe(true);
  });

  it("rejects retained Alchemy providers without an explicit no-op diff seam", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/example/src/index.ts",
        `
export const Example = Resource<ExampleResource>("Example.Resource", { defaultRemovalPolicy: "retain" });
export const ExampleProvider = () =>
  Provider.effect(
    Example,
    Effect.gen(function* () {
      return Example.Provider.of({
        list: () => Effect.succeed([]),
        reconcile: Effect.fn(function* ({ output }) {
          return output ?? { id: "created" };
        }),
        delete: Effect.fn(function* ({ output }) {
          yield* deleteRemote(output.id);
        }),
      });
    }),
  );
`,
      ),
    ).toBe(true);
  });

  it("rejects retained Alchemy provider delete branches without output", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/example/src/index.ts",
        `
export const Example = Resource<ExampleResource>("Example.Resource", { defaultRemovalPolicy: "retain" });
export const ExampleProvider = () =>
  Provider.effect(
    Example,
    Effect.gen(function* () {
      return Example.Provider.of({
        diff: Effect.fn(function* () {
          return { action: "noop" };
        }),
        list: () => Effect.succeed([]),
        reconcile: Effect.fn(function* ({ output }) {
          return output ?? { id: "created" };
        }),
        delete: Effect.fn(function* ({ output }) {
          if (output === undefined) {
            const all = yield* listEverything();
            yield* Effect.forEach(all, deleteRemote);
            return;
          }
          yield* deleteRemote(output.id);
        }),
      });
    }),
  );
`,
      ),
    ).toBe(true);
  });

  it("rejects ambient NODE_ENV base URL selection in remote signers", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/example/src/index.ts",
        'const baseUrl = process.env.NODE_ENV === "production" ? productionUrl : sandboxUrl;',
      ),
    ).toBe(true);
  });

  it("rejects hidden live HTTP transport in remote signer provider layers", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/example/src/index.ts",
        "Layer.provide(signatureHttpClientLive)",
      ),
    ).toBe(true);
  });

  it("rejects remote signer provider option decode wrappers", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/example/src/index.ts",
        "const decodeClicksignProviderOptions = (options: ClicksignProviderOptions) => Effect.void;",
      ),
    ).toBe(true);
  });

  it("rejects provider list array clones", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/example/src/index.ts",
        "list: () => listRequests().pipe(Effect.map((requests) => Array.from(requests))),",
      ),
    ).toBe(true);
  });

  it("flags core package manifest dependencies on product packages", () => {
    expect(
      anyCheckMatchesSource(
        dependencyChecks,
        "core/signatures/package.json",
        `
{
  "name": "@signature-kit/signatures",
  "version": "1.0.0",
  "dependencies": {
    "@signature-kit/clicksign": "workspace:*",
    "@signature-kit/documenso": "workspace:*",
    "@signature-kit/pdf": "workspace:*",
    "@signature-kit/iti": "workspace:*"
  }
}
`,
      ),
    ).toBe(true);
  });
  it("flags validator package manifest dependencies on signer packages", () => {
    expect(
      anyCheckMatchesSource(
        dependencyChecks,
        "validators/iti/package.json",
        `
{
  "name": "@signature-kit/iti",
  "version": "1.0.0",
  "dependencies": {
    "@signature-kit/clicksign": "workspace:*"
  }
}
`,
      ),
    ).toBe(true);
  });

  it("does not flag signer manifests depending on focused core packages or core imports from shared packages", () => {
    expect(
      anyCheckMatchesSource(
        dependencyChecks,
        "signers/clicksign/package.json",
        `
{
  "name": "@signature-kit/clicksign",
  "dependencies": {
    "@signature-kit/signatures": "workspace:*",
    "@signature-kit/http": "workspace:*"
  }
}
`,
      ),
    ).toBe(false);

    expect(
      anyCheckMatchesSource(
        dependencyChecks,
        "core/signatures/src/signatures.ts",
        'import { Effect } from "effect";',
      ),
    ).toBe(false);
  });
});
