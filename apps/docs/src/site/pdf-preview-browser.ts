import { Effect, Layer, Schema, ScopedCache } from "effect";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "@signature-kit/pdf/config";

import type { PdfError as PdfErrorType } from "@signature-kit/pdf/config";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createPdfStampPreview } from "@signature-kit/pdf/stamp";

import { PdfPreview } from "./pdf-preview.ts";
import { AutoDocuments, AutoPreview } from "./auto-documents.ts";
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

export const makePdfPreview = (
  sourceDocument: (id: string) => Effect.Effect<Uint8Array, PdfErrorType>,
) =>
  Effect.gen(function* () {
    const loadSdk = yield* Effect.cached(Effect.promise(() => import("pdfjs-dist")));
    const openDocument = Effect.fn(function* (data: Uint8Array) {
      const sdk = yield* loadSdk;

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
    });
    const paintPage = Effect.fn(function* (
      document: PDFDocumentProxy,
      pageIndex: number,
      canvas: HTMLCanvasElement,
      scale: number,
    ) {
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
      const viewport = page.getViewport({ scale });
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
    });
    const documents = yield* ScopedCache.make({
      capacity: 8,
      lookup: (id: string) => sourceDocument(id).pipe(Effect.flatMap(openDocument)),
    });
    return PdfPreview.of({
      clear: ScopedCache.invalidateAll(documents),
      remove: (id) => ScopedCache.invalidate(documents, id),
      render: Effect.fn(function* (id, pageIndex, canvas) {
        const document = yield* ScopedCache.get(documents, id);
        yield* paintPage(document, pageIndex, canvas, Math.max(1, window.devicePixelRatio));
      }),
      renderStamp: Effect.fn(function* (badge, canvas) {
        const bytes = yield* createPdfStampPreview({ badge, width: 320, height: 128 });
        const document = yield* openDocument(bytes);
        yield* paintPage(document, 0, canvas, Math.max(2, window.devicePixelRatio));
      }),
    });
  });

export const pdfPreviewBrowserLayer = Layer.effect(
  PdfPreview,
  Effect.gen(function* () {
    const session = yield* SigningSession;
    return yield* makePdfPreview(session.sourceDocument);
  }),
);

export const autoPreviewBrowserLayer = Layer.effect(
  AutoPreview,
  Effect.gen(function* () {
    const documents = yield* AutoDocuments;
    return yield* makePdfPreview(documents.sourceDocument);
  }),
);
