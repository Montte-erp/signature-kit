import { Effect } from "effect";
import { readA1FixtureFromBrowser } from "../../../tooling/testing/fixtures.browser";
import * as React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { describe, expect, it, afterEach } from "vitest";
import {
  clearA1Certificate,
  clearA1Signer,
  disposeA1Session,
  getLoadedA1CertificateProfile,
  loadA1Certificate,
  signA1Documents,
  useA1Signer,
} from "@signature-kit/react/a1";
import type { A1SignerHook } from "@signature-kit/react/a1";
import type { A1SignerInput, A1SignerSignedRow } from "@signature-kit/react/config";
import { verifyPdf, verifyPdfSignatures } from "@signature-kit/pdf/verify";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";

const CERTIFICATE_PASSWORD = "changeit";

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, label: string, maxFrames = 300): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (predicate()) return;
    await rafTick();
  }

  expect(predicate(), label).toBe(true);
}

const createPdf = (): Uint8Array => {
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

  return new TextEncoder().encode(source.join("\n"));
};

const makeDocuments = (prefix: string): A1SignerInput["documents"] => [
  { id: `${prefix}-1`, name: `${prefix}-1.pdf`, pdf: createPdf() },
  { id: `${prefix}-2`, name: `${prefix}-2.pdf`, pdf: createPdf() },
];

type MountedSigner = {
  readonly getHook: () => A1SignerHook | null;
  readonly cleanup: () => void;
};

const mountSigner = (): MountedSigner => {
  const container = document.createElement("div");
  const root: Root = createRoot(container);

  let hook: A1SignerHook | null = null;

  const Probe = () => {
    const signer = useA1Signer();

    React.useLayoutEffect(() => {
      hook = signer;
    }, [signer]);

    return null;
  };

  root.render(<Probe />);

  const cleanup = () => {
    hook = null;
    root.unmount();
    container.remove();
  };

  return { getHook: () => hook, cleanup };
};

const currentSigner = (probe: MountedSigner): A1SignerHook => {
  const signer = probe.getHook();
  if (signer !== null) return signer;
  expect.fail("signer hook was not mounted");
};

if (typeof document === "undefined") {
  describe.skip("@signature-kit/react A1 signer browser semantics", () => {
    it("runs only through browser integration command", () => {});
  });
} else {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    if (cleanup !== null) {
      cleanup();
    }
    cleanup = null;

    clearA1Certificate();
    clearA1Signer();
  });

  it("loads an A1 certificate and exposes a ready profile", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));

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
  }, 30000);

  it("keeps wrong certificate password in a typed SignatureKitError", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));

    const outcome = await loadA1Certificate(pfx, "wrong-password");

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(SignatureKitErrorCodeValue.wrongPassword);
      expect(outcome.error.message).toBe("Wrong certificate password.");
    }
  }, 30000);

  it("signs two PDFs in input order and verifies both outputs", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));
    const documents: A1SignerInput["documents"] = [
      { id: "doc-1", name: "Document one", pdf: createPdf() },
      { id: "doc-2", name: "Document two", pdf: createPdf() },
    ];

    const outcome = await signA1Documents({
      documents,
      credentials: { pfx, password: CERTIFICATE_PASSWORD },
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
  }, 30000);

  it("renders A1 signer hook state in browser", async () => {
    const probe = mountSigner();
    cleanup = probe.cleanup;

    await waitFor(() => probe.getHook() !== null, "signer hook is mounted");

    const signer = probe.getHook();
    if (signer === null) return;

    expect(signer.busy).toBe(false);
    expect(signer.rows).toEqual([]);
    expect(signer.error).toBeNull();
  });

  it("marks rows failed and exposes signer.error when batch fails before any row succeeds", async () => {
    const probe = mountSigner();
    cleanup = probe.cleanup;

    await waitFor(() => probe.getHook() !== null, "signer hook is mounted");

    const outcome = await currentSigner(probe).sign({
      documents: makeDocuments("missing-credentials"),
      signing: {},
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe(SignatureKitErrorCodeValue.invalidInput);
    }

    await waitFor(() => {
      const signer = probe.getHook();
      return (
        signer !== null &&
        !signer.busy &&
        signer.error?.code === SignatureKitErrorCodeValue.invalidInput &&
        signer.rows.length === 2 &&
        signer.rows.every((row) => row.status === "failed")
      );
    }, "pending rows are marked failed");

    const signer = currentSigner(probe);
    expect(signer.rows.map((row) => row.status)).toEqual(["failed", "failed"]);
    for (const row of signer.rows) {
      if (row.status !== "failed") expect.fail("expected a failed row");
      expect(row.error.code).toBe(SignatureKitErrorCodeValue.invalidInput);
    }
  });

  it("signs and verifies with the loaded worker session", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));
    const loaded = await loadA1Certificate(pfx, CERTIFICATE_PASSWORD);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) expect.fail("expected a loaded certificate");
    const result = await signA1Documents({
      documents: [makeDocuments("loaded")[0]].filter((document) => document !== undefined),
      credentials: { profile: loaded.profile },
      signing: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) expect.fail("expected signing to complete");
    const row = result.rows[0];
    if (row?.status !== "signed") expect.fail("expected a signed PDF");
    const verified = await Effect.runPromise(verifyPdfSignatures({ pdf: row.signedPdf }));
    expect(verified.map((signature) => signature.cryptographicValid)).toEqual([true]);
  }, 30000);

  it("disposes the shared loaded session explicitly", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));
    expect((await loadA1Certificate(pfx, CERTIFICATE_PASSWORD)).ok).toBe(true);
    expect(await disposeA1Session()).toEqual([true]);
    const result = await signA1Documents({ documents: makeDocuments("disposed"), signing: {} });
    expect(result).toMatchObject({
      ok: false,
      error: { code: SignatureKitErrorCodeValue.invalidInput },
    });
  }, 30000);

  it("shares concurrent disposal results and rejects admission until disposal finishes", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));
    expect((await loadA1Certificate(pfx, CERTIFICATE_PASSWORD)).ok).toBe(true);
    const first = disposeA1Session();
    const second = disposeA1Session();
    const load = loadA1Certificate(pfx, CERTIFICATE_PASSWORD);
    const sign = signA1Documents({ documents: makeDocuments("during-disposal"), signing: {} });
    expect(await load).toMatchObject({
      ok: false,
      error: { code: SignatureKitErrorCodeValue.unsupportedOperation },
    });
    expect(await sign).toMatchObject({
      ok: false,
      error: { code: SignatureKitErrorCodeValue.unsupportedOperation },
    });
    expect(await Promise.all([first, second])).toEqual([[true], [true]]);
    expect((await loadA1Certificate(pfx, CERTIFICATE_PASSWORD)).ok).toBe(true);
  }, 30000);

  it("keeps cleared state when an entered signing run settles", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));
    const probe = mountSigner();
    cleanup = probe.cleanup;
    await waitFor(() => probe.getHook() !== null, "signer hook is mounted");
    expect((await loadA1Certificate(pfx, CERTIFICATE_PASSWORD)).ok).toBe(true);
    const pending = signA1Documents({ documents: makeDocuments("cleared"), signing: {} });
    await waitFor(
      () => probe.getHook()?.rows.some((row) => row.status === "signing") === true,
      "signing row is visible",
    );
    clearA1Signer();
    expect(await pending).toMatchObject({ ok: false });
    await waitFor(() => {
      const signer = probe.getHook();
      return signer !== null && !signer.busy && signer.rows.length === 0 && signer.error === null;
    }, "cleared signer remains idle");
  }, 30000);

  it("keeps first batch rows when a concurrent sign call is rejected", async () => {
    const pfx = await Effect.runPromise(readA1FixtureFromBrowser("ecpf"));
    const probe = mountSigner();
    cleanup = probe.cleanup;

    await waitFor(() => probe.getHook() !== null, "signer hook is mounted");

    const firstOutcomePromise = currentSigner(probe).sign({
      documents: makeDocuments("first"),
      credentials: {
        pfx,
        password: CERTIFICATE_PASSWORD,
      },
      signing: {},
    });
    const secondOutcome = await currentSigner(probe).sign({
      documents: makeDocuments("second"),
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
    if (!firstOutcome.ok) expect.fail("expected first batch to complete");

    await waitFor(
      () => {
        const signer = probe.getHook();
        return (
          signer !== null &&
          !signer.busy &&
          signer.rows.length === 2 &&
          signer.rows.every((row) => row.status === "signed")
        );
      },
      "first batch rows remain signed",
      1200,
    );

    for (const row of firstOutcome.rows) {
      if (row.status !== "signed") expect.fail("expected signed PDF");
      const verified = await Effect.runPromise(verifyPdfSignatures({ pdf: row.signedPdf }));
      expect(verified.map((signature) => signature.cryptographicValid)).toEqual([true]);
    }
    const signer = currentSigner(probe);
    expect(signer.rows.map((row) => row.id)).toEqual(["first-1", "first-2"]);
    expect(signer.rows.map((row) => row.status)).toEqual(["signed", "signed"]);
  });
}
