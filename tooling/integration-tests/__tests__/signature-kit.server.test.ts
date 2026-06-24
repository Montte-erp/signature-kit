import { describe, expect, it } from "@effect/vitest";
import {
  a1SignaturesLayer,
  loadA1SignatureKit,
  parseA1CertificateProfile,
} from "@signature-kit/a1/signer";
import { signPdf } from "@signature-kit/pdf/sign";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { signXml } from "@signature-kit/xml/sign";
import { verifyXml } from "@signature-kit/xml/verify";
import { Effect, Redacted } from "effect";
import { readA1Fixture } from "../../testing/fixtures";

const PASSWORD = Redacted.make("changeit");
const textEncoder = new TextEncoder();

const SERVER_PDF_BASE64 =
  "JVBERi0xLjcKJYGBgYEKCjEgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgNCAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iagoKMyAwIG9iago8PAovUHJvZHVjZXIgPEZFRkYwMDcwMDA2NDAwNjYwMDJEMDA2QzAwNjkwMDYyMDAyMDAwMjgwMDY4MDA3NDAwNzQwMDcwMDA3MzAwM0EwMDJGMDAyRjAwNjcwMDY5MDA3NDAwNjgwMDc1MDA2MjAwMkUwMDYzMDA2RjAwNkQwMDJGMDA0ODAwNkYwMDcwMDA2NDAwNjkwMDZFMDA2NzAwMkYwMDcwMDA2NDAwNjYwMDJEMDA2QzAwNjkwMDYyMDAyOT4KL01vZERhdGUgKEQ6MjAyNjA2MjMxMjA4MzVaKQovQ3JlYXRvciA8RkVGRjAwNzAwMDY0MDA2NjAwMkQwMDZDMDA2OTAwNjIwMDIwMDAyODAwNjgwMDc0MDA3NDAwNzAwMDczMDAzQTAwMkYwMDJGMDA2NzAwNjkwMDc0MDA2ODAwNzUwMDYyMDAyRTAwNjMwMDZGMDA2RDAwMkYwMDQ4MDA2RjAwNzAwMDY0MDA2OTAwNkUwMDY3MDAyRjAwNzAwMDY0MDA2NjAwMkQwMDZDMDA2OTAwNjIwMDI5PgovQ3JlYXRpb25EYXRlIChEOjIwMjYwNjIzMTIwODM1WikKPj4KZW5kb2JqCgo0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9QYXJlbnQgMSAwIFIKL1Jlc291cmNlcyA8PAovRm9udCA8PAovSGVsdmV0aWNhLTcwOTg0ODA3ODkgNSAwIFIKPj4KL1hPYmplY3QgPDwKPj4KL0V4dEdTdGF0ZSA8PAo+Pgo+PgovTWVkaWFCb3ggWyAwIDAgMzYwIDE4MCBdCi9Bbm5vdHMgWyBdCi9Db250ZW50cyBbIDYgMCBSIF0KPj4KZW5kb2JqCgo1IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQovRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZwo+PgplbmRvYmoKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCAxMjgKPj4Kc3RyZWFtCnicHYtBCgJBDATveUXOgpjJZjozIB4WRjx4EfIBkVWU9aCI73dWGgoKql80Bgkve99oc5jm7/S5X85rl1qsiJfKCRxXUuM4Uvqnia1DheNJ2zygwtGQ3Dy7ItuI6qbiA7o7FqpkMTOo9Lq5IcN72z/d92g7jgfFilrQiX7lxSCOCmVuZHN0cmVhbQplbmRvYmoKCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNiAwMDAwMCBuIAowMDAwMDAwMDc2IDAwMDAwIG4gCjAwMDAwMDAxMjYgMDAwMDAgbiAKMDAwMDAwMDU5NiAwMDAwMCBuIAowMDAwMDAwNzkxIDAwMDAwIG4gCjAwMDAwMDA4ODkgMDAwMDAgbiAKCnRyYWlsZXIKPDwKL1NpemUgNwovUm9vdCAyIDAgUgovSW5mbyAzIDAgUgo+PgoKc3RhcnR4cmVmCjEwOTAKJSVFT0Y=";

const serverPdf = (): Uint8Array => Buffer.from(SERVER_PDF_BASE64, "base64");

describe("SignatureKit server integration", () => {
  it.effect("uses one A1 certificate through bytes, XML, and PDF public seams", () =>
    Effect.gen(function* () {
      expect(typeof document).toBe("undefined");

      const pfx = yield* readA1Fixture("ecpf");
      const profile = yield* parseA1CertificateProfile({ pfx, password: PASSWORD });
      expect(profile.document).toBe("12345678901");
      expect(profile.subject.length).toBeGreaterThan(0);
      expect(profile.daysUntilExpiry).toBeGreaterThan(0);

      const signatureKit = yield* loadA1SignatureKit({ pfx, password: PASSWORD });
      const content = textEncoder.encode("SignatureKit server integration payload");
      const artifact = yield* signatureKit.signatures.sign({ content, algorithm: "rsa-sha256" });
      const verification = yield* signatureKit.signatures.verify({
        content,
        signature: artifact.signature,
        algorithm: artifact.algorithm,
      });
      expect(verification.valid).toBe(true);

      const layer = a1SignaturesLayer({ pfx, password: PASSWORD });
      const signedXml = yield* signXml({
        xml: '<invoice Id="server-invoice"><amount>100.00</amount></invoice>',
        referenceId: "server-invoice",
      }).pipe(Effect.provide(layer));
      const xmlVerification = yield* verifyXml({
        xml: signedXml,
        requireReferenceUri: "#server-invoice",
      });
      expect(xmlVerification.valid).toBe(true);

      const pdf = serverPdf();
      const signedPdf = yield* signPdf({
        pdf,
        reason: "Server integration signature",
        contactInfo: profile.document,
        name: profile.subject,
        location: "Brasil",
        signatureLength: 16384,
      }).pipe(Effect.provide(layer));
      const pdfVerification = yield* verifyPdf({ pdf: signedPdf });
      expect(pdfVerification.valid).toBe(true);
      expect(pdfVerification.signatureCount).toBe(1);
    }),
  );
});
