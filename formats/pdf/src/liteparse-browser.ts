import { Context, Duration, Effect, Layer, Schema } from "effect";

import {
  PdfError,
  PdfErrorCodeValue,
  hasBoundedPdfLiteParseResult,
  PdfLiteParseResultSchemaForPageCount,
  PdfOperationValue,
  PdfSchemaNameValue,
} from "./config";
import type { PdfTextBox } from "./config";
import {
  LiteParseWorkerRequestSchema,
  LiteParseWorkerSuccessSchema,
} from "./liteparse-browser-protocol";
import type { LiteParseWorkerRequest } from "./liteparse-browser-protocol";
import { textBoxesFromLiteParseResult } from "./stamp";

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
        let unsubscribe: (() => void) | undefined;

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
          unsubscribe?.();
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
        unsubscribe = subscribed;

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
        reason: "LiteParse worker failed while parsing PDF text boxes.",
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
      return yield* Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.invalidPdf,
          retryable: false,
          operation: PdfOperationValue.parse,
          schemaName: PdfSchemaNameValue.pdfLiteParseResult,
          reason: "LiteParse WASM returned an invalid text-box result.",
        }),
      );
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
