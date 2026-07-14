import * as React from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, onTestFinished, type Mock, vi } from "vitest";

vi.mock("@/lib/posthog/client", () => ({
  captureDocsEvent: () => {},
  initDocsPostHog: () => {},
}));

vi.mock("@/components/formal-contract-pdf", () => ({
  generateFormalContractPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));

const pdfjsMocks = vi.hoisted(() => {
  const renderedDocs: Array<{ readonly id?: string }> = [];
  return {
    loadPdfjs: vi.fn(),
    renderedDocs,
  };
});

vi.mock("@/components/pdf-page", () => ({
  PdfPage: ({ doc }: { doc: { readonly id?: string } }) => {
    pdfjsMocks.renderedDocs.push(doc);
    return null;
  },
  loadPdfjs: pdfjsMocks.loadPdfjs,
}));

import { LocaleProvider } from "../components/locale-provider";
import { generateFormalContractPdf } from "../components/formal-contract-pdf";
import { AutoSignInner } from "../components/sections/auto-sign-inner";

beforeEach(() => {
  pdfjsMocks.loadPdfjs.mockReset();
  pdfjsMocks.renderedDocs.length = 0;
  pdfjsMocks.loadPdfjs.mockImplementation(async () => ({
    getDocument: () => ({
      promise: Promise.resolve({ destroy: () => Promise.resolve() }),
      destroy: () => Promise.resolve(),
    }),
  }));
  vi.mocked(generateFormalContractPdf).mockReset();
  vi.mocked(generateFormalContractPdf).mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
});

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

type PdfDestroy = Mock<() => Promise<void>>;

type DeferredPdfDocument = {
  readonly id: string;
  readonly destroy: PdfDestroy;
};

type DeferredPdfLoad = {
  readonly doc: DeferredPdfDocument;
  readonly task: {
    readonly promise: Promise<DeferredPdfDocument>;
    readonly destroy: PdfDestroy;
  };
  readonly resolve: (doc: DeferredPdfDocument) => void;
  readonly reject: (reason?: unknown) => void;
};

const makeDeferredPdfLoad = (id: string): DeferredPdfLoad => {
  let resolve: (doc: DeferredPdfDocument) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<DeferredPdfDocument>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const doc = {
    id,
    destroy: vi.fn(async () => {}),
  };
  const task = {
    promise,
    destroy: vi.fn(async () => {}),
  };
  return { doc, task, resolve, reject };
};
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

    it("exposes the document selector as a vertical tablist with linked panels", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      onTestFinished(() => {
        React.act(() => root.unmount());
        container.remove();
      });

      root.render(
        <LocaleProvider locale="en-US">
          <AutoSignInner />
        </LocaleProvider>,
      );
      await waitForFrames(
        () => container.querySelectorAll('[role="tab"]').length === 4,
        "the auto-sign document tabs",
      );

      const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      expect(tabs).toHaveLength(4);
      expect(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true")).toHaveLength(1);

      for (const tab of tabs) {
        const panelId = tab.getAttribute("aria-controls");
        expect(panelId).not.toBeNull();
        const panel = panelId === null ? null : container.querySelector(`#${panelId}`);
        expect(panel?.getAttribute("role")).toBe("tabpanel");
        expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
      }

      const selectedIndex = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
      expect(selectedIndex).toBeGreaterThanOrEqual(0);
      const nextIndex = (selectedIndex + 1) % tabs.length;
      tabs[selectedIndex]?.focus();
      tabs[selectedIndex]?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
      await waitForFrames(
        () => document.activeElement === tabs[nextIndex],
        "the next auto-sign document tab",
      );

      expect(tabs[nextIndex]?.getAttribute("aria-selected")).toBe("true");
      expect(tabs[nextIndex]?.getAttribute("tabindex")).toBe("0");

      expect(tabs.every((tab) => tab.className.includes("min-h-11"))).toBe(true);
      expect(
        container.querySelector<HTMLButtonElement>('button[aria-label="Previous document"]')
          ?.className,
      ).toContain("size-11");
      expect(
        container.querySelector<HTMLButtonElement>('button[aria-label="Next document"]')?.className,
      ).toContain("size-11");
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
    it("destroys stale and active PDF lifecycles exactly once", async () => {
      let loadId = 0;
      const pendingLoads: Array<DeferredPdfLoad> = [];
      pdfjsMocks.loadPdfjs.mockImplementation(async () => ({
        getDocument: () => {
          const load = makeDeferredPdfLoad(`pdf-${++loadId}`);
          pendingLoads.push(load);
          return load.task;
        },
      }));
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      try {
        root.render(
          <LocaleProvider locale="en-US">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(() => pendingLoads.length === 1, "the English PDF load task");

        const staleLoad = pendingLoads[0];
        if (staleLoad === undefined) {
          expect.fail("missing English PDF load task");
        }

        root.render(
          <LocaleProvider locale="pt-BR">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(() => pendingLoads.length === 2, "the Portuguese PDF load task");
        expect(staleLoad.task.destroy).toHaveBeenCalledTimes(1);

        staleLoad.resolve(staleLoad.doc);
        await waitForFrames(
          () => staleLoad.doc.destroy.mock.calls.length === 1,
          "the stale PDF document cleanup",
        );
        expect(pdfjsMocks.renderedDocs).not.toContain(staleLoad.doc);

        const activeLoad = pendingLoads[1];
        if (activeLoad === undefined) {
          expect.fail("missing Portuguese PDF load task");
        }
        activeLoad.resolve(activeLoad.doc);
        await waitForFrames(
          () => pdfjsMocks.renderedDocs.includes(activeLoad.doc),
          "the active PDF document",
        );

        root.unmount();
        await waitForFrames(
          () =>
            activeLoad.task.destroy.mock.calls.length === 1 &&
            activeLoad.doc.destroy.mock.calls.length === 1,
          "the active PDF lifecycle cleanup",
        );
        expect(staleLoad.task.destroy).toHaveBeenCalledTimes(1);
        expect(staleLoad.doc.destroy).toHaveBeenCalledTimes(1);
        expect(activeLoad.task.destroy).toHaveBeenCalledTimes(1);
        expect(activeLoad.doc.destroy).toHaveBeenCalledTimes(1);
      } finally {
        root.unmount();
        container.remove();
      }
    });

    it("destroys a failed PDF loading task once", async () => {
      const pendingLoads: Array<DeferredPdfLoad> = [];
      pdfjsMocks.loadPdfjs.mockImplementation(async () => ({
        getDocument: () => {
          const load = makeDeferredPdfLoad("failed");
          pendingLoads.push(load);
          return load.task;
        },
      }));
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      try {
        root.render(
          <LocaleProvider locale="en-US">
            <AutoSignInner />
          </LocaleProvider>,
        );
        await waitForFrames(() => pendingLoads.length === 1, "the failed PDF load task");
        const failedLoad = pendingLoads[0];
        if (failedLoad === undefined) {
          expect.fail("missing failed PDF load task");
        }
        failedLoad.reject(new Error("load failed"));
        await waitForFrames(
          () => failedLoad.task.destroy.mock.calls.length === 1,
          "the failed PDF task cleanup",
        );
        expect(failedLoad.doc.destroy).not.toHaveBeenCalled();

        root.unmount();
        await rafTick();
        expect(failedLoad.task.destroy).toHaveBeenCalledTimes(1);
        expect(failedLoad.doc.destroy).not.toHaveBeenCalled();
      } finally {
        root.unmount();
        container.remove();
      }
    });
  });
}
