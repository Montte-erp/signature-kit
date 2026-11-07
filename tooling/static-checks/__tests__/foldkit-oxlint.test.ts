import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

const DiagnosticsSchema = Schema.Struct({
  diagnostics: Schema.Array(Schema.Struct({ code: Schema.String })),
});

describe("Foldkit Oxlint integration", () => {
  it(
    "checks Foldkit commands through the installed preset",
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const root = process.cwd();
          yield* Effect.promise(() => mkdir(join(root, ".cache"), { recursive: true }));
          const directory = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(root, ".cache", "foldkit-oxlint-"))),
            (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
          );
          const fixture = join(directory, "fixture.ts");
          const lint = () =>
            spawnSync(
              process.execPath,
              [
                resolve(root, "node_modules/oxlint/bin/oxlint"),
                "--config",
                resolve(root, "tooling/oxc/foldkit.json"),
                "--no-ignore",
                "--format",
                "json",
                fixture,
              ],
              { cwd: root, encoding: "utf8" },
            );
          yield* Effect.promise(() =>
            writeFile(
              fixture,
              'import { Effect as Fx } from "effect";\nimport type { HtmlBuilder } from "foldkit/html";\nexport const result = { model: 1, commands: [] };\nexport const value = Fx.succeed(1);\nexport const view = (h: HtmlBuilder<never>) => h.div([], []);\n',
            ),
          );
          const rejected = lint();
          expect(rejected.error).toBeUndefined();
          expect(rejected.status, rejected.stderr).toBe(1);
          const diagnostics = yield* Schema.decodeUnknownEffect(DiagnosticsSchema)(
            JSON.parse(rejected.stdout),
          );
          expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
            expect.arrayContaining([
              "foldkit(no-empty-commands-array)",
              "foldkit(prefer-effect-module-names)",
              "foldkit(no-empty-children-array)",
            ]),
          );
          yield* Effect.promise(() =>
            writeFile(
              fixture,
              'import { Effect } from "effect";\nimport type { HtmlBuilder } from "foldkit/html";\nexport const result = { model: 1 };\nexport const value = Effect.succeed(1);\nexport const view = (h: HtmlBuilder<never>) => h.div([]);\n',
            ),
          );
          const accepted = lint();
          expect(accepted.error).toBeUndefined();
          expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
        }).pipe(Effect.scoped),
      ),
    30000,
  );
});
