import { describe, expect, it, afterEach } from "vitest";
import { Effect } from "effect";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import {
  clearA1Certificate,
  clearA1Signer,
  getLoadedA1CertificateProfile,
  loadA1Certificate,
  signA1Documents,
} from "../src/a1";
import type { A1SignerInput, A1SignerSignedRow } from "../src/config";

const CERTIFICATE_PASSWORD = "changeit";
const WRONG_PASSWORD = "wrong-password";

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

const makeDocuments = async (prefix: string): Promise<A1SignerInput["documents"]> => {
  const firstPdf = await createPdf();
  const secondPdf = await createPdf();

  return [
    { id: `${prefix}-1`, name: `${prefix}-1`, pdf: firstPdf },
    { id: `${prefix}-2`, name: `${prefix}-2`, pdf: secondPdf },
  ];
};

describe("@signature-kit/react/a1 actions", () => {
  afterEach(() => {
    clearA1Certificate();
    clearA1Signer();
  });

  it("loads an A1 certificate and exposes a ready profile", async () => {
    const pfx = await Effect.runPromise(readA1Fixture("ecpf"));

    const outcome = await loadA1Certificate(pfx, CERTIFICATE_PASSWORD);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.profile.document).toBe("12345678901");

    const profile = getLoadedA1CertificateProfile();
    expect(profile).not.toBeNull();
    expect(profile?.fingerprint).toBe(outcome.profile.fingerprint);
    expect(profile?.document).toBe(outcome.profile.document);
  });

  it("keeps wrong certificate password in a typed SignatureKitError", async () => {
    const pfx = await Effect.runPromise(readA1Fixture("ecpf"));

    const outcome = await loadA1Certificate(pfx, WRONG_PASSWORD);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(SignatureKitErrorCodeValue.wrongPassword);
      expect(outcome.error.message).toBe("Wrong certificate password.");
    }
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

  it("signs two PDFs in input order and verifies both outputs", async () => {
    const pfx = await Effect.runPromise(readA1Fixture("ecpf"));
    const documents: A1SignerInput["documents"] = [
      { id: "doc-1", name: "Document one", pdf: await createPdf() },
      { id: "doc-2", name: "Document two", pdf: await createPdf() },
    ];

    const outcome = await signA1Documents({
      documents,
      credentials: {
        pfx,
        password: CERTIFICATE_PASSWORD,
      },
      signing: {},
    });

    expect(outcome.ok).toBe(true);

    if (!outcome.ok) {
      return;
    }

    expect(outcome.rows).toHaveLength(2);
    expect(outcome.rows[0]).toMatchObject({ id: "doc-1", status: "signed" });
    expect(outcome.rows[1]).toMatchObject({ id: "doc-2", status: "signed" });

    const signedRows = outcome.rows.filter(
      (row): row is A1SignerSignedRow => row.status === "signed",
    );

    expect(signedRows).toHaveLength(2);

    const verifications = await Promise.all(
      signedRows.map((row) => Effect.runPromise(verifyPdf({ pdf: row.signedPdf }))),
    );

    expect(verifications.every((result) => result.valid)).toBe(true);
    expect(verifications.every((result) => result.signatureCount === 1)).toBe(true);
  });

  it("rejects a concurrent batch without replacing the first batch outcome", async () => {
    const pfx = await Effect.runPromise(readA1Fixture("ecpf"));
    const first = await makeDocuments("first");
    const second = await makeDocuments("second");

    const firstOutcomePromise = signA1Documents({
      documents: first,
      credentials: {
        pfx,
        password: CERTIFICATE_PASSWORD,
      },
      signing: {},
    });

    const secondOutcome = await signA1Documents({
      documents: second,
      credentials: {
        pfx,
        password: CERTIFICATE_PASSWORD,
      },
      signing: {},
    });

    expect(secondOutcome.ok).toBe(false);
    if (!secondOutcome.ok) {
      expect(secondOutcome.error.code).toBe(SignatureKitErrorCodeValue.invalidInput);
    }

    const firstOutcome = await firstOutcomePromise;
    expect(firstOutcome.ok).toBe(true);
    if (!firstOutcome.ok) return;

    expect(firstOutcome.rows.map((row) => row.id)).toEqual(["first-1", "first-2"]);
    expect(firstOutcome.rows.every((row) => row.status === "signed")).toBe(true);
  });
});
