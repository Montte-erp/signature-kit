import initLiteParseWasm, { LiteParse } from "@llamaindex/liteparse-wasm";
import { Duration, Effect, Schema } from "effect";

import {
  type PdfTextBox,
  PdfError,
  PdfErrorCodeValue,
  PdfLiteParseResultSchema,
  PdfOperationValue,
  PdfSchemaNameValue,
} from "./config";
import { textBoxesFromLiteParseResult } from "./stamp";

const LITEPARSE_TIMEOUT_MILLIS = 5000;

const initLiteParse = Effect.tryPromise({
  try: () => initLiteParseWasm(),
  catch: () =>
    new PdfError({
      code: PdfErrorCodeValue.pdfLoadFailed,
      retryable: false,
      operation: PdfOperationValue.parse,
      reason: "LiteParse WASM failed to initialize.",
    }),
});

export const parsePdfTextBoxesBrowser = (
  pdf: Uint8Array,
  pageCount: number,
): Effect.Effect<ReadonlyArray<ReadonlyArray<PdfTextBox>>, PdfError> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* initLiteParse;
      const parser = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new LiteParse({
              ocrEnabled: false,
              maxPages: pageCount,
              outputFormat: "json",
              preserveVerySmallText: true,
              quiet: true,
            }),
        ),
        (parser) => Effect.sync(() => parser.free()),
      );
      const parsedUnknown = yield* Effect.tryPromise({
        try: () => parser.parse(pdf.slice()),
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.pdfLoadFailed,
            retryable: false,
            operation: PdfOperationValue.parse,
            reason: "LiteParse WASM failed to parse PDF text boxes.",
          }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(LITEPARSE_TIMEOUT_MILLIS),
          orElse: () =>
            Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.pdfLoadFailed,
                retryable: true,
                operation: PdfOperationValue.parse,
                reason: "LiteParse WASM timed out while parsing PDF text boxes.",
              }),
            ),
        }),
      );
      const parsed = yield* Schema.decodeUnknownEffect(PdfLiteParseResultSchema)(
        parsedUnknown,
      ).pipe(
        Effect.mapError(
          () =>
            new PdfError({
              code: PdfErrorCodeValue.invalidPdf,
              retryable: false,
              operation: PdfOperationValue.parse,
              schemaName: PdfSchemaNameValue.pdfLiteParseResult,
              reason: "LiteParse WASM returned an invalid text-box result.",
            }),
        ),
      );
      return textBoxesFromLiteParseResult(parsed, pageCount);
    }),
  );
