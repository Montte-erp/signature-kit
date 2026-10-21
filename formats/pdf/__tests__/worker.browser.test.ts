import { PDFDocument } from "@cantoo/pdf-lib";
import { Effect, Exit, Redacted, Result } from "effect";
import { expect, it } from "vitest";
import { a1SignaturesLayer } from "@signature-kit/a1/signer";
import { PdfWorker } from "@signature-kit/pdf/worker";
import { pdfWorkerBrowserLayer } from "@signature-kit/pdf/worker-browser";
import { signPdfSignatureBatch } from "@signature-kit/pdf/workflow";
import { verifyPdfSignatures } from "@signature-kit/pdf/verify";
import { readA1FixtureFromBrowser } from "../../../tooling/testing/fixtures.browser";

it("prepares a real PDF in a worker, preserves caller bytes, and signs the result", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const pdf = yield* Effect.promise(async () => {
        const document = await PDFDocument.create();
        document.addPage([400, 300]);
        return new Uint8Array(await document.save());
      });
      const original = new Uint8Array(pdf);
      const rect = { pageIndex: 0, x: 20, y: 20, width: 320, height: 128 };
      const pages = [{ index: 0, width: 400, height: 300 }];
      const worker = yield* PdfWorker;
      const progress: string[] = [];
      const prepared = yield* worker.prepare(
        {
          documents: [
            {
              id: "document",
              pdf,
              template: {
                id: "template",
                name: "Test",
                documents: [
                  { id: "document", name: "Test.pdf", source: { type: "uploaded" }, pages },
                ],
                roles: [{ id: "signer", label: "Signer" }],
                fields: [
                  {
                    id: "signature",
                    documentId: "document",
                    type: "signature",
                    roleId: "signer",
                    rect,
                  },
                ],
              },
              fieldId: "signature",
              rect,
              pageDimensions: pages,
            },
          ],
          stamp: {
            badge: {
              header: { text: "Signed in a Web Worker" },
              rows: [[{ label: "Signer", value: "Test" }]],
              footer: [],
            },
            border: false,
          },
          signing: { signingTime: new Date("2026-10-21T12:00:00Z") },
        },
        { onItemSettled: (result) => progress.push(result.id) },
      );
      expect(pdf).toEqual(original);
      expect(progress).toEqual(["document"]);
      expect(prepared.map((result) => result.ok)).toEqual([true]);
      const first = prepared[0];
      if (first?.ok)
        expect(first.item.input.signingTime?.toISOString()).toBe("2026-10-21T12:00:00.000Z");
      const pfx = yield* readA1FixtureFromBrowser("ecpf");
      const signed = yield* signPdfSignatureBatch(
        prepared.flatMap((result) => (result.ok ? [result.item] : [])),
      ).pipe(Effect.provide(a1SignaturesLayer({ pfx, password: Redacted.make("changeit") })));
      const success = signed[0];
      expect(success?.ok).toBe(true);
      if (success?.ok) {
        const verified = yield* verifyPdfSignatures({ pdf: success.signedPdf });
        expect(verified.map((result) => result.cryptographicValid)).toEqual([true]);
      }
    }).pipe(Effect.provide(pdfWorkerBrowserLayer())),
  );
});

it("renders branded previews and releases each worker scope", async () => {
  for (let index = 0; index < 2; index += 1) {
    const bytes = await Effect.runPromise(
      Effect.gen(function* () {
        const worker = yield* PdfWorker;
        return yield* worker.preview({
          width: 320,
          height: 128,
          badge: {
            header: { text: "Company" },
            rows: [],
            footer: [],
            theme: { backgroundColor: "#FFFFFF" },
          },
        });
      }).pipe(Effect.provide(pdfWorkerBrowserLayer())),
    );
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.getPage(0).getWidth()).toBe(324);
  }
});

it("preserves typed failures for invalid image bytes and invalid preview dimensions", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const worker = yield* PdfWorker;
      for (const input of [
        {
          width: 320,
          height: 128,
          badge: {
            header: { text: "Company" },
            rows: [],
            footer: [],
            logoPng: Uint8Array.of(1, 2, 3),
          },
        },
        {
          width: Number.NaN,
          height: 128,
          badge: { header: { text: "Company" }, rows: [], footer: [] },
        },
      ]) {
        const result = yield* Effect.result(worker.preview(input));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(result.failure.code).toBe("pdf.STAMP_FAILED");
      }
    }).pipe(Effect.provide(pdfWorkerBrowserLayer())),
  );
});

it("returns a per-document load failure for malformed PDFs without losing the worker", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const worker = yield* PdfWorker;
      const results = yield* worker.prepare({
        documents: [
          {
            id: "broken",
            pdf: Uint8Array.of(1, 2, 3),
            template: { id: "template", name: "Test", documents: [], roles: [], fields: [] },
            fieldId: "signature",
            rect: { pageIndex: 0, x: 0, y: 0, width: 100, height: 40 },
            pageDimensions: [],
          },
        ],
        signing: {},
      });
      const failed = results[0];
      expect(failed?.ok).toBe(false);
      if (failed?.ok === false) expect(failed.error.code).toBe("pdf.PDF_LOAD_FAILED");
      const preview = yield* worker.preview({
        width: 320,
        height: 128,
        badge: { header: { text: "Still available" }, rows: [], footer: [] },
      });
      expect(preview.byteLength).toBeGreaterThan(0);
    }).pipe(Effect.provide(pdfWorkerBrowserLayer())),
  );
});

it("interrupts an acquired worker scope and starts an independent next session", async () => {
  const controller = new AbortController();
  const outcome = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const worker = yield* PdfWorker;
      yield* worker.preview({
        width: 320,
        height: 128,
        badge: { header: { text: "Cancelled session" }, rows: [], footer: [] },
      });
      controller.abort();
      return yield* Effect.never;
    }).pipe(Effect.provide(pdfWorkerBrowserLayer())),
    { signal: controller.signal },
  );
  expect(Exit.isFailure(outcome)).toBe(true);
  const next = await Effect.runPromise(
    Effect.gen(function* () {
      const worker = yield* PdfWorker;
      return yield* worker.preview({
        width: 320,
        height: 128,
        badge: { header: { text: "Independent session" }, rows: [], footer: [] },
      });
    }).pipe(Effect.provide(pdfWorkerBrowserLayer())),
  );
  expect(next.byteLength).toBeGreaterThan(0);
});
