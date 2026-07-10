import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { PdfErrorCodeValue, PdfOperationValue } from "../src/config";
import { addSignaturePlaceholder } from "../src/placeholder";

const createPdfWithNestedSignatureKitName: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([320, 180]);
  const child = pdfDoc.context.obj({ T: PDFString.of("SignatureKitSignature1") });
  const childRef = pdfDoc.context.register(child);
  const kids = PDFArray.withContext(pdfDoc.context);
  kids.push(childRef);
  const root = pdfDoc.context.obj({ Kids: kids });
  const rootRef = pdfDoc.context.register(root);
  const fields = PDFArray.withContext(pdfDoc.context);
  fields.push(rootRef);
  const acroForm = pdfDoc.context.obj({ Fields: fields });
  pdfDoc.catalog.set(PDFName.of("AcroForm"), pdfDoc.context.register(acroForm));
  return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
});

const createPdfWithAcroForm = (
  populateFields: (pdfDoc: PDFDocument, fields: PDFArray) => void,
): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([320, 180]);
    const fields = PDFArray.withContext(pdfDoc.context);
    populateFields(pdfDoc, fields);
    const acroForm = pdfDoc.context.obj({ Fields: fields });
    pdfDoc.catalog.set(PDFName.of("AcroForm"), pdfDoc.context.register(acroForm));
    return pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false });
  });

const createPdfWithDeepFieldHierarchy = (): Effect.Effect<Uint8Array> =>
  createPdfWithAcroForm((pdfDoc, fields) => {
    const root = pdfDoc.context.obj({ T: PDFString.of("root") });
    let parent = root;
    for (let depth = 1; depth <= 65; depth += 1) {
      const child = pdfDoc.context.obj({ T: PDFString.of(`field-${depth}`) });
      const kids = PDFArray.withContext(pdfDoc.context);
      kids.push(pdfDoc.context.register(child));
      parent.set(PDFName.of("Kids"), kids);
      parent = child;
    }
    fields.push(pdfDoc.context.register(root));
  });

const createPdfWithCyclicFieldHierarchy = (): Effect.Effect<Uint8Array> =>
  createPdfWithAcroForm((pdfDoc, fields) => {
    const root = pdfDoc.context.obj({ T: PDFString.of("root") });
    const rootRef = pdfDoc.context.register(root);
    const kids = PDFArray.withContext(pdfDoc.context);
    kids.push(rootRef);
    root.set(PDFName.of("Kids"), kids);
    fields.push(rootRef);
  });

const createPdfWithWideFieldHierarchy = (fieldCount: number): Effect.Effect<Uint8Array> =>
  createPdfWithAcroForm((pdfDoc, fields) => {
    for (let index = 0; index < fieldCount; index += 1) {
      fields.push(
        pdfDoc.context.register(pdfDoc.context.obj({ T: PDFString.of(`field-${index}`) })),
      );
    }
  });

const expectInvalidPdfPlaceholder = (pdf: Uint8Array, reason: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const result = yield* Effect.result(addSignaturePlaceholder({ pdf, signatureLength: 128 }));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("PdfError");
      expect(result.failure.code).toBe(PdfErrorCodeValue.invalidPdf);
      expect(result.failure.operation).toBe(PdfOperationValue.placeholder);
      expect(result.failure.retryable).toBe(false);
      expect(result.failure.reason).toBe(reason);
    }
  });

describe("PDF placeholder field names", () => {
  it.effect("uses the first unused hierarchical field name for repeated placeholders", () =>
    Effect.gen(function* () {
      const source = yield* createPdfWithNestedSignatureKitName;
      const first = yield* addSignaturePlaceholder({ pdf: source, signatureLength: 128 });
      const second = yield* addSignaturePlaceholder({ pdf: first, signatureLength: 128 });
      const pdfDoc = yield* Effect.promise(() => PDFDocument.load(second));
      const acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
      const fields = acroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
      const root =
        fields === undefined ? undefined : pdfDoc.context.lookupMaybe(fields.get(0), PDFDict);
      const rootKids = root?.lookupMaybe(PDFName.of("Kids"), PDFArray);
      const nested =
        rootKids === undefined ? undefined : pdfDoc.context.lookupMaybe(rootKids.get(0), PDFDict);
      const firstSignature =
        fields === undefined ? undefined : pdfDoc.context.lookupMaybe(fields.get(1), PDFDict);
      const secondSignature =
        fields === undefined ? undefined : pdfDoc.context.lookupMaybe(fields.get(2), PDFDict);

      expect(nested?.lookupMaybe(PDFName.of("T"), PDFString)?.decodeText()).toBe(
        "SignatureKitSignature1",
      );
      expect(firstSignature?.lookupMaybe(PDFName.of("T"), PDFString)?.decodeText()).toBe(
        "SignatureKitSignature2",
      );
      expect(secondSignature?.lookupMaybe(PDFName.of("T"), PDFString)?.decodeText()).toBe(
        "SignatureKitSignature3",
      );
      expect(firstSignature?.get(PDFName.of("V"))).not.toBeUndefined();
      expect(secondSignature?.get(PDFName.of("V"))).not.toBeUndefined();
    }),
  );
  it.effect("accepts a hierarchy at the supported node budget", () =>
    Effect.gen(function* () {
      const source = yield* createPdfWithWideFieldHierarchy(10_000);
      const prepared = yield* addSignaturePlaceholder({ pdf: source, signatureLength: 128 });
      const pdfDoc = yield* Effect.promise(() => PDFDocument.load(prepared));
      const acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
      const fields = acroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
      const signatureField =
        fields === undefined ? undefined : pdfDoc.context.lookupMaybe(fields.get(10_000), PDFDict);

      expect(signatureField?.lookupMaybe(PDFName.of("T"), PDFString)?.decodeText()).toBe(
        "SignatureKitSignature1",
      );
    }),
  );

  it.effect("fails closed when a field hierarchy exceeds the node budget", () =>
    Effect.gen(function* () {
      const source = yield* createPdfWithWideFieldHierarchy(10_001);

      yield* expectInvalidPdfPlaceholder(
        source,
        "Signature field hierarchy exceeds the supported node budget.",
      );
    }),
  );

  it.effect("fails closed when a field hierarchy exceeds the depth budget", () =>
    Effect.gen(function* () {
      const source = yield* createPdfWithDeepFieldHierarchy();

      yield* expectInvalidPdfPlaceholder(
        source,
        "Signature field hierarchy exceeds the supported depth.",
      );
    }),
  );

  it.effect("fails closed for a cyclic field hierarchy", () =>
    Effect.gen(function* () {
      const source = yield* createPdfWithCyclicFieldHierarchy();

      yield* expectInvalidPdfPlaceholder(source, "Signature field hierarchy is cyclic.");
    }),
  );

  it.effect("fails closed when processing an oversized field name", () =>
    Effect.gen(function* () {
      const source = yield* createPdfWithAcroForm((pdfDoc, fields) => {
        fields.push(
          pdfDoc.context.register(pdfDoc.context.obj({ T: PDFString.of("name".repeat(1_025)) })),
        );
      });

      yield* expectInvalidPdfPlaceholder(
        source,
        "Signature field name exceeds the supported length.",
      );
    }),
  );
  it.effect("fails closed when aggregate field-name processing exceeds its budget", () =>
    Effect.gen(function* () {
      const source = yield* createPdfWithAcroForm((pdfDoc, fields) => {
        for (let index = 0; index < 123; index += 1) {
          const name = `${index}`.padEnd(4_096, "name");
          fields.push(pdfDoc.context.register(pdfDoc.context.obj({ T: PDFString.of(name) })));
        }
      });

      yield* expectInvalidPdfPlaceholder(
        source,
        "Signature field names exceed the supported processing budget.",
      );
    }),
  );
});
