import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import {
  addPdfSignatureField,
  createPdfSignatureBuilderStateFromTemplate,
  createPdfSignatureTemplate,
  pdfSignatureFieldFromPlacement,
  pdfSignatureAppearanceFromField,
  placePdfSignatureField,
  validatePdfSignatureTemplate,
} from "@signature-kit/pdf/builder";
import {
  createPdfSignatureBuilderStateFromBytes,
  createPdfSignatureTemplateFromBytes,
  loadPdfSignatureDocument,
  readPdfBlobBytes,
  signPdfSignatureBatch,
} from "@signature-kit/pdf/workflow";
import {
  PdfSigningInputSchema,
  PdfErrorCodeValue,
  PdfSignatureFieldTypeSchema,
  type PdfSignatureTemplate,
  type PdfSignatureTemplateInput,
} from "@signature-kit/pdf/config";
import { signaturesLayer } from "@signature-kit/core/signatures";
import type { SignerAdapter } from "@signature-kit/core/config";

/**
 * A Signatures layer whose adapter methods all die — used to prove the batch
 * signer's ORCHESTRATION (order, per-item failure capture, progress) without
 * real crypto. The batch items below fail at appearance lookup (unknown field)
 * before any adapter method is reached, so `die` is never triggered.
 */
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
        policyTimeoutMillis: 10_000,
        timestamp: { tsaUrl: "https://tsa.example.test", timeoutMillis: 10_000 },
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
      const document = yield* loadPdfSignatureDocument({
        id: "uploaded",
        name: "uploaded.pdf",
        pdf: bytes,
      });

      expect(bytes.byteLength).toBe(pdf.byteLength);
      expect(document.source.type).toBe("uploaded");
      expect(document.source.bytes).toBeUndefined();
      expect(document.pages).toEqual([{ index: 0, width: 320, height: 180, label: "Página 1" }]);
      const template = yield* createPdfSignatureTemplateFromBytes({
        id: "browser-template",
        name: "PDF signature",
        documentId: "uploaded",
        documentName: "uploaded.pdf",
        pdf,
        role: { id: "signer-1", label: "Cliente", email: "ana@example.com", required: true },
      });

      expect(template.documents[0]?.pages).toEqual([
        { index: 0, width: 320, height: 180, label: "Página 1" },
      ]);
      expect(template.documents[0]?.source.bytes).toBeUndefined();
      const state = yield* createPdfSignatureBuilderStateFromBytes({
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
      });

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
      // Unknown field -> each item fails at appearance lookup (before the signer),
      // so the batch must still return one ordered result per input and never abort.
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
