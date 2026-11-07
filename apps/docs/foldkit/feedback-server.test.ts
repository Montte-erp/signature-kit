import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { ServerAnalytics, serverAnalyticsLayer } from "../lib/posthog/server";
import { feedbackResponse } from "./feedback-server";

const listen = (server: ReturnType<typeof createServer>) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      server.listen(0, "127.0.0.1");
      yield* Effect.promise(() => once(server, "listening"));
      return server;
    }),
    (server) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

describe("feedback HTTP integration", () => {
  it("delivers through the real HTTP handler and PostHog SDK", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const events: string[] = [];
          let rejectDelivery = false;
          let disconnect = false;
          const receiver = yield* listen(
            createServer((request, response) => {
              const chunks: Uint8Array[] = [];
              request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
              request.on("end", () => {
                events.push(
                  (request.headers["content-encoding"] === "gzip"
                    ? gunzipSync(Buffer.concat(chunks))
                    : Buffer.concat(chunks)
                  ).toString(),
                );
                response.writeHead(rejectDelivery ? 400 : 200).end("{}");
              });
            }),
          );
          const receiverAddress = receiver.address();
          if (receiverAddress === null || typeof receiverAddress === "string")
            return expect.fail("Missing receiver address");
          yield* Effect.gen(function* () {
            const analytics = yield* ServerAnalytics;
            const context = yield* Effect.context();
            const run = Effect.runPromiseWith(context);
            const endpoint = yield* listen(
              createServer((request, response) => {
                response.setHeader("access-control-allow-origin", "*");
                response.setHeader("access-control-allow-headers", "content-type");
                response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
                if (request.method === "OPTIONS") {
                  response.writeHead(204).end();
                  return;
                }
                if (request.url === "/reject") {
                  rejectDelivery = true;
                  response.writeHead(204).end();
                  return;
                }
                if (request.url === "/offline") {
                  disconnect = true;
                  response.writeHead(204).end();
                  return;
                }
                if (request.url === "/events") {
                  response.writeHead(200).end(events.join("\n"));
                  return;
                }
                if (disconnect) {
                  request.socket.destroy();
                  return;
                }
                const chunks: Uint8Array[] = [];
                request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
                request.on("end", () => {
                  void run(
                    feedbackResponse(
                      new Request(`http://localhost${request.url}`, {
                        method: request.method,
                        headers: { "content-type": request.headers["content-type"] ?? "" },
                        body: Buffer.concat(chunks),
                      }),
                      analytics,
                    ),
                  ).then((result) => response.writeHead(result?.status ?? 404).end());
                });
              }),
            );
            const address = endpoint.address();
            if (address === null || typeof address === "string")
              return expect.fail("Missing endpoint address");
            const origin = `http://127.0.0.1:${address.port}`;
            for (const [path, body] of [
              ["page", { route: "/pt-BR/docs", opinion: "good", message: "comentário privado" }],
              [
                "text",
                {
                  route: "/pt-BR/docs",
                  blockId: "intro",
                  blockBody: "texto selecionado",
                  message: "comentário privado",
                },
              ],
            ] satisfies [string, unknown][]) {
              const result = yield* Effect.promise(() =>
                fetch(`${origin}/api/feedback/${path}`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(body),
                }),
              );
              expect(result.status).toBe(200);
            }
            expect(events.join("\n")).toContain("text_feedback_submitted");
            expect(events.join("\n")).toContain("page_feedback_submitted");
            expect(events.join("\n")).toContain("texto selecionado");
            rejectDelivery = true;
            const failed = yield* Effect.promise(() =>
              fetch(`${origin}/api/feedback/page`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ route: "/pt-BR/docs", opinion: "bad", message: "" }),
              }),
            );
            expect(failed.status).toBe(503);
          }).pipe(
            Effect.provide(
              serverAnalyticsLayer({
                token: "local-test-token",
                host: `http://127.0.0.1:${receiverAddress.port}`,
              }),
            ),
          );
        }),
      ),
    );
  }, 120_000);
});
