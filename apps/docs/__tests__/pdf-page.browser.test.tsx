import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { A4, makeDummyPdf } from "./helpers/dummy-pdf";
import { PdfPage, loadPdfjs } from "../components/pdf-page";
import type { PdfDocumentProxy } from "../components/pdf-page";


const rafTick = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

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
      await waitForFrames(
        () => {
          const c = canvas();
          return c !== null && c.width > A4.width && c.height > A4.height;
        },
        "the pdf.js canvas to finish painting at render scale",
      );

      const c = canvas();
      if (c === null) expect.fail("canvas missing after render");
      expect(c.width).toBeGreaterThan(A4.width);
      expect(c.height).toBeGreaterThan(A4.height);
      expect(c.width / c.height).toBeCloseTo(A4.width / A4.height, 1);

      const layer = currentContainer().querySelector<HTMLElement>('[role="button"]');
      if (layer === null) expect.fail("placement layer missing");
      layer.getBoundingClientRect();
      layer.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }),
      );
      await waitForFrames(() => placements.length > 0, "a placement from a click");
      const [fx, fy] = placements[0]!;
      expect(fx).toBeGreaterThanOrEqual(0);
      expect(fx).toBeLessThanOrEqual(1);
      expect(fy).toBeGreaterThanOrEqual(0);
      expect(fy).toBeLessThanOrEqual(1);

      cleanup();
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

      await waitForFrames(
        () => {
          const c = currentContainer().querySelector("canvas");
          return c !== null && c.width > A4.width;
        },
        "the pdf.js canvas to finish painting at render scale",
      );

      await waitForFrames(
        () => currentContainer().textContent?.includes("signature") ?? false,
        "the signature marker overlay",
      );
      expect(currentContainer().textContent).toContain("signature");

      cleanup();
    });
  });
}
