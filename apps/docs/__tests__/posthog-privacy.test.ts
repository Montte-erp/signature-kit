import { Cause, Effect, Exit } from "effect";
import { once } from "node:events";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { docsPostHogOptions } from "../lib/posthog/client";
import {
  captureServerEvent,
  captureServerEventWithoutRequest,
  captureServerEventEffect,
  captureServerEventWithoutRequestEffect,
  serverAnalyticsLayer,
} from "../lib/posthog/server";

const receiver = Effect.gen(function* () {
  const received: string[] = [];
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createServer((request, response) => {
        const chunks: Uint8Array[] = [];
        request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
        request.on("end", () => {
          const body = Buffer.concat(chunks);
          received.push(
            (request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body).toString(),
          );
          response.writeHead(200).end("{}");
        });
      }).listen(0, "127.0.0.1"),
    ),
    (server) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  yield* Effect.promise(() => once(server, "listening"));
  const address = server.address();
  if (address === null || typeof address === "string")
    return yield* Effect.die("Missing receiver address");
  return {
    received,
    layer: serverAnalyticsLayer({
      token: "local-test-token",
      host: `http://127.0.0.1:${address.port}`,
    }),
  };
});

describe("docs PostHog privacy boundaries", () => {
  it("uses a server-owned identity and bounded route dimensions", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { received, layer } = yield* receiver;
          const request = new Request(
            "https://docs.example/api/search?query=secret@example.com&referrer=secret-referrer",
            {
              headers: {
                "x-posthog-distinct-id": "forged-user",
                referer: "https://secret.example/path?token=secret",
                "user-agent": "secret-user-agent",
              },
            },
          );
          yield* captureServerEventEffect("search_requested", request).pipe(Effect.provide(layer));
          expect(received).toHaveLength(1);
          const batch = JSON.parse(received[0]);
          const capture = batch.batch[0];
          expect(capture.distinct_id).toBe("docs-server");
          expect(capture.event).toContain("search_requested");
          expect(capture.properties).toMatchObject({ route: "/api/search" });
          expect(capture.properties).not.toHaveProperty("query");
          expect(capture.properties).not.toHaveProperty("search");
          expect(capture.properties).not.toHaveProperty("referrer");
          expect(capture.properties).not.toHaveProperty("user_agent");
          expect(JSON.stringify(capture.properties)).not.toContain("secret@example.com");
          expect(JSON.stringify(capture.properties)).not.toContain("secret-referrer");
          expect(JSON.stringify(capture.properties)).not.toContain("secret-user-agent");
          yield* captureServerEventEffect(
            "search_requested",
            new Request(`https://docs.example/${"a".repeat(300)}?token=secret`),
          ).pipe(Effect.provide(layer));
          expect(received).toHaveLength(2);
          expect(JSON.parse(received[1]).batch[0].properties.route).toHaveLength(128);
          expect(JSON.stringify(JSON.parse(received[1]).batch[0].properties)).not.toContain(
            "token=secret",
          );
        }),
      ),
    );
  });
  it("sanitizes serializable URL values without dropping safe metadata", () => {
    const event = docsPostHogOptions.before_send({
      uuid: "privacy-test",
      event: "privacy_test",
      properties: {
        ftp: "ftp://user:pass@example.test/file?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
        embedded: "See HTTPS://example.test/upper?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL",
        url: new URL("https://example.test/object?PUBLIC_QUERY_SENTINEL#PUBLIC_FRAGMENT_SENTINEL"),
        safe: "safe-label",
      },
      $set_once: { nested: { url: "https://example.test/initial?PUBLIC_QUERY_SENTINEL" } },
    });
    const serialized = JSON.stringify(event);
    expect(serialized.includes("PUBLIC_QUERY_SENTINEL")).toBe(false);
    expect(serialized.includes("PUBLIC_FRAGMENT_SENTINEL")).toBe(false);
    expect(serialized.includes("user:pass")).toBe(false);
    expect(serialized.includes("example.test/file")).toBe(true);
    expect(serialized.includes("example.test/upper")).toBe(true);
    expect(serialized.includes("example.test/object")).toBe(true);
    expect(serialized.includes("safe-label")).toBe(true);
  });
  it("does not autocapture copied feedback text", () => {
    expect(docsPostHogOptions.autocapture.capture_copied_text).toBe(false);
  });
  it("keeps explicit feedback content in its destination event", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { received, layer } = yield* receiver;
          yield* captureServerEventWithoutRequestEffect("text_feedback_submitted", {
            message: "secret feedback text",
            block_body: "secret selected documentation",
          }).pipe(Effect.provide(layer));
          expect(received).toHaveLength(1);
          const capture = JSON.parse(received[0]).batch[0];
          expect(capture.distinct_id).toBe("docs-server:internal");
          expect(capture.event).toContain("text_feedback_submitted");
          expect(capture.properties).toMatchObject({
            message: "secret feedback text",
            block_body: "secret selected documentation",
          });
        }),
      ),
    );
  });
  it("keeps legacy Promise helpers best effort while the Effect seam defects", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { received, layer } = yield* receiver;
          const request = new Request("https://docs.example/api/search?query=secret");
          yield* Effect.promise(() => captureServerEvent("search_requested", request, {}, layer));
          yield* Effect.promise(() =>
            captureServerEventWithoutRequest(
              "text_feedback_submitted",
              { message: "feedback" },
              layer,
            ),
          );
          expect(received).toHaveLength(2);
          expect(JSON.parse(received[0]).batch[0].distinct_id).toBe("docs-server");
          expect(JSON.parse(received[1]).batch[0].distinct_id).toBe("docs-server:internal");
          const malformed = {
            get message(): string {
              return JSON.parse("{");
            },
          };
          const exit = yield* Effect.exit(
            captureServerEventWithoutRequestEffect("text_feedback_submitted", malformed).pipe(
              Effect.provide(layer),
            ),
          );
          expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
          yield* Effect.promise(() =>
            captureServerEventWithoutRequest("text_feedback_submitted", malformed, layer),
          );
          const invalidLayer = serverAnalyticsLayer({ token: "", host: "http://127.0.0.1" });
          yield* Effect.promise(() =>
            captureServerEvent("search_requested", request, {}, invalidLayer),
          );
          yield* Effect.promise(() =>
            captureServerEventWithoutRequest("text_feedback_submitted", {}, invalidLayer),
          );
          expect(received).toHaveLength(2);
        }),
      ),
    );
  });
});
