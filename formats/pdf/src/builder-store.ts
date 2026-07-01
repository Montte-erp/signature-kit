import { Effect } from "effect";
import {
  addPdfSignatureField,
  createPdfSignatureBuilderStateFromTemplate,
  groupPdfSignatureFieldsByPage,
  movePdfSignatureField,
  placePdfSignatureField,
  pdfSignatureFieldsForPage,
  removePdfSignatureField,
  replacePdfSignatureField,
  type PdfSignatureFieldsByPage,
  validatePdfSignatureTemplate,
} from "./builder";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSchemaNameValue,
  PdfSignatureAutoPlacementPageValue,
  PdfSignaturePlacementAnchorValue,
} from "./config";
import type {
  PdfSignatureBestGuessPlacementInput,
  PdfSignatureBuilderState,
  PdfSignatureField,
  PdfSignatureFieldDraft,
  PdfSignatureAutoPlacementPage,
  PdfSignatureFieldPlacement,
  PdfSignatureRect,
  PdfSignaturePlacementBatchResult,
  PdfSignaturePlacementBatchSuccess,
  PdfSignatureTemplate,
} from "./config";
type PdfSignatureBuilderListener = () => void;
type PdfSignatureBuilderUpdater = (
  template: PdfSignatureTemplate,
) => Effect.Effect<PdfSignatureTemplate, PdfError>;
type PdfSignatureBuilderStoreState = {
  readonly snapshot: PdfSignatureBuilderState;
  readonly fieldsSource: readonly PdfSignatureField[];
  readonly fieldsByPage: PdfSignatureFieldsByPage;
};

export type PdfSignatureBuilderStore = {
  readonly getSnapshot: () => PdfSignatureBuilderState;
  readonly fieldsForPage: (documentId: string, pageIndex: number) => readonly PdfSignatureField[];
  readonly subscribe: (listener: PdfSignatureBuilderListener) => () => void;
  readonly setState: (
    state: PdfSignatureBuilderState,
  ) => Effect.Effect<PdfSignatureBuilderState, PdfError>;
  readonly setTemplate: (
    template: PdfSignatureTemplate,
  ) => Effect.Effect<PdfSignatureTemplate, PdfError>;
  readonly setDraft: (
    draft: PdfSignatureFieldDraft | undefined,
  ) => Effect.Effect<PdfSignatureBuilderState, never>;
  readonly selectField: (
    fieldId: string | undefined,
  ) => Effect.Effect<PdfSignatureBuilderState, never>;
  readonly addField: (field: PdfSignatureField) => Effect.Effect<PdfSignatureTemplate, PdfError>;
  readonly placeField: (
    placement: PdfSignatureFieldPlacement,
  ) => Effect.Effect<PdfSignatureTemplate, PdfError>;
  readonly replaceField: (
    field: PdfSignatureField,
  ) => Effect.Effect<PdfSignatureTemplate, PdfError>;
  readonly removeField: (fieldId: string) => Effect.Effect<PdfSignatureTemplate, PdfError>;
  readonly moveField: (
    fieldId: string,
    rect: PdfSignatureRect,
  ) => Effect.Effect<PdfSignatureTemplate, PdfError>;
};

const builderState = (
  template: PdfSignatureTemplate,
  selectedFieldId: string | undefined,
  draft: PdfSignatureFieldDraft | undefined,
): PdfSignatureBuilderState => ({
  template,
  ...(selectedFieldId === undefined ? {} : { selectedFieldId }),
  ...(draft === undefined ? {} : { draft }),
});

const builderStoreState = (
  snapshot: PdfSignatureBuilderState,
  previous?: PdfSignatureBuilderStoreState,
): PdfSignatureBuilderStoreState => {
  const fieldsSource = snapshot.template.fields;
  return {
    snapshot,
    fieldsSource,
    fieldsByPage:
      previous !== undefined && Object.is(previous.fieldsSource, fieldsSource)
        ? previous.fieldsByPage
        : groupPdfSignatureFieldsByPage(fieldsSource),
  };
};

const selectedFieldStillExists = (
  template: PdfSignatureTemplate,
  selectedFieldId: string | undefined,
): string | undefined =>
  selectedFieldId === undefined || template.fields.some((field) => field.id === selectedFieldId)
    ? selectedFieldId
    : undefined;

const placeOrReplaceField = (
  template: PdfSignatureTemplate,
  placement: PdfSignatureFieldPlacement,
): Effect.Effect<PdfSignatureTemplate, PdfError> => {
  const withoutExisting = template.fields.some((field) => field.id === placement.draft.id)
    ? removePdfSignatureField(template, placement.draft.id)
    : Effect.succeed(template);

  return withoutExisting.pipe(Effect.flatMap((next) => placePdfSignatureField(next, placement)));
};

export const createPdfSignatureBuilderStore = (
  initialState: PdfSignatureBuilderState,
): PdfSignatureBuilderStore => {
  const initialSnapshot = builderState(
    initialState.template,
    initialState.selectedFieldId,
    initialState.draft,
  );
  const stateCell = { current: builderStoreState(initialSnapshot) };
  const listeners = new Set<PdfSignatureBuilderListener>();
  const current = (): PdfSignatureBuilderState => stateCell.current.snapshot;
  const publish = (next: PdfSignatureBuilderState): void => {
    stateCell.current = builderStoreState(next, stateCell.current);
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: PdfSignatureBuilderListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const commitTemplate = (update: PdfSignatureBuilderUpdater) =>
    Effect.sync(() => current().template).pipe(
      Effect.flatMap(update),
      Effect.tap((template) =>
        Effect.sync(() => {
          const snapshot = current();
          publish(
            builderState(
              template,
              selectedFieldStillExists(template, snapshot.selectedFieldId),
              snapshot.draft,
            ),
          );
        }),
      ),
    );

  const commitState = (nextState: PdfSignatureBuilderState) =>
    createPdfSignatureBuilderStateFromTemplate({
      template: nextState.template,
      ...(nextState.selectedFieldId === undefined
        ? {}
        : { selectedFieldId: nextState.selectedFieldId }),
      ...(nextState.draft === undefined ? {} : { draft: nextState.draft }),
    }).pipe(
      Effect.tap((next) =>
        Effect.sync(() => {
          publish(next);
        }),
      ),
    );

  return {
    getSnapshot: current,
    fieldsForPage: (documentId, pageIndex) =>
      pdfSignatureFieldsForPage(stateCell.current.fieldsByPage, documentId, pageIndex),
    subscribe,
    setState: commitState,
    setTemplate: (template) => commitTemplate(() => validatePdfSignatureTemplate(template)),
    setDraft: (draft) =>
      Effect.sync(() => {
        const snapshot = current();
        const next = builderState(snapshot.template, snapshot.selectedFieldId, draft);
        publish(next);
        return next;
      }),
    selectField: (fieldId) =>
      Effect.sync(() => {
        const snapshot = current();
        const next = builderState(
          snapshot.template,
          selectedFieldStillExists(snapshot.template, fieldId),
          snapshot.draft,
        );
        publish(next);
        return next;
      }),
    addField: (field) => commitTemplate((template) => addPdfSignatureField(template, field)),
    placeField: (placement) =>
      commitTemplate((template) => placeOrReplaceField(template, placement)),
    replaceField: (field) =>
      commitTemplate((template) => replacePdfSignatureField(template, field)),
    removeField: (fieldId) =>
      commitTemplate((template) => removePdfSignatureField(template, fieldId)),
    moveField: (fieldId, rect) =>
      commitTemplate((template) => movePdfSignatureField(template, fieldId, rect)),
  };
};

export const pdfSignatureBuilderSelectors = {
  template: (state: PdfSignatureBuilderState): PdfSignatureTemplate => state.template,
  roles: (state: PdfSignatureBuilderState) => state.template.roles,
  documents: (state: PdfSignatureBuilderState) => state.template.documents,
  draft: (state: PdfSignatureBuilderState) => state.draft,
  selectedFieldId: (state: PdfSignatureBuilderState) => state.selectedFieldId,
  selectedField: (state: PdfSignatureBuilderState): PdfSignatureField | undefined =>
    state.selectedFieldId === undefined
      ? undefined
      : state.template.fields.find((field) => field.id === state.selectedFieldId),
};

export const bestGuessPdfSignatureFieldPlacement = (
  input: PdfSignatureBestGuessPlacementInput,
): Effect.Effect<PdfSignatureFieldPlacement, PdfError> => {
  if (input.page !== undefined && input.pageIndex !== undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.autoPlaceField,
        schemaName: PdfSchemaNameValue.pdfSignatureAutoPlacementInput,
        reason: "Best-guess placement accepts either page or pageIndex, not both.",
      }),
    );
  }

  const document = input.template.documents.find((candidate) => candidate.id === input.documentId);
  if (document === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.unknownDocument,
        retryable: false,
        operation: PdfOperationValue.autoPlaceField,
        reason: `Best-guess placement references an unknown document ${input.documentId}.`,
      }),
    );
  }

  const pageIndex =
    input.pageIndex ??
    (input.page === PdfSignatureAutoPlacementPageValue.first ? 0 : document.pages.length - 1);
  const page = document.pages.find((candidate) => candidate.index === pageIndex);
  if (page === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.noAvailablePlacement,
        retryable: false,
        operation: PdfOperationValue.autoPlaceField,
        reason: `Best-guess placement found no page ${pageIndex} on document ${document.id}.`,
      }),
    );
  }

  const margin = input.margin ?? 48;
  if (margin < 0) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.autoPlaceField,
        schemaName: PdfSchemaNameValue.pdfSignatureAutoPlacementInput,
        reason: "Best-guess placement margin must be non-negative.",
      }),
    );
  }

  return Effect.succeed({
    documentId: input.documentId,
    pageIndex: page.index,
    x: Math.max(input.draft.width / 2, page.width - margin - input.draft.width / 2),
    y: Math.max(input.draft.height / 2, page.height - margin - input.draft.height / 2),
    draft: input.draft,
    anchor: PdfSignaturePlacementAnchorValue.center,
  });
};

export type PdfSignaturePlacementQueueItem = {
  readonly id: string;
  readonly store: PdfSignatureBuilderStore;
  readonly documentId: string;
  readonly draft: PdfSignatureFieldDraft;
  readonly margin?: number;
  readonly page?: PdfSignatureAutoPlacementPage;
  readonly pageIndex?: number;
};

export type PdfSignaturePlacementBatchCallbacks = {
  readonly onItemStarted?: (
    item: PdfSignaturePlacementQueueItem,
    index: number,
    total: number,
  ) => void;
  readonly onItemSettled?: (
    result: PdfSignaturePlacementBatchResult,
    index: number,
    total: number,
  ) => void;
  readonly yieldAfterItem?: (
    result: PdfSignaturePlacementBatchResult,
    index: number,
    total: number,
  ) => Effect.Effect<void> | void;
};

const placePdfSignatureQueueItem = (
  item: PdfSignaturePlacementQueueItem,
): Effect.Effect<PdfSignaturePlacementBatchResult, never> =>
  bestGuessPdfSignatureFieldPlacement({
    template: item.store.getSnapshot().template,
    documentId: item.documentId,
    draft: item.draft,
    ...(item.margin === undefined ? {} : { margin: item.margin }),
    ...(item.page === undefined ? {} : { page: item.page }),
    ...(item.pageIndex === undefined ? {} : { pageIndex: item.pageIndex }),
  }).pipe(
    Effect.flatMap((placement) => item.store.placeField(placement)),
    Effect.flatMap((template) => {
      const field = template.fields.find((candidate) => candidate.id === item.draft.id);
      if (field === undefined) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.unknownField,
            retryable: false,
            operation: PdfOperationValue.autoPlaceField,
            reason: `Placed field ${item.draft.id} was not committed to the PDF signature template.`,
          }),
        );
      }
      const success: PdfSignaturePlacementBatchSuccess = {
        id: item.id,
        ok: true,
        template,
        field,
      };
      return Effect.succeed(success);
    }),
    Effect.match({
      onSuccess: (result): PdfSignaturePlacementBatchResult => result,
      onFailure: (error): PdfSignaturePlacementBatchResult => ({ id: item.id, ok: false, error }),
    }),
  );

export const placePdfSignatureFieldsBatch = (
  items: ReadonlyArray<PdfSignaturePlacementQueueItem>,
  callbacks: PdfSignaturePlacementBatchCallbacks = {},
): Effect.Effect<ReadonlyArray<PdfSignaturePlacementBatchResult>, never> =>
  Effect.forEach(items, (item, index) =>
    Effect.sync(() => callbacks.onItemStarted?.(item, index, items.length)).pipe(
      Effect.flatMap(() => placePdfSignatureQueueItem(item)),
      Effect.tap((result) =>
        Effect.sync(() => callbacks.onItemSettled?.(result, index, items.length)),
      ),
      Effect.tap(
        (result) => callbacks.yieldAfterItem?.(result, index, items.length) ?? Effect.void,
      ),
    ),
  );
