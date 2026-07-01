import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { rubricPageIndexesExcludingSignature, rubricRectForPage } from "@signature-kit/pdf/stamp";
import { preparePdfSigningBatch } from "@signature-kit/pdf/workflow";
import type {
  PdfSignaturePage,
  PdfSignatureRect,
  PdfSignatureTemplate,
  PdfTextBox,
} from "@signature-kit/pdf/config";
import { isPdf, makeDummyPdf, pdfPageCount, type PageSize, A4, LETTER, LEGAL } from "./helpers/dummy-pdf";

/**
 * Signing with "rubricar todas as páginas" (pdf-signer `signAll` +
 * `rubricEveryPage`). The bug this guards: per-page `stampPdfRubric` calls made
 * the prep O(P²) and the batch never finished ("nao termina nunca de assinar").
 * The fix groups target pages by SIZE so same-sized pages share ONE call. This
 * test bakes the rubric on 20 MULTI-PAGE dummy PDFs (some with mixed page
 * sizes), driven through `preparePdfSigningBatch`, and asserts every output is a
 * valid PDF with its page count intact, no rubric targets the main signature page, and the batch TERMINATES.
 */

const DOC_COUNT = 20;
const SIG_W = 168;
const SIG_H = 48;
const MARGIN = 36;
const RUBRIC_W = 72;
const RUBRIC_H = 32;
const RUBRIC_RIGHT_MARGIN = 18;

const STAMP_LINES = ["Maria A. Costa", "CPF/CNPJ: 000.000.000-00", "Assinado digitalmente"];

type MultiPageDoc = {
  readonly id: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly pageDims: ReadonlyArray<PdfSignaturePage>;
};

// A bottom-right main signature rect (top-left origin builder rect) for a given page size.
const signatureRect = (page: PageSize, pageIndex: number): PdfSignatureRect => ({
  pageIndex,
  x: page.width - MARGIN - SIG_W,
  y: page.height - MARGIN - SIG_H,
  width: SIG_W,
  height: SIG_H,
});

const templateForDoc = (
  doc: MultiPageDoc,
  rect: PdfSignatureRect,
): PdfSignatureTemplate => ({
  id: `template-${doc.id}`,
  name: doc.name,
  documents: [
    {
      id: doc.id,
      name: doc.name,
      source: { type: "uploaded", bytes: doc.bytes },
      pages: Array.from(doc.pageDims),
    },
  ],
  roles: [{ id: "signer", label: "Signatário", required: true }],
  fields: [
    {
      id: "signature",
      type: "signature",
      documentId: doc.id,
      roleId: "signer",
      rect,
    },
  ],
});

it("places repeated rubrics compactly in the right side middle", () => {
  const legalTarget = { index: 1, width: LEGAL.width, height: LEGAL.height };

  const repeated = rubricRectForPage(legalTarget);

  expect(repeated).toStrictEqual({
    pageIndex: legalTarget.index,
    x: LEGAL.width - RUBRIC_RIGHT_MARGIN - RUBRIC_W,
    y: (LEGAL.height - RUBRIC_H) / 2,
    width: RUBRIC_W,
    height: RUBRIC_H,
  });
  expect(repeated.x).toBeGreaterThan(LEGAL.width - MARGIN - SIG_W);
});

it("nudges repeated rubrics away from LiteParse text boxes", () => {
  const legalTarget = { index: 1, width: LEGAL.width, height: LEGAL.height };
  const centered = rubricRectForPage(legalTarget);
  const textBox = {
    x: centered.x - 2,
    y: centered.y - 2,
    width: centered.width + 4,
    height: centered.height + 4,
  };

  const nudged = rubricRectForPage(legalTarget, [textBox]);

  expect(nudged.x).toBe(centered.x);
  expect(nudged.y).not.toBe(centered.y);
  expect(textBox.x < nudged.x + nudged.width && textBox.x + textBox.width > nudged.x).toBe(true);
  expect(textBox.y < nudged.y + nudged.height && textBox.y + textBox.height > nudged.y).toBe(false);
});


it("returns no rubric targets when the main signature is on the only page", () => {
  expect(rubricPageIndexesExcludingSignature([{ index: 0, width: A4.width, height: A4.height }], 0)).toEqual([]);
});
describe("signAll + rubricEveryPage", () => {
  let docs: ReadonlyArray<MultiPageDoc>;

  beforeAll(async () => {
    const built = await Promise.all(
      Array.from({ length: DOC_COUNT }, async (_unused, i) => {
        const pages = 2 + (i % 4); // 2..5 pages — always multi-page
        // Every 3rd doc gets MIXED page sizes → forces multiple rubric groups.
        const size: PageSize | ReadonlyArray<PageSize> =
          i % 3 === 0 ? [A4, LETTER, LEGAL, A4, LETTER].slice(0, pages) : i % 2 === 0 ? A4 : LETTER;
        const bytes = await makeDummyPdf({ pages, size, label: `Rubric doc ${i + 1}` });
        const dims: PdfSignaturePage[] = Array.from({ length: pages }, (_u, p) => {
          const ps = Array.isArray(size) ? (size[Math.min(p, size.length - 1)] ?? A4) : size;
          return { index: p, width: ps.width, height: ps.height };
        });
        return { id: `rubric-${i}`, name: `Rubric doc ${i + 1}`, bytes, pageDims: dims };
      }),
    );
    docs = built;
  }, 30000);

  it("stamps rubrics on every non-signature page of 20 multi-page docs and TERMINATES", async () => {
    const rubricTargetsById = Object.fromEntries(
      docs.map((doc) => [
        doc.id,
        rubricPageIndexesExcludingSignature(doc.pageDims, doc.pageDims.length - 1),
      ]),
    );

    const start = performance.now();
    const results = await Effect.runPromise(
      preparePdfSigningBatch({
        documents: docs.map((doc) => {
          // Sign on the LAST page; rubric the OTHERS — exactly the component split.
          const placedPage = doc.pageDims.length - 1;
          const main = doc.pageDims[placedPage];
          if (main === undefined) expect.fail(`doc ${doc.id} missing main signature page`);
          const rect = signatureRect(main, placedPage);
          const pageTextBoxes: PdfTextBox[][] = Array.from(
            { length: doc.pageDims.length },
            () => [],
          );
          return {
            id: doc.id,
            pdf: doc.bytes,
            template: templateForDoc(doc, rect),
            fieldId: "signature",
            rect,
            pageDimensions: Array.from(doc.pageDims),
            pageTextBoxes,
          };
        }),
        stamp: {
          lines: STAMP_LINES,
          rubricLines: ["MAC"],
          rubricEveryPage: true,
          border: true,
        },
        signing: {
          reason: "SignatureKit test signature",
          name: "Maria A. Costa",
          location: "Vitest",
        },
      }),
    );
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(DOC_COUNT);
    expect(results.every((result) => result.ok)).toBe(true);

    const stampedById = Object.fromEntries(
      results.flatMap((result) =>
        result.ok ? [[result.id, result.item.input.pdf] satisfies readonly [string, Uint8Array]] : [],
      ),
    );

    for (const doc of docs) {
      const stamped = stampedById[doc.id];
      expect(stamped, `doc ${doc.id} must be stamped`).toBeInstanceOf(Uint8Array);
      if (stamped === undefined) expect.fail(`doc ${doc.id} missing stamped bytes`);
      const placedPage = doc.pageDims.length - 1;
      const rubricTargets = rubricTargetsById[doc.id] ?? [];
      expect(rubricTargets).not.toContain(placedPage);
      expect(rubricTargets).toHaveLength(doc.pageDims.length - 1);
      expect(isPdf(stamped)).toBe(true);
      // Stamping must NOT add or drop pages.
      expect(await pdfPageCount(stamped)).toBe(doc.pageDims.length);
      // Drawing real content makes the file larger than the bare input.
      expect(stamped.byteLength).toBeGreaterThan(doc.bytes.byteLength);
    }

    // Generous ceiling; the grouped path keeps 20 multi-page docs well-bounded.
    expect(elapsed).toBeLessThan(25000);
  }, 40000);
});
