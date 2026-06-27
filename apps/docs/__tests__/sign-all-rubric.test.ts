import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { stampPdfRubric } from "@signature-kit/pdf/stamp";
import { Store } from "@tanstack/react-store";

import { bakeStamp, toBottomLeft } from "../components/pdf-stamp";
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

const STAMP_LINES = ["Maria A. Costa", "CPF/CNPJ: 000.000.000-00", "Assinado digitalmente"];

type PageDim = { readonly index: number; readonly width: number; readonly height: number };

type MultiPageDoc = {
  readonly id: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly pageDims: ReadonlyArray<PageDim>;
};

// A bottom-right rubric rect (top-left origin builder rect) for a given page size.
const rubricRect = (page: PageSize) => ({
  pageIndex: 0,
  x: page.width - MARGIN - SIG_W,
  y: page.height - MARGIN - SIG_H,
  width: SIG_W,
  height: SIG_H,
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
        const dims: PageDim[] = Array.from({ length: pages }, (_u, p) => {
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

        let pdf = doc.bytes;

        // Group "other" pages by dimension so same-sized pages share ONE
        // stampPdfRubric call (the fix for the O(P²) hang).
        type Group = { dim: PageDim; pages: number[] };
        const byDim = new Map<string, Group>();
        for (const i of others) {
          const dim = doc.pageDims[i]!;
          const key = `${dim.width}x${dim.height}`;
          const group = byDim.get(key) ?? { dim, pages: [] };
          group.pages.push(i);
          byDim.set(key, group);
        }

        for (const { dim, pages } of byDim.values()) {
          pdf = await Effect.runPromise(
            stampPdfRubric(pdf, {
              rect: toBottomLeft(rubricRect(dim), dim.height),
              pages,
              lines: ["MAC"],
              border: true,
            }),
          );
        }

        // The placed page gets the full "Signed by" block baked in.
        const main = doc.pageDims[placedPage]!;
        pdf = await bakeStamp(pdf, {
          pageIndex: placedPage,
          rect: rubricRect(main),
          lines: STAMP_LINES,
          border: true,
        });

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
