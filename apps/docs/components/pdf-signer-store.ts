import { Effect, type Exit } from "effect";

import type { A1CertificateProfile } from "@signature-kit/a1/config";
import { createSyncStore, type SyncStore } from "@signature-kit/react/sync-store";
import type {
  PdfSignaturePage,
  PdfSignatureRect,
  PdfSignatureTemplate,
  PdfTextBox,
} from "@signature-kit/pdf/config";
import type { PdfSignatureBuilderStore } from "@signature-kit/pdf/builder-store";

type DocEntry = {
  readonly id: string;
  readonly name: string;
  readonly pdfBytes: Uint8Array;
  readonly documentId: string;
  readonly pageDims: ReadonlyArray<PdfSignaturePage>;
  readonly pageTextBoxes: ReadonlyArray<ReadonlyArray<PdfTextBox>>;
  readonly template: PdfSignatureTemplate;
  readonly store: PdfSignatureBuilderStore;
  readonly rect?: PdfSignatureRect;
};

type BatchRow =
  | { readonly status: "queued" }
  | { readonly status: "signing" }
  | { readonly status: "signed"; readonly signedPdf: Uint8Array }
  | { readonly status: "failed"; readonly error: string };

type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "signing"; readonly current: number; readonly total: number }
  | { readonly kind: "done" };

export type SignerRuntimeState = {
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

const signerRuntimeInitial = (): SignerRuntimeState => ({
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
});

type PlacementOwner = symbol;
export type PlacementLease = {
  readonly owner: PlacementOwner;
  readonly release: () => void;
};

type OperationScope = "workflow" | "preview";
type Interruptor = () => void;

export type PdfSignerController = {
  readonly runtimeStore: SyncStore<SignerRuntimeState>;
  readonly placeRunStore: SyncStore<{ readonly ran: boolean }>;
  readonly patchRuntime: (patch: Partial<SignerRuntimeState>) => void;
  readonly updateRuntime: (update: (state: SignerRuntimeState) => SignerRuntimeState) => void;
  readonly beginWorkflow: () => number;
  readonly beginPreview: () => number;
  readonly runWorkflowEffect: <A, E>(
    effect: Effect.Effect<A, E>,
    generation: number,
  ) => Promise<Exit.Exit<A, E>>;
  readonly runPreviewEffect: <A, E>(
    effect: Effect.Effect<A, E>,
    generation: number,
  ) => Promise<Exit.Exit<A, E>>;
  readonly runPlacementEffect: <A, E>(effect: Effect.Effect<A, E>) => Promise<Exit.Exit<A, E>>;
  readonly isCurrentWorkflow: (generation: number) => boolean;
  readonly isCurrentPreview: (generation: number) => boolean;
  readonly isDocumentMutationLocked: (owner?: PlacementOwner) => boolean;
  readonly acquirePlacementLease: () => Promise<PlacementLease | undefined>;
  readonly dispose: () => void;
};

const cancelAll = (interruptors: Set<Interruptor>): void => {
  const pending = [...interruptors];
  interruptors.clear();
  pending.forEach((interrupt) => interrupt());
};

export const createPdfSignerController = (): PdfSignerController => {
  const runtimeStore = createSyncStore<SignerRuntimeState>(signerRuntimeInitial());
  const placeRunStore = createSyncStore<{ readonly ran: boolean }>({ ran: false });
  const workflowInterruptors = new Set<Interruptor>();
  const previewInterruptors = new Set<Interruptor>();
  const placementInterruptors = new Set<Interruptor>();
  const activeLeases = new Set<() => void>();
  const pendingPlacementGates = new Set<() => void>();
  let mounted = true;
  let workflowGeneration = 0;
  let previewGeneration = 0;
  let placementTail = Promise.resolve();
  let placementOwner: PlacementOwner | undefined;

  const isCurrentWorkflow = (generation: number): boolean =>
    mounted && workflowGeneration === generation;
  const isCurrentPreview = (generation: number): boolean =>
    mounted && previewGeneration === generation;

  const runEffect = <A, E>(
    effect: Effect.Effect<A, E>,
    scope: OperationScope | "placement",
    generation?: number,
  ): Promise<Exit.Exit<A, E>> => {
    const interruptors =
      scope === "workflow"
        ? workflowInterruptors
        : scope === "preview"
          ? previewInterruptors
          : placementInterruptors;
    const owns =
      scope === "workflow"
        ? generation !== undefined && isCurrentWorkflow(generation)
        : scope === "preview"
          ? generation !== undefined && isCurrentPreview(generation)
          : mounted;
    const { promise, resolve } = Promise.withResolvers<Exit.Exit<A, E>>();
    let completed = false;
    let interrupt: Interruptor = () => {};
    interrupt = Effect.runCallback(effect, {
      onExit: (exit) => {
        completed = true;
        interruptors.delete(interrupt);
        resolve(exit);
      },
    });
    if (owns && !completed) {
      interruptors.add(interrupt);
    } else if (!completed) {
      interrupt();
    }
    return promise;
  };

  const beginWorkflow = (): number => {
    workflowGeneration += 1;
    cancelAll(workflowInterruptors);
    previewGeneration += 1;
    cancelAll(previewInterruptors);
    return workflowGeneration;
  };

  const beginPreview = (): number => {
    previewGeneration += 1;
    cancelAll(previewInterruptors);
    return previewGeneration;
  };

  const isDocumentMutationLocked = (owner?: PlacementOwner): boolean => {
    if (!mounted) return true;
    const { busy, placing } = runtimeStore.getSnapshot();
    return (
      busy ||
      (placementOwner !== undefined && placementOwner !== owner) ||
      (placing && placementOwner !== owner)
    );
  };

  const acquirePlacementLease = async (): Promise<PlacementLease | undefined> => {
    const previous = placementTail;
    const gate = Promise.withResolvers<void>();
    placementTail = gate.promise;
    pendingPlacementGates.add(gate.resolve);
    await previous;
    pendingPlacementGates.delete(gate.resolve);
    if (!mounted) {
      gate.resolve();
      return undefined;
    }
    const owner = Symbol("pdf-signer-placement");
    placementOwner = owner;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      if (placementOwner === owner) placementOwner = undefined;
      activeLeases.delete(release);
      gate.resolve();
    };
    activeLeases.add(release);
    return { owner, release };
  };

  const dispose = (): void => {
    if (!mounted) return;
    mounted = false;
    workflowGeneration += 1;
    previewGeneration += 1;
    cancelAll(workflowInterruptors);
    cancelAll(previewInterruptors);
    cancelAll(placementInterruptors);
    [...activeLeases].forEach((release) => release());
    [...pendingPlacementGates].forEach((resolve) => resolve());
    pendingPlacementGates.clear();
    runtimeStore.setState(() => signerRuntimeInitial());
    placeRunStore.setState(() => ({ ran: false }));
  };

  return {
    runtimeStore,
    placeRunStore,
    patchRuntime: (patch) => runtimeStore.setState((state) => ({ ...state, ...patch })),
    updateRuntime: (update) => runtimeStore.setState(update),
    beginWorkflow,
    beginPreview,
    runWorkflowEffect: (effect, generation) => runEffect(effect, "workflow", generation),
    runPreviewEffect: (effect, generation) => runEffect(effect, "preview", generation),
    runPlacementEffect: (effect) => runEffect(effect, "placement"),
    isCurrentWorkflow,
    isCurrentPreview,
    isDocumentMutationLocked,
    acquirePlacementLease,
    dispose,
  };
};

export type { BatchRow, DocEntry, PlacementOwner, RunState };
