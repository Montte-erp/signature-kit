import { degrees, PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { PdfErrorCodeValue, PdfOperationValue, PdfSchemaNameValue } from "../src/config";
import { mergePdfs } from "../src/merge";
import { findPdfTextAnchors } from "../src/anchors";

const createPdf = (sizes: ReadonlyArray<readonly [number, number]>): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.create();
    for (const [width, height] of sizes) pdf.addPage([width, height]);
    return new Uint8Array(await pdf.save({ useObjectStreams: false }));
  });
const createCroppedRotatedPdf = (rotationDegrees: number): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 150]);
    page.setCropBox(100, 25, 200, 100);
    page.setRotation(degrees(rotationDegrees));
    return new Uint8Array(await document.save({ useObjectStreams: false }));
  });

describe("PDF merge and text-anchor input boundaries", () => {
  it.effect("rejects an empty document list instead of fabricating a page", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(mergePdfs([]));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
        expect(result.failure.retryable).toBe(false);
        expect(result.failure.operation).toBe(PdfOperationValue.mergeDocuments);
        expect(result.failure.schemaName).toBe(PdfSchemaNameValue.pdfMergeDocuments);
      }
    }),
  );
  it.effect("does not synthesize a page when valid documents contain no pages", () =>
    Effect.gen(function* () {
      const source = yield* Effect.promise(async () => {
        const pdf = await PDFDocument.create();
        return new Uint8Array(await pdf.save({ addDefaultPage: false, useObjectStreams: false }));
      });
      const merged = yield* mergePdfs([source]);
      const pageCount = yield* Effect.promise(async () =>
        (await PDFDocument.load(merged)).getPageCount(),
      );

      expect(pageCount).toBe(0);
    }),
  );
  it.effect("rejects non-finite and non-positive text-anchor stamp sizes", () =>
    Effect.gen(function* () {
      const invalidStampSizes = [
        { width: 0, height: 20 },
        { width: -1, height: 20 },
        { width: Number.NaN, height: 20 },
        { width: Number.POSITIVE_INFINITY, height: 20 },
        { width: Number.NEGATIVE_INFINITY, height: 20 },
        { width: 20, height: 0 },
        { width: 20, height: -1 },
        { width: 20, height: Number.NaN },
        { width: 20, height: Number.POSITIVE_INFINITY },
        { width: 20, height: Number.NEGATIVE_INFINITY },
      ];

      for (const stampSize of invalidStampSizes) {
        const result = yield* Effect.result(
          findPdfTextAnchors({
            pages: [{ index: 0, width: 220, height: 120 }],
            textBoxes: [[{ text: "Signature", x: 12, y: 12, width: 100, height: 12 }]],
            matchers: [{ text: "Signature" }],
            stampSize,
          }),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
          expect(result.failure.retryable).toBe(false);
          expect(result.failure.operation).toBe(PdfOperationValue.findTextAnchors);
          expect(result.failure.schemaName).toBe(PdfSchemaNameValue.pdfTextAnchorSearchInput);
        }
      }
    }),
  );
  it.effect("rejects non-finite anchor boxes and offsets while allowing a negative offset", () =>
    Effect.gen(function* () {
      const validInput = {
        pages: [{ index: 0, width: 220, height: 120 }],
        textBoxes: [[{ text: "Signature", x: 12, y: 12, width: 100, height: 12 }]],
        matchers: [{ text: "Signature" }],
        stampSize: { width: 80, height: 20 },
      };
      const invalidInputs = [
        { textBoxes: [[{ text: "Signature", x: Number.NaN, y: 12, width: 100, height: 12 }]] },
        {
          textBoxes: [
            [{ text: "Signature", x: Number.POSITIVE_INFINITY, y: 12, width: 100, height: 12 }],
          ],
        },
        {
          textBoxes: [
            [{ text: "Signature", x: 12, y: Number.NEGATIVE_INFINITY, width: 100, height: 12 }],
          ],
        },
        { textBoxes: [[{ text: "Signature", x: 12, y: 12, width: 0, height: 12 }]] },
        { textBoxes: [[{ text: "Signature", x: 12, y: 12, width: -1, height: 12 }]] },
        { textBoxes: [[{ text: "Signature", x: 12, y: 12, width: 100, height: Number.NaN }]] },
        {
          textBoxes: [
            [{ text: "Signature", x: 12, y: 12, width: 100, height: Number.POSITIVE_INFINITY }],
          ],
        },
        { offset: Number.NaN },
        { offset: Number.POSITIVE_INFINITY },
        { offset: Number.NEGATIVE_INFINITY },
      ];

      for (const invalidInput of invalidInputs) {
        const result = yield* Effect.result(findPdfTextAnchors({ ...validInput, ...invalidInput }));

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
          expect(result.failure.retryable).toBe(false);
          expect(result.failure.operation).toBe(PdfOperationValue.findTextAnchors);
          expect(result.failure.schemaName).toBe(PdfSchemaNameValue.pdfTextAnchorSearchInput);
        }
      }

      const anchors = yield* findPdfTextAnchors({ ...validInput, offset: -4 });
      expect(anchors).toStrictEqual([{ pageIndex: 0, x: 12, y: 20, width: 80, height: 20 }]);
    }),
  );
  it.effect(
    "uses visible non-square CropBox dimensions for 90 and 270 degree direct PDF anchors",
    () =>
      Effect.gen(function* () {
        for (const rotation of [450, 270]) {
          const pdf = yield* createCroppedRotatedPdf(rotation);
          const anchors = yield* findPdfTextAnchors({
            pdf,
            textBoxes: [[{ text: "Signature", x: 95, y: 185, width: 10, height: 10 }]],
            matchers: [{ text: "Signature" }],
            stampSize: { width: 80, height: 20 },
            placement: "below",
            offset: 0,
          });

          expect(anchors).toStrictEqual([{ pageIndex: 0, x: 20, y: 180, width: 80, height: 20 }]);
        }
      }),
  );
  it.effect("merges valid documents in page order", () =>
    Effect.gen(function* () {
      const first = yield* createPdf([[200, 100]]);
      const second = yield* createPdf([
        [300, 150],
        [400, 200],
      ]);
      const merged = yield* mergePdfs([first, second]);
      const sizes = yield* Effect.promise(async () =>
        (await PDFDocument.load(merged)).getPages().map((page) => {
          const size = page.getSize();
          return [size.width, size.height];
        }),
      );

      expect(sizes).toStrictEqual([
        [200, 100],
        [300, 150],
        [400, 200],
      ]);
    }),
  );
  it.effect("finds a valid text anchor with a usable stamp rectangle", () =>
    Effect.gen(function* () {
      const anchors = yield* findPdfTextAnchors({
        pages: [{ index: 0, width: 220, height: 120 }],
        textBoxes: [[{ text: "Signature", x: 12, y: 12, width: 100, height: 12 }]],
        matchers: [{ text: "Signature" }],
        stampSize: { width: 80, height: 20 },
        placement: "below",
        offset: 0,
      });

      expect(anchors).toStrictEqual([{ pageIndex: 0, x: 12, y: 24, width: 80, height: 20 }]);
    }),
  );
});
