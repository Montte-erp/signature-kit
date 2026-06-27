import { Effect } from "effect";
import * as React from "react";
import {
  addReactSignatureField,
  createReactSignatureBuilderState,
  groupReactSignatureFieldsByPage,
  moveReactSignatureField,
  placeReactSignatureField,
  reactSignatureFieldsForPage,
  removeReactSignatureField,
  replaceReactSignatureField,
  type ReactSignatureFieldsByPage,
  validateReactSignatureTemplate,
} from "./builder";
import { ReactSignaturePlacementAnchorValue } from "./config";
import type { ReactIntegrationError } from "./config";
import type {
  ReactSignatureBuilderState,
  ReactSignatureField,
  ReactSignatureFieldDraft,
  ReactSignatureFieldPlacement,
  ReactSignatureRect,
  ReactSignatureTemplate,
} from "./config";

type SignatureBuilderListener = () => void;
type SignatureBuilderUpdater = (
  template: ReactSignatureTemplate,
) => Effect.Effect<ReactSignatureTemplate, ReactIntegrationError>;
type SelectionEqual<Selected> = (previous: Selected, next: Selected) => boolean;
type SignatureBuilderStoreState = {
  readonly snapshot: ReactSignatureBuilderState;
  readonly fieldsSource: readonly ReactSignatureField[];
  readonly fieldsByPage: ReactSignatureFieldsByPage;
};

export type SignatureBuilderStore = {
  readonly getSnapshot: () => ReactSignatureBuilderState;
  readonly fieldsForPage: (documentId: string, pageIndex: number) => readonly ReactSignatureField[];
  readonly subscribe: (listener: SignatureBuilderListener) => () => void;
  readonly setState: (
    state: ReactSignatureBuilderState,
  ) => Effect.Effect<ReactSignatureBuilderState, ReactIntegrationError>;
  readonly setTemplate: (
    template: ReactSignatureTemplate,
  ) => Effect.Effect<ReactSignatureTemplate, ReactIntegrationError>;
  readonly setDraft: (draft: ReactSignatureFieldDraft | undefined) => void;
  readonly selectField: (fieldId: string | undefined) => void;
  readonly addField: (
    field: ReactSignatureField,
  ) => Effect.Effect<ReactSignatureTemplate, ReactIntegrationError>;
  readonly placeField: (
    placement: ReactSignatureFieldPlacement,
  ) => Effect.Effect<ReactSignatureTemplate, ReactIntegrationError>;
  readonly replaceField: (
    field: ReactSignatureField,
  ) => Effect.Effect<ReactSignatureTemplate, ReactIntegrationError>;
  readonly removeField: (
    fieldId: string,
  ) => Effect.Effect<ReactSignatureTemplate, ReactIntegrationError>;
  readonly moveField: (
    fieldId: string,
    rect: ReactSignatureRect,
  ) => Effect.Effect<ReactSignatureTemplate, ReactIntegrationError>;
};

const builderState = (
  template: ReactSignatureTemplate,
  selectedFieldId: string | undefined,
  draft: ReactSignatureFieldDraft | undefined,
): ReactSignatureBuilderState => ({
  template,
  ...(selectedFieldId === undefined ? {} : { selectedFieldId }),
  ...(draft === undefined ? {} : { draft }),
});

const builderStoreState = (
  snapshot: ReactSignatureBuilderState,
  previous?: SignatureBuilderStoreState,
): SignatureBuilderStoreState => {
  const fieldsSource = snapshot.template.fields;
  return {
    snapshot,
    fieldsSource,
    fieldsByPage:
      previous !== undefined && Object.is(previous.fieldsSource, fieldsSource)
        ? previous.fieldsByPage
        : groupReactSignatureFieldsByPage(fieldsSource),
  };
};

const selectedFieldStillExists = (
  template: ReactSignatureTemplate,
  selectedFieldId: string | undefined,
): string | undefined =>
  selectedFieldId === undefined || template.fields.some((field) => field.id === selectedFieldId)
    ? selectedFieldId
    : undefined;

const placeOrReplaceField = (
  template: ReactSignatureTemplate,
  placement: ReactSignatureFieldPlacement,
): Effect.Effect<ReactSignatureTemplate, ReactIntegrationError> => {
  const withoutExisting = template.fields.some((field) => field.id === placement.draft.id)
    ? removeReactSignatureField(template, placement.draft.id)
    : Effect.succeed(template);

  return withoutExisting.pipe(Effect.flatMap((next) => placeReactSignatureField(next, placement)));
};

export const createSignatureBuilderStore = (
  initialState: ReactSignatureBuilderState,
): SignatureBuilderStore => {
  const initialSnapshot = builderState(
    initialState.template,
    initialState.selectedFieldId,
    initialState.draft,
  );
  const stateCell = { current: builderStoreState(initialSnapshot) };
  const listeners = new Set<SignatureBuilderListener>();
  const current = (): ReactSignatureBuilderState => stateCell.current.snapshot;
  const publish = (next: ReactSignatureBuilderState): void => {
    stateCell.current = builderStoreState(next, stateCell.current);
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: SignatureBuilderListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const commitTemplate = (update: SignatureBuilderUpdater) =>
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

  const commitState = (nextState: ReactSignatureBuilderState) =>
    createReactSignatureBuilderState({
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
      reactSignatureFieldsForPage(stateCell.current.fieldsByPage, documentId, pageIndex),
    subscribe,
    setState: commitState,
    setTemplate: (template) => commitTemplate(() => validateReactSignatureTemplate(template)),
    setDraft: (draft) => {
      const snapshot = current();
      publish(builderState(snapshot.template, snapshot.selectedFieldId, draft));
    },
    selectField: (fieldId) => {
      const snapshot = current();
      publish(
        builderState(
          snapshot.template,
          selectedFieldStillExists(snapshot.template, fieldId),
          snapshot.draft,
        ),
      );
    },
    addField: (field) => commitTemplate((template) => addReactSignatureField(template, field)),
    placeField: (placement) =>
      commitTemplate((template) => placeOrReplaceField(template, placement)),
    replaceField: (field) =>
      commitTemplate((template) => replaceReactSignatureField(template, field)),
    removeField: (fieldId) =>
      commitTemplate((template) => removeReactSignatureField(template, fieldId)),
    moveField: (fieldId, rect) =>
      commitTemplate((template) => moveReactSignatureField(template, fieldId, rect)),
  };
};

export const useSignatureBuilderSelector = <Selected,>(
  store: SignatureBuilderStore,
  selector: (state: ReactSignatureBuilderState) => Selected,
  isEqual: SelectionEqual<Selected> = Object.is,
): Selected => {
  const cache = React.useRef<{ readonly selected: Selected } | undefined>(undefined);
  const getSelectedSnapshot = React.useCallback((): Selected => {
    const selected = selector(store.getSnapshot());
    const previous = cache.current;
    if (previous !== undefined && isEqual(previous.selected, selected)) return previous.selected;
    cache.current = { selected };
    return selected;
  }, [isEqual, selector, store]);

  return React.useSyncExternalStore(store.subscribe, getSelectedSnapshot, getSelectedSnapshot);
};

export const useSignatureBuilderFieldsForPage = (
  store: SignatureBuilderStore,
  documentId: string,
  pageIndex: number,
): readonly ReactSignatureField[] =>
  useSignatureBuilderSelector(
    store,
    () => store.fieldsForPage(documentId, pageIndex),
    sameReferenceList,
  );

const sameReferenceList = <A,>(previous: readonly A[], next: readonly A[]): boolean =>
  previous.length === next.length && previous.every((item, index) => Object.is(item, next[index]));

export const signatureBuilderSelectors = {
  template: (state: ReactSignatureBuilderState): ReactSignatureTemplate => state.template,
  roles: (state: ReactSignatureBuilderState) => state.template.roles,
  documents: (state: ReactSignatureBuilderState) => state.template.documents,
  draft: (state: ReactSignatureBuilderState) => state.draft,
  selectedFieldId: (state: ReactSignatureBuilderState) => state.selectedFieldId,
  selectedField: (state: ReactSignatureBuilderState): ReactSignatureField | undefined =>
    state.selectedFieldId === undefined
      ? undefined
      : state.template.fields.find((field) => field.id === state.selectedFieldId),
};

export type SignatureBuilderSurfaceProps = {
  readonly store: SignatureBuilderStore;
  readonly onFieldPlacement?: (placement: ReactSignatureFieldPlacement) => void;
  readonly onFieldSelect?: (field: ReactSignatureField) => void;
  readonly className?: string;
  readonly style?: React.CSSProperties;
};

export type SignatureBuilderRolesProps = {
  readonly store: SignatureBuilderStore;
  readonly className?: string;
  readonly style?: React.CSSProperties;
};

export type SignatureBuilderDocumentProps = {
  readonly store: SignatureBuilderStore;
  readonly documentId: string;
  readonly onFieldPlacement?: (placement: ReactSignatureFieldPlacement) => void;
  readonly onFieldSelect?: (field: ReactSignatureField) => void;
  readonly className?: string;
  readonly style?: React.CSSProperties;
};

export type SignatureBuilderPageProps = {
  readonly store: SignatureBuilderStore;
  readonly documentId: string;
  readonly pageIndex: number;
  readonly onFieldPlacement?: (placement: ReactSignatureFieldPlacement) => void;
  readonly onFieldSelect?: (field: ReactSignatureField) => void;
  readonly className?: string;
  readonly style?: React.CSSProperties;
};

export type SignatureBuilderFieldProps = {
  readonly store: SignatureBuilderStore;
  readonly field: ReactSignatureField;
  readonly onFieldSelect?: (field: ReactSignatureField) => void;
  readonly className?: string;
  readonly style?: React.CSSProperties;
};

const labelForField = (template: ReactSignatureTemplate, field: ReactSignatureField): string => {
  const role = template.roles.find((candidate) => candidate.id === field.roleId);
  return field.label ?? role?.label ?? field.type;
};

export const SignatureBuilderRoles = ({
  store,
  className,
  style,
}: SignatureBuilderRolesProps): React.ReactElement => {
  const roles = useSignatureBuilderSelector(store, signatureBuilderSelectors.roles);

  return (
    <div
      className={className}
      data-slot="signature-builder-roles"
      style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", ...style }}
    >
      {roles.map((role) => (
        <span
          key={role.id}
          data-slot="signature-builder-role"
          style={{
            border: "1px solid #d8dbe2",
            borderRadius: 8,
            color: "#1f2937",
            fontSize: 13,
            lineHeight: "24px",
            paddingInline: 10,
          }}
        >
          {role.label}
        </span>
      ))}
    </div>
  );
};

export const SignatureBuilderField = ({
  store,
  field,
  onFieldSelect,
  className,
  style,
}: SignatureBuilderFieldProps): React.ReactElement => {
  const selectedFieldId = useSignatureBuilderSelector(
    store,
    signatureBuilderSelectors.selectedFieldId,
  );
  const template = useSignatureBuilderSelector(store, signatureBuilderSelectors.template);
  const selected = selectedFieldId === field.id;

  return (
    <button
      className={className}
      data-slot="signature-builder-field"
      type="button"
      aria-pressed={selected}
      data-selected={selected ? "" : undefined}
      aria-label={`${field.type} field for ${labelForField(template, field)}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => {
        store.selectField(field.id);
        onFieldSelect?.(field);
      }}
      style={style}
    >
      {labelForField(template, field)}
    </button>
  );
};

export const SignatureBuilderPage = ({
  store,
  documentId,
  pageIndex,
  onFieldPlacement,
  onFieldSelect,
  className,
  style,
}: SignatureBuilderPageProps): React.ReactElement | null => {
  const document = useSignatureBuilderSelector(store, (state) =>
    state.template.documents.find((candidate) => candidate.id === documentId),
  );
  const page = useSignatureBuilderSelector(store, (state) =>
    state.template.documents
      .find((candidate) => candidate.id === documentId)
      ?.pages.find((candidate) => candidate.index === pageIndex),
  );
  const draft = useSignatureBuilderSelector(store, signatureBuilderSelectors.draft);
  const fields = useSignatureBuilderFieldsForPage(store, documentId, pageIndex);

  if (document === undefined || page === undefined) return null;

  return (
    <div
      className={className}
      data-slot="signature-builder-page"
      role="group"
      aria-label={page.label ?? `Page ${page.index + 1}`}
      onPointerDown={(event) => {
        if (draft === undefined || onFieldPlacement === undefined) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) * page.width;
        const y = ((event.clientY - bounds.top) / bounds.height) * page.height;
        onFieldPlacement({
          documentId: document.id,
          pageIndex: page.index,
          x,
          y,
          draft,
          anchor: ReactSignaturePlacementAnchorValue.center,
        });
      }}
      style={{
        aspectRatio: `${page.width} / ${page.height}`,
        background: "#ffffff",
        border: "1px solid #d8dbe2",
        borderRadius: 10,
        boxShadow: "0 1px 2px rgb(15 23 42 / 0.08)",
        maxWidth: page.width,
        overflow: "hidden",
        position: "relative",
        width: "100%",
        ...style,
      }}
    >
      <span
        data-slot="signature-builder-page-label"
        style={{
          color: "#94a3b8",
          fontSize: 12,
          insetBlockStart: 10,
          insetInlineEnd: 12,
          position: "absolute",
        }}
      >
        {page.label ?? `Page ${page.index + 1}`}
      </span>

      {fields.map((field) => (
        <div
          key={field.id}
          data-slot="signature-builder-field-frame"
          style={{
            height: `${(field.rect.height / page.height) * 100}%`,
            left: `${(field.rect.x / page.width) * 100}%`,
            position: "absolute",
            top: `${(field.rect.y / page.height) * 100}%`,
            width: `${(field.rect.width / page.width) * 100}%`,
          }}
        >
          <SignatureBuilderField
            store={store}
            field={field}
            {...(onFieldSelect === undefined ? {} : { onFieldSelect })}
          />
        </div>
      ))}
    </div>
  );
};

export const SignatureBuilderDocument = ({
  store,
  documentId,
  onFieldPlacement,
  onFieldSelect,
  className,
  style,
}: SignatureBuilderDocumentProps): React.ReactElement | null => {
  const document = useSignatureBuilderSelector(store, (state) =>
    state.template.documents.find((candidate) => candidate.id === documentId),
  );

  if (document === undefined) return null;

  return (
    <article
      className={className}
      data-slot="signature-builder-document"
      style={{ display: "grid", gap: "0.75rem", ...style }}
    >
      <header
        data-slot="signature-builder-document-header"
        style={{ display: "flex", gap: "1rem", justifyContent: "space-between" }}
      >
        <h2 style={{ color: "#111827", fontSize: 16, lineHeight: 1.3, margin: 0 }}>
          {document.name}
        </h2>
        <span style={{ color: "#64748b", fontSize: 13 }}>
          {document.pages.length} {document.pages.length === 1 ? "page" : "pages"}
        </span>
      </header>

      {document.pages.map((page) => (
        <SignatureBuilderPage
          key={`${document.id}:${page.index}`}
          store={store}
          documentId={document.id}
          pageIndex={page.index}
          {...(onFieldPlacement === undefined ? {} : { onFieldPlacement })}
          {...(onFieldSelect === undefined ? {} : { onFieldSelect })}
        />
      ))}
    </article>
  );
};

export const SignatureBuilderSurface = ({
  store,
  onFieldPlacement,
  onFieldSelect,
  className,
  style,
}: SignatureBuilderSurfaceProps): React.ReactElement => {
  const name = useSignatureBuilderSelector(store, (state) => state.template.name);
  const documents = useSignatureBuilderSelector(store, signatureBuilderSelectors.documents);

  return (
    <section
      className={className}
      data-slot="signature-builder-surface"
      aria-label={`${name} signature builder`}
      style={{ display: "grid", gap: "1rem", ...style }}
    >
      <SignatureBuilderRoles store={store} />

      {documents.map((document) => (
        <SignatureBuilderDocument
          key={document.id}
          store={store}
          documentId={document.id}
          {...(onFieldPlacement === undefined ? {} : { onFieldPlacement })}
          {...(onFieldSelect === undefined ? {} : { onFieldSelect })}
        />
      ))}
    </section>
  );
};
