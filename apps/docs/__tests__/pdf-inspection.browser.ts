import { Array as EffectArray, Effect } from "effect";
import * as PdfJs from "pdfjs-dist";

export const inspectPdf = Effect.fn(function* (bytes: Uint8Array) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const port = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
              type: "module",
            }),
        ),
        (port) => Effect.sync(() => port.terminate()),
      );
      const worker = yield* Effect.acquireRelease(
        Effect.sync(() => PdfJs.PDFWorker.create({ port })),
        (worker) => Effect.sync(() => worker.destroy()),
      );
      const loading = yield* Effect.acquireRelease(
        Effect.sync(() => PdfJs.getDocument({ data: new Uint8Array(bytes), worker })),
        (task) => Effect.promise(() => task.destroy()),
      );
      const document = yield* Effect.promise(() => loading.promise);
      return yield* Effect.forEach(EffectArray.range(1, document.numPages), (number) =>
        Effect.scoped(
          Effect.gen(function* () {
            const page = yield* Effect.promise(() => document.getPage(number));
            const text = yield* Effect.promise(() => page.getTextContent());
            const canvas = yield* Effect.acquireRelease(
              Effect.sync(() => window.document.createElement("canvas")),
              (canvas) =>
                Effect.sync(() => {
                  canvas.width = 0;
                  canvas.height = 0;
                }),
            );
            const viewport = page.getViewport({ scale: 1 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext("2d");
            if (context === null)
              return yield* Effect.die("PDF inspection requires a canvas 2D context");
            const rendering = yield* Effect.acquireRelease(
              Effect.sync(() => page.render({ canvas, canvasContext: context, viewport })),
              (task) => Effect.sync(() => task.cancel()),
            );
            yield* Effect.promise(() => rendering.promise);
            return {
              text: text.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" "),
              image: context.getImageData(0, 0, canvas.width, canvas.height),
            };
          }),
        ),
      );
    }),
  );
});
