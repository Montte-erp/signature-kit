import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import { promisify } from "node:util";
import { Effect, Exit, Schema, Scope } from "effect";
import type { TestProject } from "vitest/node";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
const packages = [
  "shared/asn1",
  "shared/crypto",
  "shared/cms",
  "core/signatures",
  "core/i18n",
  "core/http",
  "core/certificates",
  "signers/a1",
  "formats/pdf",
  "formats/react",
];
const Manifest = Schema.fromJsonString(Schema.Struct({ name: Schema.String }));

declare module "vitest" {
  export interface ProvidedContext {
    packedConsumerOrigin: string;
  }
}

export default async function setup(project: TestProject) {
  const scope = await Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const acquire = Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), "signature-kit-packed-"))),
          (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const requests: string[] = [];
        const server = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createServer((request, response) => {
              const path = new URL(request.url ?? "/", "http://localhost").pathname;
              if (path === "/__requests") {
                response
                  .writeHead(200, {
                    "content-type": "application/json",
                    "access-control-allow-origin": "*",
                  })
                  .end(JSON.stringify(requests));
                return;
              }
              requests.push(path);
              const file = path === "/" ? "index.html" : path.slice(1);
              if (file.includes("..")) {
                response.writeHead(400).end();
                return;
              }
              const source =
                path === "/ecpf.p12"
                  ? join(root, "signers/a1/__tests__/fixtures/ecpf.p12")
                  : join(directory, "dist", file);
              void readFile(source)
                .then((body) => {
                  const mime: Record<string, string> = {
                    ".html": "text/html",
                    ".js": "text/javascript",
                    ".wasm": "application/wasm",
                    ".css": "text/css",
                  };
                  response
                    .writeHead(200, {
                      "content-type": mime[extname(file)] ?? "application/octet-stream",
                      "access-control-allow-origin": "*",
                    })
                    .end(body);
                })
                .catch(() => {
                  response.writeHead(404).end();
                });
            }),
          ),
          (resource) =>
            Effect.promise(() => {
              resource.closeAllConnections();
              const wasListening = resource.listening;
              return new Promise<void>((resolveClose, reject) =>
                resource.close((error) =>
                  error !== undefined && wasListening ? reject(error) : resolveClose(),
                ),
              );
            }),
        );
        const dependencies: Record<string, string> = {
          react: "19.3.1",
          "react-dom": "19.3.1",
          vite: "8.3.5",
          effect: "4.1.0",
        };
        const overrides: Record<string, string> = {};
        for (const path of packages) {
          const raw = yield* Effect.promise(() =>
            readFile(join(root, path, "package.json"), "utf8"),
          );
          const manifest = yield* Schema.decodeUnknownEffect(Manifest)(raw);
          const filename = `${path.replace("/", "-")}.tgz`;
          yield* Effect.promise((signal) =>
            run(
              "bun",
              ["pm", "pack", "--ignore-scripts", "--filename", join(directory, filename)],
              { cwd: join(root, path), signal, timeout: 120000 },
            ),
          );
          dependencies[manifest.name] = `file:./${filename}`;
          overrides[manifest.name] = `file:./${filename}`;
        }
        yield* Effect.promise(() =>
          writeFile(
            join(directory, "package.json"),
            JSON.stringify({ private: true, type: "module", dependencies, overrides }),
          ),
        );
        yield* Effect.promise(() =>
          cp(
            join(root, "tooling/testing/packed-consumer/index.html"),
            join(directory, "index.html"),
          ),
        );
        yield* Effect.promise(() =>
          cp(join(root, "tooling/testing/packed-consumer/main.tsx"), join(directory, "main.tsx")),
        );
        yield* Effect.promise((signal) =>
          run("bun", ["install", "--ignore-scripts"], { cwd: directory, signal, timeout: 180000 }),
        );
        yield* Effect.promise((signal) =>
          run("bun", ["run", "./node_modules/vite/bin/vite.js", "build"], {
            cwd: directory,
            signal,
            timeout: 180000,
            maxBuffer: 10_000_000,
          }),
        );
        yield* Effect.callback<void>((resume) => {
          const fail = (error: Error) => resume(Effect.die(error));
          server.once("error", fail);
          server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", fail);
            resume(Effect.void);
          });
          return Effect.sync(() => {
            server.removeListener("error", fail);
          });
        }).pipe(Effect.timeout("10 seconds"));
        const address = server.address();
        if (address === null || typeof address === "string")
          return yield* Effect.die("Packed consumer server has no TCP address");
        project.provide("packedConsumerOrigin", `http://127.0.0.1:${address.port}`);
      });
      yield* acquire.pipe(
        Scope.provide(scope),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      );
      return scope;
    }),
  );
  return () => Effect.runPromise(Scope.close(scope, Exit.void));
}
