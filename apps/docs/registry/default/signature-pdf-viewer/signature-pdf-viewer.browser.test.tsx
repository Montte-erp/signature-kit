import type { PdfSignaturePage, PdfSignatureRect } from "@signature-kit/pdf/config";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignaturePdfViewer } from "./signature-pdf-viewer";

vi.mock("react-pdf", () => ({
  Document: ({ children }: { readonly children: React.ReactNode }) => children,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {}, version: "test" },
}));

class ControlledLiteParseWorker extends EventTarget {
  posts = 0;
  terminated = false;

  constructor(_url: string | URL, _options?: WorkerOptions) {
    super();
    workers.push(this);
  }

  postMessage(_message: unknown): void {
    this.posts += 1;
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    terminatedWorkers += 1;
  }

  emitSuccess(result: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: { kind: "success", result } }));
  }

  emitFailure(): void {
    this.dispatchEvent(new Event("error"));
  }
}

type ViewerProps = React.ComponentProps<typeof SignaturePdfViewer>;

type MountedViewer = {
  readonly cleanup: () => void;
  readonly getButton: () => HTMLButtonElement | null;
  readonly getError: () => HTMLElement | null;
  readonly rerender: (props: ViewerProps) => void;
};

type RejectionCapture = {
  readonly reasons: unknown[];
  readonly stop: () => void;
};

const workers: ControlledLiteParseWorker[] = [];
const pages: ReadonlyArray<PdfSignaturePage> = [{ index: 0, width: 200, height: 100 }];
let cleanup: (() => void) | null = null;
let stopUnhandledRejections: (() => void) | null = null;
let terminatedWorkers = 0;

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitFor(predicate: () => boolean, label: string, maxFrames = 240): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (predicate()) return;
    await rafTick();
  }

  expect(predicate(), label).toBe(true);
}

const captureUnhandledRejections = (): RejectionCapture => {
  const reasons: unknown[] = [];
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    reasons.push(event.reason);
    event.preventDefault();
  };
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return {
    reasons,
    stop: () => window.removeEventListener("unhandledrejection", onUnhandledRejection),
  };
};

const workerResult = (x: number, y: number) => ({
  pages: [
    {
      pageNum: 1,
      textItems: [{ text: "SIGN_HERE", x, y, width: 40, height: 10 }],
    },
  ],
});

const viewerProps = (file: Uint8Array, onChange: ViewerProps["onChange"]): ViewerProps => ({
  anchorTokens: ["SIGN_HERE"],
  file,
  mode: "anchors",
  onChange,
  pages,
  stampSize: { width: 80, height: 20 },
  value: [],
});

const mountViewer = (props: ViewerProps): MountedViewer => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const rerender = (nextProps: ViewerProps): void => {
    root.render(<SignaturePdfViewer {...nextProps} />);
  };
  rerender(props);

  return {
    cleanup: () => {
      root.unmount();
      container.remove();
    },
    getButton: () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Find anchors",
      ) ?? null,
    getError: () => container.querySelector("p"),
    rerender,
  };
};

if (typeof document === "undefined") {
  describe.skip("SignaturePdfViewer browser scans", () => {
    it("runs only through apps/docs/vitest.browser.config.ts", () => {});
  });
} else {
  describe("SignaturePdfViewer browser scans", () => {
    beforeEach(() => {
      workers.splice(0);
      terminatedWorkers = 0;
      vi.stubGlobal("Worker", ControlledLiteParseWorker);
    });

    afterEach(() => {
      cleanup?.();
      cleanup = null;
      stopUnhandledRejections?.();
      stopUnhandledRejections = null;
      vi.unstubAllGlobals();
    });

    it("provides LiteParse at the scan boundary and emits the matched anchor rect", async () => {
      const changes: ReadonlyArray<PdfSignatureRect>[] = [];
      const viewer = mountViewer(
        viewerProps(new Uint8Array([1]), (rects) => {
          changes.push(rects);
        }),
      );
      cleanup = viewer.cleanup;

      await waitFor(() => viewer.getButton() !== null, "anchor scan button is rendered");
      const scanButton = viewer.getButton();
      if (scanButton === null) expect.fail("anchor scan button was not rendered");
      scanButton.click();
      await waitFor(
        () => viewer.getButton()?.disabled === true,
        "scan prevents duplicate requests",
      );

      await waitFor(
        () => workers[0]?.posts === 1,
        "the controlled LiteParse worker receives the scan request",
      );
      const worker = workers[0];
      if (worker === undefined) expect.fail("LiteParse worker was not created");
      worker.emitSuccess(workerResult(12, 25));

      await waitFor(() => changes.length === 1, "the anchor scan result is emitted");
      expect(changes).toEqual([[{ pageIndex: 0, x: 12, y: 39, width: 80, height: 20 }]]);
      await waitFor(() => terminatedWorkers === 1, "the completed LiteParse worker is released");
      expect(viewer.getButton()?.disabled).toBe(false);
      expect(viewer.getError()).toBeNull();
    });

    it("invalidates a delayed scan when the current document changes", async () => {
      const changes: ReadonlyArray<PdfSignatureRect>[] = [];
      const onChange: ViewerProps["onChange"] = (rects) => {
        changes.push(rects);
      };
      const viewer = mountViewer(viewerProps(new Uint8Array([1]), onChange));
      cleanup = viewer.cleanup;

      await waitFor(() => viewer.getButton() !== null, "anchor scan button is rendered");
      const firstButton = viewer.getButton();
      if (firstButton === null) expect.fail("first anchor scan button was not rendered");
      firstButton.click();
      await waitFor(() => workers[0]?.posts === 1, "the first worker receives its request");
      const firstWorker = workers[0];
      if (firstWorker === undefined) expect.fail("first LiteParse worker was not created");

      viewer.rerender(viewerProps(new Uint8Array([2]), onChange));
      await waitFor(
        () => viewer.getButton()?.disabled === false,
        "the changed document clears the prior scanning state",
      );
      const secondButton = viewer.getButton();
      if (secondButton === null) expect.fail("second anchor scan button was not rendered");
      secondButton.click();
      await waitFor(() => workers.length === 2, "the second LiteParse worker is created");

      await waitFor(() => workers[1]?.posts === 1, "the second worker receives its request");
      const secondWorker = workers[1];
      if (secondWorker === undefined) expect.fail("second LiteParse worker was not created");
      secondWorker.emitSuccess(workerResult(42, 30));

      await waitFor(() => changes.length === 1, "the current document emits its anchor result");
      firstWorker.emitSuccess(workerResult(6, 8));
      await rafTick();
      await rafTick();

      expect(changes).toEqual([[{ pageIndex: 0, x: 42, y: 44, width: 80, height: 20 }]]);
      expect(viewer.getError()).toBeNull();
    });

    it("leaves failed and aborted scans settled without unhandled rejections", async () => {
      const rejections = captureUnhandledRejections();
      stopUnhandledRejections = rejections.stop;
      const viewer = mountViewer(viewerProps(new Uint8Array([1]), () => {}));
      cleanup = viewer.cleanup;

      await waitFor(() => viewer.getButton() !== null, "anchor scan button is rendered");
      const failedButton = viewer.getButton();
      if (failedButton === null) expect.fail("failed anchor scan button was not rendered");
      failedButton.click();
      await waitFor(() => workers[0]?.posts === 1, "the failing worker receives its request");
      const failedWorker = workers[0];
      if (failedWorker === undefined) expect.fail("failing LiteParse worker was not created");
      failedWorker.emitFailure();

      await waitFor(() => viewer.getError() !== null, "the worker failure is rendered");
      expect(viewer.getButton()?.disabled).toBe(false);

      viewer.rerender(viewerProps(new Uint8Array([2]), () => {}));
      await waitFor(
        () => viewer.getError() === null,
        "the changed document resets the failure state",
      );
      const abortedButton = viewer.getButton();
      if (abortedButton === null) expect.fail("aborted anchor scan button was not rendered");
      abortedButton.click();
      await waitFor(() => workers[1]?.posts === 1, "the abortable worker receives its request");

      viewer.rerender(viewerProps(new Uint8Array([3]), () => {}));
      await waitFor(
        () => viewer.getButton()?.disabled === false,
        "the aborted scan clears the scanning state",
      );
      await rafTick();

      expect(rejections.reasons).toEqual([]);
    });
  });
}
