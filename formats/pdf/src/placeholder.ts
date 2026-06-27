import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNumber,
  PDFString,
} from "@cantoo/pdf-lib";
import { Effect } from "effect";
import { PdfError, PdfErrorCodeValue, PdfOperationValue } from "./config";
import type { PdfSigningRequest } from "./config";
import { resolveSignatureWidgetPlacement } from "./placement";

export const DEFAULT_SIGNATURE_LENGTH = 16384;
const BYTE_RANGE_PLACEHOLDER = "**********";
const SIGNATURES_EXIST = 0x01;
const APPEND_ONLY = 0x02;
const PRINT_ANNOTATION = 0x04;

export const addSignaturePlaceholder = (
  input: PdfSigningRequest,
): Effect.Effect<Uint8Array, PdfError> =>
  Effect.tryPromise({
    try: () => PDFDocument.load(input.pdf),
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        operation: PdfOperationValue.placeholder,
      }),
  }).pipe(
    Effect.flatMap((pdfDoc) =>
      resolveSignatureWidgetPlacement(pdfDoc, input.appearance ?? {}).pipe(
        Effect.flatMap((placement) => {
          const page = pdfDoc.getPages()[placement.pageIndex];
          if (page === undefined) {
            return Effect.fail(
              new PdfError({
                code: PdfErrorCodeValue.invalidPdf,
                retryable: false,
                reason: "The selected PDF page does not exist.",
                operation: PdfOperationValue.placeholder,
              }),
            );
          }

          return Effect.tryPromise({
            try: async () => {
              const byteRange = PDFArray.withContext(pdfDoc.context);
              byteRange.push(PDFNumber.of(0));
              byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
              byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
              byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));

              const placeholder = PDFHexString.of(
                String.fromCharCode(0).repeat(input.signatureLength ?? DEFAULT_SIGNATURE_LENGTH),
              );
              const signatureDict = pdfDoc.context.obj({
                Type: "Sig",
                Filter: "Adobe.PPKLite",
                SubFilter: "adbe.pkcs7.detached",
                ByteRange: byteRange,
                Contents: placeholder,
                Reason: PDFString.of(input.reason ?? "Digital signature"),
                M: PDFString.fromDate(input.signingTime ?? new Date()),
                ContactInfo: PDFString.of(input.contactInfo ?? ""),
                Name: PDFString.of(input.name ?? "SignatureKit signer"),
                Location: PDFString.of(input.location ?? ""),
                Prop_Build: { Filter: { Name: "Adobe.PPKLite" }, App: { Name: "SignatureKit" } },
              });
              const signatureBuffer = new Uint8Array(signatureDict.sizeInBytes());
              signatureDict.copyBytesInto(signatureBuffer, 0);
              const signatureObj = PDFInvalidObject.of(signatureBuffer);
              const signatureDictRef = pdfDoc.context.register(signatureObj);

              let widgetDictRef = placement.existingWidgetObject;
              let appendWidgetToForm = false;
              const existingWidget =
                widgetDictRef === undefined
                  ? undefined
                  : pdfDoc.context.lookupMaybe(widgetDictRef, PDFDict);
              if (existingWidget !== undefined) {
                existingWidget.set(PDFName.of("V"), signatureDictRef);
                existingWidget.set(PDFName.of("F"), PDFNumber.of(PRINT_ANNOTATION));
                existingWidget.set(PDFName.of("P"), page.ref);
                if (existingWidget.get(PDFName.of("T")) === undefined) {
                  existingWidget.set(PDFName.of("T"), PDFString.of("SignatureKitSignature1"));
                }
              } else {
                const rect = PDFArray.withContext(pdfDoc.context);
                rect.push(PDFNumber.of(placement.widgetRect[0]));
                rect.push(PDFNumber.of(placement.widgetRect[1]));
                rect.push(PDFNumber.of(placement.widgetRect[2]));
                rect.push(PDFNumber.of(placement.widgetRect[3]));
                const widgetDict = pdfDoc.context.obj({
                  Type: "Annot",
                  Subtype: "Widget",
                  FT: "Sig",
                  Rect: rect,
                  V: signatureDictRef,
                  T: PDFString.of("SignatureKitSignature1"),
                  F: PRINT_ANNOTATION,
                  P: page.ref,
                });
                widgetDictRef = pdfDoc.context.register(widgetDict);
                appendWidgetToForm = true;

                let annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
                if (annotations === undefined) annotations = pdfDoc.context.obj([]);
                annotations.push(widgetDictRef);
                page.node.set(PDFName.of("Annots"), annotations);
              }

              let acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
              if (acroForm === undefined) {
                acroForm = pdfDoc.context.obj({ Fields: [] });
                const acroFormRef = pdfDoc.context.register(acroForm);
                pdfDoc.catalog.set(PDFName.of("AcroForm"), acroFormRef);
              }

              const existingSigFlags = acroForm.lookupMaybe(PDFName.of("SigFlags"), PDFNumber);
              const sigFlags = existingSigFlags === undefined ? 0 : existingSigFlags.asNumber();
              acroForm.set(
                PDFName.of("SigFlags"),
                PDFNumber.of(sigFlags | SIGNATURES_EXIST | APPEND_ONLY),
              );

              let fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
              if (fields === undefined) {
                fields = pdfDoc.context.obj([]);
                acroForm.set(PDFName.of("Fields"), fields);
              }
              if (appendWidgetToForm && widgetDictRef !== undefined) fields.push(widgetDictRef);

              return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
            },
            catch: () =>
              new PdfError({
                code: PdfErrorCodeValue.invalidPdf,
                retryable: false,
                operation: PdfOperationValue.placeholder,
              }),
          });
        }),
      ),
    ),
  );
