import { describe, expect, it } from "@effect/vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { SignatureHttpClient, signatureHttpClientLive } from "@signature-kit/core/http";
import { SignatureKitError, signatureKitErrorCatalog } from "@signature-kit/core/config";
import { Effect, Result, Schema } from "effect";

const JsonResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
});
type LocalServer = {
  readonly server: Server;
  readonly baseUrl: string;
  readonly voidResponseClosed: Promise<void>;
};

const startServer = (): Effect.Effect<LocalServer> =>
  Effect.promise(() => {
    const started = Promise.withResolvers<LocalServer>();
    const voidResponseClosed = Promise.withResolvers<void>();
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/json") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === "/bad-json") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end("{");
        return;
      }
      if (url.pathname === "/slow-json") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.write('{"ok":');
        return;
      }
      if (url.pathname === "/void") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/plain");
        response.on("close", () => voidResponseClosed.resolve());
        response.write("ignored");
        return;
      }
      if (url.pathname === "/ratelimit-reset") {
        const reset = url.searchParams.get("reset");
        response.statusCode = 429;
        response.setHeader("Content-Type", "text/plain");
        if (reset !== null) {
          response.setHeader("x-ratelimit-reset", reset);
        }
        response.end("rate limited");
        return;
      }
      response.statusCode = 503;
      response.setHeader("Content-Type", "text/plain");
      response.end("provider down");
    });

    server.on("error", started.reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        started.resolve({
          server,
          baseUrl: `http://127.0.0.1:${address.port}`,
          voidResponseClosed: voidResponseClosed.promise,
        });
        return;
      }
      started.reject("HTTP server did not expose a TCP port.");
    });

    return started.promise;
  });

const closeServer = (server: Server): Effect.Effect<void> =>
  Effect.sync(() => {
    server.closeAllConnections();
    server.closeIdleConnections();
    server.close();
  });

describe("SignatureHttpClient", () => {
  it.effect("decodes JSON through the injected HTTP seam", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const body = yield* SignatureHttpClient.use((http) =>
        http.requestJson(
          { method: "GET", url: `${local.baseUrl}/json` },
          JsonResponseSchema,
          "JsonResponse",
        ),
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(body).toEqual({ ok: true });
      yield* closeServer(local.server);
    }),
  );

  it.effect("maps HTTP status failures into SignatureKitError", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            { method: "GET", url: `${local.baseUrl}/status` },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.status).toBe(503);
        expect(result.failure.retryable).toBe(true);
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("parses small x-ratelimit-reset values as delta seconds", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const requestStartedAt = Math.floor(Date.now() / 1000);
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            { method: "GET", url: `${local.baseUrl}/ratelimit-reset?reset=7` },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );
      const requestFinishedAt = Math.floor(Date.now() / 1000);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.status).toBe(429);
        expect(result.failure.retryable).toBe(true);
        expect(result.failure.retryAfterEpochSeconds).toBeGreaterThanOrEqual(requestStartedAt + 7);
        expect(result.failure.retryAfterEpochSeconds).toBeLessThanOrEqual(requestFinishedAt + 8);
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("uses future x-ratelimit-reset epoch values as absolute reset", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const requestStartedAt = Math.floor(Date.now() / 1000);
      const absoluteReset = requestStartedAt + 120;
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            { method: "GET", url: `${local.baseUrl}/ratelimit-reset?reset=${absoluteReset}` },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );
      const requestFinishedAt = Math.floor(Date.now() / 1000);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.status).toBe(429);
        expect(result.failure.retryable).toBe(true);
        expect(result.failure.retryAfterEpochSeconds).toBeGreaterThanOrEqual(absoluteReset);
        expect(result.failure.retryAfterEpochSeconds).toBeLessThanOrEqual(
          requestFinishedAt + 120 + 2,
        );
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("clamps just-past x-ratelimit-reset epoch timestamps to now", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const requestStartedAt = Math.floor(Date.now() / 1000);
      const pastReset = requestStartedAt - 1;
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            { method: "GET", url: `${local.baseUrl}/ratelimit-reset?reset=${pastReset}` },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );
      const requestFinishedAt = Math.floor(Date.now() / 1000);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.status).toBe(429);
        expect(result.failure.retryable).toBe(true);
        expect(result.failure.retryAfterEpochSeconds).toBeGreaterThanOrEqual(requestStartedAt);
        expect(result.failure.retryAfterEpochSeconds).toBeLessThanOrEqual(requestFinishedAt + 2);
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("ignores invalid or out-of-window x-ratelimit-reset values", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const resultEntries = [{ reset: "not-a-number" }, { reset: "10000000000" }];

      for (const entry of resultEntries) {
        const result = yield* Effect.result(
          SignatureHttpClient.use((http) =>
            http.requestJson(
              { method: "GET", url: `${local.baseUrl}/ratelimit-reset?reset=${entry.reset}` },
              JsonResponseSchema,
              "JsonResponse",
            ),
          ).pipe(Effect.provide(signatureHttpClientLive)),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("signature-kit.HTTP");
          expect(result.failure.status).toBe(429);
          expect(result.failure.retryAfterEpochSeconds).toBeUndefined();
        }
      }

      yield* closeServer(local.server);
    }),
  );

  it.effect("times out slow response bodies with request timeout", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            {
              method: "GET",
              url: `${local.baseUrl}/slow-json`,
              timeoutMillis: 50,
            },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.reason).toContain("timed out");
        expect(result.failure.retryable).toBe(true);
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("uses diagnostic URLs in typed HTTP errors", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            {
              method: "GET",
              url: `${local.baseUrl}/status?access_token=clicksign-secret`,
              diagnosticUrl: `${local.baseUrl}/status?access_token=<redacted>`,
            },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toContain("access_token=<redacted>");
        expect(result.failure.reason).not.toContain("clicksign-secret");
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("maps malformed JSON into response-shape errors", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            { method: "GET", url: `${local.baseUrl}/bad-json` },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.RESPONSE_SHAPE");
        expect(result.failure.schemaName).toBe("JsonResponse");
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("uses the caller-provided schema name for malformed JSON", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            { method: "GET", url: `${local.baseUrl}/bad-json` },
            JsonResponseSchema,
            "DocuSealSubmissionResult",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.schemaName).toBe("DocuSealSubmissionResult");
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("marks non-idempotent POST network failures as non-retryable", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            { method: "POST", url: "http://127.0.0.1:1/unreachable" },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.retryable).toBe(false);
      }
    }),
  );

  it.effect("marks non-idempotent POST timeouts as non-retryable", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            {
              method: "POST",
              url: `${local.baseUrl}/slow-json`,
              timeoutMillis: 50,
            },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.retryable).toBe(false);
      }
      yield* closeServer(local.server);
    }),
  );

  it.effect("cancels successful void response bodies", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      yield* SignatureHttpClient.use((http) =>
        http.requestVoid({ method: "POST", url: `${local.baseUrl}/void` }),
      ).pipe(Effect.provide(signatureHttpClientLive));

      yield* Effect.promise(() => local.voidResponseClosed);

      expect(true).toBe(true);
      yield* closeServer(local.server);
    }),
  );
});

describe("SignatureKitError catalog", () => {
  it("keeps exported catalog messages aligned with the tagged error", () => {
    for (const entry of signatureKitErrorCatalog) {
      const defaultError = new SignatureKitError({ code: entry.code, retryable: false });
      expect(defaultError.message).toBe(entry.message);

      const customReason = `custom reason for ${entry.code}`;
      const reasonError = new SignatureKitError({
        code: entry.code,
        retryable: false,
        reason: customReason,
      });
      expect(reasonError.message).toBe(entry.overridable ? customReason : entry.message);
    }
  });
});
