import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import {
  PdfAutoSignaturePlacementSchema,
  PdfErrorCodeValue,
  PdfInvisibleSignaturePlacementSchema,
  PdfManualSignaturePlacementSchema,
  PdfOperationValue,
  PdfSignatureAppearanceSchema,
} from "../src/config";
import type {
  PdfCoordinateTuple,
  PdfSignatureAppearance,
  PdfSignaturePlacement,
} from "../src/config";
import { addSignaturePlaceholder } from "../src/placeholder";
import { resolveSignatureWidgetPlacement } from "../src/placement";

const autoPlacement = {
  kind: "auto",
  width: 120,
  height: 40,
  margin: 20,
  gap: 8,
} satisfies PdfSignaturePlacement;

describe("PDF signature appearance page selectors", () => {
  it.effect("rejects every ambiguous page selector at schema and public boundaries", () =>
    Effect.gen(function* () {
      const pdfDoc = yield* Effect.promise(() => PDFDocument.create());
      pdfDoc.addPage([320, 180]);
      pdfDoc.addPage([320, 180]);
      const pdf = yield* Effect.promise(() => pdfDoc.save({ useObjectStreams: false }));
      const ambiguousAppearances = [
        { pageIndex: 0, placement: { ...autoPlacement, page: "last" } },
        { pageIndex: 0, placement: { ...autoPlacement, pageIndex: 1 } },
        { placement: { ...autoPlacement, page: "first", pageIndex: 1 } },
      ] satisfies ReadonlyArray<PdfSignatureAppearance>;

      for (const appearance of ambiguousAppearances) {
        const schemaResult = yield* Effect.result(
          Schema.decodeUnknownEffect(PdfSignatureAppearanceSchema)(appearance),
        );
        expect(Result.isFailure(schemaResult)).toBe(true);

        const publicResult = yield* Effect.result(
          addSignaturePlaceholder({ pdf, signatureLength: 128, appearance }),
        );
        expect(Result.isFailure(publicResult)).toBe(true);
        if (Result.isFailure(publicResult)) {
          expect(publicResult.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
          expect(publicResult.failure.operation).toBe(PdfOperationValue.placeholder);
        }

        const runtimeResult = yield* Effect.result(
          resolveSignatureWidgetPlacement(pdfDoc, appearance),
        );
        expect(Result.isFailure(runtimeResult)).toBe(true);
        if (Result.isFailure(runtimeResult)) {
          expect(runtimeResult.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
          expect(runtimeResult.failure.operation).toBe(PdfOperationValue.placeholder);
        }
      }
    }),
  );
  it.effect("rejects a legacy widget rect combined with every placement mode", () =>
    Effect.gen(function* () {
      const pdfDoc = yield* Effect.promise(() => PDFDocument.create());
      pdfDoc.addPage([320, 180]);
      const pdf = yield* Effect.promise(() => pdfDoc.save({ useObjectStreams: false }));
      const widgetRect = [20, 20, 140, 60] satisfies PdfCoordinateTuple;
      const conflictingAppearances = [
        { widgetRect, placement: { kind: "invisible" } },
        {
          widgetRect,
          placement: {
            kind: "manual",
            pageIndex: 0,
            widgetRect: [40, 20, 160, 60] satisfies PdfCoordinateTuple,
          },
        },
        { widgetRect, placement: { ...autoPlacement, pageIndex: 0 } },
      ] satisfies ReadonlyArray<PdfSignatureAppearance>;

      for (const appearance of conflictingAppearances) {
        const schemaResult = yield* Effect.result(
          Schema.decodeUnknownEffect(PdfSignatureAppearanceSchema)(appearance),
        );
        expect(Result.isFailure(schemaResult)).toBe(true);

        const publicResult = yield* Effect.result(
          addSignaturePlaceholder({ pdf, signatureLength: 128, appearance }),
        );
        expect(Result.isFailure(publicResult)).toBe(true);
        if (Result.isFailure(publicResult)) {
          expect(publicResult.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
          expect(publicResult.failure.operation).toBe(PdfOperationValue.placeholder);
        }

        const runtimeResult = yield* Effect.result(
          resolveSignatureWidgetPlacement(pdfDoc, appearance),
        );
        expect(Result.isFailure(runtimeResult)).toBe(true);
        if (Result.isFailure(runtimeResult)) {
          expect(runtimeResult.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
          expect(runtimeResult.failure.operation).toBe(PdfOperationValue.placeholder);
        }
      }
    }),
  );

  it.effect("accepts exactly one selector and resolves its intended page", () =>
    Effect.gen(function* () {
      const pdfDoc = yield* Effect.promise(() => PDFDocument.create());
      pdfDoc.addPage([320, 180]);
      pdfDoc.addPage([320, 180]);
      const appearances = [
        { appearance: { placement: { ...autoPlacement, page: "last" } }, expectedPageIndex: 1 },
        { appearance: { pageIndex: 0, placement: autoPlacement }, expectedPageIndex: 0 },
        { appearance: { placement: { ...autoPlacement, pageIndex: 1 } }, expectedPageIndex: 1 },
      ] satisfies ReadonlyArray<{
        readonly appearance: PdfSignatureAppearance;
        readonly expectedPageIndex: number;
      }>;

      for (const placementCase of appearances) {
        const decoded = yield* Schema.decodeUnknownEffect(PdfSignatureAppearanceSchema)(
          placementCase.appearance,
        );
        const resolved = yield* resolveSignatureWidgetPlacement(pdfDoc, decoded);
        expect(resolved.pageIndex).toBe(placementCase.expectedPageIndex);
      }
    }),
  );
  it.effect("rejects invalid page indexes at placement schema boundaries", () =>
    Effect.gen(function* () {
      const invalidPageIndexes = [
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ];

      for (const pageIndex of invalidPageIndexes) {
        const invisible = yield* Effect.result(
          Schema.decodeUnknownEffect(PdfInvisibleSignaturePlacementSchema)({
            kind: "invisible",
            pageIndex,
          }),
        );
        const manual = yield* Effect.result(
          Schema.decodeUnknownEffect(PdfManualSignaturePlacementSchema)({
            kind: "manual",
            pageIndex,
            widgetRect: [20, 20, 140, 60],
          }),
        );
        const auto = yield* Effect.result(
          Schema.decodeUnknownEffect(PdfAutoSignaturePlacementSchema)({
            kind: "auto",
            pageIndex,
          }),
        );
        const appearance = yield* Effect.result(
          Schema.decodeUnknownEffect(PdfSignatureAppearanceSchema)({ pageIndex }),
        );

        expect(Result.isFailure(invisible)).toBe(true);
        expect(Result.isFailure(manual)).toBe(true);
        expect(Result.isFailure(auto)).toBe(true);
        expect(Result.isFailure(appearance)).toBe(true);
      }

      const decoded = yield* Schema.decodeUnknownEffect(PdfSignatureAppearanceSchema)({
        pageIndex: 0,
      });
      expect(decoded.pageIndex).toBe(0);
    }),
  );
});
