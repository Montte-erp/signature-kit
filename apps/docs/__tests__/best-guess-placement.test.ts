import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { createPdfSignatureBuilderStateFromBytes } from "@signature-kit/pdf/workflow";
import {
  createPdfSignatureBuilderStore,
  placePdfSignatureFieldsBatch,
} from "@signature-kit/pdf/builder-store";
import type {
  PdfSignatureFieldDraft,
  PdfSignaturePage,
  PdfSignatureRect,
  PdfSignatureTemplate,
  PdfSignerRole,
} from "@signature-kit/pdf/config";
import { makeDummyDocs } from "./helpers/dummy-pdf";

/**
 * Best-guess auto-placement (pdf-signer `autoPlaceAll`).
 *
 * The bug this guards: docs must not own a second placement algorithm or spin up
 * pdf.js per document. The app hands parsed page dimensions to the PDF package's
 * `placePdfSignatureFieldsBatch`, then only reflects callbacks in UI state. This
 * test places signatures on 25 dummy PDFs of VARIED page counts/sizes, asserts
 * every one gets a rect on its LAST page, that focus moves doc-by-doc, and that
 * the library-owned queue terminates in well under a few seconds.
 */

const DOC_COUNT = 25;

const SIGNATURE_DRAFT: PdfSignatureFieldDraft = {
  id: "a1-signature",
  type: "signature",
  roleId: "signer",
  width: 168,
  height: 48,
  label: "A1 signature",
  required: true,
};

const ROLE: PdfSignerRole = {
  id: "signer",
  label: "Signatário",
  email: "signer@example.com",
  required: true,
};

type ParsedDoc = {
  readonly id: string;
  readonly name: string;
  readonly template: PdfSignatureTemplate;
  readonly pageDims: ReadonlyArray<PdfSignaturePage>;
};


describe("best-guess auto-placement", () => {
  let parsed: ReadonlyArray<ParsedDoc>;

  beforeAll(async () => {
    // Parsing happens when docs are ADDED (before autoPlaceAll). Done once here.
    const built = await makeDummyDocs(DOC_COUNT);
    parsed = await Promise.all(
      built.map(async (doc) => {
        const state = await Effect.runPromise(
          createPdfSignatureBuilderStateFromBytes({
            id: "best-guess-test",
            name: doc.name,
            documentId: doc.id,
            documentName: doc.name,
            pdf: doc.bytes,
            role: ROLE,
            draft: SIGNATURE_DRAFT,
          }),
        );
        const template = state.template;
        const [document] = template.documents;
        if (document === undefined) expect.fail("missing generated test document");
        return {
          id: doc.id,
          name: doc.name,
          template,
          pageDims: document.pages,
        };
      }),
    );
  }, 30000);

  it("places all 25 docs (bottom-right, last page) and TERMINATES fast", async () => {
    let placedState: {
      readonly rects: Record<string, PdfSignatureRect>;
      readonly activeDocId?: string;
    } = { rects: {} };

    const focusOrder: string[] = [];
    const queue = parsed.map((doc) => ({
      id: doc.id,
      store: createPdfSignatureBuilderStore({
        template: doc.template,
        draft: SIGNATURE_DRAFT,
      }),
      documentId: doc.id,
      draft: SIGNATURE_DRAFT,
    }));

    const start = performance.now();
    const results = await Effect.runPromise(
      placePdfSignatureFieldsBatch(queue, {
        onItemStarted: (item) => {
          placedState = { ...placedState, activeDocId: item.id };
          focusOrder.push(item.id);
        },
        onItemSettled: (result) => {
          if (!result.ok) expect.fail(result.error.message);
          placedState = {
            ...placedState,
            rects: { ...placedState.rects, [result.id]: result.field.rect },
          };
        },
        yieldAfterItem: () => Effect.sleep("0 millis"),
      }),
    );
    const elapsed = performance.now() - start;

    // Termination + correctness.
    expect(results).toHaveLength(DOC_COUNT);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(Object.keys(placedState.rects)).toHaveLength(DOC_COUNT);

    for (const doc of parsed) {
      const rect = placedState.rects[doc.id];
      expect(rect, `doc ${doc.id} must have a rect`).toBeTruthy();
      if (rect === undefined) expect.fail(`doc ${doc.id} missing rect`);
      // Always placed on the LAST page.
      expect(rect.pageIndex).toBe(doc.pageDims.length - 1);
      expect(rect.width).toBeCloseTo(SIGNATURE_DRAFT.width, 1);
      expect(rect.height).toBeCloseTo(SIGNATURE_DRAFT.height, 1);
      // Sits inside its own (last) page.
      const last = doc.pageDims[doc.pageDims.length - 1];
      if (last === undefined) expect.fail(`doc ${doc.id} missing last page`);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(last.width + 0.01);
      expect(rect.y + rect.height).toBeLessThanOrEqual(last.height + 0.01);
    }

    // Real-time focus visited every doc, in order.
    expect(focusOrder).toEqual(parsed.map((d) => d.id));
    expect(placedState.activeDocId).toBe(parsed[parsed.length - 1]?.id);

    // The whole placement run is fast — "well under a few seconds".
    expect(elapsed).toBeLessThan(4000);
  }, 20000);
});
