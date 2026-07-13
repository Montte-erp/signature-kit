import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFObject,
} from "@cantoo/pdf-lib";
import { Effect, Schema } from "effect";
import {
  PdfError,
  PdfErrorCodeValue,
  PdfOperationValue,
  PdfSigningRequestSchema,
} from "./config.js";
import type { PdfSigningRequest } from "./config.js";
import { resolveSignatureWidgetPlacement } from "./placement.js";
import { hasPdfByteRange } from "./byte-range.js";

export const DEFAULT_SIGNATURE_LENGTH = 16384;
export const DEFAULT_ICP_BRASIL_SIGNATURE_LENGTH = 32768;
const BYTE_RANGE_PLACEHOLDER = "**********";
const SIGNATURES_EXIST = 0x01;
const APPEND_ONLY = 0x02;
const PRINT_ANNOTATION = 0x04;

const hasExistingSignature = hasPdfByteRange;

const SIGNATURE_FIELD_NAME_PREFIX = "SignatureKitSignature";

const MAX_SIGNATURE_FIELD_NAME_TRAVERSAL_DEPTH = 64;
const MAX_SIGNATURE_FIELD_NAME_TRAVERSAL_NODES = 10_000;
const MAX_SIGNATURE_FIELD_NAME_LENGTH = 4_096;
const MAX_SIGNATURE_FIELD_NAME_CHARACTERS = 1_000_000;

type SignatureFieldNameSearch =
  | { readonly _tag: "found"; readonly fieldName: string }
  | { readonly _tag: "failed"; readonly reason: string };

type SignatureFieldForm = {
  readonly acroForm: PDFDict;
  readonly fields: PDFArray;
};

const firstUnusedSignatureFieldName = (
  pdfDoc: PDFDocument,
  fields: PDFArray,
): Effect.Effect<string, PdfError> =>
  Effect.try({
    try: (): SignatureFieldNameSearch => {
      const fullNames = new Set<string>();
      const partialNames = new Set<string>();
      const seenObjects = new Set<PDFObject>();
      const seenFields = new Set<PDFDict>();
      const pending: Array<{
        readonly object: PDFObject;
        readonly prefix: string;
        readonly depth: number;
      }> = [];
      let queuedNodes = 0;
      let processedNameCharacters = 0;

      const enqueue = (
        object: PDFObject | undefined,
        prefix: string,
        depth: number,
      ): SignatureFieldNameSearch | undefined => {
        if (object === undefined) return undefined;
        if (depth > MAX_SIGNATURE_FIELD_NAME_TRAVERSAL_DEPTH) {
          return {
            _tag: "failed",
            reason: "Signature field hierarchy exceeds the supported depth.",
          };
        }
        if (queuedNodes >= MAX_SIGNATURE_FIELD_NAME_TRAVERSAL_NODES) {
          return {
            _tag: "failed",
            reason: "Signature field hierarchy exceeds the supported node budget.",
          };
        }
        queuedNodes += 1;
        pending.push({ object, prefix, depth });
        return undefined;
      };

      for (let index = 0; index < fields.size(); index += 1) {
        const failure = enqueue(fields.get(index), "", 0);
        if (failure !== undefined) return failure;
      }

      while (pending.length > 0) {
        const current = pending.pop();
        if (current === undefined) continue;
        if (seenObjects.has(current.object)) {
          return { _tag: "failed", reason: "Signature field hierarchy is cyclic." };
        }
        seenObjects.add(current.object);
        const field = pdfDoc.context.lookupMaybe(current.object, PDFDict);
        if (field === undefined) continue;
        if (seenFields.has(field)) {
          return { _tag: "failed", reason: "Signature field hierarchy is cyclic." };
        }
        seenFields.add(field);

        const partialName =
          field.lookupMaybe(PDFName.of("T"), PDFString)?.decodeText() ??
          field.lookupMaybe(PDFName.of("T"), PDFHexString)?.decodeText();
        let fullName = current.prefix;
        if (partialName !== undefined) {
          if (partialName.length > MAX_SIGNATURE_FIELD_NAME_LENGTH) {
            return {
              _tag: "failed",
              reason: "Signature field name exceeds the supported length.",
            };
          }
          const fullNameLength =
            current.prefix.length + (current.prefix === "" ? 0 : 1) + partialName.length;
          if (fullNameLength > MAX_SIGNATURE_FIELD_NAME_LENGTH) {
            return {
              _tag: "failed",
              reason: "Fully-qualified signature field name exceeds the supported length.",
            };
          }
          const processedCharacters = partialName.length + fullNameLength;
          if (processedNameCharacters > MAX_SIGNATURE_FIELD_NAME_CHARACTERS - processedCharacters) {
            return {
              _tag: "failed",
              reason: "Signature field names exceed the supported processing budget.",
            };
          }
          processedNameCharacters += processedCharacters;
          fullName = current.prefix === "" ? partialName : `${current.prefix}.${partialName}`;
          partialNames.add(partialName);
          fullNames.add(fullName);
        }

        const kids = field.lookupMaybe(PDFName.of("Kids"), PDFArray);
        if (kids === undefined) continue;
        for (let index = 0; index < kids.size(); index += 1) {
          const failure = enqueue(kids.get(index), fullName, current.depth + 1);
          if (failure !== undefined) return failure;
        }
      }

      let suffix = 1;
      while (
        fullNames.has(`${SIGNATURE_FIELD_NAME_PREFIX}${suffix}`) ||
        partialNames.has(`${SIGNATURE_FIELD_NAME_PREFIX}${suffix}`)
      ) {
        suffix += 1;
      }
      return { _tag: "found", fieldName: `${SIGNATURE_FIELD_NAME_PREFIX}${suffix}` };
    },
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        operation: PdfOperationValue.placeholder,
      }),
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "found"
        ? Effect.succeed(result.fieldName)
        : Effect.fail(
            new PdfError({
              code: PdfErrorCodeValue.invalidPdf,
              retryable: false,
              reason: result.reason,
              operation: PdfOperationValue.placeholder,
            }),
          ),
    ),
  );

const signatureFieldForm = (pdfDoc: PDFDocument): Effect.Effect<SignatureFieldForm, PdfError> =>
  Effect.try({
    try: (): SignatureFieldForm => {
      let acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
      if (acroForm === undefined) {
        acroForm = pdfDoc.context.obj({ Fields: [] });
        const acroFormRef = pdfDoc.context.register(acroForm);
        pdfDoc.catalog.set(PDFName.of("AcroForm"), acroFormRef);
      }
      let fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
      if (fields === undefined) {
        fields = pdfDoc.context.obj([]);
        acroForm.set(PDFName.of("Fields"), fields);
      }
      return { acroForm, fields };
    },
    catch: () =>
      new PdfError({
        code: PdfErrorCodeValue.invalidPdf,
        retryable: false,
        operation: PdfOperationValue.placeholder,
      }),
  });

export const addSignaturePlaceholder = (
  input: PdfSigningRequest,
): Effect.Effect<Uint8Array, PdfError> =>
  Schema.decodeUnknownEffect(PdfSigningRequestSchema)(input).pipe(
    Effect.mapError(
      (issue) =>
        new PdfError({
          code: PdfErrorCodeValue.invalidBuilderInput,
          retryable: false,
          operation: PdfOperationValue.placeholder,
          reason: "PDF signing input failed schema validation.",
          issueMessage: String(issue),
        }),
    ),
    Effect.flatMap((request) =>
      Effect.tryPromise({
        try: () =>
          PDFDocument.load(request.pdf, {
            forIncrementalUpdate: hasExistingSignature(request.pdf),
          }),
        catch: () =>
          new PdfError({
            code: PdfErrorCodeValue.invalidPdf,
            retryable: false,
            operation: PdfOperationValue.placeholder,
          }),
      }).pipe(
        Effect.flatMap((pdfDoc) =>
          resolveSignatureWidgetPlacement(pdfDoc, request.appearance ?? {}).pipe(
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

              const [left, bottom, right, top] = placement.widgetRect;
              const isInvisibleWidget =
                placement.invisible === true &&
                left === 0 &&
                bottom === 0 &&
                right === 0 &&
                top === 0;
              const isVisibleWidget =
                Number.isFinite(left) &&
                Number.isFinite(bottom) &&
                Number.isFinite(right) &&
                Number.isFinite(top) &&
                left < right &&
                bottom < top;
              if (!isInvisibleWidget && !isVisibleWidget) {
                return Effect.fail(
                  new PdfError({
                    code: PdfErrorCodeValue.signaturePlacementFailed,
                    retryable: false,
                    operation: PdfOperationValue.placeholder,
                    reason: "Signature widget coordinates must form a finite non-empty rectangle.",
                  }),
                );
              }

              const signatureLength =
                request.signatureLength ??
                (request.policy === "pades-icp-brasil"
                  ? DEFAULT_ICP_BRASIL_SIGNATURE_LENGTH
                  : DEFAULT_SIGNATURE_LENGTH);
              return signatureFieldForm(pdfDoc).pipe(
                Effect.flatMap(({ acroForm, fields }) =>
                  firstUnusedSignatureFieldName(pdfDoc, fields).pipe(
                    Effect.flatMap((signatureFieldName) =>
                      Effect.tryPromise({
                        try: async () => {
                          const byteRange = PDFArray.withContext(pdfDoc.context);
                          byteRange.push(PDFNumber.of(0));
                          byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
                          byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
                          byteRange.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));

                          const placeholder = PDFHexString.of("0".repeat(signatureLength * 2));
                          const signatureDict = pdfDoc.context.obj({
                            Type: "Sig",
                            Filter: "Adobe.PPKLite",
                            SubFilter: "adbe.pkcs7.detached",
                            ByteRange: byteRange,
                            Contents: placeholder,
                            Reason: PDFHexString.fromText(request.reason ?? "Digital signature"),
                            M: PDFString.fromDate(request.signingTime ?? new Date()),
                            ContactInfo: PDFHexString.fromText(request.contactInfo ?? ""),
                            Name: PDFHexString.fromText(request.name ?? "SignatureKit signer"),
                            Location: PDFHexString.fromText(request.location ?? ""),
                            Prop_Build: {
                              Filter: { Name: "Adobe.PPKLite" },
                              App: { Name: "SignatureKit" },
                            },
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
                          const existingSignatureField =
                            placement.existingSignatureFieldObject === undefined
                              ? undefined
                              : pdfDoc.context.lookupMaybe(
                                  placement.existingSignatureFieldObject,
                                  PDFDict,
                                );
                          if (
                            existingWidget !== undefined &&
                            existingSignatureField !== undefined
                          ) {
                            existingSignatureField.set(PDFName.of("V"), signatureDictRef);
                            const existingFlags =
                              existingWidget.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ??
                              0;
                            existingWidget.set(
                              PDFName.of("F"),
                              PDFNumber.of(existingFlags | PRINT_ANNOTATION),
                            );
                            existingWidget.set(PDFName.of("P"), page.ref);
                            if (
                              existingSignatureField === existingWidget &&
                              existingWidget.get(PDFName.of("T")) === undefined
                            ) {
                              existingWidget.set(PDFName.of("T"), PDFString.of(signatureFieldName));
                            }
                          } else {
                            const rect = PDFArray.withContext(pdfDoc.context);
                            rect.push(PDFNumber.of(left));
                            rect.push(PDFNumber.of(bottom));
                            rect.push(PDFNumber.of(right));
                            rect.push(PDFNumber.of(top));
                            const widgetDict = pdfDoc.context.obj({
                              Type: "Annot",
                              Subtype: "Widget",
                              FT: "Sig",
                              Rect: rect,
                              V: signatureDictRef,
                              T: PDFString.of(signatureFieldName),
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

                          const existingSigFlags = acroForm.lookupMaybe(
                            PDFName.of("SigFlags"),
                            PDFNumber,
                          );
                          const sigFlags =
                            existingSigFlags === undefined ? 0 : existingSigFlags.asNumber();
                          acroForm.set(
                            PDFName.of("SigFlags"),
                            PDFNumber.of(sigFlags | SIGNATURES_EXIST | APPEND_ONLY),
                          );

                          if (appendWidgetToForm && widgetDictRef !== undefined) {
                            fields.push(widgetDictRef);
                          }

                          return pdfDoc.save({
                            useObjectStreams: false,
                            updateFieldAppearances: false,
                          });
                        },
                        catch: () =>
                          new PdfError({
                            code: PdfErrorCodeValue.invalidPdf,
                            retryable: false,
                            operation: PdfOperationValue.placeholder,
                          }),
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
