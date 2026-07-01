import type { PdfSignatureAppearance } from "./config";
import { Effect, Schema } from "effect";
import {
  PdfSignatureAutoPlacementCollisionValue,
  PdfSignatureAutoPlacementInputSchema,
  PdfSignatureAutoPlacementPageValue,
  PdfSignatureAutoPlacementSlotValue,
  PdfSignatureAutoPlacementStackDirectionValue,
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSchemaNameValue,
  PdfSignatureBuilderStateInputSchema,
  PdfSignatureFieldPlacementSchema,
  PdfSignatureFieldSchema,
  PdfSignaturePlacementAnchorValue,
  PdfSignatureRectSchema,
  PdfSignatureTemplateInputSchema,
  PdfSignatureTemplateSchema,
} from "./config";
import type {
  PdfSignatureAutoPlacementInput,
  PdfSignatureAutoPlacementSlot,
  PdfSignatureAutoPlacementStackDirection,
  PdfSignatureBuilderState,
  PdfSignatureBuilderStateInput,
  PdfSignatureDocument,
  PdfSignatureField,
  PdfSignatureFieldDraft,
  PdfSignatureFieldPlacement,
  PdfSignaturePage,
  PdfSignatureRect,
  PdfSignatureTemplate,
  PdfSignatureTemplateInput,
} from "./config";

const fieldPageKey = (documentId: string, pageIndex: number): string =>
  `${documentId}:${pageIndex}`;

export type PdfSignatureFieldsByPage = ReadonlyMap<string, readonly PdfSignatureField[]>;

export const groupPdfSignatureFieldsByPage = (
  fields: readonly PdfSignatureField[],
): PdfSignatureFieldsByPage => {
  const grouped = new Map<string, PdfSignatureField[]>();
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

export const pdfSignatureFieldsForPage = (
  grouped: PdfSignatureFieldsByPage,
  documentId: string,
  pageIndex: number,
): readonly PdfSignatureField[] => grouped.get(fieldPageKey(documentId, pageIndex)) ?? [];

const hasDuplicateId = (items: readonly { readonly id: string }[]): boolean => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) return true;
    seen.add(item.id);
  }
  return false;
};

const anchoredRectFromPlacement = (placement: PdfSignatureFieldPlacement): PdfSignatureRect => {
  const anchor = placement.anchor ?? PdfSignaturePlacementAnchorValue.topLeft;
  const x =
    anchor === PdfSignaturePlacementAnchorValue.center
      ? placement.x - placement.draft.width / 2
      : placement.x;
  const y =
    anchor === PdfSignaturePlacementAnchorValue.center
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

const clampRectToPage = (rect: PdfSignatureRect, page: PdfSignaturePage): PdfSignatureRect => ({
  ...rect,
  x: clampCoordinate(rect.x, rect.width, page.width),
  y: clampCoordinate(rect.y, rect.height, page.height),
});

const rectFitsPage = (rect: PdfSignatureRect, page: PdfSignaturePage): boolean =>
  rect.x >= 0 &&
  rect.y >= 0 &&
  rect.width > 0 &&
  rect.height > 0 &&
  rect.x + rect.width <= page.width &&
  rect.y + rect.height <= page.height;

const rectsOverlap = (left: PdfSignatureRect, right: PdfSignatureRect): boolean =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

const autoPlacementFieldsForPage = (
  template: PdfSignatureTemplate,
  documentId: string,
  pageIndex: number,
): readonly PdfSignatureField[] =>
  template.fields.filter(
    (field) => field.documentId === documentId && field.rect.pageIndex === pageIndex,
  );

const rectCollidesWithFields = (
  rect: PdfSignatureRect,
  fields: readonly PdfSignatureField[],
): boolean => fields.some((field) => rectsOverlap(rect, field.rect));

const xFromAutoPlacementSlot = (
  slot: PdfSignatureAutoPlacementSlot,
  page: PdfSignaturePage,
  draft: PdfSignatureFieldDraft,
  margin: number,
): number => {
  switch (slot) {
    case PdfSignatureAutoPlacementSlotValue.topLeft:
    case PdfSignatureAutoPlacementSlotValue.middleLeft:
    case PdfSignatureAutoPlacementSlotValue.bottomLeft:
      return margin;
    case PdfSignatureAutoPlacementSlotValue.topCenter:
    case PdfSignatureAutoPlacementSlotValue.center:
    case PdfSignatureAutoPlacementSlotValue.bottomCenter:
      return (page.width - draft.width) / 2;
    case PdfSignatureAutoPlacementSlotValue.topRight:
    case PdfSignatureAutoPlacementSlotValue.middleRight:
    case PdfSignatureAutoPlacementSlotValue.bottomRight:
      return page.width - margin - draft.width;
  }
};

const yFromAutoPlacementSlot = (
  slot: PdfSignatureAutoPlacementSlot,
  page: PdfSignaturePage,
  draft: PdfSignatureFieldDraft,
  margin: number,
): number => {
  switch (slot) {
    case PdfSignatureAutoPlacementSlotValue.topLeft:
    case PdfSignatureAutoPlacementSlotValue.topCenter:
    case PdfSignatureAutoPlacementSlotValue.topRight:
      return margin;
    case PdfSignatureAutoPlacementSlotValue.middleLeft:
    case PdfSignatureAutoPlacementSlotValue.center:
    case PdfSignatureAutoPlacementSlotValue.middleRight:
      return (page.height - draft.height) / 2;
    case PdfSignatureAutoPlacementSlotValue.bottomLeft:
    case PdfSignatureAutoPlacementSlotValue.bottomCenter:
    case PdfSignatureAutoPlacementSlotValue.bottomRight:
      return page.height - margin - draft.height;
  }
};

const rectFromAutoPlacementSlot = (
  slot: PdfSignatureAutoPlacementSlot,
  page: PdfSignaturePage,
  draft: PdfSignatureFieldDraft,
  margin: number,
): PdfSignatureRect => ({
  pageIndex: page.index,
  x: xFromAutoPlacementSlot(slot, page, draft, margin),
  y: yFromAutoPlacementSlot(slot, page, draft, margin),
  width: draft.width,
  height: draft.height,
});

const offsetAutoPlacementRect = (
  rect: PdfSignatureRect,
  direction: PdfSignatureAutoPlacementStackDirection,
  gap: number,
  attempt: number,
): PdfSignatureRect => {
  const horizontal = (rect.width + gap) * attempt;
  const vertical = (rect.height + gap) * attempt;
  switch (direction) {
    case PdfSignatureAutoPlacementStackDirectionValue.up:
      return { ...rect, y: rect.y - vertical };
    case PdfSignatureAutoPlacementStackDirectionValue.down:
      return { ...rect, y: rect.y + vertical };
    case PdfSignatureAutoPlacementStackDirectionValue.left:
      return { ...rect, x: rect.x - horizontal };
    case PdfSignatureAutoPlacementStackDirectionValue.right:
      return { ...rect, x: rect.x + horizontal };
  }
};

const stackedAutoPlacementRect = (
  baseRect: PdfSignatureRect,
  page: PdfSignaturePage,
  fields: readonly PdfSignatureField[],
  direction: PdfSignatureAutoPlacementStackDirection,
  gap: number,
  attempt: number,
): Effect.Effect<PdfSignatureRect, PdfError> => {
  const candidate = offsetAutoPlacementRect(baseRect, direction, gap, attempt);
  if (!rectFitsPage(candidate, page)) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.noAvailablePlacement,
        retryable: false,
        operation: PdfOperationValue.autoPlaceField,
        reason: `No automatic signature slot fits page ${page.index} without leaving its bounds.`,
      }),
    );
  }
  if (!rectCollidesWithFields(candidate, fields)) return Effect.succeed(candidate);
  return stackedAutoPlacementRect(baseRect, page, fields, direction, gap, attempt + 1);
};

const selectAutoPlacementPage = (
  document: PdfSignatureDocument,
  placement: PdfSignatureAutoPlacementInput,
): Effect.Effect<PdfSignaturePage, PdfError> => {
  if (placement.page !== undefined && placement.pageIndex !== undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.autoPlaceField,
        schemaName: PdfSchemaNameValue.pdfSignatureAutoPlacementInput,
        reason: "Automatic placement accepts either page or pageIndex, not both.",
      }),
    );
  }
  if (placement.page === undefined && placement.pageIndex === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.autoPlaceField,
        schemaName: PdfSchemaNameValue.pdfSignatureAutoPlacementInput,
        reason: "Automatic placement needs an explicit page or pageIndex; it will not infer one.",
      }),
    );
  }
  if (placement.pageIndex !== undefined) {
    const exactPage = document.pages.find((page) => page.index === placement.pageIndex);
    if (exactPage === undefined) {
      return Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.unknownDocument,
          retryable: false,
          operation: PdfOperationValue.autoPlaceField,
          reason: `Document ${document.id} does not declare page ${placement.pageIndex}.`,
        }),
      );
    }
    return Effect.succeed(exactPage);
  }

  const page =
    placement.page === PdfSignatureAutoPlacementPageValue.first
      ? document.pages[0]
      : document.pages[document.pages.length - 1];
  if (page === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.noAvailablePlacement,
        retryable: false,
        operation: PdfOperationValue.autoPlaceField,
        reason: `Document ${document.id} has no page available for automatic placement.`,
      }),
    );
  }
  return Effect.succeed(page);
};

const validateFieldPlacement = (
  template: PdfSignatureTemplate,
  field: PdfSignatureField,
): Effect.Effect<void, PdfError> => {
  const document = template.documents.find((candidate) => candidate.id === field.documentId);
  if (document === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.unknownDocument,
        retryable: false,
        operation: PdfOperationValue.validateTemplate,
        reason: `Field ${field.id} references an unknown document ${field.documentId}.`,
      }),
    );
  }

  const role = template.roles.find((candidate) => candidate.id === field.roleId);
  if (role === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.unknownRole,
        retryable: false,
        operation: PdfOperationValue.validateTemplate,
        reason: `Field ${field.id} references an unknown signer role ${field.roleId}.`,
      }),
    );
  }

  const page = document.pages.find((candidate) => candidate.index === field.rect.pageIndex);
  if (page === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.unknownDocument,
        retryable: false,
        operation: PdfOperationValue.validateTemplate,
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
      new PdfError({
        code: PdfErrorCodeValue.fieldOutOfBounds,
        retryable: false,
        operation: PdfOperationValue.validateTemplate,
        reason: `Field ${field.id} must fit within page ${page.index} (${page.width}×${page.height}).`,
      }),
    );
  }

  return Effect.void;
};

export const validatePdfSignatureTemplate = (
  input: PdfSignatureTemplate,
): Effect.Effect<PdfSignatureTemplate, PdfError> =>
  Schema.decodeUnknownEffect(PdfSignatureTemplateSchema)(input).pipe(
    Effect.mapError((issue) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.validateTemplate,
        schemaName: PdfSchemaNameValue.pdfSignatureTemplate,
        issueMessage: String(issue),
        reason: "PDF signature template does not match the builder schema.",
      });
    }),
    Effect.flatMap((template) => {
      if (template.documents.length === 0 || template.roles.length === 0) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.emptyTemplate,
            retryable: false,
            operation: PdfOperationValue.validateTemplate,
            reason: "A PDF signature template needs at least one document and one signer role.",
          }),
        );
      }
      if (
        hasDuplicateId(template.documents) ||
        hasDuplicateId(template.roles) ||
        hasDuplicateId(template.fields)
      ) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.duplicateId,
            retryable: false,
            operation: PdfOperationValue.validateTemplate,
            reason: "PDF signature template ids must be unique within documents, roles and fields.",
          }),
        );
      }
      return Effect.forEach(template.fields, (field) => validateFieldPlacement(template, field), {
        discard: true,
      }).pipe(Effect.as(template));
    }),
  );

export const createPdfSignatureTemplate = (
  input: PdfSignatureTemplateInput,
): Effect.Effect<PdfSignatureTemplate, PdfError> =>
  Schema.decodeUnknownEffect(PdfSignatureTemplateInputSchema)(input).pipe(
    Effect.mapError((issue) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.createTemplate,
        schemaName: PdfSchemaNameValue.pdfSignatureTemplateInput,
        issueMessage: String(issue),
        reason: "PDF signature template input does not match the builder schema.",
      });
    }),
    Effect.map((valid) => ({ ...valid, fields: valid.fields ?? [] })),
    Effect.flatMap(validatePdfSignatureTemplate),
  );

const builderStateFromTemplate = (
  template: PdfSignatureTemplate,
  selectedFieldId: string | undefined,
  draft: PdfSignatureFieldDraft | undefined,
): Effect.Effect<PdfSignatureBuilderState, PdfError> => {
  if (
    selectedFieldId !== undefined &&
    !template.fields.some((field) => field.id === selectedFieldId)
  ) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.unknownField,
        retryable: false,
        operation: PdfOperationValue.createBuilderState,
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

export const createPdfSignatureBuilderStateFromTemplate = (
  input: PdfSignatureBuilderStateInput,
): Effect.Effect<PdfSignatureBuilderState, PdfError> =>
  Schema.decodeUnknownEffect(PdfSignatureBuilderStateInputSchema)(input).pipe(
    Effect.mapError((issue) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.createBuilderState,
        schemaName: PdfSchemaNameValue.pdfSignatureBuilderStateInput,
        issueMessage: String(issue),
        reason: "PDF signature builder state input does not match the builder schema.",
      });
    }),
    Effect.flatMap((valid) =>
      createPdfSignatureTemplate(valid.template).pipe(
        Effect.flatMap((template) =>
          builderStateFromTemplate(template, valid.selectedFieldId, valid.draft),
        ),
      ),
    ),
  );

export const pdfSignatureFieldFromPlacement = (
  placement: PdfSignatureFieldPlacement,
): Effect.Effect<PdfSignatureField, PdfError> =>
  Schema.decodeUnknownEffect(PdfSignatureFieldPlacementSchema)(placement).pipe(
    Effect.mapError((issue) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.addField,
        schemaName: PdfSchemaNameValue.pdfSignatureFieldPlacement,
        issueMessage: String(issue),
        reason: "PDF signature field placement does not match the builder schema.",
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

export const placePdfSignatureField = (
  template: PdfSignatureTemplate,
  placement: PdfSignatureFieldPlacement,
): Effect.Effect<PdfSignatureTemplate, PdfError> =>
  validatePdfSignatureTemplate(template).pipe(
    Effect.flatMap((checked) =>
      pdfSignatureFieldFromPlacement(placement).pipe(
        Effect.flatMap((field) => {
          if (checked.fields.some((candidate) => candidate.id === field.id)) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.duplicateId,
                retryable: false,
                operation: PdfOperationValue.addField,
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
              new PdfError({
                code: PdfErrorCodeValue.unknownDocument,
                retryable: false,
                operation: PdfOperationValue.addField,
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

export const autoPlacePdfSignatureField = (
  template: PdfSignatureTemplate,
  placement: PdfSignatureAutoPlacementInput,
): Effect.Effect<PdfSignatureTemplate, PdfError> =>
  Schema.decodeUnknownEffect(PdfSignatureAutoPlacementInputSchema)(placement).pipe(
    Effect.mapError((issue) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        operation: PdfOperationValue.autoPlaceField,
        schemaName: PdfSchemaNameValue.pdfSignatureAutoPlacementInput,
        issueMessage: String(issue),
        reason: "PDF signature auto-placement input does not match the builder schema.",
      });
    }),
    Effect.flatMap((valid) =>
      validatePdfSignatureTemplate(template).pipe(
        Effect.flatMap((checked) => {
          const margin = valid.margin ?? 0;
          const gap = valid.gap ?? 0;
          const collision = valid.collision ?? PdfSignatureAutoPlacementCollisionValue.fail;

          if (valid.draft.width <= 0 || valid.draft.height <= 0) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: PdfOperationValue.autoPlaceField,
                schemaName: PdfSchemaNameValue.pdfSignatureAutoPlacementInput,
                reason: "Automatic placement draft must have positive width and height.",
              }),
            );
          }
          if (margin < 0 || gap < 0) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: PdfOperationValue.autoPlaceField,
                schemaName: PdfSchemaNameValue.pdfSignatureAutoPlacementInput,
                reason: "Automatic placement margin and gap must be non-negative.",
              }),
            );
          }
          if (
            collision === PdfSignatureAutoPlacementCollisionValue.stack &&
            valid.stackDirection === undefined
          ) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: PdfOperationValue.autoPlaceField,
                schemaName: PdfSchemaNameValue.pdfSignatureAutoPlacementInput,
                reason: "Automatic stacked placement requires an explicit stackDirection.",
              }),
            );
          }
          if (
            collision !== PdfSignatureAutoPlacementCollisionValue.stack &&
            valid.stackDirection !== undefined
          ) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: PdfOperationValue.autoPlaceField,
                schemaName: PdfSchemaNameValue.pdfSignatureAutoPlacementInput,
                reason: "Automatic placement stackDirection is only valid with collision: stack.",
              }),
            );
          }
          if (checked.fields.some((candidate) => candidate.id === valid.draft.id)) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.duplicateId,
                retryable: false,
                operation: PdfOperationValue.autoPlaceField,
                reason: `Field ${valid.draft.id} already exists on template ${checked.id}.`,
              }),
            );
          }

          const document = checked.documents.find((candidate) => candidate.id === valid.documentId);
          if (document === undefined) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.unknownDocument,
                retryable: false,
                operation: PdfOperationValue.autoPlaceField,
                reason: `Automatic placement references an unknown document ${valid.documentId}.`,
              }),
            );
          }

          return selectAutoPlacementPage(document, valid).pipe(
            Effect.flatMap((page) => {
              const baseRect = rectFromAutoPlacementSlot(valid.slot, page, valid.draft, margin);
              if (!rectFitsPage(baseRect, page)) {
                return Effect.fail(
                  new PdfError({
                    code: PdfErrorCodeValue.noAvailablePlacement,
                    retryable: false,
                    operation: PdfOperationValue.autoPlaceField,
                    reason: `Automatic signature slot ${valid.slot} does not fit page ${page.index}.`,
                  }),
                );
              }

              const fields = autoPlacementFieldsForPage(checked, valid.documentId, page.index);
              const rectEffect =
                collision === PdfSignatureAutoPlacementCollisionValue.stack &&
                valid.stackDirection !== undefined
                  ? stackedAutoPlacementRect(baseRect, page, fields, valid.stackDirection, gap, 0)
                  : rectCollidesWithFields(baseRect, fields)
                    ? Effect.fail(
                        new PdfError({
                          code: PdfErrorCodeValue.noAvailablePlacement,
                          retryable: false,
                          operation: PdfOperationValue.autoPlaceField,
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

export const addPdfSignatureField = (
  template: PdfSignatureTemplate,
  field: PdfSignatureField,
): Effect.Effect<PdfSignatureTemplate, PdfError> =>
  validatePdfSignatureTemplate(template).pipe(
    Effect.flatMap((checked) =>
      Schema.decodeUnknownEffect(PdfSignatureFieldSchema)(field).pipe(
        Effect.mapError((issue) => {
          return new PdfError({
            code: PdfErrorCodeValue.invalidBuilderInput,
            retryable: false,
            operation: PdfOperationValue.addField,
            schemaName: PdfSchemaNameValue.pdfSignatureField,
            issueMessage: String(issue),
            reason: "PDF signature field does not match the builder schema.",
          });
        }),
        Effect.flatMap((decodedField) => {
          if (checked.fields.some((candidate) => candidate.id === decodedField.id)) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.duplicateId,
                retryable: false,
                operation: PdfOperationValue.addField,
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

export const replacePdfSignatureField = (
  template: PdfSignatureTemplate,
  field: PdfSignatureField,
): Effect.Effect<PdfSignatureTemplate, PdfError> =>
  validatePdfSignatureTemplate(template).pipe(
    Effect.flatMap((checked) =>
      Schema.decodeUnknownEffect(PdfSignatureFieldSchema)(field).pipe(
        Effect.mapError((issue) => {
          return new PdfError({
            code: PdfErrorCodeValue.invalidBuilderInput,
            retryable: false,
            operation: PdfOperationValue.replaceField,
            schemaName: PdfSchemaNameValue.pdfSignatureField,
            issueMessage: String(issue),
            reason: "PDF signature field does not match the builder schema.",
          });
        }),
        Effect.flatMap((decodedField) => {
          if (!checked.fields.some((candidate) => candidate.id === decodedField.id)) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.unknownField,
                retryable: false,
                operation: PdfOperationValue.replaceField,
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
          return validatePdfSignatureTemplate(next);
        }),
      ),
    ),
  );

export const removePdfSignatureField = (
  template: PdfSignatureTemplate,
  fieldId: string,
): Effect.Effect<PdfSignatureTemplate, PdfError> =>
  validatePdfSignatureTemplate(template).pipe(
    Effect.flatMap((checked) => {
      if (!checked.fields.some((candidate) => candidate.id === fieldId)) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.unknownField,
            retryable: false,
            operation: PdfOperationValue.removeField,
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

export const movePdfSignatureField = (
  template: PdfSignatureTemplate,
  fieldId: string,
  rect: PdfSignatureRect,
): Effect.Effect<PdfSignatureTemplate, PdfError> =>
  validatePdfSignatureTemplate(template).pipe(
    Effect.flatMap((checked) =>
      Schema.decodeUnknownEffect(PdfSignatureRectSchema)(rect).pipe(
        Effect.mapError((issue) => {
          return new PdfError({
            code: PdfErrorCodeValue.invalidBuilderInput,
            retryable: false,
            operation: PdfOperationValue.moveField,
            schemaName: PdfSchemaNameValue.pdfSignatureRect,
            issueMessage: String(issue),
            reason: "PDF signature field rect does not match the builder schema.",
          });
        }),
        Effect.flatMap((decodedRect) => {
          const existing = checked.fields.find((candidate) => candidate.id === fieldId);
          if (existing === undefined) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.unknownField,
                retryable: false,
                operation: PdfOperationValue.moveField,
                reason: `Field ${fieldId} does not exist on template ${checked.id}.`,
              }),
            );
          }
          return replacePdfSignatureField(checked, { ...existing, rect: decodedRect });
        }),
      ),
    ),
  );

export const pdfSignatureAppearanceFromField = (
  template: PdfSignatureTemplate,
  fieldId: string,
): Effect.Effect<PdfSignatureAppearance, PdfError> =>
  validatePdfSignatureTemplate(template).pipe(
    Effect.flatMap((checked) => {
      const field = checked.fields.find((candidate) => candidate.id === fieldId);
      if (field === undefined) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.unknownField,
            retryable: false,
            operation: PdfOperationValue.pdfAppearance,
            reason: `Field ${fieldId} does not exist on template ${checked.id}.`,
          }),
        );
      }
      const document = checked.documents.find((candidate) => candidate.id === field.documentId);
      const page = document?.pages.find((candidate) => candidate.index === field.rect.pageIndex);
      if (page === undefined) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.unknownDocument,
            retryable: false,
            operation: PdfOperationValue.pdfAppearance,
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
