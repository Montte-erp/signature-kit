import type { Layer } from "effect";
import { Effect, Exit } from "effect";
import type { PdfError, PdfSignatureBadge } from "@signature-kit/pdf/config";
import { PdfWorker } from "@signature-kit/pdf/worker";
import { pdfWorkerBrowserLayer } from "@signature-kit/pdf/worker-browser";
import { loadPdfjs } from "./pdf-page";
import { m } from "@/lib/client-messages";

export function PdfStampPreview({
  badge,
  preparationLayer,
  width = 320,
  height = 128,
}: {
  readonly badge: PdfSignatureBadge;
  readonly width?: number;
  readonly height?: number;
  readonly preparationLayer?: Layer.Layer<PdfWorker, PdfError>;
}) {
  return (
    <canvas
      role="img"
      aria-label={m.signer_stamp_preview()}
      className="w-full rounded-md border border-border bg-white"
      ref={(canvas) => {
        if (canvas === null) return;
        const controller = new AbortController();
        canvas.dataset.state = "loading";
        canvas.setAttribute("aria-label", m.signer_stamp_preview());
        const render = Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.sleep("150 millis");
            const worker = yield* PdfWorker;
            const bytes = yield* worker.preview({ badge, width, height });
            const pdfjs = yield* Effect.promise(loadPdfjs);
            const loading = yield* Effect.acquireRelease(
              Effect.sync(() => pdfjs.getDocument({ data: bytes })),
              (task) => Effect.promise(() => task.destroy?.() ?? Promise.resolve()),
            );
            const document = yield* Effect.promise(() => loading.promise);
            const page = yield* Effect.promise(() => document.getPage(1));
            const viewport = page.getViewport({ scale: 2 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext("2d");
            if (context === null)
              return yield* Effect.die("Stamp preview requires a canvas 2D context.");
            const task = yield* Effect.acquireRelease(
              Effect.sync(() => page.render({ canvasContext: context, viewport })),
              (rendering) => Effect.sync(() => rendering.cancel()),
            );
            yield* Effect.promise(() => task.promise);
            canvas.dataset.state = "ready";
          }),
        ).pipe(
          Effect.provide(preparationLayer ?? pdfWorkerBrowserLayer()),
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (controller.signal.aborted || Exit.isSuccess(exit)) return;
              canvas.dataset.state = "error";
              canvas.setAttribute("aria-label", m.signer_stamp_preview_failed());
              canvas.width = 640;
              canvas.height = 256;
              const context = canvas.getContext("2d");
              if (context === null) return;
              context.fillStyle = "#FFFFFF";
              context.fillRect(0, 0, canvas.width, canvas.height);
              context.fillStyle = "#374151";
              context.font = "18px sans-serif";
              context.fillText(m.signer_stamp_preview_failed(), 24, 128, 592);
            }),
          ),
        );
        void Effect.runPromiseExit(render, { signal: controller.signal });
        return () => controller.abort();
      }}
    />
  );
}
