import { Effect, Layer, Schema, ScopedCache } from "effect";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "@signature-kit/pdf/config";

import { PdfPreview } from "./pdf-preview.ts";
import { SigningSession } from "./signing-session.ts";

const PdfJsException = Schema.Struct({
  name: Schema.Literals([
    "InvalidPDFException",
    "MissingPDFException",
    "UnexpectedResponseException",
    "PasswordException",
    "RenderingCancelledException",
    "UnknownErrorException",
  ]),
  message: Schema.String,
});

export const pdfPreviewBrowserLayer = Layer.effect(
  PdfPreview,
  Effect.gen(function* () {
    const session = yield* SigningSession;
    const loadSdk = yield* Effect.cached(Effect.promise(() => import("pdfjs-dist")));
    const documents = yield* ScopedCache.make({
      capacity: 8,
      lookup: Effect.fn(function* (id: string) {
        const sdk = yield* loadSdk;

        const data = yield* session.sourceDocument(id);
        const port = yield* Effect.acquireRelease(
          Effect.sync(
            () =>
              new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
                type: "module",
              }),
          ),
          (worker) => Effect.sync(() => worker.terminate()),
        );
        const worker = yield* Effect.acquireRelease(
          Effect.sync(() => sdk.PDFWorker.create({ port })),
          (worker) => Effect.sync(() => worker.destroy()),
        );
        const loading = yield* Effect.acquireRelease(
          Effect.sync(() => sdk.getDocument({ data, worker })),
          (task) => Effect.promise(() => task.destroy()),
        );

        return yield* Effect.tryPromise(() => loading.promise).pipe(
          Effect.catch((error) =>
            Schema.decodeUnknownEffect(PdfJsException)(error.cause).pipe(
              Effect.matchEffect({
                onFailure: () => Effect.die(error.cause),
                onSuccess: (issue) =>
                  Effect.fail(
                    new PdfError({
                      code: PdfErrorCodeValue.pdfLoadFailed,
                      retryable: true,
                      operation: PdfOperationValue.loadDocument,
                      reason: "The browser could not open the PDF preview.",
                      issueMessage: issue.message,
                    }),
                  ),
              }),
            ),
          ),
        );
      }),
    });
    return PdfPreview.of({
      clear: ScopedCache.invalidateAll(documents),
      remove: (id) => ScopedCache.invalidate(documents, id),
      render: Effect.fn(function* (id, pageIndex, canvas) {
        const document = yield* ScopedCache.get(documents, id);

        const page = yield* Effect.tryPromise(() => document.getPage(pageIndex + 1)).pipe(
          Effect.catch((error) =>
            Schema.decodeUnknownEffect(PdfJsException)(error.cause).pipe(
              Effect.matchEffect({
                onFailure: () => Effect.die(error.cause),
                onSuccess: (issue) =>
                  Effect.fail(
                    new PdfError({
                      code: PdfErrorCodeValue.pdfLoadFailed,
                      retryable: true,
                      operation: PdfOperationValue.loadDocument,
                      reason: "The browser could not load the selected PDF page.",
                      issueMessage: issue.message,
                    }),
                  ),
              }),
            ),
          ),
        );
        const viewport = page.getViewport({ scale: Math.max(1, window.devicePixelRatio) });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext("2d");
        if (context === null) return yield* Effect.die("PDF preview requires a canvas 2D context");
        const rendering = yield* Effect.acquireRelease(
          Effect.sync(() => page.render({ canvas, canvasContext: context, viewport })),
          (task) => Effect.sync(() => task.cancel()),
        );
        yield* Effect.tryPromise(() => rendering.promise).pipe(
          Effect.catch((error) =>
            Schema.decodeUnknownEffect(PdfJsException)(error.cause).pipe(
              Effect.matchEffect({
                onFailure: () => Effect.die(error.cause),
                onSuccess: (issue) =>
                  Effect.fail(
                    new PdfError({
                      code: PdfErrorCodeValue.pdfLoadFailed,
                      retryable: true,
                      operation: PdfOperationValue.loadDocument,
                      reason: "The browser could not render the selected PDF page.",
                      issueMessage: issue.message,
                    }),
                  ),
              }),
            ),
          ),
        );
      }),
    });
  }),
);
