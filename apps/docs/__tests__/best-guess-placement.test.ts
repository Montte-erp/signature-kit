import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { createBrowserPdfSignatureBuilderState } from "@signature-kit/react/browser-pdf";
import { createSignatureBuilderStore } from "@signature-kit/react/components";
import type {
  ReactSignatureFieldDraft,
  ReactSignatureTemplate,
} from "@signature-kit/react/config";
import { Store } from "@tanstack/react-store";

import { AsyncQueuer, queuerBusy, waitFor } from "./helpers/queue";
import { makeDummyDocs } from "./helpers/dummy-pdf";

/**
 * Best-guess auto-placement (pdf-signer `autoPlaceAll` / `bestGuessAnchor`).
 *
 * The bug this guards: `bestGuessAnchor` used to spin up pdf.js PER document to
 * hunt a /Sig widget — 25+ PDF parses froze the modal ("fica preso / nunca
 * termina"). The fix is PURE GEOMETRY off `doc.pageDims` (no pdf.js). This test
 * places signatures on 25 dummy PDFs of VARIED page counts/sizes, asserts every
 * one gets a rect on its LAST page, that the placement focus moves doc-by-doc
 * (the real-time preview, item 2), and that the whole run terminates in well
 * under a few seconds.
 */

const DOC_COUNT = 25;

const SIGNATURE_DRAFT: ReactSignatureFieldDraft = {
  id: "a1-signature",
  type: "signature",
  roleId: "signer",
  width: 168,
  height: 48,
  label: "A1 signature",
  required: true,
};

const ROLE = {
  id: "signer",
  label: "Signatário",
  email: "signer@example.com",
  required: true,
} as const;

type PageDim = { readonly index: number; readonly width: number; readonly height: number };
type DocRect = { pageIndex: number; x: number; y: number; width: number; height: number };

type ParsedDoc = {
  readonly id: string;
  readonly name: string;
  readonly template: ReactSignatureTemplate;
  readonly pageDims: ReadonlyArray<PageDim>;
};

// Mirror of pdf-signer's bestGuessAnchor: bottom-right CENTER point on the LAST
// page, sized from the draft. Synchronous, no pdf.js.
function bestGuessAnchor(pageDims: ReadonlyArray<PageDim>) {
  const last = pageDims[pageDims.length - 1]!;
  const margin = 48;
  return {
    pageIndex: pageDims.length - 1,
    cx: Math.max(SIGNATURE_DRAFT.width / 2, last.width - margin - SIGNATURE_DRAFT.width / 2),
    cy: Math.max(SIGNATURE_DRAFT.height / 2, last.height - margin - SIGNATURE_DRAFT.height / 2),
  };
}

describe("best-guess auto-placement", () => {
  let parsed: ReadonlyArray<ParsedDoc>;

  beforeAll(async () => {
    // Parsing happens when docs are ADDED (before autoPlaceAll). Done once here.
    const built = await makeDummyDocs(DOC_COUNT);
    parsed = await Promise.all(
      built.map(async (doc) => {
        const state = await Effect.runPromise(
          createBrowserPdfSignatureBuilderState({
            id: "best-guess-test",
            name: doc.name,
            documentId: doc.id,
            documentName: doc.name,
            pdf: doc.bytes,
            role: ROLE,
            draft: SIGNATURE_DRAFT,
          }),
        );
        const template = state.template as ReactSignatureTemplate;
        return {
          id: doc.id,
          name: doc.name,
          template,
          pageDims: template.documents[0]!.pages as ReadonlyArray<PageDim>,
        };
      }),
    );
  }, 30000);

  it("places all 25 docs (bottom-right, last page) and TERMINATES fast", async () => {
    const placedStore = new Store<{
      rects: Record<string, DocRect>;
      activeDocId?: string;
    }>({ rects: {} });

    const focusOrder: string[] = [];

    const queuer = new AsyncQueuer<ParsedDoc>(
      async (doc) => {
        // Real-time preview: switch the active doc as we position it (item 2).
        placedStore.setState((s) => ({ ...s, activeDocId: doc.id }));
        focusOrder.push(doc.id);

        const anchor = bestGuessAnchor(doc.pageDims);
        const builder = createSignatureBuilderStore({
          template: doc.template,
          draft: SIGNATURE_DRAFT,
        });
        const placed = await Effect.runPromise(
          builder.placeField({
            documentId: doc.id,
            pageIndex: anchor.pageIndex,
            x: anchor.cx,
            y: anchor.cy,
            draft: SIGNATURE_DRAFT,
            anchor: "center",
          }),
        );
        const rect = placed.fields.find((f) => f.id === SIGNATURE_DRAFT.id)!.rect as DocRect;
        placedStore.setState((s) => ({ ...s, rects: { ...s.rects, [doc.id]: rect } }));
        return doc.id;
      },
      { concurrency: 1, started: true },
    );

    const start = performance.now();
    for (const doc of parsed) queuer.addItem(doc);
    expect(queuerBusy(queuer)).toBe(true);

    // Hard real timeout — a hang (the old pdf.js-per-doc freeze) fails here.
    await waitFor(
      () => Object.keys(placedStore.state.rects).length === DOC_COUNT && !queuerBusy(queuer),
      { timeout: 10000, label: "all 25 docs placed and the queue drained" },
    );
    const elapsed = performance.now() - start;

    // Termination + correctness.
    expect(queuerBusy(queuer)).toBe(false);
    expect(queuer.store.state.settledCount).toBe(DOC_COUNT);
    expect(Object.keys(placedStore.state.rects)).toHaveLength(DOC_COUNT);

    for (const doc of parsed) {
      const rect = placedStore.state.rects[doc.id];
      expect(rect, `doc ${doc.id} must have a rect`).toBeTruthy();
      // Always placed on the LAST page.
      expect(rect!.pageIndex).toBe(doc.pageDims.length - 1);
      expect(rect!.width).toBeCloseTo(SIGNATURE_DRAFT.width, 1);
      expect(rect!.height).toBeCloseTo(SIGNATURE_DRAFT.height, 1);
      // Sits inside its own (last) page.
      const last = doc.pageDims[doc.pageDims.length - 1]!;
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(last.width + 0.01);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(last.height + 0.01);
    }

    // Real-time focus visited every doc, in order.
    expect(focusOrder).toEqual(parsed.map((d) => d.id));
    expect(placedStore.state.activeDocId).toBe(parsed[parsed.length - 1]!.id);

    // The whole placement run is fast — "well under a few seconds".
    expect(elapsed).toBeLessThan(4000);
  }, 20000);
});
