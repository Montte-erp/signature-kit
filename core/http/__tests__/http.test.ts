import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { Buffer } from "node:buffer";
import { SignatureHttpClient, signatureHttpClientLive } from "../src/http";
import { Effect, Result, Schema } from "effect";
import { localHttpServer } from "../../../tooling/testing/local-http";
import type { LocalResponse } from "../../../tooling/testing/local-http";

const JsonResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
});

const startServer = () => {
  let resolveVoidResponseClosed: () => void = () => undefined;
  const voidResponseClosed = new Promise<void>((resolve) => {
    resolveVoidResponseClosed = resolve;
  });
  return localHttpServer(async (request): Promise<LocalResponse> => {
    if (request.pathname === "/json") {
      return {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      };
    }
    if (request.pathname === "/bad-json") {
      return { status: 200, headers: { "Content-Type": "application/json" }, body: "{" };
    }
    if (request.pathname === "/slow-json") {
      return {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: '{"ok":',
        keepOpen: true,
      };
    }
    if (request.pathname === "/void") {
      return {
        status: 200,
        headers: { "Content-Type": "text/plain" },
        body: "ignored",
        keepOpen: true,
        onClose: () => resolveVoidResponseClosed(),
      };
    }
    if (request.pathname === "/multipart") {
      const contentType = request.headers["content-type"];
      return {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok:
            typeof contentType === "string" &&
            contentType.includes("multipart/form-data") &&
            request.body.includes('name="signature_files[]"') &&
            request.body.includes('filename="document.pdf"') &&
            request.body.includes("Content-Type: application/pdf") &&
            request.body.includes("hello-pdf"),
        }),
      };
    }
    if (request.pathname === "/accepted-status") {
      return {
        status: 406,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      };
    }
    if (request.pathname === "/ratelimit-reset") {
      const reset = request.query.get("reset");
      return {
        status: 429,
        headers: {
          "Content-Type": "text/plain",
          ...(reset === null ? {} : { "x-ratelimit-reset": reset }),
        },
        body: "rate limited",
      };
    }
    if (request.pathname === "/retry-after") {
      const retryAfter = request.query.get("retryAfter");
      return {
        status: 429,
        headers: {
          "Content-Type": "text/plain",
          ...(retryAfter === null ? {} : { "Retry-After": retryAfter }),
        },
        body: "rate limited",
      };
    }
    return { status: 503, headers: { "Content-Type": "text/plain" }, body: "provider down" };
  }).pipe(
    Effect.map((server) => ({
      ...server,
      voidResponseClosed,
    })),
  );
};

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
    }),
  );
  it.effect("preserves HTTP-date Retry-After headers as retry epochs", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const requestStartedAt = Math.floor(Date.now() / 1000);
      const retryAfter = new Date((requestStartedAt + 60) * 1000).toUTCString();
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            {
              method: "GET",
              url: `${local.baseUrl}/retry-after?retryAfter=${encodeURIComponent(retryAfter)}`,
            },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.status).toBe(429);
        expect(result.failure.retryAfterEpochSeconds).toBe(requestStartedAt + 60);
      }
    }),
  );

  it.effect("preserves zero Retry-After delta seconds as a retry epoch", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const requestStartedAt = Math.floor(Date.now() / 1000);
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            { method: "GET", url: `${local.baseUrl}/retry-after?retryAfter=0` },
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
        expect(result.failure.retryAfterEpochSeconds).toBeGreaterThanOrEqual(requestStartedAt);
        expect(result.failure.retryAfterEpochSeconds).toBeLessThanOrEqual(requestFinishedAt);
      }
    }),
  );

  it.effect("preserves rate-limit metadata when response body consumption fails", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => {
                controller.error(new Error("response body read failed"));
              },
            }),
            {
              status: 429,
              headers: { "Retry-After": "120" },
            },
          ),
        ),
      );
      const requestStartedAt = Math.floor(Date.now() / 1000);
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            {
              method: "POST",
              url: "https://provider.example.test/rate-limited",
              acceptedStatuses: [429],
            },
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
        expect(result.failure.retryAfterEpochSeconds).toBeGreaterThanOrEqual(
          requestStartedAt + 120,
        );
        expect(result.failure.retryAfterEpochSeconds).toBeLessThanOrEqual(requestFinishedAt + 121);
      }
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
  );

  it.effect("preserves rate-limit metadata when an accepted response body times out", () =>
    Effect.gen(function* () {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", () =>
        Promise.resolve(
          new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), {
            status: 429,
            headers: { "Retry-After": "120" },
          }),
        ),
      );
      const request = SignatureHttpClient.use((http) =>
        http.requestJson(
          {
            method: "POST",
            url: "https://provider.example.test/rate-limited",
            acceptedStatuses: [429],
            timeoutMillis: 10,
          },
          JsonResponseSchema,
          "JsonResponse",
        ),
      ).pipe(Effect.provide(signatureHttpClientLive));
      const result = yield* Effect.promise(() => {
        const pending = Effect.runPromise(Effect.result(request));
        return vi.advanceTimersByTimeAsync(10).then(() => pending);
      });

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.HTTP");
        expect(result.failure.status).toBe(429);
        expect(result.failure.retryable).toBe(true);
        expect(result.failure.retryAfterEpochSeconds).toBeGreaterThanOrEqual(
          Math.floor(Date.now() / 1000) + 120,
        );
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.useRealTimers();
          vi.unstubAllGlobals();
        }),
      ),
    ),
  );

  it.effect("rejects non-finite, fractional, negative, and oversized request timeouts", () =>
    Effect.gen(function* () {
      const invalidTimeouts = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -1,
        1.5,
        2_147_483_648,
        Number.MAX_SAFE_INTEGER,
      ];
      for (const timeoutMillis of invalidTimeouts) {
        const result = yield* Effect.result(
          SignatureHttpClient.use((http) =>
            http.requestJson(
              { method: "GET", url: "not a URL", timeoutMillis },
              JsonResponseSchema,
              "JsonResponse",
            ),
          ).pipe(Effect.provide(signatureHttpClientLive)),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("signature-kit.INVALID_INPUT");
          expect(result.failure.retryable).toBe(false);
          expect(result.failure.schemaName).toBe("SignatureHttpRequest");
        }
      }
    }),
  );
  it.effect("cleans timers and listeners when fetch throws synchronously", () =>
    Effect.gen(function* () {
      vi.useFakeTimers();
      const addEventListener = vi.spyOn(AbortSignal.prototype, "addEventListener");
      const removeEventListener = vi.spyOn(AbortSignal.prototype, "removeEventListener");
      vi.stubGlobal("fetch", () => {
        throw new Error("synchronous fetch failure");
      });
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            { method: "GET", url: "https://provider.example.test/status", timeoutMillis: 100 },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      expect(addEventListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
      expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          vi.useRealTimers();
          vi.restoreAllMocks();
          vi.unstubAllGlobals();
        }),
      ),
    ),
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
    }),
  );
  it.effect("redacts default diagnostic URLs", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", () => Promise.reject(new Error("network failure")));
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson(
            {
              method: "GET",
              url: "https://alice:password@provider.example.test/status?access_token=query-secret&other=value#fragment",
            },
            JsonResponseSchema,
            "JsonResponse",
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toContain("https://provider.example.test/status");
        expect(result.failure.reason).not.toContain("alice");
        expect(result.failure.reason).not.toContain("password");
        expect(result.failure.reason).not.toContain("query-secret");
        expect(result.failure.reason).not.toContain("fragment");
        expect(result.failure.reason).not.toContain("?");
        expect(result.failure.reason).not.toContain("#");
      }
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals()))),
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
    }),
  );

  it.effect("submits multipart form bodies through the HTTP seam", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const formData = new FormData();
      formData.append(
        "signature_files[]",
        new File([Buffer.from("hello-pdf")], "document.pdf", { type: "application/pdf" }),
      );
      const body = yield* SignatureHttpClient.use((http) =>
        http.requestJson(
          { method: "POST", url: `${local.baseUrl}/multipart`, body: formData },
          JsonResponseSchema,
          "JsonResponse",
        ),
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(body).toEqual({ ok: true });
    }),
  );

  it.effect("decodes JSON from explicitly accepted non-2xx statuses", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const body = yield* SignatureHttpClient.use((http) =>
        http.requestJson(
          { method: "POST", url: `${local.baseUrl}/accepted-status`, acceptedStatuses: [406] },
          JsonResponseSchema,
          "JsonResponse",
        ),
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(body).toEqual({ ok: true });
    }),
  );

  it.effect("cancels successful void response bodies", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      yield* SignatureHttpClient.use((http) =>
        http.requestVoid({ method: "POST", url: `${local.baseUrl}/void` }),
      ).pipe(Effect.provide(signatureHttpClientLive));

      yield* Effect.promise(() => local.voidResponseClosed);
    }),
  );
});
