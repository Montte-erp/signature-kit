import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { PdfErrorCodeValue, PdfOperationValue } from "../src/config";
import type { PdfSigningRequest } from "../src/config";
import { addSignaturePlaceholder } from "../src/placeholder";

const createPdf = (): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([320, 180]);
    return new Uint8Array(await pdf.save({ useObjectStreams: false }));
  });

describe("PDF placeholder public boundary", () => {
  it.effect("returns typed PDF errors for malformed runtime placeholder values", () =>
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
        const result = yield* Effect.result(addSignaturePlaceholder(request));

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe("PdfError");
          expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
          expect(result.failure.retryable).toBe(false);
          expect(result.failure.operation).toBe(PdfOperationValue.placeholder);
          expect(result.failure.reason).toBe("PDF signing input failed schema validation.");
        }
      }
    }),
  );

  it.effect("rejects inverted signature widgets without emitting a placeholder PDF", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf();
      const result = yield* Effect.result(
        addSignaturePlaceholder({ pdf, appearance: { widgetRect: [120, 20, 20, 60] } }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("PdfError");
        expect(result.failure.code).toBe(PdfErrorCodeValue.signaturePlacementFailed);
        expect(result.failure.retryable).toBe(false);
        expect(result.failure.operation).toBe(PdfOperationValue.placeholder);
      }
    }),
  );
});
