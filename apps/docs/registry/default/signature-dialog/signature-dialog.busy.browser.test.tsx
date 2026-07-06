import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignatureDialog, type SignatureDialogProps } from "./signature-dialog";

vi.mock("@signature-kit/react/a1", () => ({
  clearA1Certificate: () => {},
  clearA1Signer: () => {},
  useA1Signer: () => ({
    busy: true,
    rows: [],
    error: null,
    sign: async () => ({
      ok: false,
      error: {
        _tag: "SignatureKitError",
        code: "signature.INVALID_INPUT",
        retryable: false,
      },
    }),
    clear: () => {},
  }),
}));

type MountedDialog = {
  readonly cleanup: () => void;
  readonly getButton: (label: string) => HTMLButtonElement | null;
};

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, label: string, maxFrames = 240): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (predicate()) return;
    await rafTick();
  }

  expect(predicate(), label).toBe(true);
}

const buildDocuments: SignatureDialogProps["buildDocuments"] = () => [];

const mountDialog = (): MountedDialog => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  root.render(
    <SignatureDialog
      pfx={new Uint8Array()}
      buildDocuments={buildDocuments}
      signing={{}}
      onSigned={() => {}}
      getSavedPassword={() => "changeit"}
    />,
  );

  const getButton = (label: string): HTMLButtonElement | null => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
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

  afterEach(() => {
    if (cleanup !== null) {
      cleanup();
    }
    cleanup = null;
  });

  it("disables the trigger while signer.busy is true", async () => {
    const dialog = mountDialog();
    cleanup = dialog.cleanup;

    const trigger = () => dialog.getButton("Sign with A1");
    await waitFor(() => trigger() !== null, "signer trigger is rendered");

    expect(trigger()?.disabled).toBe(true);
  });
}
