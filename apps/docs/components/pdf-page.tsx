import { PenLine } from "lucide-react";
import { pdfjs } from "react-pdf";
import * as React from "react";
import { Effect } from "effect";

import { m } from "@/lib/client-messages";

export interface PdfViewport {
  readonly width: number;
  readonly height: number;
  readonly scale?: number;
}

export interface PdfRenderTask {
  readonly promise: Promise<void>;
  cancel(): void;
}

export type PdfPageRenderErrorCode =
  | "pdf-page-load-failed"
  | "pdf-page-canvas-context-failed"
  | "pdf-page-viewport-failed"
  | "pdf-page-render-failed";

export type PdfPageRenderError = {
  readonly _tag: "PdfPageRenderError";
  readonly code: PdfPageRenderErrorCode;
  readonly message: string;
  readonly cause: unknown;
};

export interface PdfPageProxy {
  getViewport(options: { readonly scale: number }): PdfViewport;
  render(options: {
    readonly canvasContext: CanvasRenderingContext2D;
    readonly viewport: PdfViewport;
  }): PdfRenderTask;
}

const pdfPageRenderErrorMessages: Record<PdfPageRenderErrorCode, () => string> = {
  "pdf-page-load-failed": () => m.signer_pdf_page_error_load(),
  "pdf-page-canvas-context-failed": () => m.signer_pdf_page_error_canvas(),
  "pdf-page-viewport-failed": () => m.signer_pdf_page_error_viewport(),
  "pdf-page-render-failed": () => m.signer_pdf_page_error_render(),
};

const makePdfPageRenderError = (
  code: PdfPageRenderErrorCode,
  cause: unknown,
): PdfPageRenderError => ({
  _tag: "PdfPageRenderError",
  code,
  message: pdfPageRenderErrorMessages[code](),
  cause,
});

const isPdfPageRenderError = (error: unknown): error is PdfPageRenderError =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "PdfPageRenderError";

const normalizePdfPageRenderError = (error: unknown): PdfPageRenderError =>
  isPdfPageRenderError(error) ? error : makePdfPageRenderError("pdf-page-render-failed", error);

const tryCanvasContext = (
  canvas: HTMLCanvasElement,
): Effect.Effect<CanvasRenderingContext2D, PdfPageRenderError> =>
  Effect.try({
    try: () => {
      const context = canvas.getContext("2d");
      if (context === null) {
        throw new Error("CanvasRenderingContext2D is unavailable.");
      }
      return context;
    },
    catch: (cause) => makePdfPageRenderError("pdf-page-canvas-context-failed", cause),
  });

const renderPdfPageCanvas = (
  canvas: HTMLCanvasElement,
  doc: PdfDocumentProxy,
  pageNumber: number,
  lifecycle: PdfCanvasRenderLifecycle,
): Effect.Effect<void, PdfPageRenderError> =>
  Effect.gen(function* () {
    const page = yield* Effect.tryPromise({
      try: () => doc.getPage(pageNumber),
      catch: (cause) => makePdfPageRenderError("pdf-page-load-failed", cause),
    });
    if (!lifecycle.active) return;

    const context = yield* tryCanvasContext(canvas);
    const viewport = yield* Effect.try({
      try: () => {
        const nextViewport = page.getViewport({ scale: 2 });
        canvas.width = nextViewport.width;
        canvas.height = nextViewport.height;
        return nextViewport;
      },
      catch: (cause) => makePdfPageRenderError("pdf-page-viewport-failed", cause),
    });
    const task = yield* Effect.try({
      try: () => page.render({ canvasContext: context, viewport }),
      catch: (cause) => makePdfPageRenderError("pdf-page-render-failed", cause),
    });
    lifecycle.task = task;
    yield* Effect.tryPromise({
      try: () => task.promise,
      catch: (cause) => makePdfPageRenderError("pdf-page-render-failed", cause),
    });
  });

export interface PdfDocumentProxy {
  readonly numPages?: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
  destroy?(): Promise<void>;
}

export interface PdfLoadingTask {
  readonly promise: Promise<PdfDocumentProxy>;
  destroy?(): Promise<void>;
}

type PdfJsApi = {
  getDocument(options: { readonly data: Uint8Array }): PdfLoadingTask;
};

type PdfCanvasRenderLifecycle = {
  active: boolean;
  task?: PdfRenderTask;
};

const QR_PREVIEW_CELLS = Array.from({ length: 25 }, (_item, index) => index);
const QR_PREVIEW_DARK_CELLS = [0, 1, 2, 4, 5, 7, 9, 10, 12, 14, 15, 17, 19, 20, 22, 23, 24];

export const loadPdfjs = async (): Promise<PdfJsApi> => {
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }

  return {
    getDocument: (options) => {
      const task = pdfjs.getDocument({ data: options.data });
      return {
        promise: task.promise.then((doc) => ({
          numPages: doc.numPages,
          getPage: (pageNumber) =>
            doc.getPage(pageNumber).then((page) => ({
              getViewport: (viewportOptions) => {
                const viewport = page.getViewport(viewportOptions);
                return {
                  width: viewport.width,
                  height: viewport.height,
                  scale: viewportOptions.scale,
                };
              },
              render: (renderOptions) =>
                page.render({
                  canvas: null,
                  canvasContext: renderOptions.canvasContext,
                  viewport: page.getViewport({ scale: renderOptions.viewport.scale ?? 1 }),
                }),
            })),
          destroy: () => doc.destroy(),
        })),
        destroy: () => task.destroy(),
      };
    },
  };
};

export interface PageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfPageProps {
  doc: PdfDocumentProxy;
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  marker?: PageRect;
  ghost?: { rect: PageRect; label: string };
  stampPreview?: { inkDataUrl?: string; rubricaDataUrl?: string; lines: string[]; qr?: boolean };
  disabled?: boolean;
  onPlace: (fracX: number, fracY: number) => void;
  onError?: (error: PdfPageRenderError) => void;
}

export function PdfPage({
  doc,
  pageNumber,
  widthPt,
  heightPt,
  marker,
  ghost,
  stampPreview,
  onPlace,
  onError,
  disabled,
}: PdfPageProps) {
  const [renderError, setRenderError] = React.useState<PdfPageRenderError | null>(null);
  const pointerState = React.useRef<
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        canceled: boolean;
      }
    | undefined
  >(undefined);
  const reportError = React.useCallback(
    (error: PdfPageRenderError) => {
      setRenderError(error);
      onError?.(error);
    },
    [onError],
  );

  const renderCanvas = React.useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas === null) return;
      const lifecycle: PdfCanvasRenderLifecycle = { active: true };
      setRenderError(null);
      void Effect.runPromise(renderPdfPageCanvas(canvas, doc, pageNumber, lifecycle)).then(
        () => undefined,
        (error: unknown) => {
          if (lifecycle.active) reportError(normalizePdfPageRenderError(error));
        },
      );
      return () => {
        lifecycle.active = false;
        lifecycle.task?.cancel();
      };
    },
    [doc, pageNumber, reportError],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    pointerState.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      canceled: false,
    };
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointerState.current;
    if (pointer === undefined || pointer.pointerId !== event.pointerId || pointer.canceled) return;
    const deltaX = event.clientX - pointer.clientX;
    const deltaY = event.clientY - pointer.clientY;
    if (deltaX * deltaX + deltaY * deltaY > 64) pointer.canceled = true;
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerState.current?.pointerId === event.pointerId) pointerState.current = undefined;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointerState.current;
    pointerState.current = undefined;
    if (
      pointer === undefined ||
      pointer.pointerId !== event.pointerId ||
      pointer.canceled ||
      disabled
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    onPlace(
      clamp((event.clientX - bounds.left) / bounds.width),
      clamp((event.clientY - bounds.top) / bounds.height),
    );
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const STEP = 0.02;
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    const current = marker
      ? {
          x: (marker.x + marker.width / 2) / widthPt,
          y: (marker.y + marker.height / 2) / heightPt,
        }
      : { x: 0.5, y: 0.5 };

    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault();
        onPlace(current.x, current.y);
        return;
      case "ArrowLeft":
        event.preventDefault();
        onPlace(clamp(current.x - STEP), current.y);
        return;
      case "ArrowRight":
        event.preventDefault();
        onPlace(clamp(current.x + STEP), current.y);
        return;
      case "ArrowUp":
        event.preventDefault();
        onPlace(current.x, clamp(current.y - STEP));
        return;
      case "ArrowDown":
        event.preventDefault();
        onPlace(current.x, clamp(current.y + STEP));
        return;
      default:
        return;
    }
  };

  const previewLines = stampPreview?.lines.map((line, i) => ({ key: `${i}:${line}`, text: line }));

  const placementLabel = m.signer_aria_page_placement({ page: pageNumber });
  const disabledLabel = m.signer_pdf_page_placement_disabled();
  const markerLabelStyle = marker
    ? {
        left: `${(marker.x / widthPt) * 100}%`,
        top: `${(marker.y / heightPt) * 100}%`,
      }
    : undefined;
  const ghostLabelStyle = ghost
    ? {
        left: `${(ghost.rect.x / widthPt) * 100}%`,
        top: `${(ghost.rect.y / heightPt) * 100}%`,
      }
    : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled || undefined}
      aria-label={disabled ? `${placementLabel} ${disabledLabel}` : placementLabel}
      className={`group relative w-full rounded-md border border-transparent outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
        disabled ? "cursor-not-allowed" : "cursor-crosshair"
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
      onPointerCancel={handlePointerCancel}
      style={{ aspectRatio: `${widthPt} / ${heightPt}` }}
    >
      <div className="relative h-full w-full overflow-hidden rounded-md border border-border bg-white">
        <canvas ref={renderCanvas} aria-hidden className="block h-auto w-full select-none" />
        {renderError ? (
          <p
            role="alert"
            data-pdf-render-error={renderError.code}
            className="p-3 text-sm text-destructive"
          >
            {renderError.message}
          </p>
        ) : null}
        {ghost ? (
          <div
            aria-hidden
            className="pointer-events-none absolute flex flex-col items-center justify-center overflow-hidden rounded-sm border border-dashed border-foreground/40 bg-white/70 p-0.5 opacity-70"
            style={{
              left: `${(ghost.rect.x / widthPt) * 100}%`,
              top: `${(ghost.rect.y / heightPt) * 100}%`,
              width: `${(ghost.rect.width / widthPt) * 100}%`,
              height: `${(ghost.rect.height / heightPt) * 100}%`,
            }}
          >
            {(stampPreview?.rubricaDataUrl ?? stampPreview?.inkDataUrl) ? (
              <img
                src={stampPreview?.rubricaDataUrl ?? stampPreview?.inkDataUrl}
                alt=""
                className="max-h-[80%] w-auto object-contain opacity-70"
              />
            ) : null}
          </div>
        ) : null}
        {marker ? (
          <div
            aria-hidden
            className="pointer-events-none absolute flex flex-col items-center justify-center overflow-hidden rounded-sm border border-dashed border-foreground/30 p-0.5"
            style={{
              left: `${(marker.x / widthPt) * 100}%`,
              top: `${(marker.y / heightPt) * 100}%`,
              width: `${(marker.width / widthPt) * 100}%`,
              height: `${(marker.height / heightPt) * 100}%`,
            }}
          >
            {stampPreview?.qr ? (
              <div className="flex h-full w-full items-center gap-1 px-0.5 py-0.5">
                <div className="grid aspect-square h-[85%] shrink-0 grid-cols-5 overflow-hidden bg-white">
                  {QR_PREVIEW_CELLS.map((cell) => (
                    <span
                      key={cell}
                      className={
                        QR_PREVIEW_DARK_CELLS.includes(cell) ? "bg-neutral-900" : "bg-white"
                      }
                    />
                  ))}
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  {previewLines?.map((line) => (
                    <span
                      key={line.key}
                      className="max-w-full truncate px-0.5 text-[5px] leading-none text-muted-foreground"
                    >
                      {line.text}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {stampPreview?.inkDataUrl ? (
                  <img
                    src={stampPreview.inkDataUrl}
                    alt=""
                    className="max-h-[55%] w-auto object-contain"
                  />
                ) : null}
                {previewLines?.map((line) => (
                  <span
                    key={line.key}
                    className="max-w-full truncate px-0.5 text-[6px] leading-tight text-muted-foreground"
                  >
                    {line.text}
                  </span>
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>
      {ghost ? (
        <span
          aria-hidden
          className="pointer-events-none absolute z-10 flex -translate-y-full items-center gap-1 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          style={ghostLabelStyle}
        >
          <PenLine className="size-2.5" />
          {ghost.label}
        </span>
      ) : null}
      {marker ? (
        <span
          aria-hidden
          className="pointer-events-none absolute z-10 flex -translate-y-full items-center gap-1 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background"
          style={markerLabelStyle}
        >
          <PenLine className="size-2.5" />
          {m.signer_pdf_page_signature_label()}
        </span>
      ) : null}
    </div>
  );
}
