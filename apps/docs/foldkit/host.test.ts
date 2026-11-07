import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Deferred, Effect, Fiber } from "effect";
import { expect, test } from "vitest";

const waitForExit = (child: ChildProcessWithoutNullStreams) =>
  Effect.callback<boolean>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.succeed(true));
      return;
    }
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resume(Effect.succeed(exited));
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), 1000);
    child.once("exit", onExit);
    return Effect.sync(() => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
    });
  });

const child = (command: string, args: string[], cwd: string) =>
  Effect.acquireRelease(
    Effect.sync(() => spawn(command, args, { cwd, env: { ...process.env, PORT: "0" } })),
    (ownedChildProcess) =>
      Effect.gen(function* () {
        if (
          ownedChildProcess.exitCode !== null ||
          ownedChildProcess.signalCode !== null ||
          ownedChildProcess.pid === undefined
        )
          return;
        ownedChildProcess.kill("SIGTERM");
        if (yield* waitForExit(ownedChildProcess)) return;
        ownedChildProcess.kill("SIGKILL");
        if (!(yield* waitForExit(ownedChildProcess))) {
          return yield* Effect.die(
            new Error(`Child ${ownedChildProcess.pid} exit was not confirmed after SIGKILL`),
          );
        }
      }),
  );

const readiness = (server: ChildProcessWithoutNullStreams, timeout = 10000) =>
  Effect.acquireUseRelease(
    Effect.sync(() => createInterface({ input: server.stdout })),
    (lines) =>
      Effect.promise(async (signal) => {
        const controller = new AbortController();
        const requestSignal = AbortSignal.any([signal, controller.signal]);
        const [line] = await Promise.race([
          once(lines, "line", { signal: requestSignal }),
          once(server, "exit", { signal: requestSignal }).then(([code]) => [`Host exited ${code}`]),
        ]).then((result) => {
          controller.abort();
          return result;
        });
        return line;
      }).pipe(
        Effect.flatMap((line) =>
          typeof line === "string" && line.startsWith("Listening on http://")
            ? Effect.succeed(line.replace("Listening on ", ""))
            : Effect.fail(`Host readiness failed: ${line}`),
        ),
        Effect.timeout(timeout),
      ),
    (lines) => Effect.sync(() => lines.close()),
  );

test("serves the Foldkit build over HTTP", async () => {
  const root = new URL("../", import.meta.url);
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), "foldkit-host-test-"))),
          (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const marker = "<!-- static-only fixture marker -->";
        yield* Effect.uninterruptible(
          Effect.promise(async () => {
            await symlink(
              new URL("../../node_modules", root).pathname,
              join(fixture, "node_modules"),
              "dir",
            );
            await mkdir(join(fixture, "foldkit"), { recursive: true });
            await mkdir(join(fixture, "dist-foldkit/client"), { recursive: true });
            await copyFile(new URL("foldkit/host.mjs", root), join(fixture, "foldkit/host.mjs"));
            await symlink(
              new URL("dist-foldkit/server", root).pathname,
              join(fixture, "dist-foldkit/server"),
              "dir",
            );
            await mkdir(join(fixture, "dist-foldkit/client/assets"), { recursive: true });
            await mkdir(join(fixture, "dist-foldkit/client/r"), { recursive: true });
            await copyFile(
              new URL("public/r/registry.json", root),
              join(fixture, "dist-foldkit/client/r/registry.json"),
            );
            await writeFile(join(fixture, "dist-foldkit/client/favicon.svg"), "<svg></svg>");
            await writeFile(join(fixture, "dist-foldkit/client/manifest.json"), "private manifest");
            await writeFile(join(fixture, "dist-foldkit/client/source.ts"), "private source");
            await writeFile(join(fixture, "outside.json"), "outside sentinel");
            await symlink(
              join(fixture, "outside.json"),
              join(fixture, "dist-foldkit/client/r/outside.json"),
            );
            await symlink(
              join(fixture, "dist-foldkit/server/foldkit.build.json"),
              join(fixture, "dist-foldkit/client/r/escape.json"),
            );
            for (const locale of ["en-US", "pt-BR"]) {
              const directory = join(fixture, "dist-foldkit/client", locale);
              await mkdir(directory, { recursive: true });
              const generated = await readFile(
                new URL(`dist-foldkit/client/${locale}/index.html`, root),
                "utf8",
              );
              await writeFile(join(directory, "index.html"), `${generated}${marker}`);
              const asset = generated.match(/(?:src|href)="(\/assets\/[^"]+\.js)"/)?.[1];
              expect(asset).toBeDefined();
              if (asset === undefined) return expect.fail("Missing asset");
              {
                await copyFile(
                  new URL(`dist-foldkit/client${asset}`, root),
                  join(fixture, "dist-foldkit/client", asset),
                );
              }
            }
          }),
        );
        const server = yield* child("bun", ["foldkit/host.mjs"], fixture);
        const origin = yield* readiness(server);
        yield* Effect.promise(async (signal) => {
          const request = (url: URL | string, options?: RequestInit) =>
            fetch(url, { ...options, signal });
          for (const [locale, title] of [
            ["en-US", "One typed boundary for every signature."],
            ["pt-BR", "Um ponto único de assinatura tipado para cada documento."],
          ]) {
            const response = await request(new URL(locale, origin));
            const html = await response.text();
            const generated = await readFile(
              join(fixture, "dist-foldkit/client", locale, "index.html"),
              "utf8",
            );
            expect(html).toContain(marker);
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
            expect(html).toBe(generated);
            expect(html).toContain(title);
            expect(html).toContain(`lang="${locale}"`);
            expect(html).toContain(`https://signaturekit.dev/${locale}`);
            expect(html).toContain("data-foldkit-app");
            const asset = html.match(/(?:src|href)="(\/assets\/[^"]+\.js)"/)?.[1];
            expect(asset).toBeDefined();
            if (asset === undefined) return expect.fail("Missing asset");
            {
              const assetResponse = await request(new URL(asset, origin));
              expect(assetResponse.status).toBe(200);
              expect(assetResponse.headers.get("content-type")).toMatch(/javascript/);
              expect((await assetResponse.text()).length).toBeGreaterThan(0);
              const head = await request(new URL(asset, origin), { method: "HEAD" });
              expect(head.status).toBe(200);
              expect(await head.text()).toBe("");
            }
          }
          for (const [page, image] of [
            ["/en-US", "/en-US/index.webp"],
            ["/pt-BR/changelog/a1-node-esm-release", "/en-US/changelog/a1-node-esm-release.webp"],
          ]) {
            const pageResponse = await request(new URL(page, origin));
            expect(pageResponse.status).toBe(200);
            expect(await pageResponse.text()).toContain(
              `property="og:image" content="https://signaturekit.dev${image}"`,
            );
            const response = await request(new URL(image, origin));
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toBe("image/webp");
            const bytes = new Uint8Array(await response.arrayBuffer());
            expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
            expect(new TextDecoder().decode(bytes.subarray(8, 16))).toBe("WEBPVP8L");
            const dimensions = new DataView(bytes.buffer).getUint32(21, true);
            expect([(dimensions & 0x3fff) + 1, ((dimensions >>> 14) & 0x3fff) + 1]).toEqual([
              1200, 630,
            ]);
            const imageHead = await request(new URL(image, origin), { method: "HEAD" });
            expect(imageHead.status).toBe(200);
            expect(imageHead.headers.get("content-type")).toBe("image/webp");
            expect(await imageHead.text()).toBe("");
            const post = await request(new URL(image, origin), { method: "POST" });
            expect(post.status).toBe(405);
            expect(post.headers.get("allow")).toBe("GET, HEAD");
          }
          expect((await request(new URL("/en-US/blog/not-real.webp", origin))).status).toBe(404);
          const registry = await request(new URL("/r/registry.json", origin));
          expect(registry.status).toBe(200);
          expect(registry.headers.get("content-type")).toMatch(/application\/json/);
          const registryBytes = await readFile(new URL("public/r/registry.json", root));
          expect(Buffer.from(await registry.arrayBuffer())).toEqual(registryBytes);
          const registryHead = await request(new URL("/r/registry.json", origin), {
            method: "HEAD",
          });
          expect(registryHead.status).toBe(200);
          expect(registryHead.headers.get("content-type")).toBe(
            registry.headers.get("content-type"),
          );
          expect(registryHead.headers.get("content-length")).toBe(String(registryBytes.length));
          expect(await registryHead.text()).toBe("");
          const favicon = await request(new URL("/favicon.svg", origin));
          expect(favicon.status).toBe(200);
          expect(favicon.headers.get("content-type")).toMatch(/image\/svg\+xml/);
          expect(await favicon.text()).toBe("<svg></svg>");
          for (const path of [
            "/r/escape.json",
            "/r/outside.json",
            "/r/%2e%2e%2fserver/foldkit.build.json",
            "/.vite/manifest.json",
            "/foldkit.build.json",
            "/manifest.json",
            "/source.ts",
            "/r/missing.json",
          ]) {
            expect((await request(new URL(path, origin))).status).toBe(404);
          }
          const head = await request(new URL("en-US", origin), { method: "HEAD" });
          expect(head.status).toBe(200);
          expect(await head.text()).toBe("");
          expect(
            (await request(new URL("/assets/%2e%2e%2fserver/foldkit.build.json", origin))).status,
          ).toBe(404);
          expect((await request(new URL("/missing", origin))).status).toBe(404);
          await rm(join(fixture, "dist-foldkit/client/en-US/index.html"));
          const fallback = await request(new URL("/en-US", origin));
          const fallbackHtml = await fallback.text();
          expect(fallback.status).toBe(200);
          expect(fallbackHtml).toContain("One typed boundary for every signature.");
          expect(fallbackHtml).toContain("data-foldkit-app");
          expect(fallbackHtml).not.toContain(marker);
          const redirect = await request(origin, { redirect: "manual" });
          expect(redirect.status).toBe(302);
          expect(redirect.headers.get("location")).toBe(new URL("/en-US", origin).href);
        }).pipe(Effect.timeout(20000));
      }),
    ),
  );
}, 40000);

test("times out a silent child and releases its process and fixture", async () => {
  let pid = 0;
  let fixture = "";
  const result = await Effect.runPromise(
    Effect.result(
      Effect.scoped(
        Effect.gen(function* () {
          fixture = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(tmpdir(), "foldkit-host-test-"))),
            (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
          );
          const server = yield* child(
            process.execPath,
            ["-e", "setInterval(() => {}, 1000)"],
            fixture,
          );
          pid = server.pid ?? 0;
          yield* readiness(server, 200);
        }),
      ),
    ),
  );
  expect(result._tag).toBe("Failure");
  expect(pid).toBeGreaterThan(0);
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(access(fixture)).rejects.toBeDefined();
});

test("interrupting a waiting child releases its process and fixture", async () => {
  let pid = 0;
  let fixture = "";
  await Effect.runPromise(
    Effect.gen(function* () {
      const acquired = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkChild(
        Effect.scoped(
          Effect.gen(function* () {
            fixture = yield* Effect.acquireRelease(
              Effect.promise(() => mkdtemp(join(tmpdir(), "foldkit-host-test-"))),
              (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
            );
            const server = yield* child(
              process.execPath,
              ["-e", "setInterval(() => {}, 1000)"],
              fixture,
            );
            pid = server.pid ?? 0;
            yield* Deferred.succeed(acquired, undefined);
            yield* readiness(server);
          }),
        ),
      );
      yield* Effect.raceFirst(
        Deferred.await(acquired),
        Fiber.await(fiber).pipe(
          Effect.flatMap(() => Effect.fail("Child ended before acquisition")),
        ),
      ).pipe(Effect.timeout("5 seconds"));
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.timeout("10 seconds")),
  );
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(access(fixture)).rejects.toBeDefined();
});

test("releases the fixture when the child exits before readiness", async () => {
  let fixture = "";
  const result = await Effect.runPromise(
    Effect.result(
      Effect.scoped(
        Effect.gen(function* () {
          fixture = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(tmpdir(), "foldkit-host-test-"))),
            (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
          );
          const server = yield* child(process.execPath, ["-e", "process.exit(7)"], fixture);
          yield* readiness(server, 2000);
        }),
      ),
    ),
  );
  expect(result._tag).toBe("Failure");
  await expect(access(fixture)).rejects.toBeDefined();
});

test("kills an owned child that ignores SIGTERM", async () => {
  let pid = 0;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* child(
          process.execPath,
          [
            "-e",
            "process.on('SIGTERM', () => {}); console.log('Listening on http://localhost'); setInterval(() => {}, 1000)",
          ],
          tmpdir(),
        );
        pid = server.pid ?? 0;
        yield* readiness(server);
      }),
    ),
  );
  expect(pid).toBeGreaterThan(0);
  expect(() => process.kill(pid, 0)).toThrow();
});

test("failure after acquisition releases owned resources", async () => {
  let pid = 0;
  let fixture = "";
  const result = await Effect.runPromise(
    Effect.result(
      Effect.scoped(
        Effect.gen(function* () {
          fixture = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(tmpdir(), "foldkit-host-test-"))),
            (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
          );
          const server = yield* child(
            process.execPath,
            ["-e", "setInterval(() => {}, 1000)"],
            fixture,
          );
          pid = server.pid ?? 0;
          return yield* Effect.fail("failure after acquisition");
        }),
      ).pipe(Effect.timeout("10 seconds")),
    ),
  );
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure") expect(result.failure).toBe("failure after acquisition");
  expect(pid).toBeGreaterThan(0);
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(access(fixture)).rejects.toBeDefined();
});

test("readiness failure during acquisition releases the child and fixture", async () => {
  let pid = 0;
  let fixture = "";
  const result = await Effect.runPromise(
    Effect.result(
      Effect.scoped(
        Effect.gen(function* () {
          fixture = yield* Effect.acquireRelease(
            Effect.promise(() => mkdtemp(join(tmpdir(), "foldkit-host-test-"))),
            (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
          );
          yield* Effect.acquireRelease(
            Effect.scoped(
              Effect.gen(function* () {
                const server = yield* child(
                  process.execPath,
                  ["-e", "setInterval(() => {}, 1000)"],
                  fixture,
                );
                pid = server.pid ?? 0;
                return yield* readiness(server, 200);
              }),
            ),
            () => Effect.void,
          );
        }),
      ).pipe(Effect.timeout("5 seconds")),
    ),
  );
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure") expect(result.failure).toMatchObject({ _tag: "TimeoutError" });
  expect(pid).toBeGreaterThan(0);
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(access(fixture)).rejects.toBeDefined();
});
