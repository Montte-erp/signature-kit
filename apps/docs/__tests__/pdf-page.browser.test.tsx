import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { makeDummyPdf, A4 } from "./helpers/dummy-pdf";
import type { PdfDocumentProxy, PdfPageProps } from "../components/pdf-page";

/**
 * Browser-mode placement test (run via apps/docs/vitest.browser.config.ts). The
 * shared `PdfPage` is the real pdf.js rendering surface used by BOTH the signing
 * modal (DocumentCanvas) and the auto-sign demo. Here it rasterises a real dummy
 * PDF page to a canvas, renders the signature marker overlay, and reports click
 * positions as page fractions.
 *
 * Like the other `*.browser.test.*` files in this repo, it self-skips under the
 * plain `vitest run` (node) discovery and only really runs in the Chromium
 * browser config — so the DOM-only / vite-`?url` imports stay inside the browser
 * branch and never break the node collection pass.
 */

const rafTick = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

/** Pump animation frames until `predicate` holds, with a real frame ceiling. */
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
    let PdfPage: React.ComponentType<PdfPageProps> | undefined;
    let container: HTMLDivElement | undefined;
    let root: Root | undefined;

    const ensureLoaded = async () => {
      if (doc) return;
      const pdfjs = await import("pdfjs-dist");
      // Vite serves the worker as a LOCAL asset (no CDN / network in the headless
      // browser), so the real rasteriser runs against our dummy PDF.
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      PdfPage = (await import("../components/pdf-page")).PdfPage;
      const bytes = await makeDummyPdf({ pages: 1, size: A4, label: "Browser dummy" });
      // pdf.js detaches the input buffer → slice so the source stays intact.
      doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      expect(doc.numPages).toBe(1);
    };

    const mount = (ui: React.ReactElement) => {
      container = document.createElement("div");
      container.style.width = "400px"; // concrete width for the aspect-ratio box
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

    const currentPdfPage = (): React.ComponentType<PdfPageProps> => {
      if (PdfPage !== undefined) return PdfPage;
      expect.fail("PdfPage was not loaded");
    };

    const currentDoc = (): PdfDocumentProxy => {
      if (doc !== undefined) return doc;
      expect.fail("pdf.js document was not loaded");
    };

    it("rasterises a real dummy PDF page onto the canvas and reports click fractions", async () => {
      await ensureLoaded();
      const placements: Array<[number, number]> = [];
      mount(
        React.createElement(currentPdfPage(), {
          doc: currentDoc(),
          pageNumber: 1,
          widthPt: A4.width,
          heightPt: A4.height,
          onPlace: (fx: number, fy: number) => placements.push([fx, fy]),
        }),
      );

      const canvas = () => currentContainer().querySelector("canvas");
      // scale = 2 in PdfPage → a finished render sizes the canvas WELL past the
      // default 300×150; wait for the real painted size, not just non-zero.
      await waitForFrames(
        () => {
          const c = canvas();
          return c !== null && c.width > A4.width && c.height > A4.height;
        },
        "the pdf.js canvas to finish painting at render scale",
      );

      const c = canvas();
      if (c === null) expect.fail("canvas missing after render");
      expect(c.width).toBeGreaterThan(A4.width); // ~1190
      expect(c.height).toBeGreaterThan(A4.height); // ~1684
      expect(c.width / c.height).toBeCloseTo(A4.width / A4.height, 1);

      // The placement layer reports clicks as page fractions (0..1).
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
        React.createElement(currentPdfPage(), {
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

      // The marker badge text ("signature") proves the overlay rendered.
      await waitForFrames(
        () => currentContainer().textContent?.includes("signature") ?? false,
        "the signature marker overlay",
      );
      expect(currentContainer().textContent).toContain("signature");

      cleanup();
    });
  });
}
