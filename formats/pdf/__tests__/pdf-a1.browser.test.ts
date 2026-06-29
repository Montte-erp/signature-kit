import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { a1SignaturesLayer, parseA1CertificateProfile } from "@signature-kit/a1/signer";
import {
  addPdfSignatureField,
  createPdfSignatureTemplate,
  pdfSignatureFieldFromPlacement,
} from "@signature-kit/pdf/builder";
import { signPdfSignatureField } from "@signature-kit/pdf/workflow";
import { Effect, Redacted } from "effect";

const PASSWORD = Redacted.make("changeit");
const latin1 = new TextDecoder("latin1");

const readA1FixtureFromBrowser = (name: "ecpf" | "ecnpj"): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const fixtureUrl = new URL(
      `../../../signers/a1/__tests__/fixtures/${name}.p12`,
      import.meta.url,
    );
    const response = await fetch(fixtureUrl);
    expect(response.ok).toBe(true);
    return new Uint8Array(await response.arrayBuffer());
  });

const createPdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  page.drawText("SignatureKit PDF signing", { x: 32, y: 118, size: 14 });
  return pdf.save({ useObjectStreams: false });
});

const createTemplate = () =>
  createPdfSignatureTemplate({
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

if (typeof document === "undefined") {
  describe.skip("PDF signing package", () => {
    it("runs only through `bun run test:integration:browser`", () => {});
  });
} else {
  describe("PDF signing package", () => {
    it("loads an A1 certificate and signs a PDF in Chromium", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const pfx = yield* readA1FixtureFromBrowser("ecpf");
          const pdf = yield* createPdf;
          const profile = yield* parseA1CertificateProfile({ pfx, password: PASSWORD });
          const template = yield* createTemplate();
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
            reason: "Chromium browser A1 test",
            name: "Pessoa CPF:12345678901",
            location: "BR",
            signatureLength: 16384,
          }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
          const text = latin1.decode(signed);

          expect(profile.document).toBe("12345678901");
          expect(signed.byteLength).toBeGreaterThan(pdf.byteLength);
          expect(text).toContain("/ByteRange");
          expect(text).toContain("/SubFilter /adbe.pkcs7.detached");
          expect(text).toContain("Chromium browser A1 test");
        }),
      ));
  });
}
