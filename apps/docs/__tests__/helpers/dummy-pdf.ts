import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

/**
 * Test helpers — real, self-contained dummy PDFs built with the SAME pdf-lib the
 * app ships (`@cantoo/pdf-lib`). No `@react-pdf/renderer`, no fontkit, no worker,
 * so these run in plain Node (vitest default env) in well under a millisecond
 * each. Every page carries real drawn text so pdf.js / pdf-lib parse genuine
 * content, and the bytes always begin with the `%PDF` magic.
 */

export const A4: PageSize = { width: 595.28, height: 841.89 };
export const LETTER: PageSize = { width: 612, height: 792 };
export const LEGAL: PageSize = { width: 612, height: 1008 };

export interface PageSize {
  readonly width: number;
  readonly height: number;
}

export interface DummyPdfOptions {
  /** Number of pages to draw. Defaults to 1. */
  readonly pages?: number;
  /** Per-page size. A single size applies to every page; an array gives mixed
   *  sizes (one entry per page, last entry repeated if short). Defaults to A4. */
  readonly size?: PageSize | ReadonlyArray<PageSize>;
  /** Visible label drawn on page 1 (helps eyeball failing fixtures). */
  readonly label?: string;
}

const sizeForPage = (
  size: DummyPdfOptions["size"],
  index: number,
): PageSize => {
  if (size === undefined) return A4;
  if (Array.isArray(size)) {
    const list = size as ReadonlyArray<PageSize>;
    return list[Math.min(index, list.length - 1)] ?? A4;
  }
  return size as PageSize;
};

/** Build one dummy PDF with `pages` real, text-bearing pages. */
export async function makeDummyPdf(
  options: DummyPdfOptions = {},
): Promise<Uint8Array> {
  const pageCount = Math.max(1, options.pages ?? 1);
  const doc = await PDFDocument.create();
  doc.setTitle(options.label ?? "Dummy PDF");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < pageCount; i++) {
    const { width, height } = sizeForPage(options.size, i);
    const page = doc.addPage([width, height]);
    page.drawText(options.label ?? "Dummy contract", {
      x: 48,
      y: height - 64,
      size: 18,
      font: bold,
      color: rgb(0.067, 0.067, 0.067),
    });
    page.drawText(`Page ${i + 1} of ${pageCount}`, {
      x: 48,
      y: height - 92,
      size: 11,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    // A block of body text so the page is not visually empty when rasterised.
    for (let line = 0; line < 6; line++) {
      page.drawText(
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do.",
        {
          x: 48,
          y: height - 130 - line * 16,
          size: 10,
          font,
          color: rgb(0.2, 0.2, 0.2),
        },
      );
    }
  }

  // useObjectStreams:false keeps the output a classic xref PDF, matching what the
  // signing pipeline expects downstream.
  return doc.save({ useObjectStreams: false });
}

export interface DummyDocSpec {
  readonly id: string;
  readonly name: string;
  readonly pages: number;
  readonly size?: PageSize | ReadonlyArray<PageSize>;
}

export interface BuiltDummyDoc {
  readonly id: string;
  readonly name: string;
  readonly pages: number;
  readonly bytes: Uint8Array;
}

/**
 * Build `count` dummy PDFs with VARIED page counts and sizes — the shape the
 * auto-place / rubric flows have to chew through. Page counts cycle 1→5 and a
 * deterministic slice gets mixed page sizes (A4 + Letter + Legal) so the
 * group-by-size rubric path is exercised.
 */
export async function makeDummyDocs(
  count: number,
): Promise<ReadonlyArray<BuiltDummyDoc>> {
  const specs: DummyDocSpec[] = Array.from({ length: count }, (_, i) => {
    const pages = (i % 5) + 1; // 1..5
    // Every 4th doc gets mixed page sizes to force multiple rubric groups.
    const size =
      i % 4 === 0
        ? [A4, LETTER, LEGAL, A4, LETTER].slice(0, pages)
        : i % 3 === 0
          ? LETTER
          : A4;
    return { id: `dummy-${i}`, name: `Dummy document ${i + 1}`, pages, size };
  });

  return Promise.all(
    specs.map(async (spec) => ({
      id: spec.id,
      name: spec.name,
      pages: spec.pages,
      bytes: await makeDummyPdf({
        pages: spec.pages,
        size: spec.size,
        label: spec.name,
      }),
    })),
  );
}

/** True when `bytes` begins with the `%PDF` magic header. */
export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 // F
  );
}

/** Parse `bytes` with pdf-lib and return its page count (proves valid output). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}
