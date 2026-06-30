import LiteParse from "@llamaindex/liteparse";
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

export const parsePdfTextBoxesNode = (
  pdf: Uint8Array,
  pageCount: number,
): Effect.Effect<ReadonlyArray<ReadonlyArray<PdfTextBox>>, PdfError> =>
  Effect.gen(function* () {
    const parsedUnknown = yield* Effect.tryPromise({
      try: () =>
        new LiteParse({
          maxPages: pageCount,
          ocrEnabled: false,
          outputFormat: "json",
          preserveVerySmallText: true,
          quiet: true,
        }).parse(pdf.slice()),
      catch: () =>
        new PdfError({
          code: PdfErrorCodeValue.pdfLoadFailed,
          retryable: false,
          operation: PdfOperationValue.parse,
          reason: "LiteParse Node failed to parse PDF text boxes.",
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
              reason: "LiteParse Node timed out while parsing PDF text boxes.",
            }),
          ),
      }),
    );

    const parsed = yield* Schema.decodeUnknownEffect(PdfLiteParseResultSchema)(parsedUnknown).pipe(
      Effect.mapError(
        () =>
          new PdfError({
            code: PdfErrorCodeValue.invalidPdf,
            retryable: false,
            operation: PdfOperationValue.parse,
            schemaName: PdfSchemaNameValue.pdfLiteParseResult,
            reason: "LiteParse Node returned an invalid text-box result.",
          }),
      ),
    );

    return textBoxesFromLiteParseResult(parsed, pageCount);
  });
