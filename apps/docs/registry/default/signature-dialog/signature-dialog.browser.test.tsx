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
  readonly getSuccess: () => HTMLElement | null;
};

type SignatureDialogMountOptions = Partial<
  Pick<SignatureDialogProps, "getSavedPassword" | "onSigned" | "onSavePassword" | "onWrongPassword">
> & {
  readonly savedPassword?: string | null;
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

const readA1FixtureFromBrowser = async (): Promise<Uint8Array> => {
  const fixtureUrl = new URL(
    "../../../../../signers/a1/__tests__/fixtures/ecpf.p12",
    import.meta.url,
  );
  const response = await fetch(fixtureUrl);
  expect(response.ok).toBe(true);
  return new Uint8Array(await response.arrayBuffer());
};

const captureUnhandledRejections = () => {
  const reasons: unknown[] = [];
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reasons.push(event.reason);
    event.preventDefault();
  };

  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return {
    reasons,
    stop: () => window.removeEventListener("unhandledrejection", onUnhandledRejection),
  };
};

const mountDialog = (
  documents: SignatureDialogProps["buildDocuments"] = buildDocuments,
  pfx: Uint8Array = new TextEncoder().encode("fake-pfx"),
  options: SignatureDialogMountOptions = {},
): MountedDialog => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  root.render(
    <SignatureDialog
      pfx={pfx}
      buildDocuments={documents}
      signing={{}}
      onSigned={options.onSigned ?? (() => {})}
      onSavePassword={options.onSavePassword}
      onWrongPassword={options.onWrongPassword}
      getSavedPassword={
        options.getSavedPassword ??
        (() => (options.savedPassword === undefined ? "changeit" : options.savedPassword))
      }
    />,
  );

  const getButton = (label: string): HTMLButtonElement | null => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent !== null && candidate.textContent.trim() === label,
    );

    return button ?? null;
  };

  const getAlert = (): HTMLElement | null => document.querySelector('[role="alert"]');
  const getSuccess = (): HTMLElement | null =>
    document.querySelector('[data-slot="signature-dialog-success"]');

  const cleanup = () => {
    root.unmount();
    container.remove();
  };

  return { cleanup, getButton, getAlert, getSuccess };
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

  it("renders a localized error without an unhandled rejection when buildDocuments rejects", async () => {
    const rejections = captureUnhandledRejections();
    const rejectedDocuments: SignatureDialogProps["buildDocuments"] = async () => {
      throw new Error("document creation failed");
    };
    const dialog = mountDialog(rejectedDocuments);
    cleanup = dialog.cleanup;

    try {
      const trigger = () => dialog.getButton("Sign with A1");
      await waitFor(() => trigger() !== null, "signer trigger is rendered");

      const triggerButton = trigger();
      if (triggerButton === null) return;
      triggerButton.click();

      await waitFor(() => dialog.getAlert() !== null, "build failure alert is rendered");

      expect(dialog.getAlert()?.textContent?.trim()).toBe("Something went wrong.");
      expect(dialog.getSuccess()).toBeNull();
      await rafTick();
      expect(rejections.reasons).toEqual([]);
    } finally {
      rejections.stop();
    }
  });

  it("renders a localized error without an unhandled rejection when getSavedPassword throws", async () => {
    const rejections = captureUnhandledRejections();
    let documentBuildCalls = 0;
    const dialog = mountDialog(
      async () => {
        documentBuildCalls += 1;
        return [];
      },
      new TextEncoder().encode("fake-pfx"),
      {
        getSavedPassword: () => {
          throw new Error("saved password lookup failed");
        },
      },
    );
    cleanup = dialog.cleanup;

    try {
      const trigger = () => dialog.getButton("Sign with A1");
      await waitFor(() => trigger() !== null, "signer trigger is rendered");

      expect(dialog.getAlert()).toBeNull();

      const triggerButton = trigger();
      if (triggerButton === null) return;
      triggerButton.click();

      await waitFor(() => dialog.getAlert() !== null, "saved password failure alert is rendered");

      expect(documentBuildCalls).toBe(0);
      expect(dialog.getAlert()?.textContent?.trim()).toBe("Something went wrong.");
      expect(dialog.getSuccess()).toBeNull();
      await rafTick();
      expect(rejections.reasons).toEqual([]);
    } finally {
      rejections.stop();
    }
  });

  it("hides signed output and renders a localized error when onSigned rejects", async () => {
    const rejections = captureUnhandledRejections();
    const pfx = await readA1FixtureFromBrowser();
    const dialog = mountDialog(buildDocuments, pfx, {
      onSigned: async () => {
        throw new Error("signed callback failed");
      },
    });
    cleanup = dialog.cleanup;

    try {
      const trigger = () => dialog.getButton("Sign with A1");
      await waitFor(() => trigger() !== null, "signer trigger is rendered");

      const triggerButton = trigger();
      if (triggerButton === null) return;
      triggerButton.click();

      await waitFor(() => dialog.getAlert() !== null, "signed callback alert is rendered");

      expect(dialog.getAlert()?.textContent?.trim()).toBe("Something went wrong.");
      expect(dialog.getSuccess()).toBeNull();
      await rafTick();
      expect(rejections.reasons).toEqual([]);
    } finally {
      rejections.stop();
    }
  });

  it("keeps password recovery visible without an unhandled rejection when onWrongPassword rejects", async () => {
    const rejections = captureUnhandledRejections();
    const pfx = await readA1FixtureFromBrowser();
    let savedPasswordClears = 0;
    const dialog = mountDialog(buildDocuments, pfx, {
      onWrongPassword: async () => {
        throw new Error("wrong password callback failed");
      },
      onSavePassword: (password) => {
        if (password === null) savedPasswordClears += 1;
      },
      savedPassword: "wrong-password",
    });
    cleanup = dialog.cleanup;

    try {
      const trigger = () => dialog.getButton("Sign with A1");
      await waitFor(() => trigger() !== null, "signer trigger is rendered");

      const triggerButton = trigger();
      if (triggerButton === null) return;
      triggerButton.click();

      await waitFor(() => dialog.getAlert() !== null, "wrong password callback alert is rendered");

      expect(dialog.getAlert()?.textContent?.trim()).toBe("Something went wrong.");
      expect(savedPasswordClears).toBe(1);
      expect(document.querySelector("#signature-dialog-password")).not.toBeNull();
      expect(dialog.getSuccess()).toBeNull();
      await rafTick();
      expect(rejections.reasons).toEqual([]);
    } finally {
      rejections.stop();
    }
  });

  it("keeps password recovery visible without an unhandled rejection when onSavePassword rejects", async () => {
    const rejections = captureUnhandledRejections();
    const pfx = await readA1FixtureFromBrowser();
    let wrongPasswordCalls = 0;
    let savePasswordCalls = 0;
    const dialog = mountDialog(buildDocuments, pfx, {
      onWrongPassword: () => {
        wrongPasswordCalls += 1;
      },
      onSavePassword: async () => {
        savePasswordCalls += 1;
        throw new Error("save password callback failed");
      },
      savedPassword: "wrong-password",
    });
    cleanup = dialog.cleanup;

    try {
      const trigger = () => dialog.getButton("Sign with A1");
      await waitFor(() => trigger() !== null, "signer trigger is rendered");

      const triggerButton = trigger();
      if (triggerButton === null) return;
      triggerButton.click();

      await waitFor(() => dialog.getAlert() !== null, "save password callback alert is rendered");

      expect(wrongPasswordCalls).toBe(1);
      expect(savePasswordCalls).toBe(1);
      expect(dialog.getAlert()?.textContent?.trim()).toBe("Something went wrong.");
      expect(document.querySelector("#signature-dialog-password")).not.toBeNull();
      expect(dialog.getSuccess()).toBeNull();
      await rafTick();
      expect(rejections.reasons).toEqual([]);
    } finally {
      rejections.stop();
    }
  });
}
