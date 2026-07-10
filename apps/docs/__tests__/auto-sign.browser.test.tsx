import * as React from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/posthog/client", () => ({ captureDocsEvent: () => {} }));

vi.mock("@/components/formal-contract-pdf", () => ({
  generateFormalContractPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));

vi.mock("@/components/pdf-page", () => ({
  PdfPage: () => null,
  loadPdfjs: async () => ({
    getDocument: () => ({
      promise: Promise.resolve({ destroy: () => Promise.resolve() }),
      destroy: () => Promise.resolve(),
    }),
  }),
}));

import { LocaleProvider } from "../components/locale-provider";
import { generateFormalContractPdf } from "../components/formal-contract-pdf";
import { AutoSignInner } from "../components/sections/auto-sign-inner";

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitForFrames(
  predicate: () => boolean,
  label: string,
  maxFrames = 120,
): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (predicate()) return;
    await rafTick();
  }
  return Promise.reject(new Error(`Timed out waiting for: ${label}`));
}

if (typeof document === "undefined") {
  describe.skip("AutoSignInner locale navigation (browser)", () => {
    it("runs only through apps/docs/vitest.browser.config.ts", () => {});
  });
} else {
  describe("AutoSignInner locale navigation", () => {
    it("relocalizes all document and variant labels through en-US → pt-BR → en-US", async () => {
      const englishLabels = [
        "Service agreement",
        "Contract amendment",
        "Power of attorney",
        "Terms of adhesion",
        "Signature line",
        "Signature field",
        "With witness",
        "Initials + signature",
      ];
      const portugueseLabels = [
        "Contrato de prestação de serviços",
        "Aditivo contratual",
        "Procuração",
        "Termo de adesão",
        "Linha de assinatura",
        "Campo de assinatura",
        "Com testemunha",
        "Rubrica + assinatura",
      ];
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      try {
        root.render(
          <LocaleProvider locale="en-US">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(
          () =>
            (container.textContent?.includes("Service agreement") ?? false) &&
            (container.textContent?.includes("Ready") ?? false),
          "prepared English auto-sign labels",
        );
        const englishText = container.textContent ?? "";
        for (const label of englishLabels) expect(englishText).toContain(label);
        for (const label of portugueseLabels) expect(englishText).not.toContain(label);
        expect(englishText).toContain("Ready");

        root.render(
          <LocaleProvider locale="pt-BR">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(
          () =>
            (container.textContent?.includes("Contrato de prestação de serviços") ?? false) &&
            (container.textContent?.includes("Pronto") ?? false),
          "prepared Portuguese auto-sign labels",
        );
        const portugueseText = container.textContent ?? "";
        for (const label of portugueseLabels) expect(portugueseText).toContain(label);
        for (const label of englishLabels) expect(portugueseText).not.toContain(label);
        expect(portugueseText).toContain("Pronto");
        expect(portugueseText).not.toContain("Ready");

        root.render(
          <LocaleProvider locale="en-US">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(
          () =>
            (container.textContent?.includes("Service agreement") ?? false) &&
            (container.textContent?.includes("Ready") ?? false),
          "prepared English auto-sign labels after returning",
        );
        const returnedEnglishText = container.textContent ?? "";
        for (const label of englishLabels) expect(returnedEnglishText).toContain(label);
        for (const label of portugueseLabels) expect(returnedEnglishText).not.toContain(label);
        expect(returnedEnglishText).toContain("Ready");
        expect(returnedEnglishText).not.toContain("Pronto");
      } finally {
        root.unmount();
        container.remove();
      }
    });

    it("releases downloaded PDF URLs after the click task", async () => {
      const createObjectUrl = vi
        .spyOn(URL, "createObjectURL")
        .mockReturnValue("blob:auto-sign-download");
      const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const timerHandle = setTimeout(() => {}, 60_000);
      const scheduled: TimerHandler[] = [];
      const scheduleDownloadCleanup = vi
        .spyOn(window, "setTimeout")
        .mockImplementation((handler) => {
          scheduled.push(handler);
          return timerHandle;
        });
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      try {
        root.render(
          <LocaleProvider locale="en-US">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(
          () =>
            Array.from(container.querySelectorAll("button")).some((button) =>
              button.textContent?.includes("Auto-sign all"),
            ),
          "the auto-sign action",
        );
        const autoSignButton = Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Auto-sign all"),
        );
        expect(autoSignButton).toBeDefined();
        autoSignButton?.click();

        await waitForFrames(
          () =>
            Array.from(container.querySelectorAll("button")).some((button) =>
              button.textContent?.includes("Download"),
            ),
          "the signed document download action",
        );
        const downloadButton = Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Download"),
        );
        expect(downloadButton).toBeDefined();
        downloadButton?.click();

        expect(createObjectUrl).toHaveBeenCalledTimes(1);
        expect(revokeObjectUrl).not.toHaveBeenCalled();
        expect(scheduled).toHaveLength(1);

        const release = scheduled[0];
        if (typeof release !== "function") {
          expect.fail("download cleanup task was not scheduled");
        } else {
          release();
        }

        expect(revokeObjectUrl).toHaveBeenCalledWith("blob:auto-sign-download");
      } finally {
        root.unmount();
        container.remove();
        clearTimeout(timerHandle);
        scheduleDownloadCleanup.mockRestore();
        revokeObjectUrl.mockRestore();
        createObjectUrl.mockRestore();
      }
    });

    it("invalidates stale localized PDFs and regenerates current-locale output", async () => {
      const generatePdf = vi.mocked(generateFormalContractPdf);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      try {
        root.render(
          <LocaleProvider locale="en-US">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(
          () =>
            Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
              (button) => button.textContent?.includes("Auto-sign all") && !button.disabled,
            ),
          "the available English auto-sign action",
        );
        generatePdf.mockClear();
        const englishAutoSign = Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Auto-sign all"),
        );
        expect(englishAutoSign).toBeDefined();
        englishAutoSign?.click();
        await waitForFrames(
          () =>
            generatePdf.mock.calls.length === 4 &&
            Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
              (button) => button.textContent?.includes("Auto-sign all") && !button.disabled,
            ),
          "all signed English PDFs",
        );
        expect(generatePdf).toHaveBeenCalledTimes(4);
        expect(generatePdf.mock.calls.map(([options]) => options.title)).toEqual([
          "Service agreement",
          "Contract amendment",
          "Power of attorney",
          "Terms of adhesion",
        ]);

        root.render(
          <LocaleProvider locale="pt-BR">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(
          () =>
            (container.textContent?.includes("Pronto") ?? false) &&
            Array.from(container.querySelectorAll("button")).every(
              (button) => !button.textContent?.includes("Baixar"),
            ),
          "the regenerated Portuguese preview without stale download",
        );
        expect(
          Array.from(container.querySelectorAll("button")).some((button) =>
            button.textContent?.includes("Baixar"),
          ),
        ).toBe(false);

        generatePdf.mockClear();
        const portugueseAutoSign = Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Autoassinar tudo"),
        );
        expect(portugueseAutoSign).toBeDefined();
        portugueseAutoSign?.click();
        await waitForFrames(
          () =>
            generatePdf.mock.calls.length === 4 &&
            Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
              (button) => button.textContent?.includes("Baixar") && !button.disabled,
            ),
          "all signed Portuguese PDFs",
        );
        expect(generatePdf).toHaveBeenCalledTimes(4);
        expect(generatePdf.mock.calls.map(([options]) => options.title)).toEqual([
          "Contrato de prestação de serviços",
          "Aditivo contratual",
          "Procuração",
          "Termo de adesão",
        ]);
      } finally {
        root.unmount();
        container.remove();
      }
    });

    it("rejects prior-locale queue results after navigation", async () => {
      const generatePdf = vi.mocked(generateFormalContractPdf);
      const pendingResolutions: Array<(bytes: Uint8Array) => void> = [];
      generatePdf.mockReset();
      generatePdf.mockImplementation(
        () =>
          new Promise<Uint8Array>((resolve) => {
            pendingResolutions.push(resolve);
          }),
      );
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      try {
        root.render(
          <LocaleProvider locale="en-US">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(
          () => pendingResolutions.length === 1,
          "the pending English preparation",
        );

        root.render(
          <LocaleProvider locale="pt-BR">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(
          () =>
            pendingResolutions.length === 2 &&
            (container.textContent?.includes("Contrato de prestação de serviços") ?? false),
          "the pending Portuguese preparation",
        );

        const staleResolve = pendingResolutions[0];
        if (staleResolve === undefined) {
          expect.fail("missing English preparation resolver");
        } else {
          staleResolve(new Uint8Array([37, 80, 68, 70]));
        }
        await rafTick();
        expect(container.textContent).not.toContain("Pronto");
        expect(
          Array.from(container.querySelectorAll("button")).some((button) =>
            button.textContent?.includes("Baixar"),
          ),
        ).toBe(false);

        for (let index = 1; index <= 4; index++) {
          await waitForFrames(
            () => pendingResolutions.length > index,
            `Portuguese preparation ${index}`,
          );
          const resolve = pendingResolutions[index];
          if (resolve === undefined) {
            expect.fail(`missing Portuguese preparation resolver ${index}`);
          } else {
            resolve(new Uint8Array([37, 80, 68, 70]));
          }
          await rafTick();
        }

        await waitForFrames(
          () => container.textContent?.includes("Pronto") ?? false,
          "the completed Portuguese preparation",
        );
        expect(generatePdf).toHaveBeenCalledTimes(5);
        expect(generatePdf.mock.calls[0]?.[0].title).toBe("Service agreement");
        expect(generatePdf.mock.calls[1]?.[0].title).toBe("Contrato de prestação de serviços");
      } finally {
        root.unmount();
        container.remove();
      }
    });
  });
}
