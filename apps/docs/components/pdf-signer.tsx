"use client";

import { Effect, Redacted, Result } from "effect";
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
import { useForm } from "@tanstack/react-form";

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
} from "@signature-kit/pdf/browser";
import {
  createPdfSignatureBuilderStore,
  pdfSignatureBuilderSelectors,
  placePdfSignatureFieldsBatch,
  type PdfSignatureBuilderStore,
} from "@signature-kit/pdf/builder-store";
import type {
  PdfSignatureBuilderState,
  PdfSignatureFieldDraft,
  PdfSigningBatchItem,
  PdfSignatureTemplate,
} from "@signature-kit/pdf/config";

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
import {
  PdfPage,
  loadPdfjs,
  type PdfDocumentProxy,
  type PdfLoadingTask,
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

const usePdfSignatureBuilderSelector = <Selected,>(
  store: PdfSignatureBuilderStore,
  selector: (state: PdfSignatureBuilderState) => Selected,
): Selected =>
  React.useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  );

const SIGNER_ROLE: PdfSignatureTemplate["roles"][number] = {
  id: "signer-1",
  label: "Signer",
  email: "you@example.com",
  required: true,
};

const SIGNATURE_DRAFT: PdfSignatureFieldDraft = {
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
  readonly template: PdfSignatureTemplate;
  readonly store: PdfSignatureBuilderStore;
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

type RubricSource = "type" | "cert";

type SignerFormValues = {
  readonly password: string;
  readonly rubricSource: RubricSource;
  readonly typedText: string;
  readonly stampName: boolean;
  readonly stampDate: boolean;
  readonly rubricEveryPage: boolean;
};

const signerFormDefaults: SignerFormValues = {
  password: "",
  rubricSource: "cert",
  typedText: "",
  stampName: true,
  stampDate: true,
  rubricEveryPage: false,
};

type SignerRuntimeState = {
  readonly docs: readonly DocEntry[];
  readonly activeDocId: string | undefined;
  readonly pfxBytes: Uint8Array | undefined;
  readonly profile: A1CertificateProfile | undefined;
  readonly busy: boolean;
  readonly status: string;
  readonly error: string;
  readonly signatureDataUrl: string | undefined;
  readonly rubricaDataUrl: string | undefined;
  readonly rows: Record<string, BatchRow>;
  readonly run: RunState;
  readonly placing: boolean;
  readonly placingIds: readonly string[];
  readonly queuedIds: readonly string[];
  readonly activeStep: 1 | 2 | 3 | 4;
};

const signerRuntimeInitial: SignerRuntimeState = {
  docs: [],
  activeDocId: undefined,
  pfxBytes: undefined,
  profile: undefined,
  busy: false,
  status: "",
  error: "",
  signatureDataUrl: undefined,
  rubricaDataUrl: undefined,
  rows: {},
  run: { kind: "idle" },
  placing: false,
  placingIds: [],
  queuedIds: [],
  activeStep: 1,
};

const signerRuntimeStore = new Store<SignerRuntimeState>(signerRuntimeInitial);
const pdfDocumentStore = new Store<Record<string, PdfDocumentProxy | undefined>>({});

const patchSignerRuntime = (patch: Partial<SignerRuntimeState>): void => {
  signerRuntimeStore.setState((state) => ({ ...state, ...patch }));
};

const updateSignerRuntime = (
  update: (state: SignerRuntimeState) => SignerRuntimeState,
): void => {
  signerRuntimeStore.setState(update);
};

const putPdfDocument = (id: string, document: PdfDocumentProxy | undefined): void => {
  pdfDocumentStore.setState((state) => ({ ...state, [id]: document }));
};

const dropPdfDocument = (id: string): void => {
  pdfDocumentStore.setState((state) => {
    const next = { ...state };
    delete next[id];
    return next;
  });
};


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
// Handwriting marks. The visible appearance is either typed by the user or
// pulled from the A1 name. Both paths render the text in the Caveat handwriting
// font to a transparent dark-ink PNG that feeds the PDF stamp path.
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

// Small initials mark: thin corner brackets + centered initials. Used
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


// ---------------------------------------------------------------------------
// Keyed document canvas. The parent owns one long-lived builder store per
// document; the canvas only subscribes to that store and reports committed
// placements from user actions.
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
    template: PdfSignatureTemplate,
    rect?: DocRect,
  ) => void;
  onPlaced: () => void;
  onError: (message: string) => void;
}) {
  const store = activeDoc.store;
  const template = usePdfSignatureBuilderSelector(
    store,
    pdfSignatureBuilderSelectors.template,
  );
  const placedField = template.fields.find((f) => f.id === SIGNATURE_FIELD_ID);


  const pages = template.documents[0]?.pages ?? [];
  const doc = useStore(pdfDocumentStore, (state) => state[activeDoc.id]);

  // Load the pdf.js document for this canvas. pdf.js detaches the buffer it's
  // given, so render from a slice and keep `activeDoc.pdfBytes` intact for signing.
  React.useEffect(() => {
    let cancelled = false;
    // pdf.js DocumentLoadingTask — has `.promise` and `.destroy()`. Keep a handle
    // so cleanup tears down the worker-side document. Without this, loading and
    // removing many PDFs (clicking the X) leaks undestroyed PDFDocumentProxy
    // objects in the worker → main-thread jank/freeze. Destroying the task also
    // destroys the document it produced.
    let loadingTask: PdfLoadingTask | undefined;
    putPdfDocument(activeDoc.id, undefined);
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
            await loadingTask.destroy?.();
          } catch {
            /* already torn down */
          }
          return;
        }
        putPdfDocument(activeDoc.id, loaded);
      } catch {
        if (!cancelled) onError(m.signer_err_render());
      }
    })();
    return () => {
      cancelled = true;
      dropPdfDocument(activeDoc.id);
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
    const placed = await Effect.runPromise(
      Effect.result(
        store.placeField({
          documentId: activeDoc.documentId,
          pageIndex,
          x,
          y,
          draft: SIGNATURE_DRAFT,
          anchor: "center",
        }),
      ),
    );
    if (Result.isFailure(placed)) {
      onError(placed.failure.message);
      return;
    }
    const field = placed.success.fields.find((candidate) => candidate.id === SIGNATURE_FIELD_ID);
    if (field) onTemplateChange(activeDoc.id, placed.success, field.rect);
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
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
              open && "rotate-180",
            )}
          />
        ) : null}
      </Button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
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
  docs: readonly DocEntry[];
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
  docs: readonly DocEntry[];
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
  const form = useForm<SignerFormValues>({ defaultValues: signerFormDefaults });

  const docs = useStore(signerRuntimeStore, (state) => state.docs);
  const activeDocId = useStore(signerRuntimeStore, (state) => state.activeDocId);
  const pfxBytes = useStore(signerRuntimeStore, (state) => state.pfxBytes);
  const profile = useStore(signerRuntimeStore, (state) => state.profile);
  const busy = useStore(signerRuntimeStore, (state) => state.busy);
  const status = useStore(signerRuntimeStore, (state) => state.status);
  const error = useStore(signerRuntimeStore, (state) => state.error);
  const signatureDataUrl = useStore(signerRuntimeStore, (state) => state.signatureDataUrl);
  const rubricaDataUrl = useStore(signerRuntimeStore, (state) => state.rubricaDataUrl);
  const rows = useStore(signerRuntimeStore, (state) => state.rows);
  const run = useStore(signerRuntimeStore, (state) => state.run);
  const placing = useStore(signerRuntimeStore, (state) => state.placing);
  const placingIds = useStore(signerRuntimeStore, (state) => state.placingIds);
  const queuedIds = useStore(signerRuntimeStore, (state) => state.queuedIds);
  const activeStep = useStore(signerRuntimeStore, (state) => state.activeStep);

  const password = form.useStore((state) => state.values.password);
  const rubricSource = form.useStore((state) => state.values.rubricSource);
  const typedText = form.useStore((state) => state.values.typedText ?? "");
  const stampName = form.useStore((state) => state.values.stampName);
  const stampDate = form.useStore((state) => state.values.stampDate);
  const rubricEveryPage = form.useStore((state) => state.values.rubricEveryPage);

  const pdfInputRef = React.useRef<HTMLInputElement>(null);
  const pfxInputRef = React.useRef<HTMLInputElement>(null);

  // "Has a best-guess run happened?" — read from the module-level `placeRunStore`.
  // Never mirrored into component-local state; the final status is DERIVED below
  // from this plus the live queue counts (no finalize useEffect).
  const placeRan = useStore(placeRunStore, (s) => s.ran);

  // Best-guess auto-placement is owned by @signature-kit/pdf/builder-store:
  // pure geometry computes one placement per document, and the PDF batch queue
  // streams per-document progress back into this React shell.

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
    patchSignerRuntime({ run: { kind: "idle" }, rows: {}, error: "", status: "" });
    placeRunStore.setState(() => ({ ran: false })); // drop any stale best-guess status
  }, []);

  // Lighter clear for stamp/password tweaks: drop the error banner but KEEP any
  // already-signed rows and their per-document downloads. A config nudge after a
  // finished batch shouldn't destroy results the user is still downloading — the
  // next run rebuilds the rows from scratch anyway.
  const clearBanners = React.useCallback(() => {
    patchSignerRuntime({ error: "" });
  }, []);

  // A placement (or keyboard nudge) invalidates any prior signed run, but unlike a
  // full reset it keeps a guiding status so the user is still pointed at the next
  // document. It must NOT switch documents: Enter/arrow nudges re-fire this, and
  // jumping away mid-nudge would break the keyboard placement flow.
  const handlePlaced = React.useCallback(() => {
    patchSignerRuntime({
      run: { kind: "idle" },
      rows: {},
      error: "",
      status: m.signer_status_placed(),
    });
  }, []);



  // Derive the two marks from the active source. Font load is async, so this runs
  // in an effect; the `live` guard discards results that resolve after a source
  // switch (document.fonts.load/ready can settle late).
  React.useEffect(() => {
    let live = true;
    void (async () => {
      let sig: string | undefined;
      let rub: string | undefined;
      if (rubricSource === "type" && typedText.trim()) {
        sig = await renderHandwritingPng(typedText);
        rub = await renderRubricaInitialsPng(deriveInitials(typedText));
      } else if (rubricSource === "cert" && profile) {
        sig = await renderHandwritingPng(profile.subject);
        rub = await renderRubricaInitialsPng(deriveInitials(profile.subject));
      }
      if (live) {
        clearBanners();
        patchSignerRuntime({ signatureDataUrl: sig, rubricaDataUrl: rub });
      }
    })();
    return () => {
      live = false;
    };
  }, [rubricSource, typedText, profile, clearBanners]);

  // Strict: every uploaded document must be placed before the summary goes green,
  // so it never claims more than it signs.
  const step1Done = docs.length > 0 && docs.every((d) => d.rect);
  const step2Done = Boolean(pfxBytes && password.length > 0);

  const onTemplateChange = React.useCallback(
    (docId: string, template: PdfSignatureTemplate, rect?: DocRect) => {
      updateSignerRuntime((state) => {
        const nextDocs = state.docs.map((doc) =>
          doc.id === docId ? { ...doc, template, rect } : doc,
        );
        const nextActiveStep =
          state.activeStep === 1 && nextDocs.length > 0 && nextDocs.every((doc) => doc.rect)
            ? 2
            : state.activeStep;
        return { ...state, docs: nextDocs, activeStep: nextActiveStep };
      });
    },
    [],
  );

  const onPdfFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = ""; // allow re-adding the same file later
    if (files.length === 0) return;
    reset();
    patchSignerRuntime({ busy: true, status: m.signer_status_reading_pdfs() });
    for (const file of files) {
      const bytes = await Effect.runPromise(Effect.result(readBrowserFileBytes(file)));
      if (Result.isFailure(bytes)) {
        patchSignerRuntime({ error: bytes.failure.message });
        continue;
      }
      const id = `doc-${crypto.randomUUID()}`;
      const state = await Effect.runPromise(
        Effect.result(
          createBrowserPdfSignatureBuilderState({
            id: "browser-a1-signer",
            name: file.name,
            documentId: id,
            documentName: file.name,
            pdf: bytes.success,
            role: SIGNER_ROLE,
            draft: SIGNATURE_DRAFT,
          }),
        ),
      );
      if (Result.isFailure(state)) {
        patchSignerRuntime({ error: state.failure.message });
        continue;
      }
      const template = state.success.template;
      const store = createPdfSignatureBuilderStore(state.success);
      const entry: DocEntry = {
        id,
        name: file.name,
        pdfBytes: bytes.success,
        documentId: id,
        pageDims: template.documents[0].pages,
        template,
        store,
      };
      updateSignerRuntime((state) => ({
        ...state,
        docs: [...state.docs, entry],
        activeDocId: state.activeDocId ?? id,
      }));
    }
    patchSignerRuntime({ busy: false, status: m.signer_status_click_to_place() });
  };

  const removeDoc = (docId: string) => {
    clearBanners(); // keep any already-signed rows/downloads; only drop this doc
    updateSignerRuntime((state) => {
      const remaining = state.docs.filter((d) => d.id !== docId);
      const rows = { ...state.rows };
      delete rows[docId];
      return {
        ...state,
        docs: remaining,
        activeDocId: state.activeDocId === docId ? remaining[0]?.id : state.activeDocId,
        rows,
      };
    });
  };

  // Best guess: ask the PDF adapter to place a sensible signature rect on EVERY
  // loaded document through the same long-lived store path manual clicks use.
  const autoPlaceAll = async () => {
    if (docs.length === 0 || placing) return;
    patchSignerRuntime({
      error: "",
      run: { kind: "idle" },
      rows: {},
      status: "",
    }); // hand the status line to the DERIVED best-guess status
    placeRunStore.setState(() => ({ ran: true }));

    const queue = docs.map((doc) => ({
      id: doc.id,
      store: doc.store,
      documentId: doc.documentId,
      draft: SIGNATURE_DRAFT,
    }));
    let nextDocs = docs;
    patchSignerRuntime({ placing: true, queuedIds: queue.map((item) => item.id) });

    await Effect.runPromise(
      placePdfSignatureFieldsBatch(queue, {
        onItemStarted: (item) => {
          updateSignerRuntime((state) => ({
            ...state,
            queuedIds: state.queuedIds.filter((id) => id !== item.id),
            placingIds: [item.id],
          }));
        },
        onItemSettled: (result) => {
          if (result.ok) {
            nextDocs = nextDocs.map((doc) =>
              doc.id === result.id
                ? { ...doc, template: result.template, rect: result.field.rect }
                : doc,
            );
            patchSignerRuntime({ docs: nextDocs, activeDocId: result.id });
          } else {
            patchSignerRuntime({ error: result.error.message });
          }
        },
        yieldAfterItem: () => {
          patchSignerRuntime({ placingIds: [] });
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, 24);
          return promise;
        },
      }),
    );

    if (activeStep === 1 && nextDocs.length > 0 && nextDocs.every((doc) => doc.rect)) {
      patchSignerRuntime({ activeStep: 2 });
    }
    patchSignerRuntime({ placing: false, queuedIds: [], placingIds: [] });
  };

  const onPfxFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    reset();
    patchSignerRuntime({ profile: undefined, busy: true, status: m.signer_status_reading_cert() });
    const bytes = await Effect.runPromise(Effect.result(readBrowserFileBytes(file)));
    patchSignerRuntime({ busy: false });
    if (Result.isFailure(bytes)) {
      patchSignerRuntime({ error: bytes.failure.message });
      return;
    }
    patchSignerRuntime({ pfxBytes: bytes.success, status: m.signer_status_cert_loaded() });
  };

  const signAll = async () => {
    const placed = docs.filter((d) => d.rect);
    if (placed.length === 0)
      return patchSignerRuntime({ error: "Place at least one signature first." });
    if (!pfxBytes) return patchSignerRuntime({ error: "Upload your A1 (.pfx/.p12) certificate." });
    if (password.length === 0)
      return patchSignerRuntime({ error: "Enter the certificate password." });

    patchSignerRuntime({ error: "", busy: true, status: m.signer_status_reading_identity() });

    // Reuse the eagerly-parsed profile from Step 2 when present; only re-parse if
    // it was never loaded (or was invalidated by a password edit).
    let certValue = profile;
    if (!certValue) {
      const certificate = await Effect.runPromise(
        Effect.result(
          parseA1CertificateProfile({
            pfx: pfxBytes,
            password: Redacted.make(password),
          }),
        ),
      );
      if (Result.isFailure(certificate)) {
        patchSignerRuntime({ busy: false, error: certificate.failure.message });
        return;
      }
      certValue = certificate.success;
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
      if (rubricSource === "type" && typedText.trim()) {
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
    patchSignerRuntime({ rows: nextRows });
    let anyPrepFailed = false;
    let prepared = 0;
    patchSignerRuntime({
      run: { kind: "signing", current: 0, total: placed.length },
      status: m.signer_status_preparing(),
    });

    const items: PdfSigningBatchItem[] = [];
    for (const d of placed) {
      const rect = d.rect;
      if (!rect) continue;
      let pdf = d.pdfBytes;
      let failed = false;
      const markFailed = (message: string): void => {
        nextRows[d.id] = { status: "failed", error: message };
        anyPrepFailed = true;
        failed = true;
      };

      // Only stamp when there is actual content; an empty rubric would otherwise
      // bake boxes onto every page with nothing inside them.
      if (rubricEveryPage && hasStamp) {
        const dim = d.pageDims[rect.pageIndex];
        if (dim === undefined) {
          markFailed(m.signer_err_dimensions());
        } else {
          // Every page EXCEPT the placed one gets the small initials rubrica; the
          // placed page gets the full "Signed by" block below. Single-page docs
          // (others empty) skip the rubric pass — only the main block bakes.
          const others = d.pageDims.map((_, i) => i).filter((i) => i !== rect.pageIndex);
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
              const stamped = await Effect.runPromise(
                Effect.result(
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
                ),
              );
              if (Result.isFailure(stamped)) {
                markFailed(stamped.failure.message);
                break;
              }
              pdf = stamped.success;
            }
          }
          if (!failed) {
            try {
              pdf = await bakeStamp(pdf, {
                pageIndex: rect.pageIndex,
                rect,
                inkDataUrl: sig,
                lines,
                border: false,
              });
            } catch {
              markFailed(m.signer_err_prepare_doc());
            }
          }
        }
      } else if (hasStamp) {
        try {
          pdf = await bakeStamp(d.pdfBytes, {
            pageIndex: rect.pageIndex,
            rect,
            inkDataUrl: sig,
            lines,
            border: false,
          });
        } catch {
          markFailed(m.signer_err_prepare_doc());
        }
      }

      if (!failed) {
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
      }
      // Surface prep progress and YIELD to the browser between documents. Baking the
      // rubric on every page of 20+ multi-page PDFs is heavy pure-CPU work; without a
      // yield it pins the main thread and the counter sticks at "Signing 0 of N" (the
      // hang the user hit). This timeout-free setTimeout(0) loop terminates for any N.
      prepared += 1;
      patchSignerRuntime({ run: { kind: "signing", current: prepared, total: placed.length } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Flush all prep failures in a single update with a fresh object reference
    // (mutating nextRows in place would not re-render). Avoids per-iteration setRows.
    if (anyPrepFailed) patchSignerRuntime({ rows: { ...nextRows } });

    if (items.length === 0) {
      patchSignerRuntime({ busy: false, run: { kind: "idle" }, error: m.signer_err_none_prepared() });
      return;
    }

    // The run total now reflects only the documents that actually go to the signer.
    updateSignerRuntime((state) => ({
      ...state,
      run: { kind: "signing", current: 0, total: items.length },
      rows: { ...state.rows, [items[0].id]: { status: "signing" } },
      status: m.signer_status_signing(),
    }));
    try {
      // One Signatures layer for the whole batch (the lib runs concurrency:1 so a
      // single in-browser key signs without races). Failures are captured per item
      // (ok:false) and never abort the run, so runPromise won't reject from them.
      await Effect.runPromise(
        signBrowserPdfBatch(items, {
          onItemSettled: (result, index, total) => {
            updateSignerRuntime((state) => {
              const next: Record<string, BatchRow> = {
                ...state.rows,
                [result.id]: result.ok
                  ? { status: "signed", signedPdf: result.signedPdf }
                  : { status: "failed", error: result.error.message },
              };
              const upcoming = items[index + 1];
              if (upcoming && next[upcoming.id]?.status === "queued") {
                next[upcoming.id] = { status: "signing" };
              }
              return {
                ...state,
                run: { kind: "signing", current: index + 1, total },
                rows: next,
              };
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
    } catch {
      patchSignerRuntime({
        busy: false,
        run: { kind: "idle" },
        error: m.signer_error_signing_failed(),
      });
      return;
    }
    patchSignerRuntime({ busy: false, run: { kind: "done" }, status: m.signer_status_signed() });
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


  // Keyboard focus management for the collapses. A panel that closes becomes
  // `inert`; on user-driven advances we move focus to the newly opened step's
  // header. Auto-advance after placement keeps focus on the canvas (never inert),
  // so it must NOT trigger this.
  const headerRefs = React.useRef<
    Partial<Record<1 | 2 | 3 | 4, HTMLButtonElement | null>>
  >({});
  const goToStep = (n: 1 | 2 | 3 | 4) => {
    patchSignerRuntime({ activeStep: n });
    queueMicrotask(() => headerRefs.current[n]?.focus());
  };

  // Eager-parse the A1 on Step 2 "Continue" so `profile.subject` exists when Step 3
  // opens (the "From certificate" mark needs it) and wrong passwords surface early.
  const loadProfileThenAdvance = async () => {
    if (!pfxBytes || password.length === 0) return;
    patchSignerRuntime({ busy: true, status: m.signer_status_reading_identity() });
    const c = await Effect.runPromise(
      Effect.result(
        parseA1CertificateProfile({
          pfx: pfxBytes,
          password: Redacted.make(password),
        }),
      ),
    );
    patchSignerRuntime({ busy: false });
    if (Result.isFailure(c)) {
      patchSignerRuntime({ error: c.failure.message }); // stay on Step 2, surface the message verbatim
      return;
    }
    patchSignerRuntime({ profile: c.success });
    goToStep(3);
  };

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
    ...(signatureDataUrl ? [m.signer_bit_mark()] : []),
    ...(stampName ? [m.signer_bit_name()] : []),
    ...(stampDate ? [m.signer_bit_date()] : []),
    ...(rubricEveryPage ? [m.signer_bit_everypage()] : []),
  ];

  return (
    <form.Provider>
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
                key={activeDoc.id}
                activeDoc={activeDoc}
                stampPreview={stampPreview}
                rubricEveryPage={rubricEveryPage}
                onTemplateChange={onTemplateChange}
                onPlaced={handlePlaced}
                onError={(message) => patchSignerRuntime({ error: message })}
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
              onClick={() => patchSignerRuntime({ activeDocId: nextUnplacedId })}
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
            onOpen={() => patchSignerRuntime({ activeStep: 1 })}
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
                onSelect={(id) => patchSignerRuntime({ activeDocId: id })}
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
            onOpen={() => patchSignerRuntime({ activeStep: 2 })}
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
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void loadProfileThenAdvance();
              }}
            >
              <input
                type="text"
                autoComplete="username"
                value=""
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
              />
              <form.Field name="password">
                {(field) => (
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={field.state.value ?? ""}
                    aria-label={m.signer_cert_password()}
                    placeholder={m.signer_cert_password()}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      clearBanners();
                      patchSignerRuntime({ profile: undefined });
                      field.handleChange(e.currentTarget.value);
                    }}
                    className="rounded-md border-border bg-input/30 px-3 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                )}
              </form.Field>
            </form>
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
            onOpen={() => patchSignerRuntime({ activeStep: 3 })}
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
              <form.Field name="rubricSource">
                {(field) => (
                  <div
                    aria-labelledby="rubric-source-label"
                    className="grid grid-cols-2 gap-1.5"
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant={field.state.value === "type" ? "secondary" : "outline"}
                      onClick={() => {
                        clearBanners();
                        field.handleChange("type");
                      }}
                      className="justify-center gap-1.5 text-xs"
                    >
                      <Type className="size-3.5" /> {m.signer_mark_type()}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={field.state.value === "cert" ? "secondary" : "outline"}
                      onClick={() => {
                        clearBanners();
                        field.handleChange("cert");
                      }}
                      className="justify-center gap-1.5 text-xs"
                    >
                      <BadgeCheck className="size-3.5" /> {m.signer_mark_cert()}
                    </Button>
                  </div>
                )}
              </form.Field>

              <div className="min-h-[120px]">
                {rubricSource === "type" ? (
                  <div className="flex flex-col gap-2">
                    <form.Field name="typedText">
                      {(field) => (
                        <Input
                          type="text"
                          value={field.state.value ?? ""}
                          aria-label={m.signer_type_aria()}
                          placeholder={profile?.subject ?? m.signer_type_placeholder()}
                          onBlur={field.handleBlur}
                          onChange={(e) => {
                            clearBanners();
                            field.handleChange(e.currentTarget.value);
                          }}
                          className="rounded-md border-border bg-input/30 px-3 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        />
                      )}
                    </form.Field>
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

            <form.Field name="stampName">
              {(field) => (
                <Label
                  htmlFor="stamp-name"
                  className="gap-2 text-xs font-normal text-foreground"
                >
                  <Checkbox
                    id="stamp-name"
                    checked={field.state.value === true}
                    onCheckedChange={(v) => {
                      clearBanners();
                      field.handleChange(v === true);
                    }}
                    className="size-3.5"
                  />
                  {m.signer_chk_name()}
                </Label>
              )}
            </form.Field>
            <form.Field name="stampDate">
              {(field) => (
                <Label
                  htmlFor="stamp-date"
                  className="gap-2 text-xs font-normal text-foreground"
                >
                  <Checkbox
                    id="stamp-date"
                    checked={field.state.value === true}
                    onCheckedChange={(v) => {
                      clearBanners();
                      field.handleChange(v === true);
                    }}
                    className="size-3.5"
                  />
                  {m.signer_chk_date()}
                </Label>
              )}
            </form.Field>
            <form.Field name="rubricEveryPage">
              {(field) => (
                <Label
                  htmlFor="stamp-rubric"
                  className="gap-2 text-xs font-normal text-foreground"
                >
                  <Checkbox
                    id="stamp-rubric"
                    checked={field.state.value === true}
                    onCheckedChange={(v) => {
                      clearBanners();
                      field.handleChange(v === true);
                    }}
                    className="size-3.5"
                  />
                  {m.signer_chk_rubric()}
                </Label>
              )}
            </form.Field>
            <p className="-mt-1 pl-5 text-[11px] leading-relaxed text-muted-foreground">
              {m.signer_rubric_note_initials()}
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
            onOpen={() => patchSignerRuntime({ activeStep: 4 })}
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
                      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-4xl border border-border bg-input/30 px-3 text-sm font-medium text-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-input/50 active:scale-[0.98]"
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
    </form.Provider>
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
