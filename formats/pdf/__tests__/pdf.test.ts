import { describe, expect, it } from "@effect/vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { Effect, Redacted } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { a1SignaturesLayer } from "@signature-kit/a1";
import { signPdf, verifyPdf } from "@signature-kit/pdf";
import { extractPdfSignature } from "../src/byte-range";
import { indexOfBytes } from "../src/bytes";

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
});
