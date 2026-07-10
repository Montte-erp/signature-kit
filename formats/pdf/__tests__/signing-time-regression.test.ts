import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { PdfErrorCodeValue, PdfOperationValue, PdfSigningRequestSchema } from "../src/config";
import { addSignaturePlaceholder } from "../src/placeholder";

const createPdf = (): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([320, 180]);
    return new Uint8Array(await pdf.save({ useObjectStreams: false }));
  });

describe("PDF signing time boundaries", () => {
  it.effect("rejects an invalid signing time before loading PDF bytes", () =>
    Effect.gen(function* () {
      const signingTime = new Date(Number.NaN);
      const decoded = yield* Effect.result(
        Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
          pdf: new Uint8Array(),
          signingTime,
        }),
      );
      const result = yield* Effect.result(
        addSignaturePlaceholder({ pdf: new Uint8Array([1, 2, 3]), signingTime }),
      );

      expect(Result.isFailure(decoded)).toBe(true);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
        expect(result.failure.retryable).toBe(false);
        expect(result.failure.operation).toBe(PdfOperationValue.placeholder);
      }
    }),
  );

  it.effect("accepts a valid signing time", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf();
      const signingTime = new Date("2026-01-02T03:04:05Z");
      const decoded = yield* Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
        pdf,
        signingTime,
      });
      const placeholder = yield* addSignaturePlaceholder({ pdf, signingTime });

      expect(decoded.signingTime).toBe(signingTime);
      expect(placeholder.byteLength).toBeGreaterThan(pdf.byteLength);
    }),
  );
});
