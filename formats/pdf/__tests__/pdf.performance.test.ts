import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "@effect/vitest";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { Effect, Redacted } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { signPdf } from "../src/sign";
import { stampPdfRubric } from "../src/stamp";
import { verifyPdf } from "../src/verify";
import type { PdfCoordinateTuple } from "../src/config";

const PASSWORD = Redacted.make("changeit");
const RUBRIC_RECT: PdfCoordinateTuple = [24, 24, 172, 68];

const createMultiPagePdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 8; index++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`SignatureKit performance page ${index + 1}`, { x: 72, y: 720, size: 14 });
    page.drawText("Body text keeps the generated PDF close to a real document path.", {
      x: 72,
      y: 680,
      size: 10,
    });
  }
  return pdf.save({ useObjectStreams: false });
});

const millisecondsSince = (startedAt: number): number => performance.now() - startedAt;

describe("PDF workflow performance", () => {
  it.effect("keeps multi-page rubrica plus A1 signing inside an app-request budget", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecpf");
      const pdf = yield* createMultiPagePdf;
      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });

      const startedAt = performance.now();
      const stamped = yield* stampPdfRubric(pdf, {
        rect: RUBRIC_RECT,
        pages: "all",
        lines: ["SIGNATUREKIT PERFORMANCE", "CPF/CNPJ: 12345678901", "2026-07-01"],
      });
      const signed = yield* signPdf({
        pdf: stamped,
        reason: "SignatureKit PDF performance regression test",
        name: "Performance CPF:12345678901",
        location: "BR",
        signatureLength: 16384,
      }).pipe(Effect.provide(layer));
      const verification = yield* verifyPdf({ pdf: signed });
      const elapsedMillis = millisecondsSince(startedAt);

      expect(stamped.byteLength).toBeGreaterThan(pdf.byteLength);
      expect(signed.byteLength).toBeGreaterThan(stamped.byteLength);
      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
      expect(elapsedMillis).toBeLessThan(8_000);
    }),
  );
});
