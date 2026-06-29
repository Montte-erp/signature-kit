import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { signPdfSignatureField } from "@signature-kit/pdf/workflow";
import {
  addPdfSignatureField,
  createPdfSignatureTemplate,
  pdfSignatureFieldFromPlacement,
} from "@signature-kit/pdf/builder";
import { Effect, Redacted } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";

const PASSWORD = Redacted.make("changeit");

const createPdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  page.drawText("SignatureKit PDF Node signing", { x: 32, y: 118, size: 14 });
  return pdf.save({ useObjectStreams: false });
});

describe("PDF signing", () => {
  it.effect("signs and verifies the package PDF flow", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf;
      const pfx = yield* readA1Fixture("ecpf");
      const template = yield* createPdfSignatureTemplate({
        id: "browser-template",
        name: "Browser A1 template",
        documents: [
          {
            id: "uploaded",
            name: "uploaded.pdf",
            source: { type: "uploaded" },
            pages: [{ index: 0, width: 320, height: 180, label: "Página 1" }],
          },
        ],
        roles: [{ id: "signer-1", label: "Cliente", email: "ana@example.com", required: true }],
      });
      const field = yield* pdfSignatureFieldFromPlacement({
        documentId: "uploaded",
        pageIndex: 0,
        x: 40,
        y: 110,
        draft: {
          id: "signature-1",
          type: "signature",
          roleId: "signer-1",
          width: 120,
          height: 32,
          label: "Assinatura A1",
          required: true,
        },
      });
      const withField = yield* addPdfSignatureField(template, field);
      const signed = yield* signPdfSignatureField({
        pdf,
        template: withField,
        fieldId: "signature-1",
        reason: "PDF demo Node verification",
        name: "Pessoa CPF:12345678901",
        location: "BR",
        signatureLength: 16384,
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
      const verification = yield* verifyPdf({ pdf: signed });

      expect(signed.byteLength).toBeGreaterThan(pdf.byteLength);
      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
    }),
  );
});
