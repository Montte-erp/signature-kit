import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { findPdfTextAnchors } from "../src/anchors";
import { liteParseWorkerBrowserLayer } from "../src/liteparse-browser";

const page: ReadonlyArray<{ index: number; width: number; height: number }> = [
  { index: 0, width: 220, height: 120 },
];

const stampSize = { width: 80, height: 20 };

const findAnchorsForText = (text: string): ReturnType<typeof findPdfTextAnchors> =>
  findPdfTextAnchors({
    pages: page,
    textBoxes: [[{ text, x: 12, y: 12, width: 100, height: 12 }]],
    matchers: [{ digits: "12345678901" }],
    stampSize,
    placement: "below",
    offset: 0,
  });

describe("PDF digit anchor matching", () => {
  it.effect("does not match CPF digits when surrounded by CNPJ digits", () =>
    Effect.gen(function* () {
      const anchors = yield* findAnchorsForText("CNPJ 12.345.678/9012-34");

      expect(anchors).toHaveLength(0);
    }).pipe(Effect.provide(liteParseWorkerBrowserLayer)),
  );

  it.effect("does not match CPF digits in phone + date digit soup", () =>
    Effect.gen(function* () {
      const anchors = yield* findAnchorsForText("Telefone: (11) 2345-6789 01/01");

      expect(anchors).toHaveLength(0);
    }).pipe(Effect.provide(liteParseWorkerBrowserLayer)),
  );

  it.effect("matches a formatted CPF value", () =>
    Effect.gen(function* () {
      const anchors = yield* findAnchorsForText("123.456.789-01");

      expect(anchors).toHaveLength(1);
    }).pipe(Effect.provide(liteParseWorkerBrowserLayer)),
  );
});

describe("PDF text-anchor page identity", () => {
  it.effect("maps sparse unsorted pages through their declared indexes", () =>
    Effect.gen(function* () {
      const anchors = yield* findPdfTextAnchors({
        pages: [
          { index: 2, width: 300, height: 140 },
          { index: 0, width: 220, height: 120 },
        ],
        textBoxes: [
          [{ text: "first page", x: 12, y: 10, width: 100, height: 12 }],
          [],
          [{ text: "third page", x: 30, y: 20, width: 100, height: 12 }],
        ],
        matchers: [{ text: "page" }],
        stampSize,
        placement: "below",
        offset: 0,
      });

      expect(anchors).toStrictEqual([
        { pageIndex: 2, x: 30, y: 32, width: 80, height: 20 },
        { pageIndex: 0, x: 12, y: 22, width: 80, height: 20 },
      ]);
    }).pipe(Effect.provide(liteParseWorkerBrowserLayer)),
  );

  it.effect("rejects text boxes that do not cover declared page indexes", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        findPdfTextAnchors({
          pages: [{ index: 2, width: 300, height: 140 }],
          textBoxes: [[{ text: "third page", x: 30, y: 20, width: 100, height: 12 }]],
          matchers: [{ text: "page" }],
          stampSize,
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe("pdf.INVALID_BUILDER_INPUT");
        expect(result.failure.operation).toBe("pdf.text-anchor.find");
        expect(result.failure.schemaName).toBe("PdfTextAnchorSearchInput");
      }
    }).pipe(Effect.provide(liteParseWorkerBrowserLayer)),
  );
});
