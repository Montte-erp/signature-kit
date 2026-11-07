import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import { feedbackResponse } from "./feedback-server";
import { ServerAnalytics, serverAnalyticsLayer } from "../lib/posthog/server";
import { init, Message, update } from "./main";

const send = (path: string, body: unknown, method = "POST") =>
  Effect.runPromise(
    feedbackResponse(
      new Request(`http://localhost${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }),
      null,
    ),
  );

const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const result = await Effect.runPromise(
    feedbackResponse(
      new Request(`http://localhost${request.url}`, {
        method: request.method,
        headers: { "content-type": request.headers["content-type"] ?? "" },
        body: Buffer.concat(chunks),
      }),
      null,
    ),
  );
  response.writeHead(result?.status ?? 404).end();
};

describe("feedback", () => {
  it("rejects malformed payloads and routes before delivery", async () => {
    for (const body of [
      { route: "/en-US/sign-free", opinion: "good", message: "" },
      { route: "/en-US/docs?secret=x", opinion: "good", message: "" },
      { route: "/en-US/docs/missing", opinion: "good", message: "" },
      { route: "/en-US/docs", opinion: "other", message: "" },
      { route: "/en-US/docs", opinion: "good", message: "x".repeat(2001) },
      { route: "/en-US/docs", opinion: "good", message: "", extra: "secret" },
    ])
      expect((await send("/api/feedback/page", body))?.status).toBe(400);
    for (const body of [
      { route: "/en-US/docs", blockId: "x".repeat(201), blockBody: "body", message: "" },
      { route: "/en-US/docs", blockId: "id", blockBody: "x".repeat(2001), message: "" },
      { route: "/en-US/docs#secret", blockId: "id", blockBody: "body", message: "" },
      { route: "/en-US/docs", blockId: "id", blockBody: "body", message: "", extra: "secret" },
    ])
      expect((await send("/api/feedback/text", body))?.status).toBe(400);
    expect((await send("/api/feedback/page", {}, "GET"))?.status).toBe(405);
    for (const [body, headers, status] of [
      ["{", { "content-type": "application/json" }, 400],
      ["{}", { "content-type": "text/plain" }, 415],
      ["x".repeat(8193), { "content-type": "application/json" }, 413],
    ] satisfies [string, Record<string, string>, number][]) {
      const response = await Effect.runPromise(
        feedbackResponse(
          new Request("http://localhost/api/feedback/page", { method: "POST", headers, body }),
          null,
        ),
      );
      expect(response?.status).toBe(status);
    }
    expect(
      (
        await send("/api/feedback/text", {
          route: "/en-US/docs",
          blockId: "",
          blockBody: "",
          message: "",
        })
      )?.status,
    ).toBe(400);
  });
  it("does not claim success when delivery is unconfigured", async () => {
    expect(
      (await send("/api/feedback/page", { route: "/en-US/docs", opinion: "good", message: "" }))
        ?.status,
    ).toBe(503);
  });
  it("returns protocol status over local HTTP", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Effect.acquireRelease(
            Effect.sync(() =>
              createServer((request, response) => {
                void handleRequest(request, response);
              }).listen(0, "127.0.0.1"),
            ),
            (server) =>
              Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
          );
          yield* Effect.promise(() => once(server, "listening"));
          const address = server.address();
          if (address === null || typeof address === "string")
            return expect.fail("Missing server address");
          const response = yield* Effect.promise(() =>
            fetch(`http://127.0.0.1:${address.port}/api/feedback/page`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ route: "/en-US/docs", opinion: "good", message: "" }),
            }),
          );
          expect(response.status).toBe(503);
        }),
      ),
    );
  });
  it("delivers both feedback events through the configured PostHog SDK", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const received: string[] = [];
          const server = yield* Effect.acquireRelease(
            Effect.sync(() =>
              createServer((request, response) => {
                const chunks: Uint8Array[] = [];
                request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
                request.on("end", () => {
                  received.push(
                    (request.headers["content-encoding"] === "gzip"
                      ? gunzipSync(Buffer.concat(chunks))
                      : Buffer.concat(chunks)
                    ).toString(),
                  );
                  response.writeHead(200).end("{}");
                });
              }).listen(0, "127.0.0.1"),
            ),
            (server) =>
              Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
          );
          yield* Effect.promise(() => once(server, "listening"));
          const address = server.address();
          if (address === null || typeof address === "string")
            return expect.fail("Missing server address");
          const layer = serverAnalyticsLayer({
            token: "local-test-token",
            host: `http://127.0.0.1:${address.port}`,
          });
          yield* Effect.gen(function* () {
            const analytics = yield* ServerAnalytics;
            for (const [path, body] of [
              ["page", { route: "/en-US/docs", opinion: "good", message: "private page" }],
              [
                "text",
                {
                  route: "/pt-BR/docs",
                  blockId: "intro",
                  blockBody: "selected block",
                  message: "private text",
                },
              ],
            ] satisfies [string, unknown][]) {
              const response = yield* feedbackResponse(
                new Request(`http://localhost/api/feedback/${path}`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(body),
                }),
                analytics,
              );
              expect(response?.status).toBe(200);
            }
          }).pipe(Effect.provide(layer));
          const payload = received.join("\n");
          expect(payload).toContain("page_feedback_submitted");
          expect(payload).toContain("text_feedback_submitted");
          expect(payload).toContain("selected block");
          expect(payload).toContain("private page");
          expect(payload).toContain('"block_id":"intro"');
          expect(payload).toContain('"route":"/pt-BR/docs"');
          expect(payload).not.toContain("$current_url");
          expect(payload).not.toContain("$referrer");
          expect(payload).not.toContain("query");
          const batches = received.map((body) => JSON.parse(body));
          for (const batch of batches) {
            for (const event of batch.batch) {
              expect(JSON.stringify(event.properties)).not.toContain("local-test-token");
            }
          }
        }),
      ),
    );
  });
  it("returns 503 when the real SDK receives an HTTP rejection", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* Effect.acquireRelease(
            Effect.sync(() =>
              createServer((_request, response) => response.writeHead(400).end("rejected")).listen(
                0,
                "127.0.0.1",
              ),
            ),
            (server) =>
              Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
          );
          yield* Effect.promise(() => once(server, "listening"));
          const address = server.address();
          if (address === null || typeof address === "string")
            return expect.fail("Missing server address");
          const response = yield* Effect.gen(function* () {
            const analytics = yield* ServerAnalytics;
            return yield* feedbackResponse(
              new Request("http://localhost/api/feedback/page", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ route: "/en-US/docs", opinion: "good", message: "" }),
              }),
              analytics,
            );
          }).pipe(
            Effect.provide(
              serverAnalyticsLayer({
                token: "local-test-token",
                host: `http://127.0.0.1:${address.port}`,
              }),
            ),
          );
          expect(response?.status).toBe(503);
        }),
      ),
    );
  });
  it("starts a command and reports failed delivery in the model", () => {
    const model = init({ locale: "en-US", path: "/docs" }).model;
    const sending = update(model, Message.FeedbackSubmitted({ opinion: "good" }));
    expect(sending.model.feedbackStatus).toBe("sending");
    expect(sending.commands).toHaveLength(1);
    expect(
      update(sending.model, Message.FeedbackFinished({ ok: false })).model.feedbackStatus,
    ).toBe("error");
  });
});
