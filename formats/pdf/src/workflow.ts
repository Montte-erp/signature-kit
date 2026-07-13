import { PDFDocument, type PDFPage } from "@cantoo/pdf-lib";
import type { CmsError } from "@signature-kit/cms/config";
import type { SignatureKitError } from "@signature-kit/signatures";
import type { Signatures } from "@signature-kit/signatures";
import { signPdf as signPdfDocument } from "./sign.js";
import { findPdfTextAnchors } from "./anchors.js";
import type { LiteParseWorkerFactory } from "./liteparse-browser.js";
import { Effect, Schema } from "effect";
import {
  autoPlacePdfSignatureField,
  createPdfSignatureBuilderStateFromTemplate,
  createPdfSignatureTemplate,
  placePdfSignatureField,
  validatePdfSignatureTemplate,
} from "./builder.js";
import {
  PdfDocumentInputSchema,
  PdfDocumentSourceTypeValue,
  PdfPrepareAndSignInputSchema,
  PdfSignatureBuilderInputSchema,
  PdfSigningBatchPreparationInputSchema,
  PdfSigningInputSchema,
  PdfTemplateInputSchema,
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSchemaNameValue,
} from "./config.js";
import type {
  PdfDocumentInput,
  PdfCoordinateTuple,
  PdfOperation,
  PdfBatchResult,
  PdfPrepareAndSignInput,
  PdfSignaturePage,
  PdfSignatureRect,
  PdfSigningBatchDocument,
  PdfSigningBatchItem,
  PdfSigningBatchPreparationInput,
  PdfSigningBatchPreparationResult,
  PdfSigningBatchVisibleStamp,
  PdfSigningInput,
  PdfSignatureBuilderInput,
  PdfTemplateInput,
  PdfSignatureBuilderState,
  PdfSignatureDocument,
  PdfSignatureTemplate,
} from "./config.js";

import {
  defaultPdfSignatureRect,
  pdfCoordinateTupleFromTopLeftRect,
  rubricPageIndexesExcludingSignature,
  stampPdfRubricOnPages,
  stampPdfVisibleSignatures,
  visiblePdfPageSize,
} from "./stamp.js";
import { hasPdfByteRange } from "./byte-range.js";

export type PdfPageLabeler = (pageNumber: number) => string;

type PdfDocumentLoadOptions = {
  readonly pageLabel?: PdfPageLabeler;
};

type PdfLoadedSignatureDocument = {
  readonly document: PdfSignatureDocument;
  readonly pdfPages: ReadonlyArray<PDFPage>;
};

const hasSignaturePage = (
  signaturePageIndexes: ReadonlyArray<number>,
  pageIndex: number,
): boolean => signaturePageIndexes.includes(pageIndex);

const rubricPagesExcludingSignatures = (
  pageDimensions: ReadonlyArray<PdfSignaturePage>,
  signaturePageIndexes: ReadonlyArray<number>,
): ReadonlyArray<number> =>
  pageDimensions.flatMap((_page, index) =>
    hasSignaturePage(signaturePageIndexes, index) ? [] : [index],
  );

export const readPdfBlobBytes = (file: Blob): Effect.Effect<Uint8Array, PdfError> =>
  Effect.tryPromise({
    try: async () => new Uint8Array(await file.arrayBuffer()),
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.fileReadFailed,
        retryable: true,
        reason: "PDF Blob could not be read as an ArrayBuffer.",
        operation: PdfOperationValue.readBlobBytes,
      }),
  });

const loadPdfSignatureDocumentWithPages = (
  input: PdfDocumentInput,
  options?: PdfDocumentLoadOptions,
): Effect.Effect<PdfLoadedSignatureDocument, PdfError> =>
  Schema.decodeUnknownEffect(PdfDocumentInputSchema)(input).pipe(
    Effect.mapError((issue) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "PDF document input failed schema validation.",
        operation: PdfOperationValue.loadDocument,
        schemaName: PdfSchemaNameValue.pdfDocumentInput,
        issueMessage: String(issue),
      });
    }),
    Effect.flatMap((valid) =>
      Effect.tryPromise({
        try: async () => {
          const pdf = await PDFDocument.load(valid.pdf);
          const pdfPages = pdf.getPages();
          const pages = pdfPages.map((page, index) => {
            const size = visiblePdfPageSize(page);
            const label = options?.pageLabel?.(index + 1);
            return {
              index,
              width: size.width,
              height: size.height,
              ...(label === undefined ? {} : { label }),
            };
          });
          return {
            document: {
              id: valid.id,
              name: valid.name,
              source: valid.source ?? { type: PdfDocumentSourceTypeValue.uploaded },
              pages,
            },
            pdfPages,
          };
        },
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.pdfLoadFailed,
            retryable: false,
            reason: "PDF bytes could not be parsed for page dimensions.",
            operation: PdfOperationValue.loadDocument,
          }),
      }),
    ),
    Effect.flatMap((loaded) => {
      if (loaded.document.pages.length === 0) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.emptyTemplate,
            retryable: false,
            reason: "PDF has no pages available for signature placement.",
            operation: PdfOperationValue.loadDocument,
          }),
        );
      }
      return Effect.succeed(loaded);
    }),
  );

export const loadPdfSignatureDocument = (
  input: PdfDocumentInput,
  options?: PdfDocumentLoadOptions,
): Effect.Effect<PdfSignatureDocument, PdfError> =>
  loadPdfSignatureDocumentWithPages(input, options).pipe(Effect.map((loaded) => loaded.document));

type PdfSigningBatchGeometry = {
  readonly pages: ReadonlyArray<PdfSignaturePage>;
  readonly signatureRect: PdfSignatureRect;
  readonly signaturePagePosition: number;
};

type PdfSignatureFieldGeometry = {
  readonly pageDimensions: ReadonlyArray<PdfSignaturePage>;
  readonly signatureRect: PdfSignatureRect;
};

const pdfPagePositionForDeclaredIdentity = (
  pages: ReadonlyArray<PdfSignaturePage>,
  pageIndex: number,
  operation: PdfOperation,
): Effect.Effect<number, PdfError> => {
  let position: number | undefined;
  for (let candidatePosition = 0; candidatePosition < pages.length; candidatePosition += 1) {
    const page = pages[candidatePosition];
    if (page?.index !== pageIndex) continue;
    if (position !== undefined) {
      return Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.invalidBuilderInput,
          retryable: false,
          operation,
          reason: `PDF page identity ${pageIndex} is declared more than once.`,
        }),
      );
    }
    position = candidatePosition;
  }
  return position === undefined
    ? Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.invalidBuilderInput,
          retryable: false,
          operation,
          reason: `PDF page identity ${pageIndex} is not declared.`,
        }),
      )
    : Effect.succeed(position);
};

const validateSignatureRectsForLoadedPages = (
  pages: ReadonlyArray<PdfSignaturePage>,
  rects: ReadonlyArray<PdfSignatureRect>,
): Effect.Effect<ReadonlyArray<PdfSignatureRect>, PdfError> =>
  Effect.forEach(
    rects,
    (rect) => {
      const page = pages.find((candidate) => candidate.index === rect.pageIndex);
      if (page === undefined) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.unknownDocument,
            retryable: false,
            operation: PdfOperationValue.prepareAndSign,
            reason: `Signature rect references page ${rect.pageIndex} outside the loaded PDF.`,
          }),
        );
      }
      const fitsPage =
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.x + rect.width <= page.width &&
        rect.y + rect.height <= page.height;
      return fitsPage
        ? Effect.void
        : Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.fieldOutOfBounds,
              retryable: false,
              operation: PdfOperationValue.prepareAndSign,
              reason: `Signature rect must fit within loaded page ${page.index} (${page.width}×${page.height}).`,
            }),
          );
    },
    { discard: true },
  ).pipe(Effect.as(rects));

const resolvePdfSigningBatchGeometry = (
  document: PdfSigningBatchDocument,
): Effect.Effect<PdfSigningBatchGeometry, PdfError> =>
  loadPdfSignatureDocument({
    id: document.id,
    name: document.id,
    pdf: document.pdf,
  }).pipe(
    Effect.flatMap((loaded) =>
      validatePdfSignatureTemplate(document.template).pipe(
        Effect.flatMap((template) => {
          const field = template.fields.find((candidate) => candidate.id === document.fieldId);
          if (field === undefined) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.unknownField,
                retryable: false,
                operation: PdfOperationValue.signField,
                reason: `Field ${document.fieldId} does not exist on template ${template.id}.`,
              }),
            );
          }
          if (field.documentId !== document.id) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: PdfOperationValue.signField,
                reason: `Field ${field.id} belongs to document ${field.documentId}, not ${document.id}.`,
              }),
            );
          }
          const templateDocument = template.documents.find(
            (candidate) => candidate.id === field.documentId,
          );
          if (templateDocument === undefined) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.unknownDocument,
                retryable: false,
                operation: PdfOperationValue.signField,
                reason: `Field ${field.id} references an unknown template document.`,
              }),
            );
          }
          const pageGeometryMatches =
            templateDocument.pages.length === loaded.pages.length &&
            templateDocument.pages.every((page, index) => {
              const candidate = loaded.pages[index];
              return (
                candidate !== undefined &&
                page.width === candidate.width &&
                page.height === candidate.height
              );
            });
          if (!pageGeometryMatches) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: PdfOperationValue.signField,
                reason: "Template page geometry does not match the loaded PDF.",
              }),
            );
          }
          if (
            field.rect.pageIndex !== document.rect.pageIndex ||
            field.rect.x !== document.rect.x ||
            field.rect.y !== document.rect.y ||
            field.rect.width !== document.rect.width ||
            field.rect.height !== document.rect.height
          ) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.invalidBuilderInput,
                retryable: false,
                operation: PdfOperationValue.signField,
                reason: "Batch signature rect does not match the selected template field.",
              }),
            );
          }
          return pdfPagePositionForDeclaredIdentity(
            templateDocument.pages,
            field.rect.pageIndex,
            PdfOperationValue.signField,
          ).pipe(
            Effect.map((signaturePagePosition) => ({
              pages: loaded.pages,
              signatureRect: field.rect,
              signaturePagePosition,
            })),
          );
        }),
      ),
    ),
  );

export const createPdfSignatureTemplateFromBytes = (
  input: PdfTemplateInput,
  options?: PdfDocumentLoadOptions,
): Effect.Effect<PdfSignatureTemplate, PdfError> =>
  Schema.decodeUnknownEffect(PdfTemplateInputSchema)(input).pipe(
    Effect.mapError((issue) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "PDF template input failed schema validation.",
        operation: PdfOperationValue.createTemplateFromBytes,
        schemaName: PdfSchemaNameValue.pdfTemplateInput,
        issueMessage: String(issue),
      });
    }),
    Effect.flatMap((valid) =>
      loadPdfSignatureDocument(
        {
          id: valid.documentId,
          name: valid.documentName,
          pdf: valid.pdf,
        },
        options,
      ).pipe(
        Effect.flatMap((document) =>
          createPdfSignatureTemplate({
            id: valid.id,
            name: valid.name,
            documents: [document],
            roles: [valid.role],
          }),
        ),
      ),
    ),
  );

export const createPdfSignatureBuilderStateFromBytes = (
  input: PdfSignatureBuilderInput,
  options?: PdfDocumentLoadOptions,
): Effect.Effect<PdfSignatureBuilderState, PdfError> =>
  Schema.decodeUnknownEffect(PdfSignatureBuilderInputSchema)(input).pipe(
    Effect.mapError((issue) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "PDF signature builder input failed schema validation.",
        operation: PdfOperationValue.createBuilderStateFromBytes,
        schemaName: PdfSchemaNameValue.pdfSignatureBuilderInput,
        issueMessage: String(issue),
      });
    }),
    Effect.flatMap((valid) =>
      loadPdfSignatureDocument(
        {
          id: valid.documentId,
          name: valid.documentName,
          pdf: valid.pdf,
        },
        options,
      ).pipe(
        Effect.flatMap((document) =>
          createPdfSignatureTemplate({
            id: valid.id,
            name: valid.name,
            documents: [document],
            roles: [valid.role],
          }),
        ),
        Effect.flatMap((template) => {
          if (valid.placement !== undefined && valid.autoPlacement !== undefined) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.invalidBuilderInput,
                retryable: false,
                reason: "PDF builder input accepts either placement or autoPlacement, not both.",
                operation: PdfOperationValue.createBuilderStateFromBytes,
                schemaName: PdfSchemaNameValue.pdfSignatureBuilderInput,
              }),
            );
          }
          if (valid.placement !== undefined) {
            return placePdfSignatureField(template, {
              documentId: valid.documentId,
              pageIndex: valid.placement.pageIndex,
              x: valid.placement.x,
              y: valid.placement.y,
              draft: valid.draft,
              ...(valid.placement.anchor === undefined ? {} : { anchor: valid.placement.anchor }),
            });
          }
          if (valid.autoPlacement !== undefined) {
            return autoPlacePdfSignatureField(template, {
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
          return createPdfSignatureBuilderStateFromTemplate({
            template,
            draft: valid.draft,
            ...(selectedFieldId === undefined ? {} : { selectedFieldId }),
          });
        }),
      ),
    ),
  );

const signatureFieldGeometryFromTemplate = (
  template: PdfSignatureTemplate,
  fieldId: string,
): Effect.Effect<PdfSignatureFieldGeometry, PdfError> =>
  validatePdfSignatureTemplate(template).pipe(
    Effect.flatMap((checked) => {
      const field = checked.fields.find((candidate) => candidate.id === fieldId);
      if (field === undefined) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.unknownField,
            retryable: false,
            operation: PdfOperationValue.signField,
            reason: `Field ${fieldId} does not exist on template ${checked.id}.`,
          }),
        );
      }
      const document = checked.documents.find((candidate) => candidate.id === field.documentId);
      return document === undefined
        ? Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.invalidBuilderInput,
              retryable: false,
              operation: PdfOperationValue.signField,
              reason: `Field ${field.id} references an undeclared document page identity.`,
            }),
          )
        : Effect.succeed({
            pageDimensions: document.pages,
            signatureRect: field.rect,
          });
    }),
  );

const widgetRectFromPage = (
  page: PDFPage | undefined,
  signatureRect: PdfSignatureRect,
  operation: PdfOperation,
): Effect.Effect<PdfCoordinateTuple, PdfError> => {
  if (page === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.unknownDocument,
        retryable: false,
        operation,
        reason: "The signature rect references a page outside the loaded PDF.",
      }),
    );
  }
  const size = visiblePdfPageSize(page);
  const fitsVisiblePage =
    Number.isFinite(signatureRect.x) &&
    Number.isFinite(signatureRect.y) &&
    Number.isFinite(signatureRect.width) &&
    Number.isFinite(signatureRect.height) &&
    signatureRect.x >= 0 &&
    signatureRect.y >= 0 &&
    signatureRect.width > 0 &&
    signatureRect.height > 0 &&
    signatureRect.x + signatureRect.width <= size.width &&
    signatureRect.y + signatureRect.height <= size.height;
  return fitsVisiblePage
    ? Effect.succeed(pdfCoordinateTupleFromTopLeftRect(signatureRect, page))
    : Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.fieldOutOfBounds,
          retryable: false,
          operation,
          reason: `Signature rect must fit within loaded visible page (${size.width}×${size.height}).`,
        }),
      );
};

const widgetRectFromPdf = (
  pdf: Uint8Array,
  pageDimensions: ReadonlyArray<PdfSignaturePage>,
  signatureRect: PdfSignatureRect,
  operation: PdfOperation,
): Effect.Effect<
  { readonly pageIndex: number; readonly widgetRect: PdfCoordinateTuple },
  PdfError
> =>
  pdfPagePositionForDeclaredIdentity(pageDimensions, signatureRect.pageIndex, operation).pipe(
    Effect.flatMap((pageIndex) =>
      Effect.tryPromise({
        try: async () => (await PDFDocument.load(pdf)).getPages()[pageIndex],
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.pdfLoadFailed,
            retryable: false,
            operation,
            reason: "PDF bytes could not be parsed for signature widget placement.",
          }),
      }).pipe(
        Effect.flatMap((page) => widgetRectFromPage(page, signatureRect, operation)),
        Effect.map((widgetRect) => ({ pageIndex, widgetRect })),
      ),
    ),
  );

export const signPdfSignatureField = (
  input: PdfSigningInput,
): Effect.Effect<Uint8Array, PdfError | CmsError | SignatureKitError, Signatures> =>
  Schema.decodeUnknownEffect(PdfSigningInputSchema)(input).pipe(
    Effect.mapError((issue) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "PDF signing input failed schema validation.",
        operation: PdfOperationValue.signField,
        schemaName: PdfSchemaNameValue.pdfSigningInput,
        issueMessage: String(issue),
      });
    }),
    Effect.flatMap((valid) =>
      signatureFieldGeometryFromTemplate(valid.template, valid.fieldId).pipe(
        Effect.flatMap(({ pageDimensions, signatureRect }) =>
          widgetRectFromPdf(
            valid.pdf,
            pageDimensions,
            signatureRect,
            PdfOperationValue.signField,
          ).pipe(
            Effect.flatMap(({ pageIndex, widgetRect }) =>
              signPdfDocument({
                pdf: valid.pdf,
                reason: valid.reason ?? "SignatureKit PDF signature",
                contactInfo: valid.contactInfo,
                name: valid.name,
                location: valid.location,
                signingTime: valid.signingTime,
                signatureLength: valid.signatureLength,
                hashAlgorithm: valid.hashAlgorithm,
                policy: valid.policy,
                icpBrasil: valid.icpBrasil,
                timestamp: valid.timestamp,
                appearance: {
                  pageIndex,
                  widgetRect,
                },
              }),
            ),
          ),
        ),
      ),
    ),
  );

const pdfSigningInputFromPreparedDocument = (
  document: PdfSigningBatchDocument,
  pdf: Uint8Array,
  signing: PdfSigningBatchPreparationInput["signing"],
): PdfSigningBatchItem => ({
  id: document.id,
  input: {
    pdf,
    template: document.template,
    fieldId: document.fieldId,
    ...(signing.reason === undefined ? {} : { reason: signing.reason }),
    ...(signing.contactInfo === undefined ? {} : { contactInfo: signing.contactInfo }),
    ...(signing.name === undefined ? {} : { name: signing.name }),
    ...(signing.location === undefined ? {} : { location: signing.location }),
    ...(signing.signingTime === undefined ? {} : { signingTime: signing.signingTime }),
    ...(signing.signatureLength === undefined ? {} : { signatureLength: signing.signatureLength }),
    ...(signing.hashAlgorithm === undefined ? {} : { hashAlgorithm: signing.hashAlgorithm }),
    ...(signing.policy === undefined ? {} : { policy: signing.policy }),
    ...(signing.icpBrasil === undefined ? {} : { icpBrasil: signing.icpBrasil }),
    ...(signing.timestamp === undefined ? {} : { timestamp: signing.timestamp }),
  },
});

const stampRubricsForPreparedDocument = (
  document: PdfSigningBatchDocument,
  pages: ReadonlyArray<PdfSignaturePage>,
  signaturePagePosition: number,
  stamp: PdfSigningBatchVisibleStamp,
  pdf: Uint8Array,
  forIncrementalUpdate: boolean,
): Effect.Effect<Uint8Array, PdfError> => {
  const rubricLines = stamp.rubricLines ?? [];
  if (
    stamp.rubricEveryPage !== true ||
    (stamp.rubricaPng === undefined &&
      stamp.rubricInitials === undefined &&
      rubricLines.length === 0)
  ) {
    return Effect.succeed(pdf);
  }
  const rubricPages = rubricPageIndexesExcludingSignature(pages, signaturePagePosition);
  return rubricPages.length === 0
    ? Effect.succeed(pdf)
    : stampPdfRubricOnPages(
        {
          pdf,
          pageDimensions: pages,
          ...(document.pageTextBoxes === undefined
            ? {}
            : { pageTextBoxes: document.pageTextBoxes }),
          pages: rubricPages,
          ...(rubricLines.length === 0 ? {} : { lines: rubricLines }),
          ...(stamp.rubricaPng === undefined ? {} : { imagePng: stamp.rubricaPng }),
          ...(stamp.rubricInitials === undefined ? {} : { initials: stamp.rubricInitials }),
          ...(stamp.rubricInitialsTheme === undefined
            ? {}
            : { initialsTheme: stamp.rubricInitialsTheme }),
          ...(stamp.border === undefined ? {} : { border: stamp.border }),
        },
        forIncrementalUpdate,
      );
};

const stampMainSignatureForPreparedDocument = (
  signatureRect: PdfSignatureRect,
  stamp: PdfSigningBatchVisibleStamp | undefined,
  pdf: Uint8Array,
  forIncrementalUpdate: boolean,
): Effect.Effect<Uint8Array, PdfError> => {
  const lines = stamp?.lines ?? [];
  if (
    stamp === undefined ||
    (stamp.inkPng === undefined &&
      lines.length === 0 &&
      stamp.qr === undefined &&
      stamp.badge === undefined)
  ) {
    return Effect.succeed(pdf);
  }
  return stampPdfVisibleSignatures(
    {
      pdf,
      stamps: [{ pageIndex: signatureRect.pageIndex, rect: signatureRect }],
      ...(lines.length === 0 ? {} : { lines }),
      ...(stamp.badge === undefined ? {} : { badge: stamp.badge }),
      ...(stamp.inkPng === undefined ? {} : { inkPng: stamp.inkPng }),
      ...(stamp.border === undefined ? {} : { border: stamp.border }),
      ...(stamp.qr === undefined ? {} : { qr: stamp.qr }),
    },
    forIncrementalUpdate,
  );
};

const preparePdfSigningBatchDocument = (
  document: PdfSigningBatchDocument,
  stamp: PdfSigningBatchVisibleStamp | undefined,
  signing: PdfSigningBatchPreparationInput["signing"],
): Effect.Effect<PdfSigningBatchPreparationResult, never> =>
  resolvePdfSigningBatchGeometry(document).pipe(
    Effect.flatMap(({ pages, signatureRect, signaturePagePosition }) => {
      const forIncrementalUpdate = hasPdfByteRange(document.pdf);
      const preparedPdf =
        stamp === undefined
          ? Effect.succeed(document.pdf)
          : stampRubricsForPreparedDocument(
              document,
              pages,
              signaturePagePosition,
              stamp,
              document.pdf,
              forIncrementalUpdate,
            ).pipe(
              Effect.flatMap((pdf) =>
                stampMainSignatureForPreparedDocument(
                  { ...signatureRect, pageIndex: signaturePagePosition },
                  stamp,
                  pdf,
                  forIncrementalUpdate,
                ),
              ),
            );
      return preparedPdf.pipe(
        Effect.map((pdf): PdfSigningBatchPreparationResult => {
          const item = pdfSigningInputFromPreparedDocument(document, pdf, signing);
          return { id: document.id, ok: true, item };
        }),
      );
    }),
    Effect.match({
      onSuccess: (result): PdfSigningBatchPreparationResult => result,
      onFailure: (error): PdfSigningBatchPreparationResult => ({
        id: document.id,
        ok: false,
        error,
      }),
    }),
  );

const DEFAULT_PREPARE_AND_SIGN_DOCUMENT_ID = "document";
const DEFAULT_PREPARE_AND_SIGN_DOCUMENT_NAME = "document.pdf";
const DEFAULT_PREPARE_AND_SIGN_STAMP_SIZE = { width: 180, height: 54 };

const prepareAndSignStampRects = (
  input: PdfPrepareAndSignInput,
  pages: ReadonlyArray<PdfSignaturePage>,
): Effect.Effect<ReadonlyArray<PdfSignatureRect>, PdfError, LiteParseWorkerFactory> => {
  const stampRects = input.stampRects ?? [];
  if (stampRects.length > 0) {
    return validateSignatureRectsForLoadedPages(pages, stampRects);
  }
  if (input.anchors !== undefined) {
    const anchors =
      input.pageTextBoxes === undefined
        ? findPdfTextAnchors({
            pdf: input.pdf,
            pages,
            matchers: input.anchors.matchers,
            stampSize: input.anchors.stampSize,
            ...(input.anchors.placement === undefined
              ? {}
              : { placement: input.anchors.placement }),
            ...(input.anchors.offset === undefined ? {} : { offset: input.anchors.offset }),
          })
        : findPdfTextAnchors({
            pages,
            textBoxes: input.pageTextBoxes,
            matchers: input.anchors.matchers,
            stampSize: input.anchors.stampSize,
            ...(input.anchors.placement === undefined
              ? {}
              : { placement: input.anchors.placement }),
            ...(input.anchors.offset === undefined ? {} : { offset: input.anchors.offset }),
          });
    return anchors.pipe(
      Effect.flatMap((rects) =>
        rects.length === 0
          ? Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.noAvailablePlacement,
                retryable: false,
                operation: PdfOperationValue.prepareAndSign,
                reason: "Text-anchor search did not find a signature placement.",
              }),
            )
          : validateSignatureRectsForLoadedPages(pages, rects),
      ),
    );
  }

  const page = pages[pages.length - 1];
  return page === undefined
    ? Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.invalidPdf,
          retryable: false,
          operation: PdfOperationValue.prepareAndSign,
          reason: "PDF prepare-and-sign requires at least one page.",
        }),
      )
    : validateSignatureRectsForLoadedPages(pages, [
        defaultPdfSignatureRect(page, input.stampSize ?? DEFAULT_PREPARE_AND_SIGN_STAMP_SIZE),
      ]);
};

const prepareAndSignMainStamp = (
  input: PdfPrepareAndSignInput,
  stampRects: ReadonlyArray<PdfSignatureRect>,
): Effect.Effect<Uint8Array, PdfError> => {
  const lines = input.lines ?? [];
  if (
    input.badge === undefined &&
    input.inkPng === undefined &&
    input.qr === undefined &&
    lines.length === 0
  ) {
    return Effect.succeed(input.pdf);
  }
  const firstStampRect = stampRects[0];
  if (firstStampRect === undefined) {
    return Effect.fail(
      new PdfError({
        code: PdfErrorCodeValue.stampFailed,
        retryable: false,
        operation: PdfOperationValue.prepareAndSign,
        reason: "PDF prepare-and-sign requires at least one visible stamp rectangle.",
      }),
    );
  }

  const forIncrementalUpdate = hasPdfByteRange(input.pdf);
  return stampPdfVisibleSignatures(
    {
      pdf: input.pdf,
      stamps: [
        { pageIndex: firstStampRect.pageIndex, rect: firstStampRect },
        ...stampRects.slice(1).map((rect) => ({ pageIndex: rect.pageIndex, rect })),
      ],
      ...(lines.length === 0 ? {} : { lines }),
      ...(input.badge === undefined ? {} : { badge: input.badge }),
      ...(input.inkPng === undefined ? {} : { inkPng: input.inkPng }),
      ...(input.border === undefined ? {} : { border: input.border }),
      ...(input.qr === undefined ? {} : { qr: input.qr }),
    },
    forIncrementalUpdate,
  );
};

const prepareAndSignRubrics = (
  input: PdfPrepareAndSignInput,
  pdf: Uint8Array,
  pages: ReadonlyArray<PdfSignaturePage>,
  signaturePageIndexes: ReadonlyArray<number>,
  forIncrementalUpdate: boolean,
): Effect.Effect<Uint8Array, PdfError> => {
  const rubric = input.rubric;
  if (rubric === undefined) return Effect.succeed(pdf);
  const rubricLines = rubric.lines ?? [];
  if (rubric.imagePng === undefined && rubric.initials === undefined && rubricLines.length === 0) {
    return Effect.succeed(pdf);
  }

  const rubricPages = rubricPagesExcludingSignatures(pages, signaturePageIndexes);
  return rubricPages.length === 0
    ? Effect.succeed(pdf)
    : stampPdfRubricOnPages(
        {
          pdf,
          pageDimensions: pages,
          ...(input.pageTextBoxes === undefined ? {} : { pageTextBoxes: input.pageTextBoxes }),
          pages: rubricPages,
          ...(rubricLines.length === 0 ? {} : { lines: rubricLines }),
          ...(rubric.imagePng === undefined ? {} : { imagePng: rubric.imagePng }),
          ...(rubric.initials === undefined ? {} : { initials: rubric.initials }),
          ...(rubric.initialsTheme === undefined ? {} : { initialsTheme: rubric.initialsTheme }),
          ...(rubric.border === undefined ? {} : { border: rubric.border }),
        },
        forIncrementalUpdate,
      );
};

export const prepareAndSignPdf = (
  input: PdfPrepareAndSignInput,
): Effect.Effect<
  Uint8Array,
  PdfError | CmsError | SignatureKitError,
  Signatures | LiteParseWorkerFactory
> =>
  Schema.decodeUnknownEffect(PdfPrepareAndSignInputSchema)(input).pipe(
    Effect.mapError(
      (issue) =>
        new PdfError({
          code: PdfErrorCodeValue.invalidBuilderInput,
          retryable: false,
          operation: PdfOperationValue.prepareAndSign,
          schemaName: PdfSchemaNameValue.pdfPrepareAndSignInput,
          reason: "PDF prepare-and-sign input failed schema validation.",
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) =>
      loadPdfSignatureDocumentWithPages({
        id: valid.documentId ?? DEFAULT_PREPARE_AND_SIGN_DOCUMENT_ID,
        name: valid.documentName ?? DEFAULT_PREPARE_AND_SIGN_DOCUMENT_NAME,
        pdf: valid.pdf,
      }).pipe(
        Effect.flatMap(({ document, pdfPages }) => {
          const pages = document.pages;
          return prepareAndSignStampRects(valid, pages).pipe(
            Effect.flatMap((stampRects) => {
              const signatureRect = stampRects[stampRects.length - 1];
              if (signatureRect === undefined) {
                return Effect.fail(
                  new PdfError({
                    code: PdfErrorCodeValue.noAvailablePlacement,
                    retryable: false,
                    operation: PdfOperationValue.prepareAndSign,
                    reason: "Text-anchor search did not find a signature placement.",
                  }),
                );
              }
              const signaturePageIndexes = stampRects.map((stampRect) => stampRect.pageIndex);
              const forIncrementalUpdate = hasPdfByteRange(valid.pdf);
              return prepareAndSignMainStamp(valid, stampRects).pipe(
                Effect.flatMap((stamped) =>
                  prepareAndSignRubrics(
                    valid,
                    stamped,
                    pages,
                    signaturePageIndexes,
                    forIncrementalUpdate,
                  ),
                ),
                Effect.flatMap((rubriced) =>
                  widgetRectFromPage(
                    pdfPages[signatureRect.pageIndex],
                    signatureRect,
                    PdfOperationValue.prepareAndSign,
                  ).pipe(
                    Effect.flatMap((widgetRect) =>
                      signPdfDocument({
                        pdf: rubriced,
                        ...valid.signing,
                        appearance: {
                          placement: {
                            kind: "manual",
                            pageIndex: signatureRect.pageIndex,
                            widgetRect,
                          },
                        },
                      }),
                    ),
                  ),
                ),
              );
            }),
          );
        }),
      ),
    ),
  );

export type PdfSigningBatchPreparationCallbacks = {
  readonly onItemSettled?: (
    result: PdfSigningBatchPreparationResult,
    index: number,
    total: number,
  ) => void;
  readonly yieldAfterItem?: (
    result: PdfSigningBatchPreparationResult,
    index: number,
    total: number,
  ) => Effect.Effect<void> | void;
};

export const preparePdfSigningBatch = (
  input: PdfSigningBatchPreparationInput,
  callbacks: PdfSigningBatchPreparationCallbacks = {},
): Effect.Effect<ReadonlyArray<PdfSigningBatchPreparationResult>, PdfError> =>
  Schema.decodeUnknownEffect(PdfSigningBatchPreparationInputSchema)(input).pipe(
    Effect.mapError(
      (issue) =>
        new PdfError({
          code: PdfErrorCodeValue.invalidBuilderInput,
          retryable: false,
          reason: "PDF signing batch preparation input failed schema validation.",
          operation: PdfOperationValue.signField,
          schemaName: PdfSchemaNameValue.pdfSigningBatchPreparationInput,
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) =>
      Effect.forEach(valid.documents, (document, index) =>
        preparePdfSigningBatchDocument(document, valid.stamp, valid.signing).pipe(
          Effect.tap((result) =>
            Effect.sync(() =>
              callbacks.onItemSettled?.(result, index, valid.documents.length),
            ).pipe(Effect.exit, Effect.asVoid),
          ),
          Effect.tap((result) =>
            Effect.suspend(
              () =>
                callbacks.yieldAfterItem?.(result, index, valid.documents.length) ?? Effect.void,
            ).pipe(Effect.exit, Effect.asVoid),
          ),
        ),
      ),
    ),
  );

export type PdfSignatureBatchCallbacks = {
  readonly onItemSettled?: (result: PdfBatchResult, index: number, total: number) => void;
};

export const signPdfSignatureBatch = (
  items: ReadonlyArray<PdfSigningBatchItem>,
  callbacks: PdfSignatureBatchCallbacks = {},
): Effect.Effect<ReadonlyArray<PdfBatchResult>, never, Signatures> =>
  Effect.forEach(
    items,
    (item, index): Effect.Effect<PdfBatchResult, never, Signatures> =>
      signPdfSignatureField(item.input).pipe(
        Effect.match({
          onSuccess: (signedPdf): PdfBatchResult => ({ id: item.id, ok: true, signedPdf }),
          onFailure: (error): PdfBatchResult => ({ id: item.id, ok: false, error }),
        }),
        Effect.tap((result) =>
          Effect.sync(() => callbacks.onItemSettled?.(result, index, items.length)).pipe(
            Effect.exit,
            Effect.asVoid,
          ),
        ),
      ),
  );
