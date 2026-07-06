import { describe, expect, it } from "@effect/vitest";
import { inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
} from "@cantoo/pdf-lib";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signPdf } from "@signature-kit/pdf/sign";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { Effect, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import {
  layoutPdfSignatureBadge,
  rubricRectForPage,
  stampPdfRubric,
  stampPdfRubricOnPages,
  stampPdfVisibleSignature,
} from "../src/stamp";
import type { PdfSignatureBadgeLayoutRect, PdfSignatureBadgeTextRunLayout } from "../src/stamp";
import {
  PdfErrorCodeValue,
  type PdfCoordinateTuple,
  type PdfSignatureBadge,
  type PdfSignaturePage,
} from "../src/config";

const createThreePagePdf: Effect.Effect<Uint8Array> = Effect.promise(async () => {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) {
    const page = pdf.addPage([320, 180]);
    page.drawText(`Page ${index + 1}`, { x: 32, y: 150, size: 12 });
  }
  const bytes = await pdf.save({ useObjectStreams: false });
  return new Uint8Array(bytes);
});

const ONE_BY_ONE_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

const RUBRIC_RECT: PdfCoordinateTuple = [20, 20, 140, 64];
const LEGAL_PAGE: PdfSignaturePage = { index: 1, width: 612, height: 1008 };
const SIGNATURE_RECT = {
  pageIndex: 2,
  x: 320,
  y: 120,
  width: 168,
  height: 48,
};
const QR_SIGNATURE_RECT = {
  pageIndex: 2,
  x: 40,
  y: 60,
  width: 240,
  height: 72,
};
const QR_STAMP_LINES = [
  "ASSINADO DIGITALMENTE",
  "Signatário: Maria A. Costa",
  "Empresa: ACME Tecnologia LTDA",
  "CNPJ: 12.345.678/0001-90",
  "Data: 03/07/2026 10:30",
  "Certificado: ICP-Brasil (A1)",
  "------------------------------",
  "MP 2.200-2/2001 | Lei 14.063/2020 | validar.iti.gov.br",
];
const VALIDAR_ITI_URL = "https://validar.iti.gov.br";
const PASSWORD = Redacted.make("changeit");
const BADGE_STAMP: PdfSignatureBadge = {
  header: { text: "ASSINADO DIGITALMENTE" },
  rows: [
    [{ label: "Signatário", value: "Lucas Furtado Barbosa" }],
    [{ label: "Empresa", value: "VERSA SOLUCOES LTDA" }],
    [
      { label: "CNPJ", value: "60.278.873/0001-92" },
      { label: "Data", value: "01/06/2026 13:20:47" },
    ],
    [{ label: "Certificado", value: "ICP-Brasil (A1)" }],
  ],
  footer: [
    { text: "MP 2.200-2/2001" },
    { text: "Lei 14.063/2020" },
    { text: "Portaria ITI nº 22/2023" },
    { text: "validar.iti.gov.br", link: VALIDAR_ITI_URL },
    { text: "SignatureKit" },
  ],
  qr: { text: VALIDAR_ITI_URL },
};
const REFERENCE_BADGE_CONTAINER: PdfSignatureBadgeLayoutRect = {
  x: 76,
  y: 162,
  width: 460,
  height: 150,
};

type LinkAnnotation = {
  readonly uri: string;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

it("places repeated rubrics compactly in the right-side middle", () => {
  const rect = rubricRectForPage(LEGAL_PAGE);
  expect(rect).toStrictEqual({
    pageIndex: 1,
    x: 522,
    y: 488,
    width: 72,
    height: 32,
  });
});

it("nudges repeated rubrics away from LiteParse text boxes", () => {
  const centered = rubricRectForPage(LEGAL_PAGE);
  const textBox = {
    x: centered.x - 2,
    y: centered.y - 2,
    width: centered.width + 4,
    height: centered.height + 4,
  };
  const nudged = rubricRectForPage(LEGAL_PAGE, [textBox]);
  expect(nudged.x).toBe(centered.x);
  expect(nudged.y).not.toBe(centered.y);
  expect(textBox.y < nudged.y + nudged.height && textBox.y + textBox.height > nudged.y).toBe(false);
});

const pageCount = (bytes: Uint8Array): Effect.Effect<number> =>
  Effect.promise(async () => (await PDFDocument.load(bytes)).getPageCount());

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
          if (/(^|\n)(q|BT)\b|\scm\b|\srg\b|\sRG\b|\sTj\b/.test(decoded)) chunks.push(decoded);
        }
        offset = dataEnd;
      }
    }
  }
  return chunks.join("\n");
};

const linkAnnotationsForPage = (
  bytes: Uint8Array,
  pageIndex: number,
): Effect.Effect<ReadonlyArray<LinkAnnotation>> =>
  Effect.promise(async () => {
    const pdfDoc = await PDFDocument.load(bytes);
    const page = pdfDoc.getPages()[pageIndex];
    if (page === undefined) return [];
    const annots = page.node.Annots();
    if (annots === undefined) return [];
    const links: LinkAnnotation[] = [];
    for (let index = 0; index < annots.size(); index += 1) {
      const annotation = pdfDoc.context.lookupMaybe(annots.get(index), PDFDict);
      const subtype = annotation?.lookupMaybe(PDFName.of("Subtype"), PDFName);
      const action = annotation?.lookupMaybe(PDFName.of("A"), PDFDict);
      const uri = action?.lookupMaybe(PDFName.of("URI"), PDFString)?.decodeText();
      const rect = annotation?.lookupMaybe(PDFName.of("Rect"), PDFArray);
      if (subtype?.toString() === "/Link" && uri !== undefined && rect !== undefined) {
        const left = rect.lookup(0, PDFNumber).asNumber();
        const bottom = rect.lookup(1, PDFNumber).asNumber();
        const right = rect.lookup(2, PDFNumber).asNumber();
        const top = rect.lookup(3, PDFNumber).asNumber();
        links.push({
          uri,
          rect: { x: left, y: bottom, width: right - left, height: top - bottom },
        });
      }
    }
    return links;
  });
const GEOMETRY_EPSILON = 0.000001;

const expectRectInside = (
  rect: PdfSignatureBadgeLayoutRect,
  container: PdfSignatureBadgeLayoutRect,
): void => {
  expect(rect.width).toBeGreaterThanOrEqual(0);
  expect(rect.height).toBeGreaterThanOrEqual(0);
  expect(rect.x).toBeGreaterThanOrEqual(container.x - GEOMETRY_EPSILON);
  expect(rect.y).toBeGreaterThanOrEqual(container.y - GEOMETRY_EPSILON);
  expect(rect.x + rect.width).toBeLessThanOrEqual(container.x + container.width + GEOMETRY_EPSILON);
  expect(rect.y + rect.height).toBeLessThanOrEqual(
    container.y + container.height + GEOMETRY_EPSILON,
  );
};

const expectRunInside = (
  run: PdfSignatureBadgeTextRunLayout,
  container: PdfSignatureBadgeLayoutRect,
): void => {
  expectRectInside(run.rect, container);
};

describe("stampPdfRubric", () => {
  it.effect("stamps the rubric on every page and preserves the page count", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const stamped = yield* stampPdfRubric(pdf, {
        rect: RUBRIC_RECT,
        lines: ["TELEMACO CERIOLLI JUNIOR", "CPF/CNPJ: 767.081.102-10", "25/06/2026 19:00"],
      });
      expect(yield* pageCount(stamped)).toBe(3);
      expect(stamped.byteLength).toBeGreaterThan(pdf.byteLength);
    }),
  );

  it.effect("stamping more pages adds more content than stamping one", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const onePage = yield* stampPdfRubric(pdf, { rect: RUBRIC_RECT, pages: [0], lines: ["x"] });
      const allPages = yield* stampPdfRubric(pdf, {
        rect: RUBRIC_RECT,
        pages: "all",
        lines: ["x"],
      });
      expect(yield* pageCount(allPages)).toBe(3);
      expect(allPages.byteLength).toBeGreaterThan(onePage.byteLength);
    }),
  );

  it.effect("draws an embedded PNG rubric", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const stamped = yield* stampPdfRubric(pdf, {
        rect: RUBRIC_RECT,
        pages: [0],
        imagePng: ONE_BY_ONE_PNG,
        lines: ["Signed"],
      });
      expect(yield* pageCount(stamped)).toBe(3);
      expect(stamped.byteLength).toBeGreaterThan(pdf.byteLength);
    }),
  );

  it.effect("stamps side rubrics and the visible signature through PDF format APIs", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const pageDimensions: PdfSignaturePage[] = [
        { index: 0, width: 320, height: 180 },
        { index: 1, width: 320, height: 180 },
        { index: 2, width: 320, height: 180 },
      ];
      const withRubrics = yield* stampPdfRubricOnPages({
        pdf,
        pageDimensions,
        pages: [0, 1],
        imagePng: ONE_BY_ONE_PNG,
        border: false,
      });
      const stamped = yield* stampPdfVisibleSignature({
        pdf: withRubrics,
        pageIndex: 2,
        rect: SIGNATURE_RECT,
        lines: ["Maria A. Costa"],
        border: true,
      });

      expect(yield* pageCount(stamped)).toBe(3);
      expect(stamped.byteLength).toBeGreaterThan(pdf.byteLength);
    }),
  );

  it.effect("draws a vector QR stamp that remains valid after signing", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createThreePagePdf;
      const stamped = yield* stampPdfVisibleSignature({
        pdf,
        pageIndex: QR_SIGNATURE_RECT.pageIndex,
        rect: QR_SIGNATURE_RECT,
        lines: QR_STAMP_LINES,
        border: false,
        qr: { text: VALIDAR_ITI_URL },
      });
      const content = decodedFlateStreams(stamped);
      const filledPathOperators = content.match(/\sh\s/g)?.length ?? 0;
      const signed = yield* signPdf({
        pdf: stamped,
        reason: "SignatureKit QR stamp regression test",
        name: "Empresa CNPJ:12345678000195",
        signatureLength: 16384,
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
      const verification = yield* verifyPdf({ pdf: signed });

      expect(yield* pageCount(stamped)).toBe(3);
      expect(stamped.byteLength).toBeGreaterThan(pdf.byteLength);
      expect(filledPathOperators).toBeGreaterThan(100);
      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(1);
    }),
  );

  it.effect("lays out every structured badge element inside the badge container", () =>
    Effect.promise(async () => {
      const pdfDoc = await PDFDocument.create();
      const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const layout = layoutPdfSignatureBadge(
        BADGE_STAMP,
        REFERENCE_BADGE_CONTAINER,
        regularFont,
        boldFont,
      );
      const lastRow = layout.rows[layout.rows.length - 1];

      expect(layout.container).toStrictEqual(REFERENCE_BADGE_CONTAINER);
      expect(layout.headerSize).toBeGreaterThanOrEqual(13);
      expect(layout.headerSize).toBeLessThanOrEqual(14);
      expect(layout.rowSize).toBeGreaterThanOrEqual(9.5);
      expect(layout.rowSize).toBeLessThanOrEqual(10.5);
      expectRectInside(layout.textBlock, layout.container);
      expectRectInside(layout.header.rect, layout.container);
      expectRectInside(layout.header.padlock, layout.container);
      expectRunInside(layout.header.text, layout.container);
      expect(layout.qr).toBeDefined();
      if (layout.qr !== undefined) {
        expectRectInside(layout.qr, layout.container);
        expect(layout.qr.width).toBeCloseTo(layout.qr.height, 6);
        expect(layout.qr.height).toBeCloseTo(layout.textBlock.height, 6);
        expect(layout.qr.y).toBeCloseTo(layout.textBlock.y, 6);
        if (lastRow !== undefined) {
          expect(layout.qr.y).toBeGreaterThanOrEqual(lastRow.baseline - layout.padding);
        }
      }

      for (const row of layout.rows) {
        expectRectInside(row.rect, layout.container);
        for (const item of row.items) {
          if (item.separator !== undefined) expectRunInside(item.separator, layout.container);
          expectRunInside(item.label, layout.container);
          expectRunInside(item.value, layout.container);
        }
      }

      expect(layout.separator).toBeDefined();
      expect(layout.footer.rect).toBeDefined();
      if (layout.separator !== undefined && layout.footer.rect !== undefined) {
        const separatorY = layout.separator.y + layout.separator.height / 2;
        const footerTop = layout.footer.rect.y + layout.footer.rect.height;
        expectRectInside(layout.separator, layout.container);
        expect(layout.separator.x).toBeCloseTo(layout.container.x + layout.padding, 6);
        expect(layout.separator.width).toBeCloseTo(layout.container.width - layout.padding * 2, 6);
        expect(layout.footer.rect.y - layout.container.y).toBeCloseTo(layout.padding, 6);
        expect(layout.separator.y - footerTop).toBeCloseTo(layout.footerGap, 6);
        expect(layout.separator.y + layout.separator.height).toBeLessThanOrEqual(
          layout.textBlock.y - layout.separatorGap + GEOMETRY_EPSILON,
        );
        if (lastRow !== undefined) expect(separatorY).toBeLessThan(lastRow.baseline);
        expect(separatorY).toBeGreaterThan(footerTop);
      }

      let linkAnnotationCount = 0;
      if (layout.footer.rect !== undefined) expectRectInside(layout.footer.rect, layout.container);
      for (const line of layout.footer.lines) {
        expectRectInside(line.rect, layout.container);
        for (const item of line.segments) {
          if (item.separator !== undefined) expectRunInside(item.separator, layout.container);
          expectRunInside(item.text, layout.container);
          if (item.underline !== undefined) expectRectInside(item.underline, layout.container);
          if (item.annotation !== undefined) {
            expectRectInside(item.annotation, layout.container);
            linkAnnotationCount += 1;
          }
        }
      }
      expect(linkAnnotationCount).toBe(1);
    }),
  );

  it.effect(
    "draws a structured badge with rounded border, dashed separator, link annotation, and valid signing",
    () =>
      Effect.gen(function* () {
        const pfx = yield* readA1Fixture("ecnpj");
        const pdf = yield* createThreePagePdf;
        const stamped = yield* stampPdfVisibleSignature({
          pdf,
          pageIndex: QR_SIGNATURE_RECT.pageIndex,
          rect: QR_SIGNATURE_RECT,
          badge: BADGE_STAMP,
          border: false,
        });
        const content = decodedFlateStreams(stamped);
        const links = yield* linkAnnotationsForPage(stamped, QR_SIGNATURE_RECT.pageIndex);
        const signed = yield* signPdf({
          pdf: stamped,
          reason: "SignatureKit badge stamp regression test",
          name: "Empresa CNPJ:60278873000192",
          signatureLength: 16384,
        }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
        const verification = yield* verifyPdf({ pdf: signed });

        expect(content).toMatch(/\s[vy]\s/);
        expect(content).toMatch(/\[\s*4\s+4\s*\]\s+0\s+d/);
        expect(links).toHaveLength(1);
        expect(links[0]?.uri).toBe(VALIDAR_ITI_URL);
        expect(links[0]?.rect.x).toBeGreaterThan(QR_SIGNATURE_RECT.x);
        expect(links[0]?.rect.width).toBeGreaterThan(20);
        expect(links[0]?.rect.width).toBeLessThan(QR_SIGNATURE_RECT.width / 2);
        expect(links[0]?.rect.height).toBeLessThan(10);
        expect(verification.valid).toBe(true);
        expect(verification.signatureCount).toBe(1);
      }),
  );

  it.effect("scales long badge values without failing the stamp", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const result = yield* Effect.result(
        stampPdfVisibleSignature({
          pdf,
          pageIndex: QR_SIGNATURE_RECT.pageIndex,
          rect: QR_SIGNATURE_RECT,
          badge: {
            ...BADGE_STAMP,
            rows: [
              [
                {
                  label: "Signatário",
                  value:
                    "Lucas Furtado Barbosa com uma razão social muito longa para caber no selo",
                },
              ],
              [
                {
                  label: "Empresa",
                  value: "VERSA SOLUCOES LTDA COM NOME FANTASIA E UNIDADE OPERACIONAL EXTENSOS",
                },
              ],
              [
                { label: "CNPJ", value: "60.278.873/0001-92" },
                { label: "Data", value: "01/06/2026 13:20:47" },
              ],
              [{ label: "Certificado", value: "ICP-Brasil (A1)" }],
            ],
          },
        }),
      );

      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success.byteLength).toBeGreaterThan(pdf.byteLength);
      }
    }),
  );

  it.effect("keeps the legacy lines stamp content snapshot-stable", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const stamped = yield* stampPdfVisibleSignature({
        pdf,
        pageIndex: SIGNATURE_RECT.pageIndex,
        rect: SIGNATURE_RECT,
        lines: ["Maria A. Costa", "CPF/CNPJ: 123.456.789-00", "03/07/2026 10:30"],
        border: true,
      });

      expect(decodedFlateStreams(stamped)).toMatchSnapshot();
    }),
  );

  it.effect("fails with a typed PdfError when QR text exceeds the maximum version", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const result = yield* Effect.result(
        stampPdfVisibleSignature({
          pdf,
          pageIndex: QR_SIGNATURE_RECT.pageIndex,
          rect: QR_SIGNATURE_RECT,
          lines: QR_STAMP_LINES,
          qr: { text: "x".repeat(4000) },
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );

  it.effect("fails when a target page index is out of range", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const result = yield* Effect.result(
        stampPdfRubric(pdf, { rect: RUBRIC_RECT, pages: [5], lines: ["x"] }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );

  it.effect("fails when the rect has no area", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const result = yield* Effect.result(
        stampPdfRubric(pdf, { rect: [20, 20, 20, 64], lines: ["x"] }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );
});
