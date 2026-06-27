import { PDFDocument } from "@cantoo/pdf-lib";
import type { CmsError } from "@signature-kit/cms/config";
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
  BrowserPdfSigningBatchItem,
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
    Effect.mapError((_error) => {
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "Browser PDF document input failed schema validation.",
        operation: ReactIntegrationOperationValue.loadBrowserPdf,
        schemaName: ReactIntegrationSchemaNameValue.browserPdfDocumentInput,
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
    Effect.mapError((_error) => {
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "Browser PDF template input failed schema validation.",
        operation: ReactIntegrationOperationValue.createTemplate,
        schemaName: ReactIntegrationSchemaNameValue.browserPdfTemplateInput,
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
    Effect.mapError((_error) => {
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "Browser PDF signature builder input failed schema validation.",
        operation: ReactIntegrationOperationValue.createBrowserPdfBuilderState,
        schemaName: ReactIntegrationSchemaNameValue.browserPdfSignatureBuilderInput,
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
    Effect.mapError((_error) => {
      return new ReactIntegrationError({
        code: ReactIntegrationErrorCodeValue.invalidBuilderInput,
        retryable: false,
        reason: "Browser PDF signing input failed schema validation.",
        operation: ReactIntegrationOperationValue.signBrowserPdf,
        schemaName: ReactIntegrationSchemaNameValue.browserPdfSigningInput,
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
 * A1 browser flow used by the React docs component. Each document runs through
 * {@link signBrowserPdf}; a failure on one item is captured as `{ ok: false, error }`
 * and never aborts the rest, so the result array always holds one entry per input,
 * in the original order. Strict sequencing keeps a single in-browser A1 key free
 * of signing races. Provide the A1 layer once at the app boundary:
 * `.pipe(Effect.provide(a1SignaturesLayer({ pfx, password })))`.
 */
export const signBrowserPdfBatch = (
  items: ReadonlyArray<BrowserPdfSigningBatchItem>,
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
