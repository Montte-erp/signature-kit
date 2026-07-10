"use client";

import { findPdfTextAnchors } from "@signature-kit/pdf/anchors";
import { liteParseWorkerBrowserLayer } from "@signature-kit/pdf/liteparse-browser";
import {
  DEFAULT_PDF_ANCHOR_STAMP_SIZE,
  type PdfSignaturePage,
  type PdfSignatureRect,
  type PdfStampSize,
  pdfTextAnchorMatchersFromProps,
} from "@signature-kit/pdf/config";
import { Effect, Exit, Result } from "effect";
import { Loader2, LocateFixed } from "lucide-react";
import * as React from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

export type SignaturePdfViewerMode = "anchors" | "manual";

export type SignaturePdfViewerProps = {
  readonly file: Uint8Array;
  readonly pages: ReadonlyArray<PdfSignaturePage>;
  readonly mode: SignaturePdfViewerMode;
  readonly value: ReadonlyArray<PdfSignatureRect>;
  readonly onChange: (rects: ReadonlyArray<PdfSignatureRect>) => void;
  readonly anchorTokens?: ReadonlyArray<string>;
  readonly anchorDigits?: ReadonlyArray<string>;
  readonly stampSize?: PdfStampSize;
  readonly pageWidth?: number;
  readonly className?: string;
};

const emptyAnchorValues: ReadonlyArray<string> = [];

type ActiveAnchorScan = {
  readonly owner: number;
  cancel: () => void;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function SignaturePdfViewer({
  file,
  pages,
  mode,
  value,
  onChange,
  anchorTokens = emptyAnchorValues,
  anchorDigits = emptyAnchorValues,
  stampSize = DEFAULT_PDF_ANCHOR_STAMP_SIZE,
  pageWidth = 720,
  className,
}: SignaturePdfViewerProps) {
  const [anchorStatus, setAnchorStatus] = React.useState<"idle" | "scanning" | "error">("idle");
  const activeAnchorScan = React.useRef<ActiveAnchorScan | null>(null);
  const anchorScanOwner = React.useRef(0);
  const matchers = React.useMemo(
    () => pdfTextAnchorMatchersFromProps(anchorTokens, anchorDigits),
    [anchorDigits, anchorTokens],
  );
  const anchorScanInputs = React.useMemo(
    () => ({ file, matchers, mode, pages, stampSize }),
    [file, matchers, mode, pages, stampSize],
  );
  const handledAnchorScanInputs = React.useRef(anchorScanInputs);
  const documentFile = React.useMemo(() => {
    const buffer = new ArrayBuffer(file.byteLength);
    new Uint8Array(buffer).set(file);
    return { data: buffer };
  }, [file]);
  const invalidateAnchorScan = React.useCallback((): void => {
    const activeScan = activeAnchorScan.current;
    anchorScanOwner.current += 1;
    activeAnchorScan.current = null;
    activeScan?.cancel();
  }, []);

  React.useEffect(() => {
    if (handledAnchorScanInputs.current === anchorScanInputs) return;
    handledAnchorScanInputs.current = anchorScanInputs;
    invalidateAnchorScan();
    setAnchorStatus("idle");
  }, [anchorScanInputs, invalidateAnchorScan]);

  React.useEffect(() => invalidateAnchorScan, [invalidateAnchorScan]);

  const scanAnchors = (): void => {
    invalidateAnchorScan();
    handledAnchorScanInputs.current = anchorScanInputs;
    if (matchers.length === 0) {
      setAnchorStatus("idle");
      return;
    }

    const owner = anchorScanOwner.current + 1;
    const scan: ActiveAnchorScan = { owner, cancel: () => {} };
    anchorScanOwner.current = owner;
    activeAnchorScan.current = scan;
    setAnchorStatus("scanning");
    const cancel = Effect.runCallback(
      findPdfTextAnchors({
        pdf: file,
        pages,
        matchers,
        stampSize,
      }).pipe(Effect.provide(liteParseWorkerBrowserLayer), Effect.result),
      {
        onExit: (exit) => {
          if (anchorScanOwner.current !== owner || activeAnchorScan.current !== scan) return;
          activeAnchorScan.current = null;
          if (Exit.isSuccess(exit) && Result.isSuccess(exit.value)) {
            setAnchorStatus("idle");
            onChange(exit.value.success);
            return;
          }
          setAnchorStatus("error");
        },
      },
    );

    if (activeAnchorScan.current === scan) scan.cancel = cancel;
  };

  const placeManually = (
    event: React.PointerEvent<HTMLDivElement>,
    page: PdfSignaturePage,
  ): void => {
    if (mode !== "manual") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const scale = bounds.width / page.width;
    const pageX = (event.clientX - bounds.left) / scale;
    const pageY = (event.clientY - bounds.top) / scale;
    const rect: PdfSignatureRect = {
      pageIndex: page.index,
      x: clamp(pageX - stampSize.width / 2, 0, page.width - stampSize.width),
      y: clamp(pageY - stampSize.height / 2, 0, page.height - stampSize.height),
      width: stampSize.width,
      height: stampSize.height,
    };
    onChange([...value.filter((candidate) => candidate.pageIndex !== page.index), rect]);
  };

  return (
    <div data-slot="signature-pdf-viewer" className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {mode === "anchors" ? "Anchor placement" : "Manual placement"}
          </Badge>
          <span className="text-sm text-muted-foreground">{value.length} placement(s)</span>
        </div>
        {mode === "anchors" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={anchorStatus === "scanning"}
            onClick={scanAnchors}
          >
            {anchorStatus === "scanning" ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <LocateFixed aria-hidden className="size-4" />
            )}
            Find anchors
          </Button>
        ) : null}
      </div>
      {anchorStatus === "error" ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          No matching anchor could be read from this PDF.
        </p>
      ) : null}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-muted/30 p-3">
        <Document
          file={documentFile}
          loading={<p className="p-6 text-sm text-muted-foreground">Loading PDF…</p>}
        >
          <div className="flex flex-col items-center gap-4">
            {pages.map((page) => {
              const scale = pageWidth / page.width;
              const pageRects = value.filter((rect) => rect.pageIndex === page.index);
              return (
                <div
                  key={page.index}
                  data-slot="signature-pdf-page"
                  className="relative overflow-hidden rounded-md bg-background shadow-sm ring-1 ring-border"
                  style={{ width: pageWidth }}
                  onPointerDown={(event) => placeManually(event, page)}
                >
                  <Page pageNumber={page.index + 1} width={pageWidth} />
                  {pageRects.map((rect) => (
                    <div
                      key={`${rect.pageIndex}-${rect.x}-${rect.y}`}
                      data-slot="signature-placement-rect"
                      className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10 text-[10px] font-medium text-primary"
                      style={{
                        left: rect.x * scale,
                        top: rect.y * scale,
                        width: rect.width * scale,
                        height: rect.height * scale,
                      }}
                    >
                      <span className="absolute left-1 top-1 rounded-sm bg-background/90 px-1">
                        signature
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </Document>
      </div>
    </div>
  );
}
