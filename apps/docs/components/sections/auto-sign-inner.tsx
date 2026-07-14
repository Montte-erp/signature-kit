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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "fumadocs-ui/components/tabs.unstyled";

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
import type { Locale } from "@/lib/locale";
import { captureDocsEvent } from "@/lib/posthog/client";
import { createSyncStore, useSyncStore } from "@signature-kit/react/sync-store";
import { m } from "@/lib/client-messages";
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
  readonly pdfBytes?: Uint8Array;
  readonly signed?: boolean;
  readonly outputLocale?: Locale;
};

type PdfDocumentLoadLifecycle = {
  active: boolean;
  disposed: boolean;
  task?: PdfLoadingTask;
  doc?: PdfDocumentProxy;
};

const destroyPdfLoadingTask = (task: PdfLoadingTask | undefined): Effect.Effect<void> =>
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

const destroyPdfDocumentLoad = (lifecycle: PdfDocumentLoadLifecycle): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (lifecycle.disposed) return Effect.void;
    lifecycle.disposed = true;
    lifecycle.active = false;
    const task = lifecycle.task;
    const doc = lifecycle.doc;
    lifecycle.task = undefined;
    lifecycle.doc = undefined;
    return Effect.gen(function* () {
      yield* destroyPdfLoadingTask(task);
      if (doc !== undefined) yield* destroyPdfDocument(doc);
    });
  });

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
    const task = yield* Effect.try({
      try: () => pdfjs.getDocument({ data: bytes.slice() }),
      catch: () => "pdf-document-task-failed",
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (task === undefined) {
      yield* destroyPdfDocumentLoad(lifecycle);
      return undefined;
    }
    lifecycle.task = task;
    const loaded = yield* Effect.tryPromise({
      try: () => task.promise,
      catch: () => "pdf-load-failed",
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (loaded === undefined) {
      yield* destroyPdfDocumentLoad(lifecycle);
      return undefined;
    }
    if (!lifecycle.active || lifecycle.disposed) {
      yield* destroyPdfDocument(loaded);
      return undefined;
    }
    lifecycle.doc = loaded;
    return loaded;
  });

type AutoState = {
  readonly docs: ReadonlyArray<AutoDoc>;
  readonly status: Readonly<Record<string, DocPhase>>;
  readonly activeIndex: number;
  readonly busy: boolean;
};

type QueueItem = {
  readonly id: string;
  readonly mode: "prepare" | "sign";
  readonly outputLocale: Locale;
};
const statusEntry = (id: string, phase: DocPhase): readonly [string, DocPhase] => [id, phase];

const autoDocIdPart = (id: string, index: number): string =>
  `${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`;

const initialState = (): AutoState => ({
  docs: DEMO_DOCS.map((d) => ({ id: d.id })),
  status: Object.fromEntries(DEMO_DOCS.map((d) => statusEntry(d.id, "queued"))),
  activeIndex: 0,
  busy: false,
});

const store = createSyncStore<AutoState>(initialState());
let queueGeneration = 0;

const ownsGeneration = (generation: number): boolean => queueGeneration === generation;

const setPhase = (id: string, phase: DocPhase, generation: number): void => {
  if (!ownsGeneration(generation)) return;
  store.setState((s) => ({ ...s, status: { ...s.status, [id]: phase } }));
};

const patchDoc = (id: string, patch: Partial<AutoDoc>, generation: number): void => {
  if (!ownsGeneration(generation)) return;
  store.setState((s) => ({
    ...s,
    docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
  }));
};

const focusDoc = (index: number): void => store.setState((s) => ({ ...s, activeIndex: index }));

const demoDoc = (id: string) => DEMO_DOCS.find((d) => d.id === id);

const renderQueueItem = (item: QueueItem, generation: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!ownsGeneration(generation) || getLocale() !== item.outputLocale) return;
    const demo = demoDoc(item.id);
    if (demo === undefined) return;
    focusDoc(DEMO_DOCS.findIndex((d) => d.id === item.id));
    const paragraphs = demo.paragraphs;
    const variant: SignatureVariant = demo.variant;
    const title = demo.name();

    if (item.mode === "prepare") {
      setPhase(item.id, "generating", generation);
      const bytes = yield* Effect.promise(() =>
        generateFormalContractPdf({ title, paragraphs, variant }),
      );
      if (!ownsGeneration(generation) || getLocale() !== item.outputLocale) return;
      patchDoc(
        item.id,
        { pdfBytes: bytes, signed: false, outputLocale: item.outputLocale },
        generation,
      );
      setPhase(item.id, "ready", generation);
      return;
    }

    setPhase(item.id, "signing", generation);
    const signed: SignedMark = {
      ...SIGNER,
      date: new Date().toLocaleString(item.outputLocale),
    };
    const bytes = yield* Effect.promise(() =>
      generateFormalContractPdf({ title, paragraphs, variant, signed }),
    );
    if (!ownsGeneration(generation) || getLocale() !== item.outputLocale) return;
    patchDoc(
      item.id,
      { pdfBytes: bytes, signed: true, outputLocale: item.outputLocale },
      generation,
    );
    setPhase(item.id, "signed", generation);
  });

const runQueueItems = (items: ReadonlyArray<QueueItem>, generation: number): Effect.Effect<void> =>
  Effect.forEach(items, (item) => renderQueueItem(item, generation), { discard: true }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (!ownsGeneration(generation)) return;
        store.setState((s) => ({ ...s, busy: false }));
      }),
    ),
  );

const startQueue = (mode: QueueItem["mode"], outputLocale: Locale): void => {
  const generation = ++queueGeneration;
  store.setState((s) => ({ ...initialState(), activeIndex: s.activeIndex, busy: true }));
  void Effect.runPromiseExit(
    runQueueItems(
      DEMO_DOCS.map((demo) => ({ id: demo.id, mode, outputLocale })),
      generation,
    ),
  );
};

const ensurePrepared = (locale: Locale): void => {
  const state = store.getSnapshot();
  const isPrepared = DEMO_DOCS.every((demo) => {
    const doc = state.docs.find((candidate) => candidate.id === demo.id);
    const phase = state.status[demo.id];
    return doc?.outputLocale === locale && (phase === "ready" || phase === "signed");
  });

  if (isPrepared) return;
  startQueue("prepare", locale);
};

const invalidatePreparation = (generation: number): void => {
  if (!ownsGeneration(generation)) return;
  queueGeneration += 1;
  store.setState((s) => ({ ...initialState(), activeIndex: s.activeIndex }));
};

const go = (to: number): void => {
  const n = DEMO_DOCS.length;
  focusDoc(((to % n) + n) % n);
};

const autoSign = (): void => {
  if (store.getSnapshot().busy) return;
  captureDocsEvent("auto_sign_demo_started", {
    document_count: DEMO_DOCS.length,
  });
  startQueue("sign", getLocale());
};

const resetDemo = (): void => {
  if (store.getSnapshot().busy) return;
  captureDocsEvent("auto_sign_demo_reset", {
    document_count: DEMO_DOCS.length,
  });
  startQueue("prepare", getLocale());
};

function downloadDoc(doc: AutoDoc): void {
  const demo = demoDoc(doc.id);
  if (demo === undefined || !doc.pdfBytes || doc.outputLocale !== getLocale()) return;
  captureDocsEvent("auto_sign_demo_downloaded", {
    document_id: doc.id,
    signed: doc.signed ?? false,
  });
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(doc.pdfBytes)], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${demo.name()}.pdf`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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

function AutoDocCanvas({
  doc,
  phase,
  isOutputCurrent,
}: {
  doc: AutoDoc;
  phase: DocPhase | undefined;
  isOutputCurrent: boolean;
}) {
  const [pdfDoc, setPdfDoc] = React.useState<PdfDocumentProxy | null>(null);
  const bytes = isOutputCurrent ? doc.pdfBytes : undefined;
  const mountPdf = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null || bytes === undefined) return;
      const lifecycle: PdfDocumentLoadLifecycle = { active: true, disposed: false };
      setPdfDoc(null);
      void Effect.runPromise(loadPdfDocumentFromBytes(bytes, lifecycle)).then((loaded) => {
        if (lifecycle.active && loaded !== undefined) setPdfDoc(loaded);
      });
      return () => {
        lifecycle.active = false;
        setPdfDoc(null);
        void Effect.runPromise(destroyPdfDocumentLoad(lifecycle));
      };
    },
    [bytes],
  );

  if (bytes && pdfDoc) {
    return (
      <div ref={mountPdf}>
        <PdfPage
          doc={pdfDoc}
          pageNumber={1}
          widthPt={595.28}
          heightPt={841.89}
          onPlace={() => {}}
        />
      </div>
    );
  }

  return (
    <div
      ref={mountPdf}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={phase === "queued" ? m.autosign_doc_queued() : m.autosign_doc_generating()}
      className="flex aspect-[595/842] w-full items-center justify-center gap-2 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground"
    >
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      <span>{phase === "queued" ? m.autosign_doc_queued() : m.autosign_doc_generating()}…</span>
    </div>
  );
}

export function AutoSignInner() {
  const docs = useSyncStore(store, (s) => s.docs);
  const status = useSyncStore(store, (s) => s.status);
  const activeIndex = useSyncStore(store, (s) => s.activeIndex);
  const busy = useSyncStore(store, (s) => s.busy);
  const locale = getLocale();
  React.useEffect(() => {
    ensurePrepared(locale);
    return () => invalidatePreparation(queueGeneration);
  }, [locale]);

  const allSigned = docs.every((doc) => doc.outputLocale === locale && status[doc.id] === "signed");
  const count = docs.length;
  const activeDoc = docs[activeIndex] ?? docs[0];
  const activeDemo = activeDoc === undefined ? undefined : demoDoc(activeDoc.id);
  const activeOutputCurrent = activeDoc?.outputLocale === locale;
  const activePhase = activeDoc && activeOutputCurrent ? status[activeDoc.id] : "queued";

  const documentValues = docs.map((doc, docIndex) => `${doc.id}-${docIndex}`);
  const documentPanelIds = docs.map(
    (doc, docIndex) => `auto-sign-panel-${autoDocIdPart(doc.id, docIndex)}`,
  );
  const documentTabIds = docs.map(
    (doc, docIndex) => `auto-sign-tab-${autoDocIdPart(doc.id, docIndex)}`,
  );
  const activeValue = documentValues[activeIndex] ?? documentValues[0];

  return (
    <Tabs
      value={activeValue}
      orientation="vertical"
      onValueChange={(value) => {
        const nextIndex = documentValues.indexOf(value);
        if (nextIndex >= 0) go(nextIndex);
      }}
      className="mt-10 grid gap-6 lg:grid-cols-[1fr_22rem]"
    >
      <Card className="overflow-hidden p-0 shadow-none">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {activeDemo?.name()}
          </span>
          {activeDemo !== undefined ? (
            <Badge
              variant="outline"
              className="hidden shrink-0 font-mono text-[10px] font-normal text-muted-foreground sm:inline-flex"
            >
              {activeDemo.variantLabel()}
            </Badge>
          ) : null}
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
            {activeIndex + 1} / {count}
          </span>
          {activeDoc?.signed && activeOutputCurrent ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 gap-1 px-2 text-xs"
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
            className="size-11 shrink-0 rounded-full"
            aria-label={m.autosign_prev()}
            onClick={() => go(activeIndex - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 rounded-full"
            aria-label={m.autosign_next()}
            onClick={() => go(activeIndex + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="bg-muted/30 p-4">
          {docs.map((doc, docIndex) => (
            <TabsContent
              key={doc.id}
              value={documentValues[docIndex]}
              id={documentPanelIds[docIndex]}
              aria-labelledby={documentTabIds[docIndex]}
              forceMount
              className="m-0 min-w-0 p-0"
            >
              {docIndex === activeIndex && activeDoc ? (
                <AutoDocCanvas
                  key={activeDoc.id}
                  doc={activeDoc}
                  phase={activePhase}
                  isOutputCurrent={activeOutputCurrent}
                />
              ) : null}
            </TabsContent>
          ))}
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className="min-h-11" onClick={autoSign} disabled={busy}>
            {busy ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <Wand2 data-icon="inline-start" />
            )}
            {busy ? m.autosign_running() : m.autosign_cta()}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            onClick={resetDemo}
            disabled={busy}
          >
            <RotateCcw data-icon="inline-start" />
            {m.autosign_reset()}
          </Button>
        </div>

        <TabsList aria-label={m.autosign_eyebrow()} className="flex min-w-0 flex-col gap-1.5">
          {docs.map((d, i) => {
            const demo = demoDoc(d.id);
            if (demo === undefined) return null;

            return (
              <TabsTrigger
                key={d.id}
                type="button"
                value={documentValues[i]}
                id={documentTabIds[i]}
                aria-controls={documentPanelIds[i]}
                className={cn(
                  "flex min-h-11 w-full items-center justify-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-normal transition-colors focus-visible:outline-3 focus-visible:outline-ring focus-visible:outline-offset-2",
                  i === activeIndex
                    ? "border-foreground/30 bg-muted/40"
                    : "border-border hover:bg-muted/30",
                )}
              >
                <PenLine aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="w-full truncate text-foreground">{demo.name()}</span>
                  <span className="w-full truncate text-[10px] font-normal text-muted-foreground">
                    {demo.variantLabel()}
                  </span>
                </span>
                <DocBadge phase={d.outputLocale === locale ? status[d.id] : "queued"} />
              </TabsTrigger>
            );
          })}
        </TabsList>

        <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
          {allSigned ? m.autosign_done() : m.autosign_note()}
        </p>
      </div>
    </Tabs>
  );
}
