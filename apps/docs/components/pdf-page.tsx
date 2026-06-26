import { PenLine } from "lucide-react";
import * as React from "react";

import { m } from "@/paraglide/messages";

// ---------------------------------------------------------------------------
// pdf.js page rendering. The library renders nothing on its own; we draw each
// page to a canvas and overlay a click-capture layer + the signature marker.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfDocumentProxy = any;

export const loadPdfjs = async () => {
  const pdfjs = await import("pdfjs-dist");
  // CDN worker pinned to the installed version — no bundler worker config.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  return pdfjs;
};

export interface PageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfPageProps {
  doc: PdfDocumentProxy;
  pageNumber: number; // 1-based for pdf.js
  widthPt: number;
  heightPt: number;
  marker?: PageRect; // signature rect in PDF points, top-left origin
  // Faint repeat of the placed rect on pages that don't own the signature, shown
  // when "Rubric on every page" is on so the toggle has a visible consequence.
  ghost?: { rect: PageRect; label: string };
  stampPreview?: { inkDataUrl?: string; rubricaDataUrl?: string; lines: string[] };
  onPlace: (fracX: number, fracY: number) => void;
}

/** One rendered PDF page with a transparent click layer and the signature marker. */
export function PdfPage({
  doc,
  pageNumber,
  widthPt,
  heightPt,
  marker,
  ghost,
  stampPreview,
  onPlace,
}: PdfPageProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    // pdf.js RenderTask — has `.promise` and `.cancel()`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let task: any;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const scale = 2;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      task = page.render({ canvasContext: context, viewport });
      try {
        await task.promise;
      } catch {
        // render cancelled on unmount — ignore
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [doc, pageNumber]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fracX = (event.clientX - bounds.left) / bounds.width;
    const fracY = (event.clientY - bounds.top) / bounds.height;
    onPlace(fracX, fracY);
  };

  // Keyboard path: Enter/Space places (or recenters) the signature at the
  // center of the page; arrow keys nudge it once placed, so the flow never
  // requires a pointer.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const STEP = 0.02; // 2% of the page per arrow press
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

  // Stable per-line identity (ordinal + text) for the preview fragments, so the
  // JSX key is data-derived rather than a bare array index.
  const previewLines = stampPreview?.lines.map((line, i) => ({ key: `${i}:${line}`, text: line }));

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={m.signer_aria_page_placement({ page: pageNumber })}
      className="group relative w-full cursor-crosshair overflow-hidden rounded-md border border-border bg-white outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      style={{ aspectRatio: `${widthPt} / ${heightPt}` }}
    >
      <canvas ref={canvasRef} aria-hidden className="block h-auto w-full select-none" />
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
          {stampPreview?.rubricaDataUrl ?? stampPreview?.inkDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={stampPreview?.rubricaDataUrl ?? stampPreview?.inkDataUrl}
              alt=""
              className="max-h-[80%] w-auto object-contain opacity-70"
            />
          ) : null}
          <span className="absolute -top-5 left-0 flex items-center gap-1 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            <PenLine className="size-2.5" />
            {ghost.label}
          </span>
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
          {stampPreview?.inkDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={stampPreview.inkDataUrl}
              alt=""
              className="max-h-[55%] w-auto object-contain"
            />
          ) : null}
          {previewLines?.map((line) => (
            <span
              key={line.key}
              className="max-w-full truncate px-0.5 text-[6px] leading-tight text-neutral-600"
            >
              {line.text}
            </span>
          ))}
          <span className="absolute -top-5 left-0 flex items-center gap-1 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background">
            <PenLine className="size-2.5" />
            signature
          </span>
        </div>
      ) : null}
    </div>
  );
}
