import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import {
  SIGNATURE_VARIANTS,
  formalSignatureRect,
  generateFormalContractPdf,
} from "../components/formal-contract-pdf";
import { isPdf } from "./helpers/dummy-pdf";

/**
 * Proves the REACT-PDF ("pdfx") path actually resolves — this is the exact path
 * that previously hung on "Generating…". If react-pdf's `pdf(...).toBlob()` ever
 * stalls, these fail on the per-test timeout instead of stalling forever.
 *
 * The signature field geometry is asserted too, so the canvas marker overlay and
 * the printed field stay on the same spot.
 */

const PARAGRAPHS = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.",
];

describe("generateFormalContractPdf (react-pdf / pdfx)", () => {
  it.each(SIGNATURE_VARIANTS)(
    "renders an UNSIGNED '%s' variant to valid A4 PDF bytes (no hang)",
    async (variant) => {
      const bytes = await generateFormalContractPdf({
        title: `Contrato (${variant})`,
        paragraphs: PARAGRAPHS,
        variant,
      });
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(isPdf(bytes)).toBe(true);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
      const [page] = doc.getPages();
      expect(page!.getWidth()).toBeCloseTo(595.28, 0);
      expect(page!.getHeight()).toBeCloseTo(841.89, 0);
    },
    15000,
  );

  it.each(SIGNATURE_VARIANTS)(
    "renders a SIGNED '%s' variant to valid PDF bytes",
    async (variant) => {
      const bytes = await generateFormalContractPdf({
        title: `Procuração (${variant})`,
        paragraphs: PARAGRAPHS,
        variant,
        signed: {
          name: "Maria A. Costa",
          document: "CPF/CNPJ: 000.000.000-00",
          date: "26/06/2026 13:30",
        },
      });
      expect(isPdf(bytes)).toBe(true);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
    },
    15000,
  );

  it("places the representative signature field inside the bottom of the A4 page", () => {
    const r = formalSignatureRect;
    expect(r.pageIndex).toBe(0);
    expect(r.x).toBeGreaterThan(0);
    expect(r.x + r.width).toBeLessThanOrEqual(595.28 - 56 + 0.01);
    expect(r.y).toBeGreaterThan(841.89 / 2); // bottom half (top-left origin)
    expect(r.y + r.height).toBeLessThan(841.89);
  });

  it("renders a document in a reasonable time", async () => {
    const start = performance.now();
    await generateFormalContractPdf({ title: "Speed", paragraphs: PARAGRAPHS, variant: "line" });
    expect(performance.now() - start).toBeLessThan(8000);
  }, 15000);
});
