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
import {
  type PdfSignatureAppearance,
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
} from "./config";

export const DEFAULT_SIGNATURE_LENGTH = 16384;
const BYTE_RANGE_PLACEHOLDER = "**********";
const SIGNATURES_EXIST = 0x01;
const APPEND_ONLY = 0x02;
const PRINT_ANNOTATION = 0x04;

type PlaceholderOptions = {
  readonly reason: string;
  readonly contactInfo: string;
  readonly name: string;
  readonly location: string;
  readonly signingTime: Date;
  readonly signatureLength: number;
  readonly appearance: PdfSignatureAppearance;
};

export const addSignaturePlaceholder = (
  pdf: Uint8Array,
  options: PlaceholderOptions,
): Effect.Effect<Uint8Array, PdfError> =>
  Effect.tryPromise({
    try: async () => {
      const pdfDoc = await PDFDocument.load(pdf);
      const pages = pdfDoc.getPages();
      const pageIndex = options.appearance.pageIndex ?? 0;
      const page = pages[pageIndex];
      if (page === undefined) {
        return new Uint8Array(0);
      }

      const byteRange = PDFArray.withContext(pdfDoc.context);
      byteRange.push(PDFNumber.of(0));
      byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
      byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
      byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));

      const placeholder = PDFHexString.of(String.fromCharCode(0).repeat(options.signatureLength));
      const signatureDict = pdfDoc.context.obj({
        Type: "Sig",
        Filter: "Adobe.PPKLite",
        SubFilter: "adbe.pkcs7.detached",
        ByteRange: byteRange,
        Contents: placeholder,
        Reason: PDFString.of(options.reason),
        M: PDFString.fromDate(options.signingTime),
        ContactInfo: PDFString.of(options.contactInfo),
        Name: PDFString.of(options.name),
        Location: PDFString.of(options.location),
        Prop_Build: { Filter: { Name: "Adobe.PPKLite" }, App: { Name: "SignatureKit" } },
      });
      const signatureBuffer = new Uint8Array(signatureDict.sizeInBytes());
      signatureDict.copyBytesInto(signatureBuffer, 0);
      const signatureObj = PDFInvalidObject.of(signatureBuffer);
      const signatureDictRef = pdfDoc.context.register(signatureObj);

      const widgetRect = options.appearance.widgetRect ?? [0, 0, 0, 0];
      const rect = PDFArray.withContext(pdfDoc.context);
      rect.push(PDFNumber.of(widgetRect[0]));
      rect.push(PDFNumber.of(widgetRect[1]));
      rect.push(PDFNumber.of(widgetRect[2]));
      rect.push(PDFNumber.of(widgetRect[3]));
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
      const widgetDictRef = pdfDoc.context.register(widgetDict);

      let annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (annotations === undefined) annotations = pdfDoc.context.obj([]);
      annotations.push(widgetDictRef);
      page.node.set(PDFName.of("Annots"), annotations);

      let acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
      if (acroForm === undefined) {
        acroForm = pdfDoc.context.obj({ Fields: [] });
        const acroFormRef = pdfDoc.context.register(acroForm);
        pdfDoc.catalog.set(PDFName.of("AcroForm"), acroFormRef);
      }

      const existingSigFlags = acroForm.lookupMaybe(PDFName.of("SigFlags"), PDFNumber);
      const sigFlags = existingSigFlags === undefined ? 0 : existingSigFlags.asNumber();
      acroForm.set(PDFName.of("SigFlags"), PDFNumber.of(sigFlags | SIGNATURES_EXIST | APPEND_ONLY));

      let fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
      if (fields === undefined) {
        fields = pdfDoc.context.obj([]);
        acroForm.set(PDFName.of("Fields"), fields);
      }
      fields.push(widgetDictRef);

      return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
    },
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        operation: PdfOperationValue.placeholder,
      }),
  }).pipe(
    Effect.flatMap((bytes) =>
      bytes.byteLength === 0
        ? Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.invalidPdf,
              retryable: false,
              reason: "The selected PDF page does not exist.",
              operation: PdfOperationValue.placeholder,
            }),
          )
        : Effect.succeed(bytes),
    ),
  );
