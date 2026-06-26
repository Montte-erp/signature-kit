import { describe, expect, it } from "vitest";

import {
  SIGNATURE_VARIANTS,
  generateFormalContractPdf,
} from "../components/formal-contract-pdf";
import { isPdf } from "./helpers/dummy-pdf";

/**
 * REAL-BROWSER proof that react-pdf ("pdfx") actually resolves in the browser —
 * the environment a node test can't speak for (yoga wasm, fontkit, Blob). This is
 * the exact path behind the demo's "Generating…": if react-pdf ever hangs in
 * Chromium, these fail on the per-test timeout instead of spinning forever.
 *
 * Runs only via apps/docs/vitest.browser.config.ts; self-skips in the node pass.
 */

const PARAGRAPHS = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.",
];

if (typeof document === "undefined") {
  describe.skip("generateFormalContractPdf (browser)", () => {
    it("runs only through apps/docs/vitest.browser.config.ts", () => {});
  });
} else {
  describe("generateFormalContractPdf (real browser / react-pdf)", () => {
    it.each(SIGNATURE_VARIANTS)(
      "renders the '%s' variant to valid PDF bytes in Chromium (no hang)",
      async (variant) => {
        const bytes = await generateFormalContractPdf({
          title: `Contrato (${variant})`,
          paragraphs: PARAGRAPHS,
          variant,
        });
        expect(isPdf(bytes)).toBe(true);
        expect(bytes.byteLength).toBeGreaterThan(1000);
      },
      30000,
    );

    it(
      "renders a SIGNED contract in Chromium",
      async () => {
        const bytes = await generateFormalContractPdf({
          title: "Procuração assinada",
          paragraphs: PARAGRAPHS,
          variant: "field",
          signed: {
            name: "Maria A. Costa",
            document: "CPF/CNPJ: 000.000.000-00",
            date: "26/06/2026 13:30",
          },
        });
        expect(isPdf(bytes)).toBe(true);
      },
      30000,
    );
  });
}
