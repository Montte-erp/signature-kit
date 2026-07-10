import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from "@cantoo/pdf-lib";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { PdfErrorCodeValue, PdfOperationValue } from "../src/config";
import { mergePdfs } from "../src/merge";
import { signPdf } from "../src/sign";
import { verifyPdf } from "../src/verify";

const PASSWORD = Redacted.make("changeit");

const rectangle = (pdf: PDFDocument): PDFArray => {
  const rect = PDFArray.withContext(pdf.context);
  rect.push(PDFNumber.of(20));
  rect.push(PDFNumber.of(20));
  rect.push(PDFNumber.of(120));
  rect.push(PDFNumber.of(60));
  return rect;
};

const createPdf = (): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([320, 180]);
    return new Uint8Array(await pdf.save({ useObjectStreams: false }));
  });

const createForwardLengthPdf = (): Uint8Array => {
  const encoder = new TextEncoder();
  const stream = "q\nendstream\nQ\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length 5 0 R >>\nstream\n${stream}endstream\nendobj\n`,
    `5 0 obj\n${encoder.encode(stream).byteLength}\nendobj\n`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(encoder.encode(pdf).byteLength);
    pdf += object;
  }
  const xrefOffset = encoder.encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(pdf);
};

const createDocumentTimestampPdf = (): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([320, 180]);
    pdf.context.register(pdf.context.obj({ Type: "DocTimeStamp" }));
    return new Uint8Array(await pdf.save({ useObjectStreams: false }));
  });

const createUnsignedAcroFormPdf = (): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([320, 180]);
    const link = pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: rectangle(pdf),
      Border: [0, 0, 0],
      A: { S: "URI", URI: PDFString.of("https://example.com") },
      P: page.ref,
    });
    const linkRef = pdf.context.register(link);
    const field = pdf.context.obj({
      FT: "Sig",
      T: PDFString.of("UnsignedSignature"),
    });
    const fieldRef = pdf.context.register(field);
    const widget = pdf.context.obj({
      Type: "Annot",
      Subtype: "Widget",
      Rect: rectangle(pdf),
      Parent: fieldRef,
      P: page.ref,
    });
    const widgetRef = pdf.context.register(widget);
    const kids = pdf.context.obj([]);
    kids.push(widgetRef);
    field.set(PDFName.of("Kids"), kids);
    const annotations = pdf.context.obj([]);
    annotations.push(linkRef);
    annotations.push(widgetRef);
    page.node.set(PDFName.of("Annots"), annotations);

    const fields = pdf.context.obj([]);
    fields.push(fieldRef);
    const acroForm = pdf.context.obj({ Fields: fields });
    pdf.catalog.set(PDFName.of("AcroForm"), pdf.context.register(acroForm));

    return new Uint8Array(
      await pdf.save({ updateFieldAppearances: false, useObjectStreams: false }),
    );
  });

const mergedAnnotationState = (
  pdf: Uint8Array,
): Effect.Effect<{
  readonly hasAcroForm: boolean;
  readonly hasSignatureObject: boolean;
  readonly annotationSubtypes: ReadonlyArray<string>;
}> =>
  Effect.promise(async () => {
    const document = await PDFDocument.load(pdf);
    const page = document.getPages()[0];
    const annotations =
      page === undefined ? undefined : page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    const annotationSubtypes =
      annotations === undefined
        ? []
        : Array.from({ length: annotations.size() }, (_, index) =>
            document.context
              .lookupMaybe(annotations.get(index), PDFDict)
              ?.lookupMaybe(PDFName.of("Subtype"), PDFName)
              ?.toString(),
          ).filter((subtype): subtype is string => subtype !== undefined);
    const hasSignatureObject = document.context.enumerateIndirectObjects().some(([, object]) => {
      if (!(object instanceof PDFDict)) return false;
      return (
        object.lookupMaybe(PDFName.of("Type"), PDFName)?.toString() === "/Sig" ||
        object.lookupMaybe(PDFName.of("FT"), PDFName)?.toString() === "/Sig"
      );
    });

    return {
      hasAcroForm: document.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict) !== undefined,
      hasSignatureObject,
      annotationSubtypes,
    };
  });

describe("PDF merge signed and AcroForm boundaries", () => {
  it.effect("rejects a cryptographically signed source before merge", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const source = yield* createPdf();
      const signed = yield* signPdf({ pdf: source, policy: "pades-icp-brasil" }).pipe(
        Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
      );
      const verification = yield* verifyPdf({ pdf: signed });
      const result = yield* Effect.result(mergePdfs([signed]));

      expect(verification.valid).toBe(true);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
        expect(result.failure.operation).toBe(PdfOperationValue.mergeDocuments);
      }
    }),
  );

  it.effect("rejects a document-timestamp source before merge", () =>
    Effect.gen(function* () {
      const source = yield* createDocumentTimestampPdf();
      const result = yield* Effect.result(mergePdfs([source]));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
        expect(result.failure.operation).toBe(PdfOperationValue.mergeDocuments);
      }
    }),
  );

  it.effect("merges an unsigned PDF with a forward indirect stream length", () =>
    Effect.gen(function* () {
      const source = createForwardLengthPdf();
      const sourcePageCount = yield* Effect.promise(async () =>
        (await PDFDocument.load(source)).getPageCount(),
      );
      const merged = yield* mergePdfs([source]);
      const mergedPageCount = yield* Effect.promise(async () =>
        (await PDFDocument.load(merged)).getPageCount(),
      );

      expect(sourcePageCount).toBe(1);
      expect(mergedPageCount).toBe(1);
    }),
  );

  it.effect("drops unsigned AcroForm widgets while preserving other annotations", () =>
    Effect.gen(function* () {
      const source = yield* createUnsignedAcroFormPdf();
      const merged = yield* mergePdfs([source]);
      const state = yield* mergedAnnotationState(merged);

      expect(state.annotationSubtypes).toStrictEqual(["/Link"]);
      expect(state.hasAcroForm).toBe(false);
      expect(state.hasSignatureObject).toBe(false);
    }),
  );

  it.effect(
    "rewrites copied non-widget annotation page references without changing its properties",
    () =>
      Effect.gen(function* () {
        const source = yield* createUnsignedAcroFormPdf();
        const sourceBeforeMerge = source.slice();
        const merged = yield* mergePdfs([source]);
        const document = yield* Effect.promise(() => PDFDocument.load(merged));
        const page = document.getPages()[0];

        expect(source).toStrictEqual(sourceBeforeMerge);
        expect(page).toBeDefined();
        if (page === undefined) return;

        const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
        const annotation =
          annotations === undefined
            ? undefined
            : document.context.lookupMaybe(annotations.get(0), PDFDict);
        const rect = annotation?.lookupMaybe(PDFName.of("Rect"), PDFArray);
        const action = annotation?.lookupMaybe(PDFName.of("A"), PDFDict);
        const border = annotation?.lookupMaybe(PDFName.of("Border"), PDFArray);

        expect(annotation?.lookupMaybe(PDFName.of("Type"), PDFName)?.toString()).toBe("/Annot");
        expect(annotation?.lookupMaybe(PDFName.of("Subtype"), PDFName)?.toString()).toBe("/Link");
        expect(annotation?.get(PDFName.of("P"))).toStrictEqual(page.ref);
        expect(
          rect === undefined
            ? undefined
            : Array.from({ length: rect.size() }, (_, index) =>
                rect.lookup(index, PDFNumber).asNumber(),
              ),
        ).toStrictEqual([20, 20, 120, 60]);
        expect(
          border === undefined
            ? undefined
            : Array.from({ length: border.size() }, (_, index) =>
                border.lookup(index, PDFNumber).asNumber(),
              ),
        ).toStrictEqual([0, 0, 0]);
        expect(action?.lookupMaybe(PDFName.of("S"), PDFName)?.toString()).toBe("/URI");
        expect(action?.lookupMaybe(PDFName.of("URI"), PDFString)?.decodeText()).toBe(
          "https://example.com",
        );
      }),
  );
});
