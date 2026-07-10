import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result } from "effect";
import { LiteParseWorkerFactory, parsePdfTextBoxesBrowser } from "../src/liteparse-browser";
import type { LiteParseWorker } from "../src/liteparse-browser";
import {
  MAX_PDF_LITEPARSE_TEXT_ITEM_CHARACTERS,
  MAX_PDF_LITEPARSE_TEXT_ITEMS,
  MAX_PDF_LITEPARSE_TEXT_ITEMS_PER_PAGE,
  MAX_PDF_LITEPARSE_TEXT_UTF8_BYTES,
} from "../src/config";

const injectedLiteParseWorkerLayer = (
  response: unknown,
  timeoutMillis: number,
  onPost: () => void,
  onTerminate: () => void,
) =>
  Layer.succeed(LiteParseWorkerFactory, {
    timeoutMillis,
    create: () =>
      Effect.sync((): LiteParseWorker => {
        let onMessage: ((message: unknown) => void) | undefined;
        return {
          post: () => {
            onPost();
            if (response !== undefined) {
              queueMicrotask(() => onMessage?.({ kind: "success", result: response }));
            }
          },
          subscribe: (nextMessage) => {
            onMessage = nextMessage;
            return () => {
              if (onMessage === nextMessage) onMessage = undefined;
            };
          },
          terminate: onTerminate,
        };
      }),
  });

describe("LiteParse browser boundary", () => {
  it.effect("fails closed on malformed worker success results", () =>
    Effect.gen(function* () {
      const malformedResults = [
        {
          pageCount: 1,
          result: { pages: [{ pageNum: 1.5, textItems: [] }] },
        },
        {
          pageCount: 1,
          result: { pages: [{ pageNum: 2, textItems: [] }] },
        },
        {
          pageCount: 1,
          result: {
            pages: [
              {
                pageNum: Number.NaN,
                textItems: [{ text: "invalid x", x: Number.NaN, y: 0, width: 12, height: 12 }],
              },
            ],
          },
        },
        {
          pageCount: 1,
          result: {
            pages: [
              {
                pageNum: 1,
                textItems: [{ text: "invalid width", x: 0, y: 0, width: 0, height: 12 }],
              },
            ],
          },
        },
        {
          pageCount: 1,
          result: {
            pages: [
              {
                pageNum: 1,
                textItems: [{ text: "invalid height", x: 0, y: 0, width: 12, height: -1 }],
              },
            ],
          },
        },
        {
          pageCount: 1,
          result: {
            pages: [
              {
                pageNum: 1,
                textItems: [
                  {
                    text: "invalid y",
                    x: 0,
                    y: Number.POSITIVE_INFINITY,
                    width: 12,
                    height: 12,
                  },
                ],
              },
            ],
          },
        },
        {
          pageCount: 1,
          result: {
            pages: [
              {
                pageNum: 1,
                textItems: Array.from(
                  { length: MAX_PDF_LITEPARSE_TEXT_ITEMS_PER_PAGE + 1 },
                  () => ({ text: "too many", x: 0, y: 0, width: 12, height: 12 }),
                ),
              },
            ],
          },
        },
        {
          pageCount:
            Math.floor(MAX_PDF_LITEPARSE_TEXT_ITEMS / MAX_PDF_LITEPARSE_TEXT_ITEMS_PER_PAGE) + 1,
          result: {
            pages: Array.from(
              {
                length:
                  Math.floor(MAX_PDF_LITEPARSE_TEXT_ITEMS / MAX_PDF_LITEPARSE_TEXT_ITEMS_PER_PAGE) +
                  1,
              },
              (_, pageIndex) => ({
                pageNum: pageIndex + 1,
                textItems: Array.from({ length: MAX_PDF_LITEPARSE_TEXT_ITEMS_PER_PAGE }, () => ({
                  text: "too many total",
                  x: 0,
                  y: 0,
                  width: 12,
                  height: 12,
                })),
              }),
            ),
          },
        },
        {
          pageCount: 1,
          result: {
            pages: [
              {
                pageNum: 1,
                textItems: [
                  {
                    text: "x".repeat(MAX_PDF_LITEPARSE_TEXT_ITEM_CHARACTERS + 1),
                    x: 0,
                    y: 0,
                    width: 12,
                    height: 12,
                  },
                ],
              },
            ],
          },
        },
        {
          pageCount:
            Math.floor(
              MAX_PDF_LITEPARSE_TEXT_UTF8_BYTES / (MAX_PDF_LITEPARSE_TEXT_ITEM_CHARACTERS * 3),
            ) + 1,
          result: {
            pages: Array.from(
              {
                length:
                  Math.floor(
                    MAX_PDF_LITEPARSE_TEXT_UTF8_BYTES /
                      (MAX_PDF_LITEPARSE_TEXT_ITEM_CHARACTERS * 3),
                  ) + 1,
              },
              (_, pageIndex) => ({
                pageNum: pageIndex + 1,
                textItems: [
                  {
                    text: "€".repeat(MAX_PDF_LITEPARSE_TEXT_ITEM_CHARACTERS),
                    x: 0,
                    y: 0,
                    width: 12,
                    height: 12,
                  },
                ],
              }),
            ),
          },
        },
        {
          pageCount: 2,
          result: { pages: [{ pageNum: 1, textItems: [] }] },
        },
        {
          pageCount: 2,
          result: {
            pages: [
              { pageNum: 1, textItems: [] },
              { pageNum: 1, textItems: [] },
            ],
          },
        },
      ];

      for (const { pageCount, result: malformedResult } of malformedResults) {
        let terminations = 0;
        const result = yield* Effect.result(
          parsePdfTextBoxesBrowser(new Uint8Array([1]), pageCount).pipe(
            Effect.provide(
              injectedLiteParseWorkerLayer(
                malformedResult,
                100,
                () => {},
                () => {
                  terminations += 1;
                },
              ),
            ),
          ),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("pdf.INVALID_PDF");
          expect(result.failure.operation).toBe("pdf.parse");
          expect(result.failure.schemaName).toBe("PdfLiteParseResult");
        }
        expect(terminations).toBe(1);
      }
    }),
  );

  it.effect("maps unordered complete worker pages by page number", () =>
    Effect.gen(function* () {
      let terminations = 0;
      const textBoxes = yield* parsePdfTextBoxesBrowser(new Uint8Array([1]), 2).pipe(
        Effect.provide(
          injectedLiteParseWorkerLayer(
            {
              pages: [
                {
                  pageNum: 2,
                  textItems: [{ text: "second", x: 30, y: 20, width: 100, height: 12 }],
                },
                {
                  pageNum: 1,
                  textItems: [{ text: "first", x: 12, y: 10, width: 80, height: 12 }],
                },
              ],
            },
            100,
            () => {},
            () => {
              terminations += 1;
            },
          ),
        ),
      );

      expect(textBoxes).toStrictEqual([
        [{ text: "first", x: 12, y: 10, width: 80, height: 12 }],
        [{ text: "second", x: 30, y: 20, width: 100, height: 12 }],
      ]);
      expect(terminations).toBe(1);
    }),
  );

  it.effect("rejects malformed injected worker timeouts and terminates their workers", () =>
    Effect.gen(function* () {
      for (const timeoutMillis of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 5001]) {
        let posts = 0;
        let terminations = 0;
        const result = yield* Effect.result(
          parsePdfTextBoxesBrowser(new Uint8Array([1]), 1).pipe(
            Effect.provide(
              injectedLiteParseWorkerLayer(
                undefined,
                timeoutMillis,
                () => {
                  posts += 1;
                },
                () => {
                  terminations += 1;
                },
              ),
            ),
          ),
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe("pdf.INVALID_PDF");
          expect(result.failure.operation).toBe("pdf.parse");
        }
        expect(posts).toBe(0);
        expect(terminations).toBe(1);
      }
    }),
  );
});
