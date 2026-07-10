import { describe, expect, it } from "@effect/vitest";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from "@cantoo/pdf-lib";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { findPdfTextAnchors } from "@signature-kit/pdf/anchors";
import type { PdfSignaturePage, PdfSignatureRect, PdfTextBox } from "@signature-kit/pdf/config";
import { mergePdfs } from "@signature-kit/pdf/merge";
import { signPdf } from "@signature-kit/pdf/sign";
import { deriveSignerInitials, stampPdfRubric } from "@signature-kit/pdf/stamp";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { prepareAndSignPdf } from "@signature-kit/pdf/workflow";
import { liteParseWorkerBrowserLayer } from "../src/liteparse-browser";
import { Effect, Layer, Redacted, Result } from "effect";
import { SignatureKitErrorCodeValue } from "@signature-kit/signatures";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { extractPdfSignature } from "../src/byte-range";
import { addSignaturePlaceholder } from "../src/placeholder";

const PASSWORD = Redacted.make("changeit");
const latin1 = new TextDecoder("latin1");

const createPdf = (sizes: ReadonlyArray<readonly [number, number]>): Effect.Effect<Uint8Array> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.create();
    for (const [width, height] of sizes) {
      const page = pdf.addPage([width, height]);
      page.drawText(`assinatura: CPF 123.456.789-01 ${width}x${height}`, {
        x: 24,
        y: height - 48,
        size: 12,
      });
    }
    return new Uint8Array(await pdf.save({ useObjectStreams: false }));
  });

const pageCount = (bytes: Uint8Array): Effect.Effect<number> =>
  Effect.promise(async () => (await PDFDocument.load(bytes)).getPageCount());

const pageSizes = (bytes: Uint8Array): Effect.Effect<ReadonlyArray<readonly [number, number]>> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.load(bytes);
    return pdf.getPages().map((page) => {
      const size = page.getSize();
      return [size.width, size.height];
    });
  });

const contentHexLength = (bytes: Uint8Array): number => {
  const text = latin1.decode(bytes);
  const marker = "/Contents <";
  const start = text.indexOf(marker);
  if (start === -1) return 0;
  const contentStart = start + marker.length;
  const end = text.indexOf(">", contentStart);
  return end === -1 ? 0 : end - contentStart;
};

const decodedFlateStreams = (bytes: Uint8Array): string => {
  const pdf = Buffer.from(bytes);
  const text = pdf.toString("latin1");
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    const filterIndex = text.indexOf("/Filter /FlateDecode", offset);
    if (filterIndex === -1) offset = text.length;
    if (filterIndex !== -1) {
      const dictionaryStart = text.lastIndexOf("<<", filterIndex);
      const streamMarker = text.indexOf("stream", filterIndex);
      const dictionaryText =
        dictionaryStart === -1 || streamMarker === -1
          ? ""
          : text.slice(dictionaryStart, streamMarker);
      const lengthText = /\/Length\s+(\d+)/.exec(dictionaryText)?.[1];
      if (streamMarker === -1 || lengthText === undefined) {
        offset = filterIndex + "/Filter /FlateDecode".length;
      } else {
        let dataStart = streamMarker + "stream".length;
        if (text[dataStart] === "\r" && text[dataStart + 1] === "\n") dataStart += 2;
        else if (text[dataStart] === "\n") dataStart += 1;
        const dataEnd = dataStart + Number.parseInt(lengthText, 10);
        if (!dictionaryText.includes("/Type /ObjStm")) {
          const decoded = inflateSync(pdf.subarray(dataStart, dataEnd)).toString("latin1");
          chunks.push(decoded);
        }
        offset = dataEnd;
      }
    }
  }
  return chunks.join("\n");
};

const countOccurrences = (text: string, needle: string): number => {
  const hexNeedle = Array.from(new TextEncoder().encode(needle))
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join("");
  return text.split(needle).length - 1 + text.split(hexNeedle).length - 1;
};

const signatureWidgetRects = (
  bytes: Uint8Array,
  pageIndex: number,
): Effect.Effect<ReadonlyArray<readonly [number, number, number, number]>> =>
  Effect.promise(async () => {
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPages()[pageIndex];
    if (page === undefined) return [];
    const annotations = page.node.Annots();
    if (annotations === undefined) return [];
    const rects: Array<readonly [number, number, number, number]> = [];
    for (let index = 0; index < annotations.size(); index += 1) {
      const annotation = pdf.context.lookupMaybe(annotations.get(index), PDFDict);
      const subtype = annotation?.lookupMaybe(PDFName.of("Subtype"), PDFName);
      const rect = annotation?.lookupMaybe(PDFName.of("Rect"), PDFArray);
      if (subtype?.toString() === "/Widget" && rect !== undefined) {
        rects.push([
          rect.lookup(0, PDFNumber).asNumber(),
          rect.lookup(1, PDFNumber).asNumber(),
          rect.lookup(2, PDFNumber).asNumber(),
          rect.lookup(3, PDFNumber).asNumber(),
        ]);
      }
    }
    return rects;
  });

describe("PDF DX helpers", () => {
  it.effect("finds text and digit anchors and clamps stamp rectangles", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf([[240, 120]]);
      const pages: PdfSignaturePage[] = [{ index: 0, width: 240, height: 120 }];
      const textBoxes: PdfTextBox[][] = [
        [
          { text: "assinatura:", x: 220, y: 100, width: 60, height: 12 },
          { text: "CPF 123.456.789-01", x: 12, y: 8, width: 100, height: 12 },
        ],
      ];

      const anchors = yield* findPdfTextAnchors({
        pdf,
        pages,
        textBoxes,
        matchers: [{ text: "assinatura:" }, { digits: "12345678901" }],
        stampSize: { width: 80, height: 32 },
        placement: "below",
        offset: 6,
      });

      expect(anchors).toHaveLength(2);
      expect(anchors[0]).toStrictEqual({ pageIndex: 0, x: 160, y: 88, width: 80, height: 32 });
      expect(anchors[1]).toStrictEqual({ pageIndex: 0, x: 12, y: 26, width: 80, height: 32 });
    }),
  );

  it.effect("merges PDFs while preserving page order and sizes", () =>
    Effect.gen(function* () {
      const first = yield* createPdf([[200, 100]]);
      const second = yield* createPdf([
        [300, 150],
        [400, 200],
      ]);
      const merged = yield* mergePdfs([first, second]);

      expect(yield* pageCount(merged)).toBe(3);
      expect(yield* pageSizes(merged)).toStrictEqual([
        [200, 100],
        [300, 150],
        [400, 200],
      ]);
    }),
  );

  it.effect("draws vector initials rubrics and derives Portuguese initials", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf([[320, 180]]);
      const stamped = yield* stampPdfRubric(pdf, {
        rect: [20, 20, 92, 52],
        pages: [0],
        initials: deriveSignerInitials("Ana e Maria dos Santos"),
      });
      const content = `${latin1.decode(stamped)}\n${decodedFlateStreams(stamped)}`;

      expect(deriveSignerInitials("Ana e Maria dos Santos")).toBe("AM");
      expect(deriveSignerInitials("x")).toBe("X");
      expect(stamped.byteLength).toBeGreaterThan(pdf.byteLength);
      expect(content).toMatch(/\sm\s/);
      expect(content).toMatch(/\sl\s/);
      expect(content).toMatch(/\s(Tj|TJ)\s/);
    }),
  );

  it.effect("reserves two Contents hex digits for each configured CMS byte", () =>
    Effect.gen(function* () {
      const pdf = yield* createPdf([[320, 180]]);
      const implicit = yield* addSignaturePlaceholder({ pdf, policy: "pades-icp-brasil" });
      const explicit = yield* addSignaturePlaceholder({
        pdf,
        policy: "pades-icp-brasil",
        signatureLength: 64,
      });

      expect(contentHexLength(implicit)).toBe(32768 * 2);
      expect(contentHexLength(explicit)).toBe(64 * 2);
    }),
  );

  it.effect("signs ICP-Brasil PDFs without app-side policy assembly", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createPdf([[320, 180]]);
      const signed = yield* signPdf({ pdf, policy: "pades-icp-brasil" }).pipe(
        Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
      );
      const extracted = yield* extractPdfSignature(signed);
      const verification = yield* verifyPdf({ pdf: signed });

      expect(extracted.signature.byteLength).toBeGreaterThan(0);
      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
    }),
  );

  it.effect(
    "re-signs an already-signed PDF with workflow-visible stamping without silently invalidating the prior signature",
    () =>
      Effect.gen(function* () {
        const pfx = yield* readA1Fixture("ecnpj");
        const base = yield* createPdf([[320, 180]]);
        const preSigned = yield* signPdf({ pdf: base, policy: "pades-icp-brasil" }).pipe(
          Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })),
        );
        const result = yield* Effect.result(
          prepareAndSignPdf({
            pdf: preSigned,
            pages: [{ index: 0, width: 320, height: 180 }],
            lines: ["RE-SIGN WORKFLOW"],
            signing: { policy: "pades-icp-brasil", reason: "DX workflow re-sign" },
          }).pipe(
            Effect.provide(
              Layer.merge(
                a1SignaturesLayer({ pfx, password: PASSWORD }),
                liteParseWorkerBrowserLayer,
              ),
            ),
          ),
        );

        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(SignatureKitErrorCodeValue.unsupportedOperation);
        } else {
          const verification = yield* verifyPdf({ pdf: result.success });
          expect(verification.signatureCount).toBe(2);
          expect(verification.valid).toBe(true);
        }
      }),
  );

  it.effect("prepares multiple stamp rects, and signs with the final stamp rect", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createPdf([
        [320, 180],
        [320, 180],
      ]);
      const pages: PdfSignaturePage[] = [
        { index: 0, width: 320, height: 180 },
        { index: 1, width: 320, height: 180 },
      ];
      const stampRects: PdfSignatureRect[] = [
        { pageIndex: 0, x: 24, y: 104, width: 150, height: 42 },
        { pageIndex: 1, x: 120, y: 104, width: 150, height: 42 },
      ];

      const signed = yield* prepareAndSignPdf({
        pdf,
        pages,
        stampRects,
        lines: ["DXSTAMP"],
        rubric: { initials: "AC" },
        signing: { policy: "pades-icp-brasil", reason: "DX workflow" },
      }).pipe(
        Effect.provide(
          Layer.merge(a1SignaturesLayer({ pfx, password: PASSWORD }), liteParseWorkerBrowserLayer),
        ),
      );
      const verification = yield* verifyPdf({ pdf: signed });
      const widgetRects = yield* signatureWidgetRects(signed, 1);
      const content = decodedFlateStreams(signed);

      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
      expect(countOccurrences(content, "DXSTAMP")).toBe(2);
      expect(widgetRects).toContainEqual([120, 34, 270, 76]);
    }),
  );

  it.effect("stamps rubric text only on pages without signature-rect coverage", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pages: PdfSignaturePage[] = [
        { index: 0, width: 320, height: 180 },
        { index: 1, width: 320, height: 180 },
        { index: 2, width: 320, height: 180 },
      ];
      const pdf = yield* createPdf(pages.map((page) => [page.width, page.height]));
      const pageTextBoxes: ReadonlyArray<ReadonlyArray<PdfTextBox>> = [
        [{ text: "ASSINATURA 0", x: 24, y: 132, width: 100, height: 12 }],
        [{ text: "ASSINATURA 1", x: 24, y: 132, width: 100, height: 12 }],
        [],
      ];

      const signed = yield* prepareAndSignPdf({
        pdf,
        pageTextBoxes,
        anchors: {
          matchers: [{ text: "ASSINATURA 0" }, { text: "ASSINATURA 1" }],
          stampSize: { width: 150, height: 42 },
        },
        rubric: { lines: ["RUBRIC_PAGE_3_ONLY"] },
        signing: { policy: "pades-icp-brasil", reason: "DX workflow with rubrics" },
      }).pipe(
        Effect.provide(
          Layer.merge(a1SignaturesLayer({ pfx, password: PASSWORD }), liteParseWorkerBrowserLayer),
        ),
      );
      const verification = yield* verifyPdf({ pdf: signed });
      const content = decodedFlateStreams(signed);

      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
      expect(countOccurrences(content, "RUBRIC_PAGE_3_ONLY")).toBe(1);
    }),
  );
});
