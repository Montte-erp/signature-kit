import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignatureDialog, type SignatureDialogProps } from "./signature-dialog";

type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value | PromiseLike<Value>) => void;
  readonly reject: (reason?: unknown) => void;
};

const mocks = vi.hoisted(() => ({
  busy: true,
  clear: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("@signature-kit/react/a1", () => ({
  clearA1Certificate: () => {},
  clearA1Signer: () => {},
  useA1Signer: () => ({
    busy: mocks.busy,
    rows: [],
    error: null,
    sign: mocks.sign,
    clear: mocks.clear,
  }),
}));

type MountedDialog = {
  readonly cleanup: () => void;
  readonly getButton: (label: string) => HTMLButtonElement | null;
};
const defer = <Value,>(): Deferred<Value> => Promise.withResolvers<Value>();

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, label: string, maxFrames = 240): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (predicate()) return;
    await rafTick();
  }

  expect(predicate(), label).toBe(true);
}

const documentInput = {
  id: "document-1",
  name: "document-1.pdf",
  pdf: new Uint8Array([37, 80, 68, 70]),
};

const signedRow = {
  id: documentInput.id,
  name: documentInput.name,
  status: "signed",
  signedPdf: new Uint8Array([37, 80, 68, 70]),
};

const buildDocuments: SignatureDialogProps["buildDocuments"] = () => [documentInput];

const mountDialog = (
  documents: SignatureDialogProps["buildDocuments"] = buildDocuments,
  onSigned: SignatureDialogProps["onSigned"] = () => {},
): MountedDialog => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  root.render(
    <SignatureDialog
      pfx={new Uint8Array()}
      buildDocuments={documents}
      signing={{}}
      onSigned={onSigned}
      getSavedPassword={() => "changeit"}
    />,
  );

  const getButton = (label: string): HTMLButtonElement | null => {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent !== null && candidate.textContent.trim() === label,
    );

    return button ?? null;
  };

  const cleanup = () => {
    root.unmount();
    container.remove();
  };

  return { cleanup, getButton };
};

if (typeof document === "undefined") {
  describe.skip("SignatureDialog busy browser semantics", () => {
    it("runs only through apps/docs/vitest.browser.config.ts", () => {});
  });
} else {
  let cleanup: (() => void) | null = null;
  let signingRequests: Array<Deferred<unknown>> = [];

  beforeEach(() => {
    mocks.busy = true;
    mocks.clear.mockReset();
    mocks.sign.mockReset();
    signingRequests = [];
    mocks.sign.mockImplementation(() => {
      const request = signingRequests.shift();
      return request === undefined
        ? Promise.reject(new Error("Missing deferred signing request."))
        : request.promise.then(() => ({ ok: true, rows: [signedRow] }));
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    mocks.clear.mockReset();
    mocks.sign.mockReset();
  });

  it("disables the trigger while signer.busy is true", async () => {
    const dialog = mountDialog();
    cleanup = dialog.cleanup;

    const trigger = () => dialog.getButton("Sign with A1");
    await waitFor(() => trigger() !== null, "signer trigger is rendered");

    expect(trigger()?.disabled).toBe(true);
  });

  it("cancels a deferred build on close without signing or calling onSigned", async () => {
    mocks.busy = false;
    const build = defer<ReadonlyArray<typeof documentInput>>();
    let signedCalls = 0;
    const dialog = mountDialog(
      () => build.promise,
      () => {
        signedCalls += 1;
      },
    );
    cleanup = dialog.cleanup;

    const trigger = () => dialog.getButton("Sign with A1");
    await waitFor(() => trigger() !== null, "signer trigger is rendered");
    trigger()?.click();
    await waitFor(() => dialog.getButton("Close") !== null, "dialog is open");

    const clearBeforeClose = mocks.clear.mock.calls.length;
    dialog.getButton("Close")?.click();
    build.resolve([documentInput]);
    await rafTick();
    await rafTick();

    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.clear.mock.calls.length).toBeGreaterThan(clearBeforeClose);
    expect(signedCalls).toBe(0);
  });

  it("cancels a deferred sign on unmount without calling onSigned", async () => {
    mocks.busy = false;
    const sign = defer<unknown>();
    signingRequests.push(sign);
    let signedCalls = 0;
    const dialog = mountDialog(buildDocuments, () => {
      signedCalls += 1;
    });
    cleanup = dialog.cleanup;

    const trigger = () => dialog.getButton("Sign with A1");
    await waitFor(() => trigger() !== null, "signer trigger is rendered");
    trigger()?.click();
    await waitFor(() => mocks.sign.mock.calls.length === 1, "signing started");

    const clearBeforeUnmount = mocks.clear.mock.calls.length;
    dialog.cleanup();
    cleanup = null;
    sign.resolve(undefined);
    await rafTick();

    expect(mocks.clear.mock.calls.length).toBeGreaterThan(clearBeforeUnmount);
    expect(signedCalls).toBe(0);
  });

  it("starts a fresh operation after closing a deferred sign", async () => {
    mocks.busy = false;
    const firstSign = defer<unknown>();
    const secondSign = defer<unknown>();
    signingRequests.push(firstSign, secondSign);
    let signedCalls = 0;
    const dialog = mountDialog(buildDocuments, () => {
      signedCalls += 1;
    });
    cleanup = dialog.cleanup;

    const trigger = () => dialog.getButton("Sign with A1");
    await waitFor(() => trigger() !== null, "signer trigger is rendered");
    trigger()?.click();
    await waitFor(() => mocks.sign.mock.calls.length === 1, "first signing started");
    dialog.getButton("Close")?.click();
    firstSign.resolve(undefined);

    await waitFor(() => trigger()?.disabled === false, "trigger is enabled for a new operation");
    trigger()?.click();
    await waitFor(() => mocks.sign.mock.calls.length === 2, "second signing started");
    secondSign.resolve(undefined);
    await waitFor(() => signedCalls === 1, "new operation callback completed");

    expect(signedCalls).toBe(1);
  });
}
