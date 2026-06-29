import { PDFDocument } from "@cantoo/pdf-lib";
import type { CmsError } from "@signature-kit/cms/config";
import type { SignatureKitError } from "@signature-kit/core/config";
import type { Signatures } from "@signature-kit/core/signatures";
import { signPdf as signPdfDocument } from "@signature-kit/pdf/sign";
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
  PdfSigningInput,
  PdfSigningBatchItem,
  PdfSignatureBuilderInput,
  PdfTemplateInput,
  PdfSignatureBuilderState,
  PdfSignatureDocument,
  PdfSignatureTemplate,
} from "./config";

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
    Effect.mapError((_error) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "PDF document input failed schema validation.",
        operation: PdfOperationValue.loadDocument,
        schemaName: PdfSchemaNameValue.pdfDocumentInput,
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
    Effect.mapError((_error) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "PDF template input failed schema validation.",
        operation: PdfOperationValue.createTemplateFromBytes,
        schemaName: PdfSchemaNameValue.pdfTemplateInput,
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
    Effect.mapError((_error) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "PDF signature builder input failed schema validation.",
        operation: PdfOperationValue.createBuilderStateFromBytes,
        schemaName: PdfSchemaNameValue.pdfSignatureBuilderInput,
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
    Effect.mapError((_error) => {
      return new PdfError({
        code: PdfErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "PDF signing input failed schema validation.",
        operation: PdfOperationValue.signField,
        schemaName: PdfSchemaNameValue.pdfSigningInput,
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
    { concurrency: 1 },
  );
