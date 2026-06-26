"use client";

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
} from "@cantoo/pdf-lib";
import { Effect, Redacted } from "effect";
import { Check, ChevronDown, ExternalLink, Loader2, Lock, PenLine } from "lucide-react";
import * as React from "react";

import type { A1CertificateProfile } from "@signature-kit/a1/config";
import { a1SignaturesLayer, parseA1CertificateProfile } from "@signature-kit/a1/signer";
import type { PdfSignatureAnchor } from "@signature-kit/pdf/config";
import { signPdf } from "@signature-kit/pdf/sign";
import { stampPdfRubric } from "@signature-kit/pdf/stamp";
import { readBrowserFileBytes } from "@signature-kit/react/browser-pdf";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/*
 * Slot reuse / best-guess in-browser signer — a sibling of <PdfSigner />.
 *
 * Instead of "upload a PDF + click to place", this island BOOTS from a runtime
 * generated "pre-marked" declaration that already carries three empty named /Sig
 * widgets (mirroring formats/pdf/__tests__/pdf.test.ts
 * createDeclarationPdfWithSignatureSlots). You pick a target slot — or "Best
 * guess (auto)" — and SignatureKit REUSES that empty widget instead of inventing
 * a rectangle.
 *
 * Slot reuse lives in resolveAutoPlacement → chooseExistingSignatureSlot
 * (formats/pdf/src/placement.ts), reached ONLY through an
 * appearance.placement.kind === "auto". signBrowserPdf always synthesises a
 * manual widgetRect from the template field, so it can never trigger reuse —
 * hence this demo drops to the PDF-layer `signPdf`. The cryptographic pipeline
 * (a1SignaturesLayer, PAdES, signatureLength 16384, WebCrypto) is identical.
 *
 * The page is 320×180 points (PDF bottom-left origin). Overlay maths convert the
 * bottom-left slot rects to the top-left origin the DOM uses.
 */

const PAGE_WIDTH = 320;
const PAGE_HEIGHT = 180;
// Auto placement margins (placement.ts DEFAULT_AUTO_MARGIN = 36). The page
// bounds the library searches; the existing-slot branch returns before any fit
// check, so the small page is fine.
const AUTO_MARGIN = 36;
const DEFAULT_AUTO_ANCHOR: PdfSignatureAnchor = "bottom-right";

// The three pre-marked slots, copied 1:1 from the test's slot-builder. Each rect
// is [left, bottom, right, top] in PDF points (bottom-left origin). The `anchor`
// is the auto anchor that selects this slot (proven by the placement test).
const SAMPLE_SLOTS = [
  { label: "Declarante", anchor: "top-left", rect: [20, 118, 140, 158] },
  { label: "Testemunha", anchor: "middle-center", rect: [100, 68, 220, 108] },
  { label: "Responsável legal", anchor: "bottom-right", rect: [180, 20, 300, 60] },
] as const satisfies ReadonlyArray<{
  readonly label: string;
  readonly anchor: PdfSignatureAnchor;
  readonly rect: readonly [number, number, number, number];
}>;

type Coords = readonly [number, number, number, number];
type RectTL = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

interface SlotInfo {
  readonly label: string;
  readonly anchor: PdfSignatureAnchor;
  readonly rectPdf: Coords;
  readonly rectTL: RectTL;
}

type TargetOption = {
  readonly value: PdfSignatureAnchor | "auto";
  readonly label: string;
  readonly hint: string;
};

const TARGET_OPTIONS: ReadonlyArray<TargetOption> = [
  { value: "auto", label: "Best guess (auto)", hint: "Nearest the bottom-right anchor" },
  { value: "top-left", label: "Declarante", hint: "top-left" },
  { value: "middle-center", label: "Testemunha", hint: "center" },
  { value: "bottom-right", label: "Responsável legal", hint: "bottom-right" },
];

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

// bottom-left rect [l,b,r,t] → top-left {x,y,width,height} for DOM overlays.
const toTopLeft = (rect: Coords, pageHeight: number): RectTL => ({
  x: rect[0],
  y: pageHeight - rect[3],
  width: rect[2] - rect[0],
  height: rect[3] - rect[1],
});

// ---------------------------------------------------------------------------
// Local mirror of placement.ts chooseExistingSignatureSlot (≤15 lines). Drives
// the live preview + the visible stamp target only — the library performs the
// AUTHORITATIVE selection at sign time. placement.ts is the source of truth; the
// post-sign "signed" badge is read back from the real /V widget rect.
// ---------------------------------------------------------------------------

const anchorPoint = (rect: Coords, anchor: PdfSignatureAnchor): readonly [number, number] => {
  const cx = (rect[0] + rect[2]) / 2;
  const cy = (rect[1] + rect[3]) / 2;
  switch (anchor) {
    case "bottom-left":
      return [rect[0], rect[1]];
    case "bottom-center":
      return [cx, rect[1]];
    case "bottom-right":
      return [rect[2], rect[1]];
    case "middle-left":
      return [rect[0], cy];
    case "middle-center":
      return [cx, cy];
    case "middle-right":
      return [rect[2], cy];
    case "top-left":
      return [rect[0], rect[3]];
    case "top-center":
      return [cx, rect[3]];
    case "top-right":
      return [rect[2], rect[3]];
  }
};

const squaredAnchorDistance = (candidate: Coords, bounds: Coords, anchor: PdfSignatureAnchor): number => {
  const target = anchorPoint(bounds, anchor);
  const point = anchorPoint(candidate, anchor);
  const dx = target[0] - point[0];
  const dy = target[1] - point[1];
  return dx * dx + dy * dy;
};

const pickNearestSlot = (slots: ReadonlyArray<SlotInfo>, anchor: PdfSignatureAnchor): SlotInfo | undefined => {
  const bounds: Coords = [AUTO_MARGIN, AUTO_MARGIN, PAGE_WIDTH - AUTO_MARGIN, PAGE_HEIGHT - AUTO_MARGIN];
  let best: SlotInfo | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const score = squaredAnchorDistance(slot.rectPdf, bounds, anchor);
    if (score < bestScore) {
      bestScore = score;
      best = slot;
    }
  }
  return best;
};

// ---------------------------------------------------------------------------
// Sample PDF generation. Assembles a declaration with three EMPTY /Sig widgets —
// the same object shape Licitei's custom component would emit to pre-mark a
// position. Copied 1:1 from createDeclarationPdfWithSignatureSlots in
// formats/pdf/__tests__/pdf.test.ts.
// ---------------------------------------------------------------------------

async function buildSamplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawText("DECLARAÇÃO DE CAPACIDADE TÉCNICA", { x: 34, y: 158, size: 13 });
  page.drawText("Declaramos para fins de habilitação que a empresa cumpriu o objeto.", {
    x: 28,
    y: 138,
    size: 8,
  });
  page.drawText("Declarante", { x: 48, y: 160, size: 7 });
  page.drawText("Testemunha", { x: 134, y: 110, size: 7 });
  page.drawText("Responsável legal", { x: 206, y: 62, size: 7 });

  const annotations = pdf.context.obj([]);
  const fields = pdf.context.obj([]);
  for (const slot of SAMPLE_SLOTS) {
    const rect = PDFArray.withContext(pdf.context);
    for (const n of slot.rect) rect.push(PDFNumber.of(n));
    const widget = pdf.context.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      Rect: rect,
      T: PDFString.of(slot.label),
      F: 4,
      P: page.ref,
    });
    const widgetRef = pdf.context.register(widget);
    annotations.push(widgetRef);
    fields.push(widgetRef);
  }
  page.node.set(PDFName.of("Annots"), annotations);
  const acroForm = pdf.context.obj({ Fields: fields });
  pdf.catalog.set(PDFName.of("AcroForm"), pdf.context.register(acroForm));

  return new Uint8Array(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));
}

const rectFromArray = (array: PDFArray): Coords | undefined => {
  if (array.size() !== 4) return undefined;
  const l = array.lookupMaybe(0, PDFNumber)?.asNumber();
  const b = array.lookupMaybe(1, PDFNumber)?.asNumber();
  const r = array.lookupMaybe(2, PDFNumber)?.asNumber();
  const t = array.lookupMaybe(3, PDFNumber)?.asNumber();
  if (l === undefined || b === undefined || r === undefined || t === undefined) return undefined;
  return [l, b, r, t];
};

// Empty /Sig detection — identical predicate to placement.ts pageSignatureSlots:
// Subtype /Widget + FT /Sig + no /V. Reads back the slots from the sample bytes
// to prove the document arrives pre-marked.
async function readEmptySigSlots(pdfBytes: Uint8Array): Promise<ReadonlyArray<SlotInfo>> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPages()[0];
  if (!page) return [];
  const pageHeight = page.getHeight();
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return [];

  const found: SlotInfo[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const annot = pdfDoc.context.lookupMaybe(annots.get(i), PDFDict);
    const subtype = annot?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString();
    const fieldType = annot?.lookupMaybe(PDFName.of("FT"), PDFName)?.asString();
    const rectArray = annot?.lookupMaybe(PDFName.of("Rect"), PDFArray);
    const rect = rectArray === undefined ? undefined : rectFromArray(rectArray);
    if (
      subtype === "/Widget" &&
      fieldType === "/Sig" &&
      annot?.get(PDFName.of("V")) === undefined &&
      rect !== undefined
    ) {
      const match = SAMPLE_SLOTS.find((s) => s.rect.every((n, idx) => n === rect[idx]));
      found.push({
        label: match?.label ?? "Signature",
        anchor: match?.anchor ?? DEFAULT_AUTO_ANCHOR,
        rectPdf: rect,
        rectTL: toTopLeft(rect, pageHeight),
      });
    }
  }
  return found;
}

// Post-sign read: the FILLED widget keeps the same Rect but now carries /V. Same
// scan as the test's readSignedWidgetRects — proves the signature landed in the
// pre-marked rect.
async function readSignedSlotRect(pdfBytes: Uint8Array): Promise<RectTL | undefined> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPages()[0];
  if (!page) return undefined;
  const pageHeight = page.getHeight();
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return undefined;

  for (let i = 0; i < annots.size(); i++) {
    const annot = pdfDoc.context.lookupMaybe(annots.get(i), PDFDict);
    const rectArray = annot?.lookupMaybe(PDFName.of("Rect"), PDFArray);
    const rect = rectArray === undefined ? undefined : rectFromArray(rectArray);
    if (annot?.get(PDFName.of("V")) !== undefined && rect !== undefined) {
      return toTopLeft(rect, pageHeight);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// pdf.js page rendering (same CDN-worker helper as pdf-signer.tsx).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDocumentProxy = any;

const loadPdfjs = async () => {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  return pdfjs;
};

/** One rendered page with absolutely-positioned overlay children. */
function PageCanvas({
  doc,
  widthPt,
  heightPt,
  children,
}: {
  doc: PdfDocumentProxy;
  widthPt: number;
  heightPt: number;
  children: React.ReactNode;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let task: any;
    (async () => {
      const page = await doc.getPage(1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 2 });
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
  }, [doc]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-border bg-white"
      style={{ aspectRatio: `${widthPt} / ${heightPt}` }}
    >
      <canvas ref={canvasRef} aria-hidden className="block h-auto w-full select-none" />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step chrome — same accordion machinery as pdf-signer.tsx (locked/active/done/
// todo, one open at a time, aria-expanded headers, grid-rows collapse).
// ---------------------------------------------------------------------------

type StepStatus = "locked" | "active" | "done" | "todo";

function Step({
  n,
  title,
  status,
  summary,
  hint,
  onOpen,
  headerRef,
  children,
}: {
  n: number;
  title: string;
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
  const headId = `slotstep-head-${n}`;
  const panelId = `slotstep-panel-${n}`;
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card transition-colors",
        locked && "opacity-50",
        open && "border-foreground/30",
      )}
    >
      <Button
        ref={headerRef}
        type="button"
        variant="ghost"
        id={headId}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={locked}
        onClick={onOpen}
        className={cn(
          "h-auto w-full justify-start gap-2.5 rounded-lg px-4 py-3 text-left font-normal whitespace-normal hover:bg-muted/30 disabled:pointer-events-auto disabled:opacity-100",
          locked ? "cursor-not-allowed hover:bg-transparent" : "cursor-pointer",
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
          {done ? <Check className="size-3" /> : locked ? <Lock className="size-2.5" /> : n}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {done && summary ? (
            <span className="mt-0.5 truncate text-[11px] text-muted-foreground">{summary}</span>
          ) : null}
          {locked && hint ? (
            <span className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</span>
          ) : null}
        </span>
        {done ? (
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Edit</span>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// The slot-reuse signer
// ---------------------------------------------------------------------------

export function SlotReuseSigner({ className }: { className?: string }) {
  const [sampleBytes, setSampleBytes] = React.useState<Uint8Array | undefined>();
  const [slots, setSlots] = React.useState<ReadonlyArray<SlotInfo>>([]);
  const [doc, setDoc] = React.useState<PdfDocumentProxy | undefined>();

  const [target, setTarget] = React.useState<PdfSignatureAnchor | "auto">("auto");
  // "Best guess (auto)" is a real default selection — the canvas already paints
  // where it lands — so Step 1 is satisfiable immediately and Continue is live.
  const [confirmed, setConfirmed] = React.useState(true);

  const pfxInputRef = React.useRef<HTMLInputElement | null>(null);
  const [pfxBytes, setPfxBytes] = React.useState<Uint8Array | undefined>();
  const [password, setPassword] = React.useState("");
  const [profile, setProfile] = React.useState<A1CertificateProfile | undefined>();

  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [error, setError] = React.useState("");

  const [signed, setSigned] = React.useState<Uint8Array | undefined>();
  const [landedRectTL, setLandedRectTL] = React.useState<RectTL | undefined>();

  const reset = React.useCallback(() => {
    setSigned(undefined);
    setLandedRectTL(undefined);
    setError("");
    setStatus("");
  }, []);

  // Build the pre-marked sample once on mount, then read its empty /Sig slots.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bytes = await buildSamplePdf();
        const read = await readEmptySigSlots(bytes);
        if (cancelled) return;
        setSampleBytes(bytes);
        setSlots(read);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to build the sample PDF.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Render the signed bytes once present, otherwise the pre-marked sample. pdf.js
  // detaches the buffer it is given, so render from a slice.
  const renderBytes = signed ?? sampleBytes;
  React.useEffect(() => {
    if (!renderBytes) return;
    let cancelled = false;
    setDoc(undefined);
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const loaded = await pdfjs.getDocument({ data: renderBytes.slice() }).promise;
        if (!cancelled) setDoc(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to render the PDF.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [renderBytes]);

  // Live preview of the slot the library will pick. With three slots at distinct
  // corners the nearest-anchor result is unambiguous, so predicted === actual.
  const predicted = pickNearestSlot(slots, target === "auto" ? DEFAULT_AUTO_ANCHOR : target);

  const labelFor = (value: PdfSignatureAnchor | "auto"): string =>
    value === "auto"
      ? "Best guess (auto)"
      : (SAMPLE_SLOTS.find((s) => s.anchor === value)?.label ?? "Signature");

  const selectTarget = (value: PdfSignatureAnchor | "auto") => {
    reset();
    setTarget(value);
    setConfirmed(true);
  };

  const onPfxFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    reset();
    setProfile(undefined);
    setBusy(true);
    setStatus("Reading certificate…");
    const bytes = await runEffect(readBrowserFileBytes(file));
    setBusy(false);
    if (!bytes.ok) {
      setError(bytes.message);
      return;
    }
    setPfxBytes(bytes.value);
    setStatus("Certificate loaded in browser memory. Enter the password.");
  };

  const sign = async () => {
    if (!sampleBytes || !predicted) return setError("The sample document is still loading.");
    if (!pfxBytes) return setError("Upload your A1 (.pfx/.p12) certificate.");
    if (password.length === 0) return setError("Enter the certificate password.");

    reset();
    setBusy(true);
    setStatus("Reading the A1 identity…");

    const cert = await runEffect(
      parseA1CertificateProfile({ pfx: pfxBytes, password: Redacted.make(password) }),
    );
    if (!cert.ok) {
      setBusy(false);
      setError(cert.message);
      return;
    }
    setProfile(cert.value);

    // Visible mark drawn INTO the predicted slot's rect as page content. The slot
    // rect is already [left, bottom, right, top] — exactly what stampPdfRubric
    // wants, so no conversion. The empty /Sig widget is untouched, so signPdf
    // still detects and fills it, and the one PAdES signature covers the stamp.
    setStatus("Marking the slot…");
    const lines = [
      cert.value.subject,
      `CPF/CNPJ: ${cert.value.document}`,
      new Date().toLocaleDateString("pt-BR"),
    ];
    const stamped = await runEffect(
      stampPdfRubric(sampleBytes, {
        rect: predicted.rectPdf,
        pages: [0],
        lines,
        border: true,
      }),
    );
    if (!stamped.ok) {
      setBusy(false);
      setError(stamped.message);
      return;
    }

    // Slot reuse lives ONLY in resolveAutoPlacement → chooseExistingSignatureSlot,
    // reached through appearance.placement.kind === "auto". Omitting the anchor
    // falls to DEFAULT_AUTO_ANCHOR "bottom-right".
    setStatus("Signing in your browser with WebCrypto…");
    const out = await runEffect(
      signPdf({
        pdf: stamped.value,
        reason: "Signed into a pre-marked slot with SignatureKit",
        name: cert.value.subject,
        location: "Browser",
        signingTime: new Date(),
        signatureLength: 16384,
        // Plain PAdES (AdES-BES). The ICP-Brasil policy would require a network
        // fetch, breaking the "nothing leaves the page" guarantee this demo makes.
        policy: "pades-ades",
        appearance: {
          placement: {
            kind: "auto",
            pageIndex: 0,
            ...(target === "auto" ? {} : { anchor: target }),
          },
        },
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx: pfxBytes, password: Redacted.make(password) }))),
    );
    if (!out.ok) {
      setBusy(false);
      setError(out.message);
      return;
    }

    const landed = await readSignedSlotRect(out.value);
    setSigned(out.value);
    setLandedRectTL(landed);
    setBusy(false);
    setStatus(
      `Signed into the “${predicted.label}” slot — download and verify in any PAdES reader.`,
    );
  };

  const download = () => {
    if (!signed) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(signed)], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "declaration-signed.pdf";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Progressive-disclosure flow state — exactly one step open; status derived from
  // live predicates so it can't desync.
  const [activeStep, setActiveStep] = React.useState<1 | 2 | 3>(1);
  // Seed the "was done" ref as already-true so the default selection doesn't fire
  // the false→true auto-advance and skip Step 1 on mount — the user drives the
  // jump with Continue (or by changing the target).
  const prevStep1Done = React.useRef(true);
  const step1Done = confirmed;
  const step2Done = Boolean(pfxBytes && password.length > 0);

  React.useEffect(() => {
    if (step1Done && !prevStep1Done.current && activeStep === 1) setActiveStep(2);
    prevStep1Done.current = step1Done;
  }, [step1Done, activeStep]);

  const headerRefs = React.useRef<Partial<Record<1 | 2 | 3, HTMLButtonElement | null>>>({});
  const focusNextHeader = React.useRef(false);
  const goToStep = (n: 1 | 2 | 3) => {
    focusNextHeader.current = true;
    setActiveStep(n);
  };
  React.useEffect(() => {
    if (!focusNextHeader.current) return;
    focusNextHeader.current = false;
    headerRefs.current[activeStep]?.focus();
  }, [activeStep]);

  const statusOf = (n: 1 | 2 | 3): StepStatus =>
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
        : !step2Done
          ? "locked"
          : activeStep === 3
            ? "active"
            : signed
              ? "done"
              : "todo";

  const canSign = Boolean(sampleBytes && pfxBytes && password.length > 0 && !busy);

  return (
    <div className={cn("@container", className)}>
      <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
        {/* LEFT / TOP — the pre-marked document. Single source of truth: empty,
            selectable slots before signing; the one filled slot after. */}
        <div className="sticky top-0 z-10 min-w-0 self-start bg-background pb-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Pre-marked document</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {slots.length} empty /Sig
            </span>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            {!doc ? (
              <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Building the sample…
              </div>
            ) : (
              <PageCanvas doc={doc} widthPt={PAGE_WIDTH} heightPt={PAGE_HEIGHT}>
                {/* After signing: the landed /V rect, read back from the bytes. */}
                {signed && landedRectTL ? (
                  <div
                    className="pointer-events-none absolute rounded-sm border-2 border-foreground bg-foreground/5"
                    style={{
                      left: `${(landedRectTL.x / PAGE_WIDTH) * 100}%`,
                      top: `${(landedRectTL.y / PAGE_HEIGHT) * 100}%`,
                      width: `${(landedRectTL.width / PAGE_WIDTH) * 100}%`,
                      height: `${(landedRectTL.height / PAGE_HEIGHT) * 100}%`,
                    }}
                  >
                    <span className="absolute -top-5 left-0 flex items-center gap-1 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background">
                      <Check className="size-2.5" />
                      signed
                    </span>
                  </div>
                ) : null}

                {/* Before signing: the empty slots, selectable. */}
                {!signed
                  ? slots.map((slot) => {
                      const isTarget = predicted?.label === slot.label;
                      return (
                        <Button
                          key={slot.label}
                          type="button"
                          variant="ghost"
                          aria-label={`Slot: ${slot.label}, ${slot.anchor}${
                            isTarget ? " — signature lands here" : ""
                          }`}
                          aria-pressed={isTarget}
                          onClick={() => selectTarget(slot.anchor)}
                          className={cn(
                            "absolute h-auto rounded-sm p-0 transition-colors active:translate-y-0",
                            isTarget
                              ? "border-2 border-foreground bg-foreground/5 hover:bg-foreground/5"
                              : "border border-dashed border-border bg-background/40 hover:border-foreground/50 hover:bg-background/40",
                          )}
                          style={{
                            left: `${(slot.rectTL.x / PAGE_WIDTH) * 100}%`,
                            top: `${(slot.rectTL.y / PAGE_HEIGHT) * 100}%`,
                            width: `${(slot.rectTL.width / PAGE_WIDTH) * 100}%`,
                            height: `${(slot.rectTL.height / PAGE_HEIGHT) * 100}%`,
                          }}
                        >
                          <span
                            className={cn(
                              "absolute -top-5 left-0 flex items-center whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px]",
                              isTarget
                                ? "bg-foreground text-background"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {isTarget ? "lands here" : "empty /Sig"}
                          </span>
                        </Button>
                      );
                    })
                  : null}
              </PageCanvas>
            )}
          </div>
          {status ? (
            <p className="mt-2 px-0.5 text-xs leading-relaxed text-muted-foreground">{status}</p>
          ) : null}
        </div>

        {/* RIGHT / BELOW — the guided accordion */}
        <div className="flex flex-col gap-2.5">
          {/* STEP 1 — Target slot */}
          <Step
            n={1}
            title="Target slot"
            status={statusOf(1)}
            onOpen={() => setActiveStep(1)}
            headerRef={(el) => {
              headerRefs.current[1] = el;
            }}
            summary={labelFor(target)}
          >
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              This PDF arrives pre-marked — it already carries empty
              <code className="mx-1 font-mono text-foreground">/Sig</code>
              slots. Pick where the signature lands; SignatureKit reuses that slot instead of
              inventing a rectangle.
            </p>
            <fieldset>
              <legend className="sr-only">Target signature slot</legend>
              <RadioGroup
                value={target}
                onValueChange={(value) => selectTarget(value as PdfSignatureAnchor | "auto")}
                className="flex flex-col gap-1.5"
              >
                {TARGET_OPTIONS.map((option) => {
                  const checked = target === option.value;
                  const optionId = `slot-target-${option.value}`;
                  return (
                    <Label
                      key={option.value}
                      htmlFor={optionId}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-xs transition-colors focus-within:ring-[3px] focus-within:ring-ring/50",
                        checked
                          ? "border-foreground/30 bg-muted/40 text-foreground"
                          : "border-border text-foreground hover:bg-muted/30",
                      )}
                    >
                      <RadioGroupItem
                        id={optionId}
                        value={option.value}
                        className="size-3.5"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">{option.label}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {option.hint}
                        </span>
                      </span>
                    </Label>
                  );
                })}
              </RadioGroup>
            </fieldset>
            <Button onClick={() => goToStep(2)} disabled={!step1Done} className="w-full">
              Continue
            </Button>
          </Step>

          {/* STEP 2 — A1 certificate */}
          <Step
            n={2}
            title="A1 certificate"
            status={statusOf(2)}
            onOpen={() => setActiveStep(2)}
            headerRef={(el) => {
              headerRefs.current[2] = el;
            }}
            hint="Pick a target slot first"
            summary={
              profile
                ? `${profile.subject} · ${profile.document}`
                : "Loaded · password set"
            }
          >
            <Button
              type="button"
              variant="outline"
              onClick={() => pfxInputRef.current?.click()}
              className="h-auto px-3 py-2 text-xs"
            >
              <Lock className="size-3.5" />
              {pfxBytes ? "Replace .pfx / .p12" : "Upload .pfx / .p12"}
            </Button>
            <input
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              className="hidden"
              ref={pfxInputRef}
              onChange={onPfxFile}
            />
            <Input
              type="password"
              value={password}
              aria-label="Certificate password"
              placeholder="Certificate password"
              onChange={(e) => {
                reset();
                setPassword(e.currentTarget.value);
              }}
              className="w-full bg-input/30 text-sm text-foreground"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The .pfx stays in local memory and the password is wrapped in
              <code className="mx-1 font-mono text-foreground">Redacted</code>. Nothing is uploaded.
            </p>
            {profile ? (
              <p className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                {profile.subject} · {profile.document}
              </p>
            ) : null}
            <Button onClick={() => goToStep(3)} disabled={!step2Done} className="w-full">
              Continue
            </Button>
          </Step>

          {/* STEP 3 — Sign */}
          <Step
            n={3}
            title="Sign"
            status={statusOf(3)}
            onOpen={() => setActiveStep(3)}
            headerRef={(el) => {
              headerRefs.current[3] = el;
            }}
            hint="Add your certificate first"
            summary={signed ? "Signed · ready to download" : ""}
          >
            {!signed ? (
              <>
                <Button onClick={() => void sign()} disabled={!canSign} className="w-full">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
                  Sign in the browser
                </Button>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  SignatureKit fills the empty
                  <code className="mx-1 font-mono text-foreground">/Sig</code>
                  widget it picks — one PAdES signature over the stamped bytes.
                </p>
              </>
            ) : (
              <>
                <Button onClick={download} className="w-full">
                  <Check className="size-4" />
                  Download signed PDF
                </Button>
                <Button asChild variant="outline" className="w-full text-foreground">
                  <a href="https://validar.iti.gov.br/" target="_blank" rel="noreferrer">
                    Validate at validar.iti.gov.br
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void sign()}
                  disabled={!canSign}
                  className="w-full"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
                  Sign again
                </Button>
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
