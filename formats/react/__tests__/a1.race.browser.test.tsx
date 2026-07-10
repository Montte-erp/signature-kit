import * as React from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearA1Certificate,
  clearA1Signer,
  getLoadedA1CertificateProfile,
  loadA1Certificate,
  useA1Signer,
} from "../src/a1";
import type { A1SignerHook } from "../src/a1";
import type { A1SignerInput } from "../src/config";

type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value | PromiseLike<Value>) => void;
  readonly reject: (reason?: unknown) => void;
};

type CertificateProfile = {
  readonly document: string;
  readonly subject: string;
  readonly organization: string | null;
  readonly issuer: string;
  readonly serialNumber: string;
  readonly fingerprint: string;
  readonly validFrom: Date;
  readonly validTo: Date;
  readonly daysUntilExpiry: number;
};

const mocks = vi.hoisted(() => ({
  parseCertificate: vi.fn(),
  signaturesLayer: vi.fn(),
  preparePdf: vi.fn(),
}));

vi.mock("@signature-kit/a1/signer", () => ({
  parseA1CertificateProfile: mocks.parseCertificate,
  a1SignaturesLayer: mocks.signaturesLayer,
}));

vi.mock("@signature-kit/pdf/workflow", () => ({
  prepareAndSignPdf: mocks.preparePdf,
}));

const defer = <Value,>(): Deferred<Value> => Promise.withResolvers<Value>();

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, label: string, maxFrames = 300): Promise<void> {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    if (predicate()) return;
    await rafTick();
  }

  expect(predicate(), label).toBe(true);
}

const certificateProfile = (fingerprint: string): CertificateProfile => ({
  document: "12345678901",
  subject: "Race test certificate",
  organization: null,
  issuer: "Signature Kit test issuer",
  serialNumber: fingerprint,
  fingerprint,
  validFrom: new Date("2026-01-01T00:00:00.000Z"),
  validTo: new Date("2027-01-01T00:00:00.000Z"),
  daysUntilExpiry: 365,
});

const signerInput = (id: string): A1SignerInput => ({
  documents: [{ id, name: `${id}.pdf`, pdf: new Uint8Array([37, 80, 68, 70]) }],
  credentials: { pfx: new Uint8Array([1, 2, 3]), password: "password" },
  signing: {},
});

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

  return {
    getHook: () => hook,
    cleanup: () => {
      hook = null;
      root.unmount();
      container.remove();
    },
  };
};

const currentSigner = (probe: MountedSigner): A1SignerHook => {
  const signer = probe.getHook();
  if (signer !== null) return signer;
  expect.fail("signer hook was not mounted");
};

if (typeof document === "undefined") {
  describe.skip("@signature-kit/react A1 operation ownership", () => {
    it("runs only through browser integration command", () => {});
  });
} else {
  describe("@signature-kit/react A1 operation ownership", () => {
    let certificateRequests: Array<Deferred<CertificateProfile>> = [];
    let signingRequests: Array<Deferred<Uint8Array>> = [];
    let cleanup: (() => void) | null = null;

    beforeEach(() => {
      mocks.parseCertificate.mockImplementation(() =>
        Effect.promise(() => {
          const request = certificateRequests.shift();
          return request === undefined
            ? Promise.reject(new Error("Missing deferred certificate request."))
            : request.promise;
        }),
      );
      mocks.signaturesLayer.mockImplementation(() => Layer.empty);
      mocks.preparePdf.mockImplementation(() =>
        Effect.promise(() => {
          const request = signingRequests.shift();
          return request === undefined
            ? Promise.reject(new Error("Missing deferred signing request."))
            : request.promise;
        }),
      );
    });

    afterEach(() => {
      if (cleanup !== null) cleanup();
      cleanup = null;
      clearA1Certificate();
      clearA1Signer();
      certificateRequests = [];
      signingRequests = [];
      mocks.parseCertificate.mockClear();
      mocks.signaturesLayer.mockClear();
      mocks.preparePdf.mockClear();
    });

    it("keeps the latest certificate when concurrent loads complete out of order", async () => {
      const first = defer<CertificateProfile>();
      const second = defer<CertificateProfile>();
      certificateRequests.push(first, second);

      const firstLoad = loadA1Certificate(new Uint8Array([1]), "first-password");
      const secondLoad = loadA1Certificate(new Uint8Array([2]), "second-password");

      await waitFor(() => mocks.parseCertificate.mock.calls.length === 2, "both loads started");

      second.resolve(certificateProfile("second"));
      await expect(secondLoad).resolves.toMatchObject({
        ok: true,
        profile: { fingerprint: "second" },
      });

      first.resolve(certificateProfile("first"));
      await expect(firstLoad).resolves.toMatchObject({
        ok: true,
        profile: { fingerprint: "first" },
      });

      expect(getLoadedA1CertificateProfile()?.fingerprint).toBe("second");
    });

    it("keeps a cleared certificate empty after its pending load completes", async () => {
      const request = defer<CertificateProfile>();
      certificateRequests.push(request);

      const load = loadA1Certificate(new Uint8Array([3]), "clear-password");
      await waitFor(() => mocks.parseCertificate.mock.calls.length === 1, "load started");

      clearA1Certificate();
      request.resolve(certificateProfile("cleared"));
      await expect(load).resolves.toMatchObject({ ok: true, profile: { fingerprint: "cleared" } });

      expect(getLoadedA1CertificateProfile()).toBeNull();
    });

    it("clears a prior profile while its replacement load is pending", async () => {
      const current = defer<CertificateProfile>();
      certificateRequests.push(current);

      const currentLoad = loadA1Certificate(new Uint8Array([4]), "current-password");
      await waitFor(() => mocks.parseCertificate.mock.calls.length === 1, "current load started");
      current.resolve(certificateProfile("current"));
      await expect(currentLoad).resolves.toMatchObject({
        ok: true,
        profile: { fingerprint: "current" },
      });
      expect(getLoadedA1CertificateProfile()?.fingerprint).toBe("current");

      const replacement = defer<CertificateProfile>();
      certificateRequests.push(replacement);
      const replacementLoad = loadA1Certificate(new Uint8Array([5]), "replacement-password");
      await waitFor(
        () => mocks.parseCertificate.mock.calls.length === 2,
        "replacement load started",
      );

      expect(getLoadedA1CertificateProfile()).toBeNull();

      replacement.resolve(certificateProfile("replacement"));
      await expect(replacementLoad).resolves.toMatchObject({
        ok: true,
        profile: { fingerprint: "replacement" },
      });
    });

    it("keeps the signer empty and idle when cleared during an active batch", async () => {
      const request = defer<Uint8Array>();
      signingRequests.push(request);
      const probe = mountSigner();
      cleanup = probe.cleanup;

      await waitFor(() => probe.getHook() !== null, "signer hook mounted");

      const run = currentSigner(probe).sign(signerInput("cleared-run"));
      await waitFor(() => mocks.preparePdf.mock.calls.length === 1, "signing started");

      clearA1Signer();
      await waitFor(() => {
        const signer = probe.getHook();
        return signer !== null && !signer.busy && signer.rows.length === 0 && signer.error === null;
      }, "cleared signer state");

      request.resolve(new Uint8Array([1]));
      await expect(run).resolves.toMatchObject({ ok: true });
      await rafTick();

      const signer = currentSigner(probe);
      expect(signer).toMatchObject({ busy: false, rows: [], error: null });
    });

    it("does not let a stale completion reset a newer signer run", async () => {
      const firstRequest = defer<Uint8Array>();
      const secondRequest = defer<Uint8Array>();
      signingRequests.push(firstRequest);
      const probe = mountSigner();
      cleanup = probe.cleanup;

      await waitFor(() => probe.getHook() !== null, "signer hook mounted");

      const firstRun = currentSigner(probe).sign(signerInput("first-run"));
      await waitFor(() => mocks.preparePdf.mock.calls.length === 1, "first signing started");

      clearA1Signer();
      signingRequests.push(secondRequest);
      const secondRun = currentSigner(probe).sign(signerInput("second-run"));
      await waitFor(() => mocks.preparePdf.mock.calls.length === 2, "second signing started");

      firstRequest.resolve(new Uint8Array([1]));
      await expect(firstRun).resolves.toMatchObject({ ok: true });
      await rafTick();

      const duringSecondRun = currentSigner(probe);
      expect(duringSecondRun.busy).toBe(true);
      expect(duringSecondRun.rows).toMatchObject([{ id: "second-run", status: "signing" }]);

      secondRequest.resolve(new Uint8Array([2]));
      await expect(secondRun).resolves.toMatchObject({ ok: true });
      await waitFor(() => {
        const signer = probe.getHook();
        return (
          signer !== null &&
          !signer.busy &&
          signer.rows.length === 1 &&
          signer.rows[0]?.id === "second-run" &&
          signer.rows[0]?.status === "signed"
        );
      }, "second signer run completes");
    });
  });
}
