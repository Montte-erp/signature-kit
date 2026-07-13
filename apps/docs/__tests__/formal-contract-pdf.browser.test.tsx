import { pdfjs } from "react-pdf";
import { describe, expect, it } from "vitest";

import { SIGNATURE_VARIANTS, generateFormalContractPdf } from "../components/formal-contract-pdf";
import { loadPdfjs } from "../components/pdf-page";
import { isPdf } from "./helpers/dummy-pdf";

const PARAGRAPHS = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.",
];

const extractFirstPageText = async (bytes: Uint8Array): Promise<string> => {
  await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const documentProxy = await loadingTask.promise;
  try {
    const page = await documentProxy.getPage(1);
    const content = await page.getTextContent();
    return content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter((text) => text.length > 0)
      .join(" ");
  } finally {
    await documentProxy.destroy();
  }
};

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

    it.each(SIGNATURE_VARIANTS)(
      "preserves uploaded signer metadata in the '%s' variant",
      async (variant) => {
        const signedDocument = "CPF/CNPJ: 999.999.999-99";
        const bytes = await generateFormalContractPdf({
          title: "Procuração assinada",
          paragraphs: PARAGRAPHS,
          variant,
          signed: {
            name: "João de Azevedo",
            document: signedDocument,
            date: "26/06/2026 13:30",
          },
        });
        const text = await extractFirstPageText(bytes);

        expect(text).toContain(signedDocument);
        expect(text).not.toContain("CPF/CNPJ: 000.000.000-00");
        if (variant === "initials") expect(text).toContain("JA");
      },
      30000,
    );
  });
}
