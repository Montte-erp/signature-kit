import { PDFDocument } from "@cantoo/pdf-lib";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { clearA1Certificate, clearA1Signer } from "@signature-kit/react/a1";

import { SignatureDialog, type SignatureDialogProps } from "./signature-dialog";

type MountedDialog = {
  readonly cleanup: () => void;
  readonly getButton: (label: string) => HTMLButtonElement | null;
  readonly getAlert: () => HTMLElement | null;
};

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, label: string, maxFrames = 240): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (predicate()) return;
    await rafTick();
  }

  expect(predicate(), label).toBe(true);
}

const makePdf = async (): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 180]);
  page.drawText("SignatureKit dialog test", { x: 32, y: 118, size: 14 });
  return pdf.save({ useObjectStreams: false });
};

const buildDocuments = async () => [
  { id: "document-1", name: "document-1.pdf", pdf: await makePdf() },
];


const mountDialog = (
  documents: SignatureDialogProps["buildDocuments"] = buildDocuments,
  pfx: Uint8Array = new TextEncoder().encode("fake-pfx"),
): MountedDialog => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  root.render(
    <SignatureDialog
      pfx={pfx}
      buildDocuments={documents}
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

  const getAlert = (): HTMLElement | null => document.querySelector('[role="alert"]');

  const cleanup = () => {
    root.unmount();
    container.remove();
  };

  return { cleanup, getButton, getAlert };
};

if (typeof document === "undefined") {
  describe.skip("SignatureDialog browser semantics", () => {
    it("runs only through apps/docs/vitest.browser.config.ts", () => {});
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


  it("renders signer.error after a batch failure", async () => {
    const invalidDocuments: SignatureDialogProps["buildDocuments"] = async () => [
      { id: "", name: "document-1.pdf", pdf: await makePdf() },
    ];
    const dialog = mountDialog(invalidDocuments);
    cleanup = dialog.cleanup;

    const trigger = () => dialog.getButton("Sign with A1");
    await waitFor(() => trigger() !== null, "signer trigger is rendered");

    const triggerButton = trigger();
    if (triggerButton === null) return;

    triggerButton.click();

    await waitFor(() => dialog.getAlert() !== null, "signer error text is rendered");

    const alert = dialog.getAlert();
    if (alert === null) return;
    expect(alert.textContent?.trim().length).toBeGreaterThan(0);
  });

}
