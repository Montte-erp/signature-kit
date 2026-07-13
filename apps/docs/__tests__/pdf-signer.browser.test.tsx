import { Effect, Layer } from "effect";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { m } from "@/paraglide/messages";
import { PdfSigner } from "../components/pdf-signer";

type PreparationInput = {
  readonly documents: ReadonlyArray<{
    readonly id: string;
    readonly rect?: MockRect;
    readonly template?: MockTemplate;
  }>;
};

type SigningItem = { readonly id: string };
type MockRect = {
  readonly height: number;
  readonly pageIndex: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

type MockTemplate = {
  readonly documents: ReadonlyArray<{
    readonly pages: ReadonlyArray<{
      readonly height: number;
      readonly index: number;
      readonly width: number;
    }>;
  }>;
  readonly fields: ReadonlyArray<{ readonly id: string; readonly rect: MockRect }>;
};

type MockBuilderState = {
  readonly template: MockTemplate;
  readonly selectedFieldId?: string;
};

type PlacementQueueItem = { readonly id: string };

type PlacementBatchResult = {
  readonly id: string;
  readonly ok: true;
  readonly template: MockTemplate;
  readonly field: { readonly rect: MockRect };
};

type PlacementBatchCallbacks = {
  readonly onItemStarted?: (item: PlacementQueueItem, index: number, total: number) => void;
  readonly onItemSettled?: (result: PlacementBatchResult, index: number, total: number) => void;
};

type PreparationResult = {
  readonly item: SigningItem;
  readonly ok: boolean;
};

type SigningCallbacks = {
  onItemSettled(
    result: { readonly id: string; readonly ok: true; readonly signedPdf: Uint8Array },
    index: number,
    total: number,
  ): void;
};

const testRuntime = vi.hoisted(() => {
  const initialMarker = (): MockRect | undefined => undefined;
  const builderStates: Array<{ current: MockBuilderState }> = [];
  const placeCallbacks: Array<(fracX: number, fracY: number) => void> = [];
  return {
    marker: initialMarker(),
    builderStates,
    docDestroy: vi.fn(async () => {}),
    getDocument: vi.fn(),
    loadPdfjs: vi.fn(),
    onPlace: (_fracX: number, _fracY: number) => {},
    pageRenders: 0,
    placeCallbacks,
    placeBatch: (_items: ReadonlyArray<PlacementQueueItem>, _callbacks: PlacementBatchCallbacks) =>
      Effect.succeed<ReadonlyArray<PlacementBatchResult>>([]),
    placeField: vi.fn<() => Effect.Effect<MockTemplate>>(),
    prepareBatch: (_input: PreparationInput) =>
      Effect.succeed<ReadonlyArray<PreparationResult>>([]),
    readPdfBytes: vi.fn(() => Effect.succeed(new Uint8Array([1]))),
    resolveSigning: () => {},
    signBatch: (_items: ReadonlyArray<SigningItem>, _callbacks: SigningCallbacks) => Effect.void,
    signStarted: false,
    taskDestroy: vi.fn(async () => {}),
  };
});
vi.mock("@/components/pdf-page", () => ({
  PdfPage: (props: {
    readonly marker?: MockRect;
    readonly onPlace: (fracX: number, fracY: number) => void;
  }) => {
    testRuntime.pageRenders += 1;
    testRuntime.marker = props.marker;
    testRuntime.onPlace = props.onPlace;
    testRuntime.placeCallbacks.push(props.onPlace);
    return null;
  },
  loadPdfjs: testRuntime.loadPdfjs,
}));

vi.mock("@signature-kit/pdf/builder-store", () => ({
  createPdfSignatureBuilderStore: (state: MockBuilderState) => {
    const cell = { current: state };
    testRuntime.builderStates.push(cell);
    return {
      getSnapshot: () => cell.current,
      placeField: () =>
        testRuntime.placeField().pipe(
          Effect.tap((template) =>
            Effect.sync(() => {
              cell.current = { ...cell.current, template };
            }),
          ),
        ),
      selectField: (fieldId: string | undefined) =>
        Effect.sync(() => {
          cell.current = { ...cell.current, selectedFieldId: fieldId };
          return cell.current;
        }),
      subscribe: () => () => {},
    };
  },
  placePdfSignatureFieldsBatch: (
    items: ReadonlyArray<PlacementQueueItem>,
    callbacks: PlacementBatchCallbacks,
  ) => testRuntime.placeBatch(items, callbacks),
  pdfSignatureBuilderSelectors: {
    template: (state: MockBuilderState) => state.template,
  },
}));

vi.mock("@signature-kit/pdf/liteparse-browser", () => ({
  liteParseWorkerBrowserLayer: Layer.empty,
  parsePdfTextBoxesBrowser: () => Effect.succeed([[]]),
}));

vi.mock("@signature-kit/pdf/workflow", () => ({
  createPdfSignatureBuilderStateFromBytes: () =>
    Effect.succeed({
      template: {
        documents: [{ pages: [{ height: 100, index: 0, width: 100 }] }],
        fields: [],
      },
    }),
  preparePdfSigningBatch: (input: PreparationInput) => testRuntime.prepareBatch(input),
  readPdfBlobBytes: () => testRuntime.readPdfBytes(),
  signPdfSignatureBatch: (items: ReadonlyArray<SigningItem>, callbacks: SigningCallbacks) =>
    testRuntime.signBatch(items, callbacks),
}));

vi.mock("@signature-kit/a1/signer", () => ({
  a1SignaturesLayer: () => Layer.empty,
  parseA1CertificateProfile: () => Effect.succeed({ subject: "" }),
}));

vi.mock("@/lib/posthog/client", () => ({
  captureDocsEvent: () => {},
  initDocsPostHog: () => {},
}));

vi.mock("@/lib/handwriting-font", () => ({
  caveat: { style: { fontFamily: "cursive" } },
}));

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, label: string, maxFrames = 240): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (predicate()) return;
    await rafTick();
  }

  expect(predicate(), label).toBe(true);
}

type MountedSigner = {
  readonly container: HTMLDivElement;
  readonly cleanup: () => void;
};

const mountSigner = (): MountedSigner => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  root.render(React.createElement(PdfSigner));

  return {
    container,
    cleanup: () => {
      root.unmount();
      container.remove();
    },
  };
};

async function selectPdf(container: HTMLDivElement, name: string): Promise<void> {
  await waitFor(
    () => container.querySelector('input[accept="application/pdf,.pdf"]') !== null,
    "PDF input to render",
  );
  const input = container.querySelector<HTMLInputElement>('input[accept="application/pdf,.pdf"]');
  if (input === null) expect.fail("PDF input was not rendered");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([new Uint8Array([1])], name, { type: "application/pdf" })],
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function uploadPdf(container: HTMLDivElement, name: string): Promise<void> {
  await waitFor(
    () => container.querySelector('input[accept="application/pdf,.pdf"]') !== null,
    "PDF input to render",
  );
  const input = container.querySelector<HTMLInputElement>('input[accept="application/pdf,.pdf"]');
  if (input === null) expect.fail("PDF input was not rendered");

  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([new Uint8Array([1])], name, { type: "application/pdf" })],
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));

  await waitFor(() => container.textContent?.includes(name) ?? false, `${name} is loaded`);
}

if (typeof document === "undefined") {
  describe.skip("PdfSigner (browser render)", () => {
    it("runs only through apps/docs/vitest.browser.config.ts", () => {});
  });
} else {
  describe("PdfSigner (browser render)", () => {
    let cleanup: (() => void) | undefined;

    afterEach(() => {
      cleanup?.();
      cleanup = undefined;
    });
    it("isolates runtime state and placement ownership between mounted signers", async () => {
      testRuntime.readPdfBytes.mockReset();
      testRuntime.readPdfBytes.mockReturnValue(Effect.succeed(new Uint8Array([1])));
      const pendingPlacement = Promise.withResolvers<void>();
      testRuntime.placeBatch = () => Effect.promise(() => pendingPlacement.promise.then(() => []));
      testRuntime.getDocument.mockReset();
      testRuntime.getDocument.mockReturnValue({
        destroy: testRuntime.taskDestroy,
        promise: Promise.resolve({ destroy: testRuntime.docDestroy }),
      });
      testRuntime.loadPdfjs.mockReset();
      testRuntime.loadPdfjs.mockResolvedValue({ getDocument: testRuntime.getDocument });

      const first = mountSigner();
      const second = mountSigner();
      cleanup = () => {
        first.cleanup();
        second.cleanup();
      };

      await uploadPdf(first.container, "first.pdf");
      expect(second.container.textContent).not.toContain("first.pdf");

      const firstPlaceButton = Array.from(
        first.container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.includes(m.signer_place_all({ count: 1 })) ?? false);
      if (firstPlaceButton === undefined)
        expect.fail("first auto-placement button was not rendered");
      firstPlaceButton.click();

      const firstPdfInput = first.container.querySelector<HTMLInputElement>(
        'input[accept="application/pdf,.pdf"]',
      );
      const secondPdfInput = second.container.querySelector<HTMLInputElement>(
        'input[accept="application/pdf,.pdf"]',
      );
      if (firstPdfInput === null || secondPdfInput === null) {
        expect.fail("both PDF inputs were not rendered");
      }
      await waitFor(() => firstPdfInput.disabled, "first signer to lock during placement");
      expect(secondPdfInput.disabled).toBe(false);

      pendingPlacement.resolve();
      await waitFor(() => !firstPdfInput.disabled, "first signer placement to finish");
    });

    it("ignores a deferred replacement operation after unmount and remount", async () => {
      const oldRead = Promise.withResolvers<Uint8Array>();
      testRuntime.readPdfBytes.mockReset();
      testRuntime.readPdfBytes.mockReturnValueOnce(
        Effect.promise(() =>
          oldRead.promise.then((bytes) => {
            const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
            copy.set(bytes);
            return copy;
          }),
        ),
      );
      testRuntime.readPdfBytes.mockReturnValue(Effect.succeed(new Uint8Array([2])));
      testRuntime.getDocument.mockReturnValue({
        destroy: testRuntime.taskDestroy,
        promise: Promise.resolve({ destroy: testRuntime.docDestroy }),
      });
      testRuntime.loadPdfjs.mockResolvedValue({ getDocument: testRuntime.getDocument });

      const oldSigner = mountSigner();
      await selectPdf(oldSigner.container, "old.pdf");
      await waitFor(() => testRuntime.readPdfBytes.mock.calls.length === 1, "old PDF read");
      oldSigner.cleanup();

      const freshSigner = mountSigner();
      cleanup = freshSigner.cleanup;
      oldRead.resolve(new Uint8Array([9]));
      await rafTick();
      await rafTick();

      expect(freshSigner.container.textContent).not.toContain("old.pdf");
    });

    it("keeps a loaded document across rerenders and releases it on unmount", async () => {
      testRuntime.docDestroy.mockClear();
      testRuntime.getDocument.mockClear();
      testRuntime.taskDestroy.mockClear();
      testRuntime.getDocument.mockReturnValue({
        destroy: testRuntime.taskDestroy,
        promise: Promise.resolve({ destroy: testRuntime.docDestroy }),
      });
      testRuntime.loadPdfjs.mockResolvedValue({ getDocument: testRuntime.getDocument });

      const signer = mountSigner();
      cleanup = signer.cleanup;
      await uploadPdf(signer.container, "rerender.pdf");
      await waitFor(
        () => testRuntime.getDocument.mock.calls.length === 1,
        "the initial PDF document load",
      );

      const stampName = signer.container.querySelector<HTMLElement>("#stamp-name");
      if (stampName === null) expect.fail("stamp-name control was not rendered");
      stampName.click();
      await rafTick();
      await rafTick();

      expect(testRuntime.getDocument).toHaveBeenCalledTimes(1);

      cleanup();
      cleanup = undefined;
      await waitFor(
        () => testRuntime.docDestroy.mock.calls.length === 1,
        "the resolved PDF document to be destroyed",
      );
      expect(testRuntime.taskDestroy).not.toHaveBeenCalled();
    });

    it("cancels an outstanding task and releases a document that resolves after unmount", async () => {
      testRuntime.docDestroy.mockClear();
      testRuntime.getDocument.mockClear();
      testRuntime.taskDestroy.mockClear();
      const pending = Promise.withResolvers();
      testRuntime.getDocument.mockReturnValue({
        destroy: testRuntime.taskDestroy,
        promise: pending.promise,
      });
      testRuntime.loadPdfjs.mockResolvedValue({ getDocument: testRuntime.getDocument });

      const signer = mountSigner();
      cleanup = signer.cleanup;
      await uploadPdf(signer.container, "cancel.pdf");
      await waitFor(
        () => testRuntime.getDocument.mock.calls.length === 1,
        "the outstanding PDF loading task",
      );

      cleanup();
      cleanup = undefined;
      await waitFor(
        () => testRuntime.taskDestroy.mock.calls.length === 1,
        "the outstanding PDF task to be destroyed",
      );

      pending.resolve({ destroy: testRuntime.docDestroy });
      await waitFor(
        () => testRuntime.docDestroy.mock.calls.length === 1,
        "the PDF document resolving after cancellation to be destroyed",
      );
      expect(testRuntime.taskDestroy).toHaveBeenCalledTimes(1);
      expect(testRuntime.docDestroy).toHaveBeenCalledTimes(1);
    });

    it("locks manual document mutations while auto-placement is pending", async () => {
      testRuntime.docDestroy.mockClear();
      testRuntime.getDocument.mockClear();
      testRuntime.placeField.mockClear();
      testRuntime.taskDestroy.mockClear();
      const pending = Promise.withResolvers<void>();
      testRuntime.getDocument.mockReturnValue({
        destroy: testRuntime.taskDestroy,
        promise: Promise.resolve({ destroy: testRuntime.docDestroy }),
      });
      testRuntime.loadPdfjs.mockResolvedValue({ getDocument: testRuntime.getDocument });
      testRuntime.placeBatch = () =>
        Effect.promise<ReadonlyArray<PlacementBatchResult>>(() => pending.promise.then(() => []));

      const signer = mountSigner();
      cleanup = signer.cleanup;
      await uploadPdf(signer.container, "lock.pdf");
      await waitFor(
        () => testRuntime.getDocument.mock.calls.length === 1,
        "the document preview before auto-placement",
      );

      const placeButton = Array.from(
        signer.container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.includes(m.signer_place_all({ count: 1 })) ?? false);
      if (placeButton === undefined) expect.fail("auto-placement button was not rendered");
      placeButton.click();

      const pdfInput = signer.container.querySelector<HTMLInputElement>(
        'input[accept="application/pdf,.pdf"]',
      );
      if (pdfInput === null) expect.fail("PDF input was not rendered");
      await waitFor(() => pdfInput.disabled, "document controls to lock during auto-placement");

      const removeButton = signer.container.querySelector<HTMLButtonElement>("button[aria-label]");
      if (removeButton === null) expect.fail("document removal button was not rendered");
      expect(removeButton.disabled).toBe(true);

      testRuntime.onPlace(0.5, 0.5);
      expect(testRuntime.placeField).not.toHaveBeenCalled();

      pending.resolve();
      await waitFor(() => !pdfInput.disabled, "document controls to unlock after auto-placement");
    });
    it("serializes deferred manual placement before auto-placement and signing", async () => {
      testRuntime.builderStates.length = 0;
      testRuntime.marker = undefined;
      testRuntime.docDestroy.mockClear();
      testRuntime.getDocument.mockClear();
      testRuntime.placeField.mockReset();
      const manualRect = { height: 20, pageIndex: 0, width: 60, x: 10, y: 10 };
      const autoRect = { height: 20, pageIndex: 0, width: 60, x: 30, y: 30 };
      const manualTemplate: MockTemplate = {
        documents: [{ pages: [{ height: 100, index: 0, width: 100 }] }],
        fields: [{ id: "a1-signature", rect: manualRect }],
      };
      const autoTemplate: MockTemplate = {
        documents: [{ pages: [{ height: 100, index: 0, width: 100 }] }],
        fields: [{ id: "a1-signature", rect: autoRect }],
      };
      const manualPlacement = Promise.withResolvers<MockTemplate>();
      testRuntime.placeField.mockReturnValue(Effect.promise(() => manualPlacement.promise));
      let autoCalls = 0;
      testRuntime.placeBatch = (items, callbacks) =>
        Effect.sync(() => {
          autoCalls += 1;
          const results: ReadonlyArray<PlacementBatchResult> = items.map((item) => ({
            id: item.id,
            ok: true,
            template: autoTemplate,
            field: { rect: autoRect },
          }));
          const builderState = testRuntime.builderStates[0];
          if (builderState !== undefined) {
            builderState.current = { ...builderState.current, template: autoTemplate };
          }
          results.forEach((result, index) => {
            const item = items[index];
            if (item === undefined) return;
            callbacks.onItemStarted?.(item, index, items.length);
            callbacks.onItemSettled?.(result, index, items.length);
          });
          return results;
        });
      testRuntime.getDocument.mockReturnValue({
        destroy: testRuntime.taskDestroy,
        promise: Promise.resolve({ destroy: testRuntime.docDestroy }),
      });
      testRuntime.loadPdfjs.mockResolvedValue({ getDocument: testRuntime.getDocument });

      const signer = mountSigner();
      cleanup = signer.cleanup;
      await uploadPdf(signer.container, "race.pdf");
      await waitFor(() => testRuntime.pageRenders > 0, "the current document canvas to render");

      testRuntime.onPlace(0.25, 0.25);
      await waitFor(
        () => testRuntime.placeField.mock.calls.length === 1,
        "the deferred manual placement to start",
      );
      const placeLabels = [1, 2, 3, 4].map((count) => m.signer_place_all({ count }));
      const placeButton = Array.from(
        signer.container.querySelectorAll<HTMLButtonElement>("button"),
      ).find(
        (button) =>
          placeLabels.some((label) => button.textContent?.includes(label)) ||
          button.textContent?.includes(m.signer_place_reposition()),
      );
      if (placeButton === undefined) expect.fail("auto-placement button was not rendered");
      placeButton.click();
      await rafTick();
      expect(autoCalls).toBe(0);

      manualPlacement.resolve(manualTemplate);
      await waitFor(() => autoCalls === 1, "auto-placement to run after manual placement settles");
      await waitFor(
        () => !(signer.container.textContent?.includes(m.signer_doc_not_placed()) ?? false),
        "the placed document state",
      );
      await waitFor(() => testRuntime.marker?.x === autoRect.x, "the final document marker");

      let preparedInput: PreparationInput | undefined;
      testRuntime.prepareBatch = (input) => {
        preparedInput = input;
        return Effect.succeed(
          input.documents.map((document) => ({ item: { id: document.id }, ok: true })),
        );
      };
      const pfxInput = signer.container.querySelector<HTMLInputElement>(
        'input[accept=".pfx,.p12,application/x-pkcs12"]',
      );
      if (pfxInput === null) expect.fail("certificate input was not rendered");
      Object.defineProperty(pfxInput, "files", {
        configurable: true,
        value: [new File([new Uint8Array([1])], "race.pfx")],
      });
      pfxInput.dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(
        () =>
          Array.from(signer.container.querySelectorAll<HTMLButtonElement>("button")).some(
            (button) => button.textContent?.includes(m.signer_replace_pfx()),
          ),
        "the selected certificate",
      );
      const password = signer.container.querySelector<HTMLInputElement>('input[type="password"]');
      if (password === null) expect.fail("certificate password input was not rendered");
      const passwordValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (passwordValueSetter === undefined) expect.fail("password value setter was not available");
      passwordValueSetter.call(password, "changeit");
      password.dispatchEvent(new Event("input", { bubbles: true }));
      const signLabels = [1, 2, 3, 4].map((count) =>
        m.signer_sign_button({
          count,
          noun: count === 1 ? m.signer_doc_one() : m.signer_doc_many(),
        }),
      );
      const isSignButton = (button: HTMLButtonElement): boolean =>
        !button.disabled && signLabels.some((label) => button.textContent?.includes(label));
      await waitFor(
        () =>
          Array.from(signer.container.querySelectorAll<HTMLButtonElement>("button")).some(
            isSignButton,
          ),
        "the enabled sign button",
      );
      const signButton = Array.from(
        signer.container.querySelectorAll<HTMLButtonElement>("button"),
      ).find(isSignButton);
      if (signButton === undefined) expect.fail("sign button was not rendered");
      signButton.click();
      await waitFor(() => preparedInput !== undefined, "the signing preparation input");

      const builderState = testRuntime.builderStates[0];
      if (builderState === undefined) expect.fail("the builder state was not captured");
      const preparedDocument = preparedInput?.documents[0];
      expect(builderState.current.template.fields[0]?.rect).toEqual(autoRect);
      expect(testRuntime.marker).toEqual(autoRect);
      expect(preparedDocument?.rect).toEqual(autoRect);
      expect(preparedDocument?.template?.fields[0]?.rect).toEqual(autoRect);
    });

    it("defers signed download URL revocation until after the click task", async () => {
      testRuntime.docDestroy.mockClear();
      testRuntime.getDocument.mockClear();
      testRuntime.placeBatch = () => Effect.succeed<ReadonlyArray<PlacementBatchResult>>([]);
      testRuntime.placeField.mockReset();
      testRuntime.placeField.mockReturnValue(
        Effect.succeed({
          documents: [{ pages: [{ height: 100, index: 0, width: 100 }] }],
          fields: [
            {
              id: "a1-signature",
              rect: { height: 20, pageIndex: 0, width: 60, x: 20, y: 20 },
            },
          ],
        }),
      );
      testRuntime.prepareBatch = (input) =>
        Effect.succeed(
          input.documents.map((document) => ({ item: { id: document.id }, ok: true })),
        );
      testRuntime.signStarted = false;
      testRuntime.resolveSigning = () => {};
      testRuntime.signBatch = (items, callbacks) => {
        const pending = Promise.withResolvers<void>();
        testRuntime.signStarted = true;
        testRuntime.resolveSigning = () => {
          const item = items[0];
          if (item !== undefined) {
            callbacks.onItemSettled(
              { id: item.id, ok: true, signedPdf: new Uint8Array([1]) },
              0,
              items.length,
            );
          }
          pending.resolve();
        };
        return Effect.promise(() => pending.promise);
      };
      testRuntime.getDocument.mockReturnValue({
        destroy: testRuntime.taskDestroy,
        promise: Promise.resolve({ destroy: testRuntime.docDestroy }),
      });
      testRuntime.loadPdfjs.mockResolvedValue({ getDocument: testRuntime.getDocument });
      testRuntime.pageRenders = 0;

      const signer = mountSigner();
      cleanup = signer.cleanup;
      await uploadPdf(signer.container, "download.pdf");
      await waitFor(
        () => testRuntime.getDocument.mock.calls.length === 1,
        "the document preview before signing",
      );
      await waitFor(() => testRuntime.pageRenders > 0, "the current document canvas to render");
      testRuntime.onPlace(0.5, 0.5);
      await waitFor(
        () => testRuntime.placeField.mock.calls.length === 1,
        "a manual signature placement",
      );
      await waitFor(
        () => !(signer.container.textContent?.includes(m.signer_doc_not_placed()) ?? false),
        "the placed document state",
      );

      const pfxInput = signer.container.querySelector<HTMLInputElement>(
        'input[accept=".pfx,.p12,application/x-pkcs12"]',
      );
      if (pfxInput === null) expect.fail("certificate input was not rendered");
      Object.defineProperty(pfxInput, "files", {
        configurable: true,
        value: [new File([new Uint8Array([1])], "signer.pfx")],
      });
      pfxInput.dispatchEvent(new Event("change", { bubbles: true }));

      await waitFor(
        () =>
          Array.from(signer.container.querySelectorAll<HTMLButtonElement>("button")).some(
            (button) => button.textContent?.includes(m.signer_replace_pfx()),
          ),
        "the selected certificate",
      );
      const password = signer.container.querySelector<HTMLInputElement>('input[type="password"]');
      if (password === null) expect.fail("certificate password input was not rendered");
      const passwordValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (passwordValueSetter === undefined) expect.fail("password value setter was not available");
      passwordValueSetter.call(password, "changeit");
      password.dispatchEvent(new Event("input", { bubbles: true }));

      const signLabels = [1, 2, 3, 4].map((count) =>
        m.signer_sign_button({
          count,
          noun: count === 1 ? m.signer_doc_one() : m.signer_doc_many(),
        }),
      );
      const isSignButton = (button: HTMLButtonElement): boolean =>
        !button.disabled && signLabels.some((label) => button.textContent?.includes(label));
      await waitFor(
        () =>
          Array.from(signer.container.querySelectorAll<HTMLButtonElement>("button")).some(
            isSignButton,
          ),
        "the enabled sign button",
      );
      const signButton = Array.from(
        signer.container.querySelectorAll<HTMLButtonElement>("button"),
      ).find(isSignButton);
      if (signButton === undefined) expect.fail("sign button was not rendered");
      signButton.click();
      await waitFor(() => testRuntime.signStarted, "the delayed signing batch to begin");

      const pdfInput = signer.container.querySelector<HTMLInputElement>(
        'input[accept="application/pdf,.pdf"]',
      );
      if (pdfInput === null) expect.fail("PDF input was not rendered");
      expect(pdfInput.disabled).toBe(true);

      testRuntime.resolveSigning();
      const downloadLabel = m.signer_download();
      await waitFor(
        () =>
          Array.from(signer.container.querySelectorAll<HTMLButtonElement>("button")).some(
            (button) => button.textContent?.includes(downloadLabel),
          ),
        "the signed document download control",
      );
      const downloadButton = Array.from(
        signer.container.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.includes(downloadLabel));
      if (downloadButton === undefined) expect.fail("download button was not rendered");

      const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:signed");
      const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      let revokeTask: (() => void) | undefined;
      const timerHandle = setTimeout(() => {}, 60_000);
      const scheduleRevoke = vi.spyOn(window, "setTimeout").mockImplementation((callback) => {
        if (typeof callback === "function") revokeTask = callback;
        return timerHandle;
      });

      downloadButton.click();
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      expect(revokeObjectUrl).not.toHaveBeenCalled();
      if (revokeTask === undefined) expect.fail("download URL revocation was not scheduled");
      revokeTask();
      clearTimeout(timerHandle);
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:signed");

      scheduleRevoke.mockRestore();
      revokeObjectUrl.mockRestore();
      createObjectUrl.mockRestore();
    });
  });
}
