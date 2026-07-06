import { PDFDocument } from "@cantoo/pdf-lib";
import type { CmsError } from "@signature-kit/cms/config";
import type { SignatureKitError } from "@signature-kit/signatures";
import type { Signatures } from "@signature-kit/signatures";
import { signPdf as signPdfDocument } from "./sign";
import { findPdfTextAnchors } from "./anchors";
import { Effect, Schema } from "effect";
import {
  autoPlacePdfSignatureField,
  createPdfSignatureBuilderStateFromTemplate,
  createPdfSignatureTemplate,
  pdfSignatureAppearanceFromField,
  placePdfSignatureField,
} from "./builder";
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
} from "./config";
import type {
  PdfDocumentInput,
  PdfCoordinateTuple,
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
} from "./config";

import {
  defaultPdfSignatureRect,
  pdfCoordinateTupleFromTopLeftRect,
  rubricPageIndexesExcludingSignature,
  stampPdfRubricOnPages,
  stampPdfVisibleSignatures,
} from "./stamp";
import { hasPdfByteRange } from "./byte-range";

export type PdfPageLabeler = (pageNumber: number) => string;

type PdfDocumentLoadOptions = {
  readonly pageLabel?: PdfPageLabeler;
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

export const loadPdfSignatureDocument = (
  input: PdfDocumentInput,
  options?: PdfDocumentLoadOptions,
): Effect.Effect<PdfSignatureDocument, PdfError> =>
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
          const pages = pdf.getPages().map((page, index) => {
            const size = page.getSize();
            const label = options?.pageLabel?.(index + 1);
            return {
              index,
              width: size.width,
              height: size.height,
              ...(label === undefined ? {} : { label }),
            };
          });
          return {
            id: valid.id,
            name: valid.name,
            source: valid.source ?? { type: PdfDocumentSourceTypeValue.uploaded },
            pages,
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
    Effect.flatMap((document) => {
      if (document.pages.length === 0) {
        return Effect.fail(
          new PdfError({
            code: PdfErrorCodeValue.emptyTemplate,
            retryable: false,
            reason: "PDF has no pages available for signature placement.",
            operation: PdfOperationValue.loadDocument,
          }),
        );
      }
      return Effect.succeed(document);
    }),
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
      pdfSignatureAppearanceFromField(valid.template, valid.fieldId).pipe(
        Effect.flatMap((appearance) =>
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
            appearance,
          }),
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
  const pages = rubricPageIndexesExcludingSignature(
    document.pageDimensions,
    document.rect.pageIndex,
  );
  return pages.length === 0
    ? Effect.succeed(pdf)
    : stampPdfRubricOnPages(
        {
          pdf,
          pageDimensions: document.pageDimensions,
          ...(document.pageTextBoxes === undefined
            ? {}
            : { pageTextBoxes: document.pageTextBoxes }),
          pages,
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
  document: PdfSigningBatchDocument,
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
      stamps: [{ pageIndex: document.rect.pageIndex, rect: document.rect }],
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
): Effect.Effect<PdfSigningBatchPreparationResult, never> => {
  const forIncrementalUpdate = hasPdfByteRange(document.pdf);
  const preparedPdf =
    stamp === undefined
      ? Effect.succeed(document.pdf)
      : stampRubricsForPreparedDocument(document, stamp, document.pdf, forIncrementalUpdate).pipe(
          Effect.flatMap((pdf) =>
            stampMainSignatureForPreparedDocument(document, stamp, pdf, forIncrementalUpdate),
          ),
        );

  return preparedPdf.pipe(
    Effect.map((pdf): PdfSigningBatchPreparationResult => {
      const item = pdfSigningInputFromPreparedDocument(document, pdf, signing);
      return { id: document.id, ok: true, item };
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
};

const DEFAULT_PREPARE_AND_SIGN_DOCUMENT_ID = "document";
const DEFAULT_PREPARE_AND_SIGN_DOCUMENT_NAME = "document.pdf";
const DEFAULT_PREPARE_AND_SIGN_STAMP_SIZE = { width: 180, height: 54 };

const prepareAndSignPages = (
  input: PdfPrepareAndSignInput,
): Effect.Effect<ReadonlyArray<PdfSignaturePage>, PdfError> =>
  input.pages === undefined
    ? loadPdfSignatureDocument({
        id: input.documentId ?? DEFAULT_PREPARE_AND_SIGN_DOCUMENT_ID,
        name: input.documentName ?? DEFAULT_PREPARE_AND_SIGN_DOCUMENT_NAME,
        pdf: input.pdf,
      }).pipe(Effect.map((document) => document.pages))
    : Effect.succeed(input.pages);

const prepareAndSignStampRects = (
  input: PdfPrepareAndSignInput,
  pages: ReadonlyArray<PdfSignaturePage>,
): Effect.Effect<ReadonlyArray<PdfSignatureRect>, PdfError> => {
  const stampRects = input.stampRects ?? [];
  if (stampRects.length > 0) return Effect.succeed(stampRects);
  if (input.anchors !== undefined) {
    return findPdfTextAnchors({
      pdf: input.pdf,
      pages,
      ...(input.pageTextBoxes === undefined ? {} : { textBoxes: input.pageTextBoxes }),
      matchers: input.anchors.matchers,
      stampSize: input.anchors.stampSize,
      ...(input.anchors.placement === undefined ? {} : { placement: input.anchors.placement }),
      ...(input.anchors.offset === undefined ? {} : { offset: input.anchors.offset }),
    }).pipe(
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
          : Effect.succeed(rects),
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
    : Effect.succeed([
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

  const forIncrementalUpdate = hasPdfByteRange(input.pdf);
  return stampPdfVisibleSignatures(
    {
      pdf: input.pdf,
      stamps: stampRects.map((rect) => ({ pageIndex: rect.pageIndex, rect })),
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

const prepareAndSignWidgetRect = (
  pages: ReadonlyArray<PdfSignaturePage>,
  signatureRect: PdfSignatureRect,
): Effect.Effect<PdfCoordinateTuple, PdfError> => {
  const page = pages.find((candidate) => candidate.index === signatureRect.pageIndex);
  return page === undefined
    ? Effect.fail(
        new PdfError({
          code: PdfErrorCodeValue.unknownDocument,
          retryable: false,
          operation: PdfOperationValue.prepareAndSign,
          reason: "The final signature rect references a page outside the PDF document.",
        }),
      )
    : Effect.succeed(pdfCoordinateTupleFromTopLeftRect(signatureRect, page.height));
};

export const prepareAndSignPdf = (
  input: PdfPrepareAndSignInput,
): Effect.Effect<Uint8Array, PdfError | CmsError | SignatureKitError, Signatures> =>
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
      prepareAndSignPages(valid).pipe(
        Effect.flatMap((pages) =>
          prepareAndSignStampRects(valid, pages).pipe(
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
                  prepareAndSignWidgetRect(pages, signatureRect).pipe(
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
          ),
        ),
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
            Effect.sync(() => callbacks.onItemSettled?.(result, index, valid.documents.length)),
          ),
          Effect.tap(
            (result) =>
              callbacks.yieldAfterItem?.(result, index, valid.documents.length) ?? Effect.void,
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
          Effect.sync(() => callbacks.onItemSettled?.(result, index, items.length)),
        ),
      ),
  );
