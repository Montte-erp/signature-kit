import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { PdfSignaturePageSchema, PdfSignatureRectSchema } from "../src/config";

const invalidIndices = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5, -1];

const invalidCoordinates = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1];

const invalidDimensions = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1];

describe("PDF geometry schema boundaries", () => {
  it.effect("rejects invalid signature rectangle geometry", () =>
    Effect.gen(function* () {
      const valid = { pageIndex: 0, x: 0, y: 0, width: 10, height: 10 };
      const invalidRects = [
        ...invalidIndices.map((pageIndex) => ({ ...valid, pageIndex })),
        ...invalidCoordinates.flatMap((x) => [
          { ...valid, x },
          { ...valid, y: x },
        ]),
        ...invalidDimensions.flatMap((width) => [
          { ...valid, width },
          { ...valid, height: width },
        ]),
      ];

      for (const rect of invalidRects) {
        const result = yield* Effect.result(
          Schema.decodeUnknownEffect(PdfSignatureRectSchema)(rect),
        );

        expect(Result.isFailure(result)).toBe(true);
      }

      const decoded = yield* Schema.decodeUnknownEffect(PdfSignatureRectSchema)({
        pageIndex: 0,
        x: 0.5,
        y: 0.25,
        width: 0.5,
        height: 0.25,
      });
      expect(decoded).toStrictEqual({ pageIndex: 0, x: 0.5, y: 0.25, width: 0.5, height: 0.25 });
    }),
  );

  it.effect("rejects invalid signature page geometry", () =>
    Effect.gen(function* () {
      const valid = { index: 0, width: 10, height: 10 };
      const invalidPages = [
        ...invalidIndices.map((index) => ({ ...valid, index })),
        ...invalidDimensions.flatMap((width) => [
          { ...valid, width },
          { ...valid, height: width },
        ]),
      ];

      for (const page of invalidPages) {
        const result = yield* Effect.result(
          Schema.decodeUnknownEffect(PdfSignaturePageSchema)(page),
        );

        expect(Result.isFailure(result)).toBe(true);
      }

      const decoded = yield* Schema.decodeUnknownEffect(PdfSignaturePageSchema)({
        index: 0,
        width: 0.5,
        height: 0.25,
      });
      expect(decoded).toStrictEqual({ index: 0, width: 0.5, height: 0.25 });
    }),
  );
});
