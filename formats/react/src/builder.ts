import type { PdfSignatureAppearance } from "@signature-kit/pdf/config";
import { Effect, Schema } from "effect";
import {
  ReactSignatureAutoPlacementCollisionValue,
  ReactSignatureAutoPlacementInputSchema,
  ReactSignatureAutoPlacementPageValue,
  ReactSignatureAutoPlacementSlotValue,
  ReactSignatureAutoPlacementStackDirectionValue,
  ReactIntegrationError,
  ReactIntegrationErrorCodeValue,
  ReactIntegrationOperationValue,
  ReactIntegrationSchemaNameValue,
  ReactSignatureBuilderStateInputSchema,
  ReactSignatureFieldPlacementSchema,
  ReactSignatureFieldSchema,
  ReactSignaturePlacementAnchorValue,
  ReactSignatureRectSchema,
  ReactSignatureTemplateInputSchema,
  ReactSignatureTemplateSchema,
} from "./config";
import type {
  ReactSignatureAutoPlacementInput,
  ReactSignatureAutoPlacementSlot,
  ReactSignatureAutoPlacementStackDirection,
  ReactSignatureBuilderState,
  ReactSignatureBuilderStateInput,
  ReactSignatureDocument,
  ReactSignatureField,
  ReactSignatureFieldDraft,
  ReactSignatureFieldPlacement,
  ReactSignaturePage,
  ReactSignatureRect,
  ReactSignatureTemplate,
  ReactSignatureTemplateInput,
} from "./config";

const fieldPageKey = (documentId: string, pageIndex: number): string =>
  `${documentId}:${pageIndex}`;

export type ReactSignatureFieldsByPage = ReadonlyMap<string, readonly ReactSignatureField[]>;

export const groupReactSignatureFieldsByPage = (
  fields: readonly ReactSignatureField[],
): ReactSignatureFieldsByPage => {
  const grouped = new Map<string, ReactSignatureField[]>();
  for (const field of fields) {
    const key = fieldPageKey(field.documentId, field.rect.pageIndex);
    const current = grouped.get(key);
    if (current === undefined) {
      grouped.set(key, [field]);
    } else {
      current.push(field);
    }
  }
  return grouped;
};

export const reactSignatureFieldsForPage = (
  grouped: ReactSignatureFieldsByPage,
  documentId: string,
  pageIndex: number,
): readonly ReactSignatureField[] => grouped.get(fieldPageKey(documentId, pageIndex)) ?? [];

const hasDuplicateId = (items: readonly { readonly id: string }[]): boolean => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) return true;
    seen.add(item.id);
  }
  return false;
};

const anchoredRectFromPlacement = (placement: ReactSignatureFieldPlacement): ReactSignatureRect => {
  const anchor = placement.anchor ?? ReactSignaturePlacementAnchorValue.topLeft;
  const x =
    anchor === ReactSignaturePlacementAnchorValue.center
      ? placement.x - placement.draft.width / 2
      : placement.x;
  const y =
    anchor === ReactSignaturePlacementAnchorValue.center
      ? placement.y - placement.draft.height / 2
      : placement.y;
  return {
    pageIndex: placement.pageIndex,
    x,
    y,
    width: placement.draft.width,
    height: placement.draft.height,
  };
};

const clampCoordinate = (value: number, size: number, pageSize: number): number => {
  const max = pageSize - size;
  if (max <= 0) return 0;
  return Math.min(Math.max(value, 0), max);
};

const clampRectToPage = (
  rect: ReactSignatureRect,
  page: ReactSignaturePage,
): ReactSignatureRect => ({
  ...rect,
  x: clampCoordinate(rect.x, rect.width, page.width),
  y: clampCoordinate(rect.y, rect.height, page.height),
});

const rectFitsPage = (rect: ReactSignatureRect, page: ReactSignaturePage): boolean =>
  rect.x >= 0 &&
  rect.y >= 0 &&
  rect.width > 0 &&
  rect.height > 0 &&
  rect.x + rect.width <= page.width &&
  rect.y + rect.height <= page.height;

const rectsOverlap = (left: ReactSignatureRect, right: ReactSignatureRect): boolean =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

const autoPlacementFieldsForPage = (
  template: ReactSignatureTemplate,
  documentId: string,
  pageIndex: number,
): readonly ReactSignatureField[] =>
  template.fields.filter(
    (field) => field.documentId === documentId && field.rect.pageIndex === pageIndex,
  );

const rectCollidesWithFields = (
  rect: ReactSignatureRect,
  fields: readonly ReactSignatureField[],
): boolean => fields.some((field) => rectsOverlap(rect, field.rect));

const xFromAutoPlacementSlot = (
  slot: ReactSignatureAutoPlacementSlot,
  page: ReactSignaturePage,
  draft: ReactSignatureFieldDraft,
  margin: number,
): number => {
  switch (slot) {
    case ReactSignatureAutoPlacementSlotValue.topLeft:
    case ReactSignatureAutoPlacementSlotValue.middleLeft:
    case ReactSignatureAutoPlacementSlotValue.bottomLeft:
      return margin;
    case ReactSignatureAutoPlacementSlotValue.topCenter:
    case ReactSignatureAutoPlacementSlotValue.center:
    case ReactSignatureAutoPlacementSlotValue.bottomCenter:
      return (page.width - draft.width) / 2;
    case ReactSignatureAutoPlacementSlotValue.topRight:
    case ReactSignatureAutoPlacementSlotValue.middleRight:
    case ReactSignatureAutoPlacementSlotValue.bottomRight:
      return page.width - margin - draft.width;
  }
};

const yFromAutoPlacementSlot = (
  slot: ReactSignatureAutoPlacementSlot,
  page: ReactSignaturePage,
  draft: ReactSignatureFieldDraft,
  margin: number,
): number => {
  switch (slot) {
    case ReactSignatureAutoPlacementSlotValue.topLeft:
    case ReactSignatureAutoPlacementSlotValue.topCenter:
    case ReactSignatureAutoPlacementSlotValue.topRight:
      return margin;
    case ReactSignatureAutoPlacementSlotValue.middleLeft:
    case ReactSignatureAutoPlacementSlotValue.center:
    case ReactSignatureAutoPlacementSlotValue.middleRight:
      return (page.height - draft.height) / 2;
    case ReactSignatureAutoPlacementSlotValue.bottomLeft:
    case ReactSignatureAutoPlacementSlotValue.bottomCenter:
    case ReactSignatureAutoPlacementSlotValue.bottomRight:
      return page.height - margin - draft.height;
  }
};

const rectFromAutoPlacementSlot = (
  slot: ReactSignatureAutoPlacementSlot,
  page: ReactSignaturePage,
  draft: ReactSignatureFieldDraft,
  margin: number,
): ReactSignatureRect => ({
  pageIndex: page.index,
  x: xFromAutoPlacementSlot(slot, page, draft, margin),
  y: yFromAutoPlacementSlot(slot, page, draft, margin),
  width: draft.width,
  height: draft.height,
});

const offsetAutoPlacementRect = (
  rect: ReactSignatureRect,
  direction: ReactSignatureAutoPlacementStackDirection,
  gap: number,
  attempt: number,
): ReactSignatureRect => {
  const horizontal = (rect.width + gap) * attempt;
  const vertical = (rect.height + gap) * attempt;
  switch (direction) {
    case ReactSignatureAutoPlacementStackDirectionValue.up:
      return { ...rect, y: rect.y - vertical };
    case ReactSignatureAutoPlacementStackDirectionValue.down:
      return { ...rect, y: rect.y + vertical };
    case ReactSignatureAutoPlacementStackDirectionValue.left:
      return { ...rect, x: rect.x - horizontal };
    case ReactSignatureAutoPlacementStackDirectionValue.right:
      return { ...rect, x: rect.x + horizontal };
  }
};

const stackedAutoPlacementRect = (
  baseRect: ReactSignatureRect,
  page: ReactSignaturePage,
  fields: readonly ReactSignatureField[],
  direction: ReactSignatureAutoPlacementStackDirection,
  gap: number,
  attempt: number,
): Effect.Effect<ReactSignatureRect, ReactIntegrationError> => {
  const candidate = offsetAutoPlacementRect(baseRect, direction, gap, attempt);
  if (!rectFitsPage(candidate, page)) {
    return Effect.fail(
      new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.noAvailablePlacement,
        retryable: false,
        operation: ReactIntegrationOperationValue.autoPlaceField,
        reason: `No automatic signature slot fits page ${page.index} without leaving its bounds.`,
      }),
    );
  }
  if (!rectCollidesWithFields(candidate, fields)) return Effect.succeed(candidate);
  return stackedAutoPlacementRect(baseRect, page, fields, direction, gap, attempt + 1);
};

const selectAutoPlacementPage = (
  document: ReactSignatureDocument,
  placement: ReactSignatureAutoPlacementInput,
): Effect.Effect<ReactSignaturePage, ReactIntegrationError> => {
  if (placement.page !== undefined && placement.pageIndex !== undefined) {
    return Effect.fail(
      new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: ReactIntegrationOperationValue.autoPlaceField,
        schemaName: ReactIntegrationSchemaNameValue.reactSignatureAutoPlacementInput,
        reason: "Automatic placement accepts either page or pageIndex, not both.",
      }),
    );
  }
  if (placement.page === undefined && placement.pageIndex === undefined) {
    return Effect.fail(
      new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: ReactIntegrationOperationValue.autoPlaceField,
        schemaName: ReactIntegrationSchemaNameValue.reactSignatureAutoPlacementInput,
        reason: "Automatic placement needs an explicit page or pageIndex; it will not infer one.",
      }),
    );
  }
  if (placement.pageIndex !== undefined) {
    const exactPage = document.pages.find((page) => page.index === placement.pageIndex);
    if (exactPage === undefined) {
      return Effect.fail(
        new ReactIntegrationError({
          code: ReactIntegrationErrorCodeValue.unknownDocument,
          retryable: false,
          operation: ReactIntegrationOperationValue.autoPlaceField,
          reason: `Document ${document.id} does not declare page ${placement.pageIndex}.`,
        }),
      );
    }
    return Effect.succeed(exactPage);
  }

  const page =
    placement.page === ReactSignatureAutoPlacementPageValue.first
      ? document.pages[0]
      : document.pages[document.pages.length - 1];
  if (page === undefined) {
    return Effect.fail(
      new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.noAvailablePlacement,
        retryable: false,
        operation: ReactIntegrationOperationValue.autoPlaceField,
        reason: `Document ${document.id} has no page available for automatic placement.`,
      }),
    );
  }
  return Effect.succeed(page);
};

const validateFieldPlacement = (
  template: ReactSignatureTemplate,
  field: ReactSignatureField,
): Effect.Effect<void, ReactIntegrationError> => {
  const document = template.documents.find((candidate) => candidate.id === field.documentId);
  if (document === undefined) {
    return Effect.fail(
      new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.unknownDocument,
        retryable: false,
        operation: ReactIntegrationOperationValue.validateTemplate,
        reason: `Field ${field.id} references an unknown document ${field.documentId}.`,
      }),
    );
  }

  const role = template.roles.find((candidate) => candidate.id === field.roleId);
  if (role === undefined) {
    return Effect.fail(
      new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.unknownRole,
        retryable: false,
        operation: ReactIntegrationOperationValue.validateTemplate,
        reason: `Field ${field.id} references an unknown signer role ${field.roleId}.`,
      }),
    );
  }

  const page = document.pages.find((candidate) => candidate.index === field.rect.pageIndex);
  if (page === undefined) {
    return Effect.fail(
      new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.unknownDocument,
        retryable: false,
        operation: ReactIntegrationOperationValue.validateTemplate,
        reason: `Field ${field.id} references page ${field.rect.pageIndex} that is not declared on document ${document.id}.`,
      }),
    );
  }

  const widthIsPositive = field.rect.width > 0;
  const heightIsPositive = field.rect.height > 0;
  const fitsHorizontally = field.rect.x >= 0 && field.rect.x + field.rect.width <= page.width;
  const fitsVertically = field.rect.y >= 0 && field.rect.y + field.rect.height <= page.height;
  if (!widthIsPositive || !heightIsPositive || !fitsHorizontally || !fitsVertically) {
    return Effect.fail(
      new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.fieldOutOfBounds,
        retryable: false,
        operation: ReactIntegrationOperationValue.validateTemplate,
        reason: `Field ${field.id} must fit within page ${page.index} (${page.width}×${page.height}).`,
      }),
    );
  }

  return Effect.void;
};

export const validateReactSignatureTemplate = (
  input: ReactSignatureTemplate,
): Effect.Effect<ReactSignatureTemplate, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(ReactSignatureTemplateSchema)(input).pipe(
    Effect.mapError((_error) => {
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: ReactIntegrationOperationValue.validateTemplate,
        schemaName: ReactIntegrationSchemaNameValue.reactSignatureTemplate,
        reason: "React signature template does not match the builder schema.",
      });
    }),
    Effect.flatMap((template) => {
      if (template.documents.length === 0 || template.roles.length === 0) {
        return Effect.fail(
          new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.emptyTemplate,
            retryable: false,
            operation: ReactIntegrationOperationValue.validateTemplate,
            reason: "A React signature template needs at least one document and one signer role.",
          }),
        );
      }
      if (
        hasDuplicateId(template.documents) ||
        hasDuplicateId(template.roles) ||
        hasDuplicateId(template.fields)
      ) {
        return Effect.fail(
          new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.duplicateId,
            retryable: false,
            operation: ReactIntegrationOperationValue.validateTemplate,
            reason:
              "React signature template ids must be unique within documents, roles and fields.",
          }),
        );
      }
      return Effect.forEach(template.fields, (field) =>
        validateFieldPlacement(template, field),
      ).pipe(Effect.map(() => template));
    }),
  );

export const createReactSignatureTemplate = (
  input: ReactSignatureTemplateInput,
): Effect.Effect<ReactSignatureTemplate, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(ReactSignatureTemplateInputSchema)(input).pipe(
    Effect.mapError((_error) => {
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: ReactIntegrationOperationValue.createTemplate,
        schemaName: ReactIntegrationSchemaNameValue.reactSignatureTemplateInput,
        reason: "React signature template input does not match the builder schema.",
      });
    }),
    Effect.map((valid) => ({ ...valid, fields: valid.fields ?? [] })),
    Effect.flatMap(validateReactSignatureTemplate),
  );

const builderStateFromTemplate = (
  template: ReactSignatureTemplate,
  selectedFieldId: string | undefined,
  draft: ReactSignatureFieldDraft | undefined,
): Effect.Effect<ReactSignatureBuilderState, ReactIntegrationError> => {
  if (
    selectedFieldId !== undefined &&
    !template.fields.some((field) => field.id === selectedFieldId)
  ) {
    return Effect.fail(
      new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.unknownField,
        retryable: false,
        operation: ReactIntegrationOperationValue.createBuilderState,
        reason: `Selected field ${selectedFieldId} does not exist on template ${template.id}.`,
      }),
    );
  }

  return Effect.succeed({
    template,
    ...(selectedFieldId === undefined ? {} : { selectedFieldId }),
    ...(draft === undefined ? {} : { draft }),
  });
};

export const createReactSignatureBuilderState = (
  input: ReactSignatureBuilderStateInput,
): Effect.Effect<ReactSignatureBuilderState, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(ReactSignatureBuilderStateInputSchema)(input).pipe(
    Effect.mapError((_error) => {
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: ReactIntegrationOperationValue.createBuilderState,
        schemaName: ReactIntegrationSchemaNameValue.reactSignatureBuilderStateInput,
        reason: "React signature builder state input does not match the builder schema.",
      });
    }),
    Effect.flatMap((valid) =>
      createReactSignatureTemplate(valid.template).pipe(
        Effect.flatMap((template) =>
          builderStateFromTemplate(template, valid.selectedFieldId, valid.draft),
        ),
      ),
    ),
  );

export const fieldFromPlacement = (
  placement: ReactSignatureFieldPlacement,
): Effect.Effect<ReactSignatureField, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(ReactSignatureFieldPlacementSchema)(placement).pipe(
    Effect.mapError((_error) => {
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: ReactIntegrationOperationValue.addField,
        schemaName: ReactIntegrationSchemaNameValue.reactSignatureFieldPlacement,
        reason: "React signature field placement does not match the builder schema.",
      });
    }),
    Effect.map((valid) => ({
      id: valid.draft.id,
      type: valid.draft.type,
      documentId: valid.documentId,
      roleId: valid.draft.roleId,
      rect: anchoredRectFromPlacement(valid),
      ...(valid.draft.label === undefined ? {} : { label: valid.draft.label }),
      ...(valid.draft.required === undefined ? {} : { required: valid.draft.required }),
    })),
  );

export const placeReactSignatureField = (
  template: ReactSignatureTemplate,
  placement: ReactSignatureFieldPlacement,
): Effect.Effect<ReactSignatureTemplate, ReactIntegrationError> =>
  validateReactSignatureTemplate(template).pipe(
    Effect.flatMap((checked) =>
      fieldFromPlacement(placement).pipe(
        Effect.flatMap((field) => {
          if (checked.fields.some((candidate) => candidate.id === field.id)) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.duplicateId,
                retryable: false,
                operation: ReactIntegrationOperationValue.addField,
                reason: `Field ${field.id} already exists on template ${checked.id}.`,
              }),
            );
          }

          const document = checked.documents.find((candidate) => candidate.id === field.documentId);
          const page = document?.pages.find(
            (candidate) => candidate.index === field.rect.pageIndex,
          );
          if (page === undefined) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.unknownDocument,
                retryable: false,
                operation: ReactIntegrationOperationValue.addField,
                reason: `Field ${field.id} references a missing document page.`,
              }),
            );
          }

          const clampedField = { ...field, rect: clampRectToPage(field.rect, page) };
          return validateFieldPlacement(checked, clampedField).pipe(
            Effect.map(() => ({ ...checked, fields: [...checked.fields, clampedField] })),
          );
        }),
      ),
    ),
  );

export const autoPlaceReactSignatureField = (
  template: ReactSignatureTemplate,
  placement: ReactSignatureAutoPlacementInput,
): Effect.Effect<ReactSignatureTemplate, ReactIntegrationError> =>
  Schema.decodeUnknownEffect(ReactSignatureAutoPlacementInputSchema)(placement).pipe(
    Effect.mapError((_error) => {
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: ReactIntegrationOperationValue.autoPlaceField,
        schemaName: ReactIntegrationSchemaNameValue.reactSignatureAutoPlacementInput,
        reason: "React signature auto-placement input does not match the builder schema.",
      });
    }),
    Effect.flatMap((valid) =>
      validateReactSignatureTemplate(template).pipe(
        Effect.flatMap((checked) => {
          const margin = valid.margin ?? 0;
          const gap = valid.gap ?? 0;
          const collision = valid.collision ?? ReactSignatureAutoPlacementCollisionValue.fail;

          if (valid.draft.width <= 0 || valid.draft.height <= 0) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: ReactIntegrationOperationValue.autoPlaceField,
                schemaName: ReactIntegrationSchemaNameValue.reactSignatureAutoPlacementInput,
                reason: "Automatic placement draft must have positive width and height.",
              }),
            );
          }
          if (margin < 0 || gap < 0) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: ReactIntegrationOperationValue.autoPlaceField,
                schemaName: ReactIntegrationSchemaNameValue.reactSignatureAutoPlacementInput,
                reason: "Automatic placement margin and gap must be non-negative.",
              }),
            );
          }
          if (
            collision === ReactSignatureAutoPlacementCollisionValue.stack &&
            valid.stackDirection === undefined
          ) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: ReactIntegrationOperationValue.autoPlaceField,
                schemaName: ReactIntegrationSchemaNameValue.reactSignatureAutoPlacementInput,
                reason: "Automatic stacked placement requires an explicit stackDirection.",
              }),
            );
          }
          if (
            collision !== ReactSignatureAutoPlacementCollisionValue.stack &&
            valid.stackDirection !== undefined
          ) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: ReactIntegrationOperationValue.autoPlaceField,
                schemaName: ReactIntegrationSchemaNameValue.reactSignatureAutoPlacementInput,
                reason: "Automatic placement stackDirection is only valid with collision: stack.",
              }),
            );
          }
          if (checked.fields.some((candidate) => candidate.id === valid.draft.id)) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.duplicateId,
                retryable: false,
                operation: ReactIntegrationOperationValue.autoPlaceField,
                reason: `Field ${valid.draft.id} already exists on template ${checked.id}.`,
              }),
            );
          }

          const document = checked.documents.find((candidate) => candidate.id === valid.documentId);
          if (document === undefined) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.unknownDocument,
                retryable: false,
                operation: ReactIntegrationOperationValue.autoPlaceField,
                reason: `Automatic placement references an unknown document ${valid.documentId}.`,
              }),
            );
          }

          return selectAutoPlacementPage(document, valid).pipe(
            Effect.flatMap((page) => {
              const baseRect = rectFromAutoPlacementSlot(valid.slot, page, valid.draft, margin);
              if (!rectFitsPage(baseRect, page)) {
                return Effect.fail(
                  new ReactIntegrationError({
                    code: ReactIntegrationErrorCodeValue.noAvailablePlacement,
                    retryable: false,
                    operation: ReactIntegrationOperationValue.autoPlaceField,
                    reason: `Automatic signature slot ${valid.slot} does not fit page ${page.index}.`,
                  }),
                );
              }

              const fields = autoPlacementFieldsForPage(checked, valid.documentId, page.index);
              const rectEffect =
                collision === ReactSignatureAutoPlacementCollisionValue.stack &&
                valid.stackDirection !== undefined
                  ? stackedAutoPlacementRect(baseRect, page, fields, valid.stackDirection, gap, 0)
                  : rectCollidesWithFields(baseRect, fields)
                    ? Effect.fail(
                        new ReactIntegrationError({
                          code: ReactIntegrationErrorCodeValue.noAvailablePlacement,
                          retryable: false,
                          operation: ReactIntegrationOperationValue.autoPlaceField,
                          reason: `Automatic signature slot ${valid.slot} collides with an existing field on page ${page.index}.`,
                        }),
                      )
                    : Effect.succeed(baseRect);

              return rectEffect.pipe(
                Effect.flatMap((rect) => {
                  const field = {
                    id: valid.draft.id,
                    type: valid.draft.type,
                    documentId: valid.documentId,
                    roleId: valid.draft.roleId,
                    rect,
                    ...(valid.draft.label === undefined ? {} : { label: valid.draft.label }),
                    ...(valid.draft.required === undefined
                      ? {}
                      : { required: valid.draft.required }),
                  };
                  return validateFieldPlacement(checked, field).pipe(
                    Effect.map(() => ({ ...checked, fields: [...checked.fields, field] })),
                  );
                }),
              );
            }),
          );
        }),
      ),
    ),
  );

export const addReactSignatureField = (
  template: ReactSignatureTemplate,
  field: ReactSignatureField,
): Effect.Effect<ReactSignatureTemplate, ReactIntegrationError> =>
  validateReactSignatureTemplate(template).pipe(
    Effect.flatMap((checked) =>
      Schema.decodeUnknownEffect(ReactSignatureFieldSchema)(field).pipe(
        Effect.mapError((_error) => {
          return new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
            retryable: false,
            operation: ReactIntegrationOperationValue.addField,
            schemaName: ReactIntegrationSchemaNameValue.reactSignatureField,
            reason: "React signature field does not match the builder schema.",
          });
        }),
        Effect.flatMap((decodedField) => {
          if (checked.fields.some((candidate) => candidate.id === decodedField.id)) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.duplicateId,
                retryable: false,
                operation: ReactIntegrationOperationValue.addField,
                reason: `Field ${decodedField.id} already exists on template ${checked.id}.`,
              }),
            );
          }
          return validateFieldPlacement(checked, decodedField).pipe(
            Effect.map(() => ({ ...checked, fields: [...checked.fields, decodedField] })),
          );
        }),
      ),
    ),
  );

export const replaceReactSignatureField = (
  template: ReactSignatureTemplate,
  field: ReactSignatureField,
): Effect.Effect<ReactSignatureTemplate, ReactIntegrationError> =>
  validateReactSignatureTemplate(template).pipe(
    Effect.flatMap((checked) =>
      Schema.decodeUnknownEffect(ReactSignatureFieldSchema)(field).pipe(
        Effect.mapError((_error) => {
          return new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
            retryable: false,
            operation: ReactIntegrationOperationValue.replaceField,
            schemaName: ReactIntegrationSchemaNameValue.reactSignatureField,
            reason: "React signature field does not match the builder schema.",
          });
        }),
        Effect.flatMap((decodedField) => {
          if (!checked.fields.some((candidate) => candidate.id === decodedField.id)) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.unknownField,
                retryable: false,
                operation: ReactIntegrationOperationValue.replaceField,
                reason: `Field ${decodedField.id} does not exist on template ${checked.id}.`,
              }),
            );
          }
          const next = {
            ...checked,
            fields: checked.fields.map((candidate) =>
              candidate.id === decodedField.id ? decodedField : candidate,
            ),
          };
          return validateReactSignatureTemplate(next);
        }),
      ),
    ),
  );

export const removeReactSignatureField = (
  template: ReactSignatureTemplate,
  fieldId: string,
): Effect.Effect<ReactSignatureTemplate, ReactIntegrationError> =>
  validateReactSignatureTemplate(template).pipe(
    Effect.flatMap((checked) => {
      if (!checked.fields.some((candidate) => candidate.id === fieldId)) {
        return Effect.fail(
          new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.unknownField,
            retryable: false,
            operation: ReactIntegrationOperationValue.removeField,
            reason: `Field ${fieldId} does not exist on template ${checked.id}.`,
          }),
        );
      }
      return Effect.succeed({
        ...checked,
        fields: checked.fields.filter((candidate) => candidate.id !== fieldId),
      });
    }),
  );

export const moveReactSignatureField = (
  template: ReactSignatureTemplate,
  fieldId: string,
  rect: ReactSignatureRect,
): Effect.Effect<ReactSignatureTemplate, ReactIntegrationError> =>
  validateReactSignatureTemplate(template).pipe(
    Effect.flatMap((checked) =>
      Schema.decodeUnknownEffect(ReactSignatureRectSchema)(rect).pipe(
        Effect.mapError((_error) => {
          return new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
            retryable: false,
            operation: ReactIntegrationOperationValue.moveField,
            schemaName: ReactIntegrationSchemaNameValue.reactSignatureRect,
            reason: "React signature field rect does not match the builder schema.",
          });
        }),
        Effect.flatMap((decodedRect) => {
          const existing = checked.fields.find((candidate) => candidate.id === fieldId);
          if (existing === undefined) {
            return Effect.fail(
              new ReactIntegrationError({
                code: ReactIntegrationErrorCodeValue.unknownField,
                retryable: false,
                operation: ReactIntegrationOperationValue.moveField,
                reason: `Field ${fieldId} does not exist on template ${checked.id}.`,
              }),
            );
          }
          return replaceReactSignatureField(checked, { ...existing, rect: decodedRect });
        }),
      ),
    ),
  );

export const pdfSignatureAppearanceFromField = (
  template: ReactSignatureTemplate,
  fieldId: string,
): Effect.Effect<PdfSignatureAppearance, ReactIntegrationError> =>
  validateReactSignatureTemplate(template).pipe(
    Effect.flatMap((checked) => {
      const field = checked.fields.find((candidate) => candidate.id === fieldId);
      if (field === undefined) {
        return Effect.fail(
          new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.unknownField,
            retryable: false,
            operation: ReactIntegrationOperationValue.pdfAppearance,
            reason: `Field ${fieldId} does not exist on template ${checked.id}.`,
          }),
        );
      }
      const document = checked.documents.find((candidate) => candidate.id === field.documentId);
      const page = document?.pages.find((candidate) => candidate.index === field.rect.pageIndex);
      if (page === undefined) {
        return Effect.fail(
          new ReactIntegrationError({
            code: ReactIntegrationErrorCodeValue.unknownDocument,
            retryable: false,
            operation: ReactIntegrationOperationValue.pdfAppearance,
            reason: `Field ${field.id} references a missing document page.`,
          }),
        );
      }
      const bottom = page.height - field.rect.y - field.rect.height;
      const top = page.height - field.rect.y;
      const widgetRect: PdfSignatureAppearance["widgetRect"] = [
        field.rect.x,
        bottom,
        field.rect.x + field.rect.width,
        top,
      ];
      return Effect.succeed({ pageIndex: field.rect.pageIndex, widgetRect });
    }),
  );
