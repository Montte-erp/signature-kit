import { describe, expect, it } from "@effect/vitest";
import { deflateSync, inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  StandardFonts,
  degrees,
} from "@cantoo/pdf-lib";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { signPdf } from "@signature-kit/pdf/sign";
import { verifyPdf } from "@signature-kit/pdf/verify";
import { Effect, Redacted, Result } from "effect";
import { readA1Fixture } from "../../../tooling/testing/fixtures";
import { signPdf as signPdfFromSource } from "../src/sign";
import { preparePdfByteRange } from "../src/byte-range";
import { addSignaturePlaceholder } from "../src/placeholder";
import { verifyPdf as verifyPdfFromSource } from "../src/verify";
import {
  layoutPdfSignatureBadge,
  pdfCoordinateTupleFromTopLeftRect,
  topLeftRectFromPdfCoordinateTuple,
  visiblePdfPageSize,
  rubricPageIndexesExcludingSignature,
  rubricRectForPage,
  stampPdfRubric,
  stampPdfRubricOnPages,
  stampPdfVisibleSignature,
  stampPdfVisibleSignatures,
} from "../src/stamp";
import type { PdfSignatureBadgeLayoutRect, PdfSignatureBadgeTextRunLayout } from "../src/stamp";
import { PdfErrorCodeValue, PdfOperationValue } from "../src/config";
import type {
  PdfCoordinateTuple,
  PdfSignatureBadge,
  PdfSignaturePage,
  PdfVisibleStampInput,
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
const OVERSIZED_PNG_HEADER = Uint8Array.of(
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  0,
  0,
  0,
  13,
  73,
  72,
  68,
  82,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  255,
  8,
  6,
  0,
  0,
  0,
);

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const PNG_IHDR_TYPE = Uint8Array.of(73, 72, 68, 82);
const PNG_IDAT_TYPE = Uint8Array.of(73, 68, 65, 84);
const PNG_IEND_TYPE = Uint8Array.of(73, 69, 78, 68);
const PNG_ACTL_TYPE = Uint8Array.of(97, 99, 84, 76);
const PNG_FCTL_TYPE = Uint8Array.of(102, 99, 84, 76);
const PNG_FDAT_TYPE = Uint8Array.of(102, 100, 65, 84);

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: Uint8Array, data: Uint8Array): Uint8Array => {
  const chunk = new Uint8Array(data.byteLength + 12);
  const length = data.byteLength;
  chunk[0] = (length >>> 24) & 0xff;
  chunk[1] = (length >>> 16) & 0xff;
  chunk[2] = (length >>> 8) & 0xff;
  chunk[3] = length & 0xff;
  chunk.set(type, 4);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, data.byteLength + 8));
  chunk[data.byteLength + 8] = (crc >>> 24) & 0xff;
  chunk[data.byteLength + 9] = (crc >>> 16) & 0xff;
  chunk[data.byteLength + 10] = (crc >>> 8) & 0xff;
  chunk[data.byteLength + 11] = crc & 0xff;
  return chunk;
};

const pngWithIdat = (interlace: 0 | 1, inflated: Uint8Array): Uint8Array => {
  const ihdr = Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, interlace);
  const chunks = [
    PNG_SIGNATURE,
    pngChunk(PNG_IHDR_TYPE, ihdr),
    pngChunk(PNG_IDAT_TYPE, new Uint8Array(deflateSync(inflated))),
    pngChunk(PNG_IEND_TYPE, new Uint8Array()),
  ];
  const png = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return png;
};

const INTERLACED_ONE_BY_ONE_PNG = pngWithIdat(1, Uint8Array.of(0, 255, 255, 255, 255));
const compressedPngExpansionBomb = (): Uint8Array => pngWithIdat(0, new Uint8Array(1024 * 1024));

const apngWithHugeFrame = (): Uint8Array => {
  const frameCompressed = new Uint8Array(deflateSync(Uint8Array.of(0, 255, 255, 255, 255)));
  const frameData = new Uint8Array(4 + frameCompressed.byteLength);
  frameData.set(Uint8Array.of(0, 0, 0, 1));
  frameData.set(frameCompressed, 4);
  const chunks = [
    PNG_SIGNATURE,
    pngChunk(PNG_IHDR_TYPE, Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0)),
    pngChunk(PNG_ACTL_TYPE, Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 0)),
    pngChunk(
      PNG_FCTL_TYPE,
      Uint8Array.of(
        0,
        0,
        0,
        0,
        255,
        255,
        255,
        255,
        255,
        255,
        255,
        255,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        100,
        0,
        0,
      ),
    ),
    pngChunk(PNG_IDAT_TYPE, frameCompressed),
    pngChunk(PNG_FDAT_TYPE, frameData),
    pngChunk(PNG_IEND_TYPE, new Uint8Array()),
  ];
  const png = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return png;
};

const RUBRIC_RECT: PdfCoordinateTuple = [20, 20, 140, 64];
const LEGAL_PAGE: PdfSignaturePage = { index: 1, width: 612, height: 1008 };
const SIGNATURE_RECT = {
  pageIndex: 2,
  x: 140,
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
const MALICIOUS_PDF_TEXT = ") \\ ( /ByteRange /Contents — São Paulo ✓";
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

it("excludes rubric pages by their declared index", () => {
  const pages: PdfSignaturePage[] = [
    { index: 1, width: 600, height: 1000 },
    { index: 0, width: 320, height: 180 },
  ];

  expect(rubricPageIndexesExcludingSignature(pages, 1)).toStrictEqual([0]);
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
      const uri = action?.lookupMaybe(PDFName.of("URI"), PDFHexString)?.decodeText();
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
  it.effect("preserves existing signatures through default rubric helpers", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createThreePagePdf;
      const firstSigned = yield* signPdfFromSource({
        pdf,
        reason: "Initial rubric preservation signature",
        name: "Empresa CNPJ:60278873000192",
        signatureLength: 32768,
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
      const directlyRubriced = yield* stampPdfRubric(firstSigned, {
        rect: RUBRIC_RECT,
        pages: [0],
        lines: ["RUBRIC PRESERVATION"],
      });
      const pageRubriced = yield* stampPdfRubricOnPages({
        pdf: directlyRubriced,
        pageDimensions: [
          { index: 0, width: 320, height: 180 },
          { index: 1, width: 320, height: 180 },
          { index: 2, width: 320, height: 180 },
        ],
        pages: [1],
        lines: ["PAGE RUBRIC PRESERVATION"],
      });
      const reSigned = yield* signPdfFromSource({
        pdf: pageRubriced,
        reason: "Follow-up rubric preservation signature",
        name: "Empresa CNPJ:60278873000192",
        signatureLength: 32768,
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
      const verification = yield* verifyPdfFromSource({ pdf: reSigned });

      expect(verification.valid).toBe(true);
      expect(verification.signatureCount).toBe(2);
    }),
  );

  it.effect("keeps signed PDFs byte-identical for no-op rubric and visible stamps", () =>
    Effect.gen(function* () {
      const pfx = yield* readA1Fixture("ecnpj");
      const pdf = yield* createThreePagePdf;
      const signed = yield* signPdfFromSource({
        pdf,
        reason: "No-op stamp preservation signature",
        name: "Empresa CNPJ:60278873000192",
        signatureLength: 32768,
      }).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: PASSWORD })));
      const noTargetRubric = yield* stampPdfRubric(signed, {
        rect: RUBRIC_RECT,
        pages: [],
        border: false,
      });
      const noContentRubric = yield* stampPdfRubric(signed, {
        rect: RUBRIC_RECT,
        pages: [0],
        border: false,
        lines: [],
      });
      const noTargetPageRubric = yield* stampPdfRubricOnPages({
        pdf: signed,
        pageDimensions: [
          { index: 0, width: 320, height: 180 },
          { index: 1, width: 320, height: 180 },
          { index: 2, width: 320, height: 180 },
        ],
        pages: [],
        border: false,
        lines: [],
      });
      const noContentVisible = yield* stampPdfVisibleSignature({
        pdf: signed,
        pageIndex: 0,
        rect: { pageIndex: 0, x: 20, y: 20, width: 80, height: 40 },
        border: false,
        lines: [],
      });
      const [noTargetVerification, noContentVerification, visibleVerification] = yield* Effect.all([
        verifyPdfFromSource({ pdf: noTargetRubric }),
        verifyPdfFromSource({ pdf: noContentRubric }),
        verifyPdfFromSource({ pdf: noContentVisible }),
      ]);

      expect(noTargetRubric).toStrictEqual(signed);
      expect(noContentRubric).toStrictEqual(signed);
      expect(noTargetPageRubric).toStrictEqual(signed);
      expect(noContentVisible).toStrictEqual(signed);
      expect(noTargetVerification.valid).toBe(true);
      expect(noContentVerification.valid).toBe(true);
      expect(visibleVerification.valid).toBe(true);
    }),
  );

  it.effect("validates malformed empty visible stamps before no-op handling", () =>
    Effect.gen(function* () {
      const malformedInput: PdfVisibleStampInput = {
        pdf: new Uint8Array([1, 2, 3]),
        pageIndex: 0,
        rect: { pageIndex: 0, x: 0, y: 0, width: 80, height: 40 },
        border: false,
        lines: [],
      };
      expect(Reflect.set(malformedInput, "pdf", "not-a-pdf")).toBe(true);
      expect(Reflect.set(malformedInput, "pageIndex", Number.NaN)).toBe(true);
      expect(Reflect.set(malformedInput.rect, "pageIndex", Number.NaN)).toBe(true);
      const result = yield* Effect.result(stampPdfVisibleSignature(malformedInput));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );
  it.effect("rejects empty batches and malformed later visible stamp targets", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const emptyInput: Parameters<typeof stampPdfVisibleSignatures>[0] = {
        pdf,
        stamps: [{ pageIndex: 0, rect: { pageIndex: 0, x: 20, y: 20, width: 80, height: 40 } }],
        lines: ["x"],
      };
      const malformedLaterInput: Parameters<typeof stampPdfVisibleSignatures>[0] = {
        pdf,
        stamps: [
          { pageIndex: 0, rect: { pageIndex: 0, x: 20, y: 20, width: 80, height: 40 } },
          { pageIndex: 1, rect: { pageIndex: 1, x: 20, y: 20, width: 80, height: 40 } },
        ],
        lines: ["x"],
      };
      expect(Reflect.set(emptyInput.stamps, "length", 0)).toBe(true);
      expect(Reflect.set(malformedLaterInput.stamps, 1, undefined)).toBe(true);
      const [empty, malformedLater] = yield* Effect.all([
        Effect.result(stampPdfVisibleSignatures(emptyInput, false)),
        Effect.result(stampPdfVisibleSignatures(malformedLaterInput, false)),
      ]);

      for (const result of [empty, malformedLater]) {
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
        }
      }
    }),
  );

  it.effect("rejects conflicting initials rubric modes", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const lineConflict = yield* Effect.result(
        stampPdfRubric(pdf, {
          rect: RUBRIC_RECT,
          pages: [0],
          initials: "AB",
          lines: ["CONFLICT"],
        }),
      );
      const imageConflict = yield* Effect.result(
        stampPdfRubric(pdf, {
          rect: RUBRIC_RECT,
          pages: [0],
          initials: "AB",
          imagePng: ONE_BY_ONE_PNG,
        }),
      );

      expect(Result.isFailure(lineConflict)).toBe(true);
      expect(Result.isFailure(imageConflict)).toBe(true);
      if (Result.isFailure(lineConflict)) {
        expect(lineConflict.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
      if (Result.isFailure(imageConflict)) {
        expect(imageConflict.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );

  it.effect("rejects legacy visible fields combined with badge mode", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const base = {
        pdf,
        pageIndex: SIGNATURE_RECT.pageIndex,
        rect: SIGNATURE_RECT,
        badge: BADGE_STAMP,
      };
      const [lines, inkPng, qr, border, batch] = yield* Effect.all([
        Effect.result(stampPdfVisibleSignature({ ...base, lines: ["legacy"] })),
        Effect.result(stampPdfVisibleSignature({ ...base, inkPng: ONE_BY_ONE_PNG })),
        Effect.result(stampPdfVisibleSignature({ ...base, qr: { text: "legacy" } })),
        Effect.result(stampPdfVisibleSignature({ ...base, border: false })),
        Effect.result(
          stampPdfVisibleSignatures(
            {
              pdf,
              stamps: [{ pageIndex: SIGNATURE_RECT.pageIndex, rect: SIGNATURE_RECT }],
              badge: BADGE_STAMP,
              inkPng: ONE_BY_ONE_PNG,
            },
            false,
          ),
        ),
      ]);

      for (const result of [lines, inkPng, qr, border, batch]) {
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
        }
      }
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
      expect(ONE_BY_ONE_PNG[28]).toBe(0);
      expect(yield* pageCount(stamped)).toBe(3);
      expect(stamped.byteLength).toBeGreaterThan(pdf.byteLength);
    }),
  );

  it.effect("draws an embedded interlaced PNG rubric", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const stamped = yield* stampPdfRubric(pdf, {
        rect: RUBRIC_RECT,
        pages: [0],
        imagePng: INTERLACED_ONE_BY_ONE_PNG,
      });

      expect(stamped.byteLength).toBeGreaterThan(pdf.byteLength);
    }),
  );

  it.effect("rejects oversized PNG dimensions before image decoding", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const rubric = yield* Effect.result(
        stampPdfRubric(pdf, {
          rect: RUBRIC_RECT,
          pages: [0],
          border: false,
          imagePng: OVERSIZED_PNG_HEADER,
        }),
      );
      const visible = yield* Effect.result(
        stampPdfVisibleSignature({
          pdf,
          pageIndex: SIGNATURE_RECT.pageIndex,
          rect: SIGNATURE_RECT,
          border: false,
          inkPng: OVERSIZED_PNG_HEADER,
        }),
      );

      expect(Result.isFailure(rubric)).toBe(true);
      expect(Result.isFailure(visible)).toBe(true);
      if (Result.isFailure(rubric)) {
        expect(rubric.failure.code).toBe(PdfErrorCodeValue.stampFailed);
        expect(rubric.failure.operation).toBe(PdfOperationValue.stamp);
        expect(rubric.failure.reason).toBe(
          "PNG image exceeds supported input or decoded pixel limits.",
        );
      }
      if (Result.isFailure(visible)) {
        expect(visible.failure.code).toBe(PdfErrorCodeValue.stampFailed);
        expect(visible.failure.operation).toBe(PdfOperationValue.stamp);
        expect(visible.failure.reason).toBe(
          "PNG image exceeds supported input or decoded pixel limits.",
        );
      }
    }),
  );

  it.effect("rejects compressed PNG output beyond its filtered scanlines", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const result = yield* Effect.result(
        stampPdfRubric(pdf, {
          rect: RUBRIC_RECT,
          pages: [0],
          border: false,
          imagePng: compressedPngExpansionBomb(),
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );
  it.effect("rejects animated PNG frame chunks before image decoding", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const result = yield* Effect.result(
        stampPdfVisibleSignature({
          pdf,
          pageIndex: SIGNATURE_RECT.pageIndex,
          rect: SIGNATURE_RECT,
          border: false,
          inkPng: apngWithHugeFrame(),
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );

  it.effect("resolves reordered rubric metadata by declared page index", () =>
    Effect.gen(function* () {
      const pdf = yield* Effect.promise(async () => {
        const pdfDoc = await PDFDocument.create();
        pdfDoc.addPage([320, 180]);
        pdfDoc.addPage([600, 1000]);
        return new Uint8Array(await pdfDoc.save({ useObjectStreams: false }));
      });
      const reordered = yield* stampPdfRubricOnPages({
        pdf,
        pageDimensions: [
          { index: 1, width: 600, height: 1000 },
          { index: 0, width: 320, height: 180 },
        ],
        pages: [0],
        lines: ["REORDERED RUBRIC"],
      });
      const missing = yield* Effect.result(
        stampPdfRubricOnPages({
          pdf,
          pageDimensions: [{ index: 1, width: 600, height: 1000 }],
          pages: [0],
          lines: ["MISSING METADATA"],
        }),
      );
      const duplicate = yield* Effect.result(
        stampPdfRubricOnPages({
          pdf,
          pageDimensions: [
            { index: 0, width: 320, height: 180 },
            { index: 0, width: 320, height: 180 },
          ],
          pages: [0],
          lines: ["DUPLICATE METADATA"],
        }),
      );

      expect(reordered.byteLength).toBeGreaterThan(pdf.byteLength);
      expect(Result.isFailure(missing)).toBe(true);
      expect(Result.isFailure(duplicate)).toBe(true);
      if (Result.isFailure(missing)) {
        expect(missing.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
      if (Result.isFailure(duplicate)) {
        expect(duplicate.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
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
  it.effect("truncates unbreakable badge values before they leave the badge", () =>
    Effect.promise(async () => {
      const pdfDoc = await PDFDocument.create();
      const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const value = "X".repeat(1000);
      const layout = layoutPdfSignatureBadge(
        {
          ...BADGE_STAMP,
          rows: [[{ label: "Signatário", value }]],
        },
        REFERENCE_BADGE_CONTAINER,
        regularFont,
        boldFont,
      );
      const item = layout.rows[0]?.items[0];

      expect(item).toBeDefined();
      if (item !== undefined) {
        expectRectInside(layout.rows[0]!.rect, layout.container);
        expectRunInside(item.label, layout.container);
        expectRunInside(item.value, layout.container);
        expect(item.value.text).not.toBe(value);
        expect(item.value.text).toMatch(/\.\.\.$/);
        expect(regularFont.widthOfTextAtSize(item.value.text, layout.rowSize)).toBeLessThanOrEqual(
          item.value.rect.width + GEOMETRY_EPSILON,
        );
      }
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

  it.effect("round-trips untrusted badge URIs without PDF syntax injection", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const stamped = yield* stampPdfVisibleSignature({
        pdf,
        pageIndex: QR_SIGNATURE_RECT.pageIndex,
        rect: QR_SIGNATURE_RECT,
        badge: {
          ...BADGE_STAMP,
          footer: [{ text: "Verificar", link: MALICIOUS_PDF_TEXT }],
        },
      });
      const links = yield* linkAnnotationsForPage(stamped, QR_SIGNATURE_RECT.pageIndex);
      const roundTripped = yield* Effect.promise(async () => {
        const reloaded = await PDFDocument.load(stamped);
        return new Uint8Array(await reloaded.save({ useObjectStreams: false }));
      });
      const roundTrippedLinks = yield* linkAnnotationsForPage(
        roundTripped,
        QR_SIGNATURE_RECT.pageIndex,
      );

      expect(links).toHaveLength(1);
      expect(links[0]?.uri).toBe(MALICIOUS_PDF_TEXT);
      expect(roundTrippedLinks).toHaveLength(1);
      expect(roundTrippedLinks[0]?.uri).toBe(MALICIOUS_PDF_TEXT);
      expect(Buffer.from(stamped).toString("latin1")).not.toContain(MALICIOUS_PDF_TEXT);
    }),
  );

  it.effect("preserves one signature dictionary and untrusted PDF text round trips", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const stamped = yield* stampPdfVisibleSignature({
        pdf,
        pageIndex: QR_SIGNATURE_RECT.pageIndex,
        rect: QR_SIGNATURE_RECT,
        badge: {
          ...BADGE_STAMP,
          footer: [{ text: "Verificar", link: MALICIOUS_PDF_TEXT }],
        },
      });
      const placeholder = yield* addSignaturePlaceholder({
        pdf: stamped,
        signatureLength: 64,
        reason: MALICIOUS_PDF_TEXT,
        contactInfo: `Contato ${MALICIOUS_PDF_TEXT}`,
        name: `Nome ${MALICIOUS_PDF_TEXT}`,
        location: `Local ${MALICIOUS_PDF_TEXT}`,
      });
      const prepared = yield* preparePdfByteRange(placeholder);
      const metadata = yield* Effect.promise(async () => {
        const pdfDoc = await PDFDocument.load(prepared.pdf);
        const acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
        const fields = acroForm?.lookupMaybe(PDFName.of("Fields"), PDFArray);
        const field =
          fields === undefined ? undefined : pdfDoc.context.lookupMaybe(fields.get(0), PDFDict);
        const signature = field?.lookupMaybe(PDFName.of("V"), PDFDict);
        return {
          reason: signature?.lookupMaybe(PDFName.of("Reason"), PDFHexString)?.decodeText(),
          contactInfo: signature
            ?.lookupMaybe(PDFName.of("ContactInfo"), PDFHexString)
            ?.decodeText(),
          name: signature?.lookupMaybe(PDFName.of("Name"), PDFHexString)?.decodeText(),
          location: signature?.lookupMaybe(PDFName.of("Location"), PDFHexString)?.decodeText(),
        };
      });
      const links = yield* linkAnnotationsForPage(prepared.pdf, QR_SIGNATURE_RECT.pageIndex);
      const rawPdf = Buffer.from(prepared.pdf).toString("latin1");
      expect(rawPdf).not.toContain(MALICIOUS_PDF_TEXT);

      expect([...rawPdf.matchAll(/\/Type\s*\/Sig\b/g)]).toHaveLength(1);
      expect([...rawPdf.matchAll(/\/ByteRange\b/g)]).toHaveLength(1);
      expect(metadata).toStrictEqual({
        reason: MALICIOUS_PDF_TEXT,
        contactInfo: `Contato ${MALICIOUS_PDF_TEXT}`,
        name: `Nome ${MALICIOUS_PDF_TEXT}`,
        location: `Local ${MALICIOUS_PDF_TEXT}`,
      });
      expect(links).toHaveLength(1);
      expect(links[0]?.uri).toBe(MALICIOUS_PDF_TEXT);
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
  it.effect("maps visible stamps through the rotated CropBox coordinate system", () =>
    Effect.gen(function* () {
      const rect = { pageIndex: 0, x: 0, y: 0, width: 80, height: 40 };
      const geometry = yield* Effect.promise(async () => {
        const cropOnlyDoc = await PDFDocument.create();
        const cropOnlyPage = cropOnlyDoc.addPage([400, 400]);
        cropOnlyPage.setCropBox(100, 100, 200, 160);
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([400, 400]);
        page.setCropBox(100, 100, 200, 160);
        page.setRotation(degrees(90));
        const rotatedWidgetRect = pdfCoordinateTupleFromTopLeftRect(rect, page);
        return {
          pdf: new Uint8Array(await pdfDoc.save({ useObjectStreams: false })),
          cropOnlyPdf: new Uint8Array(await cropOnlyDoc.save({ useObjectStreams: false })),
          cropOnlyPageSize: visiblePdfPageSize(cropOnlyPage),
          rotatedPageSize: visiblePdfPageSize(page),
          cropOnlyWidgetRect: pdfCoordinateTupleFromTopLeftRect(rect, cropOnlyPage),
          rotatedWidgetRect,
          rotatedVisibleRect: topLeftRectFromPdfCoordinateTuple(rotatedWidgetRect, page),
        };
      });
      const stamped = yield* stampPdfVisibleSignature({
        pdf: geometry.pdf,
        pageIndex: 0,
        rect,
        lines: ["ROTATED CROPBOX"],
      });
      const cropOnlyStamped = yield* stampPdfVisibleSignature({
        pdf: geometry.cropOnlyPdf,
        pageIndex: 0,
        rect,
        lines: ["CROPBOX"],
      });

      expect(geometry.cropOnlyPageSize).toStrictEqual({ width: 200, height: 160 });
      expect(geometry.rotatedPageSize).toStrictEqual({ width: 160, height: 200 });
      expect(geometry.cropOnlyWidgetRect).toStrictEqual([100, 220, 180, 260]);
      expect(geometry.rotatedWidgetRect).toStrictEqual([100, 100, 140, 180]);
      expect(geometry.rotatedVisibleRect).toStrictEqual({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
      expect(decodedFlateStreams(stamped)).toMatch(/\b0 1 -1 0 300 100 cm\b/);
      expect(decodedFlateStreams(cropOnlyStamped)).toMatch(/\b1 0 0 1 100 100 cm\b/);
    }),
  );
  it.effect("round-trips non-square CropBox coordinates across every page rotation", () =>
    Effect.promise(async () => {
      const pdfDoc = await PDFDocument.create();
      for (const rotation of [0, 90, 180, 270]) {
        const page = pdfDoc.addPage([500, 400]);
        page.setCropBox(100, 25, 200, 100);
        page.setRotation(degrees(rotation));
        const rect = { pageIndex: 0, x: 20, y: 30, width: 40, height: 25 };
        const tuple = pdfCoordinateTupleFromTopLeftRect(rect, page);

        expect(topLeftRectFromPdfCoordinateTuple(tuple, page)).toStrictEqual({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
      }
    }),
  );
  it.effect("maps rubric helpers through non-square rotated CropBoxes", () =>
    Effect.gen(function* () {
      const pdf = yield* Effect.promise(async () => {
        const pdfDoc = await PDFDocument.create();
        const clockwise = pdfDoc.addPage([400, 400]);
        clockwise.setCropBox(100, 100, 200, 160);
        clockwise.setRotation(degrees(90));
        const counterclockwise = pdfDoc.addPage([400, 400]);
        counterclockwise.setCropBox(100, 100, 200, 160);
        counterclockwise.setRotation(degrees(270));
        return new Uint8Array(await pdfDoc.save({ useObjectStreams: false }));
      });
      const stamped = yield* stampPdfRubricOnPages({
        pdf,
        pageDimensions: [
          { index: 0, width: 160, height: 200 },
          { index: 1, width: 160, height: 200 },
        ],
        pages: [0, 1],
        initials: "AB",
        border: false,
      });
      const content = decodedFlateStreams(stamped);

      expect(content).toMatch(/\b0 1 -1 0 300 100 cm\b/);
      expect(content).toMatch(/\b0 -1 1 0 100 260 cm\b/);
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

  it.effect("rejects invalid visible rects and page identities on every batch target", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const invalidRects = [
        { pageIndex: 0, x: Number.NaN, y: 20, width: 80, height: 40 },
        { pageIndex: 0, x: 20, y: Number.POSITIVE_INFINITY, width: 80, height: 40 },
        { pageIndex: 0, x: 241, y: 20, width: 80, height: 40 },
      ];
      for (const rect of invalidRects) {
        const result = yield* Effect.result(
          stampPdfVisibleSignature({ pdf, pageIndex: rect.pageIndex, rect, lines: ["x"] }),
        );
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
        }
      }
      const [mismatchedSingle, mismatchedBatch] = yield* Effect.all([
        Effect.result(
          stampPdfVisibleSignature({
            pdf,
            pageIndex: 0,
            rect: { pageIndex: 1, x: 20, y: 20, width: 80, height: 40 },
            lines: ["x"],
          }),
        ),
        Effect.result(
          stampPdfVisibleSignatures(
            {
              pdf,
              stamps: [
                { pageIndex: 0, rect: { pageIndex: 1, x: 20, y: 20, width: 80, height: 40 } },
              ],
              lines: ["x"],
            },
            false,
          ),
        ),
      ]);
      for (const result of [mismatchedSingle, mismatchedBatch]) {
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
        }
      }

      const laterTargetResult = yield* Effect.result(
        stampPdfVisibleSignatures(
          {
            pdf,
            stamps: [
              { pageIndex: 0, rect: { pageIndex: 0, x: 20, y: 20, width: 80, height: 40 } },
              { pageIndex: 1, rect: { pageIndex: 1, x: 241, y: 20, width: 80, height: 40 } },
            ],
            lines: ["x"],
          },
          false,
        ),
      );
      expect(Result.isFailure(laterTargetResult)).toBe(true);
      if (Result.isFailure(laterTargetResult)) {
        expect(laterTargetResult.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );

  it.effect("rejects visible rects outside rotated CropBox dimensions", () =>
    Effect.gen(function* () {
      const pdf = yield* Effect.promise(async () => {
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([400, 400]);
        page.setCropBox(100, 100, 200, 100);
        page.setRotation(degrees(90));
        return new Uint8Array(await pdfDoc.save({ useObjectStreams: false }));
      });
      const result = yield* Effect.result(
        stampPdfVisibleSignature({
          pdf,
          pageIndex: 0,
          rect: { pageIndex: 0, x: 80, y: 0, width: 30, height: 40 },
          lines: ["x"],
        }),
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }
    }),
  );

  it.effect("rejects invalid and CropBox-external rubric tuples", () =>
    Effect.gen(function* () {
      const pdf = yield* createThreePagePdf;
      const invalidRects: ReadonlyArray<PdfCoordinateTuple> = [
        [Number.NaN, 20, 92, 52],
        [20, 20, Number.POSITIVE_INFINITY, 52],
        [20, 20, 20, 52],
      ];
      for (const rect of invalidRects) {
        const result = yield* Effect.result(
          stampPdfRubric(pdf, { rect, pages: [0], lines: ["x"] }),
        );
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe(PdfErrorCodeValue.stampFailed);
        }
      }

      const croppedPdf = yield* Effect.promise(async () => {
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([400, 400]);
        page.setCropBox(100, 100, 200, 160);
        return new Uint8Array(await pdfDoc.save({ useObjectStreams: false }));
      });
      const outsideResult = yield* Effect.result(
        stampPdfRubric(croppedPdf, { rect: [20, 20, 92, 52], pages: [0], lines: ["x"] }),
      );
      expect(Result.isFailure(outsideResult)).toBe(true);
      if (Result.isFailure(outsideResult)) {
        expect(outsideResult.failure.code).toBe(PdfErrorCodeValue.stampFailed);
      }

      const stamped = yield* stampPdfRubric(croppedPdf, {
        rect: [100, 220, 180, 260],
        pages: [0],
        lines: ["x"],
      });
      expect(stamped.byteLength).toBeGreaterThan(croppedPdf.byteLength);
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
