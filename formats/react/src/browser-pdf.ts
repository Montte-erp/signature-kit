import { AsyncQueuer, type AsyncQueuerOptions, type AsyncQueuerState } from "@tanstack/pacer";
import { useAsyncQueuer } from "@tanstack/react-pacer/async-queuer";
import { PDFDocument } from "@cantoo/pdf-lib";
import type { CmsError } from "@signature-kit/cms/config";
import { schemaErrorMetadata } from "@signature-kit/core/config";
import type { SignatureKitError } from "@signature-kit/core/config";
import type { Signatures } from "@signature-kit/core/signatures";
import { PdfError } from "@signature-kit/pdf/config";
import { signPdf } from "@signature-kit/pdf/sign";
import { Effect, Schema } from "effect";
import {
  autoPlaceReactSignatureField,
  createReactSignatureBuilderState,
  createReactSignatureTemplate,
  pdfSignatureAppearanceFromField,
  placeReactSignatureField,
} from "./builder";
import {
  BrowserPdfSigningQueueItemSchema,
  BrowserPdfSigningQueueOptionsSchema,
  BrowserPdfSignatureBuilderInputSchema,
  BrowserPdfDocumentInputSchema,
  BrowserPdfSigningInputSchema,
  BrowserPdfTemplateInputSchema,
  ReactDocumentSourceTypeValue,
  ReactIntegrationError,
  ReactIntegrationErrorCodeValue,
  ReactIntegrationOperationValue,
  ReactIntegrationSchemaNameValue,
} from "./config";
import type {
  BrowserPdfDocumentInput,
  BrowserPdfBatchResult,
  BrowserPdfSigningInput,
  BrowserPdfSigningQueueItem,
  BrowserPdfSigningQueueOptions,
  BrowserPdfSigningQueueSnapshot,
  BrowserPdfSigningQueueSuccess,
  BrowserPdfSignatureBuilderInput,
  BrowserPdfTemplateInput,
  ReactSignatureBuilderState,
  ReactSignatureDocument,
  ReactSignatureTemplate,
} from "./config";

export const readBrowserFileBytes = (
  file: Blob,
): Effect.Effect<Uint8Array, ReactIntegrationError> =>
  Effect.tryPromise({
    try: async () => new Uint8Array(await file.arrayBuffer()),
    catch: () =>
      new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.fileReadFailed,
        retryable: true,
        reason: "Browser File/Blob could not be read as an ArrayBuffer.",
        operation: ReactIntegrationOperationValue.readBrowserFile,
      }),
  });

export const loadBrowserPdfDocument = (
  input: BrowserPdfDocumentInput,
): Effect.Effect<ReactSignatureDocument, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(BrowserPdfDocumentInputSchema)(input).pipe(
    Effect.mapError((error) => {
      const issue = schemaErrorMetadata(error);
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "Browser PDF document input failed schema validation.",
        operation: ReactIntegrationOperationValue.loadBrowserPdf,
        schemaName: ReactIntegrationSchemaNameValue.browserPdfDocumentInput,
        ...(issue.issuePath === undefined ? {} : { issuePath: issue.issuePath }),
        ...(issue.issueMessage === undefined ? {} : { issueMessage: issue.issueMessage }),
      });
    }),
    Effect.flatMap((valid) =>
      Effect.tryPromise({
        try: async () => {
          const pdf = await PDFDocument.load(valid.pdf);
          const pages = pdf.getPages().map((page, index) => {
            const size = page.getSize();
            return {
              index,
              width: size.width,
              height: size.height,
              label: `Página ${index + 1}`,
            };
          });
          return {
            id: valid.id,
            name: valid.name,
            source: valid.source ?? { type: ReactDocumentSourceTypeValue.uploaded },
            pages,
          };
        },
        catch: () =>
          new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.pdfLoadFailed,
            retryable: false,
            reason: "Uploaded PDF could not be parsed for page dimensions.",
            operation: ReactIntegrationOperationValue.loadBrowserPdf,
          }),
      }),
    ),
    Effect.flatMap((document) => {
      if (document.pages.length === 0) {
        return Effect.fail(
          new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.emptyTemplate,
            retryable: false,
            reason: "Uploaded PDF has no pages available for signature placement.",
            operation: ReactIntegrationOperationValue.loadBrowserPdf,
          }),
        );
      }
      return Effect.succeed(document);
    }),
  );

export const createBrowserPdfTemplate = (
  input: BrowserPdfTemplateInput,
): Effect.Effect<ReactSignatureTemplate, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(BrowserPdfTemplateInputSchema)(input).pipe(
    Effect.mapError((error) => {
      const issue = schemaErrorMetadata(error);
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "Browser PDF template input failed schema validation.",
        operation: ReactIntegrationOperationValue.createTemplate,
        schemaName: ReactIntegrationSchemaNameValue.browserPdfTemplateInput,
        ...(issue.issuePath === undefined ? {} : { issuePath: issue.issuePath }),
        ...(issue.issueMessage === undefined ? {} : { issueMessage: issue.issueMessage }),
      });
    }),
    Effect.flatMap((valid) =>
      loadBrowserPdfDocument({
        id: valid.documentId,
        name: valid.documentName,
        pdf: valid.pdf,
      }).pipe(
        Effect.flatMap((document) =>
          createReactSignatureTemplate({
            id: valid.id,
            name: valid.name,
            documents: [document],
            roles: [valid.role],
          }),
        ),
      ),
    ),
  );

export const createBrowserPdfSignatureBuilderState = (
  input: BrowserPdfSignatureBuilderInput,
): Effect.Effect<ReactSignatureBuilderState, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(BrowserPdfSignatureBuilderInputSchema)(input).pipe(
    Effect.mapError((error) => {
      const issue = schemaErrorMetadata(error);
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "Browser PDF signature builder input failed schema validation.",
        operation: ReactIntegrationOperationValue.createBrowserPdfBuilderState,
        schemaName: ReactIntegrationSchemaNameValue.browserPdfSignatureBuilderInput,
        ...(issue.issuePath === undefined ? {} : { issuePath: issue.issuePath }),
        ...(issue.issueMessage === undefined ? {} : { issueMessage: issue.issueMessage }),
      });
    }),
    Effect.flatMap((valid) =>
      loadBrowserPdfDocument({
        id: valid.documentId,
        name: valid.documentName,
        pdf: valid.pdf,
      }).pipe(
        Effect.flatMap((document) =>
          createReactSignatureTemplate({
            id: valid.id,
            name: valid.name,
            documents: [document],
            roles: [valid.role],
          }),
        ),
        Effect.flatMap((template) => {
          if (valid.placement !== undefined && valid.autoPlacement !== undefined) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
                retryable: false,
                reason:
                  "Browser PDF builder input accepts either placement or autoPlacement, not both.",
                operation: ReactIntegrationOperationValue.createBrowserPdfBuilderState,
                schemaName: ReactIntegrationSchemaNameValue.browserPdfSignatureBuilderInput,
              }),
            );
          }
          if (valid.placement !== undefined) {
            return placeReactSignatureField(template, {
              documentId: valid.documentId,
              pageIndex: valid.placement.pageIndex,
              x: valid.placement.x,
              y: valid.placement.y,
              draft: valid.draft,
              ...(valid.placement.anchor === undefined ? {} : { anchor: valid.placement.anchor }),
            });
          }
          if (valid.autoPlacement !== undefined) {
            return autoPlaceReactSignatureField(template, {
              documentId: valid.documentId,
              draft: valid.draft,
              ...(valid.autoPlacement.page === undefined ? {} : { page: valid.autoPlacement.page }),
              ...(valid.autoPlacement.pageIndex === undefined
                ? {}
                : { pageIndex: valid.autoPlacement.pageIndex }),
              slot: valid.autoPlacement.slot,
              ...(valid.autoPlacement.margin === undefined
                ? {}
                : { margin: valid.autoPlacement.margin }),
              ...(valid.autoPlacement.gap === undefined ? {} : { gap: valid.autoPlacement.gap }),
              ...(valid.autoPlacement.collision === undefined
                ? {}
                : { collision: valid.autoPlacement.collision }),
              ...(valid.autoPlacement.stackDirection === undefined
                ? {}
                : { stackDirection: valid.autoPlacement.stackDirection }),
            });
          }
          return Effect.succeed(template);
        }),
        Effect.flatMap((template) => {
          const selectedFieldId =
            valid.placement === undefined && valid.autoPlacement === undefined
              ? undefined
              : valid.draft.id;
          return createReactSignatureBuilderState({
            template,
            draft: valid.draft,
            ...(selectedFieldId === undefined ? {} : { selectedFieldId }),
          });
        }),
      ),
    ),
  );

export const signBrowserPdf = (
  input: BrowserPdfSigningInput,
): Effect.Effect<
  Uint8Array,
  ReactIntegrationError | PdfError | CmsError | SignatureKitError,
  Signatures
> =>
  Schema.decodeUnknownEffect(BrowserPdfSigningInputSchema)(input).pipe(
    Effect.mapError((error) => {
      const issue = schemaErrorMetadata(error);
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "Browser PDF signing input failed schema validation.",
        operation: ReactIntegrationOperationValue.signBrowserPdf,
        schemaName: ReactIntegrationSchemaNameValue.browserPdfSigningInput,
        ...(issue.issuePath === undefined ? {} : { issuePath: issue.issuePath }),
        ...(issue.issueMessage === undefined ? {} : { issueMessage: issue.issueMessage }),
      });
    }),
    Effect.flatMap((valid) =>
      pdfSignatureAppearanceFromField(valid.template, valid.fieldId).pipe(
        Effect.flatMap((appearance) =>
          signPdf({
            pdf: valid.pdf,
            reason: valid.reason ?? "SignatureKit browser PDF signature",
            contactInfo: valid.contactInfo,
            name: valid.name,
            location: valid.location,
            signingTime: valid.signingTime,
            signatureLength: valid.signatureLength,
            hashAlgorithm: valid.hashAlgorithm,
            policy: valid.policy,
            policyTimeoutMillis: valid.policyTimeoutMillis,
            icpBrasil: valid.icpBrasil,
            timestamp: valid.timestamp,
            appearance,
          }),
        ),
      ),
    ),
  );

type BrowserPdfBatchCallbacks = {
  readonly onItemSettled?: (result: BrowserPdfBatchResult, index: number, total: number) => void;
};

/**
 * Sign many PDFs one-by-one with a single provided `Signatures` layer — the
 * "load several documents, sign them in sequence" flow. Each document runs
 * through {@link signBrowserPdf}; a failure on one item is captured as
 * `{ ok: false, error }` and never aborts the rest, so the result array always
 * holds one entry per input, in the original order. Strictly sequential
 * (`concurrency: 1`) so a single in-browser key signs without races. Provide the
 * layer once, e.g. `.pipe(Effect.provide(a1SignaturesLayer({ pfx, password })))`.
 *
 * This is the reliable batch primitive: unlike the pacer-backed queue below, it
 * needs no `start()`/`flush()` kick — awaiting the Effect drains every item.
 */
export const signBrowserPdfBatch = (
  items: ReadonlyArray<BrowserPdfSigningQueueItem>,
  callbacks: BrowserPdfBatchCallbacks = {},
): Effect.Effect<ReadonlyArray<BrowserPdfBatchResult>, never, Signatures> =>
  Effect.forEach(
    items,
    (item, index): Effect.Effect<BrowserPdfBatchResult, never, Signatures> =>
      signBrowserPdf(item.input).pipe(
        Effect.match({
          onSuccess: (signedPdf): BrowserPdfBatchResult => ({ id: item.id, ok: true, signedPdf }),
          onFailure: (error): BrowserPdfBatchResult => ({ id: item.id, ok: false, error }),
        }),
        Effect.tap((result) =>
          Effect.sync(() => callbacks.onItemSettled?.(result, index, items.length)),
        ),
      ),
    { concurrency: 1 },
  );

type BrowserPdfSigningQueueListener = () => void;
export type BrowserPdfSigningQueueExecutor = (input: BrowserPdfSigningInput) => Promise<Uint8Array>;
export type BrowserPdfSigningQueueCallbacks = {
  readonly onSuccess?: (
    success: BrowserPdfSigningQueueSuccess,
    item: BrowserPdfSigningQueueItem,
  ) => void;
  readonly onError?: (error: Error, item: BrowserPdfSigningQueueItem) => void;
};
export type BrowserPdfSigningQueue = {
  readonly getSnapshot: () => BrowserPdfSigningQueueSnapshot;
  readonly subscribe: (listener: BrowserPdfSigningQueueListener) => () => void;
  readonly add: (
    item: BrowserPdfSigningQueueItem,
  ) => Effect.Effect<BrowserPdfSigningQueueItem, ReactIntegrationError>;
  readonly start: () => void;
  readonly stop: () => void;
  readonly clear: () => void;
  readonly flush: () => Promise<void>;
  readonly abort: () => void;
};
export type BrowserPdfSigningQueueController = BrowserPdfSigningQueue & {
  readonly snapshot: BrowserPdfSigningQueueSnapshot;
};

const browserPdfSigningQueueSnapshot = (
  state: AsyncQueuerState<BrowserPdfSigningQueueItem>,
): BrowserPdfSigningQueueSnapshot => ({
  status: state.status,
  pendingCount: state.size,
  activeCount: state.activeItems.length,
  successCount: state.successCount,
  errorCount: state.errorCount,
  settledCount: state.settledCount,
  rejectionCount: state.rejectionCount,
});

const browserPdfSigningQueuerOptions = (
  valid: BrowserPdfSigningQueueOptions,
  callbacks: BrowserPdfSigningQueueCallbacks,
): AsyncQueuerOptions<BrowserPdfSigningQueueItem> => ({
  ...(valid.concurrency === undefined ? {} : { concurrency: valid.concurrency }),
  ...(valid.waitMillis === undefined ? {} : { wait: valid.waitMillis }),
  ...(valid.maxSize === undefined ? {} : { maxSize: valid.maxSize }),
  ...(valid.started === undefined ? {} : { started: valid.started }),
  throwOnError: false,
  onSuccess: (signedPdf: Uint8Array, item) =>
    callbacks.onSuccess?.({ id: item.id, signedPdf }, item),
  onError: (error, item) => callbacks.onError?.(error, item),
});

const addBrowserPdfSigningQueueItem = (
  item: BrowserPdfSigningQueueItem,
  enqueue: (item: BrowserPdfSigningQueueItem) => boolean,
): Effect.Effect<BrowserPdfSigningQueueItem, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(BrowserPdfSigningQueueItemSchema)(item).pipe(
    Effect.mapError((error) => {
      const issue = schemaErrorMetadata(error);
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "Browser PDF signing queue item failed schema validation.",
        operation: ReactIntegrationOperationValue.addBrowserPdfSigningQueueItem,
        schemaName: ReactIntegrationSchemaNameValue.browserPdfSigningQueueItem,
        ...(issue.issuePath === undefined ? {} : { issuePath: issue.issuePath }),
        ...(issue.issueMessage === undefined ? {} : { issueMessage: issue.issueMessage }),
      });
    }),
    Effect.flatMap((validItem) =>
      Effect.sync(() => enqueue(validItem)).pipe(
        Effect.flatMap((accepted) =>
          accepted
            ? Effect.succeed(validItem)
            : Effect.fail(
                new ReactIntegrationError({
                  code: ReactIntegrationErrorCodeValue.queueRejected,
                  retryable: true,
                  reason: "Browser PDF signing queue rejected the item.",
                  operation: ReactIntegrationOperationValue.addBrowserPdfSigningQueueItem,
                }),
              ),
        ),
      ),
    ),
  );

export const createBrowserPdfSigningQueue = (
  executor: BrowserPdfSigningQueueExecutor,
  options: BrowserPdfSigningQueueOptions = {},
  callbacks: BrowserPdfSigningQueueCallbacks = {},
): Effect.Effect<BrowserPdfSigningQueue, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(BrowserPdfSigningQueueOptionsSchema)(options).pipe(
    Effect.mapError((error) => {
      const issue = schemaErrorMetadata(error);
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "Browser PDF signing queue options failed schema validation.",
        operation: ReactIntegrationOperationValue.addBrowserPdfSigningQueueItem,
        schemaName: ReactIntegrationSchemaNameValue.browserPdfSigningQueueOptions,
        ...(issue.issuePath === undefined ? {} : { issuePath: issue.issuePath }),
        ...(issue.issueMessage === undefined ? {} : { issueMessage: issue.issueMessage }),
      });
    }),
    Effect.map((valid) => {
      const queuer = new AsyncQueuer<BrowserPdfSigningQueueItem>(
        (item) => executor(item.input),
        browserPdfSigningQueuerOptions(valid, callbacks),
      );

      return {
        getSnapshot: () => browserPdfSigningQueueSnapshot(queuer.store.state),
        subscribe: (listener) => {
          const subscription = queuer.store.subscribe(() => listener());
          return subscription.unsubscribe;
        },
        add: (item) => addBrowserPdfSigningQueueItem(item, queuer.addItem),
        start: () => queuer.start(),
        stop: () => queuer.stop(),
        clear: () => queuer.clear(),
        flush: () => queuer.flush(),
        abort: () => queuer.abort(),
      };
    }),
  );

export const useBrowserPdfSigningQueue = (
  executor: BrowserPdfSigningQueueExecutor,
  options: BrowserPdfSigningQueueOptions = {},
  callbacks: BrowserPdfSigningQueueCallbacks = {},
): BrowserPdfSigningQueueController => {
  const queuer = useAsyncQueuer<BrowserPdfSigningQueueItem, BrowserPdfSigningQueueSnapshot>(
    (item) => executor(item.input),
    browserPdfSigningQueuerOptions(options, callbacks),
    browserPdfSigningQueueSnapshot,
  );

  return {
    snapshot: queuer.state,
    getSnapshot: () => browserPdfSigningQueueSnapshot(queuer.store.state),
    subscribe: (listener) => {
      const subscription = queuer.store.subscribe(() => listener());
      return subscription.unsubscribe;
    },
    add: (item) => addBrowserPdfSigningQueueItem(item, queuer.addItem),
    start: () => queuer.start(),
    stop: () => queuer.stop(),
    clear: () => queuer.clear(),
    flush: () => queuer.flush(),
    abort: () => queuer.abort(),
  };
};
