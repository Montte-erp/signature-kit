import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { A4, makeDummyPdf } from "./helpers/dummy-pdf";
import { PdfPage, loadPdfjs } from "../components/pdf-page";
import { LocaleProvider } from "../components/locale-provider";
import type { PdfDocumentProxy, PdfPageRenderError } from "../components/pdf-page";

const rafTick = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

async function waitForFrames(
  predicate: () => boolean,
  label: string,
  maxFrames = 900,
): Promise<void> {
  for (let i = 0; i < maxFrames; i++) {
    if (predicate()) return;
    await rafTick();
  }
  return Promise.reject(new Error(`Timed out waiting for: ${label}`));
}

if (typeof document === "undefined") {
  describe.skip("PdfPage (browser render)", () => {
    it("runs only through apps/docs/vitest.browser.config.ts", () => {});
  });
} else {
  describe("PdfPage (browser render)", () => {
    let doc: PdfDocumentProxy | undefined;
    let container: HTMLDivElement | undefined;
    let root: Root | undefined;

    const ensureLoaded = async () => {
      if (doc) return;
      const pdfjs = await loadPdfjs();
      const bytes = await makeDummyPdf({ pages: 1, size: A4, label: "Browser dummy" });
      doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      expect(doc.numPages).toBe(1);
    };

    const mount = (ui: React.ReactElement) => {
      container = document.createElement("div");
      container.style.width = "400px";
      document.body.appendChild(container);
      root = createRoot(container);
      root.render(ui);
    };

    const cleanup = () => {
      root?.unmount?.();
      container?.remove();
      root = undefined;
      container = undefined;
    };

    const currentContainer = (): HTMLDivElement => {
      if (container !== undefined) return container;
      expect.fail("missing test container");
    };

    const currentDoc = (): PdfDocumentProxy => {
      if (doc !== undefined) return doc;
      expect.fail("pdf.js document was not loaded");
    };

    afterEach(async () => {
      cleanup();
      await doc?.destroy?.();
      doc = undefined;
    });

    const makeFakeDocument = (width: number, height: number): PdfDocumentProxy => ({
      getPage: async () => ({
        getViewport: () => ({ width, height, scale: 2 }),
        render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      }),
    });

    it("rasterises a real dummy PDF page onto the canvas and reports click fractions", async () => {
      await ensureLoaded();
      const placements: Array<[number, number]> = [];
      mount(
        React.createElement(PdfPage, {
          doc: currentDoc(),
          pageNumber: 1,
          widthPt: A4.width,
          heightPt: A4.height,
          onPlace: (fx: number, fy: number) => placements.push([fx, fy]),
        }),
      );

      const canvas = () => currentContainer().querySelector("canvas");
      await waitForFrames(() => {
        const c = canvas();
        return c !== null && c.width > A4.width && c.height > A4.height;
      }, "the pdf.js canvas to finish painting at render scale");

      const c = canvas();
      if (c === null) expect.fail("canvas missing after render");
      expect(c.width).toBeGreaterThan(A4.width);
      expect(c.height).toBeGreaterThan(A4.height);
      expect(c.width / c.height).toBeCloseTo(A4.width / A4.height, 1);

      const layer = currentContainer().querySelector<HTMLElement>('[role="button"]');
      if (layer === null) expect.fail("placement layer missing");
      const pointerDown = new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        isPrimary: true,
      });
      const pointerUp = new PointerEvent("pointerup", {
        bubbles: true,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        isPrimary: true,
      });
      layer.dispatchEvent(pointerDown);
      layer.dispatchEvent(pointerUp);
      await waitForFrames(() => placements.length > 0, "a placement from a deliberate click");
      const [fx, fy] = placements[0]!;
      expect(fx).toBeGreaterThanOrEqual(0);
      expect(fx).toBeLessThanOrEqual(1);
      expect(fy).toBeGreaterThanOrEqual(0);
      expect(fy).toBeLessThanOrEqual(1);

      cleanup();
    });

    it("cancels touch placement after scrolling beyond the movement tolerance", async () => {
      const placements: Array<[number, number]> = [];
      mount(
        React.createElement(PdfPage, {
          doc: makeFakeDocument(320, 480),
          pageNumber: 1,
          widthPt: 320,
          heightPt: 480,
          onPlace: (fx: number, fy: number) => placements.push([fx, fy]),
        }),
      );
      await waitForFrames(() => currentContainer().querySelector("canvas") !== null, "the canvas");
      const layer = currentContainer().querySelector<HTMLElement>('[role="button"]');
      if (layer === null) expect.fail("placement layer missing");

      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 20,
          clientY: 20,
          pointerId: 2,
          pointerType: "touch",
          isPrimary: true,
        }),
      );
      layer.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 40,
          clientY: 20,
          pointerId: 2,
          pointerType: "touch",
          isPrimary: true,
        }),
      );
      layer.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 40,
          clientY: 20,
          pointerId: 2,
          pointerType: "touch",
          isPrimary: true,
        }),
      );
      expect(placements).toEqual([]);

      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 20,
          clientY: 20,
          pointerId: 3,
          pointerType: "touch",
          isPrimary: true,
        }),
      );
      layer.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 20,
          clientY: 20,
          pointerId: 3,
          pointerType: "touch",
          isPrimary: true,
        }),
      );
      await waitForFrames(() => placements.length === 1, "the deliberate tap");
    });

    it("places from Enter, Space, and arrow keys", async () => {
      const placements: Array<[number, number]> = [];
      mount(
        React.createElement(PdfPage, {
          doc: makeFakeDocument(320, 480),
          pageNumber: 1,
          widthPt: 320,
          heightPt: 480,
          onPlace: (fx: number, fy: number) => placements.push([fx, fy]),
        }),
      );
      await waitForFrames(() => currentContainer().querySelector("canvas") !== null, "the canvas");
      const layer = currentContainer().querySelector<HTMLElement>('[role="button"]');
      if (layer === null) expect.fail("placement layer missing");

      for (const key of ["Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
        layer.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
      }
      expect(placements).toHaveLength(6);
      expect(placements[0]).toEqual([0.5, 0.5]);
      expect(placements[1]).toEqual([0.5, 0.5]);
      expect(placements[2]?.[0]).toBeCloseTo(0.48);
      expect(placements[3]?.[0]).toBeCloseTo(0.52);
      expect(placements[4]?.[1]).toBeCloseTo(0.48);
      expect(placements[5]?.[1]).toBeCloseTo(0.52);
    });

    it("announces disabled placement and blocks pointer and keyboard activation", async () => {
      const placements: Array<[number, number]> = [];
      mount(
        React.createElement(PdfPage, {
          doc: makeFakeDocument(320, 480),
          pageNumber: 1,
          widthPt: 320,
          heightPt: 480,
          disabled: true,
          onPlace: (fx: number, fy: number) => placements.push([fx, fy]),
        }),
      );
      await waitForFrames(() => currentContainer().querySelector("canvas") !== null, "the canvas");
      const layer = currentContainer().querySelector<HTMLElement>('[role="button"]');
      if (layer === null) expect.fail("placement layer missing");
      expect(layer.getAttribute("aria-disabled")).toBe("true");
      expect(layer.getAttribute("aria-label")).toContain("Signature placement is unavailable");
      expect(layer.getAttribute("tabindex")).toBe("0");

      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 20,
          clientY: 20,
          pointerId: 4,
          isPrimary: true,
        }),
      );
      layer.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 20,
          clientY: 20,
          pointerId: 4,
          isPrimary: true,
        }),
      );
      layer.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await rafTick();
      expect(placements).toEqual([]);
    });

    it("draws the signature marker overlay when a rect is placed", async () => {
      await ensureLoaded();
      const marker = {
        x: A4.width - 48 - 168,
        y: A4.height - 48 - 48,
        width: 168,
        height: 48,
      };
      mount(
        React.createElement(PdfPage, {
          doc: currentDoc(),
          pageNumber: 1,
          widthPt: A4.width,
          heightPt: A4.height,
          marker,
          onPlace: () => {},
        }),
      );

      await waitForFrames(() => {
        const c = currentContainer().querySelector("canvas");
        return c !== null && c.width > A4.width;
      }, "the pdf.js canvas to finish painting at render scale");

      await waitForFrames(
        () => currentContainer().textContent?.includes("Signature") ?? false,
        "the signature marker overlay",
      );
      expect(currentContainer().textContent).toContain("Signature");

      cleanup();
    });

    it("renders a typed visible error when loading a page fails", async () => {
      const errors: PdfPageRenderError[] = [];
      const failingDocument: PdfDocumentProxy = {
        getPage: async () => Promise.reject(new Error("page load failed")),
      };
      mount(
        React.createElement(PdfPage, {
          doc: failingDocument,
          pageNumber: 1,
          widthPt: A4.width,
          heightPt: A4.height,
          onPlace: () => {},
          onError: (error) => errors.push(error),
        }),
      );

      await waitForFrames(
        () => currentContainer().querySelector('[role="alert"]') !== null,
        "the page render error",
      );
      const alert = currentContainer().querySelector<HTMLElement>('[role="alert"]');
      if (alert === null) expect.fail("page render error was not rendered");
      expect(alert.dataset.pdfRenderError).toBe("pdf-page-load-failed");
      expect(alert.textContent).toContain("Unable to load this PDF page.");
      expect(errors).toHaveLength(1);
      expect(errors[0]?._tag).toBe("PdfPageRenderError");
      expect(errors[0]?.code).toBe("pdf-page-load-failed");
    });

    it("renders localized PDF page errors in pt-BR", async () => {
      const failingDocument: PdfDocumentProxy = {
        getPage: async () => Promise.reject(new Error("page load failed")),
      };
      mount(
        <LocaleProvider locale="pt-BR">
          <PdfPage
            doc={failingDocument}
            pageNumber={1}
            widthPt={A4.width}
            heightPt={A4.height}
            onPlace={() => {}}
          />
        </LocaleProvider>,
      );

      await waitForFrames(
        () => currentContainer().querySelector('[role="alert"]') !== null,
        "the localized page render error",
      );
      const alert = currentContainer().querySelector<HTMLElement>('[role="alert"]');
      if (alert === null) expect.fail("localized page render error was not rendered");
      expect(alert.textContent).toContain("Não foi possível carregar esta página do PDF.");
    });

    it("reports synchronous canvas render failures without an unhandled rejection", async () => {
      const errors: PdfPageRenderError[] = [];
      const failingDocument: PdfDocumentProxy = {
        getPage: async () => ({
          getViewport: () => ({ width: A4.width, height: A4.height, scale: 2 }),
          render: () => {
            throw new Error("render failed");
          },
        }),
      };
      const rejections: unknown[] = [];
      const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        rejections.push(event.reason);
        event.preventDefault();
      };
      window.addEventListener("unhandledrejection", onUnhandledRejection);

      try {
        mount(
          React.createElement(PdfPage, {
            doc: failingDocument,
            pageNumber: 1,
            widthPt: A4.width,
            heightPt: A4.height,
            onPlace: () => {},
            onError: (error) => errors.push(error),
          }),
        );

        await waitForFrames(
          () => currentContainer().querySelector('[role="alert"]') !== null,
          "the synchronous render error",
        );
        const alert = currentContainer().querySelector<HTMLElement>('[role="alert"]');
        if (alert === null) expect.fail("synchronous render error was not rendered");
        expect(alert.dataset.pdfRenderError).toBe("pdf-page-render-failed");
        expect(errors[0]?.code).toBe("pdf-page-render-failed");
        await rafTick();
        expect(rejections).toEqual([]);
      } finally {
        window.removeEventListener("unhandledrejection", onUnhandledRejection);
      }
    });

    it("keeps canvases isolated when two pages render concurrently", async () => {
      const firstDocument = makeFakeDocument(320, 480);
      const secondDocument = makeFakeDocument(480, 640);
      mount(
        React.createElement(
          "div",
          null,
          React.createElement(PdfPage, {
            doc: firstDocument,
            pageNumber: 1,
            widthPt: 320,
            heightPt: 480,
            onPlace: () => {},
          }),
          React.createElement(PdfPage, {
            doc: secondDocument,
            pageNumber: 1,
            widthPt: 480,
            heightPt: 640,
            onPlace: () => {},
          }),
        ),
      );

      await waitForFrames(
        () => currentContainer().querySelectorAll("canvas").length === 2,
        "both canvases",
      );
      const canvases = Array.from(currentContainer().querySelectorAll<HTMLCanvasElement>("canvas"));
      await waitForFrames(
        () => canvases[0]?.width === 320 && canvases[1]?.width === 480,
        "both isolated canvas renders",
      );
      expect(canvases.map((canvas) => canvas.width)).toEqual([320, 480]);
    });
  });
}
