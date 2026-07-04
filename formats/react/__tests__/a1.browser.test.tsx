import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, afterEach } from "vitest";
import { clearA1Certificate, clearA1Signer, useA1Signer } from "@signature-kit/react/a1";
import type { A1SignerHook } from "@signature-kit/react/a1";
import type { A1SignerInput } from "@signature-kit/react/config";
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

const readA1FixtureFromBrowser = async (name: "ecpf"): Promise<Uint8Array> => {
  const fixtureUrl = new URL(`../../../signers/a1/__tests__/fixtures/${name}.p12`, import.meta.url);
  const response = await fetch(fixtureUrl);
  expect(response.ok).toBe(true);
  return new Uint8Array(await response.arrayBuffer());
};

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

  it("keeps first batch rows when a concurrent sign call is rejected", async () => {
    const pfx = await readA1FixtureFromBrowser("ecpf");
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

    const signer = currentSigner(probe);
    expect(signer.rows.map((row) => row.id)).toEqual(["first-1", "first-2"]);
    expect(signer.rows.map((row) => row.status)).toEqual(["signed", "signed"]);
  });
}
