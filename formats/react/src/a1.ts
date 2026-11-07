/// <reference types="vite/client" />
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
} from "@signature-kit/signatures";
import { Effect, Exit, Redacted, Result, Schema, Scope } from "effect";
import { makeObservedA1WorkerSession } from "./a1-worker-client.js";
import type { Result as EffectResult } from "effect/Result";
import { createSyncStore, useSyncStore } from "./sync-store.js";
import { A1CertificateLoadInputSchema, A1SignerInputSchema } from "./config.js";
import type {
  A1CertificateLoadOutcome,
  A1CertificateSnapshot,
  A1SignerCredentials,
  A1SignerInput,
  A1SignerRow,
  A1SignerRunOutcome,
  A1SignerSnapshot,
} from "./config.js";
import type { A1CertificateProfile } from "@signature-kit/a1/config";

const initialCertificateState: A1CertificateSnapshot = {
  status: "idle",
  profile: null,
  error: null,
};

type WorkerSession = Effect.Success<ReturnType<typeof makeObservedA1WorkerSession>>;
let loadedSession: {
  readonly worker: WorkerSession;
  readonly generation: number;
  readonly owner: Scope.Closeable;
} | null = null;
const closingSessions = new Set<Promise<boolean>>();
const activeOperations = new Set<Promise<unknown>>();
let closeOutcomes: boolean[] | null = null;
let disposal: Promise<ReadonlyArray<boolean>> | null = null;

const makeA1WorkerSession = makeObservedA1WorkerSession((drained) => closeOutcomes?.push(drained));

const closeLoadedSession = (): void => {
  const session = loadedSession;
  loadedSession = null;
  if (session !== null) {
    // effect-boundary: hook event action [allow-run: hook event-action boundary]
    const closing = Effect.runPromise(
      session.worker.close.pipe(Effect.ensuring(Scope.close(session.owner, Exit.void))),
    );
    closingSessions.add(closing);
    void closing.then(() => closingSessions.delete(closing));
  }
};

const initialSignerState: A1SignerSnapshot = {
  busy: false,
  rows: [],
  error: null,
};

const certificateStore = createSyncStore<A1CertificateSnapshot>(initialCertificateState);
const signerStore = createSyncStore<A1SignerSnapshot>(initialSignerState);
type OperationInterruptor = () => void;

let certificateInterruptor: OperationInterruptor | null = null;
let signerInterruptor: OperationInterruptor | null = null;

const interruptedOperationError = (): SignatureKitError =>
  new SignatureKitError({
    code: SignatureKitErrorCodeValue.unsupportedOperation,
    retryable: false,
    reason: "The A1 operation was interrupted before it completed.",
    operation: SignatureKitOperationValue.schemaDecode,
  });

const interruptCertificateOperation = (): void => {
  const interruptor = certificateInterruptor;
  certificateInterruptor = null;
  interruptor?.();
};

const interruptSignerOperation = (): void => {
  const interruptor = signerInterruptor;
  signerInterruptor = null;
  interruptor?.();
};

let certificateOperation = 0;
let signerOperation = 0;

const updateCertificateState = (
  operation: number,
  update: (state: A1CertificateSnapshot) => A1CertificateSnapshot,
): void => {
  if (operation !== certificateOperation) return;
  certificateStore.setState(update);
};

const updateSignerState = (
  operation: number,
  update: (state: A1SignerSnapshot) => A1SignerSnapshot,
): void => {
  if (operation !== signerOperation) return;
  signerStore.setState(update);
};

const rowName = (document: A1SignerInput["documents"][number]): string =>
  document.name ?? document.id;

const pendingRows = (documents: A1SignerInput["documents"]): ReadonlyArray<A1SignerRow> =>
  documents.map((document) => ({ id: document.id, name: rowName(document), status: "pending" }));

const replaceRow = (operation: number, row: A1SignerRow): void => {
  updateSignerState(operation, (state) => ({
    ...state,
    rows: state.rows.map((candidate) => (candidate.id === row.id ? row : candidate)),
  }));
};
const failingRows = (
  rows: ReadonlyArray<A1SignerRow>,
  error: SignatureKitError,
): ReadonlyArray<A1SignerRow> =>
  rows.map((row) =>
    row.status === "signed" || row.status === "failed" ? row : { ...row, status: "failed", error },
  );

const resolveA1SignerSession = (
  credentials: A1SignerCredentials | undefined,
): Effect.Effect<
  { readonly worker: WorkerSession; readonly generation: number; readonly temporary: boolean },
  SignatureKitError,
  Scope.Scope
> => {
  if (credentials !== undefined && "pfx" in credentials) {
    const password = Redacted.make(credentials.password);
    return Effect.gen(function* () {
      const worker = yield* makeA1WorkerSession;
      const initialized = yield* worker.client
        .Initialize({ pfx: credentials.pfx, password: Redacted.value(password) })
        .pipe(
          Effect.catchTag("RpcClientError", () =>
            Effect.fail(
              new SignatureKitError({
                code: SignatureKitErrorCodeValue.unsupportedOperation,
                retryable: false,
                reason: "A1 worker communication failed.",
              }),
            ),
          ),
        );
      return { worker, generation: initialized.generation, temporary: true };
    });
  }
  const session = loadedSession;
  const profile = certificateStore.getSnapshot().profile;
  if (
    session === null ||
    profile === null ||
    (credentials !== undefined && credentials.profile.fingerprint !== profile.fingerprint)
  ) {
    return Effect.fail(
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.invalidInput,
        retryable: false,
        reason: "A1 signing requires explicit pfx/password credentials or a loaded certificate.",
        operation: SignatureKitOperationValue.schemaDecode,
        schemaName: "A1SignerCredentials",
      }),
    );
  }
  return Effect.succeed({ ...session, temporary: false });
};

export const clearA1Certificate = (): void => {
  certificateOperation += 1;
  interruptCertificateOperation();
  closeLoadedSession();
  interruptSignerOperation();
  signerOperation += 1;
  signerStore.setState(() => initialSignerState);
  certificateStore.setState(() => initialCertificateState);
};

const loadCertificate = async (
  pfx: Uint8Array,
  // secret-boundary: React hook action accepts a UI password and immediately wraps it in Redacted [allow-string-secret: hook event-action boundary]
  password: string,
): Promise<A1CertificateLoadOutcome> => {
  const operation = ++certificateOperation;
  interruptCertificateOperation();
  closeLoadedSession();
  interruptSignerOperation();
  signerOperation += 1;
  signerStore.setState(() => initialSignerState);

  updateCertificateState(operation, (state) => ({
    ...state,
    status: "loading",
    profile: null,
    error: null,
  }));
  const program = Schema.decodeUnknownEffect(A1CertificateLoadInputSchema)({ pfx, password }).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          reason: "A1 certificate hook input failed schema validation.",
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: "A1CertificateLoadInput",
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) => {
      const password = Redacted.make(valid.password);
      return Effect.gen(function* () {
        const ownership = yield* Effect.acquireRelease(
          Scope.make().pipe(Effect.map((owner) => ({ owner, adopted: false }))),
          (ownership) =>
            ownership.adopted ? Effect.void : Scope.close(ownership.owner, Exit.void),
        );
        const owner = ownership.owner;
        const worker = yield* makeA1WorkerSession.pipe(Scope.provide(owner));
        const initialized = yield* worker.client
          .Initialize({ pfx: valid.pfx, password: Redacted.value(password) })
          .pipe(
            Effect.catchTag("RpcClientError", () =>
              Effect.fail(
                new SignatureKitError({
                  code: SignatureKitErrorCodeValue.unsupportedOperation,
                  retryable: false,
                  reason: "A1 worker communication failed.",
                }),
              ),
            ),
            Effect.onError(() => Scope.close(owner, Exit.void)),
          );
        yield* Effect.sync(() => {
          if (operation === certificateOperation) {
            loadedSession = { worker, generation: initialized.generation, owner };
            ownership.adopted = true;
          }
        });
        return { ...initialized, worker, owner };
      });
    }),
    Effect.scoped,
  );

  // effect-boundary: React hook event action [allow-run: hook event-action boundary]
  const result = await new Promise<
    EffectResult<
      {
        readonly profile: A1CertificateProfile;
        readonly generation: number;
        readonly worker: WorkerSession;
        readonly owner: Scope.Closeable;
      },
      SignatureKitError
    >
  >((resolve) => {
    let completed = false;
    // effect-boundary: React hook event action [allow-run: hook event-action boundary]
    const interruptor = Effect.runCallback(Effect.result(program), {
      onExit: (exit) => {
        completed = true;
        if (operation === certificateOperation) certificateInterruptor = null;
        resolve(exit._tag === "Success" ? exit.value : Result.fail(interruptedOperationError()));
      },
    });
    if (!completed && operation === certificateOperation) certificateInterruptor = interruptor;
  });

  if (Result.isFailure(result)) {
    updateCertificateState(operation, () => ({
      status: "error",
      profile: null,
      error: result.failure,
    }));
    return { ok: false, error: result.failure };
  }

  if (operation !== certificateOperation) {
    // effect-boundary: hook event action [allow-run: hook event-action boundary]
    await Effect.runPromise(Scope.close(result.success.owner, Exit.void));
    return { ok: false, error: interruptedOperationError() };
  }
  updateCertificateState(operation, () => ({
    status: "ready",
    profile: result.success.profile,
    error: null,
  }));
  return { ok: true, profile: result.success.profile };
};

export const clearA1Signer = (): void => {
  signerOperation += 1;
  interruptSignerOperation();
  signerStore.setState(() => initialSignerState);
};

const signDocuments = async (input: A1SignerInput): Promise<A1SignerRunOutcome> => {
  if (signerStore.getSnapshot().busy) {
    const busyConflict = new SignatureKitError({
      code: SignatureKitErrorCodeValue.invalidInput,
      retryable: false,
      reason: "An A1 signing operation is already in progress.",
    });
    signerStore.setState((state) => ({ ...state, error: busyConflict }));
    return { ok: false, error: busyConflict };
  }

  const operation = ++signerOperation;
  interruptSignerOperation();

  updateSignerState(operation, () => ({ ...initialSignerState, busy: true }));

  const program = Schema.decodeUnknownEffect(A1SignerInputSchema)(input).pipe(
    Effect.mapError(
      (issue) =>
        new SignatureKitError({
          code: SignatureKitErrorCodeValue.invalidInput,
          retryable: false,
          reason: "A1 signer hook input failed schema validation.",
          operation: SignatureKitOperationValue.schemaDecode,
          schemaName: "A1SignerInput",
          issueMessage: String(issue),
        }),
    ),
    Effect.tap((valid) =>
      Effect.sync(() =>
        updateSignerState(operation, (state) => ({ ...state, rows: pendingRows(valid.documents) })),
      ),
    ),
    Effect.flatMap((valid) =>
      resolveA1SignerSession(valid.credentials).pipe(
        Effect.flatMap((session) =>
          Effect.forEach(valid.documents, (document): Effect.Effect<A1SignerRow> => {
            const name = rowName(document);
            const stampSize = document.stampSize ?? valid.stamp?.stampSize;
            return Effect.sync(() =>
              replaceRow(operation, { id: document.id, name, status: "signing" }),
            ).pipe(
              Effect.flatMap(() =>
                session.worker.client
                  .Sign({
                    generation: session.generation,
                    input: {
                      pdf: document.pdf,
                      documentId: document.id,
                      ...(document.name === undefined ? {} : { documentName: document.name }),
                      ...(document.pages === undefined ? {} : { pages: document.pages }),
                      ...(document.pageTextBoxes === undefined
                        ? {}
                        : { pageTextBoxes: document.pageTextBoxes }),
                      ...(document.stampRects === undefined
                        ? {}
                        : { stampRects: document.stampRects }),
                      ...(document.anchors === undefined ? {} : { anchors: document.anchors }),
                      ...(stampSize === undefined ? {} : { stampSize }),
                      ...(valid.stamp?.badge === undefined ? {} : { badge: valid.stamp.badge }),
                      ...(valid.stamp?.lines === undefined ? {} : { lines: valid.stamp.lines }),
                      ...(valid.stamp?.inkPng === undefined ? {} : { inkPng: valid.stamp.inkPng }),
                      ...(valid.stamp?.border === undefined ? {} : { border: valid.stamp.border }),
                      ...(valid.stamp?.qr === undefined ? {} : { qr: valid.stamp.qr }),
                      ...(valid.stamp?.rubric === undefined ? {} : { rubric: valid.stamp.rubric }),
                      signing: valid.signing,
                    },
                  })
                  .pipe(
                    Effect.catchTag("RpcClientError", () =>
                      Effect.fail(
                        new SignatureKitError({
                          code: SignatureKitErrorCodeValue.unsupportedOperation,
                          retryable: false,
                          reason: "A1 worker communication failed.",
                        }),
                      ),
                    ),
                    Effect.result,
                  ),
              ),
              Effect.flatMap((result) =>
                Effect.sync((): A1SignerRow => {
                  const row: A1SignerRow = Result.isSuccess(result)
                    ? { id: document.id, name, status: "signed", signedPdf: result.success }
                    : { id: document.id, name, status: "failed", error: result.failure };
                  replaceRow(operation, row);
                  return row;
                }),
              ),
            );
          }).pipe(Effect.ensuring(session.temporary ? session.worker.close : Effect.void)),
        ),
      ),
    ),
    Effect.scoped,
    Effect.ensuring(
      Effect.sync(() => updateSignerState(operation, (state) => ({ ...state, busy: false }))),
    ),
  );

  // effect-boundary: React hook event action [allow-run: hook event-action boundary]
  const result = await new Promise<EffectResult<ReadonlyArray<A1SignerRow>, SignatureKitError>>(
    (resolve) => {
      let completed = false;
      // effect-boundary: React hook event action [allow-run: hook event-action boundary]
      const interruptor = Effect.runCallback(Effect.result(program), {
        onExit: (exit) => {
          completed = true;
          if (operation === signerOperation) signerInterruptor = null;
          resolve(exit._tag === "Success" ? exit.value : Result.fail(interruptedOperationError()));
        },
      });
      if (!completed && operation === signerOperation) signerInterruptor = interruptor;
    },
  );

  if (Result.isFailure(result)) {
    updateSignerState(operation, (state) => ({
      ...state,
      error: result.failure,
      rows: failingRows(state.rows, result.failure),
    }));
    return { ok: false, error: result.failure };
  }

  updateSignerState(operation, (state) => ({ ...state, error: null }));

  return { ok: true, rows: result.success };
};

const trackOperation = <A>(operation: Promise<A>): Promise<A> => {
  activeOperations.add(operation);
  void operation.then(() => activeOperations.delete(operation));
  return operation;
};

export const loadA1Certificate = (
  pfx: Uint8Array,
  // secret-boundary: React hook event action [allow-string-secret: hook event-action boundary]
  password: string,
): Promise<A1CertificateLoadOutcome> =>
  disposal === null
    ? trackOperation(loadCertificate(pfx, password))
    : Promise.resolve({ ok: false, error: interruptedOperationError() });

export const signA1Documents = (input: A1SignerInput): Promise<A1SignerRunOutcome> =>
  disposal === null
    ? trackOperation(signDocuments(input))
    : Promise.resolve({ ok: false, error: interruptedOperationError() });

export const disposeA1Session = (): Promise<ReadonlyArray<boolean>> => {
  if (disposal !== null) return disposal;
  const outcomes: boolean[] = [];
  closeOutcomes = outcomes;
  disposal = Promise.resolve().then(async () => {
    clearA1Certificate();
    await Promise.all(activeOperations);
    await Promise.all(closingSessions);
    closeOutcomes = null;
    disposal = null;
    return outcomes;
  });
  return disposal;
};

if (import.meta.hot !== undefined) {
  // oxlint-disable-next-line typescript/no-misused-promises -- Vite awaits the dispose callback at runtime.
  import.meta.hot.dispose(async () => {
    await disposeA1Session();
  });
}

export type A1CertificateHook = A1CertificateSnapshot & {
  // secret-boundary: React hook action accepts a UI password and immediately wraps it in Redacted [allow-string-secret: hook event-action boundary]
  readonly load: (pfx: Uint8Array, password: string) => Promise<A1CertificateLoadOutcome>;
  readonly clear: () => void;
};

export type A1SignerHook = A1SignerSnapshot & {
  readonly sign: (input: A1SignerInput) => Promise<A1SignerRunOutcome>;
  readonly clear: () => void;
};

export const useA1Certificate = (): A1CertificateHook => {
  const snapshot = useSyncStore(certificateStore, (state) => state);

  return {
    status: snapshot.status,
    profile: snapshot.profile,
    error: snapshot.error,
    load: loadA1Certificate,
    clear: clearA1Certificate,
  };
};

export const useA1Signer = (): A1SignerHook => {
  const snapshot = useSyncStore(signerStore, (state) => state);

  return {
    busy: snapshot.busy,
    rows: snapshot.rows,
    error: snapshot.error,
    sign: signA1Documents,
    clear: clearA1Signer,
  };
};

export const getLoadedA1CertificateProfile = (): A1CertificateProfile | null =>
  certificateStore.getSnapshot().profile;
