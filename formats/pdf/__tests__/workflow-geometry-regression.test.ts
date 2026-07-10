import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  degrees,
} from "@cantoo/pdf-lib";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { PdfErrorCodeValue } from "../src/config";
import type { PdfSignaturePage, PdfSignatureRect, PdfSignatureTemplate } from "../src/config";
import { liteParseWorkerBrowserLayer } from "../src/liteparse-browser";
import {
  loadPdfSignatureDocument,
  prepareAndSignPdf,
  preparePdfSigningBatch,
  signPdfSignatureBatch,
  signPdfSignatureField,
} from "../src/workflow";
import { verifyPdf } from "../src/verify";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";

const PASSWORD = Redacted.make("changeit");

const createPdf = (sizes: ReadonlyArray<readonly [number, number]>): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.create();
    for (const [width, height] of sizes) {
      const page = pdf.addPage([width, height]);
      page.drawText(`workflow geometry ${width}x${height}`, { x: 16, y: height - 24, size: 10 });
    }
    return new Uint8Array(await pdf.save({ useObjectStreams: false }));
  });

const createCroppedRotatedPdf = (): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 150]);
    page.setCropBox(100, 25, 200, 100);
    page.setRotation(degrees(450));
    return new Uint8Array(await document.save({ useObjectStreams: false }));
  });

const signatureWidgetRects = (
  bytes: Uint8Array,
  pageIndex: number,
): Effect.Effect<ReadonlyArray<readonly [number, number, number, number]>> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPages()[pageIndex];
    if (page === undefined) return [];
    const annotations = page.node.Annots();
    if (annotations === undefined) return [];
    const rects: Array<readonly [number, number, number, number]> = [];
    for (let index = 0; index < annotations.size(); index += 1) {
      const annotation = pdf.context.lookupMaybe(annotations.get(index), PDFDict);
      const subtype = annotation?.lookupMaybe(PDFName.of("Subtype"), PDFName);
      const rect = annotation?.lookupMaybe(PDFName.of("Rect"), PDFArray);
      if (subtype?.toString() === "/Widget" && rect !== undefined) {
        rects.push([
          rect.lookup(0, PDFNumber).asNumber(),
          rect.lookup(1, PDFNumber).asNumber(),
          rect.lookup(2, PDFNumber).asNumber(),
          rect.lookup(3, PDFNumber).asNumber(),
        ]);
      }
    }
    return rects;
  });

const decodedPageContent = (bytes: Uint8Array, pageIndex: number): Effect.Effect<string> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPages()[pageIndex];
    if (page === undefined) return "";
    const contents = page.node.Contents();
    if (contents === undefined) return "";
    const decoder = new TextDecoder();
    if (contents instanceof PDFRawStream) {
      return decoder.decode(decodePDFRawStream(contents).decode());
    }
    if (!(contents instanceof PDFArray)) return "";
    const chunks: string[] = [];
    for (let index = 0; index < contents.size(); index += 1) {
      const stream = contents.lookupMaybe(index, PDFRawStream);
      if (stream !== undefined) {
        chunks.push(decoder.decode(decodePDFRawStream(stream).decode()));
      }
    }
    return chunks.join("\n");
  });

describe("PDF workflow geometry", () => {
  it.effect("uses loaded PDF height for the visible stamp and signature widget", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createPdf([[320, 180]]);
      const rect: PdfSignatureRect = { pageIndex: 0, x: 20, y: 20, width: 100, height: 40 };

      const signed = yield* prepareAndSignPdf({
        pdf,
        pages: [{ index: 0, width: 320, height: 999 }],
        stampRects: [rect],
        lines: ["LOADED-GEOMETRY"],
        signing: { policy: "pades-icp-brasil", reason: "workflow geometry regression" },
      }).pipe(
        Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
        Effect.provide(liteParseWorkerBrowserLayer),
      );

      const verification = yield* verifyPdf({ pdf: signed });
      const widgetRects = yield* signatureWidgetRects(signed, 0);
      const content = yield* decodedPageContent(signed, 0);

      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
      expect(widgetRects).toContainEqual([20, 120, 120, 160]);
      expect(content).toMatch(/1\s+0\s+0\s+1\s+20\s+160\s+cm/);
      expect(content).toMatch(/100\s+40\s+l/);
    }),
  );

  it.effect("prepares and signs a batch with one field rect for the mark and widget", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createPdf([
        [320, 180],
        [320, 180],
      ]);
      const pages: PdfSignaturePage[] = [
        { index: 0, width: 320, height: 180 },
        { index: 1, width: 320, height: 180 },
      ];
      const rect: PdfSignatureRect = { pageIndex: 1, x: 20, y: 20, width: 100, height: 40 };
      const template: PdfSignatureTemplate = {
        id: "batch-template",
        name: "batch.pdf",
        documents: [
          {
            id: "batch-document",
            name: "batch.pdf",
            source: { type: "uploaded" },
            pages,
          },
        ],
        roles: [{ id: "signer", label: "Signer" }],
        fields: [
          {
            id: "signature",
            type: "signature",
            documentId: "batch-document",
            roleId: "signer",
            rect,
          },
        ],
      };

      const preparedResults = yield* preparePdfSigningBatch({
        documents: [
          {
            id: "batch-document",
            pdf,
            template,
            fieldId: "signature",
            rect,
            pageDimensions: pages,
          },
        ],
        stamp: { lines: ["BATCH-GEOMETRY"] },
        signing: { policy: "pades-icp-brasil", reason: "batch geometry regression" },
      });
      const prepared = preparedResults[0];
      expect(prepared?.ok).toBe(true);
      if (prepared?.ok !== true) return;

      const signedResults = yield* signPdfSignatureBatch([prepared.item]).pipe(
        Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
      );
      const signedResult = signedResults[0];
      expect(signedResult?.ok).toBe(true);
      if (signedResult?.ok !== true) return;

      const verification = yield* verifyPdf({ pdf: signedResult.signedPdf });
      const widgetRects = yield* signatureWidgetRects(signedResult.signedPdf, 1);
      const content = yield* decodedPageContent(signedResult.signedPdf, 1);

      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
      expect(widgetRects).toContainEqual([20, 120, 120, 160]);
      expect(content).toMatch(/1\s+0\s+0\s+1\s+20\s+160\s+cm/);
      expect(content).toMatch(/100\s+40\s+l/);
    }),
  );

  it.effect(
    "signs and prepares the physical page ordered by a noncanonical declared identity",
    () =>
      Effect.gen(function* () {
        const pfx = yield* readA1Fixture("ecnpj");
        const pdf = yield* createPdf([
          [320, 180],
          [330, 190],
          [340, 200],
        ]);
        const pages: PdfSignaturePage[] = [
          { index: 17, width: 320, height: 180 },
          { index: 5, width: 330, height: 190 },
          { index: 42, width: 340, height: 200 },
        ];
        const rect: PdfSignatureRect = { pageIndex: 5, x: 20, y: 20, width: 100, height: 40 };
        const template: PdfSignatureTemplate = {
          id: "noncanonical-template",
          name: "noncanonical.pdf",
          documents: [
            {
              id: "noncanonical-document",
              name: "noncanonical.pdf",
              source: { type: "uploaded" },
              pages,
            },
          ],
          roles: [{ id: "signer", label: "Signer" }],
          fields: [
            {
              id: "signature",
              type: "signature",
              documentId: "noncanonical-document",
              roleId: "signer",
              rect,
            },
          ],
        };

        const directlySigned = yield* signPdfSignatureField({
          pdf,
          template,
          fieldId: "signature",
          policy: "pades-icp-brasil",
        }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));

        expect(yield* signatureWidgetRects(directlySigned, 0)).toEqual([]);
        expect(yield* signatureWidgetRects(directlySigned, 1)).toContainEqual([20, 130, 120, 170]);
        expect(yield* signatureWidgetRects(directlySigned, 2)).toEqual([]);

        const stampText = "NONCANONICAL-BATCH";
        const preparedResults = yield* preparePdfSigningBatch({
          documents: [
            {
              id: "noncanonical-document",
              pdf,
              template,
              fieldId: "signature",
              rect,
              pageDimensions: pages,
            },
          ],
          stamp: { lines: [stampText] },
          signing: { policy: "pades-icp-brasil", reason: "noncanonical page identity" },
        });
        const prepared = preparedResults[0];
        expect(prepared?.ok).toBe(true);
        if (prepared?.ok !== true) return;

        const stampHex = Array.from(new TextEncoder().encode(stampText))
          .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
          .join("");
        expect(yield* decodedPageContent(prepared.item.input.pdf, 0)).not.toContain(stampHex);
        expect(yield* decodedPageContent(prepared.item.input.pdf, 1)).toContain(stampHex);
        expect(yield* decodedPageContent(prepared.item.input.pdf, 2)).not.toContain(stampHex);

        const signedResults = yield* signPdfSignatureBatch([prepared.item]).pipe(
          Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
        );
        const signed = signedResults[0];
        expect(signed?.ok).toBe(true);
        if (signed?.ok !== true) return;

        expect(yield* signatureWidgetRects(signed.signedPdf, 0)).toEqual([]);
        expect(yield* signatureWidgetRects(signed.signedPdf, 1)).toContainEqual([
          20, 130, 120, 170,
        ]);
        expect(yield* signatureWidgetRects(signed.signedPdf, 2)).toEqual([]);
      }),
  );

  it.effect("rejects a batch whose visible rect conflicts with its selected template field", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf([
        [320, 180],
        [320, 180],
      ]);
      const pages: PdfSignaturePage[] = [
        { index: 0, width: 320, height: 180 },
        { index: 1, width: 320, height: 180 },
      ];
      const templateRect: PdfSignatureRect = {
        pageIndex: 0,
        x: 20,
        y: 20,
        width: 100,
        height: 40,
      };
      const documentRect: PdfSignatureRect = {
        pageIndex: 1,
        x: 20,
        y: 20,
        width: 100,
        height: 40,
      };
      const template: PdfSignatureTemplate = {
        id: "conflicting-template",
        name: "conflicting.pdf",
        documents: [
          {
            id: "conflicting-document",
            name: "conflicting.pdf",
            source: { type: "uploaded" },
            pages,
          },
        ],
        roles: [{ id: "signer", label: "Signer" }],
        fields: [
          {
            id: "signature",
            type: "signature",
            documentId: "conflicting-document",
            roleId: "signer",
            rect: templateRect,
          },
        ],
      };

      const results = yield* preparePdfSigningBatch({
        documents: [
          {
            id: "conflicting-document",
            pdf,
            template,
            fieldId: "signature",
            rect: documentRect,
            pageDimensions: pages,
          },
        ],
        stamp: { lines: ["CONFLICTING-GEOMETRY"] },
        signing: {},
      });
      const result = results[0];

      expect(result?.ok).toBe(false);
      if (result?.ok === false) {
        expect(result.error.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
      }
    }),
  );
  it.effect("rejects a same-size field owned by another batch document", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf([[320, 180]]);
      const pages: PdfSignaturePage[] = [{ index: 0, width: 320, height: 180 }];
      const rect: PdfSignatureRect = { pageIndex: 0, x: 20, y: 20, width: 100, height: 40 };
      const template: PdfSignatureTemplate = {
        id: "same-size-template",
        name: "same-size.pdf",
        documents: [
          {
            id: "document-a",
            name: "document-a.pdf",
            source: { type: "uploaded" },
            pages,
          },
          {
            id: "document-b",
            name: "document-b.pdf",
            source: { type: "uploaded" },
            pages,
          },
        ],
        roles: [{ id: "signer", label: "Signer" }],
        fields: [
          {
            id: "signature",
            type: "signature",
            documentId: "document-b",
            roleId: "signer",
            rect,
          },
        ],
      };

      const results = yield* preparePdfSigningBatch({
        documents: [
          {
            id: "document-a",
            pdf,
            template,
            fieldId: "signature",
            rect,
            pageDimensions: pages,
          },
        ],
        signing: {},
      });
      const result = results[0];

      expect(result?.ok).toBe(false);
      if (result?.ok === false) {
        expect(result.error.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
      }
    }),
  );
  it.effect("maps a cropped normalized rotation visible mark to the signed widget", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createCroppedRotatedPdf();
      const rect: PdfSignatureRect = { pageIndex: 0, x: 10, y: 150, width: 40, height: 30 };

      const signed = yield* prepareAndSignPdf({
        pdf,
        stampRects: [rect],
        lines: ["CROP-ROTATE"],
        signing: { policy: "pades-icp-brasil", reason: "crop rotation workflow regression" },
      }).pipe(
        Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
        Effect.provide(liteParseWorkerBrowserLayer),
      );

      const verification = yield* verifyPdf({ pdf: signed });
      const widgetRects = yield* signatureWidgetRects(signed, 0);
      const content = yield* decodedPageContent(signed, 0);

      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
      expect(widgetRects).toContainEqual([250, 35, 280, 75]);
      expect(content).toContain("<43524F502D524F54415445> Tj");
    }),
  );
  it.effect("uses visible rotated CropBox dimensions for default workflow placement", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createCroppedRotatedPdf();
      const loaded = yield* loadPdfSignatureDocument({
        id: "crop-default",
        name: "crop-default.pdf",
        pdf,
      });
      const signed = yield* prepareAndSignPdf({
        pdf,
        stampSize: { width: 40, height: 30 },
        lines: ["CROP-DEFAULT"],
        signing: { policy: "pades-icp-brasil", reason: "crop default workflow regression" },
      }).pipe(
        Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
        Effect.provide(liteParseWorkerBrowserLayer),
      );

      const verification = yield* verifyPdf({ pdf: signed });
      const widgetRects = yield* signatureWidgetRects(signed, 0);
      const content = yield* decodedPageContent(signed, 0);

      expect(loaded.pages).toEqual([{ index: 0, width: 100, height: 200 }]);
      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
      expect(widgetRects).toContainEqual([246, 61, 276, 101]);
      expect(content).toContain("<43524F502D44454641554C54> Tj");
    }),
  );

  it.effect("rejects rects beyond the rotated CropBox visible width", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createCroppedRotatedPdf();
      const result = yield* Effect.result(
        prepareAndSignPdf({
          pdf,
          stampRects: [{ pageIndex: 0, x: 80, y: 20, width: 30, height: 30 }],
          lines: ["OUTSIDE-CROP"],
          signing: { policy: "pades-icp-brasil", reason: "crop bounds workflow regression" },
        }).pipe(
          Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
          Effect.provide(liteParseWorkerBrowserLayer),
        ),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.fieldOutOfBounds);
      }
    }),
  );

  it.effect("keeps a cropped rotated batch mark and widget coherent", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createCroppedRotatedPdf();
      const pages: PdfSignaturePage[] = [{ index: 0, width: 100, height: 200 }];
      const rect: PdfSignatureRect = { pageIndex: 0, x: 10, y: 150, width: 40, height: 30 };
      const template: PdfSignatureTemplate = {
        id: "crop-batch-template",
        name: "crop-batch.pdf",
        documents: [
          {
            id: "crop-batch-document",
            name: "crop-batch.pdf",
            source: { type: "uploaded" },
            pages,
          },
        ],
        roles: [{ id: "signer", label: "Signer" }],
        fields: [
          {
            id: "signature",
            type: "signature",
            documentId: "crop-batch-document",
            roleId: "signer",
            rect,
          },
        ],
      };

      const preparedResults = yield* preparePdfSigningBatch({
        documents: [
          {
            id: "crop-batch-document",
            pdf,
            template,
            fieldId: "signature",
            rect,
            pageDimensions: pages,
          },
        ],
        stamp: { lines: ["BATCH-CROP-ROTATE"] },
        signing: { policy: "pades-icp-brasil", reason: "crop batch workflow regression" },
      });
      const prepared = preparedResults[0];
      expect(prepared?.ok).toBe(true);
      if (prepared?.ok !== true) return;

      const signedResults = yield* signPdfSignatureBatch([prepared.item]).pipe(
        Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
      );
      const signedResult = signedResults[0];
      expect(signedResult?.ok).toBe(true);
      if (signedResult?.ok !== true) return;

      const verification = yield* verifyPdf({ pdf: signedResult.signedPdf });
      const widgetRects = yield* signatureWidgetRects(signedResult.signedPdf, 0);
      const content = yield* decodedPageContent(signedResult.signedPdf, 0);

      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
      expect(widgetRects).toContainEqual([250, 35, 280, 75]);
      expect(content).toContain("<42415443482D43524F502D524F54415445> Tj");
    }),
  );
  it.effect("rejects a standalone field outside the actual visible page", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createPdf([[100, 100]]);
      const template: PdfSignatureTemplate = {
        id: "standalone-template",
        name: "standalone.pdf",
        documents: [
          {
            id: "standalone-document",
            name: "standalone.pdf",
            source: { type: "uploaded" },
            pages: [{ index: 0, width: 400, height: 400 }],
          },
        ],
        roles: [{ id: "signer", label: "Signer" }],
        fields: [
          {
            id: "signature",
            type: "signature",
            documentId: "standalone-document",
            roleId: "signer",
            rect: { pageIndex: 0, x: 250, y: 250, width: 100, height: 100 },
          },
        ],
      };

      const result = yield* Effect.result(
        signPdfSignatureField({
          pdf,
          template,
          fieldId: "signature",
          policy: "pades-icp-brasil",
        }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD }))),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.fieldOutOfBounds);
      }
    }),
  );
});
