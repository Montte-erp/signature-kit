import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
} from "@cantoo/pdf-lib";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { createIllustrativePdf } from "../src/stamp";
import { verifyPdfSignatures } from "../src/verify";
import { hasPdfByteRange } from "../src/byte-range";
import { PdfErrorCodeValue, PdfOperationValue } from "../src/config";

const extractText = async (bytes: Uint8Array) => {
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPages()[0]?.node.lookupMaybe(PDFName.of("Contents"), PDFArray);
  if (contents === undefined) return "";
  const segments: string[] = [];
  for (let index = 0; index < contents.size(); index++) {
    const stream = contents.lookupMaybe(index, PDFRawStream);
    if (stream === undefined) continue;
    const operators = new TextDecoder().decode(decodePDFRawStream(stream).decode());
    for (const match of operators.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g))
      if (match[1] !== undefined) segments.push(PDFHexString.of(match[1]).decodeText());
  }
  return segments.join(" ");
};

describe("illustrative PDF documents", () => {
  it("creates valid examples and visual marks without a cryptographic signature", async () => {
    for (const variant of ["line", "field", "witnessed", "initials"] satisfies (
      | "line"
      | "field"
      | "witnessed"
      | "initials"
    )[]) {
      const input = {
        title: "Example agreement",
        body: "A sample document.",
        variant,
        marked: false,
        markLabel: "DEMO MARK 2718",
      };
      const plain = await Effect.runPromise(createIllustrativePdf(input));
      const marked = await Effect.runPromise(createIllustrativePdf({ ...input, marked: true }));
      expect((await PDFDocument.load(plain)).getPageCount()).toBe(1);
      expect((await PDFDocument.load(marked)).getPageCount()).toBe(1);
      const plainText = await extractText(plain);
      const markedText = await extractText(marked);
      expect(plainText).toContain("Example agreement");
      expect(plainText).toContain(variant);
      expect(plainText).not.toContain("DEMO MARK 2718");
      expect(markedText).toContain("Example agreement");
      expect(markedText).toContain(variant);
      expect(markedText).toContain("DEMO MARK 2718");
      expect(hasPdfByteRange(marked)).toBe(false);
      const result = await Effect.runPromise(Effect.result(verifyPdfSignatures({ pdf: marked })));
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "PdfError",
          code: PdfErrorCodeValue.placeholderNotFound,
          operation: PdfOperationValue.verify,
          reason: "Failed to locate /ByteRange.",
        },
      });
    }
  });
  it("rejects malformed inputs with a typed error", async () => {
    const result = await Effect.runPromise(
      Effect.result(
        createIllustrativePdf({ title: "", body: "body", variant: "line", marked: false }),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.schemaName).toBe("PdfIllustrativeDocumentInput");
      expect(result.failure.issueMessage).toBeTruthy();
    }
  });
});
