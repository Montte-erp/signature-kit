"use client";

import { Effect, Redacted } from "effect";
import {
  BadgeCheck,
  Check,
  ChevronDown,
  ExternalLink,
  FileUp,
  Loader2,
  Lock,
  PenLine,
  Type,
  Wand2,
  X,
} from "lucide-react";
import * as React from "react";

import type { A1CertificateProfile } from "@signature-kit/a1/config";
import {
  a1SignaturesLayer,
  parseA1CertificateProfile,
} from "@signature-kit/a1/signer";
import { stampPdfRubric } from "@signature-kit/pdf/stamp";
import {
  createBrowserPdfSignatureBuilderState,
  readBrowserFileBytes,
  signBrowserPdfBatch,
} from "@signature-kit/react/browser-pdf";
import {
  SignatureInkPad,
  createSignatureBuilderStore,
  signatureBuilderSelectors,
  useSignatureBuilderSelector,
  useSignatureBuilderStore,
} from "@signature-kit/react/components";
import type {
  BrowserPdfSigningQueueItem,
  ReactSignatureFieldDraft,
  ReactSignatureTemplate,
} from "@signature-kit/react/config";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  PdfPage,
  loadPdfjs,
  type PdfDocumentProxy,
} from "@/components/pdf-page";
import { bakeStamp, toBottomLeft } from "@/components/pdf-stamp";
import { Store, useStore } from "@tanstack/react-store";
import { caveat } from "@/lib/handwriting-font";
import { cn } from "@/lib/utils";
import { m } from "@/paraglide/messages";

/*
 * In-browser A1 PDF signer — the real product, not a mock.
 *
 * Flow: upload your own PDFs (rendered with pdf.js so you see them) → click each
 * page to drop the PAdES signature rectangle → load your A1 (.pfx/.p12) +
 * password → sign every document locally with WebCrypto (one `signBrowserPdfBatch`
 * under a single `a1SignaturesLayer`) → download each signed PDF. Nothing leaves
 * the browser.
 *
 * The certificate and stamp config are shared across the whole batch. Each
 * document keeps its own placed-signature rectangle: the live builder store moves
 * into a keyed child (`DocumentCanvas`) so switching documents re-hydrates the
 * right placement instead of corrupting it.
 */

const SIGNATURE_FIELD_ID = "a1-signature";

// "Has a best-guess run happened?" — the one bit of state the Pacer queue's own
// store can't express. The canonical TanStack pattern is a module-level store
// (instantiated outside React); the component only subscribes via useStore.
const placeRunStore = new Store<{ ran: boolean }>({ ran: false });

const SIGNER_ROLE = {
  id: "signer-1",
  label: "Signer",
  email: "you@example.com",
  required: true,
} as const;

const SIGNATURE_DRAFT: ReactSignatureFieldDraft = {
  id: SIGNATURE_FIELD_ID,
  type: "signature",
  roleId: SIGNER_ROLE.id,
  width: 168,
  height: 48,
  label: "A1 signature",
  required: true,
};

type DocRect = {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type PageDim = {
  readonly index: number;
  readonly width: number;
  readonly height: number;
};

interface DocEntry {
  readonly id: string;
  readonly name: string;
  readonly pdfBytes: Uint8Array;
  readonly documentId: string;
  readonly pageDims: ReadonlyArray<PageDim>;
  readonly template: ReactSignatureTemplate;
  readonly rect?: DocRect;
}

type BatchRow =
  | { readonly status: "queued" }
  | { readonly status: "signing" }
  | { readonly status: "signed"; readonly signedPdf: Uint8Array }
  | { readonly status: "failed"; readonly error: string };

type RunState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "signing";
      readonly current: number;
      readonly total: number;
    }
  | { readonly kind: "done" };

type Result<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly message: string };

const runEffect = async <A, E extends { readonly message: string }>(
  effect: Effect.Effect<A, E>,
): Promise<Result<A>> =>
  Effect.runPromise(
    Effect.match(effect, {
      onFailure: (error) => ({ ok: false, message: error.message }),
      onSuccess: (value) => ({ ok: true, value }),
    }),
  );

// Per-page rubricas sit in the RIGHT MARGIN, flush to the right edge and
// vertically CENTERED on the page — repeating the placed-signature's x/y would
// stamp the rubrica on top of page content. Keeps the placed mark's size; x
// shifts to the right margin and y centers on the page height (both clamped so a
// large mark still fits).
const RUBRIC_RIGHT_MARGIN_PT = 18;
const toRightMargin = (
  rect: DocRect,
  pageWidth: number,
  pageHeight: number,
): DocRect => ({
  ...rect,
  x: Math.max(
    RUBRIC_RIGHT_MARGIN_PT,
    pageWidth - RUBRIC_RIGHT_MARGIN_PT - rect.width,
  ),
  y: Math.max(0, (pageHeight - rect.height) / 2),
});

// Raw PNG bytes from a data URL (the rubric path needs bytes; the local bakeStamp
// path passes the data URL straight to embedPng).
const dataUrlToBytes = (dataUrl: string): Uint8Array => {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

// ---------------------------------------------------------------------------
// Handwriting marks. The visible appearance can be drawn (ink pad), typed, or
// pulled from the A1 name. Typed/cert paths render the text in the Caveat
// handwriting font to a transparent dark-ink PNG that feeds the SAME stamp path
// the drawn ink already used.
// ---------------------------------------------------------------------------

const CONNECTORS = new Set(["de", "da", "do", "dos", "das", "e"]);

// "MANOEL FRANCISCO DE CARVALHO NETO" -> "MFCN" (skip pt-BR connectors).
const deriveInitials = (name: string): string => {
  const out = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !CONNECTORS.has(w.toLowerCase()))
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return out || name.trim().slice(0, 2).toUpperCase();
};

const inkScale = (min: number): number =>
  Math.max(
    min,
    Math.min(
      3,
      (typeof window !== "undefined" && window.devicePixelRatio) || 2,
    ),
  );

// Load a specific font for canvas drawing, but NEVER block on it. `document.fonts.ready`
// waits for EVERY page font, so a single perpetually-pending face hangs it forever
// (which froze signing at "Reading the A1 identity…"). We only request THIS face and
// cap the wait — a fallback-font render beats a frozen signer.
async function ensureFontLoaded(spec: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  try {
    await Promise.race([
      document.fonts.load(spec),
      new Promise((resolve) => window.setTimeout(resolve, 1200)),
    ]);
  } catch {
    /* a fallback font is acceptable; never block signing on font loading */
  }
}

// Full handwriting mark -> transparent dark-ink PNG data URL (the MAIN signature
// on the placed page). Awaits the font before drawing or Caveat falls back/blank.
async function renderHandwritingPng(text: string): Promise<string | undefined> {
  const t = text.trim();
  if (!t) return undefined;
  const family = caveat.style.fontFamily;
  const fontPx = 64;
  const padX = 24;
  const padY = 18;
  const scale = inkScale(2);
  const spec = `600 ${fontPx}px ${family}`;
  await ensureFontLoaded(spec);
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = spec;
  const metrics = probe.measureText(t);
  const asc = metrics.actualBoundingBoxAscent || fontPx * 0.8;
  const desc = metrics.actualBoundingBoxDescent || fontPx * 0.3;
  const w = Math.ceil(metrics.width + padX * 2);
  const h = Math.ceil(asc + desc + padY * 2);
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale); // transparent bg: never fillRect
  ctx.font = spec;
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(t, padX, padY + asc);
  return c.toDataURL("image/png");
}

// Small DocuSign "Initial" mark: thin corner brackets + centered initials. Used
// as the per-page rubrica when "Rubric on every page" is on.
async function renderRubricaInitialsPng(
  initials: string,
): Promise<string | undefined> {
  const t = initials.trim();
  if (!t) return undefined;
  const family = caveat.style.fontFamily;
  const W = 150;
  const H = 64;
  const scale = inkScale(2.5);
  await ensureFontLoaded(`600 34px ${family}`);
  const c = document.createElement("canvas");
  c.width = W * scale;
  c.height = H * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 1.25;
  ctx.lineCap = "round";
  const mg = 4;
  const tick = 12;
  ctx.beginPath();
  ctx.moveTo(mg + tick, mg);
  ctx.lineTo(mg, mg);
  ctx.lineTo(mg, H - mg);
  ctx.lineTo(mg + tick, H - mg); // left bracket
  ctx.moveTo(W - mg - tick, mg);
  ctx.lineTo(W - mg, mg);
  ctx.lineTo(W - mg, H - mg);
  ctx.lineTo(W - mg - tick, H - mg); // right bracket
  ctx.stroke();
  ctx.font = `600 34px ${family}`;
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(t, W / 2, H / 2 + 2);
  return c.toDataURL("image/png");
}

// The ink pad draws dark strokes on an OPAQUE white canvas — white is required so
// its Clear can repaint the background (a transparent bg would make `fillRect`
// composite to a no-op and stop erasing). For the baked stamp we need transparent
// ink, so knock the white background out to alpha:0 here, leaving only the dark
// strokes (and their grey anti-aliased edges). Matches the Type/cert ink-only marks.
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(m.signer_err_decode()));
    img.src = src;
  });
}

async function inkToTransparentPng(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w === 0 || h === 0) return dataUrl;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    // near-white -> transparent; dark ink and its grey AA edges stay opaque
    if (px[i] > 245 && px[i + 1] > 245 && px[i + 2] > 245) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL("image/png");
}

// ---------------------------------------------------------------------------
// Best-guess auto-placement. Pick a sensible signature spot per document so the
// user doesn't have to click every PDF one-by-one. Output is always a CENTER
// point in top-left page points — the exact shape the manual click feeds to
// store.placeField (anchor "center"), so an auto placement signs identically to
// a manual one.
//
// This is PURE GEOMETRY: it never spins up pdf.js. The builder template already
// carries every page's dimensions (`doc.pageDims`), so we compute a bottom-right
// anchor on the last page directly. Parsing 29 PDFs with pdf.js just to hunt a
// /Sig widget was the freeze ("fica preso / nunca termina"); geometry places N
// docs in well under a millisecond each, leaving the worker free to yield.
// ---------------------------------------------------------------------------

type AutoAnchor = {
  readonly pageIndex: number;
  readonly cx: number;
  readonly cy: number;
};

// Bottom-right anchor on the LAST page, sized from SIGNATURE_DRAFT so it matches a
// manual placement. Synchronous — no pdf.js, no per-doc async work.
function bestGuessAnchor(doc: DocEntry): AutoAnchor | undefined {
  const pages = doc.pageDims;
  if (pages.length === 0) return undefined;
  const last = pages[pages.length - 1]!;
  const margin = 48;
  return {
    pageIndex: pages.length - 1,
    cx: Math.max(
      SIGNATURE_DRAFT.width / 2,
      last.width - margin - SIGNATURE_DRAFT.width / 2,
    ),
    cy: Math.max(
      SIGNATURE_DRAFT.height / 2,
      last.height - margin - SIGNATURE_DRAFT.height / 2,
    ),
  };
}

// ---------------------------------------------------------------------------
// Keyed document canvas. Owns the live signature builder store for ONE document.
// `useSignatureBuilderStore` inits exactly once and ignores later prop changes,
// so we remount this (key={activeDoc.id}) on every document switch — each mount
// re-hydrates from that document's persisted template, and pushes placement
// changes back up so re-selecting a placed document restores its marker.
// ---------------------------------------------------------------------------

function DocumentCanvas({
  activeDoc,
  stampPreview,
  rubricEveryPage,
  onTemplateChange,
  onPlaced,
  onError,
}: {
  activeDoc: DocEntry;
  stampPreview: {
    inkDataUrl?: string;
    rubricaDataUrl?: string;
    lines: string[];
  };
  rubricEveryPage: boolean;
  onTemplateChange: (
    docId: string,
    template: ReactSignatureTemplate,
    rect?: DocRect,
  ) => void;
  onPlaced: () => void;
  onError: (message: string) => void;
}) {
  const store = useSignatureBuilderStore({
    template: activeDoc.template,
    draft: SIGNATURE_DRAFT,
    ...(activeDoc.rect ? { selectedFieldId: SIGNATURE_FIELD_ID } : {}),
  });
  const template = useSignatureBuilderSelector(
    store,
    signatureBuilderSelectors.template,
  );
  const placedField = template.fields.find((f) => f.id === SIGNATURE_FIELD_ID);

  // Push template + placed rect up on every change. On mount the selector returns
  // the same template reference we initialized from, so the parent setter no-ops
  // (reference guard) — this is a sync, not a render loop.
  React.useEffect(() => {
    onTemplateChange(activeDoc.id, template, placedField?.rect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const pages = template.documents[0]?.pages ?? [];
  const [doc, setDoc] = React.useState<PdfDocumentProxy | undefined>();

  // Load the pdf.js document for this canvas. pdf.js detaches the buffer it's
  // given, so render from a slice and keep `activeDoc.pdfBytes` intact for signing.
  React.useEffect(() => {
    let cancelled = false;
    // pdf.js DocumentLoadingTask — has `.promise` and `.destroy()`. Keep a handle
    // so cleanup tears down the worker-side document. Without this, loading and
    // removing many PDFs (clicking the X) leaks undestroyed PDFDocumentProxy
    // objects in the worker → main-thread jank/freeze. Destroying the task also
    // destroys the document it produced.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let loadingTask: any;
    setDoc(undefined);
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return; // unmounted before the worker even started
        loadingTask = pdfjs.getDocument({ data: activeDoc.pdfBytes.slice() });
        const loaded = await loadingTask.promise;
        if (cancelled) {
          // Raced past cleanup before we could set state — destroy what we loaded
          // so it doesn't leak (cleanup ran when loadingTask was still undefined).
          try {
            await loadingTask.destroy();
          } catch {
            /* already torn down */
          }
          return;
        }
        setDoc(loaded);
      } catch (e) {
        if (!cancelled)
          onError(e instanceof Error ? e.message : m.signer_err_render());
      }
    })();
    return () => {
      cancelled = true;
      // Destroy the loading task (and, transitively, the PDFDocumentProxy it
      // produced) so the pdf.js worker frees the document on every doc switch or
      // remove. Child PdfPage render-task cancellations run first (children unmount
      // before parent cleanup), so no render touches the doc after it's destroyed.
      // destroy() returns a Promise; await it inside a fire-and-forget IIFE so a
      // rejection (task never resolved / already torn down) is swallowed instead of
      // surfacing as an unhandled rejection. Cleanup still returns synchronously.
      void (async () => {
        try {
          await loadingTask?.destroy?.();
        } catch {
          /* already torn down, or the task never resolved — best-effort cleanup */
        }
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc.pdfBytes]);

  const place = async (pageIndex: number, fracX: number, fracY: number) => {
    const page = pages[pageIndex];
    if (!page) return;
    // Convert the click fraction to page points (top-left origin); placeField
    // centers the rect on the click via anchor "center".
    const x = fracX * page.width;
    const y = fracY * page.height;
    const placed = await runEffect(
      store.placeField({
        documentId: activeDoc.documentId,
        pageIndex,
        x,
        y,
        draft: SIGNATURE_DRAFT,
        anchor: "center",
      }),
    );
    if (!placed.ok) {
      onError(placed.message);
      return;
    }
    store.selectField(SIGNATURE_FIELD_ID);
    onPlaced();
  };

  if (!doc) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Rendering {activeDoc.name}…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {pages.map((page, index) => {
        const isPlacedPage =
          placedField !== undefined && placedField.rect.pageIndex === index;
        // With "every page" on, every page that doesn't own the signature shows a
        // faint repeat of the rubric so the toggle reads as having a consequence.
        const ghost =
          !isPlacedPage && rubricEveryPage && placedField
            ? {
                // Mirror the baked placement: rubricas repeat in the right margin,
                // vertically centered, not at the placed signature's x/y.
                rect: toRightMargin(placedField.rect, page.width, page.height),
                label: `Repeats on all ${pages.length} pages`,
              }
            : undefined;
        return (
          <PdfPage
            key={page.index}
            doc={doc}
            pageNumber={index + 1}
            widthPt={page.width}
            heightPt={page.height}
            marker={isPlacedPage ? placedField.rect : undefined}
            ghost={ghost}
            stampPreview={stampPreview}
            onPlace={(fx, fy) => void place(index, fx, fy)}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step chrome
// ---------------------------------------------------------------------------

type StepStatus = "locked" | "active" | "done" | "todo";

function Step({
  n,
  title,
  optional,
  status,
  summary,
  hint,
  onOpen,
  headerRef,
  children,
}: {
  n: number;
  title: string;
  optional?: boolean;
  status: StepStatus;
  summary?: string;
  hint?: string;
  onOpen: () => void;
  headerRef?: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
}) {
  const open = status === "active";
  const locked = status === "locked";
  const done = status === "done";
  const headId = `pdfstep-head-${n}`;
  const panelId = `pdfstep-panel-${n}`;
  return (
    <Card
      className={cn(
        "gap-0 rounded-lg border-border bg-card py-0 shadow-none transition-colors",
        locked && "opacity-50",
        open && "border-foreground/30",
      )}
    >
      <Button
        ref={headerRef}
        variant="ghost"
        type="button"
        id={headId}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={locked}
        onClick={onOpen}
        className={cn(
          "h-auto w-full justify-start gap-2.5 whitespace-normal rounded-lg px-4 py-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-auto disabled:opacity-100",
          locked ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/30",
        )}
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
            done
              ? "border-foreground bg-foreground text-background"
              : open
                ? "border-foreground text-foreground"
                : "border-border text-muted-foreground",
          )}
        >
          {done ? (
            <Check className="size-3" />
          ) : locked ? (
            <Lock className="size-2.5" />
          ) : (
            n
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {title}
            {optional ? (
              <span className="text-[10px] font-normal text-muted-foreground">
                {m.signer_step_optional()}
              </span>
            ) : null}
          </span>
          {done && summary ? (
            <span className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {summary}
            </span>
          ) : null}
          {locked && hint ? (
            <span className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {hint}
            </span>
          ) : null}
        </span>
        {done ? (
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
            {m.signer_step_edit()}
          </span>
        ) : null}
        {!locked ? (
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        ) : null}
      </Button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            id={panelId}
            role="region"
            aria-labelledby={headId}
            inert={!open || undefined}
            className="flex flex-col gap-3 border-t border-border px-4 pb-4 pt-3"
          >
            {children}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Document list (Step 1) + batch results (Step 4)
// ---------------------------------------------------------------------------

function DocList({
  docs,
  activeDocId,
  onSelect,
  onRemove,
  placingIds,
  queuedIds,
}: {
  docs: DocEntry[];
  activeDocId: string | undefined;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  placingIds: readonly string[];
  queuedIds: readonly string[];
}) {
  const placing = new Set(placingIds);
  const queued = new Set(queuedIds);
  return (
    <div className="flex flex-col gap-1.5">
      {docs.map((d) => {
        const active = d.id === activeDocId;
        return (
          <div key={d.id} className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onSelect(d.id)}
              className={cn(
                "flex h-auto min-w-0 flex-1 justify-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active
                  ? "border-foreground/30 bg-muted/40 text-foreground hover:bg-muted/40"
                  : "border-border text-foreground hover:bg-muted/30",
              )}
            >
              <FileUp className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{d.name}</span>
              <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                {placing.has(d.id) ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : queued.has(d.id) ? (
                  m.signer_queued()
                ) : d.rect ? (
                  m.signer_doc_page({ page: d.rect.pageIndex + 1 })
                ) : (
                  m.signer_doc_not_placed()
                )}
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onRemove(d.id)}
              aria-label={m.signer_aria_remove({ name: d.name })}
              className="h-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function BatchResults({
  docs,
  rows,
  run,
  onDownload,
  onDownloadAll,
}: {
  docs: DocEntry[];
  rows: Record<string, BatchRow>;
  run: RunState;
  onDownload: (id: string) => void;
  onDownloadAll: () => void;
}) {
  const signedCount = docs.filter(
    (d) => rows[d.id]?.status === "signed",
  ).length;
  return (
    <div className="flex flex-col gap-2">
      {run.kind === "signing" ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />{" "}
          {m.signer_signing_progress({
            current: run.current,
            total: run.total,
          })}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {docs.map((d) => {
          const row = rows[d.id];
          const status: BatchRow["status"] | "skipped" = !d.rect
            ? "skipped"
            : (row?.status ?? "queued");
          return (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs"
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {status === "signed" ? (
                  <Check className="size-3.5 text-foreground" />
                ) : status === "signing" ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : status === "failed" ? (
                  <X className="size-3.5 text-destructive" />
                ) : (
                  <span className="size-2 rounded-full border border-muted-foreground/50" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {d.name}
              </span>
              {status === "signed" ? (
                <Button
                  type="button"
                  variant="link"
                  onClick={() => onDownload(d.id)}
                  aria-label={m.signer_aria_download({ name: d.name })}
                  className="h-auto shrink-0 rounded-sm p-0 text-[11px] font-medium text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {m.signer_download()}
                </Button>
              ) : status === "failed" ? (
                <span className="min-w-0 max-w-[55%] shrink-0 truncate text-[11px] text-destructive">
                  {m.signer_result_failed({
                    reason:
                      row?.status === "failed"
                        ? row.error
                        : m.signer_error_generic(),
                  })}
                </span>
              ) : status === "skipped" ? (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {m.signer_result_skipped()}
                </span>
              ) : status === "signing" ? (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {m.signer_signing_short()}
                </span>
              ) : (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {m.signer_queued()}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {run.kind === "done" && signedCount > 1 ? (
        <Button onClick={onDownloadAll} className="w-full">
          <Check className="size-4" />
          {m.signer_download_all()}
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The signer
// ---------------------------------------------------------------------------

export function PdfSigner({
  className,
  inDialog,
}: {
  className?: string;
  inDialog?: boolean;
}) {
  const [docs, setDocs] = React.useState<DocEntry[]>([]);
  const [activeDocId, setActiveDocId] = React.useState<string | undefined>();

  const [pfxBytes, setPfxBytes] = React.useState<Uint8Array | undefined>();
  const [password, setPassword] = React.useState("");
  const [profile, setProfile] = React.useState<
    A1CertificateProfile | undefined
  >();

  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");

  // Stamp configuration (shared across the whole batch).
  type RubricSource = "draw" | "type" | "cert";
  const [rubricSource, setRubricSource] = React.useState<RubricSource>("draw");
  const [drawnDataUrl, setDrawnDataUrl] = React.useState<string>(); // ink-pad output
  const [typedText, setTypedText] = React.useState("");
  const [signatureDataUrl, setSignatureDataUrl] = React.useState<string>(); // MAIN mark
  const [rubricaDataUrl, setRubricaDataUrl] = React.useState<string>(); // per-page initials
  const [stampName, setStampName] = React.useState(true);
  const [stampDate, setStampDate] = React.useState(true);
  const [rubricEveryPage, setRubricEveryPage] = React.useState(false);

  // Ink-pad full-width measurement: `prepareCanvas` imperatively resets
  // `canvas.style.width` to the numeric `width` prop on mount/pointerdown, so a
  // CSS-only width snaps back. We measure the container and feed it as `width`.
  const padRef = React.useRef<HTMLDivElement>(null);
  const pdfInputRef = React.useRef<HTMLInputElement>(null);
  const pfxInputRef = React.useRef<HTMLInputElement>(null);
  const [padW, setPadW] = React.useState(300);
  // Monotonic guard for the async white-knockout: drop a stroke's conversion if a
  // newer stroke (or a Clear) has superseded it before it resolved.
  const drawSeqRef = React.useRef(0);

  // Batch run state.
  const [rows, setRows] = React.useState<Record<string, BatchRow>>({});
  const [run, setRun] = React.useState<RunState>({ kind: "idle" });

  // Best-guess auto-placement. `canvasNonce` is bumped per placed document so the
  // keyed DocumentCanvas remounts and re-hydrates the freshly-placed marker (the
  // canvas store inits once and ignores later prop changes) — that, plus switching
  // the active doc to each one as it is placed, gives the live "marker dropping in"
  // preview the user asked for.
  const [canvasNonce, setCanvasNonce] = React.useState(0);

  // "Has a best-guess run happened?" — read from the module-level `placeRunStore`.
  // Never mirrored into useState; the final status is DERIVED below from this plus
  // the live queue counts (no finalize useEffect).
  const placeRan = useStore(placeRunStore, (s) => s.ran);

  // Best-guess auto-placement is PURE GEOMETRY (sub-millisecond per doc — see
  // bestGuessAnchor), so it runs as a plain async loop, NOT a work queue. `placing`
  // is real state, flipped back to false when the loop ends, so the button can never
  // spin forever — the old AsyncQueuer could leave an item stuck at "queued" and
  // never drain ("o best guess nao termina nunca"). `placingIds` / `queuedIds` drive
  // the live per-document status in the DocList.
  const [placing, setPlacing] = React.useState(false);
  const [placingIds, setPlacingIds] = React.useState<readonly string[]>([]);
  const [queuedIds, setQueuedIds] = React.useState<readonly string[]>([]);

  const activeDoc = docs.find((d) => d.id === activeDocId);
  const placedCount = docs.filter((d) => d.rect).length;
  const unplacedCount = docs.length - placedCount;
  // The next document (other than the active one) still needing a signature. Undefined
  // when the only unplaced document is already on the canvas, so the button never
  // becomes a no-op that points at the current document.
  const nextUnplacedId = docs.find((d) => !d.rect && d.id !== activeDocId)?.id;

  // Live preview lines for the placed marker (the real name fills in from the
  // certificate at sign time; before that we show a placeholder).
  const previewLines: string[] = [];
  if (stampName) {
    previewLines.push(profile?.subject ?? m.signer_preview_name());
    previewLines.push(
      profile?.document ? `CPF/CNPJ: ${profile.document}` : "CPF / CNPJ",
    );
  }
  if (stampDate) {
    previewLines.push(new Date().toLocaleDateString("pt-BR"));
  }
  // The placed marker shows the full mark; the every-page ghost shows the initials.
  const stampPreview = {
    inkDataUrl: signatureDataUrl,
    rubricaDataUrl,
    lines: previewLines,
  };

  // Best-guess status, DERIVED (no finalize effect): while placing show progress;
  // once the queue has drained, report the outcome from the live placed count. Any
  // imperative `status` (reading PDFs, signing, manual placement) takes precedence.
  const placeStatus = placing
    ? m.signer_place_running()
    : placeRan
      ? placedCount > 0
        ? m.signer_place_done({
            count: placedCount,
            noun: placedCount === 1 ? m.signer_doc_one() : m.signer_doc_many(),
          })
        : m.signer_place_none()
      : "";
  const shownStatus = status || placeStatus;

  // Clear any finished/in-flight run + banners so the derived step state can't be
  // contradicted by a stale "Signed" result after an edit. Used when the inputs
  // themselves change (new documents, new certificate) — there the prior signed
  // bytes are genuinely meaningless.
  const reset = React.useCallback(() => {
    setRun({ kind: "idle" });
    setRows({});
    setError("");
    setStatus("");
    placeRunStore.setState(() => ({ ran: false })); // drop any stale best-guess status
  }, []);

  // Lighter clear for stamp/password tweaks: drop the error banner but KEEP any
  // already-signed rows and their per-document downloads. A config nudge after a
  // finished batch shouldn't destroy results the user is still downloading — the
  // next run rebuilds the rows from scratch anyway.
  const clearBanners = React.useCallback(() => {
    setError("");
  }, []);

  // A placement (or keyboard nudge) invalidates any prior signed run, but unlike a
  // full reset it keeps a guiding status so the user is still pointed at the next
  // document. It must NOT switch documents: Enter/arrow nudges re-fire this, and
  // jumping away mid-nudge would break the keyboard placement flow.
  const handlePlaced = React.useCallback(() => {
    setRun({ kind: "idle" });
    setRows({});
    setError("");
    setStatus(m.signer_status_placed());
  }, []);

  // Keep the active document valid when documents are removed.
  React.useEffect(() => {
    if (activeDocId && !docs.some((d) => d.id === activeDocId)) {
      setActiveDocId(docs[0]?.id);
    }
  }, [docs, activeDocId]);

  // Measure the ink-pad container so the canvas can be full width (see padW note).
  React.useEffect(() => {
    const el = padRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setPadW(Math.max(160, Math.round(e.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [rubricSource]); // re-attach when the pad mounts under "draw"

  // Derive the two marks from the active source. Font load is async, so this runs
  // in an effect; the `live` guard discards results that resolve after a source
  // switch (document.fonts.load/ready can settle late).
  React.useEffect(() => {
    let live = true;
    void (async () => {
      let sig: string | undefined;
      let rub: string | undefined;
      if (rubricSource === "draw") {
        sig = drawnDataUrl;
        rub = drawnDataUrl; // no initials derivable from a freehand drawing
      } else if (rubricSource === "type" && typedText.trim()) {
        sig = await renderHandwritingPng(typedText);
        rub = await renderRubricaInitialsPng(deriveInitials(typedText));
      } else if (rubricSource === "cert" && profile) {
        sig = await renderHandwritingPng(profile.subject);
        rub = await renderRubricaInitialsPng(deriveInitials(profile.subject));
      }
      if (live) {
        clearBanners();
        setSignatureDataUrl(sig);
        setRubricaDataUrl(rub);
      }
    })();
    return () => {
      live = false;
    };
  }, [rubricSource, typedText, drawnDataUrl, profile, clearBanners]);

  // The child pushes its template + placed rect up here. Guard by reference so the
  // mount-time sync (same template object) is a no-op and never churns `docs`.
  const onTemplateChange = React.useCallback(
    (docId: string, template: ReactSignatureTemplate, rect?: DocRect) => {
      setDocs((prev) => {
        const existing = prev.find((d) => d.id === docId);
        if (!existing || existing.template === template) return prev;
        return prev.map((d) => (d.id === docId ? { ...d, template, rect } : d));
      });
    },
    [],
  );

  const onPdfFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = ""; // allow re-adding the same file later
    if (files.length === 0) return;
    reset();
    setBusy(true);
    setStatus(m.signer_status_reading_pdfs());
    for (const file of files) {
      const bytes = await runEffect(readBrowserFileBytes(file));
      if (!bytes.ok) {
        setError(bytes.message);
        continue;
      }
      const id = `doc-${crypto.randomUUID()}`;
      const state = await runEffect(
        createBrowserPdfSignatureBuilderState({
          id: "browser-a1-signer",
          name: file.name,
          documentId: id,
          documentName: file.name,
          pdf: bytes.value,
          role: SIGNER_ROLE,
          draft: SIGNATURE_DRAFT,
        }),
      );
      if (!state.ok) {
        setError(state.message);
        continue;
      }
      const template = state.value.template;
      const entry: DocEntry = {
        id,
        name: file.name,
        pdfBytes: bytes.value,
        documentId: id,
        pageDims: template.documents[0].pages,
        template,
        rect: undefined,
      };
      setDocs((prev) => [...prev, entry]);
      setActiveDocId((prev) => prev ?? id);
    }
    setBusy(false);
    setStatus(m.signer_status_click_to_place());
  };

  const removeDoc = (docId: string) => {
    clearBanners(); // keep any already-signed rows/downloads; only drop this doc
    setDocs((prev) => prev.filter((d) => d.id !== docId));
    setActiveDocId((prev) => {
      if (prev !== docId) return prev;
      const remaining = docs.filter((d) => d.id !== docId);
      return remaining[0]?.id; // move off the removed doc so the canvas isn't orphaned
    });
    setRows((prev) => {
      if (!(docId in prev)) return prev;
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  };

  // Best guess: place a sensible signature rect on EVERY loaded document at once, so
  // the user never has to click each PDF one-by-one. The anchor is pure geometry
  // (bottom-right of the last page) and we drive the SAME store.placeField path the
  // manual click uses (via a throwaway store per doc), so each placement persists
  // into DocEntry.rect and signs identically to a hand-placed one. The queuer is
  // auto-started, so we just clear() and add — no start()/stop() dance.
  const autoPlaceAll = async () => {
    if (docs.length === 0 || placing) return;
    setError("");
    // A new placement run invalidates any prior signed run, exactly like handlePlaced.
    setRun({ kind: "idle" });
    setRows({});
    setStatus(""); // hand the status line to the DERIVED best-guess status
    placeRunStore.setState(() => ({ ran: true }));

    const queue = docs; // snapshot at click time
    setPlacing(true);
    setQueuedIds(queue.map((d) => d.id));
    for (const d of queue) {
      setQueuedIds((prev) => prev.filter((id) => id !== d.id));
      setPlacingIds([d.id]);
      const anchor = bestGuessAnchor(d); // pure geometry — no pdf.js, instant
      if (anchor) {
        // Drive the SAME store.placeField path the manual click uses (via a throwaway
        // store per doc), so each placement persists into DocEntry.rect and signs
        // identically to a hand-placed one.
        const store = createSignatureBuilderStore({
          template: d.template,
          draft: SIGNATURE_DRAFT,
        });
        const result = await runEffect(
          store.placeField({
            documentId: d.documentId,
            pageIndex: anchor.pageIndex,
            x: anchor.cx,
            y: anchor.cy,
            draft: SIGNATURE_DRAFT,
            anchor: "center",
          }),
        );
        if (result.ok) {
          const field = result.value.fields.find(
            (f) => f.id === SIGNATURE_FIELD_ID,
          );
          if (field) {
            const placedTemplate = result.value;
            const placedRect = field.rect;
            setDocs((prev) =>
              prev.map((x) =>
                x.id === d.id
                  ? { ...x, template: placedTemplate, rect: placedRect }
                  : x,
              ),
            );
            // Reveal each doc with its marker dropping in live: switch the canvas to
            // it and remount so the builder store re-hydrates the placed rect.
            setActiveDocId(d.id);
            setCanvasNonce((n) => n + 1);
          }
        }
      }
      setPlacingIds([]);
      // Yield so the just-placed marker paints before the next doc takes the canvas.
      await new Promise((resolve) => setTimeout(resolve, 24));
    }
    setPlacing(false);
  };

  const onPfxFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    reset();
    setProfile(undefined);
    setBusy(true);
    setStatus(m.signer_status_reading_cert());
    const bytes = await runEffect(readBrowserFileBytes(file));
    setBusy(false);
    if (!bytes.ok) {
      setError(bytes.message);
      return;
    }
    setPfxBytes(bytes.value);
    setStatus(m.signer_status_cert_loaded());
  };

  const signAll = async () => {
    const placed = docs.filter((d) => d.rect);
    if (placed.length === 0)
      return setError("Place at least one signature first.");
    if (!pfxBytes) return setError("Upload your A1 (.pfx/.p12) certificate.");
    if (password.length === 0)
      return setError("Enter the certificate password.");

    setError("");
    setBusy(true);
    setStatus(m.signer_status_reading_identity());

    // Reuse the eagerly-parsed profile from Step 2 when present; only re-parse if
    // it was never loaded (or was invalidated by a password edit).
    let certValue = profile;
    if (!certValue) {
      const certificate = await runEffect(
        parseA1CertificateProfile({
          pfx: pfxBytes,
          password: Redacted.make(password),
        }),
      );
      if (!certificate.ok) {
        setBusy(false);
        setError(certificate.message);
        return;
      }
      certValue = certificate.value;
      setProfile(certValue);
    }

    // Shared stamp content for every document.
    const now = new Date();
    const lines: string[] = [];
    if (stampName) {
      lines.push(certValue.subject);
      if (certValue.document) lines.push(`CPF/CNPJ: ${certValue.document}`);
    }
    if (stampDate) lines.push(now.toLocaleString("pt-BR"));
    // Two marks: the full handwriting MAIN signature (placed page) and the small
    // bracketed INITIALS rubrica (every other page). Rendered SYNCHRONOUSLY here
    // rather than read from the async-derived preview state, so a Sign click that
    // lands before the derive effect settles (just typed a name, or "From
    // certificate" right after the profile resolved) still bakes the real mark.
    let sig: string | undefined;
    let rub: string | undefined;
    try {
      if (rubricSource === "draw") {
        sig = drawnDataUrl; // already transparent ink (white knocked out on draw)
        rub = drawnDataUrl; // no initials derivable from a freehand drawing
      } else if (rubricSource === "type" && typedText.trim()) {
        sig = await renderHandwritingPng(typedText);
        rub = await renderRubricaInitialsPng(deriveInitials(typedText));
      } else if (rubricSource === "cert" && certValue.subject) {
        sig = await renderHandwritingPng(certValue.subject);
        rub = await renderRubricaInitialsPng(deriveInitials(certValue.subject));
      }
    } catch {
      // A mark-render failure must NEVER strand the signer — fall back to no
      // visible mark (the caption lines still bake) rather than hanging.
      sig = undefined;
      rub = undefined;
    }
    const mainPng = sig ? dataUrlToBytes(sig) : undefined;
    const rubricaPng = rub ? dataUrlToBytes(rub) : undefined;
    const hasStamp = mainPng !== undefined || lines.length > 0;

    // Build one batch item per placed document, baking the visible stamp first so
    // the PAdES ByteRange covers it. "Every page" uses the library's stampPdfRubric
    // (one signature, rubric repeated per page); otherwise the local single-page bake.
    //
    // Each document's prep is fault-isolated: a doc that fails to stamp becomes a
    // failed ROW (and is skipped) instead of aborting the whole batch — mirroring
    // signBrowserPdfBatch's per-item ok:false contract for the crypto phase.
    const nextRows: Record<string, BatchRow> = {};
    for (const d of placed) nextRows[d.id] = { status: "queued" };
    setRows(nextRows);
    let anyPrepFailed = false;
    let prepared = 0;
    setRun({ kind: "signing", current: 0, total: placed.length });
    setStatus(m.signer_status_preparing());

    const items: BrowserPdfSigningQueueItem[] = [];
    for (const d of placed) {
      const rect = d.rect;
      if (!rect) continue;
      try {
        let pdf = d.pdfBytes;
        // Only stamp when there is actual content; an empty rubric would otherwise
        // bake boxes onto every page with nothing inside them.
        if (rubricEveryPage && hasStamp) {
          const dim = d.pageDims[rect.pageIndex];
          if (!dim) throw new Error(m.signer_err_dimensions());
          // Every page EXCEPT the placed one gets the small initials rubrica; the
          // placed page gets the full "Signed by" block below. Single-page docs
          // (others empty) skip the rubric pass — only the main block bakes.
          const others = d.pageDims
            .map((_, i) => i)
            .filter((i) => i !== rect.pageIndex);
          if (rubricaPng && others.length > 0) {
            // Group target pages by dimension so same-sized pages share ONE
            // stampPdfRubric call. Each call re-loads + re-saves the whole PDF, so
            // stamping page-by-page is O(P²) and hangs long, multi-doc batches.
            // Most PDFs are uniform → one call covers every page; mixed-size PDFs
            // get one call per distinct page size, each with that size's geometry.
            type RubricGroup = {
              dim: { width: number; height: number };
              pages: number[];
            };
            const byDim = new Map<string, RubricGroup>();
            for (const i of others) {
              const odim = d.pageDims[i];
              if (!odim) continue;
              const key = `${odim.width}x${odim.height}`;
              const group: RubricGroup = byDim.get(key) ?? {
                dim: odim,
                pages: [],
              };
              group.pages.push(i);
              byDim.set(key, group);
            }
            for (const { dim: odim, pages } of byDim.values()) {
              const stamped = await runEffect(
                stampPdfRubric(pdf, {
                  // Right margin, vertically centered, flipped to bottom-left using
                  // this size's width/height so it clears the content column.
                  rect: toBottomLeft(
                    toRightMargin(rect, odim.width, odim.height),
                    odim.height,
                  ),
                  pages,
                  border: false, // the bracket is baked into the PNG; no lib rectangle
                  imagePng: rubricaPng, // initials only — no caption lines on every page
                }),
              );
              if (!stamped.ok) throw new Error(stamped.message);
              pdf = stamped.value;
            }
          }
          pdf = await bakeStamp(pdf, {
            pageIndex: rect.pageIndex,
            rect,
            inkDataUrl: sig,
            lines,
            border: false,
          });
        } else if (hasStamp) {
          pdf = await bakeStamp(d.pdfBytes, {
            pageIndex: rect.pageIndex,
            rect,
            inkDataUrl: sig,
            lines,
            border: false,
          });
        }
        items.push({
          id: d.id,
          input: {
            pdf,
            template: d.template,
            fieldId: SIGNATURE_FIELD_ID,
            reason: "Signed in the browser with SignatureKit",
            name: certValue.subject,
            location: "Browser",
            signingTime: now,
            signatureLength: 16384,
            // Plain PAdES (AdES-BES). The ICP-Brasil policy would require a network
            // fetch, breaking the "nothing leaves the page" guarantee this demo makes.
            policy: "pades-ades",
          },
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : m.signer_err_prepare_doc();
        nextRows[d.id] = { status: "failed", error: message };
        anyPrepFailed = true;
      }
      // Surface prep progress and YIELD to the browser between documents. Baking the
      // rubric on every page of 20+ multi-page PDFs is heavy pure-CPU work; without a
      // yield it pins the main thread and the counter sticks at "Signing 0 of N" (the
      // hang the user hit). This timeout-free setTimeout(0) loop terminates for any N.
      prepared += 1;
      setRun({ kind: "signing", current: prepared, total: placed.length });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Flush all prep failures in a single update with a fresh object reference
    // (mutating nextRows in place would not re-render). Avoids per-iteration setRows.
    if (anyPrepFailed) setRows({ ...nextRows });

    if (items.length === 0) {
      setBusy(false);
      setRun({ kind: "idle" });
      setError(m.signer_err_none_prepared());
      return;
    }

    // The run total now reflects only the documents that actually go to the signer.
    setRun({ kind: "signing", current: 0, total: items.length });
    setRows((prev) => ({ ...prev, [items[0].id]: { status: "signing" } }));
    setStatus(m.signer_status_signing());
    try {
      // One Signatures layer for the whole batch (the lib runs concurrency:1 so a
      // single in-browser key signs without races). Failures are captured per item
      // (ok:false) and never abort the run, so runPromise won't reject from them.
      await Effect.runPromise(
        signBrowserPdfBatch(items, {
          onItemSettled: (result, index, total) => {
            setRun({ kind: "signing", current: index + 1, total });
            setRows((prev) => {
              const next: Record<string, BatchRow> = {
                ...prev,
                [result.id]: result.ok
                  ? { status: "signed", signedPdf: result.signedPdf }
                  : { status: "failed", error: result.error.message },
              };
              const upcoming = items[index + 1];
              if (upcoming && next[upcoming.id]?.status === "queued") {
                next[upcoming.id] = { status: "signing" };
              }
              return next;
            });
          },
        }).pipe(
          Effect.provide(
            a1SignaturesLayer({
              pfx: pfxBytes,
              password: Redacted.make(password),
            }),
          ),
        ),
      );
    } catch (e) {
      setBusy(false);
      setRun({ kind: "idle" });
      setError(
        e instanceof Error ? e.message : m.signer_error_signing_failed(),
      );
      return;
    }
    setBusy(false);
    setRun({ kind: "done" });
    setStatus(m.signer_status_signed());
  };

  const downloadBytes = (bytes: Uint8Array, name: string) => {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name.replace(/\.pdf$/i, "") + "-signed.pdf";
    a.click();
    URL.revokeObjectURL(url);
  };
  const downloadOne = (docId: string) => {
    const d = docs.find((x) => x.id === docId);
    const row = rows[docId];
    if (d && row?.status === "signed") downloadBytes(row.signedPdf, d.name);
  };
  const downloadAll = () => {
    for (const d of docs) {
      const row = rows[d.id];
      if (row?.status === "signed") downloadBytes(row.signedPdf, d.name);
    }
  };

  const canSign = Boolean(
    placedCount > 0 && pfxBytes && password.length > 0 && !busy,
  );

  // Progressive-disclosure flow state. Exactly one step is open; all status is
  // derived from live predicates so it can't desync from the real flow.
  const [activeStep, setActiveStep] = React.useState<1 | 2 | 3 | 4>(1);
  const prevStep1Done = React.useRef(false);
  // Strict: every uploaded document must be placed before the summary goes green,
  // so it never claims more than it signs.
  const step1Done = docs.length > 0 && docs.every((d) => d.rect);
  const step2Done = Boolean(pfxBytes && password.length > 0);

  // Auto-advance only on the false→true transition, and only while on step 1, so
  // reopening a completed Step 1 to add/replace a PDF never bounces you forward.
  React.useEffect(() => {
    if (step1Done && !prevStep1Done.current && activeStep === 1)
      setActiveStep(2);
    prevStep1Done.current = step1Done;
  }, [step1Done, activeStep]);

  // Keyboard focus management for the collapses. A panel that closes becomes
  // `inert`; on user-driven advances we move focus to the newly opened step's
  // header. Auto-advance after placement keeps focus on the canvas (never inert),
  // so it must NOT trigger this.
  const headerRefs = React.useRef<
    Partial<Record<1 | 2 | 3 | 4, HTMLButtonElement | null>>
  >({});
  const focusNextHeader = React.useRef(false);
  const goToStep = (n: 1 | 2 | 3 | 4) => {
    focusNextHeader.current = true;
    setActiveStep(n);
  };

  // Eager-parse the A1 on Step 2 "Continue" so `profile.subject` exists when Step 3
  // opens (the "From certificate" mark needs it) and wrong passwords surface early.
  const loadProfileThenAdvance = async () => {
    if (!pfxBytes || password.length === 0) return;
    setBusy(true);
    setStatus(m.signer_status_reading_identity());
    const c = await runEffect(
      parseA1CertificateProfile({
        pfx: pfxBytes,
        password: Redacted.make(password),
      }),
    );
    setBusy(false);
    if (!c.ok) {
      setError(c.message); // stay on Step 2, surface the message verbatim
      return;
    }
    setProfile(c.value);
    goToStep(3);
  };
  React.useEffect(() => {
    if (!focusNextHeader.current) return;
    focusNextHeader.current = false;
    headerRefs.current[activeStep]?.focus();
  }, [activeStep]);

  const signed = run.kind === "done";

  const statusOf = (n: 1 | 2 | 3 | 4): StepStatus =>
    n === 1
      ? activeStep === 1
        ? "active"
        : step1Done
          ? "done"
          : "todo"
      : n === 2
        ? !step1Done
          ? "locked"
          : activeStep === 2
            ? "active"
            : step2Done
              ? "done"
              : "todo"
        : n === 3
          ? !step2Done
            ? "locked"
            : activeStep === 3
              ? "active"
              : activeStep > 3
                ? "done"
                : "todo"
          : !(step1Done && step2Done)
            ? "locked"
            : activeStep === 4
              ? "active"
              : signed
                ? "done"
                : "todo";

  const stampBits = [
    signatureDataUrl && m.signer_bit_mark(),
    stampName && m.signer_bit_name(),
    stampDate && m.signer_bit_date(),
    rubricEveryPage && m.signer_bit_everypage(),
  ].filter(Boolean) as string[];

  return (
    <div
      className={cn(
        "@container",
        inDialog && "flex min-h-0 flex-1 flex-col",
        className,
      )}
    >
      <div
        className={cn(
          "grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(400px,440px)]",
          inDialog &&
            "min-h-0 flex-1 overflow-y-auto p-6 @4xl:grid-rows-[minmax(0,1fr)] @4xl:overflow-hidden",
        )}
      >
        {/* LEFT / TOP — persistent document canvas. In the dialog it owns its own
            scroll (the steps pane scrolls separately, so the modal never has one
            scroll that moves everything); standalone it stays sticky. */}
        <div
          className={cn(
            "min-w-0 bg-background pb-1",
            inDialog
              ? "@4xl:min-h-0 @4xl:self-stretch @4xl:overflow-y-auto"
              : "sticky top-0 z-10 self-start @4xl:top-0",
          )}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {m.signer_doc_label()}
            </span>
            {activeDoc ? (
              <span className="truncate text-xs text-muted-foreground">
                {activeDoc.name}
              </span>
            ) : null}
          </div>
          <Card className="min-h-64 rounded-lg border-border bg-muted/30 p-3 shadow-none">
            {!activeDoc ? (
              <Label className="flex h-64 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-center text-sm font-normal text-muted-foreground hover:bg-input/30 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                <FileUp className="size-6 opacity-60" />
                <span>{m.signer_dropzone()}</span>
                <input
                  type="file"
                  multiple
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  onChange={onPdfFiles}
                />
              </Label>
            ) : (
              <DocumentCanvas
                key={`${activeDoc.id}:${canvasNonce}`}
                activeDoc={activeDoc}
                stampPreview={stampPreview}
                rubricEveryPage={rubricEveryPage}
                onTemplateChange={onTemplateChange}
                onPlaced={handlePlaced}
                onError={setError}
              />
            )}
          </Card>
          {shownStatus ? (
            <p className="mt-2 px-0.5 text-xs leading-relaxed text-muted-foreground">
              {shownStatus}
            </p>
          ) : null}
          {/* Canvas-local "one obvious next action" for a multi-PDF batch: jump to
              the next document that still needs a signature without scrolling back
              up to the document list. */}
          {nextUnplacedId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setActiveDocId(nextUnplacedId)}
              className="mt-2 gap-1.5 text-xs text-foreground"
            >
              <FileUp className="size-3.5" data-icon="inline-start" />
              {m.signer_next_unplaced({ count: unplacedCount })}
            </Button>
          ) : null}
        </div>

        {/* RIGHT / BELOW — the guided accordion */}
        <div
          className={cn(
            "flex flex-col gap-2.5",
            inDialog && "@4xl:min-h-0 @4xl:self-stretch @4xl:overflow-y-auto",
          )}
        >
          {/* STEP 1 — Documents */}
          <Step
            n={1}
            title={m.signer_step_documents()}
            status={statusOf(1)}
            onOpen={() => setActiveStep(1)}
            headerRef={(el) => {
              headerRefs.current[1] = el;
            }}
            summary={m.signer_step1_summary({
              docs: docs.length,
              noun:
                docs.length === 1 ? m.signer_doc_one() : m.signer_doc_many(),
              placed: placedCount,
            })}
          >
            {docs.length > 0 ? (
              <DocList
                docs={docs}
                activeDocId={activeDocId}
                onSelect={setActiveDocId}
                onRemove={removeDoc}
                placingIds={placingIds}
                queuedIds={queuedIds}
              />
            ) : null}
            {/* Best guess — auto-place a signature rect on every loaded document at
                once (bottom-right of the last page, pure geometry), so a multi-PDF
                batch needs zero per-document clicking. */}
            {docs.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void autoPlaceAll()}
                disabled={placing}
                className="gap-1.5 text-xs text-foreground disabled:opacity-60"
              >
                {placing ? (
                  <Loader2
                    className="size-3.5 animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <Wand2 className="size-3.5" data-icon="inline-start" />
                )}
                {unplacedCount > 0
                  ? m.signer_place_all({ count: docs.length })
                  : m.signer_place_reposition()}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => pdfInputRef.current?.click()}
              className="gap-1.5 text-xs text-foreground"
            >
              <FileUp className="size-3.5" data-icon="inline-start" />
              {m.signer_add_pdfs()}
            </Button>
            <input
              ref={pdfInputRef}
              type="file"
              multiple
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={onPdfFiles}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {docs.length === 0
                ? m.signer_step1_hint_empty()
                : activeDoc && !activeDoc.rect
                  ? m.signer_step1_hint_place()
                  : placedCount < docs.length
                    ? m.signer_step1_hint_some()
                    : m.signer_step1_hint_all()}
            </p>
          </Step>

          {/* STEP 2 — A1 certificate */}
          <Step
            n={2}
            title={m.signer_step_a1()}
            status={statusOf(2)}
            onOpen={() => setActiveStep(2)}
            headerRef={(el) => {
              headerRefs.current[2] = el;
            }}
            hint={m.signer_step2_hint()}
            summary={
              profile
                ? `${profile.subject}${profile.document ? ` · ${profile.document}` : ""}`
                : m.signer_step2_summary_loaded()
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => pfxInputRef.current?.click()}
              className="gap-1.5 text-xs text-foreground"
            >
              <Lock className="size-3.5" data-icon="inline-start" />
              {pfxBytes ? m.signer_replace_pfx() : m.signer_upload_pfx()}
            </Button>
            <input
              ref={pfxInputRef}
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              className="sr-only"
              onChange={onPfxFile}
            />
            <Input
              type="password"
              value={password}
              aria-label={m.signer_cert_password()}
              placeholder={m.signer_cert_password()}
              onChange={(e) => {
                clearBanners();
                setProfile(undefined); // a stale profile can't outlive a password edit
                setPassword(e.currentTarget.value);
              }}
              className="rounded-md border-border bg-input/30 px-3 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {m.signer_step2_note_a()}
              <code className="mx-1 font-mono text-foreground">Redacted</code>
              {m.signer_step2_note_b()}
            </p>
            {profile ? (
              <p className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                {profile.subject}
                {profile.document ? ` · ${profile.document}` : ""}
              </p>
            ) : null}
            <Button
              onClick={() => void loadProfileThenAdvance()}
              disabled={!step2Done || busy}
              className="w-full"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {m.signer_continue()}
            </Button>
          </Step>

          {/* STEP 3 — Stamp */}
          <Step
            n={3}
            title={m.signer_step_stamp()}
            optional
            status={statusOf(3)}
            onOpen={() => setActiveStep(3)}
            headerRef={(el) => {
              headerRefs.current[3] = el;
            }}
            hint={m.signer_step3_hint()}
            summary={
              stampBits.length
                ? stampBits.join(" · ")
                : m.signer_step3_summary_none()
            }
          >
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {m.signer_step3_intro()}
            </p>

            {/* Visible mark — source picker */}
            <div className="mt-1 flex flex-col gap-2">
              <p
                id="rubric-source-label"
                className="text-[11px] text-muted-foreground"
              >
                {m.signer_signature_mark()}
              </p>
              <RadioGroup
                value={rubricSource}
                onValueChange={(v) => {
                  clearBanners();
                  setRubricSource(v as RubricSource);
                }}
                aria-labelledby="rubric-source-label"
                className="flex gap-1.5"
              >
                {(
                  [
                    ["draw", m.signer_mark_draw(), PenLine],
                    ["type", m.signer_mark_type(), Type],
                    ["cert", m.signer_mark_cert(), BadgeCheck],
                  ] as const
                ).map(([val, label, Icon]) => {
                  const sel = rubricSource === val;
                  const id = `rubric-source-${val}`;
                  return (
                    <Label
                      key={val}
                      htmlFor={id}
                      className={cn(
                        "flex-1 justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-normal cursor-pointer transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                        sel
                          ? "border-foreground/40 bg-muted/40 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/30",
                      )}
                    >
                      <RadioGroupItem id={id} value={val} className="sr-only" />
                      <Icon className="size-3.5" /> {label}
                    </Label>
                  );
                })}
              </RadioGroup>

              {/* body — fixed min-height so switching never jumps the accordion */}
              <div className="min-h-[120px]">
                {rubricSource === "draw" ? (
                  <div ref={padRef} className="flex w-full flex-col gap-2">
                    <SignatureInkPad
                      width={padW}
                      height={96}
                      penColor="#111111"
                      backgroundColor="#ffffff"
                      lineWidth={2.4}
                      onChangeDataUrl={(url) => {
                        clearBanners();
                        const seq = ++drawSeqRef.current;
                        void inkToTransparentPng(url).then((transparent) => {
                          if (seq === drawSeqRef.current)
                            setDrawnDataUrl(transparent);
                        });
                      }}
                      onClear={() => {
                        clearBanners();
                        drawSeqRef.current++; // invalidate any in-flight conversion
                        setDrawnDataUrl(undefined);
                      }}
                      canvasClassName="block w-full rounded-md border border-border"
                      canvasStyle={{
                        border: undefined,
                        borderRadius: undefined,
                        maxWidth: "100%",
                      }}
                      clearButtonClassName="self-start inline-flex items-center rounded-md border border-border bg-input/30 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-input/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      clearButtonStyle={{
                        background: undefined,
                        border: undefined,
                        borderRadius: undefined,
                        color: undefined,
                        font: undefined,
                        padding: undefined,
                      }}
                      ariaLabel={m.signer_ink_aria()}
                      clearLabel={m.signer_clear()}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {m.signer_draw_hint()}
                    </p>
                  </div>
                ) : rubricSource === "type" ? (
                  <div className="flex flex-col gap-2">
                    <Input
                      type="text"
                      value={typedText}
                      aria-label={m.signer_type_aria()}
                      placeholder={
                        profile?.subject ?? m.signer_type_placeholder()
                      }
                      onChange={(e) => {
                        clearBanners();
                        setTypedText(e.currentTarget.value);
                      }}
                      className="rounded-md border-border bg-input/30 px-3 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                    {signatureDataUrl ? (
                      <div className="flex h-16 items-center justify-center rounded-md border border-border bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={signatureDataUrl}
                          alt=""
                          className="max-h-12 w-auto object-contain"
                        />
                      </div>
                    ) : null}
                    {typedText.trim() ? (
                      <p className="text-[11px] text-muted-foreground">
                        {m.signer_initials_label()}{" "}
                        <span className="font-mono text-foreground">
                          {deriveInitials(typedText)}
                        </span>
                      </p>
                    ) : null}
                  </div>
                ) : !profile ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {pfxBytes
                      ? m.signer_cert_hint_continue()
                      : m.signer_cert_hint_add()}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex h-16 items-center justify-center rounded-md border border-border bg-white">
                      {signatureDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={signatureDataUrl}
                          alt=""
                          className="max-h-12 w-auto object-contain"
                        />
                      ) : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {m.signer_cert_initials_label()}{" "}
                      <span className="font-mono text-foreground">
                        {deriveInitials(profile.subject)}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </div>

            <Label
              htmlFor="stamp-name"
              className="gap-2 text-xs font-normal text-foreground"
            >
              <Checkbox
                id="stamp-name"
                checked={stampName}
                onCheckedChange={(v) => {
                  clearBanners();
                  setStampName(v === true);
                }}
                className="size-3.5"
              />
              {m.signer_chk_name()}
            </Label>
            <Label
              htmlFor="stamp-date"
              className="gap-2 text-xs font-normal text-foreground"
            >
              <Checkbox
                id="stamp-date"
                checked={stampDate}
                onCheckedChange={(v) => {
                  clearBanners();
                  setStampDate(v === true);
                }}
                className="size-3.5"
              />
              {m.signer_chk_date()}
            </Label>
            <Label
              htmlFor="stamp-rubric"
              className="gap-2 text-xs font-normal text-foreground"
            >
              <Checkbox
                id="stamp-rubric"
                checked={rubricEveryPage}
                onCheckedChange={(v) => {
                  clearBanners();
                  setRubricEveryPage(v === true);
                }}
                className="size-3.5"
              />
              {m.signer_chk_rubric()}
            </Label>
            <p className="-mt-1 pl-5 text-[11px] leading-relaxed text-muted-foreground">
              {rubricSource === "draw"
                ? m.signer_rubric_note_draw()
                : m.signer_rubric_note_initials()}
            </p>
            <Button onClick={() => goToStep(4)} className="w-full">
              {m.signer_continue()}
            </Button>
          </Step>

          {/* STEP 4 — Sign */}
          <Step
            n={4}
            title={m.signer_step_sign()}
            status={statusOf(4)}
            onOpen={() => setActiveStep(4)}
            headerRef={(el) => {
              headerRefs.current[4] = el;
            }}
            hint={m.signer_step4_hint()}
            summary={signed ? m.signer_step4_summary_signed() : ""}
          >
            {run.kind === "idle" ? (
              <>
                <Button
                  onClick={() => void signAll()}
                  disabled={!canSign}
                  className="w-full"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PenLine className="size-4" />
                  )}
                  {m.signer_sign_button({
                    count: placedCount,
                    noun:
                      placedCount === 1
                        ? m.signer_doc_one()
                        : m.signer_doc_many(),
                  })}
                </Button>
                {placedCount < docs.length ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {m.signer_skip_note({ count: docs.length - placedCount })}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <BatchResults
                  docs={docs}
                  rows={rows}
                  run={run}
                  onDownload={downloadOne}
                  onDownloadAll={downloadAll}
                />
                {run.kind === "done" ? (
                  <>
                    <a
                      href="https://validar.iti.gov.br/"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-4xl border border-border bg-input/30 px-3 text-sm font-medium text-foreground transition-colors hover:bg-input/50"
                    >
                      {m.signer_validate()}
                      <ExternalLink className="size-3.5" />
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void signAll()}
                      disabled={!canSign}
                      className="w-full"
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <PenLine className="size-4" />
                      )}
                      {m.signer_sign_again()}
                    </Button>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {m.signer_validate_note()}
                    </p>
                  </>
                ) : null}
              </>
            )}
          </Step>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal wrapper
// ---------------------------------------------------------------------------

export function PdfSignerDialog({ children }: { children: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        aria-describedby="pdf-signer-desc"
        className="flex max-h-[92vh] w-[min(1180px,96vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl sm:max-w-none"
      >
        <DialogHeader className="gap-1 space-y-0 border-b border-border px-6 py-4 text-left">
          <div className="flex items-start justify-between gap-4">
            <DialogTitle className="text-base font-medium tracking-tight text-foreground">
              {m.signer_dialog_title()}
            </DialogTitle>
            <DialogClose className="-mt-0.5 -mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <X className="size-4" />
              <span className="sr-only">{m.signer_close()}</span>
            </DialogClose>
          </div>
          <DialogDescription
            id="pdf-signer-desc"
            className="text-xs text-muted-foreground"
          >
            {m.signer_dialog_desc()}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <PdfSigner inDialog />
        </div>
      </DialogContent>
    </Dialog>
  );
}
