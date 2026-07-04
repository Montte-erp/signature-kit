import { describe, expect, it } from "@effect/vitest";
import { Buffer } from "node:buffer";
import { SignatureHttpClient, signatureHttpClientLive } from "@signature-kit/http";
import { Effect, Result, Schema } from "effect";
import { localHttpServer, type LocalResponse } from "../../../tooling/testing/local-http";

const JsonResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
});

const startServer = () => {
  const voidResponseClosed = Promise.withResolvers<void>();
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
        onClose: () => voidResponseClosed.resolve(),
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
    return { status: 503, headers: { "Content-Type": "text/plain" }, body: "provider down" };
  }).pipe(
    Effect.map((server) => ({
      ...server,
      voidResponseClosed: voidResponseClosed.promise,
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
