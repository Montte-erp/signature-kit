import { describe, expect, it } from "@effect/vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { Effect, Result } from "effect";
import { stampPdfRubric } from "../src/stamp";
import { PdfErrorCodeValue, type PdfCoordinateTuple } from "../src/config";

// A three-page PDF so "all" vs a page list is observable.
const createThreePagePdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) {
    const page = pdf.addPage([320, 180]);
    page.drawText(`Page ${index + 1}`, { x: 32, y: 150, size: 12 });
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  return new Uint8Array(bytes);
});

// 1×1 PNG (opaque black) — exercises the embedPng path without a fixture file.
const ONE_BY_ONE_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

const RUBRIC_RECT: PdfCoordinateTuple = [20, 20, 140, 64];

const pageCount = (bytes: Uint8Array): Effect.Effect<number> =>
  Effect.promise(async () => (await PDFDocument.load(bytes)).getPageCount());

describe("stampPdfRubric", () => {
  it.effect("stamps the rubric on every page and preserves the page count", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const stamped = yield* stampPdfRubric(pdf, {
        rect: RUBRIC_RECT,
        lines: ["TELEMACO CERIOLLI JUNIOR", "CPF/CNPJ: 767.081.102-10", "25/06/2026 19:00"],
      });
      expect(yield* pageCount(stamped)).toBe(3);
      // Drawing real content onto all three pages grows the document.
      expect(stamped.byteLength).toBeGreaterThan(pdf.byteLength);
    }),
  );

  it.effect("stamping more pages adds more content than stamping one", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const onePage = yield* stampPdfRubric(pdf, { rect: RUBRIC_RECT, pages: [0], lines: ["x"] });
      const allPages = yield* stampPdfRubric(pdf, {
        rect: RUBRIC_RECT,
        pages: "all",
        lines: ["x"],
      });
      expect(yield* pageCount(allPages)).toBe(3);
      expect(allPages.byteLength).toBeGreaterThan(onePage.byteLength);
    }),
  );

  it.effect("draws an embedded PNG rubric", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const stamped = yield* stampPdfRubric(pdf, {
        rect: RUBRIC_RECT,
        pages: [0],
        imagePng: ONE_BY_ONE_PNG,
        lines: ["Signed"],
      });
      expect(yield* pageCount(stamped)).toBe(3);
      expect(stamped.byteLength).toBeGreaterThan(pdf.byteLength);
    }),
  );

  it.effect("fails when a target page index is out of range", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const result = yield* Effect.result(
        stampPdfRubric(pdf, { rect: RUBRIC_RECT, pages: [5], lines: ["x"] }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );

  it.effect("fails when the rect has no area", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const result = yield* Effect.result(
        stampPdfRubric(pdf, { rect: [20, 20, 20, 64], lines: ["x"] }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );
});
