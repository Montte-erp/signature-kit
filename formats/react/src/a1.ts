import { parseA1CertificateProfile, a1SignaturesLayer } from "@signature-kit/a1/signer";
import {
  SignatureKitError,
  SignatureKitErrorCodeValue,
  SignatureKitOperationValue,
} from "@signature-kit/signatures";
import { prepareAndSignPdf } from "@signature-kit/pdf/workflow";
import { liteParseWorkerBrowserLayer } from "@signature-kit/pdf/liteparse-browser";
import { Effect, Layer, Redacted, Result, Schema } from "effect";
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

type A1CertificateCredentials = {
  readonly pfx: Uint8Array;
  readonly password: Redacted.Redacted<string>;
};

type A1CertificateStoreState = A1CertificateSnapshot & {
  readonly credentials: A1CertificateCredentials | null;
};

const initialCertificateState: A1CertificateStoreState = {
  status: "idle",
  profile: null,
  error: null,
  credentials: null,
};

const initialSignerState: A1SignerSnapshot = {
  busy: false,
  rows: [],
  error: null,
};

const certificateStore = createSyncStore<A1CertificateStoreState>(initialCertificateState);
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
  update: (state: A1CertificateStoreState) => A1CertificateStoreState,
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

const resolveA1SignerCredentials = (
  credentials: A1SignerCredentials | undefined,
): Effect.Effect<A1CertificateCredentials, SignatureKitError> => {
  const stored = certificateStore.getSnapshot();

  if (credentials === undefined) {
    return stored.credentials === null
      ? Effect.fail(
          new SignatureKitError({
            code: SignatureKitErrorCodeValue.invalidInput,
            retryable: false,
            reason:
              "A1 signing requires explicit pfx/password credentials or a loaded certificate.",
            operation: SignatureKitOperationValue.schemaDecode,
            schemaName: "A1SignerCredentials",
          }),
        )
      : Effect.succeed(stored.credentials);
  }

  if ("pfx" in credentials) {
    return Effect.succeed({ pfx: credentials.pfx, password: Redacted.make(credentials.password) });
  }

  if (
    stored.credentials === null ||
    stored.profile === null ||
    stored.profile.fingerprint !== credentials.profile.fingerprint
  ) {
    return Effect.fail(
      new SignatureKitError({
        code: SignatureKitErrorCodeValue.invalidInput,
        retryable: false,
        reason: "The requested A1 certificate profile is not loaded in the hook store.",
        operation: SignatureKitOperationValue.schemaDecode,
        schemaName: "A1SignerCredentials",
      }),
    );
  }

  return Effect.succeed(stored.credentials);
};

export const clearA1Certificate = (): void => {
  certificateOperation += 1;
  interruptCertificateOperation();
  certificateStore.setState(() => initialCertificateState);
};

export const loadA1Certificate = async (
  pfx: Uint8Array,
  // secret-boundary: React hook action accepts a UI password and immediately wraps it in Redacted [allow-string-secret: hook event-action boundary]
  password: string,
): Promise<A1CertificateLoadOutcome> => {
  const operation = ++certificateOperation;
  interruptCertificateOperation();

  updateCertificateState(operation, (state) => ({
    ...state,
    status: "loading",
    profile: null,
    error: null,
    credentials: null,
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
    Effect.flatMap((valid) =>
      parseA1CertificateProfile({ pfx: valid.pfx, password: Redacted.make(valid.password) }).pipe(
        Effect.map((profile) => ({ profile, credentials: valid })),
      ),
    ),
  );

  // effect-boundary: React hook event action [allow-run: hook event-action boundary]
  const result = await new Promise<
    EffectResult<
      {
        readonly profile: A1CertificateProfile;
        readonly credentials: { readonly pfx: Uint8Array; readonly password: string };
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
      credentials: null,
    }));
    return { ok: false, error: result.failure };
  }

  const credentials = {
    pfx: result.success.credentials.pfx,
    password: Redacted.make(result.success.credentials.password),
  };
  updateCertificateState(operation, () => ({
    status: "ready",
    profile: result.success.profile,
    error: null,
    credentials,
  }));
  return { ok: true, profile: result.success.profile };
};

export const clearA1Signer = (): void => {
  signerOperation += 1;
  interruptSignerOperation();
  signerStore.setState(() => initialSignerState);
};

export const signA1Documents = async (input: A1SignerInput): Promise<A1SignerRunOutcome> => {
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
      resolveA1SignerCredentials(valid.credentials).pipe(
        Effect.flatMap((credentials) => {
          const layer = a1SignaturesLayer(credentials);
          return Effect.forEach(valid.documents, (document): Effect.Effect<A1SignerRow> => {
            const name = rowName(document);
            const stampSize = document.stampSize ?? valid.stamp?.stampSize;
            return Effect.sync(() =>
              replaceRow(operation, { id: document.id, name, status: "signing" }),
            ).pipe(
              Effect.flatMap(() =>
                prepareAndSignPdf({
                  pdf: document.pdf,
                  documentId: document.id,
                  ...(document.name === undefined ? {} : { documentName: document.name }),
                  ...(document.pages === undefined ? {} : { pages: document.pages }),
                  ...(document.pageTextBoxes === undefined
                    ? {}
                    : { pageTextBoxes: document.pageTextBoxes }),
                  ...(document.stampRects === undefined ? {} : { stampRects: document.stampRects }),
                  ...(document.anchors === undefined ? {} : { anchors: document.anchors }),
                  ...(stampSize === undefined ? {} : { stampSize }),
                  ...(valid.stamp?.badge === undefined ? {} : { badge: valid.stamp.badge }),
                  ...(valid.stamp?.lines === undefined ? {} : { lines: valid.stamp.lines }),
                  ...(valid.stamp?.inkPng === undefined ? {} : { inkPng: valid.stamp.inkPng }),
                  ...(valid.stamp?.border === undefined ? {} : { border: valid.stamp.border }),
                  ...(valid.stamp?.qr === undefined ? {} : { qr: valid.stamp.qr }),
                  ...(valid.stamp?.rubric === undefined ? {} : { rubric: valid.stamp.rubric }),
                  signing: valid.signing,
                }).pipe(
                  // effect-boundary: React hook action [allow-provide: per-call signer credentials and browser worker parser]
                  Effect.provide(Layer.merge(layer, liteParseWorkerBrowserLayer)),
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
          });
        }),
      ),
    ),
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
