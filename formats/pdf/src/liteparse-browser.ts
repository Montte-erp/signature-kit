import { Context, Duration, Effect, Layer, Schema } from "effect";

import {
  PdfError,
  PdfErrorCodeValue,
  hasBoundedPdfLiteParseResult,
  PdfLiteParseResultSchemaForPageCount,
  PdfOperationValue,
  PdfSchemaNameValue,
} from "./config.js";
import type { PdfTextBox } from "./config.js";
import {
  LiteParseWorkerRequestSchema,
  LiteParseWorkerSuccessSchema,
} from "./liteparse-browser-protocol.js";
import type { LiteParseWorkerRequest } from "./liteparse-browser-protocol.js";
import { textBoxesFromLiteParseResult } from "./stamp.js";

const LITEPARSE_TIMEOUT_MILLIS = 5000;
const liteParseTimeoutMillisSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(LITEPARSE_TIMEOUT_MILLIS),
);

export type LiteParseWorker = {
  readonly post: (request: LiteParseWorkerRequest) => void;
  readonly subscribe: (onMessage: (message: unknown) => void, onError: () => void) => () => void;
  readonly terminate: () => void;
};

export type LiteParseWorkerFactoryService = {
  readonly create: () => Effect.Effect<LiteParseWorker, PdfError>;
  readonly timeoutMillis: number;
};

export class LiteParseWorkerFactory extends Context.Service<
  LiteParseWorkerFactory,
  LiteParseWorkerFactoryService
>()("@signature-kit/pdf/LiteParseWorkerFactory") {}

const createLiteParseWorker = (): Effect.Effect<LiteParseWorker, PdfError> =>
  Effect.try({
    try: () => {
      const worker = new Worker(new URL("./liteparse-browser.worker.js", import.meta.url), {
        type: "module",
      });
      return {
        post: (request) => worker.postMessage(request),
        subscribe: (onMessage, onError) => {
          const messageListener = (event: MessageEvent<unknown>): void => onMessage(event.data);
          const errorListener = (): void => onError();
          worker.addEventListener("message", messageListener);
          worker.addEventListener("error", errorListener);
          return () => {
            worker.removeEventListener("message", messageListener);
            worker.removeEventListener("error", errorListener);
          };
        },
        terminate: () => worker.terminate(),
      };
    },
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.pdfLoadFailed,
        retryable: false,
        operation: PdfOperationValue.parse,
        reason: "LiteParse worker failed to start.",
      }),
  });

export const liteParseWorkerBrowserLayer = Layer.succeed(LiteParseWorkerFactory, {
  create: createLiteParseWorker,
  timeoutMillis: LITEPARSE_TIMEOUT_MILLIS,
});

type LiteParseWorkerSession = {
  readonly worker: LiteParseWorker;
  readonly terminate: () => void;
};

const workerSession = (worker: LiteParseWorker): LiteParseWorkerSession => {
  let terminated = false;
  return {
    worker,
    terminate: () => {
      if (terminated) return;
      terminated = true;
      worker.terminate();
    },
  };
};

const isLiteParseWorkerSuccess = Schema.is(LiteParseWorkerSuccessSchema);

const parseLiteParseWorker = (
  session: LiteParseWorkerSession,
  request: LiteParseWorkerRequest,
): Effect.Effect<unknown, PdfError> =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<unknown>((resolve, reject) => {
        let settled = false;
        const subscription: { unsubscribe?: () => void } = {};

        function onAbort(): void {
          finish(() => {
            session.terminate();
            reject(undefined);
          });
        }

        function finish(callback: () => void): void {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          subscription.unsubscribe?.();
          callback();
        }

        const subscribed = session.worker.subscribe(
          (message) =>
            finish(() => {
              if (isLiteParseWorkerSuccess(message)) {
                resolve(message.result);
              } else {
                reject(undefined);
              }
            }),
          () => finish(() => reject(undefined)),
        );
        if (settled) {
          subscribed();
          return;
        }
        subscription.unsubscribe = subscribed;

        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        void Promise.resolve()
          .then(() => {
            if (!settled) session.worker.post(request);
          })
          .then(undefined, () => finish(() => reject(undefined)));
      }),
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.pdfLoadFailed,
        retryable: false,
        operation: PdfOperationValue.parse,
        reason:
          request.screenshots === true
            ? "LiteParse worker failed while rendering PDF pages."
            : "LiteParse worker failed while parsing PDF text boxes.",
      }),
  });

export const parsePdfTextBoxesBrowser = (
  pdf: Uint8Array,
  pageCount: number,
): Effect.Effect<ReadonlyArray<ReadonlyArray<PdfTextBox>>, PdfError, LiteParseWorkerFactory> =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknownEffect(LiteParseWorkerRequestSchema)({
      pdf,
      pageCount,
    }).pipe(
      Effect.mapError(
        (issue) =>
          new PdfError({
            code: PdfErrorCodeValue.invalidPdf,
            retryable: false,
            operation: PdfOperationValue.parse,
            reason:
              "LiteParse page count must be a finite non-negative integer within the supported limit.",
            issueMessage: String(issue),
          }),
      ),
    );
    const workerFactory = yield* LiteParseWorkerFactory;
    const parsedUnknown = yield* Effect.scoped(
      Effect.gen(function* () {
        const session = yield* Effect.acquireRelease(
          workerFactory.create().pipe(Effect.map(workerSession)),
          (current) => Effect.sync(() => current.terminate()),
        );
        const timeoutMillis = yield* Schema.decodeUnknownEffect(liteParseTimeoutMillisSchema)(
          workerFactory.timeoutMillis,
        ).pipe(
          Effect.mapError(
            (issue) =>
              new PdfError({
                code: PdfErrorCodeValue.invalidPdf,
                retryable: false,
                operation: PdfOperationValue.parse,
                reason:
                  "LiteParse worker timeout must be finite, positive, and no longer than 5000ms.",
                issueMessage: String(issue),
              }),
          ),
        );
        return yield* parseLiteParseWorker(session, request).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(timeoutMillis),
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
      }),
    );
    if (!hasBoundedPdfLiteParseResult(parsedUnknown, request.pageCount)) {
      return yield* new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        operation: PdfOperationValue.parse,
        schemaName: PdfSchemaNameValue.pdfLiteParseResult,
        reason: "LiteParse WASM returned an invalid text-box result.",
      });
    }
    const parsed = yield* Schema.decodeUnknownEffect(
      PdfLiteParseResultSchemaForPageCount(request.pageCount),
    )(parsedUnknown).pipe(
      Effect.mapError(
        (issue) =>
          new PdfError({
            code: PdfErrorCodeValue.invalidPdf,
            retryable: false,
            operation: PdfOperationValue.parse,
            schemaName: PdfSchemaNameValue.pdfLiteParseResult,
            reason: "LiteParse WASM returned an invalid text-box result.",
            issueMessage: String(issue),
          }),
      ),
    );
    return textBoxesFromLiteParseResult(parsed);
  });

const PdfPageScreenshotsSchema = Schema.Struct({
  screenshots: Schema.Array(
    Schema.Struct({
      pageNum: Schema.Int.check(Schema.isGreaterThan(0)),
      imageBytes: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))),
    }),
  ),
});

export type PdfPageScreenshot = (typeof PdfPageScreenshotsSchema)["Type"]["screenshots"][number];

export const renderPdfPagesBrowser = (
  pdf: Uint8Array,
  pageCount: number,
): Effect.Effect<ReadonlyArray<PdfPageScreenshot>, PdfError, LiteParseWorkerFactory> =>
  Effect.gen(function* () {
    const request = yield* Schema.decodeUnknownEffect(LiteParseWorkerRequestSchema)({
      pdf,
      pageCount,
      screenshots: true,
    }).pipe(
      Effect.mapError(
        (issue) =>
          new PdfError({
            code: PdfErrorCodeValue.invalidPdf,
            retryable: false,
            operation: PdfOperationValue.parse,
            reason: "Invalid PDF preview request.",
            issueMessage: String(issue),
          }),
      ),
    );
    const factory = yield* LiteParseWorkerFactory;
    const timeoutMillis = yield* Schema.decodeUnknownEffect(liteParseTimeoutMillisSchema)(
      factory.timeoutMillis,
    ).pipe(
      Effect.mapError(
        (issue) =>
          new PdfError({
            code: PdfErrorCodeValue.invalidPdf,
            retryable: false,
            operation: PdfOperationValue.parse,
            reason: "LiteParse worker timeout must be finite, positive, and no longer than 5000ms.",
            issueMessage: String(issue),
          }),
      ),
    );
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const session = yield* Effect.acquireRelease(
          factory.create().pipe(Effect.map(workerSession)),
          (current) => Effect.sync(() => current.terminate()),
        );
        return yield* parseLiteParseWorker(session, request).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(timeoutMillis),
            orElse: () =>
              Effect.fail(
                new PdfError({
                  code: PdfErrorCodeValue.pdfLoadFailed,
                  retryable: true,
                  operation: PdfOperationValue.parse,
                  reason: "PDF preview timed out.",
                }),
              ),
          }),
        );
      }),
    );
    const parsed = yield* Schema.decodeUnknownEffect(PdfPageScreenshotsSchema)(result).pipe(
      Effect.mapError(
        (issue) =>
          new PdfError({
            code: PdfErrorCodeValue.invalidPdf,
            retryable: false,
            operation: PdfOperationValue.parse,
            reason: "Invalid PDF preview result.",
            issueMessage: String(issue),
          }),
      ),
    );
    if (
      parsed.screenshots.length !== pageCount ||
      parsed.screenshots.some(
        (image, index) => image.pageNum !== index + 1 || image.imageBytes.length === 0,
      )
    ) {
      return yield* new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        operation: PdfOperationValue.parse,
        reason: "PDF preview pages are incomplete.",
      });
    }
    return parsed.screenshots;
  });

export class PdfHandwriting extends Context.Service<
  PdfHandwriting,
  { readonly render: (text: string) => Effect.Effect<Uint8Array, PdfError> }
>()("@signature-kit/pdf/PdfHandwriting") {}

export const pdfHandwritingBrowserLayer = (font: string) =>
  Layer.succeed(PdfHandwriting, {
    render: (text) =>
      Effect.gen(function* () {
        const value = yield* Schema.decodeUnknownEffect(
          Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
        )(text.trim()).pipe(
          Effect.mapError(
            (issue) =>
              new PdfError({
                code: PdfErrorCodeValue.stampFailed,
                retryable: false,
                operation: PdfOperationValue.stamp,
                reason: "Handwritten signature text is invalid.",
                issueMessage: String(issue),
              }),
          ),
        );
        yield* Effect.tryPromise({
          try: () => document.fonts.load(font, value),
          catch: () =>
            new PdfError({
              code: PdfErrorCodeValue.stampFailed,
              retryable: false,
              operation: PdfOperationValue.stamp,
              reason: "Handwriting font could not be loaded.",
            }),
        }).pipe(
          Effect.filterOrFail(
            (faces) => faces.length > 0,
            () =>
              new PdfError({
                code: PdfErrorCodeValue.stampFailed,
                retryable: false,
                operation: PdfOperationValue.stamp,
                reason: "Handwriting font is unavailable.",
              }),
          ),
        );
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (context === null)
          return yield* new PdfError({
            code: PdfErrorCodeValue.stampFailed,
            retryable: false,
            operation: PdfOperationValue.stamp,
            reason: "Handwriting canvas is unavailable.",
          });
        context.font = font;
        const metrics = context.measureText(value);
        canvas.width = Math.ceil(Math.min(4096, Math.max(64, metrics.width + 48)) * 2);
        canvas.height = 200;
        context.scale(2, 2);
        context.font = font;
        context.fillStyle = "#111111";
        context.textBaseline = "middle";
        context.fillText(value, 24, 50, 2000);
        const dataUrl = yield* Effect.try({
          try: () => canvas.toDataURL("image/png"),
          catch: () =>
            new PdfError({
              code: PdfErrorCodeValue.stampFailed,
              retryable: false,
              operation: PdfOperationValue.stamp,
              reason: "Handwriting PNG could not be generated.",
            }),
        });
        const prefix = "data:image/png;base64,";
        if (!dataUrl.startsWith(prefix) || dataUrl.length === prefix.length) {
          return yield* new PdfError({
            code: PdfErrorCodeValue.stampFailed,
            retryable: false,
            operation: PdfOperationValue.stamp,
            reason: "Handwriting canvas returned no PNG data.",
          });
        }
        return yield* Effect.try({
          try: () =>
            Uint8Array.from(atob(dataUrl.slice(prefix.length)), (character) =>
              character.charCodeAt(0),
            ),
          catch: () =>
            new PdfError({
              code: PdfErrorCodeValue.stampFailed,
              retryable: false,
              operation: PdfOperationValue.stamp,
              reason: "Handwriting PNG could not be decoded.",
            }),
        });
      }),
  });
