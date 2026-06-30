import { describe, expect, it } from "@effect/vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { SignatureHttpClient, signatureHttpClientLive } from "@signature-kit/core/http";
import { SignatureKitError, signatureKitErrorCatalog } from "@signature-kit/core/config";
import { Effect, Result } from "effect";

type LocalServer = {
  readonly server: Server;
  readonly baseUrl: string;
};

const startServer = (): Effect.Effect<LocalServer> =>
  Effect.promise(() => {
    const started = Promise.withResolvers<LocalServer>();
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("Connection", "close");
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
      response.statusCode = 503;
      response.setHeader("Content-Type", "text/plain");
      response.end("provider down");
    });

    server.on("error", started.reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        started.resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
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
        http.requestJson({ method: "GET", url: `${local.baseUrl}/json` }),
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
          http.requestJson({ method: "GET", url: `${local.baseUrl}/status` }),
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

  it.effect("uses diagnostic URLs in typed HTTP errors", () =>
    Effect.gen(function* () {
      const local = yield* startServer();
      const result = yield* Effect.result(
        SignatureHttpClient.use((http) =>
          http.requestJson({
            method: "GET",
            url: `${local.baseUrl}/status?access_token=clicksign-secret`,
            diagnosticUrl: `${local.baseUrl}/status?access_token=<redacted>`,
          }),
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
          http.requestJson({ method: "GET", url: `${local.baseUrl}/bad-json` }),
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
