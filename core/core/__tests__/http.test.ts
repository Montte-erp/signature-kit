import { describe, expect, it } from "@effect/vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { SignatureHttpClient, signatureHttpClientLive } from "@signature-kit/core/http";
import {
  SignatureKitError,
  SignatureKitSchemaNameValue,
  signatureKitErrorCatalog,
} from "@signature-kit/core/config";
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
          SignatureKitSchemaNameValue.providerHttpRequest,
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
            SignatureKitSchemaNameValue.providerHttpRequest,
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
            SignatureKitSchemaNameValue.providerHttpRequest,
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
            SignatureKitSchemaNameValue.providerHttpRequest,
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
            SignatureKitSchemaNameValue.providerHttpRequest,
          ),
        ).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("signature-kit.RESPONSE_SHAPE");
        expect(result.failure.schemaName).toBe("ProviderHttpRequest");
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
            SignatureKitSchemaNameValue.docuSealSubmissionResult,
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
            SignatureKitSchemaNameValue.providerHttpRequest,
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
            SignatureKitSchemaNameValue.providerHttpRequest,
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
