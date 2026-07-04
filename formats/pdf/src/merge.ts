import { PDFDocument } from "@cantoo/pdf-lib";
import { Effect, Schema } from "effect";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfMergeDocumentsSchema,
  PdfOperationValue,
  PdfSchemaNameValue,
} from "./config";

/**
 * Merge page content from multiple PDFs into one document.
 *
 * pdf-lib `copyPages` copies pages only; AcroForm fields, document metadata, and
 * catalog-level form state from the source documents are intentionally dropped.
 */
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
      Effect.tryPromise({
        try: async () => {
          const merged = await PDFDocument.create();
          for (const source of valid) {
            const sourceDocument = await PDFDocument.load(source);
            const copiedPages = await merged.copyPages(
              sourceDocument,
              sourceDocument.getPageIndices(),
            );
            for (const page of copiedPages) merged.addPage(page);
          }
          return new Uint8Array(await merged.save({ useObjectStreams: false }));
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
  );
