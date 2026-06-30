import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { rubricRectForPage, stampPdfRubricOnPages, stampPdfVisibleSignature } from "@signature-kit/pdf/stamp";
import type { PdfSignaturePage, PdfTextBox } from "@signature-kit/pdf/config";
import { Store } from "@tanstack/react-store";
import { AsyncQueuer, queuerBusy, waitFor } from "./helpers/queue";
import { isPdf, makeDummyPdf, pdfPageCount, type PageSize, A4, LETTER, LEGAL } from "./helpers/dummy-pdf";

/**
 * Signing with "rubricar todas as páginas" (pdf-signer `signAll` +
 * `rubricEveryPage`). The bug this guards: per-page `stampPdfRubric` calls made
 * the prep O(P²) and the batch never finished ("nao termina nunca de assinar").
 * The fix groups target pages by SIZE so same-sized pages share ONE call. This
 * test bakes the rubric on 20 MULTI-PAGE dummy PDFs (some with mixed page
 * sizes), driven through a Pacer queue, and asserts every output is a valid PDF
 * with its page count intact and that the batch TERMINATES (real timeout).
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
const signatureRect = (page: PageSize) => ({
  pageIndex: 0,
  x: page.width - MARGIN - SIG_W,
  y: page.height - MARGIN - SIG_H,
  width: SIG_W,
  height: SIG_H,
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

  it("stamps the rubric on every page of 20 multi-page docs and TERMINATES", async () => {
    const out = new Store<{ stamped: Record<string, Uint8Array> }>({ stamped: {} });

    const queuer = new AsyncQueuer<MultiPageDoc>(
      async (doc) => {
        // Sign on the LAST page; rubric the OTHERS — exactly the component split.
        const placedPage = doc.pageDims.length - 1;
        const others = doc.pageDims.map((_d, i) => i).filter((i) => i !== placedPage);

        const pageTextBoxes: PdfTextBox[][] = Array.from({ length: doc.pageDims.length }, () => []);
        const main = doc.pageDims[placedPage]!;
        const sourceRect = signatureRect(main);
        const rubricPdf =
          others.length > 0
            ? await Effect.runPromise(
                stampPdfRubricOnPages({
                  pdf: doc.bytes,
                  pageDimensions: doc.pageDims,
                  pageTextBoxes,
                  pages: others,
                  lines: ["MAC"],
                  border: true,
                }),
              )
            : doc.bytes;

        const pdf = await Effect.runPromise(
          stampPdfVisibleSignature({
            pdf: rubricPdf,
            pageIndex: placedPage,
            rect: sourceRect,
            lines: STAMP_LINES,
            border: true,
          }),
        );

        out.setState((s) => ({ stamped: { ...s.stamped, [doc.id]: pdf } }));
        return doc.id;
      },
      { concurrency: 1, started: true },
    );

    const start = performance.now();
    for (const doc of docs) queuer.addItem(doc);
    expect(queuerBusy(queuer)).toBe(true);

    // Real timeout — the "nunca termina" hang fails here instead of stalling.
    await waitFor(
      () => Object.keys(out.state.stamped).length === DOC_COUNT && !queuerBusy(queuer),
      { timeout: 30000, label: "all 20 docs rubric-stamped and the queue drained" },
    );
    const elapsed = performance.now() - start;

    expect(queuerBusy(queuer)).toBe(false);
    expect(queuer.store.state.settledCount).toBe(DOC_COUNT);

    for (const doc of docs) {
      const stamped = out.state.stamped[doc.id];
      expect(stamped, `doc ${doc.id} must be stamped`).toBeInstanceOf(Uint8Array);
      expect(isPdf(stamped!)).toBe(true);
      // Stamping must NOT add or drop pages.
      expect(await pdfPageCount(stamped!)).toBe(doc.pageDims.length);
      // Drawing real content makes the file larger than the bare input.
      expect(stamped!.byteLength).toBeGreaterThan(doc.bytes.byteLength);
    }

    // Generous ceiling; the grouped path keeps 20 multi-page docs well-bounded.
    expect(elapsed).toBeLessThan(25000);
  }, 40000);
});
