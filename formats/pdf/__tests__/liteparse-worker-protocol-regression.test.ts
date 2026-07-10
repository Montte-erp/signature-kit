import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  hasBoundedPdfLiteParseResult,
  MAX_PDF_LITEPARSE_PAGE_COUNT,
  MAX_PDF_LITEPARSE_TEXT_ITEM_CHARACTERS,
  MAX_PDF_LITEPARSE_TEXT_ITEMS,
  MAX_PDF_LITEPARSE_TEXT_ITEMS_PER_PAGE,
  MAX_PDF_LITEPARSE_TEXT_UTF8_BYTES,
  PdfLiteParseResultSchemaForPageCount,
} from "../src/config";

describe("LiteParse worker transport contract", () => {
  it.effect("accepts complete unordered page identities and rejects malformed shapes", () =>
    Effect.sync(() => {
      const isTransportable = Schema.is(PdfLiteParseResultSchemaForPageCount(2));

      expect(
        isTransportable({
          pages: [
            { pageNum: 2, textItems: [] },
            { pageNum: 1, textItems: [] },
          ],
        }),
      ).toBe(true);
      expect(
        hasBoundedPdfLiteParseResult(
          {
            pages: [
              { pageNum: 2, textItems: [] },
              { pageNum: 1, textItems: [] },
            ],
          },
          2,
        ),
      ).toBe(true);
      expect(
        isTransportable({
          pages: [
            { pageNum: 1, textItems: [] },
            { pageNum: 1, textItems: [] },
          ],
        }),
      ).toBe(false);
    }),
  );

  it.effect("bounds worker pages and text items before transport", () =>
    Effect.sync(() => {
      const isSinglePageTransportable = Schema.is(PdfLiteParseResultSchemaForPageCount(1));

      expect(
        isSinglePageTransportable({
          pages: [
            {
              pageNum: 1,
              textItems: Array.from({ length: MAX_PDF_LITEPARSE_TEXT_ITEMS_PER_PAGE + 1 }, () => ({
                text: "too many",
                x: 0,
                y: 0,
                width: 12,
                height: 12,
              })),
            },
          ],
        }),
      ).toBe(false);

      const oversizedText = "x".repeat(MAX_PDF_LITEPARSE_TEXT_ITEM_CHARACTERS + 1);
      const oversizedTextResult = {
        pages: [
          {
            pageNum: 1,
            textItems: [{ text: oversizedText, x: 0, y: 0, width: 12, height: 12 }],
          },
        ],
      };
      expect(hasBoundedPdfLiteParseResult(oversizedTextResult, 1)).toBe(false);
      expect(isSinglePageTransportable(oversizedTextResult)).toBe(false);

      const totalPageCount =
        Math.floor(MAX_PDF_LITEPARSE_TEXT_ITEMS / MAX_PDF_LITEPARSE_TEXT_ITEMS_PER_PAGE) + 1;
      expect(
        Schema.is(PdfLiteParseResultSchemaForPageCount(totalPageCount))({
          pages: Array.from({ length: totalPageCount }, (_, pageIndex) => ({
            pageNum: pageIndex + 1,
            textItems: Array.from({ length: MAX_PDF_LITEPARSE_TEXT_ITEMS_PER_PAGE }, () => ({
              text: "too many total",
              x: 0,
              y: 0,
              width: 12,
              height: 12,
            })),
          })),
        }),
      ).toBe(false);

      const aggregateText = "€".repeat(MAX_PDF_LITEPARSE_TEXT_ITEM_CHARACTERS);
      const aggregateTextPageCount =
        Math.floor(
          MAX_PDF_LITEPARSE_TEXT_UTF8_BYTES / (MAX_PDF_LITEPARSE_TEXT_ITEM_CHARACTERS * 3),
        ) + 1;
      const aggregateTextResult = {
        pages: Array.from({ length: aggregateTextPageCount }, (_, pageIndex) => ({
          pageNum: pageIndex + 1,
          textItems: [{ text: aggregateText, x: 0, y: 0, width: 12, height: 12 }],
        })),
      };
      expect(hasBoundedPdfLiteParseResult(aggregateTextResult, aggregateTextPageCount)).toBe(false);
      expect(
        Schema.is(PdfLiteParseResultSchemaForPageCount(aggregateTextPageCount))(
          aggregateTextResult,
        ),
      ).toBe(false);

      expect(
        Schema.is(PdfLiteParseResultSchemaForPageCount(MAX_PDF_LITEPARSE_PAGE_COUNT + 1))({
          pages: Array.from({ length: MAX_PDF_LITEPARSE_PAGE_COUNT + 1 }, (_, pageIndex) => ({
            pageNum: pageIndex + 1,
            textItems: [],
          })),
        }),
      ).toBe(false);
    }),
  );
});
