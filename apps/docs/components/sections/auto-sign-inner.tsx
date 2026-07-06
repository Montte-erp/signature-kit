"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  PenLine,
  RotateCcw,
  Wand2,
} from "lucide-react";
import * as React from "react";
import { Effect } from "effect";

import {
  generateFormalContractPdf,
  type SignatureVariant,
  type SignedMark,
} from "@/components/formal-contract-pdf";
import {
  PdfPage,
  loadPdfjs,
  type PdfDocumentProxy,
  type PdfLoadingTask,
} from "@/components/pdf-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { captureDocsEvent } from "@/lib/posthog/client";
import { createSyncStore, useSyncStore } from "@/lib/sync-store";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";



const LOREM = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
  "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt neque porro quisquam est.",
  "Qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.",
];

const DEMO_DOCS: ReadonlyArray<{
  readonly id: string;
  readonly name: () => string;
  readonly paragraphs: ReadonlyArray<string>;
  readonly variant: SignatureVariant;
  readonly variantLabel: () => string;
}> = [
  {
    id: "doc-contrato",
    name: m.autosign_doc_contract_name,
    paragraphs: LOREM.slice(0, 5),
    variant: "line",
    variantLabel: m.autosign_variant_line,
  },
  {
    id: "doc-aditivo",
    name: m.autosign_doc_amendment_name,
    paragraphs: LOREM.slice(0, 3),
    variant: "field",
    variantLabel: m.autosign_variant_field,
  },
  {
    id: "doc-procuracao",
    name: m.autosign_doc_poa_name,
    paragraphs: LOREM.slice(1, 5),
    variant: "witnessed",
    variantLabel: m.autosign_variant_witnessed,
  },
  {
    id: "doc-adesao",
    name: m.autosign_doc_terms_name,
    paragraphs: LOREM.slice(0, 4),
    variant: "initials",
    variantLabel: m.autosign_variant_initials,
  },
];

const SIGNER: Omit<SignedMark, "date"> = {
  name: "Maria A. Costa",
  document: "CPF/CNPJ: 000.000.000-00",
};


type DocPhase = "queued" | "generating" | "ready" | "signing" | "signed";

type AutoDoc = {
  readonly id: string;
  readonly name: string;
  readonly variantLabel: string;
  readonly pdfBytes?: Uint8Array;
  readonly signed?: boolean;
};

type PdfDocumentLoadLifecycle = {
  active: boolean;
  task?: PdfLoadingTask;
};

const destroyPdfLoadingTask = (
  task: PdfLoadingTask | undefined,
): Effect.Effect<void> =>
  task?.destroy === undefined
    ? Effect.void
    : Effect.tryPromise({
        try: () => task.destroy?.() ?? Promise.resolve(),
        catch: () => "pdf-task-destroy-failed",
      }).pipe(Effect.ignore, Effect.asVoid);

const destroyPdfDocument = (doc: PdfDocumentProxy): Effect.Effect<void> =>
  doc.destroy === undefined
    ? Effect.void
    : Effect.tryPromise({
        try: () => doc.destroy?.() ?? Promise.resolve(),
        catch: () => "pdf-document-destroy-failed",
      }).pipe(Effect.ignore, Effect.asVoid);

const loadPdfDocumentFromBytes = (
  bytes: Uint8Array,
  lifecycle: PdfDocumentLoadLifecycle,
): Effect.Effect<PdfDocumentProxy | undefined> =>
  Effect.gen(function* () {
    const pdfjs = yield* Effect.tryPromise({
      try: () => loadPdfjs(),
      catch: () => "pdfjs-load-failed",
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (pdfjs === undefined || !lifecycle.active) return undefined;
    const task = pdfjs.getDocument({ data: bytes.slice() });
    lifecycle.task = task;
    const loaded = yield* Effect.tryPromise({
      try: () => task.promise,
      catch: () => "pdf-load-failed",
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (loaded === undefined) return undefined;
    if (lifecycle.active) return loaded;
    yield* destroyPdfDocument(loaded);
    return undefined;
  });

type AutoState = {
  readonly docs: ReadonlyArray<AutoDoc>;
  readonly status: Readonly<Record<string, DocPhase>>;
  readonly activeIndex: number;
  readonly busy: boolean;
};

type QueueItem = { readonly id: string; readonly name: string; readonly mode: "prepare" | "sign" };
const statusEntry = (id: string, phase: DocPhase): readonly [string, DocPhase] => [id, phase];

const initialState = (): AutoState => ({
  docs: DEMO_DOCS.map((d) => ({ id: d.id, name: d.name(), variantLabel: d.variantLabel() })),
  status: Object.fromEntries(DEMO_DOCS.map((d) => statusEntry(d.id, "queued"))),
  activeIndex: 0,
  busy: false,
});


const store = createSyncStore<AutoState>(initialState());

const setPhase = (id: string, phase: DocPhase): void =>
  store.setState((s) => ({ ...s, status: { ...s.status, [id]: phase } }));

const patchDoc = (id: string, patch: Partial<AutoDoc>): void =>
  store.setState((s) => ({
    ...s,
    docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
  }));

const focusDoc = (index: number): void => store.setState((s) => ({ ...s, activeIndex: index }));

const queueItemDemo = (item: QueueItem) => DEMO_DOCS.find((d) => d.id === item.id);

const renderQueueItem = (item: QueueItem): Effect.Effect<void> =>
  Effect.gen(function* () {
    focusDoc(DEMO_DOCS.findIndex((d) => d.id === item.id));
    const demo = queueItemDemo(item);
    const paragraphs = demo?.paragraphs ?? [];
    const variant: SignatureVariant = demo?.variant ?? "line";

    if (item.mode === "prepare") {
      setPhase(item.id, "generating");
      const bytes = yield* Effect.promise(() =>
        generateFormalContractPdf({ title: item.name, paragraphs, variant }),
      );
      patchDoc(item.id, { pdfBytes: bytes, signed: false });
      setPhase(item.id, "ready");
      return;
    }

    setPhase(item.id, "signing");
    const signed: SignedMark = { ...SIGNER, date: new Date().toLocaleString(getLocale()) };
    const bytes = yield* Effect.promise(() =>
      generateFormalContractPdf({
        title: item.name,
        paragraphs,
        variant,
        signed,
      }),
    );
    patchDoc(item.id, { pdfBytes: bytes, signed: true });
    setPhase(item.id, "signed");
  });

const runQueueItems = (items: ReadonlyArray<QueueItem>): Effect.Effect<void> =>
  store.getSnapshot().busy
    ? Effect.void
    : Effect.sync(() => store.setState((s) => ({ ...s, busy: true }))).pipe(
        Effect.flatMap(() => Effect.forEach(items, renderQueueItem, { discard: true })),
        Effect.ensuring(Effect.sync(() => store.setState((s) => ({ ...s, busy: false })))),
      );

void Effect.runPromiseExit(
  runQueueItems(DEMO_DOCS.map((demo) => ({ id: demo.id, name: demo.name(), mode: "prepare" }))),
);

const go = (to: number): void => {
  const n = DEMO_DOCS.length;
  focusDoc(((to % n) + n) % n);
};

const autoSign = (): void => {
  if (store.getSnapshot().busy) return;
  captureDocsEvent("auto_sign_demo_started", {
    document_count: DEMO_DOCS.length,
  });
  store.setState((s) => ({
    ...s,
    docs: s.docs.map((d) => ({ ...d, signed: false })),
    status: Object.fromEntries(
      DEMO_DOCS.map((d) => {
        const prepared = s.docs.find((x) => x.id === d.id)?.pdfBytes;
        return statusEntry(d.id, prepared ? "ready" : "queued");
      }),
    ),
  }));
  void Effect.runPromiseExit(
    runQueueItems(DEMO_DOCS.map((demo) => ({ id: demo.id, name: demo.name(), mode: "sign" }))),
  );
};

const resetDemo = (): void => {
  if (store.getSnapshot().busy) return;
  captureDocsEvent("auto_sign_demo_reset", {
    document_count: DEMO_DOCS.length,
  });
  store.setState(() => initialState());
  void Effect.runPromiseExit(
    runQueueItems(DEMO_DOCS.map((demo) => ({ id: demo.id, name: demo.name(), mode: "prepare" }))),
  );
};

function downloadDoc(doc: AutoDoc): void {
  if (!doc.pdfBytes) return;
  captureDocsEvent("auto_sign_demo_downloaded", {
    document_id: doc.id,
    signed: doc.signed ?? false,
  });
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(doc.pdfBytes)], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.name}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}


function DocBadge({ phase }: { phase: DocPhase | undefined }) {
  if (phase === "signed")
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 /> {m.autosign_doc_signed()}
      </Badge>
    );
  if (phase === "ready")
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        {m.autosign_doc_ready()}
      </Badge>
    );
  if (phase === "generating")
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="animate-spin" /> {m.autosign_doc_generating()}
      </Badge>
    );
  if (phase === "signing")
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="animate-spin" /> {m.autosign_doc_signing()}
      </Badge>
    );
  if (phase === "queued")
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {m.autosign_doc_queued()}
      </Badge>
    );
  return null;
}


function AutoDocCanvas({ doc }: { doc: AutoDoc }) {
  const [pdfDoc, setPdfDoc] = React.useState<PdfDocumentProxy | null>(null);
  const bytes = doc.pdfBytes;
  const mountPdf = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null || bytes === undefined) return;
      const lifecycle: PdfDocumentLoadLifecycle = { active: true };
      setPdfDoc(null);
      void Effect.runPromise(loadPdfDocumentFromBytes(bytes, lifecycle)).then((loaded) => {
        if (lifecycle.active && loaded !== undefined) setPdfDoc(loaded);
      });
      return () => {
        lifecycle.active = false;
        setPdfDoc(null);
        void Effect.runPromise(destroyPdfLoadingTask(lifecycle.task));
      };
    },
    [bytes],
  );

  if (bytes && pdfDoc) {
    return (
      <div ref={mountPdf}>
        <PdfPage doc={pdfDoc} pageNumber={1} widthPt={595.28} heightPt={841.89} onPlace={() => {}} />
      </div>
    );
  }

  return (
    <div
      ref={mountPdf}
      className="flex aspect-[595/842] w-full items-center justify-center gap-2 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" />
      {m.autosign_doc_generating()}…
    </div>
  );
}


export function AutoSignInner() {
  const docs = useSyncStore(store, (s) => s.docs);
  const status = useSyncStore(store, (s) => s.status);
  const activeIndex = useSyncStore(store, (s) => s.activeIndex);
  const busy = useSyncStore(store, (s) => s.busy);

  const allSigned = DEMO_DOCS.every((d) => status[d.id] === "signed");
  const count = docs.length;
  const activeDoc = docs[activeIndex] ?? docs[0];

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_22rem]">
      {/* CAROUSEL — one real react-pdf page at a time; the worker snaps it to the
          document it is signing so you watch each field fill in live. */}
      <Card className="overflow-hidden p-0 shadow-none">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {activeDoc?.name}
          </span>
          {activeDoc?.variantLabel ? (
            <Badge
              variant="outline"
              className="hidden shrink-0 font-mono text-[10px] font-normal text-muted-foreground sm:inline-flex"
            >
              {activeDoc.variantLabel}
            </Badge>
          ) : null}
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
            {activeIndex + 1} / {count}
          </span>
          {activeDoc?.signed ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => activeDoc && downloadDoc(activeDoc)}
            >
              <Download className="size-3.5" />
              {m.autosign_download()}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7 rounded-full"
            aria-label={m.autosign_prev()}
            onClick={() => go(activeIndex - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7 rounded-full"
            aria-label={m.autosign_next()}
            onClick={() => go(activeIndex + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="bg-muted/30 p-4">
          {activeDoc ? <AutoDocCanvas key={activeDoc.id} doc={activeDoc} /> : null}
        </div>
      </Card>

      {/* Controls + per-document Effect queue status. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={autoSign} disabled={busy}>
            {busy ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Wand2 data-icon="inline-start" />
            )}
            {busy ? m.autosign_running() : m.autosign_cta()}
          </Button>
          <Button type="button" variant="ghost" onClick={resetDemo} disabled={busy}>
            <RotateCcw data-icon="inline-start" />
            {m.autosign_reset()}
          </Button>
        </div>

        <ul className="flex flex-col gap-1.5">
          {docs.map((d, i) => (
            <li key={d.id}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => go(i)}
                aria-pressed={i === activeIndex}
                className={cn(
                  "h-auto w-full justify-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-normal",
                  i === activeIndex
                    ? "border-foreground/30 bg-muted/40"
                    : "border-border hover:bg-muted/30",
                )}
              >
                <PenLine className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="w-full truncate text-foreground">{d.name}</span>
                  <span className="w-full truncate text-[10px] font-normal text-muted-foreground">
                    {d.variantLabel}
                  </span>
                </span>
                <DocBadge phase={status[d.id]} />
              </Button>
            </li>
          ))}
        </ul>

        <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
          {allSigned ? m.autosign_done() : m.autosign_note()}
        </p>
      </div>
    </div>
  );
}
