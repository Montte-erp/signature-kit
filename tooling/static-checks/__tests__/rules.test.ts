import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Check } from "../src/model";
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
import { importDeclarationLineMap, runDeclarativeChecks } from "../src/runner";
import { createCheckContexts } from "../src/source-context";

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

const context = (line: string) => {
  const first = createCheckContexts("core/example/src/index.ts", line)[0];
  if (first === undefined) {
    throw new Error("fixture context missing");
  }
  return first;
};

const anyCheckMatches = (checks: readonly Check[], line: string): boolean =>
  checks.some((check) => check.test(context(line)));

const anyCheckMatchesSource = (checks: readonly Check[], path: string, source: string): boolean => {
  const contexts = createCheckContexts(path, source);
  const sourceFile = contexts[0]?.sourceFile;
  if (sourceFile === undefined) {
    return false;
  }
  const importLines = importDeclarationLineMap(
    contexts.map((item) => item.rawLine),
    sourceFile,
  );
  return contexts.some(
    (item, index) =>
      item.line !== "" &&
      !item.line.startsWith("*") &&
      !item.line.startsWith("//") &&
      checks.some((check) => (!check.ignoreImportLine || !importLines[index]) && check.test(item)),
  );
};

describe("declarative smell rules", () => {
  it("registers every authored check in the composed rule set", () => {
    expect(checks.map((check) => check.message)).toEqual(
      expectedChecks.map((check) => check.message),
    );
  });

  it("rejects instanceof error and cause classification", () => {
    for (const line of [
      "if (cause instanceof Error) return cause.message;",
      "if (cause instanceof DOMException) return cause.name;",
      "if (error instanceof RemoteFailure) return error.code;",
      "if (error instanceof vendor.TransportFault) return error.code;",
      "if (error instanceof ValidationException) return error.code;",
    ]) {
      expect(anyCheckMatches(errorHandlingChecks, line)).toBe(true);
    }
  });

  it("allows instanceof for structural parsed-node discrimination", () => {
    for (const line of [
      "if (object instanceof PDFNumber) return object.asNumber();",
      "if (value instanceof asn1js.Sequence) return value.valueBlock.value;",
    ]) {
      expect(anyCheckMatches(errorHandlingChecks, line)).toBe(false);
    }
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

  it("requires catalog values for domain code, operation, and phase strings", () => {
    for (const line of [
      'code: "document.invalid",',
      'operation: "document.verify",',
      'phase: "DocumentVerification",',
    ]) {
      expect(anyCheckMatches(observabilityCatalogChecks, line)).toBe(true);
    }
  });

  it("allows ordinary names outside observability catalogs", () => {
    expect(anyCheckMatches(observabilityCatalogChecks, 'name: "document.pdf",')).toBe(false);
  });

  it("rejects all TypeScript as casts including const assertions", () => {
    expect(anyCheckMatches(typeSafetyChecks, "const codes = ['A'] as const;")).toBe(true);
  });

  it("scans test files for casts without general exceptions", () => {
    expect(
      anyCheckMatchesSource(
        typeSafetyChecks,
        "core/example/__tests__/fixture.test.ts",
        "const value = input as unknown;",
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        typeSafetyChecks,
        "core/example/__tests__/fixture.test.ts",
        "const values = ['ok'] as const;",
      ),
    ).toBe(true);
  });

  it("rejects throwing even a typed SignatureKit error from library code", () => {
    expect(
      anyCheckMatchesSource(
        errorHandlingChecks,
        "core/example/src/runtime.ts",
        "throw new SignatureKitError({ code: 'invalid' });",
      ),
    ).toBe(true);
  });

  it("rejects try/finally in test files while preserving assertion throws", () => {
    expect(
      anyCheckMatchesSource(
        errorHandlingChecks,
        "core/example/__tests__/fixture.test.ts",
        "try { await run(); } finally { cleanup(); }",
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        errorHandlingChecks,
        "core/example/__tests__/fixture.test.ts",
        'throw new Error("expected failure");',
      ),
    ).toBe(false);
  });

  it("allows Effect.as because it is a method call, not a TypeScript cast", () => {
    expect(anyCheckMatches(typeSafetyChecks, "Effect.as({ ok: true })")).toBe(false);
  });

  it("does not treat aliases in multiline imports as TypeScript casts", () => {
    expect(
      anyCheckMatchesSource(
        typeSafetyChecks,
        "formats/xml/src/runtime.ts",
        `import {
  Signature as XmlDsigSignature,
} from "xmldsigjs";`,
      ),
    ).toBe(false);
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

  it("requires a reasoned provide marker immediately before a React provide call", () => {
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "formats/react/src/a1.ts",
        `
// effect-boundary: browser worker injection [allow-provide: browser worker layer boundary]
Effect.provide(Layer.empty);
`,
      ),
    ).toBe(false);
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "formats/react/src/a1.ts",
        `
// effect-boundary: browser worker injection [allow-provide]
Effect.provide(Layer.empty);
`,
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "formats/react/src/a1.ts",
        `
// effect-boundary: browser worker injection [allow-provide: browser worker layer boundary]
const program = Effect.void;
Effect.provide(Layer.empty);
`,
      ),
    ).toBe(true);
  });

  it("rejects deprecated Effect either/effect and dynamic imports in library source", () => {
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "core/signatures/src/runtime.ts",
        "const result = Effect.either(program);",
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "core/signatures/src/runtime.ts",
        'const module = import("./runtime-helper");',
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "core/signatures/src/runtime.ts",
        "const module = import(moduleName);",
      ),
    ).toBe(false);
  });

  it("rejects named Effect escapes and direct Node platform imports only in library source", () => {
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "core/signatures/src/runtime.ts",
        'import { runPromise } from "effect";\nconst result = runPromise(program);',
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "core/signatures/src/runtime.ts",
        'import { readFile } from "node:fs/promises";',
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "apps/docs/app/page.ts",
        'import { readFile } from "node:fs/promises";',
      ),
    ).toBe(false);
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

  it("checks Alchemy provider rules in every remote signer source module but excludes A1", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/example/src/provider.ts",
        'const baseUrl = process.env.NODE_ENV === "production" ? productionUrl : sandboxUrl;',
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/a1/src/signer.ts",
        'const baseUrl = process.env.NODE_ENV === "production" ? productionUrl : sandboxUrl;',
      ),
    ).toBe(false);
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

  it("rejects memoized provider layers under per-call credential wrappers", () => {
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/example/src/index.ts",
        "Layer.provide(exampleSignatureRequestProvider)",
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        architectureChecks,
        "signers/example/src/index.ts",
        "Layer.provide(Layer.fresh(exampleSignatureRequestProvider))",
      ),
    ).toBe(false);
  });

  it("flags public package scripts that shadow inferred TypeScript targets", () => {
    expect(
      anyCheckMatchesSource(
        dependencyChecks,
        "formats/pdf/package.json",
        `
{
  "name": "@signature-kit/pdf",
  "scripts": {
    "build": "tsc -b tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
`,
      ),
    ).toBe(true);
  });

  it("allows non-TypeScript package scripts and application build scripts", () => {
    expect(
      anyCheckMatchesSource(
        dependencyChecks,
        "formats/pdf/package.json",
        `
{
  "name": "@signature-kit/pdf",
  "scripts": {
    "test": "vitest run"
  }
}
`,
      ),
    ).toBe(false);
    expect(
      anyCheckMatchesSource(
        dependencyChecks,
        "apps/docs/package.json",
        `
{
  "name": "@signature-kit/docs",
  "scripts": {
    "build": "waku build",
    "types:check": "tsc -p tsconfig.json --noEmit"
  }
}
`,
      ),
    ).toBe(false);
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
  it("uses stateful comment normalization for multiline blocks", () => {
    expect(
      anyCheckMatchesSource(
        errorHandlingChecks,
        "core/example/src/comments.ts",
        "/*\nthrow new Error('comment');\ntry {\n}\n*/\nexport const value = true;\n",
      ),
    ).toBe(false);
    expect(
      anyCheckMatchesSource(
        errorHandlingChecks,
        "core/example/src/runtime.ts",
        "try\n{\n  run();\n}\n",
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        errorHandlingChecks,
        "core/example/src/runtime.ts",
        "throw\nnew SignatureKitError({ code: 'invalid' });\n",
      ),
    ).toBe(true);
  });

  it("matches exact Effect member calls and named bindings", () => {
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "core/example/src/runtime.ts",
        'import { runPromise } from "effect";\nclient.runPromise(program);\nEffect.effectfulApi(program);\nEffect.eitherThing(program);\n',
      ),
    ).toBe(false);
    expect(
      anyCheckMatchesSource(
        effectBoundaryChecks,
        "core/example/src/runtime.ts",
        'import { runPromise } from "effect";\nrunPromise(program);\n',
      ),
    ).toBe(true);
  });

  it("rejects multiline literal arrays and fake schema bindings", () => {
    expect(
      anyCheckMatchesSource(
        schemaContractChecks,
        "core/example/src/contracts.ts",
        "const StatusCodes = [\n  'pending',\n  'complete',\n];\n",
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        schemaContractChecks,
        "core/example/src/contracts.ts",
        "export interface ExampleConfig {\n  enabled: boolean;\n}\nconst ExampleConfigSchema = 1;\n",
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        schemaContractChecks,
        "core/example/src/contracts.ts",
        "export interface ExampleConfig {\n  enabled: boolean;\n}\nconst ExampleConfigSchema = Schema.Struct({ enabled: Schema.Boolean });\n",
      ),
    ).toBe(false);
  });

  it("rejects inline import type annotations", () => {
    expect(
      anyCheckMatchesSource(
        typeSafetyChecks,
        "core/example/src/runtime.ts",
        'const value: import("@signature-kit/signatures").Signatures = input;\n',
      ),
    ).toBe(true);
    expect(
      anyCheckMatchesSource(
        typeSafetyChecks,
        "core/example/src/runtime.ts",
        'import type { Signatures } from "@signature-kit/signatures";\nconst value: Signatures = input;\n',
      ),
    ).toBe(false);
  });

  it("runs fixtures through the declarative entry point", async () => {
    const root = await mkdtemp(join(tmpdir(), "signature-kit-static-"));
    const file = join(root, "core/example/src/index.ts");
    await mkdir(join(root, "core/example/src"), { recursive: true });
    await writeFile(
      file,
      "/*\nthrow new Error('comment');\nimport '@signature-kit/unused';\n*/\nexport const value = true;\n",
    );
    expect(runDeclarativeChecks(root, [file])).toBe(false);
    const badFile = join(root, "core/example/src/bad.ts");
    await writeFile(badFile, "throw\nnew SignatureKitError({ code: 'invalid' });\n");
    expect(runDeclarativeChecks(root, [badFile])).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
});
