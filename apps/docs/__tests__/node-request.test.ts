import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

describe("production Node request adaptation", () => {
  for (const method of ["GET", "POST"]) {
    it.effect(`forwards native Request fields when rewriting a ${method} route`, () =>
      Effect.gen(function* () {
        const server = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const listener = getRequestListener(
              async (request) => {
                const url = new URL("/rewritten", request.url);
                const forwarded = new Request(url, request);
                const body = await forwarded.text();
                return new Response(
                  `${forwarded.method} ${new URL(forwarded.url).pathname} ${body}`,
                );
              },
              { overrideGlobalObjects: false },
            );
            return createServer((request, response) => {
              void listener(request, response);
            });
          }),
          (resource) =>
            Effect.promise(
              () =>
                new Promise<void>((resolve) => {
                  resource.close(() => resolve());
                  resource.closeAllConnections();
                }),
            ),
        );
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve, reject) => {
              server.once("error", reject);
              server.listen(0, "127.0.0.1", () => resolve());
            }),
        );
        const address = server.address();
        if (address === null || typeof address === "string")
          return yield* Effect.die("A TCP test port is required.");
        const response = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${address.port}/original`, {
            method,
            ...(method === "POST" ? { body: "payload" } : {}),
          }),
        );
        const body = yield* Effect.promise(() => response.text());
        expect(response.status).toBe(200);
        expect(body).toBe(`${method} /rewritten ${method === "POST" ? "payload" : ""}`);
      }).pipe(Effect.scoped),
    );
  }
});
