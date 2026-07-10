import { describe, expect, it } from "@effect/vitest";
import {
  SignatureHttpClient,
  SignatureHttpJsonResponseSchema,
  signatureHttpClientLive,
  type SignatureHttpJsonResponse,
} from "../src/http";
import { Effect, Schema } from "effect";
import { localHttpServer } from "../../../tooling/testing/local-http";

const JsonBodySchema = Schema.Struct({
  ok: Schema.Boolean,
});

const JsonResponseEnvelopeSchema = SignatureHttpJsonResponseSchema(JsonBodySchema);

const StatusJsonResponseSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal(206), body: JsonBodySchema }),
  Schema.Struct({ status: Schema.Literal(406), body: JsonBodySchema }),
]);

describe("SignatureHttpClient status-aware JSON", () => {
  it.effect("preserves accepted HTTP statuses with decoded JSON bodies", () =>
    Effect.gen(function* () {
      const local = yield* localHttpServer(async (request) => {
        if (request.pathname === "/partial") {
          return {
            status: 206,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ok: true }),
          };
        }
        return {
          status: 406,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ok: true }),
        };
      });
      const partial = yield* SignatureHttpClient.use((http) =>
        http.requestJsonResponse(
          { method: "GET", url: `${local.baseUrl}/partial` },
          StatusJsonResponseSchema,
          "StatusJsonResponse",
        ),
      ).pipe(Effect.provide(signatureHttpClientLive));
      const untrusted = yield* SignatureHttpClient.use((http) =>
        http.requestJsonResponse(
          {
            method: "GET",
            url: `${local.baseUrl}/untrusted`,
            acceptedStatuses: [406],
          },
          StatusJsonResponseSchema,
          "StatusJsonResponse",
        ),
      ).pipe(Effect.provide(signatureHttpClientLive));

      expect(partial).toEqual({ status: 206, body: { ok: true } });
      expect(untrusted).toEqual({ status: 406, body: { ok: true } });
    }),
  );

  it.effect("derives status and body contracts from the supplied body schema", () =>
    Effect.gen(function* () {
      const local = yield* localHttpServer(async () => ({
        status: 206,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      }));
      const response = yield* SignatureHttpClient.use((http) =>
        http.requestJsonResponse(
          { method: "GET", url: `${local.baseUrl}/partial` },
          JsonResponseEnvelopeSchema,
          "JsonResponseEnvelope",
        ),
      ).pipe(Effect.provide(signatureHttpClientLive));
      const publicResponse: SignatureHttpJsonResponse<{ readonly ok: boolean }> = response;

      expect(publicResponse).toEqual({ status: 206, body: { ok: true } });
    }),
  );
});
