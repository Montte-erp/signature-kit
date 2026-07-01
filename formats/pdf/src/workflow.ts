import { PDFDocument } from "@cantoo/pdf-lib";
import type { CmsError } from "@signature-kit/cms/config";
import type { SignatureKitError } from "@signature-kit/core/config";
import type { Signatures } from "@signature-kit/core/signatures";
import { signPdf as signPdfDocument } from "./sign";
import { Effect, Schema } from "effect";
import {
  autoPlacePdfSignatureField,
  createPdfSignatureBuilderStateFromTemplate,
  createPdfSignatureTemplate,
  pdfSignatureAppearanceFromField,
  placePdfSignatureField,
} from "./builder";
import {
  PdfSignatureBuilderInputSchema,
  PdfDocumentInputSchema,
  PdfSigningBatchPreparationInputSchema,
  PdfSigningInputSchema,
  PdfTemplateInputSchema,
  PdfDocumentSourceTypeValue,
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSchemaNameValue,
} from "./config";
import type {
  PdfDocumentInput,
  PdfBatchResult,
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
  rubricPageIndexesExcludingSignature,
  stampPdfRubricOnPages,
  stampPdfVisibleSignature,
} from "./stamp";

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
      loadPdfSignatureDocument({
        id: valid.documentId,
        name: valid.documentName,
        pdf: valid.pdf,
      }).pipe(
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
      loadPdfSignatureDocument({
        id: valid.documentId,
        name: valid.documentName,
        pdf: valid.pdf,
      }).pipe(
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
            policyTimeoutMillis: valid.policyTimeoutMillis,
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
    ...(signing.policyTimeoutMillis === undefined
      ? {}
      : { policyTimeoutMillis: signing.policyTimeoutMillis }),
    ...(signing.timestamp === undefined ? {} : { timestamp: signing.timestamp }),
  },
});

const stampRubricsForPreparedDocument = (
  document: PdfSigningBatchDocument,
  stamp: PdfSigningBatchVisibleStamp,
  pdf: Uint8Array,
): Effect.Effect<Uint8Array, PdfError> => {
  const rubricLines = stamp.rubricLines ?? [];
  if (
    stamp.rubricEveryPage !== true ||
    (stamp.rubricaPng === undefined && rubricLines.length === 0)
  ) {
    return Effect.succeed(pdf);
  }
  const pages = rubricPageIndexesExcludingSignature(
    document.pageDimensions,
    document.rect.pageIndex,
  );
  return pages.length === 0
    ? Effect.succeed(pdf)
    : stampPdfRubricOnPages({
        pdf,
        pageDimensions: document.pageDimensions,
        ...(document.pageTextBoxes === undefined ? {} : { pageTextBoxes: document.pageTextBoxes }),
        pages,
        ...(rubricLines.length === 0 ? {} : { lines: rubricLines }),
        ...(stamp.rubricaPng === undefined ? {} : { imagePng: stamp.rubricaPng }),
        ...(stamp.border === undefined ? {} : { border: stamp.border }),
      });
};

const stampMainSignatureForPreparedDocument = (
  document: PdfSigningBatchDocument,
  stamp: PdfSigningBatchVisibleStamp | undefined,
  pdf: Uint8Array,
): Effect.Effect<Uint8Array, PdfError> => {
  if (stamp === undefined || (stamp.inkPng === undefined && stamp.lines.length === 0)) {
    return Effect.succeed(pdf);
  }
  return stampPdfVisibleSignature({
    pdf,
    pageIndex: document.rect.pageIndex,
    rect: document.rect,
    lines: stamp.lines,
    ...(stamp.inkPng === undefined ? {} : { inkPng: stamp.inkPng }),
    ...(stamp.border === undefined ? {} : { border: stamp.border }),
  });
};

const preparePdfSigningBatchDocument = (
  document: PdfSigningBatchDocument,
  stamp: PdfSigningBatchVisibleStamp | undefined,
  signing: PdfSigningBatchPreparationInput["signing"],
): Effect.Effect<PdfSigningBatchPreparationResult, never> => {
  const preparedPdf =
    stamp === undefined
      ? Effect.succeed(document.pdf)
      : stampRubricsForPreparedDocument(document, stamp, document.pdf).pipe(
          Effect.flatMap((pdf) => stampMainSignatureForPreparedDocument(document, stamp, pdf)),
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

/**
 * Prepare a browser signing batch entirely inside the PDF package: optional
 * visible signature, optional repeated rubric on every non-signature page, then
 * conversion into {@link PdfSigningBatchItem}. Failures are per-document results;
 * the queue always drains in input order.
 */
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

/**
 * Sign many PDFs one-by-one with one provided `Signatures` layer. Each item runs
 * through {@link signPdfSignatureField}; a failure on one item is captured as
 * `{ ok: false, error }` and never aborts the rest, so callers always receive
 * one ordered result per input. Strict sequencing keeps runtime-specific
 * signer adapters free of signing races. Provide the signer layer once at the
 * app boundary: `.pipe(Effect.provide(a1SignaturesLayer({ pfx, password })))`.
 */
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
