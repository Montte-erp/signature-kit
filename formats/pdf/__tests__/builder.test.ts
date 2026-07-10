import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import {
  autoPlacePdfSignatureField,
  addPdfSignatureField,
  createPdfSignatureBuilderStateFromTemplate,
  createPdfSignatureTemplate,
  pdfSignatureFieldFromPlacement,
  pdfSignatureAppearanceFromField,
  placePdfSignatureField,
  validatePdfSignatureTemplate,
} from "../src/builder";
import {
  createPdfSignatureBuilderStateFromBytes,
  createPdfSignatureTemplateFromBytes,
  loadPdfSignatureDocument,
  readPdfBlobBytes,
  signPdfSignatureBatch,
} from "../src/workflow";
import {
  PdfSigningInputSchema,
  PdfErrorCodeValue,
  PdfSignatureFieldTypeSchema,
} from "../src/config";
import type { PdfSignatureTemplate, PdfSignatureTemplateInput } from "../src/config";
import { signaturesLayer } from "@signature-kit/signatures";
import type { SignerAdapter } from "@signature-kit/signatures";

const stubSigner: SignerAdapter = {
  id: "stub",
  inspect: () => Effect.die("stub signer should not be called"),
  certificate: () => Effect.die("stub signer should not be called"),
  importSigningKey: () => Effect.die("stub signer should not be called"),
  sign: () => Effect.die("stub signer should not be called"),
  verify: () => Effect.die("stub signer should not be called"),
};

const createPdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  page.drawText("SignatureKit browser React payload", { x: 32, y: 118, size: 14 });
  const bytes = await pdf.save({ useObjectStreams: false });
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
});

const templateInput = (): PdfSignatureTemplateInput => ({
  id: "template-1",
  name: "Onboarding agreement",
  documents: [
    {
      id: "document-1",
      name: "agreement.pdf",
      source: { type: "uploaded" },
      pages: [{ index: 0, width: 612, height: 792, label: "Agreement" }],
    },
  ],
  roles: [{ id: "signer-1", label: "Customer", email: "customer@example.com", required: true }],
});

const templateWithOutOfBoundsField = (): PdfSignatureTemplate => ({
  id: "template-1",
  name: "Onboarding agreement",
  documents: [
    {
      id: "document-1",
      name: "agreement.pdf",
      source: { type: "uploaded" },
      pages: [{ index: 0, width: 612, height: 792, label: "Agreement" }],
    },
  ],
  roles: [{ id: "signer-1", label: "Customer", email: "customer@example.com", required: true }],
  fields: [
    {
      id: "signature-1",
      type: "signature",
      documentId: "document-1",
      roleId: "signer-1",
      rect: { pageIndex: 0, x: 580, y: 684, width: 144, height: 36 },
    },
  ],
});

describe("PDF signature builder", () => {
  it.effect("builds a signature template and PDF signing appearance", () =>
    Effect.gen(function* () {
      const template = yield* createPdfSignatureTemplate(templateInput());
      const field = yield* pdfSignatureFieldFromPlacement({
        documentId: "document-1",
        pageIndex: 0,
        x: 72,
        y: 684,
        draft: {
          id: "signature-1",
          type: "signature",
          roleId: "signer-1",
          width: 144,
          height: 36,
          label: "Assinatura",
          required: true,
        },
      });
      const withField = yield* addPdfSignatureField(template, field);
      const appearance = yield* pdfSignatureAppearanceFromField(withField, "signature-1");

      expect(withField.fields).toHaveLength(1);
      expect(appearance).toEqual({ pageIndex: 0, widgetRect: [72, 72, 216, 108] });
    }),
  );

  it.effect("creates a validated builder state from template input", () =>
    Effect.gen(function* () {
      const state = yield* createPdfSignatureBuilderStateFromTemplate({
        template: {
          ...templateInput(),
          fields: [
            {
              id: "signature-1",
              type: "signature",
              documentId: "document-1",
              roleId: "signer-1",
              rect: { pageIndex: 0, x: 72, y: 684, width: 144, height: 36 },
              label: "Assinatura",
            },
          ],
        },
        selectedFieldId: "signature-1",
        draft: {
          id: "signature-2",
          type: "signature",
          roleId: "signer-1",
          width: 144,
          height: 36,
        },
      });

      expect(state.selectedFieldId).toBe("signature-1");
      expect(state.draft?.id).toBe("signature-2");
    }),
  );

  it.effect("validates PDF signing options with timestamping", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf;
      const template = yield* createPdfSignatureTemplate(templateInput());
      const field = yield* pdfSignatureFieldFromPlacement({
        documentId: "document-1",
        pageIndex: 0,
        x: 72,
        y: 684,
        draft: {
          id: "signature-1",
          type: "signature",
          roleId: "signer-1",
          width: 144,
          height: 36,
        },
      });
      const withField = yield* addPdfSignatureField(template, field);
      const decoded = yield* Schema.decodeUnknownEffect(PdfSigningInputSchema)({
        pdf,
        template: withField,
        fieldId: "signature-1",
        reason: "Licitei A1 browser signing",
        hashAlgorithm: "sha256",
        policy: "pades-icp-brasil",
        timestamp: {
          tsaUrl: "https://tsa.example.test",
          trustedRoots: [new Uint8Array([0x01])],
          timeoutMillis: 10_000,
        },
      });

      expect(decoded.policy).toBe("pades-icp-brasil");
      expect(decoded.timestamp?.tsaUrl).toBe("https://tsa.example.test");
    }),
  );

  it.effect("centers and clamps pointer placement against the target page", () =>
    Effect.gen(function* () {
      const template = yield* createPdfSignatureTemplate(templateInput());
      const placed = yield* placePdfSignatureField(template, {
        documentId: "document-1",
        pageIndex: 0,
        x: 5,
        y: 5,
        anchor: "center",
        draft: {
          id: "signature-1",
          type: "signature",
          roleId: "signer-1",
          width: 144,
          height: 36,
          label: "Assinatura",
        },
      });

      expect(placed.fields[0]?.rect).toEqual({
        pageIndex: 0,
        x: 0,
        y: 0,
        width: 144,
        height: 36,
      });
    }),
  );

  it.effect(
    "clamps finite negative pointer coordinates and rejects invalid numeric placement input",
    () =>
      Effect.gen(function* () {
        const template = yield* createPdfSignatureTemplate(templateInput());
        const clamped = yield* placePdfSignatureField(template, {
          documentId: "document-1",
          pageIndex: 0,
          x: -12,
          y: -8,
          draft: {
            id: "negative-pointer",
            type: "signature",
            roleId: "signer-1",
            width: 144,
            height: 36,
          },
        });

        expect(clamped.fields[0]?.rect).toMatchObject({ x: 0, y: 0 });

        const invalidManualPlacements = [
          { pageIndex: -1, x: 0, y: 0, width: 144, height: 36 },
          { pageIndex: 0.5, x: 0, y: 0, width: 144, height: 36 },
          { pageIndex: 0, x: Number.POSITIVE_INFINITY, y: 0, width: 144, height: 36 },
          { pageIndex: 0, x: 0, y: Number.NaN, width: 144, height: 36 },
          { pageIndex: 0, x: 0, y: 0, width: 0, height: 36 },
          { pageIndex: 0, x: 0, y: 0, width: 144, height: -1 },
        ];
        for (const placement of invalidManualPlacements) {
          const result = yield* Effect.result(
            pdfSignatureFieldFromPlacement({
              documentId: "document-1",
              pageIndex: placement.pageIndex,
              x: placement.x,
              y: placement.y,
              draft: {
                id: "invalid-manual",
                type: "signature",
                roleId: "signer-1",
                width: placement.width,
                height: placement.height,
              },
            }),
          );

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
          }
        }

        const invalidAutoPlacements = [
          { pageIndex: -1, margin: 0, gap: 0 },
          { pageIndex: 0.5, margin: 0, gap: 0 },
          { pageIndex: 0, margin: -1, gap: 0 },
          { pageIndex: 0, margin: Number.NaN, gap: 0 },
          { pageIndex: 0, margin: 0, gap: -1 },
          { pageIndex: 0, margin: 0, gap: Number.POSITIVE_INFINITY },
        ];
        for (const placement of invalidAutoPlacements) {
          const result = yield* Effect.result(
            autoPlacePdfSignatureField(template, {
              documentId: "document-1",
              pageIndex: placement.pageIndex,
              slot: "top-left",
              margin: placement.margin,
              gap: placement.gap,
              draft: {
                id: "invalid-auto",
                type: "signature",
                roleId: "signer-1",
                width: 144,
                height: 36,
              },
            }),
          );

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
          }
        }
      }),
  );

  it.effect("rejects fields outside the declared page", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        validatePdfSignatureTemplate(templateWithOutOfBoundsField()),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.fieldOutOfBounds);
      }
    }),
  );

  it.effect("rejects non-signature field types", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        Schema.decodeUnknownEffect(PdfSignatureFieldTypeSchema)("text"),
      );

      expect(Result.isFailure(result)).toBe(true);
    }),
  );

  it.effect("loads uploaded PDFs into builder page geometry", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf;
      const blobBuffer = new ArrayBuffer(pdf.byteLength);
      new Uint8Array(blobBuffer).set(pdf);
      const bytes = yield* readPdfBlobBytes(new Blob([blobBuffer], { type: "application/pdf" }));
      const document = yield* loadPdfSignatureDocument(
        {
          id: "uploaded",
          name: "uploaded.pdf",
          pdf: bytes,
        },
        { pageLabel: (page) => `Page ${page}` },
      );

      expect(bytes.byteLength).toBe(pdf.byteLength);
      expect(document.source.type).toBe("uploaded");
      expect(document.source.bytes).toBeUndefined();
      expect(document.pages).toEqual([{ index: 0, width: 320, height: 180, label: "Page 1" }]);
      const template = yield* createPdfSignatureTemplateFromBytes(
        {
          id: "browser-template",
          name: "PDF signature",
          documentId: "uploaded",
          documentName: "uploaded.pdf",
          pdf,
          role: { id: "signer-1", label: "Cliente", email: "ana@example.com", required: true },
        },
        { pageLabel: (page) => `Page ${page}` },
      );

      expect(template.documents[0]?.pages).toEqual([
        { index: 0, width: 320, height: 180, label: "Page 1" },
      ]);
      expect(template.documents[0]?.source.bytes).toBeUndefined();
      const state = yield* createPdfSignatureBuilderStateFromBytes(
        {
          id: "browser-builder-state",
          name: "PDF builder state",
          documentId: "uploaded",
          documentName: "uploaded.pdf",
          pdf,
          role: { id: "signer-1", label: "Cliente", email: "ana@example.com", required: true },
          draft: {
            id: "signature-1",
            type: "signature",
            roleId: "signer-1",
            width: 120,
            height: 32,
          },
          placement: { pageIndex: 0, x: 100, y: 110, anchor: "center" },
        },
        { pageLabel: (page) => `Page ${page}` },
      );

      expect(state.selectedFieldId).toBe("signature-1");
      expect(state.draft?.id).toBe("signature-1");
      expect(state.template.fields[0]?.rect).toEqual({
        pageIndex: 0,
        x: 40,
        y: 94,
        width: 120,
        height: 32,
      });
      expect(state.template.documents[0]?.source.bytes).toBeUndefined();

      const explicitDocument = yield* loadPdfSignatureDocument({
        id: "uploaded-with-bytes",
        name: "uploaded-with-bytes.pdf",
        pdf: bytes,
        source: { type: "uploaded", bytes },
      });
      expect(explicitDocument.source.bytes?.byteLength).toBe(pdf.byteLength);
    }),
  );

  it.effect("auto-places PDF builder signatures", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf;
      const state = yield* createPdfSignatureBuilderStateFromBytes({
        id: "browser-auto-builder-state",
        name: "PDF auto builder state",
        documentId: "uploaded",
        documentName: "uploaded.pdf",
        pdf,
        role: { id: "signer-1", label: "Cliente", email: "ana@example.com", required: true },
        draft: {
          id: "signature-1",
          type: "signature",
          roleId: "signer-1",
          width: 120,
          height: 32,
        },
        autoPlacement: { pageIndex: 0, slot: "bottom-right", margin: 16 },
      });

      expect(state.selectedFieldId).toBe("signature-1");
      expect(state.template.fields[0]?.rect).toEqual({
        pageIndex: 0,
        x: 184,
        y: 132,
        width: 120,
        height: 32,
      });

      const ambiguous = yield* Effect.result(
        createPdfSignatureBuilderStateFromBytes({
          id: "browser-ambiguous-builder-state",
          name: "PDF ambiguous builder state",
          documentId: "uploaded",
          documentName: "uploaded.pdf",
          pdf,
          role: { id: "signer-1", label: "Cliente", email: "ana@example.com", required: true },
          draft: {
            id: "signature-2",
            type: "signature",
            roleId: "signer-1",
            width: 120,
            height: 32,
          },
          placement: { pageIndex: 0, x: 100, y: 110, anchor: "center" },
          autoPlacement: { pageIndex: 0, slot: "bottom-right", margin: 16 },
        }),
      );
      expect(Result.isFailure(ambiguous)).toBe(true);
      if (Result.isFailure(ambiguous)) {
        expect(ambiguous.failure.code).toBe(PdfErrorCodeValue.invalidBuilderInput);
      }
    }),
  );

  it.effect("signs a batch of PDFs sequentially and captures per-item failures", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf;
      const template = yield* createPdfSignatureTemplateFromBytes({
        id: "browser-template",
        name: "PDF signature",
        documentId: "uploaded",
        documentName: "uploaded.pdf",
        pdf,
        role: { id: "signer-1", label: "Cliente", email: "ana@example.com", required: true },
      });
      const settled: Array<{ id: string; index: number; total: number; ok: boolean }> = [];
      const input = { pdf, template, fieldId: "missing-field", reason: "Batch test" };
      const results = yield* signPdfSignatureBatch(
        [
          { id: "a.pdf", input },
          { id: "b.pdf", input },
        ],
        {
          onItemSettled: (result, index, total) =>
            settled.push({ id: result.id, index, total, ok: result.ok }),
        },
      ).pipe(Effect.provide(signaturesLayer(stubSigner)));

      expect(results.map((result) => result.id)).toEqual(["a.pdf", "b.pdf"]);
      expect(results.every((result) => !result.ok)).toBe(true);
      expect(settled).toEqual([
        { id: "a.pdf", index: 0, total: 2, ok: false },
        { id: "b.pdf", index: 1, total: 2, ok: false },
      ]);
      for (const result of results) {
        if (!result.ok) {
          expect(result.error.code).toBe(PdfErrorCodeValue.unknownField);
        }
      }
    }),
  );
});
