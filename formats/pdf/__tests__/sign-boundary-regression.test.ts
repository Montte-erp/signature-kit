import { PDFDocument } from "@cantoo/pdf-lib";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Redacted, Result } from "effect";
import { PdfErrorCodeValue, PdfOperationValue } from "../src/config";
import type { PdfSigningRequest } from "../src/config";
import { signPdf } from "../src/sign";
import type { Signatures } from "@signature-kit/signatures";
import { readA1Fixture } from "../../../tooling/testing/fixtures";

const createPdf = (): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([320, 180]);
    return new Uint8Array(await pdf.save({ useObjectStreams: false }));
  });

const PASSWORD = Redacted.make("changeit");

const withTestSignatures = <A, E>(effect: Effect.Effect<A, E, Signatures>) =>
  readA1Fixture("ecnpj").pipe(
    Effect.flatMap((pfx) =>
      effect.pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD }))),
    ),
  );

describe("PDF sign public boundary", () => {
  it.effect("returns typed PDF errors for malformed runtime signing values", () =>
    withTestSignatures(
      Effect.gen(function* () {
        const invalidHashAlgorithm: PdfSigningRequest = {
          pdf: new Uint8Array([1, 2, 3]),
          hashAlgorithm: "sha256",
        };
        expect(Reflect.set(invalidHashAlgorithm, "hashAlgorithm", "md5")).toBe(true);

        const invalidRequests: ReadonlyArray<PdfSigningRequest> = [
          invalidHashAlgorithm,
          { pdf: new Uint8Array([1, 2, 3]), signatureLength: 64.5 },
          { pdf: new Uint8Array([1, 2, 3]), signatureLength: Number.POSITIVE_INFINITY },
          { pdf: new Uint8Array([1, 2, 3]), signatureLength: Number.NaN },
          { pdf: new Uint8Array([1, 2, 3]), signingTime: new Date(Number.NaN) },
          {
            pdf: new Uint8Array([1, 2, 3]),
            appearance: { widgetRect: [Number.NaN, 20, 120, 60] },
          },
        ];

        for (const request of invalidRequests) {
          const result = yield* Effect.result(signPdf(request));

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure._tag).toBe("PdfError");
            if (result.failure._tag === "PdfError") {
              expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
              expect(result.failure.retryable).toBe(false);
              expect(result.failure.operation).toBe(PdfOperationValue.sign);
              expect(result.failure.reason).toBe("PDF signing request failed schema validation.");
            }
          }
        }
      }),
    ),
  );

  it.effect("rejects inverted signature widgets without emitting a signed PDF", () =>
    withTestSignatures(
      Effect.gen(function* () {
        const pdf = yield* createPdf();
        const result = yield* Effect.result(
          signPdf({ pdf, appearance: { widgetRect: [120, 20, 20, 60] } }),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe("PdfError");
          if (result.failure._tag === "PdfError") {
            expect(result.failure.code).toBe(PdfErrorCodeValue.signaturePlacementFailed);
            expect(result.failure.retryable).toBe(false);
            expect(result.failure.operation).toBe(PdfOperationValue.placeholder);
          }
        }
      }),
    ),
  );
});
