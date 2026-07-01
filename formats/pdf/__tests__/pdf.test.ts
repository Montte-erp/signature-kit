import { describe, expect, it } from "@effect/vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from "@cantoo/pdf-lib";
import { Effect, Redacted, Result, Schema } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signPdf } from "@signature-kit/pdf/sign";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { extractPdfSignature, preparePdfByteRange } from "../src/byte-range";
import { encodeAscii, indexOfBytes, replaceRange } from "../src/bytes";
import { stampPdfRubric } from "../src/stamp";
import {
  PdfSigningRequestSchema,
  type PdfCoordinateTuple,
  type PdfSignatureAnchor,
} from "../src/config";

const PASSWORD = Redacted.make("changeit");
const SIGNATURE_POLICY_OID_DER = Uint8Array.of(
  0x06,
  0x0b,
  0x2a,
  0x86,
  0x48,
  0x86,
  0xf7,
  0x0d,
  0x01,
  0x09,
  0x10,
  0x02,
  0x0f,
);
const SIGNING_CERTIFICATE_V2_OID_DER = Uint8Array.of(
  0x06,
  0x0b,
  0x2a,
  0x86,
  0x48,
  0x86,
  0xf7,
  0x0d,
  0x01,
  0x09,
  0x10,
  0x02,
  0x2f,
);
const latin1 = new TextDecoder("latin1");
const OCCUPIED_SIGNATURE_RECT: PdfCoordinateTuple = [180, 20, 300, 60];
const DECLARATION_SIGNATURE_SLOTS: ReadonlyArray<{
  readonly label: string;
  readonly rect: PdfCoordinateTuple;
}> = [
  { label: "Declarante", rect: [20, 118, 140, 158] },
  { label: "TestemunhaCentral", rect: [100, 68, 220, 108] },
  { label: "Responsavel", rect: [180, 20, 300, 60] },
];

const rectFromArray = (array: PDFArray): PdfCoordinateTuple | undefined => {
  if (array.size() !== 4) return undefined;
  const left = array.lookupMaybe(0, PDFNumber)?.asNumber();
  const bottom = array.lookupMaybe(1, PDFNumber)?.asNumber();
  const right = array.lookupMaybe(2, PDFNumber)?.asNumber();
  const top = array.lookupMaybe(3, PDFNumber)?.asNumber();
  if (left === undefined || bottom === undefined || right === undefined || top === undefined) {
    return undefined;
  }
  return [left, bottom, right, top];
};

const sameRect = (left: PdfCoordinateTuple, right: PdfCoordinateTuple): boolean => {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const rectanglesOverlap = (left: PdfCoordinateTuple, right: PdfCoordinateTuple): boolean => {
  const separated =
    left[2] <= right[0] || right[2] <= left[0] || left[3] <= right[1] || right[3] <= left[1];
  return !separated;
};

const createPdfWithOccupiedSignatureArea: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  const firstPage = pdf.addPage([320, 180]);
  firstPage.drawText("First page payload", { x: 40, y: 120, size: 16 });
  const lastPage = pdf.addPage([320, 180]);
  lastPage.drawText("Last page payload", { x: 40, y: 120, size: 16 });

  const rect = PDFArray.withContext(pdf.context);
  rect.push(PDFNumber.of(OCCUPIED_SIGNATURE_RECT[0]));
  rect.push(PDFNumber.of(OCCUPIED_SIGNATURE_RECT[1]));
  rect.push(PDFNumber.of(OCCUPIED_SIGNATURE_RECT[2]));
  rect.push(PDFNumber.of(OCCUPIED_SIGNATURE_RECT[3]));
  const widget = pdf.context.obj({
    Type: "Annot",
    Subtype: "Widget",
    Rect: rect,
    T: PDFString.of("ExistingBottomRightWidget"),
  });
  const widgetRef = pdf.context.register(widget);
  const annotations = pdf.context.obj([]);
  annotations.push(widgetRef);
  lastPage.node.set(PDFName.of("Annots"), annotations);

  return pdf.save({ useObjectStreams: false });
});

const createDeclarationPdfWithSignatureSlots: Effect.Effect<Uint8Array> = Effect.promise(
  async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([320, 180]);
    page.drawText("DECLARAÇÃO DE CAPACIDADE TÉCNICA", { x: 34, y: 158, size: 13 });
    page.drawText("Declaramos para fins de habilitação que a empresa cumpriu o objeto.", {
      x: 28,
      y: 138,
      size: 8,
    });
    page.drawText("Declarante", { x: 48, y: 160, size: 7 });
    page.drawText("Testemunha", { x: 134, y: 110, size: 7 });
    page.drawText("Responsável legal", { x: 206, y: 62, size: 7 });

    const annotations = pdf.context.obj([]);
    const fields = pdf.context.obj([]);
    for (const slot of DECLARATION_SIGNATURE_SLOTS) {
      const rect = PDFArray.withContext(pdf.context);
      rect.push(PDFNumber.of(slot.rect[0]));
      rect.push(PDFNumber.of(slot.rect[1]));
      rect.push(PDFNumber.of(slot.rect[2]));
      rect.push(PDFNumber.of(slot.rect[3]));
      const widget = pdf.context.obj({
        Type: "Annot",
        Subtype: "Widget",
        FT: "Sig",
        Rect: rect,
        T: PDFString.of(slot.label),
        F: 4,
        P: page.ref,
      });
      const widgetRef = pdf.context.register(widget);
      annotations.push(widgetRef);
      fields.push(widgetRef);
    }
    page.node.set(PDFName.of("Annots"), annotations);
    const acroForm = pdf.context.obj({ Fields: fields });
    const acroFormRef = pdf.context.register(acroForm);
    pdf.catalog.set(PDFName.of("AcroForm"), acroFormRef);

    return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
  },
);

const readPageAnnotationRects = (
  pdf: Uint8Array,
  pageIndex: number,
): Effect.Effect<ReadonlyArray<PdfCoordinateTuple>> =>
  Effect.promise(async () => {
    const pdfDoc = await PDFDocument.load(pdf);
    const page = pdfDoc.getPages()[pageIndex];
    if (page === undefined) return [];
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annotations === undefined) return [];

    const rects: Array<PdfCoordinateTuple> = [];
    for (let index = 0; index < annotations.size(); index++) {
      const annotation = pdfDoc.context.lookupMaybe(annotations.get(index), PDFDict);
      const rectArray = annotation?.lookupMaybe(PDFName.of("Rect"), PDFArray);
      const rect = rectArray === undefined ? undefined : rectFromArray(rectArray);
      if (rect !== undefined) rects.push(rect);
    }
    return rects;
  });

const readSignedWidgetRects = (
  pdf: Uint8Array,
  pageIndex: number,
): Effect.Effect<ReadonlyArray<PdfCoordinateTuple>> =>
  Effect.promise(async () => {
    const pdfDoc = await PDFDocument.load(pdf);
    const page = pdfDoc.getPages()[pageIndex];
    if (page === undefined) return [];
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (annotations === undefined) return [];

    const rects: Array<PdfCoordinateTuple> = [];
    for (let index = 0; index < annotations.size(); index++) {
      const annotation = pdfDoc.context.lookupMaybe(annotations.get(index), PDFDict);
      const rectArray = annotation?.lookupMaybe(PDFName.of("Rect"), PDFArray);
      const rect = rectArray === undefined ? undefined : rectFromArray(rectArray);
      if (annotation?.get(PDFName.of("V")) !== undefined && rect !== undefined) rects.push(rect);
    }
    return rects;
  });

const createPdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  page.drawText("SignatureKit PDF payload", { x: 40, y: 120, size: 16 });
  return pdf.save({ useObjectStreams: false });
});

describe("PDF byte helpers", () => {
  it("replaces byte ranges without mutating the source", () => {
    const source = encodeAscii("0123456789");
    const replaced = replaceRange(source, 2, 7, encodeAscii("ABCDE"));

    expect(latin1.decode(replaced)).toBe("01ABCDE789");
    expect(latin1.decode(source)).toBe("0123456789");
  });

  it("handles prefix and suffix replacements", () => {
    expect(latin1.decode(replaceRange(encodeAscii("abcdef"), 0, 3, encodeAscii("12")))).toBe(
      "12def",
    );
    expect(latin1.decode(replaceRange(encodeAscii("abcdef"), 3, 6, encodeAscii("34")))).toBe(
      "abc34",
    );
  });
});

describe("PDF signatures", () => {
  it.effect("signs and verifies a PDF with detached CMS bytes", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createPdf;
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });

      const signed = yield* signPdf({
        pdf,
        reason: "Automated SignatureKit test",
        name: "Empresa CNPJ:12345678000195",
        location: "BR",
        signatureLength: 16384,
      }).pipe(Effect.provide(layer));
      const verification = yield* verifyPdf({ pdf: signed });

      const tamperedBytes = new Uint8Array(signed);
      tamperedBytes[20] = (tamperedBytes[20] ?? 0) ^ 0xff;
      const tampered = yield* verifyPdf({ pdf: tamperedBytes });

      expect(signed.byteLength).toBeGreaterThan(pdf.byteLength);
      expect(verification.valid).toBe(true);
      expect(verification.chainValid).toBe(true);
      expect(verification.signatureCount).toBe(1);
      expect(verification.byteRange[0]).toBe(0);
      expect(tampered.valid).toBe(false);
    }),
  );

  it.effect("signs one PDF with two A1 certificates in sequence", () =>
    Effect.gen(function* () {
      const companyPfx = yield* readA1Fixture("ecnpj");
      const personPfx = yield* readA1Fixture("ecpf");
      const pdf = yield* createPdf;

      const companySigned = yield* signPdf({
        pdf,
        reason: "Company approval",
        name: "Empresa CNPJ:12345678000195",
        location: "BR",
        signatureLength: 16384,
        appearance: {
          placement: { kind: "manual", pageIndex: 0, widgetRect: [20, 20, 140, 60] },
        },
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx: companyPfx, password: PASSWORD })));

      const personSigned = yield* signPdf({
        pdf: companySigned,
        reason: "Person approval",
        name: "Pessoa CPF:12345678901",
        location: "BR",
        signatureLength: 16384,
        appearance: {
          placement: { kind: "manual", pageIndex: 0, widgetRect: [180, 20, 300, 60] },
        },
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx: personPfx, password: PASSWORD })));

      const verification = yield* verifyPdf({ pdf: personSigned });

      expect(personSigned.byteLength).toBeGreaterThan(companySigned.byteLength);
      expect(verification.valid).toBe(true);
      expect(verification.chainValid).toBe(true);
      expect(verification.signatureCount).toBe(2);
    }),
  );

  it.effect("stamps a rubric on every page, then signs once over the whole document", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const base = yield* Effect.promise(async () => {
        const doc = await PDFDocument.create();
        doc.addPage([320, 180]).drawText("Page 1", { x: 32, y: 150, size: 12 });
        doc.addPage([320, 180]).drawText("Page 2", { x: 32, y: 150, size: 12 });
        return new Uint8Array(await doc.save({ useObjectStreams: false }));
      });

      // Rubric on EVERY page, then ONE PAdES signature over the stamped bytes.
      const stamped = yield* stampPdfRubric(base, {
        rect: [20, 20, 150, 64],
        pages: "all",
        lines: ["TELEMACO CERIOLLI JUNIOR", "CPF/CNPJ: 767.081.102-10"],
      });
      const signed = yield* signPdf({
        pdf: stamped,
        reason: "Rubric on every page",
        signatureLength: 16384,
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
      const verification = yield* verifyPdf({ pdf: signed });

      expect(stamped.byteLength).toBeGreaterThan(base.byteLength);
      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
      // ByteRange starts at 0 — the one signature covers the rubric on every page.
      expect(verification.byteRange[0]).toBe(0);
    }),
  );

  it.effect("prepares the newest ByteRange placeholder when older ranges already exist", () =>
    Effect.gen(function* () {
      const pdf = encodeAscii(
        `%PDF-1.7
1 0 obj << /Type /Sig /ByteRange [0 0 0 0] /Contents <00> >> endobj
${"x".repeat(1000)}
2 0 obj << /Type /Sig /ByteRange [0 /********** /********** /**********] /Contents <${"0".repeat(64)}> >> endobj
%%EOF`,
      );

      const prepared = yield* preparePdfByteRange(pdf);
      const text = latin1.decode(prepared.pdf);

      expect(text).toContain("/ByteRange [0 0 0 0]");
      expect(prepared.byteRange[1]).toBeGreaterThan(1000);
      expect(indexOfBytes(prepared.signedData, encodeAscii("/**********"))).toBe(-1);
    }),
  );

  it.effect("embeds ICP-Brasil policy attributes when requested", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createPdf;

      const signed = yield* signPdf({
        pdf,
        policy: "pades-icp-brasil",
        icpBrasil: {
          policyOid: "2.16.76.1.7.1.11.1.1",
          policyHash: new Uint8Array(32),
          policyHashAlgorithm: "sha256",
          policyUri: "http://politicas.icpbrasil.gov.br/PA_PAdES_AD_RB_v1_1.der",
        },
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
      const extracted = yield* extractPdfSignature(signed);
      const verification = yield* verifyPdf({ pdf: signed });

      expect(verification.valid).toBe(true);
      expect(
        indexOfBytes(extracted.signature, SIGNING_CERTIFICATE_V2_OID_DER),
      ).toBeGreaterThanOrEqual(0);
      expect(indexOfBytes(extracted.signature, SIGNATURE_POLICY_OID_DER)).toBeGreaterThanOrEqual(0);
    }),
  );

  it.effect("signs PDFs with legacy SHA-1 and embeds signature dictionary metadata", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createPdf;
      const signed = yield* signPdf({
        pdf,
        hashAlgorithm: "sha1",
        reason: "Approval",
        name: "Empresa CNPJ:12345678000195",
        location: "Office",
        contactInfo: "test@example.com",
        signingTime: new Date("2026-01-02T03:04:05Z"),
        appearance: { pageIndex: 0, widgetRect: [10, 20, 110, 60] },
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
      const verification = yield* verifyPdf({ pdf: signed });
      const text = latin1.decode(signed);

      expect(verification.valid).toBe(true);
      expect(text).toContain("Approval");
      expect(text).toContain("Empresa CNPJ:12345678000195");
      expect(text).toContain("Office");
      expect(text).toContain("test@example.com");
      expect(text).toContain("/SubFilter /adbe.pkcs7.detached");
      expect(text).toContain("/ByteRange");
    }),
  );

  it.effect("automatically places a visible signature on the last page without colliding", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createPdfWithOccupiedSignatureArea;
      const signed = yield* signPdf({
        pdf,
        reason: "Automatic placement",
        appearance: {
          placement: {
            kind: "auto",
            width: 120,
            height: 40,
            margin: 20,
            gap: 10,
          },
        },
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
      const verification = yield* verifyPdf({ pdf: signed });
      const firstPageRects = yield* readPageAnnotationRects(signed, 0);
      const lastPageRects = yield* readPageAnnotationRects(signed, 1);
      const signatureRects = lastPageRects.filter(
        (rect) => !sameRect(rect, OCCUPIED_SIGNATURE_RECT),
      );
      const signatureRect = signatureRects[0];

      expect(verification.valid).toBe(true);
      expect(firstPageRects).toHaveLength(0);
      expect(lastPageRects).toHaveLength(2);
      expect(signatureRects).toHaveLength(1);
      expect(signatureRect).toBeDefined();
      if (signatureRect !== undefined) {
        expect(signatureRect).not.toEqual([0, 0, 0, 0]);
        expect(signatureRect[0]).toBeGreaterThanOrEqual(20);
        expect(signatureRect[1]).toBeGreaterThanOrEqual(20);
        expect(signatureRect[2]).toBeLessThanOrEqual(300);
        expect(signatureRect[3]).toBeLessThanOrEqual(160);
        expect(rectanglesOverlap(signatureRect, OCCUPIED_SIGNATURE_RECT)).toBe(false);
      }
    }),
  );

  it.effect("uses existing declaration signature slots selected by auto anchors", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createDeclarationPdfWithSignatureSlots;
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const cases: ReadonlyArray<{
        readonly anchor: PdfSignatureAnchor;
        readonly expectedRect: PdfCoordinateTuple;
      }> = [
        { anchor: "top-left", expectedRect: [20, 118, 140, 158] },
        { anchor: "middle-center", expectedRect: [100, 68, 220, 108] },
        { anchor: "bottom-right", expectedRect: [180, 20, 300, 60] },
      ];

      for (const placementCase of cases) {
        const signed = yield* signPdf({
          pdf,
          reason: `Auto placement ${placementCase.anchor}`,
          appearance: {
            placement: {
              kind: "auto",
              pageIndex: 0,
              anchor: placementCase.anchor,
              width: 120,
              height: 40,
              margin: 20,
              gap: 8,
            },
          },
        }).pipe(Effect.provide(layer));
        const verification = yield* verifyPdf({ pdf: signed });
        const annotationRects = yield* readPageAnnotationRects(signed, 0);
        const signedRects = yield* readSignedWidgetRects(signed, 0);

        expect(verification.valid).toBe(true);
        expect(annotationRects).toHaveLength(DECLARATION_SIGNATURE_SLOTS.length);
        expect(signedRects).toHaveLength(1);
        expect(signedRects[0]).toEqual(placementCase.expectedRect);
      }
    }),
  );

  it.effect("validates PDF signing request schemas and rejects invalid catalogs", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf;
      const valid = yield* Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
        pdf,
        reason: "Approval",
        location: "Office",
        policy: "pades-icp-brasil",
        hashAlgorithm: "sha512",
        timestamp: {
          tsaUrl: "https://timestamp.valid.com.br",
          hashAlgorithm: "sha256",
          timeoutMillis: 5000,
        },
        appearance: { pageIndex: 0, widgetRect: [10, 20, 110, 60] },
      });
      const validAutoPlacement = yield* Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
        pdf,
        appearance: {
          placement: {
            kind: "auto",
            page: "last",
            anchor: "bottom-right",
            width: 120,
            height: 40,
            margin: 20,
            gap: 10,
          },
        },
      });
      const invalidPolicy = yield* Effect.result(
        Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
          pdf,
          policy: "invalid-policy",
        }),
      );
      const invalidHash = yield* Effect.result(
        Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
          pdf,
          hashAlgorithm: "md5",
        }),
      );
      expect(valid.policy).toBe("pades-icp-brasil");
      expect(valid.timestamp?.tsaUrl).toContain("timestamp.valid.com.br");
      expect(valid.appearance?.widgetRect).toEqual([10, 20, 110, 60]);
      expect(Result.isFailure(invalidPolicy)).toBe(true);
      expect(Result.isFailure(invalidHash)).toBe(true);
      const invalidPlacement = yield* Effect.result(
        Schema.decodeUnknownEffect(PdfSigningRequestSchema)({
          pdf,
          appearance: { placement: { kind: "guess" } },
        }),
      );

      const decodedPlacement = validAutoPlacement.appearance?.placement;
      expect(decodedPlacement?.kind).toBe("auto");
      if (decodedPlacement?.kind === "auto") {
        expect(decodedPlacement.anchor).toBe("bottom-right");
      }
      expect(Result.isFailure(invalidPlacement)).toBe(true);
    }),
  );

  it.effect("keeps invalid PDF and out-of-range page errors typed", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const invalidPdf = yield* Effect.result(
        signPdf({ pdf: new Uint8Array([1, 2, 3]) }).pipe(Effect.provide(layer)),
      );
      const missingPage = yield* Effect.result(
        signPdf({
          pdf: yield* createPdf,
          appearance: { pageIndex: 5 },
        }).pipe(Effect.provide(layer)),
      );
      const impossiblePlacement = yield* Effect.result(
        signPdf({
          pdf: yield* createPdf,
          appearance: { placement: { kind: "auto", width: 400, height: 40, margin: 20 } },
        }).pipe(Effect.provide(layer)),
      );

      expect(Result.isFailure(invalidPdf)).toBe(true);
      if (Result.isFailure(invalidPdf)) {
        expect(invalidPdf.failure.code).toBe("pdf.INVALID_PDF");
      }
      expect(Result.isFailure(missingPage)).toBe(true);
      if (Result.isFailure(missingPage)) {
        expect(missingPage.failure.code).toBe("pdf.INVALID_PDF");
      }
      expect(Result.isFailure(impossiblePlacement)).toBe(true);
      if (Result.isFailure(impossiblePlacement)) {
        expect(impossiblePlacement.failure.code).toBe("pdf.SIGNATURE_PLACEMENT_FAILED");
        expect(impossiblePlacement.failure.operation).toBe("pdf.placeholder");
      }
    }),
  );
});
