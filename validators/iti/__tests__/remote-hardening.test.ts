import { describe, expect, it } from "@effect/vitest";
import { signatureHttpClientLive } from "@signature-kit/http";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { readFile } from "node:fs/promises";
import { Effect, Result, Schema } from "effect";
import { vi } from "vitest";
import { localHttpServer } from "../../../tooling/testing/local-http";
import { ItiRemoteValidationReportSchema, validatePdfWithIti } from "../src/remote";

const ITI_ENDPOINT = "https://validar.iti.gov.br/arquivo";

const readSignedFixture = (): Effect.Effect<Uint8Array> =>
  Effect.promise(
    async () =>
      new Uint8Array(
        await readFile(new URL("./fixtures/icp-brasil-ad-rb-signed.pdf", import.meta.url)),
      ),
  );

const installItiFetchRedirect = (baseUrl: string): Effect.Effect<void> =>
  Effect.sync(() => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      if (input === ITI_ENDPOINT) return originalFetch(`${baseUrl}/arquivo`, init);
      return originalFetch(input, init);
    });
  });

const restoreFetch = Effect.sync(() => {
  vi.unstubAllGlobals();
});

const validateWithItiResponse = (status: number, body: unknown) =>
  Effect.gen(function* () {
    const pdf = yield* readSignedFixture();
    const local = yield* localHttpServer(async () => ({
      status,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    yield* installItiFetchRedirect(local.baseUrl);
    return yield* validatePdfWithIti({ source: { pdf } }).pipe(
      Effect.provide(signatureHttpClientLive),
    );
  }).pipe(Effect.ensuring(restoreFetch));

describe("ITI remote hardening", () => {
  it.effect("uses normalized exact official statuses without approving negated text", () =>
    Effect.gen(function* () {
      const approved = yield* validateWithItiResponse(200, {
        verifierReport: { status: "\n APROVADO\t" },
      });
      const rejected = yield* validateWithItiResponse(200, {
        verifierReport: { status: " reprovado " },
      });
      const negated = yield* validateWithItiResponse(200, {
        verifierReport: { status: "Não aprovado" },
      });

      expect(approved.approved).toBe(true);
      expect(approved.outcome).toBe("approved");
      expect(rejected.approved).toBe(false);
      expect(rejected.outcome).toBe("rejected");
      expect(negated.approved).toBe(false);
      expect(negated.outcome).toBe("unknown");
    }),
  );

  it.effect("preserves the ITI 206 partial report while failing closed", () =>
    Effect.gen(function* () {
      const partialPayload = {
        qtds: [1, 2],
        json: { report: "partial" },
      };
      const report = yield* validateWithItiResponse(206, partialPayload);
      const decoded = yield* Schema.decodeUnknownEffect(ItiRemoteValidationReportSchema)(report);
      expect(report.validator).toBe("iti.remote");
      expect(report.outcome).toBe("partial");
      expect(report.approved).toBe(false);
      expect(decoded).toEqual(report);
      if (report.outcome !== "partial") return;
      expect(report.processedSignatureCount).toBe(1);
      expect(report.totalSignatureCount).toBe(2);
      expect(report.rawVerifierReport).toEqual(partialPayload.json);
      expect(report.rawResponse).toEqual(partialPayload);
      expect(report.localConformance.approved).toBe(true);
    }),
  );
  it.effect("fails closed when an HTTP status contradicts an approved verifier report", () =>
    Effect.gen(function* () {
      for (const status of [206, 406]) {
        const result = yield* Effect.result(
          validateWithItiResponse(status, { verifierReport: { aprovado: true } }),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(SignatureKitErrorCodeValue.responseShape);
          expect(result.failure.status).toBe(status);
        }
      }
    }),
  );

  it.effect("validates malformed PDFs before submitting them to ITI", () =>
    Effect.gen(function* () {
      const local = yield* localHttpServer(async () => ({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifierReport: { aprovado: true } }),
      }));
      yield* installItiFetchRedirect(local.baseUrl);
      const result = yield* Effect.result(
        validatePdfWithIti({
          source: { pdf: new Uint8Array([0x6e, 0x6f, 0x74, 0x2d, 0x70, 0x64, 0x66]) },
        }).pipe(Effect.provide(signatureHttpClientLive)),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(SignatureKitErrorCodeValue.verifyFailed);
      }
      expect(local.requests).toEqual([]);
    }).pipe(Effect.ensuring(restoreFetch)),
  );
});
