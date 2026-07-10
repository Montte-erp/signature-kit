import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { MAX_PDF_SIGNATURE_BYTES, PdfSigningRequestSchema } from "../src/config";

describe("PDF signature capacity boundary", () => {
  it.effect("accepts the exact capacity and rejects one byte over it", () =>
    Effect.gen(function* () {
      const exact = yield* Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
        pdf: new Uint8Array(),
        signatureLength: MAX_PDF_SIGNATURE_BYTES,
      });
      const over = yield* Effect.result(
        Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
          pdf: new Uint8Array(),
          signatureLength: MAX_PDF_SIGNATURE_BYTES + 1,
        }),
      );

      expect(exact.signatureLength).toBe(MAX_PDF_SIGNATURE_BYTES);
      expect(Result.isFailure(over)).toBe(true);
    }),
  );
});
