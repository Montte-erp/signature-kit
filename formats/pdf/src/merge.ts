import { PDFArray, PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import type { PDFPage } from "@cantoo/pdf-lib";
import { Effect, Schema } from "effect";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfMergeDocumentsSchema,
  PdfOperationValue,
  PdfSchemaNameValue,
} from "./config.js";
import { hasPdfSignatureDictionaryEffect } from "./byte-range.js";

const stripAcroFormWidgets = (document: PDFDocument): void => {
  for (const page of document.getPages()) {
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annotations === undefined) continue;
    for (let index = annotations.size() - 1; index >= 0; index -= 1) {
      const annotation = document.context.lookupMaybe(annotations.get(index), PDFDict);
      if (annotation?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.toString() === "/Widget") {
        annotations.remove(index);
      }
    }
    if (annotations.size() === 0) page.node.delete(PDFName.of("Annots"));
  }
};

const rewriteCopiedAnnotationPageReferences = (document: PDFDocument, page: PDFPage): void => {
  const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annotations === undefined) return;
  for (let index = 0; index < annotations.size(); index += 1) {
    const annotation = document.context.lookupMaybe(annotations.get(index), PDFDict);
    if (annotation?.get(PDFName.of("P")) !== undefined) {
      annotation.set(PDFName.of("P"), page.ref);
    }
  }
};

export const mergePdfs = (
  documents: ReadonlyArray<Uint8Array>,
): Effect.Effect<Uint8Array, PdfError> =>
  Schema.decodeUnknownEffect(PdfMergeDocumentsSchema)(documents).pipe(
    Effect.mapError(
      (issue) =>
        new PdfError({
          code: PdfErrorCodeValue.invalidBuilderInput,
          retryable: false,
          operation: PdfOperationValue.mergeDocuments,
          schemaName: PdfSchemaNameValue.pdfMergeDocuments,
          reason: "PDF merge input failed schema validation.",
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((valid) =>
      Effect.forEach(valid, (source) =>
        hasPdfSignatureDictionaryEffect(source).pipe(
          Effect.flatMap((hasSignature) =>
            hasSignature
              ? Effect.fail(
                  new PdfError({
                    code: PdfErrorCodeValue.invalidBuilderInput,
                    retryable: false,
                    operation: PdfOperationValue.mergeDocuments,
                    reason: "PDF merge does not accept signed or document-timestamp source PDFs.",
                  }),
                )
              : Effect.void,
          ),
        ),
      ).pipe(
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: async () => {
              const merged = await PDFDocument.create();
              for (const source of valid) {
                const sourceDocument = await PDFDocument.load(source);
                stripAcroFormWidgets(sourceDocument);
                const copiedPages = await merged.copyPages(
                  sourceDocument,
                  sourceDocument.getPageIndices(),
                );
                for (const page of copiedPages) {
                  const destinationPage = merged.addPage(page);
                  rewriteCopiedAnnotationPageReferences(merged, destinationPage);
                }
              }
              return new Uint8Array(
                await merged.save({ addDefaultPage: false, useObjectStreams: false }),
              );
            },
            catch: () =>
              new PdfError({
                code: PdfErrorCodeValue.invalidPdf,
                retryable: false,
                operation: PdfOperationValue.mergeDocuments,
                reason: "Failed to merge PDF documents.",
              }),
          }),
        ),
      ),
    ),
  );
