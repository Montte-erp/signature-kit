import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

const DiagnosticsSchema = Schema.Struct({
  diagnostics: Schema.Array(Schema.Struct({ code: Schema.String })),
});

describe("Effect Oxlint integration", () => {
  it(
    "rejects floating Effects and redundant programs through the installed patched linter",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const root = process.cwd();
          yield* Effect.promise(() => mkdir(join(root, ".cache"), { recursive: true }));
          const directory = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(root, ".cache", "effect-oxlint-"))),
            (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
          );
          yield* Effect.promise(() =>
            writeFile(
              join(directory, "tsconfig.json"),
              JSON.stringify({
                compilerOptions: {
                  strict: true,
                  target: "ES2022",
                  module: "ESNext",
                  moduleResolution: "Bundler",
                  skipLibCheck: true,
                },
                include: ["*.ts"],
              }),
            ),
          );
          const fixture = join(directory, "fixture.ts");
          yield* Effect.promise(() =>
            writeFile(
              fixture,
              'import { Effect } from "effect";\nEffect.succeed(1);\nexport const redundant = Effect.succeed(1).pipe(Effect.map(() => undefined));\n',
            ),
          );
          const rejected = spawnSync(
            process.execPath,
            [
              resolve(root, "node_modules/oxlint/bin/oxlint"),
              "--config",
              resolve(root, "tooling/oxc/base.json"),
              "--no-ignore",
              "--format",
              "json",
              fixture,
            ],
            { cwd: root, encoding: "utf8" },
          );
          expect(rejected.error).toBeUndefined();
          expect(rejected.status).toBe(1);
          const diagnostics = yield* Schema.decodeUnknownEffect(DiagnosticsSchema)(
            JSON.parse(rejected.stdout),
          );
          expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
            expect.arrayContaining(["effecttsgo(floating-effect)", "effecttsgo(effect-map-void)"]),
          );
          yield* Effect.promise(() =>
            writeFile(
              fixture,
              'import { Effect } from "effect";\nexport const valid = Effect.void;\n',
            ),
          );
          const accepted = spawnSync(
            process.execPath,
            [
              resolve(root, "node_modules/oxlint/bin/oxlint"),
              "--config",
              resolve(root, "tooling/oxc/base.json"),
              "--no-ignore",
              "--deny-warnings",
              fixture,
            ],
            { cwd: root, encoding: "utf8" },
          );
          expect(accepted.error).toBeUndefined();
          expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
        }).pipe(Effect.scoped),
      ),
    30000,
  );
});
