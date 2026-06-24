import { describe, expect, it } from "@effect/vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { Effect, Redacted, Result, Schema } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signPdf } from "@signature-kit/pdf/sign";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { extractPdfSignature } from "../src/byte-range";
import { indexOfBytes } from "../src/bytes";
import { PdfSigningRequestSchema } from "../src/config";

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

const createPdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  page.drawText("SignatureKit PDF payload", { x: 40, y: 120, size: 16 });
  return pdf.save({ useObjectStreams: false });
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

      expect(Result.isFailure(invalidPdf)).toBe(true);
      if (Result.isFailure(invalidPdf)) {
        expect(invalidPdf.failure.code).toBe("pdf.INVALID_PDF");
      }
      expect(Result.isFailure(missingPage)).toBe(true);
      if (Result.isFailure(missingPage)) {
        expect(missingPage.failure.code).toBe("pdf.INVALID_PDF");
      }
    }),
  );
});
