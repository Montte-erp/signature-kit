import { describe, expect, it, afterEach } from "vitest";
import { Effect } from "effect";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { clearA1Certificate, clearA1Signer, signA1Documents } from "../src/a1";

const CERTIFICATE_PASSWORD = "changeit";

const createPdf = async (): Promise<Uint8Array> => {
  const source = [
    "%PDF-1.4",
    "%\xE2\xE3\xCF\xD3",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "5 0 obj << /Length 15 >> stream",
    "BT /F1 24 Tf ET",
    "endstream",
    "endobj",
    "xref",
    "0 6",
    "0000000000 65535 f ",
    "0000000010 00000 n ",
    "0000000071 00000 n ",
    "0000000131 00000 n ",
    "0000000256 00000 n ",
    "0000000321 00000 n ",
    "trailer << /Size 6 /Root 1 0 R >>",
    "startxref",
    "402",
    "%%EOF",
  ];

  return Promise.resolve(new TextEncoder().encode(source.join("\n")));
};

describe("@signature-kit/react/a1 actions", () => {
  afterEach(() => {
    clearA1Certificate();
    clearA1Signer();
  });

  it("rejects an empty signer batch at the public action boundary", async () => {
    const pfx = await Effect.runPromise(readA1Fixture("ecpf"));
    const outcome = await Reflect.apply(signA1Documents, undefined, [
      { documents: [], credentials: { pfx, password: CERTIFICATE_PASSWORD }, signing: {} },
    ]);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(SignatureKitErrorCodeValue.invalidInput);
    }
  });

  it("rejects duplicate signer document ids at the public action boundary", async () => {
    const pfx = await Effect.runPromise(readA1Fixture("ecpf"));
    const outcome = await signA1Documents({
      documents: [
        { id: "duplicate", pdf: await createPdf() },
        { id: "duplicate", pdf: await createPdf() },
      ],
      signing: {},
      credentials: { pfx, password: CERTIFICATE_PASSWORD },
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(SignatureKitErrorCodeValue.invalidInput);
    }
  });
});
